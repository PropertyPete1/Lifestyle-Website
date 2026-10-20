import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isAdminEmail } from "../shared/site";
import { DEALS_CONSENT_TEXT, hasPrivateTerm, maskPhone, normalizeUsPhone, parseDealScrubConfig, sanitizeInstagramHandle, sanitizeSourceCode } from "../shared/deals";
import { ENV } from "./_core/env";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { dealFubRecords, dealAccessTokens, dealAlerts, dealBlocklist, dealClientLinks, dealCommunities, dealCommunityViews, dealDoNotAutoImport, dealEmailLogs, dealEvents, dealFubJobs, dealHomes, dealIncentives, dealKnownAgents, dealLeads, dealPhotos, dealTeamAllowlist, dealTourRequests, dealTrecImports } from "../drizzle/schema";
import { sendTwilioVerify } from "./dealsVerification";
import { and, desc, eq, gte, inArray, isNotNull, isNull, like, or, sql } from "drizzle-orm";
import { OFFICIAL_BUILDER_HOSTS, officialHostFor } from "./dealsAdapters";
import { type DealsAdminError, acceptIncentiveHold, dismissCatalogHold, dismissIncentiveHold, listCommunityDiagnostics, refreshCommunityGeography, refreshCommunityInBackground, saveIncentiveForCommunity, storedScrubListForCommunity, testCommunitySource } from "./dealsSyncAdmin";
import { type PhotoAdminError, getBuilderPhotoSettingsForAdmin, getDealPhotoPreview, listBuilderPhotoSamples, reprocessBuilderPhotos, saveBuilderPhotoSettings, uploadManualHomePhoto } from "./dealsPhotosAdmin";
import { parseStoredScrubList } from "./dealsScrub";
import {
  catalogViewForSession,
  chicagoDayStart,
  hashSecret,
  randomOpaqueToken,
  currentPending,
  currentDealSource,
  dealsPublicHeaders,
  gatedDealsCatalog,
  getDealSettings,
  isLiveDealSession,
  leadPresentation,
  logDealEvent,
  publicDealsCatalog,
  recordGateFocus,
  recordTwilioVerifyFailure,
  recordTwilioVerifyOutcome,
  removePending,
  reserveGateSubmit,
  reserveVerificationAttempt,
  ensureDealsCookies,
  safeBlockedMessage,
  savedDealCards,
  showGoogleDealsButton,
  createPendingVerification,
} from "./dealsService";
import { agentDisplayPhone, agentWorkspace, attachLiveSessionToClientLink, clientLinkTokenForLead, connectOfferFor, createClientLink, presentClientLink, recordClientLinkOpen, resolveClientLink, revokeClientLink } from "./dealsClientLinks";
import { AGENT_CLIENT_SOURCE, staleSessionLeadId } from "./dealsService";

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  const allowlisted = isAdminEmail(ctx.user.email) || ctx.user.openId === ENV.ownerOpenId;
  if (ctx.user.role !== "admin" || !allowlisted) throw new TRPCError({ code: "FORBIDDEN" });
  return next();
});

type AdminIdentity = { phoneE164?: string | null; email?: string | null; deviceHash?: string | null };
type AdminDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** All admin writes use the same canonical identity as the buyer gate; pass the system's allowCanada setting when re-normalising a stored number. */
export function normalizeAdminDealIdentity(input: AdminIdentity, options: { allowCanada?: boolean } = {}): AdminIdentity {
  const rawPhone = input.phoneE164?.trim();
  const parsed = rawPhone ? normalizeUsPhone(rawPhone, { allowCanada: options.allowCanada ?? false }) : null;
  if (parsed && !parsed.ok) throw new TRPCError({ code: "BAD_REQUEST", message: options.allowCanada ? "Enter a valid US or Canadian phone number." : "Enter a valid US phone number." });
  const email = input.email?.trim().toLowerCase() || null;
  if (email && !z.string().email().safeParse(email).success) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a valid email address." });
  const deviceHash = input.deviceHash?.trim() || null;
  if (deviceHash && !/^[a-f0-9]{64}$/i.test(deviceHash)) throw new TRPCError({ code: "BAD_REQUEST", message: "Device identifiers must be a 64-character hash." });
  const identity = { phoneE164: parsed?.ok ? parsed.e164 : null, email, deviceHash };
  if (!identity.phoneE164 && !identity.email && !identity.deviceHash) throw new TRPCError({ code: "BAD_REQUEST", message: "A phone, email, or device identifier is required." });
  return identity;
}

/**
 * Official communities must point at the adapter's exact www host over plain
 * HTTPS; a Manual community may use any HTTPS page except a host an adapter
 * would fetch (a Manual row must never masquerade as an official source).
 */
export function validateAdminCommunityUrl(builder: string, raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a complete HTTPS community URL." }); }
  const host = officialHostFor(builder);
  const hostname = url.hostname.toLowerCase();
  const fetchedHosts = Object.values(OFFICIAL_BUILDER_HOSTS);
  const wrongHost = host ? hostname !== host : fetchedHosts.includes(hostname) || fetchedHosts.some((value) => hostname === value.replace(/^www\./, ""));
  if (url.protocol !== "https:" || url.username || url.password || url.port || wrongHost) {
    throw new TRPCError({ code: "BAD_REQUEST", message: host ? `Use the selected builder's official HTTPS community URL on https://${host}/.` : "Manual communities need an HTTPS page that is not an adapter's official builder host." });
  }
  return url.toString();
}

const PHOTO_ADMIN_TRPC_CODES: Record<PhotoAdminError["code"], TRPCError["code"]> = {
  home_not_found: "NOT_FOUND", photo_not_found: "NOT_FOUND",
  invalid_region: "BAD_REQUEST", invalid_keywords: "BAD_REQUEST", invalid_upload: "BAD_REQUEST", upload_too_large: "BAD_REQUEST", builder_required: "BAD_REQUEST",
  database_unavailable: "INTERNAL_SERVER_ERROR", storage_unavailable: "INTERNAL_SERVER_ERROR", no_stored_image: "INTERNAL_SERVER_ERROR",
};
const DEALS_ADMIN_TRPC_CODES = new Set<string>(["BAD_REQUEST", "NOT_FOUND", "CONFLICT", "PRECONDITION_FAILED", "INTERNAL_SERVER_ERROR"]);

/** DealsAdminError carries a tRPC code; PhotoAdminError codes map one-to-one onto tRPC codes. Matched on the `code` shape (the two code sets are disjoint). */
export function adminErrorToTrpc(error: unknown): TRPCError {
  if (error instanceof TRPCError) return error;
  const code = error instanceof Error ? (error as { code?: unknown }).code : undefined;
  const message = error instanceof Error && error.message ? error.message : "The admin operation failed.";
  if (typeof code === "string") {
    if (code in PHOTO_ADMIN_TRPC_CODES) return new TRPCError({ code: PHOTO_ADMIN_TRPC_CODES[code as PhotoAdminError["code"]], message });
    if (DEALS_ADMIN_TRPC_CODES.has(code)) return new TRPCError({ code: code as DealsAdminError["code"], message });
  }
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
}

async function adminCall<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) { throw adminErrorToTrpc(error); }
}

/** Requeue kicks never block or fail the admin response. */
function kickPhotoQueue(limit: number) {
  void import("./dealsPhotos").then(({ processPendingDealPhotos }) => processPendingDealPhotos(limit)).catch(() => undefined);
}

function adminIdentityWhere(table: typeof dealBlocklist | typeof dealKnownAgents | typeof dealTeamAllowlist, identity: AdminIdentity) {
  return or(...[
    identity.phoneE164 ? eq(table.phoneE164, identity.phoneE164) : undefined,
    identity.email ? eq(table.email, identity.email) : undefined,
    "deviceHash" in table && identity.deviceHash ? eq(table.deviceHash, identity.deviceHash) : undefined,
  ].filter((value) => value !== undefined));
}

async function adminClearAgentClassification(db: AdminDb, identity: AdminIdentity) {
  const blockWhere = adminIdentityWhere(dealBlocklist, identity);
  const knownWhere = adminIdentityWhere(dealKnownAgents, identity);
  if (blockWhere) await db.delete(dealBlocklist).where(blockWhere);
  if (knownWhere) await db.delete(dealKnownAgents).where(knownWhere);
  for (const [kind, value] of [["phone", identity.phoneE164], ["email", identity.email]] as const) {
    if (value) await db.insert(dealDoNotAutoImport).values({ kind, value }).onDuplicateKeyUpdate({ set: { kind, value } });
  }
}

