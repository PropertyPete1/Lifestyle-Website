import type { Request, Response } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { dealCommunities, dealHomes } from "../drizzle/schema";
import { DEALS_DETAILS_CONSENT_TEXT, normalizeUsPhone, sanitizeSourceCode } from "../shared/deals";
import { getDb } from "./db";

/**
 * Oct 31, 2026 (Peter: "yes just get name number email required fields and notes if they wanna add notes and done").
 *
 * "Get this home's details" on the public Builder Deals pages asks for name, mobile, email and optional notes, and the
 * request goes straight to Follow Up Boss (no text code): the week's visitors were typing their number and leaving at
 * the code step, so none of them ever reached an agent. The address, builder and community still never show on the
 * page: the agent sends them. Inside FUB (agents only) the note names the exact home so the agent can reply at once.
 */
export const DETAILS_REQUEST_SOURCE_TAG = "Builder Deals - Home Details";

/** The same consent the sign-up uses, for this button. */
export const DETAILS_CONSENT_TEXT = DEALS_DETAILS_CONSENT_TEXT;

export const detailsRequestInput = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(190),
  phone: z.string().trim().min(7, "Enter your mobile number.").max(40),
  email: z.string().trim().email("Enter a valid email.").max(320),
  notes: z.string().trim().max(1000).optional(),
  /** What the visitor was looking at: public figures only (the opaque landing key, area, price band facts). */
  home: z.object({
    key: z.string().regex(/^[a-f0-9]{12}$/).optional(),
    area: z.string().trim().max(120).optional(),
    price: z.number().int().positive().max(50_000_000).nullable().optional(),
    beds: z.union([z.string().max(30), z.number()]).nullable().optional(),
    sqft: z.number().int().positive().max(100_000).nullable().optional(),
    kind: z.string().max(40).optional(),
  }).optional(),
  src: z.string().trim().max(40).optional(),
  /** The agent page (/deals/u/<name>) this visitor came through, when the page knows it. */
  a: z.string().trim().max(80).optional(),
  consent: z.literal(true, { message: "Please agree to be contacted." }),
});
export type DetailsRequestInput = z.infer<typeof detailsRequestInput>;
export type DetailsHome = NonNullable<DetailsRequestInput["home"]>;

const money = (value: number) => `$${value.toLocaleString("en-US")}`;

