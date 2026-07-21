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
  fallbackPitch,
  generatePitch,
  matchCity,
  pickStats,
} from "./partnerPitch";

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
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
  phone: z.string().max(40).optional(),
  message: z.string().max(5000).optional(),
  sourceTag: z.string().min(1).max(190),
  answers: z.record(z.string(), z.unknown()).optional(),
  tcpaConsent: z.literal(true, { message: "TCPA consent is required" }),
  /** Anonymous first-party visitor id — links pre-inquiry site activity. */
  visitorId: z.string().max(40).optional(),
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
        })
      )
      .mutation(async ({ input }) => {
        const partnerName = input.partnerName?.split(/\s+/)[0] || undefined; // first name only
        const city = matchCity(input.selections);
        const stats = pickStats(input.selections, city);
        let pitch: string;
        let aiGenerated = true;
        try {
          pitch = await generatePitch({ selections: input.selections, partnerName, city });
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
          selections: JSON.stringify(input.selections),
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
        return {
          slug: row.slug,
          city: row.city,
          pitch: row.pitch,
          stats: JSON.parse(row.stats) as string[],
          partnerName: row.partnerName ?? undefined,
          selections: JSON.parse(row.selections) as string[],
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
});

export type AppRouter = typeof appRouter;