/** Cleanup is constrained to the unblocked value, never other values on a linked contact. */
async function adminCleanupFubClassification(identity: AdminIdentity, personIds: string[]) {
  const key = process.env.FUB_API_KEY;
  if (!key || !personIds.length) return { state: "not_configured_or_no_contact" as const };
  const db = await getDb();
  if (!db) return { state: "failed" as const };
  const { fubHeaders } = await import("./fub");
  const managedTags = new Set(["IG Builder Deals", "Agent - Blocked", "Agent - FUB Match", "Possible Agent - Email Domain", "Possible Agent - TREC Name Match", "Possible Agent - Handle", "Intent - Hot", "Intent - Warm", "Intent - Cold"]);
  let cleaned = 0;
  for (const personId of Array.from(new Set(personIds))) {
    const url = `https://api.followupboss.com/v1/people/${encodeURIComponent(personId)}`;
    const response = await fetch(url, { headers: fubHeaders(key), signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error("FUB contact cleanup unavailable");
    const person = await response.json() as { phones?: Array<{ value?: string }>; emails?: Array<{ value?: string }>; tags?: string[] };
    const ownsPhone = Boolean(identity.phoneE164 && person.phones?.some((field) => {
      const parsed = normalizeUsPhone(field.value ?? "");
      return parsed.ok && parsed.e164 === identity.phoneE164;
    }));
    const ownsEmail = Boolean(identity.email && person.emails?.some((field) => field.value?.trim().toLowerCase() === identity.email));
    if (!ownsPhone && !ownsEmail) continue;
    // Unknown tag representations fail closed rather than replacing a contact’s tags.
    if (!Array.isArray(person.tags) || person.tags.some((tag) => typeof tag !== "string")) throw new Error("FUB tag representation unavailable");
    const result = await fetch(url, { method: "PUT", headers: fubHeaders(key), body: JSON.stringify({ tags: person.tags.filter((tag) => !managedTags.has(tag)), mergeTags: false }), signal: AbortSignal.timeout(30_000) });
    if (!result.ok) throw new Error("FUB classification tag cleanup failed");
    const leads = await db.select({ id: dealLeads.id }).from(dealLeads).where(eq(dealLeads.fubPersonId, personId));
    if (leads.length) {
      const notes = await db.select().from(dealFubRecords).where(and(inArray(dealFubRecords.leadId, leads.map((lead) => lead.id)), eq(dealFubRecords.kind, "note"), eq(dealFubRecords.createdByUs, true), isNull(dealFubRecords.cleanedAt)));
      const { cleanupBuilderDealsFubRecord } = await import("./dealsFub");
      for (const note of notes) {
        const result = await cleanupBuilderDealsFubRecord("note", note.fubId);
        await db.update(dealFubRecords).set(result.ok ? { cleanedAt: new Date(), lastCleanupError: null } : { lastCleanupError: result.error }).where(eq(dealFubRecords.id, note.id));
      }
    }
    cleaned++;
  }
  return { state: "complete" as const, cleaned };
}

const scrubTerm = z.string().trim().min(1).max(190);
/** A flat list (legacy, lands in "other") or one list per category. */
const scrubListInput = z.union([
  z.array(scrubTerm).max(500),
  z.object({ builder: z.array(scrubTerm).max(100), lender: z.array(scrubTerm).max(100), community: z.array(scrubTerm).max(100), plan: z.array(scrubTerm).max(200), street: z.array(scrubTerm).max(200), other: z.array(scrubTerm).max(200) }).partial(),
]);
const communityInput = z.object({
  id: z.number().int().positive().optional(), builder: z.enum(["Chesmar", "M/I Homes", "Perry Homes", "D.R. Horton", "Pulte", "Centex", "Del Webb", "First America Homes", "Coventry Homes", "Davidson Homes", "Highland Homes", "Century Communities", "KB Home", "Toll Brothers", "David Weekley Homes", "Ashton Woods", "LGI Homes", "Sitterle Homes", "Scott Felder Homes", "DRB Homes", "Starlight Homes", "Legend Homes", "Drees Custom Homes", "View Homes", "Texas Homes", "Hakes Brothers", "Manual"]), privateName: z.string().trim().min(2).max(190),
  sourceUrl: z.string().url(), publicLabel: z.string().trim().min(2).max(190), areaLabel: z.string().trim().min(2).max(120),
  privateAddress: z.string().trim().max(255).default(""), salesPhone: z.string().max(60).nullable().optional(), reelUrl: z.string().url().nullable().optional(),
  reelCode: z.string().trim().regex(/^[a-z0-9_-]{1,40}$/), scrubList: scrubListInput.optional(),
  /** True: the submitted plan and street lists replace the discovered ones instead of extending them. */
  replaceDiscovered: z.boolean().optional(),
  /** False positives (a page heading, an everyday word) that the scrubber and residue checks ignore; omitted keeps the stored list. */
  excludedTerms: z.array(scrubTerm).max(200).optional(),
});
const manualHomeInput = z.object({
  id: z.number().int().positive().optional(), communityId: z.number().int().positive(), sourceUrl: z.string().url().optional(),
  privateAddress: z.string().trim().max(255).optional(), privatePlanName: z.string().trim().max(190).optional(), kind: z.enum(["quick_move_in", "to_be_built"]),
  status: z.enum(["available", "sold", "hidden"]).default("available"), beds: z.string().max(30).optional(), baths: z.string().max(30).optional(),
  sqft: z.number().int().min(0).max(2_147_483_647).optional(), price: z.number().int().min(0).max(2_147_483_647).optional(),
  moveInDate: z.string().max(100).optional(), lotSize: z.string().max(100).optional(),
});
const adminDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const incentiveFields = {
  headlineRate: z.string().max(80).nullable().optional(), followOnRate: z.string().max(80).nullable().optional(), followOnPeriod: z.string().max(100).nullable().optional(),
  apr: z.string().max(80).nullable().optional(), loanType: z.string().max(80).nullable().optional(), downPayment: z.string().max(80).nullable().optional(), repaymentTerms: z.string().max(120).nullable().optional(),
};
const incentiveInput = z.object({
  id: z.number().int().positive().optional(), communityId: z.number().int().positive(), publicText: z.string().trim().min(2).max(20_000), manual: z.boolean(),
  contractBy: adminDay.nullable().optional(), closeBy: adminDay.nullable().optional(),
  ...incentiveFields,
});
/** "Accept this update": every field the hold reasons require, plus the "no contract deadline in the text" tick. */
const acceptHoldInput = z.object({
  id: z.number().int().positive(), contractBy: adminDay.nullable().optional(), closeBy: adminDay.nullable().optional(), noContractDeadline: z.boolean().optional(),
  publicText: z.string().trim().max(20_000).nullable().optional(), ...incentiveFields,
});
const photoRegionInput = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });

const clientLinkToken = z.string().trim().max(80).optional();
const gateInput = z.object({
  phone: z.string().trim().min(1).max(60),
  choice: z.enum(["buyer", "has_agent"]),
  src: z.string().max(120).optional(),
  ig: z.string().max(160).optional(),
  /** An LDR agent's client link token (?c=); the agent question is skipped for it. */
  c: clientLinkToken,
});
/**
 * A client link as the gate shows it: the agent's name and the client's first
 * name only, never the phone the agent typed. A team member's own look at the
 * page is not counted as the client opening it.
 */
async function clientLinkPresentation(token: string | undefined, viewerIsTeam: boolean) {
  const shown = await presentClientLink(token);
  if (shown?.state === "live" && !viewerIsTeam) {
    const resolved = await resolveClientLink(token);
    if (resolved) void recordClientLinkOpen(resolved.link.id).catch(() => undefined);
  }
  return shown;
}
/** This browser's lapsed session, if any, and the client link behind it; never fails the state query. */
async function lapsedSession(req: Parameters<typeof staleSessionLeadId>[0]) {
  try {
    const leadId = await staleSessionLeadId(req);
    if (!leadId) return null;
    const db = await getDb();
    const lead = db ? (await db.select({ status: dealLeads.status }).from(dealLeads).where(eq(dealLeads.id, leadId)).limit(1))[0] : undefined;
    if (!lead || lead.status === "team") return null;
    return { token: await clientLinkTokenForLead(leadId) };
  } catch { return null; }
}

/** An agent's client is never told the page is for buyers without an agent. */
function linkClientBlockedMessage(agentName: string | null | undefined, textLine: string) {
  return `This number can't open the list right now. Text ${agentName ?? "your agent"}, or text ${textLine}.`;
}

/** What an agent's client is told when the gate cannot open their link. */
function clientLinkRefusal(kind: "link_other_phone" | "link_dead", agentName: string | null, textLine: string) {
  const who = agentName ?? "your agent";
  return kind === "link_other_phone"
    ? `This link was sent for a different mobile number. Ask ${who} to send a new link to this number, or text ${textLine}.`
    : `This link has expired or was turned off. Ask ${who} for a new one, or text ${textLine}.`;
}

/** A test-team number previews the team view but has no team row to own links. */
function settings_testTeamNote(phone: string, settings: { testTeamNumbers: string[] }) {
  return settings.testTeamNumbers.includes(phone)
    ? "This is a test team number: it previews the team list but cannot create client links. Add a real team member in Admin, Builder Deals, Team allowlist."
    : "Your number is not on the team list yet. Ask Peter to add it in Admin, Builder Deals.";
}

