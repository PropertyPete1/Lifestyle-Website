import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import * as db from "./db";
import { computeIntent, sendFubNote, sendToFub, sendWebsiteInquiryToFub, WEBSITE_INQUIRY_SOURCE, WEBSITE_INQUIRY_TAG } from "./fub";
import { emailWebsiteInquiryCopy } from "./inquiryEmail";
import { buildActivityNote } from "./activityNote";
import { extractCriteria, matchListings } from "./aiSearch";
import { notifyOwner } from "./_core/notification";
import { nanoid } from "nanoid";
import {
  LIFESTYLE_OPTIONS,
  HESITATION_OPTIONS,
  WORK_OPTIONS,
  fallbackPitch,
  generatePitch,
  matchCity,
  pickStats,
} from "./partnerPitch";
import { generateCityNarrative, fallbackNarrative, CITY_DATA } from "./cityNarrative";
import { isAdminEmail } from "@shared/site";
import { ENV } from "./_core/env";

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  // Defense in depth: DB role must be admin AND the account must be on the
  // hard allowlist (peter@/steven@lifestyledesignrealty.com, or project owner).
  // Even a tampered DB role cannot grant admin to any other account.
  const allowlisted = isAdminEmail(ctx.user.email) || ctx.user.openId === ENV.ownerOpenId;
  if (ctx.user.role !== "admin" || !allowlisted) throw new TRPCError({ code: "FORBIDDEN" });
  return next({ ctx });
});

const listingInput = z.object({
  slug: z.string().min(1),
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().default("TX"),
  zip: z.string().optional(),
  price: z.number().int().nonnegative(),
  beds: z.number().int().nonnegative(),
  baths: z.string().min(1),
  sqft: z.number().int().nonnegative(),
  status: z.enum(["Active", "Pending", "Sold"]).default("Active"),
  description: z.string().optional(),
  heroImage: z.string().optional(),
  photos: z.string().optional(),
  agentName: z.string().optional(),
  featured: z.boolean().default(true),
  hasPool: z.boolean().default(false),
  isNewConstruction: z.boolean().default(false),
  stories: z.number().int().min(1).max(4).default(1),
  primaryBedDown: z.boolean().default(true),
  propertyType: z.enum(["Residential", "Multi-Family", "Townhome/Condo", "Land"]).default("Residential"),
  lat: z.string().optional(),
  lng: z.string().optional(),
});