/** The home as the visitor saw it: "3 beds · 1,800 sq ft · $329,990 · Move-in ready · East San Antonio". */
export function publicHomeLine(home: DetailsHome | undefined): string | null {
  if (!home) return null;
  const beds = home.beds !== null && home.beds !== undefined && String(home.beds).trim() ? `${home.beds} beds` : null;
  const parts = [beds, home.sqft ? `${home.sqft.toLocaleString("en-US")} sq ft` : null, home.price ? money(home.price) : null, home.kind === "to_be_built" ? "To be built" : home.kind === "quick_move_in" ? "Move-in ready" : null, home.area ?? null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * The exact home behind a public card, for the agent's FUB note only: the community (builder + name) from the opaque
 * landing key, and the available home with that price (and size, when known). Null when it can't be told apart.
 */
export async function privateHomeLine(home: DetailsHome | undefined, lookupCommunity: (key: string) => Promise<number | null>): Promise<string | null> {
  if (!home?.key) return null;
  const communityId = await lookupCommunity(home.key);
  if (!communityId) return null;
  const db = await getDb();
  if (!db) return null;
  const community = (await db.select({ builder: dealCommunities.builder, name: dealCommunities.privateName }).from(dealCommunities).where(eq(dealCommunities.id, communityId)).limit(1))[0];
  if (!community) return null;
  const where = `${community.name} by ${community.builder}`;
  if (!home.price) return `Community: ${where}`;
  const homes = await db.select({ address: dealHomes.privateAddress, plan: dealHomes.privatePlanName, sqft: dealHomes.sqft }).from(dealHomes)
    .where(and(eq(dealHomes.communityId, communityId), eq(dealHomes.status, "available"), eq(dealHomes.price, home.price)));
  const matches = home.sqft ? homes.filter((row) => row.sqft === home.sqft) : homes;
  const pick = matches.length === 1 ? matches[0] : homes.length === 1 ? homes[0] : null;
  if (!pick) return `Community: ${where} (${homes.length || "no"} available home${homes.length === 1 ? "" : "s"} at ${money(home.price)})`;
  return `Home: ${[pick.address, pick.plan ? `${pick.plan} plan` : null].filter(Boolean).join(", ") || "address not on file"} in ${where}`;
}

/** The note on the FUB event: what they asked for, which home, their notes, where they came from, and the consent record. */
export function detailsRequestNote(input: { publicLine: string | null; privateLine: string | null; notes?: string | null; agentName?: string | null; sourceCode: string; consentAt: Date; ip: string; isTest: boolean }): string {
  return [
    "Builder Deals: asked for this home's details (no text code). Text them the address, builder and community.",
    input.publicLine ? `Card they tapped: ${input.publicLine}` : "Card they tapped: not specified (ask which home)",
    input.privateLine ?? undefined,
    input.notes?.trim() ? `Their notes: ${input.notes.trim()}` : undefined,
    input.agentName ? `Came through ${input.agentName}'s Builder Deals link.` : undefined,
    `Source: ${input.sourceCode}`,
    input.isTest ? "TEST RECORD (team or test number)" : undefined,
    `TCPA consent captured: ${input.consentAt.toISOString()}`,
    `Consent IP: ${input.ip}`,
    `Consent text: ${DETAILS_CONSENT_TEXT}`,
  ].filter(Boolean).join("\n");
}

export type DetailsRequestResult = { ok: true; firstName: string } | { ok: false; kind: "invalid_phone" | "outside_us" | "rate_limited" | "blocked"; message: string };

/** Submits one request: checks, records it in the site's Lead Log, sends it to FUB, and tells Peter. */
export async function submitDetailsRequest(input: DetailsRequestInput, req: Request, res: Response): Promise<DetailsRequestResult> {
  const service = await import("./dealsService");
  const settings = await service.getDealSettings();
  const { deviceHash } = service.ensureDealsCookies(req, res);
  const ip = service.realClientIp(req);
  const sourceCode = service.currentDealSource(sanitizeSourceCode(input.src), settings);
  if ((await service.rateLimitCount("details_request", new Date(Date.now() - 60 * 60_000), { ip })) >= settings.ipLimitPerHour) {
    return { ok: false, kind: "rate_limited", message: `We're getting a lot of requests, so please try again in a bit. Or text ${settings.commentKeyword} to ${settings.textLine}.` };
  }
  const normalized = normalizeUsPhone(input.phone, { allowCanada: settings.allowCanada });
  if (!normalized.ok) {
    return normalized.reason === "outside_us"
      ? { ok: false, kind: "outside_us", message: `US mobile numbers only for now. Text ${settings.commentKeyword} to ${settings.textLine} and we'll help you directly.` }
      : { ok: false, kind: "invalid_phone", message: "Enter a valid mobile number." };
  }
  const phone = normalized.e164;
  const email = input.email.trim().toLowerCase();
  await service.logDealEvent({ kind: "details_request", sourceCode, deviceHash, ip, phone });
  if (await service.getActiveBlock({ phone, email, deviceHash })) return { ok: false, kind: "blocked", message: service.safeBlockedMessage(settings) };

  const { agentForPageSlug, agentPageSlugFromRequest, AGENT_PAGE_SOURCE } = await import("./dealsAgentPages");
  const slug = agentPageSlugFromRequest(req, input.a);
  const agent = slug ? await agentForPageSlug(slug) : null;
  const isTest = settings.testNumbers.includes(phone) || await service.isTeamPhone(phone);
  const consentAt = new Date();
  const publicLine = publicHomeLine(input.home);
  const privateLine = await privateHomeLine(input.home, service.landingCommunityId).catch(() => null);
  const note = detailsRequestNote({ publicLine, privateLine, notes: input.notes, agentName: agent?.name ?? null, sourceCode: agent ? AGENT_PAGE_SOURCE : sourceCode, consentAt, ip, isTest });

  const db = await import("./db");
  const leadId = await db.createLead({
    name: input.name.trim(), email, phone, message: [publicLine ? `Home: ${publicLine}` : null, input.notes?.trim() ? `Notes: ${input.notes.trim()}` : null].filter(Boolean).join("\n") || null,
    sourceTag: DETAILS_REQUEST_SOURCE_TAG, intent: "Hot", answers: input.home ? JSON.stringify(input.home) : null, tcpaConsent: true, fubStatus: "pending", visitorId: null,
  });
  const { sendBuilderDealsDetailsRequestToFub } = await import("./dealsFub");
  const fub = await sendBuilderDealsDetailsRequestToFub({ name: input.name, phone, email, note, agent: agent ? { name: agent.name, fubUserId: agent.fubUserId, email: agent.email } : null, isTest });
  await db.updateLead(leadId, { fubStatus: fub.ok ? "synced" : "failed", fubId: fub.ok ? fub.personId : undefined });
  if (!isTest) {
    const { notifyOwner } = await import("./_core/notification");
    notifyOwner({
      title: `Builder Deals: ${input.name.trim()} wants a home's details${fub.ok ? "" : " (FUB sync failed)"}`,
      content: [publicLine ? `Home: ${publicLine}` : "Home: not specified", privateLine, `Phone: ${phone}`, `Email: ${email}`, input.notes?.trim() ? `Notes: ${input.notes.trim()}` : null, agent ? `Agent link: ${agent.name}` : null, fub.ok ? "In Follow Up Boss now." : `FUB error: ${fub.error}. Saved in the admin Lead Log.`].filter(Boolean).join("\n"),
    }).catch(() => undefined);
  }
  return { ok: true, firstName: input.name.trim().split(/\s+/)[0] ?? "" };
}