export const dealsRouter = router({
  /** Every community's public card; the one whose reel brought the visitor (`src`) comes first. */
  publicCatalog: publicProcedure.input(z.object({ src: z.string().trim().max(40).optional() }).optional()).query(async ({ input, ctx }) => {
    dealsPublicHeaders(ctx.res);
    return publicDealsCatalog(input?.src);
  }),
  /** Best Deals on the landing page: public labels, prices and payments only, no card handles or names. */
  featured: publicProcedure.query(async ({ ctx }) => {
    dealsPublicHeaders(ctx.res);
    const { featuredDeals } = await import("./dealsFeatured");
    return featuredDeals("public");
  }),
  state: publicProcedure.input(z.object({ c: clientLinkToken }).optional()).query(async ({ input, ctx }) => {
    dealsPublicHeaders(ctx.res);
    const [settings, session, pending] = await Promise.all([getDealSettings(), isLiveDealSession(ctx.req), currentPending(ctx.req)]);
    // An agent's client whose access lapsed keeps their agent's link on the bare
    // landing page too (a new tab, a bookmark): this browser's lapsed session
    // names the link. Only a live link is used, so a dead one never traps them.
    const lapsed = !input?.c && !session ? await lapsedSession(ctx.req) : null;
    const remembered = lapsed?.token ?? null;
    const rememberedLive = remembered ? (await presentClientLink(remembered))?.state === "live" : false;
    const token = input?.c ?? (rememberedLive ? remembered! : undefined);
    const clientLink = await clientLinkPresentation(token, session?.lead.status === "team");
    // A buyer with a live list: their own link goes straight to the list, another number's link is not offered.
    const connectOffer = session && session.lead.status !== "team" && clientLink?.state === "live" && token ? await connectOfferFor(session.lead, token) : null;
    return {
      session: session ? leadPresentation(session.lead) : null,
      pending: pending ? { displayPhone: maskPhone(pending.phoneE164), expiresAt: pending.expiresAt.toISOString() } : null,
      googleEnabled: showGoogleDealsButton(ctx.req),
      consentText: DEALS_CONSENT_TEXT,
      commentKeyword: settings.commentKeyword,
      textLine: settings.textLine,
      blockedMessage: clientLink ? linkClientBlockedMessage(clientLink.agentName, settings.textLine) : safeBlockedMessage(settings),
      clientLink,
      /** The link found from this browser's lapsed session, for the gate to post with the code. */
      clientLinkToken: rememberedLive ? remembered : null,
      /** A reel buyer whose list lapsed (no live agent link behind it): the landing shows the expired screen, not the gate. */
      lapsed: Boolean(lapsed) && !rememberedLive,
      connectOffer,
    };
  }),
  start: publicProcedure.input(gateInput).mutation(async ({ input, ctx }) => {
    dealsPublicHeaders(ctx.res);
    const settings = await getDealSettings();
    const cookieState = ensureDealsCookies(ctx.req, ctx.res);
    const sourceCode = input.c ? AGENT_CLIENT_SOURCE : currentDealSource(sanitizeSourceCode(input.src), settings);
    const ip = ctx.req.ip || ctx.req.socket.remoteAddress || "0.0.0.0";
    if (!cookieState.hasProbe || !(await reserveGateSubmit({ ip, deviceHash: cookieState.deviceHash, sourceCode }))) {
      return { ok: false as const, kind: cookieState.hasProbe ? "rate_limited" : "cookie_blocked", message: cookieState.hasProbe ? `We're getting a lot of traffic, so please try again in a bit. Or text ${settings.commentKeyword} to ${settings.textLine}.` : `Your browser is blocking cookies. Open this link in Safari or Chrome. Or text ${settings.commentKeyword} to ${settings.textLine}.` };
    }
    const result = await createPendingVerification({ req: ctx.req, res: ctx.res, rawPhone: input.phone, choice: input.choice, source: sanitizeSourceCode(input.src), ig: sanitizeInstagramHandle(input.ig), clientLinkToken: input.c });
    if (!result.ok) {
      const settings = await getDealSettings();
      if (result.kind === "link_other_phone" || result.kind === "link_dead") return { ok: false as const, kind: result.kind, message: clientLinkRefusal(result.kind, "agentName" in result ? result.agentName ?? null : null, settings.textLine) };
      if ((result.kind === "has_agent" || result.kind === "blocked") && input.c) {
        // An agent's client is never told the page is for buyers without an agent.
        const shown = await presentClientLink(input.c);
        return { ok: false as const, kind: "blocked", message: linkClientBlockedMessage(shown?.agentName, settings.textLine) };
      }
      if (result.kind === "has_agent" || result.kind === "blocked") return { ok: false as const, kind: "blocked", message: safeBlockedMessage(settings) };
      if (result.kind === "cookie_blocked") return { ok: false as const, kind: "cookie_blocked", message: `Your browser is blocking cookies. Open this link in Safari or Chrome. Or text ${settings.commentKeyword} to ${settings.textLine}.` };
      if (result.kind === "outside_us") return { ok: false as const, kind: "outside_us", message: `US mobile numbers only for now. Outside the US? Text ${settings.commentKeyword} to ${settings.textLine} and we'll help you directly.` };
      if (result.kind === "rate_limited") return { ok: false as const, kind: "rate_limited", message: `We're getting a lot of traffic, so please try again in a bit. Or text ${settings.commentKeyword} to ${settings.textLine}.` };
      return { ok: false as const, kind: "invalid_phone", message: "Enter a valid mobile number." };
    }
    const reserved = await reserveVerificationAttempt({
      phone: result.phone, sourceCode: result.sourceCode, deviceHash: result.deviceHash,
      ip: result.ip, channel: "sms", isTest: result.isTest,
    });
    if (!reserved.ok) {
      await removePending(ctx.req, ctx.res);
      return { ok: false as const, kind: reserved.kind, message: `We're getting a lot of traffic, so please try again in a bit. Or text ${result.settings.commentKeyword} to ${result.settings.textLine}.` };
    }
    if (result.isTest && result.settings.skipTwilioForTestNumbers) return { ok: true as const, status: "code_sent", displayPhone: result.displayPhone, test: true };
    const sent = await sendTwilioVerify(result.phone, "sms");
    if (!sent.ok) {
      if (sent.reason === "twilio") await recordTwilioVerifyFailure({ sourceCode: result.sourceCode, deviceHash: result.deviceHash, ip: result.ip });
      if (sent.reason === "cannot_receive") {
        // A landline or STOP refusal is a terminal outcome, not an account error. The
        // pending row is KEPT so the code step can offer "Call me" (voice) and
        // "Wrong number? Change it"; removing it would strand the visitor on the gate.
        await recordTwilioVerifyOutcome({ sourceCode: result.sourceCode, deviceHash: result.deviceHash, ip: result.ip, phone: result.phone, outcome: "rejected" });
        return { ok: false as const, kind: "cannot_receive" as const, message: "That number can't receive texts. Try a mobile number or tap Call me.", displayPhone: result.displayPhone };
      }
      await removePending(ctx.req, ctx.res);
      // Twilio 60203 (max send attempts for this number) is a limit, not an account error.
      if (sent.reason === "rate_limited") return { ok: false as const, kind: "rate_limited" as const, message: `We're getting a lot of traffic, so please try again in a bit. Or text ${result.settings.commentKeyword} to ${result.settings.textLine}.` };
      return { ok: false as const, kind: sent.reason, message: "We couldn't send a code right now. Please try again." };
    }
    await logDealEvent({ kind: "twilio_verify_success", sourceCode: result.sourceCode, deviceHash: result.deviceHash, ip: result.ip, phone: result.phone });
    return { ok: true as const, status: "code_sent", displayPhone: result.displayPhone, test: false };
  }),
  resend: publicProcedure.input(z.object({ channel: z.enum(["sms", "call"]).default("sms") })).mutation(async ({ input, ctx }) => {
    dealsPublicHeaders(ctx.res);
    const pending = await currentPending(ctx.req);
    if (!pending) return { ok: false as const, kind: "expired", message: "Your code session expired. Start again." };
    const settings = await getDealSettings();
    const isTest = settings.testNumbers.includes(pending.phoneE164);
    const reserved = await reserveVerificationAttempt({
      phone: pending.phoneE164, sourceCode: pending.sourceCode, deviceHash: pending.deviceHash,
      ip: pending.clientIp, channel: input.channel, isTest,
    });
    if (!reserved.ok) return { ok: false as const, kind: reserved.kind, message: `We're getting a lot of traffic, so please try again in a bit. Or text ${settings.commentKeyword} to ${settings.textLine}.` };
    if (isTest && settings.skipTwilioForTestNumbers) return { ok: true as const, test: true };
    const sent = await sendTwilioVerify(pending.phoneE164, input.channel);
    if (!sent.ok && sent.reason === "twilio") await recordTwilioVerifyFailure({ sourceCode: pending.sourceCode, deviceHash: pending.deviceHash, ip: pending.clientIp });
    // The pending row stays either way: "Call me" (voice) is the recovery path for a number that cannot receive texts.
    if (!sent.ok && sent.reason === "cannot_receive") await recordTwilioVerifyOutcome({ sourceCode: pending.sourceCode, deviceHash: pending.deviceHash, ip: pending.clientIp, phone: pending.phoneE164, outcome: "rejected" });
    if (sent.ok) await logDealEvent({ kind: "twilio_verify_success", sourceCode: pending.sourceCode, deviceHash: pending.deviceHash, ip: pending.clientIp, phone: pending.phoneE164 });
    if (sent.ok) return { ok: true as const, test: false };
    if (sent.reason === "cannot_receive") return { ok: false as const, kind: "cannot_receive" as const, message: "That number can't receive texts. Try a mobile number or tap Call me." };
    if (sent.reason === "rate_limited") return { ok: false as const, kind: "rate_limited" as const, message: `We're getting a lot of traffic, so please try again in a bit. Or text ${settings.commentKeyword} to ${settings.textLine}.` };
    return { ok: false as const, kind: sent.reason, message: "We couldn't send a code right now. Please try again." };
  }),
  gateFocused: publicProcedure.input(z.object({ src: z.string().max(120).optional(), c: clientLinkToken })).mutation(async ({ input, ctx }) => {
    dealsPublicHeaders(ctx.res);
    const settings = await getDealSettings();
    const { ensureDealsCookies } = await import("./dealsService");
    const { deviceHash } = ensureDealsCookies(ctx.req, ctx.res);
    await recordGateFocus({
      sourceCode: input.c ? AGENT_CLIENT_SOURCE : currentDealSource(input.src, settings), deviceHash,
      ip: ctx.req.ip || ctx.req.socket.remoteAddress || "0.0.0.0",
    });
    return { ok: true as const };
  }),
  changeNumber: publicProcedure.mutation(async ({ ctx }) => { await removePending(ctx.req, ctx.res); return { ok: true as const }; }),
  mine: publicProcedure.query(async ({ ctx }) => {
    dealsPublicHeaders(ctx.res);
    const session = await isLiveDealSession(ctx.req);
    if (!session) throw new TRPCError({ code: "UNAUTHORIZED", message: "A current Builder Deals session is required." });
    // The team and buyers with a live agent link get the full list; everyone else the scrubbed one.
    const { view, agent } = await catalogViewForSession(session.lead);
    const { featuredDeals } = await import("./dealsFeatured");
    const [communities, saved] = await Promise.all([gatedDealsCatalog(session.leadId, view), savedDealCards(session.leadId)]);
    const listCards = new Set((communities as Array<{ homes?: Array<{ card?: string }> }>).flatMap((community) => (community.homes ?? []).flatMap((home) => home.card ? [home.card] : [])));
    // Ranked among the homes on this list only, so a community dropped from it never leaves a gap.
    const featured = await featuredDeals(view, { onlyCards: listCards });
    const connection = await getDb();
    if (connection) {
      const hourAgo = new Date(Date.now() - 60 * 60_000);
      // Community views are logged as the buyer opens each community (deals.viewedCommunity), not for the whole list.
      const recentListView = (await connection.select({ id: dealEvents.id }).from(dealEvents).where(and(eq(dealEvents.leadId, session.leadId), eq(dealEvents.kind, "viewed_listings"), sql`${dealEvents.createdAt} > ${hourAgo}`)).limit(1))[0];
      if (!recentListView) await logDealEvent({ leadId: session.leadId, kind: "viewed_listings", sourceCode: session.lead.sourceCode, deviceHash: session.deviceHash, ip: ctx.req.ip || ctx.req.socket.remoteAddress || "0.0.0.0" });
    }
    // The client sees their own agent's real number: they are meant to text it.
    // A featured home always has its card in this list: deals whose card is not shown are dropped.
    const onList = <T extends { card?: string }>(deal: T) => Boolean(deal.card && listCards.has(deal.card));
    const featuredOnList = { ...featured, lowestPayment: featured.lowestPayment.filter(onList), bestRate: featured.bestRate && onList(featured.bestRate) ? featured.bestRate : null, bigLots: featured.bigLots.filter(onList) };
    return { lead: { ...leadPresentation(session.lead), agentClient: Boolean(agent) }, communities, saved, featured: featuredOnList, fullDetails: view.view === "full", agent: agent ? { name: agent.name, firstName: agent.firstName, phone: agentDisplayPhone(agent) } : null };
  }),
  /**
   * A buyer who already holds a live list opens an agent's client link: attach
   * without a second code (their phone is verified in this browser), extend the
   * session to the agent-client window, note the agent in FUB and tell the agent.
   */
  attachClientLink: publicProcedure.input(z.object({ c: z.string().trim().min(20).max(80) })).mutation(async ({ input, ctx }) => {
    dealsPublicHeaders(ctx.res);
    const session = await isLiveDealSession(ctx.req);
    if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });
    const settings = await getDealSettings();
    const result = await attachLiveSessionToClientLink({ lead: session.lead, token: input.c, expiryHours: settings.clientLinkExpiryHours });
    if (!result.ok) return { ok: false as const, kind: result.kind, message: result.kind === "other_phone" || result.kind === "invalid_link" ? clientLinkRefusal(result.kind === "other_phone" ? "link_other_phone" : "link_dead", (await presentClientLink(input.c))?.agentName ?? null, settings.textLine) : "Please try again in a moment." };
    if (!result.attached) return { ok: true as const, attached: false as const, reason: result.reason };
    const { extendLiveSession } = await import("./dealsService");
    await extendLiveSession(ctx.req, ctx.res, result.expiresAt);
    // The FUB note and the agent's email ride the durable outbox/alert paths; a quiet test number stays quiet.
    const isTest = settings.testNumbers.includes(session.lead.phoneE164);
    if (!isTest || settings.testModeFullPipeline) {
      try {
        const { enqueueDealsFubJob, runPendingDealsFubJobs } = await import("./dealsFubJobs");
        await enqueueDealsFubJob(session.leadId, "reverify", { reason: "attached to an agent's client link", occurrenceId: new Date().toISOString() });
        void runPendingDealsFubJobs(1).catch(console.error);
        const { queueClientLinkAttachedAlert } = await import("./dealsAlerts");
        if (result.agent.active) await queueClientLinkAttachedAlert({ ...session.lead, agentTeamId: result.agent.teamId }, { name: result.agent.name, email: result.agent.email }, result.linkId);
      } catch (error) { console.error("[deals] client link attach side effects failed", error instanceof Error ? error.message : error); }
    }
    return { ok: true as const, attached: true as const, agentName: result.agent.name };
  }),
  /** The buyer's save mark on a home; the first save of a home notifies the team and the buyer's agent. */
  saveHome: publicProcedure.input(z.object({ card: z.string().length(20), saved: z.boolean() })).mutation(async ({ input, ctx }) => {
    dealsPublicHeaders(ctx.res);
    const session = await isLiveDealSession(ctx.req);
    if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });
    const { setDealsHomeSaved } = await import("./dealsRequests");
    try {
      return await setDealsHomeSaved({ leadId: session.leadId, card: input.card, saved: input.saved, sourceCode: session.lead.sourceCode, deviceHash: session.deviceHash });
    } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Save unavailable" }); }
  }),
  /** LDR agents only (a live team session): their client links, with each client's activity. */
  team: router({
    workspace: publicProcedure.query(async ({ ctx }) => {
      dealsPublicHeaders(ctx.res);
      const session = await isLiveDealSession(ctx.req);
      if (!session) throw new TRPCError({ code: "UNAUTHORIZED", message: "A current Builder Deals session is required." });
      if (session.lead.status !== "team") throw new TRPCError({ code: "FORBIDDEN", message: "Agent tools are for the Lifestyle Design Realty team." });
      const workspace = await agentWorkspace(session.lead);
      if (!workspace) {
        const { agentRowsForLead, SHARED_TEAM_NUMBER_MESSAGE } = await import("./dealsClientLinks");
        const shared = (await agentRowsForLead(session.lead)).kind === "shared";
        throw new TRPCError({ code: "FORBIDDEN", message: shared ? SHARED_TEAM_NUMBER_MESSAGE : settings_testTeamNote(session.lead.phoneE164, await getDealSettings()) });
      }
      return { lead: leadPresentation(session.lead), agent: { name: workspace.agent.name, email: workspace.agent.email, fubLinked: Boolean(workspace.agent.fubUserId) }, clients: workspace.clients };
    }),
    createClientLink: publicProcedure.input(z.object({ clientName: z.string().trim().min(2).max(190), clientPhone: z.string().trim().max(60).optional(), note: z.string().trim().max(500).optional() })).mutation(async ({ input, ctx }) => {
      dealsPublicHeaders(ctx.res);
      const session = await isLiveDealSession(ctx.req);
      if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });
      if (session.lead.status !== "team") throw new TRPCError({ code: "FORBIDDEN" });
      const result = await createClientLink({ agentLead: session.lead, clientName: input.clientName, clientPhone: input.clientPhone, note: input.note });
      if (!result.ok) {
        const { SHARED_TEAM_NUMBER_MESSAGE } = await import("./dealsClientLinks");
        const messages = { shared_number: SHARED_TEAM_NUMBER_MESSAGE, not_team: "Your number is not on the team list yet. Ask Peter to add it in Admin, Builder Deals.", invalid_phone: "Enter a valid US mobile number, or leave the phone blank.", invalid_name: "Enter the client's name.", unavailable: "Links are unavailable right now. Try again in a moment." } as const;
        throw new TRPCError({ code: result.kind === "unavailable" ? "INTERNAL_SERVER_ERROR" : result.kind === "not_team" || result.kind === "shared_number" ? "FORBIDDEN" : "BAD_REQUEST", message: messages[result.kind] });
      }
      const { nationalDigits } = await import("./dealsClientLinks");
      return { ok: true as const, id: result.link.id, path: result.path, expiresAt: result.link.expiresAt.toISOString(), clientName: result.link.clientName, clientPhoneDigits: nationalDigits(result.link.clientPhoneE164) };
    }),
    revokeClientLink: publicProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
      dealsPublicHeaders(ctx.res);
      const session = await isLiveDealSession(ctx.req);
      if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });
      if (session.lead.status !== "team") throw new TRPCError({ code: "FORBIDDEN" });
      if (!(await revokeClientLink(session.lead, input.id))) throw new TRPCError({ code: "NOT_FOUND", message: "That link is not one of yours." });
      return { ok: true as const };
    }),
  }),
  /**
   * The buyer opened a community on their list: one view row per community per
   * hour, for the agent's "last viewed" and the FUB activity note. The key is
   * the opaque handle the list carries, never a community id.
   */
  viewedCommunity: publicProcedure.input(z.object({ key: z.string().regex(/^[a-f0-9]{16}$/) })).mutation(async ({ input, ctx }) => {
    dealsPublicHeaders(ctx.res);
    const session = await isLiveDealSession(ctx.req);
    if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });
    const db = await getDb();
    if (!db) return { ok: false as const };
    const active = await db.select({ id: dealCommunities.id }).from(dealCommunities).where(and(eq(dealCommunities.active, true), eq(dealCommunities.paused, false)));
    const community = active.find((row) => hashSecret(`deals-community:${row.id}`).slice(0, 16) === input.key);
    if (!community) return { ok: false as const };
    const hourAgo = new Date(Date.now() - 60 * 60_000);
    const recent = (await db.select({ id: dealCommunityViews.id }).from(dealCommunityViews).where(and(eq(dealCommunityViews.leadId, session.leadId), eq(dealCommunityViews.communityId, community.id), sql`${dealCommunityViews.viewedAt} > ${hourAgo}`)).limit(1))[0];
    if (!recent) await db.insert(dealCommunityViews).values({ leadId: session.leadId, communityId: community.id });
    return { ok: true as const };
  }),
  requestHome: publicProcedure.input(z.object({ card: z.string().length(20), requestType: z.enum(["tour", "ask"]), preferredAt: z.string().datetime() })).mutation(async ({ input, ctx }) => {
    dealsPublicHeaders(ctx.res);
    const session = await isLiveDealSession(ctx.req);
    if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });
    if (session.lead.status === "team") throw new TRPCError({ code: "FORBIDDEN", message: "Team preview does not create buyer tour requests." });
    const { createDealsHomeRequest } = await import("./dealsRequests");
    try {
      return await createDealsHomeRequest({ leadId: session.leadId, card: input.card, requestType: input.requestType, preferredAt: new Date(input.preferredAt), sourceCode: session.lead.sourceCode, deviceHash: session.deviceHash });
    } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Request unavailable" }); }
  }),
  updateProfile: publicProcedure.input(z.object({ name: z.string().trim().min(2).max(190).optional(), timeline: z.enum(["0-3 months", "3-6 months", "6-12 months", "12+ months"]).optional() })).mutation(async ({ input, ctx }) => {
    dealsPublicHeaders(ctx.res);
    const session = await isLiveDealSession(ctx.req);
    if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });
    const db = await import("./db");
    const { dealLeads } = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const connection = await db.getDb();
    if (!connection) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const settings = await getDealSettings();
    const { profileRealtorFlags } = await import("./dealsEligibility");
    // Team previews save name/timeline only: no flags, no FUB write, no alert (A20).
    // Team previews and an agent's own clients (the agent vouches for them) get no "possible agent" flags.
    const profileFlags = session.lead.status === "team" || session.lead.agentTeamId ? [] : await profileRealtorFlags({ name: input.name ?? session.lead.name, instagramHandle: session.lead.instagramHandle, handleKeywords: settings.handleKeywords, trecCounties: settings.trecCounties });
    const storedFlags = (() => { try { const value = JSON.parse(session.lead.flags); return Array.isArray(value) ? value : value.flags ?? []; } catch { return []; } })();
    const newProfileFlags = profileFlags.filter((flag) => !storedFlags.includes(flag));
    const nextLead = { ...session.lead, name: input.name ?? session.lead.name, timeline: input.timeline ?? session.lead.timeline, flags: JSON.stringify(Array.from(new Set([...storedFlags, ...profileFlags]))) };
    await connection.update(dealLeads).set({ name: nextLead.name, timeline: nextLead.timeline, flags: nextLead.flags }).where(eq(dealLeads.id, session.leadId));
    // One FUB profile_update job (name only while the FUB name is the placeholder, Intent tag, new flag tags) and
    // the single permitted follow-up flag alert; test numbers stay quiet unless full pipeline is on.
    const { handleDealsProfileUpdate } = await import("./dealsFubJobs");
    await handleDealsProfileUpdate({ lead: nextLead, newFlags: newProfileFlags });
    return { ok: true as const };
  }),
  admin: router({
    overview: adminProcedure.query(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [communities, leads, blocks] = await Promise.all([
        db.select().from(dealCommunities),
        db.select({ id: dealLeads.id, name: dealLeads.name, phoneE164: dealLeads.phoneE164, email: dealLeads.email, instagramHandle: dealLeads.instagramHandle, sourceCode: dealLeads.sourceCode, timeline: dealLeads.timeline, status: dealLeads.status, flags: dealLeads.flags, fubStatus: dealLeads.fubStatus, fubPersonId: dealLeads.fubPersonId, expiresAt: dealLeads.expiresAt, createdAt: dealLeads.createdAt }).from(dealLeads).orderBy(desc(dealLeads.createdAt)).limit(25),
        db.select().from(dealBlocklist).orderBy(desc(dealBlocklist.createdAt)).limit(100),
      ]);
      const [homes, photos, agents, team, tours, imports, fubJobs, doNotAutoImport, alerts, emailLogs, incentives, clientLinks] = await Promise.all([
        db.select().from(dealHomes).orderBy(desc(dealHomes.createdAt)).limit(500),
        db.select({ id: dealPhotos.id, homeId: dealPhotos.homeId, sourceUrl: dealPhotos.sourceUrl, processingState: dealPhotos.processingState, automaticHidden: dealPhotos.automaticHidden, adminHidden: dealPhotos.adminHidden, bottomCrop: dealPhotos.bottomCrop, lastProcessingError: dealPhotos.lastProcessingError, processedVersion: dealPhotos.processedVersion, ocrMatches: dealPhotos.ocrMatches, sortOrder: dealPhotos.sortOrder, processedAt: dealPhotos.processedAt }).from(dealPhotos).orderBy(desc(dealPhotos.createdAt)).limit(200),
        db.select().from(dealKnownAgents).orderBy(desc(dealKnownAgents.createdAt)).limit(100),
        db.select().from(dealTeamAllowlist).orderBy(desc(dealTeamAllowlist.createdAt)).limit(100),
        // Saves are buyer bookmarks, listed per lead; the delivery table is tours and questions only.
        db.select().from(dealTourRequests).where(inArray(dealTourRequests.requestType, ["tour", "ask"])).orderBy(desc(dealTourRequests.createdAt)).limit(100),
        db.select().from(dealTrecImports).orderBy(desc(dealTrecImports.createdAt)).limit(1),
        db.select({ id: dealFubJobs.id, leadId: dealFubJobs.leadId, operation: dealFubJobs.operation, status: dealFubJobs.status, attempts: dealFubJobs.attempts, nextAttemptAt: dealFubJobs.nextAttemptAt, lastError: dealFubJobs.lastError }).from(dealFubJobs).orderBy(desc(dealFubJobs.createdAt)).limit(100),
        db.select().from(dealDoNotAutoImport).orderBy(desc(dealDoNotAutoImport.createdAt)).limit(100),
        db.select({ id: dealAlerts.id, leadId: dealAlerts.leadId, kind: dealAlerts.kind, deliveryMode: dealAlerts.deliveryMode, status: dealAlerts.status, subject: dealAlerts.subject, scheduledFor: dealAlerts.scheduledFor, deliveryLog: dealAlerts.deliveryLog, lastError: dealAlerts.lastError, attempts: dealAlerts.attempts }).from(dealAlerts).orderBy(desc(dealAlerts.createdAt)).limit(100),
        db.select().from(dealEmailLogs).orderBy(desc(dealEmailLogs.createdAt)).limit(100),
        db.select().from(dealIncentives).orderBy(desc(dealIncentives.createdAt)).limit(200),
        // The token stays server-side: admin sees who sent what to whom and whether it was used, never a link to open.
        db.select({ id: dealClientLinks.id, agentTeamId: dealClientLinks.agentTeamId, clientName: dealClientLinks.clientName, clientPhoneE164: dealClientLinks.clientPhoneE164, note: dealClientLinks.note, leadId: dealClientLinks.leadId, verifiedAt: dealClientLinks.verifiedAt, openedAt: dealClientLinks.openedAt, openCount: dealClientLinks.openCount, expiresAt: dealClientLinks.expiresAt, revokedAt: dealClientLinks.revokedAt, createdAt: dealClientLinks.createdAt }).from(dealClientLinks).orderBy(desc(dealClientLinks.createdAt)).limit(100),
      ]);
      const [{ builderDealsEmailStatus }, { trecImportSummary }] = await Promise.all([import("./dealsEmail"), import("./dealsTrec")]);
      const [settings, trecSummary, daily, leadStats, blockStats] = await Promise.all([
        getDealSettings(), trecImportSummary(),
        db.select({ n: sql<number>`count(*)` }).from(dealEvents).where(and(eq(dealEvents.kind, "code_sent"), gte(dealEvents.createdAt, chicagoDayStart()), sql`COALESCE(${dealEvents.detail}, '') NOT LIKE '%;test'`)),
        db.select({ status: dealLeads.status, n: sql<number>`count(*)` }).from(dealLeads).groupBy(dealLeads.status),
        db.select({ n: sql<number>`count(*)` }).from(dealBlocklist),
      ]);
      const dailyCount = Number(daily[0]?.n ?? 0);
      // The agents behind the links are read directly: the team list above is capped and may not include them.
      const linkAgentIds = Array.from(new Set(clientLinks.map((link) => link.agentTeamId)));
      const linkAgents = linkAgentIds.length ? await db.select({ id: dealTeamAllowlist.id, name: dealTeamAllowlist.name, email: dealTeamAllowlist.email }).from(dealTeamAllowlist).where(inArray(dealTeamAllowlist.id, linkAgentIds)) : [];
      const clientLinkRows = clientLinks.map((link) => { const agent = linkAgents.find((member) => member.id === link.agentTeamId); return { ...link, agentName: agent?.name || agent?.email || `team #${link.agentTeamId}` }; });
      return { communities, leads, blocks, homes, photos, agents, team, tours, fubJobs, doNotAutoImport, alerts, emailLogs, incentives, clientLinks: clientLinkRows, email: builderDealsEmailStatus(settings.alertRecipients), import: imports[0] ?? null, trecSummary, dailyCount, capReached: dailyCount >= settings.dailyVerificationCap, leadCounts: Object.fromEntries(leadStats.map((row) => [row.status, Number(row.n)])), blockCount: Number(blockStats[0]?.n ?? 0), limits: { homes: 500, photos: 200, recentActivity: 100 } };
    }),
    leads: adminProcedure.input(z.object({ search: z.string().trim().max(190).default(""), status: z.enum(["all", "verified", "blocked", "expired", "team"]).default("all"), fubStatus: z.enum(["all", "pending", "synced", "failed"]).default("all"), page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(100).default(25) })).query(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const pattern = `%${input.search.replace(/[\\%_]/g, "\\$&")}%`;
      const where = and(input.search ? or(like(dealLeads.name, pattern), like(dealLeads.phoneE164, pattern), like(dealLeads.email, pattern), like(dealLeads.instagramHandle, pattern), like(dealLeads.sourceCode, pattern)) : undefined, input.status === "all" ? undefined : eq(dealLeads.status, input.status), input.fubStatus === "all" ? undefined : eq(dealLeads.fubStatus, input.fubStatus));
      const [rows, count] = await Promise.all([db.select().from(dealLeads).where(where).orderBy(desc(dealLeads.createdAt), desc(dealLeads.id)).limit(input.pageSize).offset((input.page - 1) * input.pageSize), db.select({ n: sql<number>`count(*)` }).from(dealLeads).where(where)]);
      return { rows: rows.map(({ consentText, consentIp, deviceHash, ...lead }) => lead), total: Number(count[0]?.n ?? 0), page: input.page, pageSize: input.pageSize };
    }),
    leadDetail: adminProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const lead = (await db.select().from(dealLeads).where(eq(dealLeads.id, input.id)).limit(1))[0]; if (!lead) throw new TRPCError({ code: "NOT_FOUND" });
      const [views, tours, jobs] = await Promise.all([
        db.select({ communityId: dealCommunityViews.communityId, publicLabel: dealCommunities.publicLabel, viewedAt: dealCommunityViews.viewedAt }).from(dealCommunityViews).leftJoin(dealCommunities, eq(dealCommunities.id, dealCommunityViews.communityId)).where(eq(dealCommunityViews.leadId, input.id)).orderBy(desc(dealCommunityViews.viewedAt)).limit(100),
        db.select({ id: dealTourRequests.id, requestType: dealTourRequests.requestType, preferredAt: dealTourRequests.preferredAt, createdAt: dealTourRequests.createdAt, removedAt: dealTourRequests.removedAt, fubTaskId: dealTourRequests.fubTaskId, privateAddress: dealHomes.privateAddress, privatePlanName: dealHomes.privatePlanName }).from(dealTourRequests).leftJoin(dealHomes, eq(dealHomes.id, dealTourRequests.homeId)).where(eq(dealTourRequests.leadId, input.id)).orderBy(desc(dealTourRequests.createdAt)).limit(100),
        db.select({ id: dealFubJobs.id, status: dealFubJobs.status, operation: dealFubJobs.operation, lastError: dealFubJobs.lastError, attempts: dealFubJobs.attempts }).from(dealFubJobs).where(eq(dealFubJobs.leadId, input.id)).orderBy(desc(dealFubJobs.createdAt)).limit(100),
      ]);
      return { lead, views, tours, jobs };
    }),
    funnel: adminProcedure.input(z.object({ days: z.number().int().min(1).max(365).default(30) })).query(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const rows = await db.select({ sourceCode: dealEvents.sourceCode, kind: dealEvents.kind, count: sql<number>`count(*)` }).from(dealEvents).where(gte(dealEvents.createdAt, new Date(Date.now() - input.days * 86400_000))).groupBy(dealEvents.sourceCode, dealEvents.kind);
      const groups = new Map<string, Record<string, number>>();
      for (const row of rows) { const source = row.sourceCode || "other"; const counts = groups.get(source) ?? {}; counts[row.kind] = Number(row.count); groups.set(source, counts); }
      return Array.from(groups, ([sourceCode, counts]) => ({ sourceCode, counts })).sort((a, b) => a.sourceCode.localeCompare(b.sourceCode));
    }),
    identityList: adminProcedure.input(z.object({ kind: z.enum(["blocks", "agents", "team"]), search: z.string().trim().max(190).default(""), page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(100).default(25) })).query(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const table = input.kind === "blocks" ? dealBlocklist : input.kind === "agents" ? dealKnownAgents : dealTeamAllowlist;
      const pattern = `%${input.search.replace(/[\\%_]/g, "\\$&")}%`;
      const where = input.search ? or(like(table.phoneE164, pattern), like(table.email, pattern), ...(input.kind === "blocks" ? [like(dealBlocklist.searchPhone, pattern), like(dealBlocklist.deviceHash, pattern), like(dealBlocklist.reason, pattern)] : [like(input.kind === "agents" ? dealKnownAgents.name : dealTeamAllowlist.name, pattern)])) : undefined;
      const [rows, counts] = await Promise.all([db.select().from(table).where(where).orderBy(desc(table.createdAt)).limit(input.pageSize).offset((input.page - 1) * input.pageSize), db.select({ n: sql<number>`count(*)` }).from(table).where(where)]);
      return { rows, total: Number(counts[0]?.n ?? 0) };
    }),
    saveCommunity: adminProcedure.input(communityInput).mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, scrubList, salesPhone, replaceDiscovered, excludedTerms, ...data } = input;
      validateAdminCommunityUrl(data.builder, data.sourceUrl);
      const phone = salesPhone?.trim() ? normalizeAdminDealIdentity({ phoneE164: salesPhone }).phoneE164 : null;
      const existing = id ? (await db.select({ id: dealCommunities.id, scrubList: dealCommunities.scrubList }).from(dealCommunities).where(eq(dealCommunities.id, id)).limit(1))[0] : undefined;
      if (id && !existing) throw new TRPCError({ code: "NOT_FOUND" });
      // Categorised private names: the builder/lender aliases and the community name are always present,
      // admin terms are merged per category and a stored list is never shortened by an edit unless
      // replaceDiscovered asks for the plan/street lists to be replaced; excludedTerms are kept beside them.
      const storedScrubList = storedScrubListForCommunity({ builder: data.builder, privateName: data.privateName, scrubList, existing: existing?.scrubList ?? null, replaceDiscovered, excludedTerms });
      const scrubConfig = parseDealScrubConfig(JSON.parse(storedScrubList));
      if (hasPrivateTerm(data.publicLabel, scrubConfig) || hasPrivateTerm(data.areaLabel, scrubConfig)) throw new TRPCError({ code: "BAD_REQUEST", message: "Public labels must not contain private builder, lender, community, plan, or street names." });
      const patch = { ...data, salesPhone: phone, scrubList: storedScrubList };
      const duplicate = (await db.select({ id: dealCommunities.id }).from(dealCommunities).where(eq(dealCommunities.reelCode, data.reelCode)).limit(1))[0];
      if (duplicate && duplicate.id !== id) throw new TRPCError({ code: "CONFLICT", message: "This reel code is already in use." });
      let savedId = id ?? 0;
      if (id) await db.update(dealCommunities).set(patch).where(eq(dealCommunities.id, id));
      else savedId = Number((await db.insert(dealCommunities).values(patch) as unknown as [{ insertId?: number }])[0]?.insertId ?? 0);
      // ZIP centroid + drive-time chips for the area map; a geocoder failure never fails the save.
      if (savedId) void refreshCommunityGeography(savedId).catch(() => null);
      return { ok: true as const, id: savedId, scrubList: scrubConfig, excludedTerms: parseStoredScrubList(storedScrubList).excludedTerms };
    }),
    removeCommunity: adminProcedure.input(z.object({ id: z.number().int().positive(), confirm: z.literal(true) })).mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // Archive the mapping so historical lead views, tours, and private photos retain their meaning.
      await db.update(dealCommunities).set({ active: false, paused: true, awaitingFirstSync: false }).where(eq(dealCommunities.id, input.id));
      return { ok: true as const, archived: true as const };
    }),
    /** Manual incentive save: categorised scrubbing, required-field check, publish now; saving re-confirms and dates are sticky. */
    saveIncentive: adminProcedure.input(incentiveInput).mutation(({ input }) => adminCall(() => saveIncentiveForCommunity(input))),
    /** "Accept this update" for an incentive hold; refused until every field the hold reasons require is filled. */
    acceptHold: adminProcedure.input(acceptHoldInput).mutation(({ input }) => adminCall(() => acceptIncentiveHold(input))),
    /** Dismiss an incentive hold: the held text stays off until the scraped text changes. */
    dismissHold: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ input }) => adminCall(() => dismissIncentiveHold(input.id))),
    /** Dismiss a load-failure / missing-container hold: keep the last good data, no repeat email until the parse result changes. */
    dismissCatalogHold: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ input }) => adminCall(() => dismissCatalogHold(input.id))),
    /** Per-community holds with ages, held incentives with their missing fields, counts, area map and the last "Refresh now" run. */
    communityDiagnostics: adminProcedure.query(() => adminCall(() => listCommunityDiagnostics())),
    /** Builder choices for the add-community form. Served only to admins so no builder name ever ships in the public bundle. */
    builders: adminProcedure.query(() => [
      ...(Object.keys(OFFICIAL_BUILDER_HOSTS) as Array<keyof typeof OFFICIAL_BUILDER_HOSTS>).map((id) => ({ id, label: id, host: OFFICIAL_BUILDER_HOSTS[id], manual: false as const })),
      { id: "Manual" as const, label: "Manual (maintained by hand, no auto-update)", host: null, manual: true as const },
    ]),
    removeKnownAgent: adminProcedure.input(z.object({ id: z.number().int().positive(), confirm: z.literal(true) })).mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const row = (await db.select().from(dealKnownAgents).where(eq(dealKnownAgents.id, input.id)).limit(1))[0]; if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      for (const [kind, value] of [["phone", row.phoneE164], ["email", row.email]] as const) if (value) await db.insert(dealDoNotAutoImport).values({ kind, value }).onDuplicateKeyUpdate({ set: { kind, value } });
      await db.delete(dealKnownAgents).where(eq(dealKnownAgents.id, input.id));
      return { ok: true as const, nextStep: "fresh_verification_required" };
    }),
    removeDoNotAutoImport: adminProcedure.input(z.object({ id: z.number().int().positive(), confirm: z.literal(true) })).mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(dealDoNotAutoImport).where(eq(dealDoNotAutoImport.id, input.id)); return { ok: true as const };
    }),
    removeTeam: adminProcedure.input(z.object({ id: z.number().int().positive(), confirm: z.literal(true) })).mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const member = (await db.select().from(dealTeamAllowlist).where(eq(dealTeamAllowlist.id, input.id)).limit(1))[0]; if (!member) throw new TRPCError({ code: "NOT_FOUND" });
      // A redundant row of an agent who stays (a hand-added row next to their FUB row) hands its client links over first.
      const { reassignTeamRowBeforeRemoval } = await import("./dealsClientLinks");
      await reassignTeamRowBeforeRemoval(member.id);
      await db.delete(dealTeamAllowlist).where(eq(dealTeamAllowlist.id, input.id));
      const remaining = await db.select().from(dealTeamAllowlist).where(eq(dealTeamAllowlist.active, true));
      for (const [kind, value] of [["phone", member.phoneE164], ["email", member.email]] as const) {
        if (value && !remaining.some((row) => kind === "phone" ? row.phoneE164 === value : row.email === value)) await db.delete(dealDoNotAutoImport).where(and(eq(dealDoNotAutoImport.kind, kind), eq(dealDoNotAutoImport.value, value)));
      }
      const { revokeOrphanedTeamPreviewLinks } = await import("./dealsEligibility");
      const revoked = await revokeOrphanedTeamPreviewLinks(db);
      return { ok: true as const, revoked, nextStep: "fresh_verification_required", mirrorWarning: member.source === "fub" ? "Active FUB users return on the next mirror; deactivate them in FUB to remove permanently." : null };
    }),
    /** Admin-only thumbnail (data URL, never an object URL): the processed master when it exists, else the stored original. */
    photoPreview: adminProcedure.input(z.object({ id: z.number().int().positive(), maxEdge: z.number().int().min(64).max(720).optional(), prefer: z.enum(["master", "original"]).optional() })).query(async ({ input, ctx }) => {
      ctx.res.setHeader("Cache-Control", "no-store, private");
      const preview = await adminCall(() => getDealPhotoPreview(input));
      if (!preview) throw new TRPCError({ code: "NOT_FOUND", message: "No stored preview is available yet." });
      return preview;
    }),
    reprocessPhoto: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => {
      const { requeueDealPhoto } = await import("./dealsPhotos"); await requeueDealPhoto(input.id); kickPhotoQueue(5); return { ok: true as const, queued: true as const };
    }),
    /** Per-builder watermark settings (toggle, percent region, keyword list) with photo queue counts; reading seeds defaults. */
    builderPhotoSettings: adminProcedure.input(z.object({ builder: z.string().optional() }).optional()).query(({ input }) => adminCall(() => getBuilderPhotoSettingsForAdmin(input?.builder))),
    /** Saving a changed toggle/region/keyword list requeues every photo of that builder (steps 3 to 6 re-run from the stored originals). */
    saveBuilderPhotoSettings: adminProcedure.input(z.object({ builder: z.string().min(1), enabled: z.boolean(), region: photoRegionInput.nullable(), keywords: z.array(z.string()).optional(), reviewedSampleIds: z.array(z.number().int().positive()).optional() })).mutation(({ input }) => adminCall(() => saveBuilderPhotoSettings(input))),
    /** "Save and reprocess" when nothing changed: requeue the builder's photos anyway. */
    reprocessBuilderPhotos: adminProcedure.input(z.object({ builder: z.string().min(1) })).mutation(async ({ input }) => {
      const requeued = await adminCall(() => reprocessBuilderPhotos(input.builder));
      if (requeued > 0) kickPhotoQueue(20);
      return { ok: true as const, requeued };
    }),
    /** Up to 5 stored originals (data URLs) so the admin can pick the watermark region on real frames. */
    builderPhotoSamples: adminProcedure.input(z.object({ builder: z.string().min(1) })).query(async ({ input, ctx }) => {
      ctx.res.setHeader("Cache-Control", "no-store, private");
      return adminCall(() => listBuilderPhotoSamples(input.builder));
    }),
    /** Admin photo upload for a manual home: base64 (raw or data URL), at most 8 MB of image bytes, enters the pipeline at step 1. */
    uploadHomePhoto: adminProcedure.input(z.object({ homeId: z.number().int().positive(), base64: z.string().min(1).max(26_000_000), contentType: z.string() })).mutation(({ input }) => adminCall(async () => {
      const payload = input.base64.trim();
      const encoded = (payload.startsWith("data:") ? payload.slice(payload.indexOf(",") + 1) : payload).replace(/\s+/g, "");
      const approximateBytes = Math.floor(encoded.length * 3 / 4) - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
      if (approximateBytes > 8 * 1024 * 1024) throw new TRPCError({ code: "BAD_REQUEST", message: "Photos must be 8 MB or smaller." });
      return uploadManualHomePhoto(input);
    })),
    removeManualHome: adminProcedure.input(z.object({ id: z.number().int().positive(), confirm: z.literal(true) })).mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const home = (await db.select().from(dealHomes).where(and(eq(dealHomes.id, input.id), eq(dealHomes.origin, "manual"))).limit(1))[0]; if (!home) throw new TRPCError({ code: "NOT_FOUND" });
      // Soft deletion preserves request history and keeps private stored images unreachable to buyers.
      await db.update(dealHomes).set({ status: "hidden" }).where(eq(dealHomes.id, input.id));
      await db.update(dealCommunities).set({ catalogUpdatedAt: new Date() }).where(eq(dealCommunities.id, home.communityId)); return { ok: true as const };
    }),
    settings: adminProcedure.query(() => getDealSettings()),
    /** Read-only previews: no admin GET changes state, so neither runs the render prune (the 7:00 AM job does). */
    health: adminProcedure.query(async () => (await import("./dealsMaintenance")).builderDealsHealthCheck(new Date(), { prune: false })),
    mondayReport: adminProcedure.query(async () => (await import("./dealsMaintenance")).builderDealsMondayReport()),
    addTrecFakeRow: adminProcedure.input(z.object({ fullName: z.string().trim().min(3).max(190), confirm: z.literal(true) })).mutation(async ({ input }) => (await import("./dealsTrec")).addTrecFakeRow(input.fullName)),
    /** "Refresh now": one background adapter run for this community, recorded in deal_job_runs; refused while a run is in flight. */
    refreshCommunity: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ input }) => adminCall(() => refreshCommunityInBackground(input.id))),
    /** Load the research list (research/sa-communities.csv): every area community, hidden until its builder has a reader. */
    importResearchCommunities: adminProcedure.mutation(async () => {
      const { importResearchCommunities } = await import("./dealsResearchImport");
      try {
        const result = await importResearchCommunities();
        return { ok: true as const, created: result.created.length, existing: result.existing, skipped: result.skipped.length, rows: result.rows, builders: result.builders };
      } catch (error) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error instanceof Error && /ENOENT/.test(error.message) ? "The research list (research/sa-communities.csv) is not on this server." : "The research list could not be imported." });
      }
    }),
    /** "Find new communities now": the weekly discovery, started in the background; the result arrives by email. */
    discoverCommunities: adminProcedure.mutation(async () => {
      const { startCommunityDiscovery } = await import("./dealsDiscovery");
      return startCommunityDiscovery();
    }),
    /** An operator diagnostic restricted to the preconfigured official URL (exact official host, 64 KB cap, redirects reported, never followed). */
    testCommunitySource: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ input }) => adminCall(() => testCommunitySource(input.id))),
    runFubRetry: adminProcedure.mutation(async () => (await import("./dealsFubJobs")).runPendingDealsFubJobs()),
    saveSettings: adminProcedure.input(z.object({
      allowCanada: z.boolean().optional(), commentKeyword: z.string().min(1).max(30).optional(), textLine: z.string().min(1).max(40).optional(), expiryHours: z.number().int().min(1).max(168).optional(), hasAgentBlockDays: z.number().int().min(1).max(400).optional(), incentiveLapseDays: z.number().int().min(1).max(90).optional(), dailyVerificationCap: z.number().int().min(1).max(10000).optional(), phoneLimitPerHour: z.number().int().min(1).max(50).optional(), ipLimitPerHour: z.number().int().min(1).max(1000).optional(), testPhoneLimitPerHour: z.number().int().min(1).max(100).optional(), skipTwilioForTestNumbers: z.boolean().optional(), testNumbersSkipChecks: z.boolean().optional(), testModeFullPipeline: z.boolean().optional(), testNumbers: z.array(z.string()).max(20).optional(), testTeamNumbers: z.array(z.string()).max(20).optional(), activeReelCodes: z.array(z.string()).max(50).optional(), brokerageDomains: z.array(z.string().min(3)).max(100).optional(), fubRealtorTags: z.array(z.string()).max(100).optional(), fubRealtorSources: z.array(z.string()).max(100).optional(), handleKeywords: z.array(z.string()).max(100).optional(), trecCounties: z.array(z.string()).max(100).optional(), alertRecipients: z.array(z.string().email()).min(1).max(20).optional(), alertMode: z.enum(["immediate", "hourly_digest"]).optional(),
      syncEmailRecipients: z.array(z.string().email()).min(1).max(20).optional(), driveDestinations: z.array(z.string().trim().min(2).max(80)).min(1).max(8).optional(),
      clientLinkExpiryHours: z.number().int().min(1).max(24 * 90).optional(), clientLinkDays: z.number().int().min(1).max(365).optional(),
      paymentMarketRate: z.number().min(1).max(15).optional(), paymentDownPercent: z.number().min(0).max(100).optional(), featuredExcludedBuilders: z.array(z.string().trim().max(80)).max(50).optional(),
      areaMapRadiusMiles: z.number().min(1).max(20).optional(), publicAreaMapRadiusMiles: z.number().min(1).max(20).optional(), catalogRefreshDays: z.number().int().min(1).max(30).optional(),
    })).mutation(async ({ input }) => {
      const { saveDealSettings } = await import("./dealsService");
      return saveDealSettings(input);
    }),
    raiseDailyVerificationCap: adminProcedure.input(z.object({ confirm: z.literal(true) })).mutation(async () => {
      const settings = await getDealSettings();
      const { saveDealSettings } = await import("./dealsService");
      return saveDealSettings({ dailyVerificationCap: settings.dailyVerificationCap + 1000 });
    }),
    runAlertDelivery: adminProcedure.mutation(async () => {
      const { dispatchPendingDealAlerts } = await import("./dealsAlerts");
      return dispatchPendingDealAlerts({ includeFailed: true });
    }),
    saveCommunityState: adminProcedure.input(z.object({ id: z.number().int().positive(), active: z.boolean().optional(), paused: z.boolean().optional(), manualMode: z.boolean().optional(), reelUrl: z.string().url().nullable().optional() })).mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, ...patch } = input;
      // Turning a discovered community on or off by hand is final: the first sync no longer decides it.
      await db.update(dealCommunities).set({ ...patch, ...(patch.active !== undefined ? { awaitingFirstSync: false } : {}) }).where(eq(dealCommunities.id, id));
      return { ok: true as const };
    }),
    addBlock: adminProcedure.input(z.object({ phone: z.string().max(60).optional(), email: z.string().trim().max(320).optional(), deviceHash: z.string().max(64).optional(), reason: z.string().trim().min(3).max(255) })).mutation(async ({ input }) => {
      const identity = normalizeAdminDealIdentity({ phoneE164: input.phone, email: input.email, deviceHash: input.deviceHash });
      const { blockDealAccess } = await import("./dealsService");
      await blockDealAccess({ phone: identity.phoneE164, email: identity.email, deviceHash: identity.deviceHash, reason: input.reason }); return { ok: true as const };
    }),
    blockLeadAndKillLink: adminProcedure.input(z.object({ leadId: z.number().positive(), reason: z.string().trim().min(3).max(255) })).mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const lead = (await db.select().from(dealLeads).where(eq(dealLeads.id, input.leadId)).limit(1))[0]; if (!lead) throw new TRPCError({ code: "NOT_FOUND" });
      const { blockDealAccess } = await import("./dealsService");
      await blockDealAccess({ phone: lead.phoneE164, email: lead.email, deviceHash: lead.deviceHash, reason: input.reason });
      await db.update(dealLeads).set({ status: "blocked" }).where(eq(dealLeads.id, lead.id));
      await db.update(dealAccessTokens).set({ revokedAt: new Date() }).where(eq(dealAccessTokens.leadId, lead.id));
      return { ok: true as const };
    }),
    unblock: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const block = (await db.select().from(dealBlocklist).where(eq(dealBlocklist.id, input.id)).limit(1))[0]; if (!block) throw new TRPCError({ code: "NOT_FOUND" });
      // searchPhone is a lookup key only: never promote it into an exemption or a matching identity.
      // The stored number was normalised under the system's allowCanada setting; re-normalise with the same one.
      const { allowCanada } = await getDealSettings();
      const identity = normalizeAdminDealIdentity({ phoneE164: block.phoneE164, email: block.email, deviceHash: block.deviceHash }, { allowCanada });
      const knownWhere = adminIdentityWhere(dealKnownAgents, identity);
      const agents = knownWhere ? await db.select({ fubPersonId: dealKnownAgents.fubPersonId }).from(dealKnownAgents).where(knownWhere) : [];
      const where = or(...[identity.phoneE164 ? eq(dealLeads.phoneE164, identity.phoneE164) : undefined, identity.email ? eq(dealLeads.email, identity.email) : undefined, identity.deviceHash ? eq(dealLeads.deviceHash, identity.deviceHash) : undefined].filter((value) => value !== undefined));
      const leads = await db.select({ id: dealLeads.id, fubPersonId: dealLeads.fubPersonId }).from(dealLeads).where(where);
      await db.transaction(async (tx) => {
        await tx.delete(dealBlocklist).where(eq(dealBlocklist.id, input.id));
        if (knownWhere) await tx.delete(dealKnownAgents).where(knownWhere);
        for (const [kind, value] of [["phone", identity.phoneE164], ["email", identity.email]] as const) if (value) await tx.insert(dealDoNotAutoImport).values({ kind, value }).onDuplicateKeyUpdate({ set: { kind, value } });
        if (leads.length) {
          await tx.update(dealLeads).set({ status: "expired", revokedAt: new Date() }).where(and(eq(dealLeads.status, "blocked"), inArray(dealLeads.id, leads.map((lead) => lead.id))));
          await tx.update(dealAccessTokens).set({ revokedAt: new Date() }).where(inArray(dealAccessTokens.leadId, leads.map((lead) => lead.id)));
        }
      });
      const personIds = [...agents, ...leads].flatMap((row) => row.fubPersonId ? [row.fubPersonId] : []);
      // A pre-verification FUB-match block has no local lead/person id; find the tagged contact by the unblocked value.
      if (!personIds.length && (identity.phoneE164 || identity.email)) { const { findBuilderDealsFubPersonId } = await import("./dealsFub"); const found = await findBuilderDealsFubPersonId({ phone: identity.phoneE164, email: identity.email }); if (found) personIds.push(found); }
      const fubCleanup = await adminCleanupFubClassification(identity, personIds).catch(() => ({ state: "failed" as const }));
      return { ok: true as const, nextStep: "fresh_verification_required", fubCleanup };
    }),
    addKnownAgent: adminProcedure.input(z.object({ name: z.string().trim().max(190).optional(), phoneE164: z.string().max(60).optional(), email: z.string().trim().max(320).optional(), source: z.enum(["csv", "fub_recruit", "manual"]).default("manual") })).mutation(async ({ input }) => {
      const identity = normalizeAdminDealIdentity(input);
      const { importKnownAgents } = await import("./dealsKnownAgents"); return importKnownAgents([{ name: input.name, phone: identity.phoneE164 ?? undefined, email: identity.email ?? undefined }], input.source);
    }),
    importKnownAgentsCsv: adminProcedure.input(z.object({ csv: z.string().min(2).max(2_000_000) })).mutation(async ({ input }) => { const { importKnownAgents, parseKnownAgentsCsv } = await import("./dealsKnownAgents"); return importKnownAgents(parseKnownAgentsCsv(input.csv), "csv"); }),
    addDoNotAutoImport: adminProcedure.input(z.object({ value: z.string().trim().min(3).max(320), kind: z.enum(["phone", "email"]) })).mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const identity = normalizeAdminDealIdentity(input.kind === "phone" ? { phoneE164: input.value } : { email: input.value });
      const value = (input.kind === "phone" ? identity.phoneE164 : identity.email)!;
      await db.insert(dealDoNotAutoImport).values({ value, kind: input.kind }).onDuplicateKeyUpdate({ set: { value, kind: input.kind } }); return { ok: true as const };
    }),
    addTeam: adminProcedure.input(z.object({ name: z.string().trim().max(190).optional(), phoneE164: z.string().max(60).optional(), email: z.string().trim().max(320).optional(), source: z.enum(["fub", "manual", "test"]).default("manual") })).mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const identity = normalizeAdminDealIdentity(input);
      await db.transaction(async (tx) => {
        const existing = (await tx.select({ id: dealTeamAllowlist.id }).from(dealTeamAllowlist).where(adminIdentityWhere(dealTeamAllowlist, identity)).limit(1))[0];
        if (existing) await tx.update(dealTeamAllowlist).set({ active: true }).where(eq(dealTeamAllowlist.id, existing.id));
        else await tx.insert(dealTeamAllowlist).values({ name: input.name, phoneE164: identity.phoneE164, email: identity.email, source: input.source });
        await adminClearAgentClassification(tx as unknown as AdminDb, identity);
        const { makeMatchingLeadsTeam } = await import("./dealsEligibility"); await makeMatchingLeadsTeam(tx as unknown as AdminDb, identity);
      });
      return { ok: true as const };
    }),
    makeLeadTeam: adminProcedure.input(z.object({ leadId: z.number().int().positive() })).mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const lead = (await db.select().from(dealLeads).where(eq(dealLeads.id, input.leadId)).limit(1))[0]; if (!lead) throw new TRPCError({ code: "NOT_FOUND" });
      const identity = normalizeAdminDealIdentity(lead);
      await db.transaction(async (tx) => {
        const existing = (await tx.select({ id: dealTeamAllowlist.id }).from(dealTeamAllowlist).where(adminIdentityWhere(dealTeamAllowlist, identity)).limit(1))[0];
        if (!existing) await tx.insert(dealTeamAllowlist).values({ name: lead.name, phoneE164: identity.phoneE164, email: identity.email, source: "manual" });
        await adminClearAgentClassification(tx as unknown as AdminDb, identity);
        await tx.update(dealLeads).set({ status: "team" }).where(eq(dealLeads.id, lead.id));
      }); return { ok: true as const };
    }),
    retryFub: adminProcedure.input(z.object({ id: z.number().positive() })).mutation(async ({ input }) => { const { retryDealsFubJob, runPendingDealsFubJobs } = await import("./dealsFubJobs"); await retryDealsFubJob(input.id); return runPendingDealsFubJobs(1); }),
    addManualHome: adminProcedure.input(manualHomeInput).mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, sourceUrl, ...data } = input;
      const community = (await db.select({ id: dealCommunities.id }).from(dealCommunities).where(eq(dealCommunities.id, data.communityId)).limit(1))[0]; if (!community) throw new TRPCError({ code: "NOT_FOUND" });
      const existing = id ? (await db.select().from(dealHomes).where(and(eq(dealHomes.id, id), eq(dealHomes.origin, "manual"))).limit(1))[0] : undefined;
      if (id && !existing) throw new TRPCError({ code: "NOT_FOUND" });
      const url = sourceUrl ?? existing?.sourceUrl ?? `manual:${randomOpaqueToken(12)}`;
      await db.transaction(async (tx) => {
        if (id) await tx.update(dealHomes).set({ ...data, sourceUrl: url, origin: "manual" }).where(eq(dealHomes.id, id));
        else await tx.insert(dealHomes).values({ ...data, sourceUrl: url, sourceKey: hashSecret(url), origin: "manual" });
        await tx.update(dealCommunities).set({ catalogUpdatedAt: new Date() }).where(eq(dealCommunities.id, data.communityId));
        if (existing && existing.communityId !== data.communityId) await tx.update(dealCommunities).set({ catalogUpdatedAt: new Date() }).where(eq(dealCommunities.id, existing.communityId));
      }); return { ok: true as const };
    }),
    setPhotoState: adminProcedure.input(z.object({ id: z.number().int().positive(), adminHidden: z.boolean().optional(), bottomCrop: z.number().int().min(0).max(10000).optional() })).mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, ...patch } = input;
      await db.update(dealPhotos).set(patch).where(eq(dealPhotos.id, id));
      if (input.bottomCrop !== undefined || input.adminHidden === false) { const { requeueDealPhoto } = await import("./dealsPhotos"); await requeueDealPhoto(id); kickPhotoQueue(5); }
      return { ok: true as const, queued: input.bottomCrop !== undefined || input.adminHidden === false };
    }),
    /** FUB users the nightly mirror imported with no phone on file; without a number they fall through to the realtor checks. */
    teamNeedsPhone: adminProcedure.query(async () => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [rows, covered] = await Promise.all([
        db.select({ id: dealTeamAllowlist.id, name: dealTeamAllowlist.name, email: dealTeamAllowlist.email, fubUserId: dealTeamAllowlist.fubUserId, createdAt: dealTeamAllowlist.createdAt }).from(dealTeamAllowlist).where(and(eq(dealTeamAllowlist.source, "fub"), eq(dealTeamAllowlist.active, true), isNull(dealTeamAllowlist.phoneE164))).orderBy(dealTeamAllowlist.name).limit(200),
        // A hand-entered number is a manual row carrying the FUB user id, so the mirror never clears it and the user leaves this list.
        db.select({ fubUserId: dealTeamAllowlist.fubUserId }).from(dealTeamAllowlist).where(and(eq(dealTeamAllowlist.source, "manual"), eq(dealTeamAllowlist.active, true), isNotNull(dealTeamAllowlist.phoneE164), isNotNull(dealTeamAllowlist.fubUserId))),
      ]);
      const coveredIds = new Set(covered.flatMap((row) => row.fubUserId ? [row.fubUserId] : []));
      return rows.filter((row) => !row.fubUserId || !coveredIds.has(row.fubUserId));
    }),
    /** Inline "enter their number": a manual row (never touched by the mirror) with the same cascade as any team add. */
    addTeamPhone: adminProcedure.input(z.object({ id: z.number().int().positive(), phoneE164: z.string().min(1).max(60) })).mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const member = (await db.select().from(dealTeamAllowlist).where(eq(dealTeamAllowlist.id, input.id)).limit(1))[0]; if (!member) throw new TRPCError({ code: "NOT_FOUND" });
      const identity = normalizeAdminDealIdentity({ phoneE164: input.phoneE164 });
      await db.transaction(async (tx) => {
        const existing = (await tx.select({ id: dealTeamAllowlist.id }).from(dealTeamAllowlist).where(eq(dealTeamAllowlist.phoneE164, identity.phoneE164!)).limit(1))[0];
        if (existing) await tx.update(dealTeamAllowlist).set({ active: true, fubUserId: member.fubUserId ?? null }).where(eq(dealTeamAllowlist.id, existing.id));
        else await tx.insert(dealTeamAllowlist).values({ name: member.name, phoneE164: identity.phoneE164, email: null, fubUserId: member.fubUserId, source: "manual" });
        await adminClearAgentClassification(tx as unknown as AdminDb, identity);
        const { makeMatchingLeadsTeam } = await import("./dealsEligibility"); await makeMatchingLeadsTeam(tx as unknown as AdminDb, identity);
      });
      return { ok: true as const };
    }),
  }),
});