const leadInput = z.object({
  name: z.string().min(1).max(190),
  email: z.string().email().max(320),
  // Phone is REQUIRED on every lead form site-wide (we work leads by phone).
  // Enforced in superRefine below; the ONE exception is the Newsletter
  // content subscription (email-only by design).
  phone: z.string().max(40).optional(),
  message: z.string().max(5000).optional(),
  sourceTag: z.string().min(1).max(190),
  answers: z.record(z.string(), z.unknown()).optional(),
  tcpaConsent: z.literal(true, { message: "TCPA consent is required" }),
  /** Anonymous first-party visitor id — links pre-inquiry site activity. */
  visitorId: z.string().max(40).optional(),
}).superRefine((val, ctx) => {
  if (val.sourceTag === "Website - Newsletter") return; // content subscription, not a lead inquiry
  const digits = (val.phone ?? "").replace(/\D/g, "");
  if (digits.length < 7) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["phone"],
      message: "A valid phone number is required.",
    });
  }
});

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,

  /** Convince Your Partner — AI dream-scene pitches, cached per shareable slug. */
  partnerPitch: router({
    generate: publicProcedure
      .input(
        z.object({
          selections: z.array(z.enum(LIFESTYLE_OPTIONS)).min(1).max(8),
          partnerName: z.string().trim().max(60).optional(),
          hesitations: z.array(z.enum(HESITATION_OPTIONS)).max(6).optional(),
          workSituation: z.enum(WORK_OPTIONS).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const partnerName = input.partnerName?.split(/\s+/)[0] || undefined; // first name only
        const city = matchCity(input.selections);
        const stats = pickStats(input.selections, city);
        let pitch: string;
        let aiGenerated = true;
        try {
          pitch = await generatePitch({
            selections: input.selections,
            partnerName,
            city,
            hesitations: input.hesitations,
            workSituation: input.workSituation,
          });
        } catch (err) {
          // Graceful fallback — never a broken page
          console.error("[partnerPitch] Claude generation failed:", err);
          pitch = fallbackPitch({ selections: input.selections, partnerName, city });
          aiGenerated = false;
        }
        const slug = nanoid(10);
        await db.createPartnerPitch({
          slug,
          partnerName: partnerName ?? null,
          selections: JSON.stringify({
            picks: input.selections,
            hesitations: input.hesitations ?? [],
            workSituation: input.workSituation ?? null,
          }),
          city,
          pitch,
          stats: JSON.stringify(stats),
        });
        return { slug, city, pitch, stats, partnerName, aiGenerated } as const;
      }),
    /** Shared links reproduce the identical cached result — never regenerate. */
    getBySlug: publicProcedure
      .input(z.object({ slug: z.string().min(1).max(24) }))
      .query(async ({ input }) => {
        const row = await db.getPartnerPitchBySlug(input.slug);
        if (!row) return null;
        // selections was stored as a plain array before Jul 2026; new rows store
        // { picks, hesitations, workSituation }. Normalize to the picks array.
        const parsedSelections = JSON.parse(row.selections) as
          | string[]
          | { picks: string[]; hesitations?: string[]; workSituation?: string | null };
        return {
          slug: row.slug,
          city: row.city,
          pitch: row.pitch,
          stats: JSON.parse(row.stats) as string[],
          partnerName: row.partnerName ?? undefined,
          selections: Array.isArray(parsedSelections) ? parsedSelections : parsedSelections.picks,
        };
      }),
  }),

  /** City Finder — AI-generated personalized city-match narratives, cached per slug. */
  cityFinder: router({
    /**
     * Generate AI narratives for the top 3 matched cities. Caches the result
     * in city_matches so shared links always reproduce the same text.
     */
    generate: publicProcedure
      .input(
        z.object({
          answers: z.record(z.string(), z.string()),
          rankedCities: z.array(z.string().min(1)).min(1).max(5),
        })
      )
      .mutation(async ({ input }) => {
        const narratives: Record<string, { cityPitch: string; ldrPitch: string }> = {};
        const cities = input.rankedCities.slice(0, 3);
        // Generate narratives in parallel for speed
        const results = await Promise.allSettled(
          cities.map((city) => generateCityNarrative({ city, answers: input.answers }))
        );
        for (let i = 0; i < cities.length; i++) {
          const r = results[i];
          if (r.status === "fulfilled") {
            narratives[cities[i]] = r.value;
          } else {
            console.error(`[cityFinder] AI failed for ${cities[i]}:`, r.reason);
            narratives[cities[i]] = fallbackNarrative(cities[i]);
          }
        }
        const slug = nanoid(10);
        await db.createCityMatch({
          slug,
          answers: JSON.stringify(input.answers),
          rankedCities: JSON.stringify(cities),
          narratives: JSON.stringify(narratives),
        });
        return { slug, narratives } as const;
      }),
    /** Shared links: return the cached result by slug — never regenerate. */
    getBySlug: publicProcedure
      .input(z.object({ slug: z.string().min(1).max(24) }))
      .query(async ({ input }) => {
        const row = await db.getCityMatchBySlug(input.slug);
        if (!row) return null;
        return {
          slug: row.slug,
          answers: JSON.parse(row.answers) as Record<string, string>,
          rankedCities: JSON.parse(row.rankedCities) as string[],
          narratives: JSON.parse(row.narratives) as Record<string, { cityPitch: string; ldrPitch: string }>,
        };
      }),
  }),

  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  listings: router({
    featured: publicProcedure.query(() => db.getFeaturedListings()),
    all: publicProcedure.query(() => db.getAllListings()),
    /** AI natural-language search: extract criteria via LLM, match against listing data */
    aiSearch: publicProcedure
      .input(z.object({ query: z.string().min(2).max(400) }))
      .query(async ({ input }) => {
        const [criteria, listings] = await Promise.all([
          extractCriteria(input.query),
          db.getAllListings(),
        ]);
        return { criteria, results: matchListings(listings, criteria) };
      }),
    bySlug: publicProcedure
      .input(z.object({ slug: z.string() }))
      .query(({ input }) => db.getListingBySlug(input.slug)),
    create: adminProcedure.input(listingInput).mutation(({ input }) => db.createListing(input)),
    update: adminProcedure
      .input(z.object({ id: z.number(), data: listingInput.partial() }))
      .mutation(({ input }) => db.updateListing(input.id, input.data)),
    remove: adminProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => db.deleteListing(input.id)),
  }),

  testimonials: router({
    list: publicProcedure.query(() => db.getTestimonials()),
    listAll: adminProcedure.query(() => db.getTestimonials(true)),
    create: adminProcedure
      .input(z.object({ quote: z.string().min(1), author: z.string().min(1), source: z.string().optional(), sortOrder: z.number().default(0), published: z.boolean().default(true) }))
      .mutation(({ input }) => db.createTestimonial(input)),
    update: adminProcedure
      .input(z.object({ id: z.number(), data: z.object({ quote: z.string().optional(), author: z.string().optional(), source: z.string().optional(), sortOrder: z.number().optional(), published: z.boolean().optional() }) }))
      .mutation(({ input }) => db.updateTestimonial(input.id, input.data)),
    remove: adminProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => db.deleteTestimonial(input.id)),
  }),

  team: router({
    list: publicProcedure.query(() => db.getTeamMembers()),
    listAll: adminProcedure.query(() => db.getTeamMembers(true)),
    create: adminProcedure
      .input(z.object({ name: z.string().min(1), title: z.string().min(1), license: z.string().optional(), bio: z.string().optional(), photo: z.string().optional(), phone: z.string().optional(), email: z.string().optional(), sortOrder: z.number().default(0), active: z.boolean().default(true) }))
      .mutation(({ input }) => db.createTeamMember(input)),
    update: adminProcedure
      .input(z.object({ id: z.number(), data: z.object({ name: z.string().optional(), title: z.string().optional(), license: z.string().optional(), bio: z.string().optional(), photo: z.string().optional(), phone: z.string().optional(), email: z.string().optional(), sortOrder: z.number().optional(), active: z.boolean().optional() }) }))
      .mutation(({ input }) => db.updateTeamMember(input.id, input.data)),
    remove: adminProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => db.deleteTeamMember(input.id)),
  }),

  neighborhoods: router({
    list: publicProcedure.query(() => db.getNeighborhoods()),
    listAll: adminProcedure.query(() => db.getNeighborhoods(true)),
    bySlug: publicProcedure
      .input(z.object({ slug: z.string() }))
      .query(({ input }) => db.getNeighborhoodBySlug(input.slug)),
    create: adminProcedure
      .input(z.object({ slug: z.string().min(1), name: z.string().min(1), region: z.string().optional(), tagline: z.string().optional(), description: z.string().optional(), heroImage: z.string().optional(), medianPrice: z.string().optional(), vibe: z.string().optional(), isCityPage: z.boolean().default(false), sortOrder: z.number().default(0), published: z.boolean().default(true) }))
      .mutation(({ input }) => db.createNeighborhood(input)),
    update: adminProcedure
      .input(z.object({ id: z.number(), data: z.object({ slug: z.string().optional(), name: z.string().optional(), region: z.string().optional(), tagline: z.string().optional(), description: z.string().optional(), heroImage: z.string().optional(), medianPrice: z.string().optional(), vibe: z.string().optional(), isCityPage: z.boolean().optional(), sortOrder: z.number().optional(), published: z.boolean().optional() }) }))
      .mutation(({ input }) => db.updateNeighborhood(input.id, input.data)),
    remove: adminProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => db.deleteNeighborhood(input.id)),
  }),

  stats: router({
    list: publicProcedure.query(() => db.getSiteStats()),
    update: adminProcedure
      .input(z.object({ id: z.number(), data: z.object({ label: z.string().optional(), value: z.string().optional(), sortOrder: z.number().optional() }) }))
      .mutation(({ input }) => db.updateSiteStat(input.id, input.data)),
  }),

  links: router({
    list: publicProcedure.query(() => db.getBioLinks()),
    listAll: adminProcedure.query(() => db.getBioLinks(true)),
    create: adminProcedure
      .input(z.object({ label: z.string().min(1), url: z.string().min(1), sortOrder: z.number().default(0), active: z.boolean().default(true) }))
      .mutation(({ input }) => db.createBioLink(input)),
    update: adminProcedure
      .input(z.object({ id: z.number(), data: z.object({ label: z.string().optional(), url: z.string().optional(), sortOrder: z.number().optional(), active: z.boolean().optional() }) }))
      .mutation(({ input }) => db.updateBioLink(input.id, input.data)),
    remove: adminProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => db.deleteBioLink(input.id)),
  }),

  /**
   * Admin-editable site settings. First use: social profile URLs on /links
   * (TikTok / YouTube / LinkedIn slots — hidden until a URL is provided).
   */
  settings: router({
    socials: publicProcedure.query(async () => {
      const rows = await db.getSiteSettings(["social_tiktok", "social_youtube", "social_linkedin"]);
      return Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, string>;
    }),
    set: adminProcedure
      .input(
        z.object({
          key: z.enum(["social_tiktok", "social_youtube", "social_linkedin"]),
          // Empty string clears/hides the slot; otherwise require a valid URL.
          value: z.union([z.literal(""), z.string().url().max(500)]),
        })
      )
      .mutation(({ input }) => db.setSiteSetting(input.key, input.value)),
  }),

  leads: router({
    /**
     * Lead submission pipeline: store locally → push to Follow Up Boss →
     * record sync status. If FUB fails, the lead stays in the DB (fubStatus
     * "failed") and the owner is notified — no lead is ever lost.
     */
    submit: publicProcedure.input(leadInput).mutation(async ({ input }) => {
      const intent = computeIntent(input.answers);
      const leadId = await db.createLead({
        name: input.name,
        email: input.email,
        phone: input.phone,
        message: input.message,
        sourceTag: input.sourceTag,
        intent,
        answers: input.answers ? JSON.stringify(input.answers) : null,
        tcpaConsent: true,
        fubStatus: "pending",
        visitorId: input.visitorId || null,
      });

      const fub = await sendToFub({
        name: input.name,
        email: input.email,
        phone: input.phone,
        message: input.message,
        sourceTag: input.sourceTag,
        intent,
        answers: input.answers,
      });

      await db.updateLead(leadId, {
        fubStatus: fub.ok ? "synced" : "failed",
        fubId: fub.fubId,
      });

      // Cross-session activity: if this visitor has tracked on-site activity
      // (favorites, AI searches, quiz results), attach it as a formatted note
      // on the FUB contact. Fires only at the moment the visitor voluntarily
      // identifies themselves via this form — never before.
      if (input.visitorId) {
        try {
          const activity = await db.getVisitorActivity(input.visitorId);
          const note = buildActivityNote(activity);
          if (note) {
            if (fub.ok && fub.personId) {
              const sent = await sendFubNote(fub.personId, "Site activity before inquiry", note);
              if (!sent.ok) console.error("[activity] FUB note failed:", sent.error);
            }
            // Keep a local copy on the lead record either way so context is never lost.
            await db.updateLead(leadId, {
              message: [input.message, note].filter(Boolean).join("\n\n"),
            });
          }
        } catch (err) {
          console.error("[activity] attach failed:", err); // never block the lead
        }
      }

      if (!fub.ok) {
        // Graceful fallback: notify owner so no lead slips through
        notifyOwner({
          title: `New lead (FUB sync failed): ${input.name}`,
          content: `Source: ${input.sourceTag}\nEmail: ${input.email}\nPhone: ${input.phone ?? "—"}\nIntent: ${intent}\nError: ${fub.error ?? "unknown"}\nThe lead is saved in the admin Lead Log.`,
        }).catch(() => undefined);
      }

      return { success: true, intent } as const;
    }),
    list: adminProcedure.query(() => db.getLeads()),
  }),

  /**
   * Custom-website inquiry (web design services — NOT a real estate lead).
   * Pipeline: store locally → FUB contact tagged "Wants Us to Build Their
   * Website" → email copy to Peter. Confirmation is returned to the client;
   * no email-client dependency for the visitor.
   */
  websiteInquiry: router({
    submit: publicProcedure
      .input(
        z.object({
          name: z.string().trim().min(1).max(190),
          email: z.string().trim().email().max(320),
          phone: z.string().trim().min(7).max(40),
          business: z.string().trim().max(190).optional(),
          message: z.string().trim().min(1).max(3000),
          // Consent must be given, not assumed — this pipeline calls/texts the
          // phone number collected above, same as any other lead form.
          tcpaConsent: z.literal(true, { message: "TCPA consent is required" }),
        })
      )
      .mutation(async ({ input }) => {
        // Store locally first — never lose an inquiry (reuses leads table with
        // the distinct web-design source tag so it shows in the admin Lead Log).
        const leadId = await db.createLead({
          name: input.name,
          email: input.email,
          phone: input.phone,
          message: [input.business ? `Business: ${input.business}` : undefined, input.message]
            .filter(Boolean)
            .join("\n"),
          sourceTag: WEBSITE_INQUIRY_SOURCE,
          intent: "Unknown",
          answers: JSON.stringify({ inquiryType: "web design services", business: input.business ?? "" }),
          tcpaConsent: true,
          fubStatus: "pending",
          visitorId: null,
        });

        const fub = await sendWebsiteInquiryToFub(input);
        await db.updateLead(leadId, {
          fubStatus: fub.ok ? "synced" : "failed",
          fubId: fub.fubId,
        });

        // Email a copy to Peter — independent of FUB result so he always hears about it.
        const emailed = await emailWebsiteInquiryCopy(input).catch(() => ({ ok: false as const }));

        if (!fub.ok || !emailed.ok) {
          notifyOwner({
            title: `Custom Website Inquiry: ${input.name}`,
            content: `Tag: ${WEBSITE_INQUIRY_TAG}\nEmail: ${input.email}\nPhone: ${input.phone}\nBusiness: ${input.business ?? "—"}\nMessage: ${input.message}\nFUB sync: ${fub.ok ? "ok" : `FAILED (${fub.error ?? "unknown"})`}\nEmail copy to Peter: ${emailed.ok ? "sent" : "FAILED"}\nSaved in admin Lead Log.`,
          }).catch(() => undefined);
        }

        return { success: true } as const;
      }),
  }),

  activity: router({
    /**
     * Anonymous first-party activity logging. No personal info accepted here —
     * only the random visitor id and what happened on-site. Forwarded to FUB
     * only if the visitor later submits a lead form.
     */
    log: publicProcedure
      .input(
        z.object({
          visitorId: z.string().min(6).max(40),
          kind: z.enum(["favorite", "unfavorite", "ai_search", "convince_quiz", "city_finder"]),
          data: z.record(z.string(), z.unknown()),
        })
      )
      .mutation(async ({ input }) => {
        await db.logVisitorActivity({
          visitorId: input.visitorId,
          kind: input.kind,
          data: JSON.stringify(input.data).slice(0, 4000),
        });
        return { ok: true } as const;
      }),
  }),

  /**
   * First-party site analytics. Privacy-simple: only a normalized path, the
   * anonymous localStorage visitor id, event kind, and timestamp are stored.
   * No IPs, no user agents, no fingerprinting, no third-party services.
   */
  analytics: router({
    /** Public: record a page view, banner click, NC/lease outbound click, or /links form submission. */
    track: publicProcedure
      .input(
        z.object({
          kind: z.enum(["view", "banner_click", "nc_click", "lease_click", "links_form", "city_finder_generate"]),
          path: z
            .string()
            .min(1)
            .max(190)
            .regex(/^\//, "path must start with /"),
          visitorId: z.string().max(40).optional(),
          /** Session traffic source: utm_source, referrer domain, or "direct". */
          source: z.string().max(120).optional(),
          utmMedium: z.string().max(120).optional(),
          utmCampaign: z.string().max(190).optional(),
        })
      )
      .mutation(async ({ input }) => {
        // Normalize: strip query/hash, collapse trailing slash (except root)
        let path = input.path.split(/[?#]/)[0] || "/";
        if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
        // Never track the admin area itself
        if (path.startsWith("/admin")) return { ok: true } as const;
        // Exclude Manus preview-iframe traffic (manus.im referrer) so agent
        // verification sessions and the Management UI preview never count.
        const src = (input.source ?? "").toLowerCase();
        if (src.includes("manus.im") || src.includes("manus.computer") || src.includes("manus-analytics")) {
          return { ok: true } as const;
        }
        await db.logPageEvent({
          kind: input.kind,
          path,
          visitorId: input.visitorId ?? "",
          source: src.slice(0, 120),
          utmMedium: (input.utmMedium ?? "").toLowerCase().slice(0, 120),
          utmCampaign: (input.utmCampaign ?? "").slice(0, 190),
        });
        return { ok: true } as const;
      }),
    /** Admin: aggregated traffic summary for the dashboard. */
    summary: adminProcedure
      .input(z.object({ days: z.number().int().min(1).max(365).default(30) }).optional())
      .query(({ input }) => db.getAnalyticsSummary(input?.days ?? 30)),
  }),
});

export type AppRouter = typeof appRouter;
