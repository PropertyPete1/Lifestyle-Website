import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isAdminEmail } from "../shared/site";
import { DEALS_CONSENT_TEXT, hasPrivateTerm, maskPhone, normalizeUsPhone, normalizedText, scrubPrivateNames, sanitizeInstagramHandle, sanitizeSourceCode } from "../shared/deals";
import { ENV } from "./_core/env";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { dealFubRecords, dealSettings, dealTrecFakeRows, dealAccessTokens, dealAlerts, dealBlocklist, dealCommunities, dealCommunityViews, dealDoNotAutoImport, dealEmailLogs, dealEvents, dealFubJobs, dealHomes, dealIncentives, dealKnownAgents, dealLeads, dealPhotos, dealTeamAllowlist, dealTourRequests, dealTrecImports, dealTrecLicenses, dealTrecVerifications } from "../drizzle/schema";
import { checkTwilioVerify, sendTwilioVerify } from "./dealsVerification";
import { and, desc, eq, gte, inArray, isNull, like, ne, or, sql } from "drizzle-orm";
import {
  chicagoDayStart,
  chicagoEndOfDay,
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
  removePending,
  reserveGateSubmit,
  reserveVerificationAttempt,
  ensureDealsCookies,
  safeBlockedMessage,
  showGoogleDealsButton,
  createPendingVerification,
} from "./dealsService";

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  const allowlisted = isAdminEmail(ctx.user.email) || ctx.user.openId === ENV.ownerOpenId;
  if (ctx.user.role !== "admin" || !allowlisted) throw new TRPCError({ code: "FORBIDDEN" });
  return next();
});

type AdminIdentity = { phoneE164?: string | null; email?: string | null; deviceHash?: string | null };
type AdminDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** All admin writes use the same canonical identity as the buyer gate. */
export function normalizeAdminDealIdentity(input: AdminIdentity): AdminIdentity {
  const rawPhone = input.phoneE164?.trim();
  const parsed = rawPhone ? normalizeUsPhone(rawPhone) : null;
  if (parsed && !parsed.ok) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a valid US phone number." });
  const email = input.email?.trim().toLowerCase() || null;
  if (email && !z.string().email().safeParse(email).success) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a valid email address." });
  const deviceHash = input.deviceHash?.trim() || null;
  if (deviceHash && !/^[a-f0-9]{64}$/i.test(deviceHash)) throw new TRPCError({ code: "BAD_REQUEST", message: "Device identifiers must be a 64-character hash." });
  const identity = { phoneE164: parsed?.ok ? parsed.e164 : null, email, deviceHash };
  if (!identity.phoneE164 && !identity.email && !identity.deviceHash) throw new TRPCError({ code: "BAD_REQUEST", message: "A phone, email, or device identifier is required." });
  return identity;
}

export function validateAdminCommunityUrl(builder: string, raw: string) {
  const url = new URL(raw);
  const hosts = builder === "Chesmar" ? ["chesmar.com", "www.chesmar.com"] : builder === "M/I Homes" ? ["mihomes.com", "www.mihomes.com"] : [];
  if (url.protocol !== "https:" || url.username || url.password || url.port || (builder !== "Manual" && !hosts.includes(url.hostname.toLowerCase()))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Use the selected builder’s official HTTPS community URL." });
  }
  return url.toString();
}

export function adminIncentiveRequiredFields(input: { publicText: string; headlineRate?: string | null; apr?: string | null; followOnRate?: string | null; followOnPeriod?: string | null; loanType?: string | null; downPayment?: string | null; repaymentTerms?: string | null; contractBy?: Date | null; closeBy?: Date | null }) {
  const missing: string[] = [];
  const rateMentioned = Boolean(input.headlineRate) || /\d+(?:\.\d+)?%.*(?:rate|APR)|(?:rate|APR).*\d+(?:\.\d+)?%/i.test(input.publicText);
  if (rateMentioned && !input.apr?.trim()) missing.push("apr");
  if (rateMentioned && /buydown|first[- ]year|year\s*1|introductory/i.test(input.publicText)) {
    if (!input.followOnRate?.trim()) missing.push("followOnRate");
    if (!input.followOnPeriod?.trim()) missing.push("followOnPeriod");
  }
  if (rateMentioned && /\d+[- ]year|\d+\s+(?:monthly\s+)?payments?|down\s+payment/i.test(input.publicText)) {
    if (!input.loanType?.trim()) missing.push("loanType");
    if (!input.repaymentTerms?.trim()) missing.push("repaymentTerms");
  }
  if (/\d+(?:\.\d+)?%\s+(?:minimum\s+)?down/i.test(input.publicText) && !input.downPayment?.trim()) missing.push("downPayment");
  if (/contract(?:s|ing)?\s+(?:by|through|before)|purchase\s+agreements?.*(?:by|between)/i.test(input.publicText) && !input.contractBy) missing.push("contractBy");
  if (/clos(?:e|ing)\s+(?:by|before|on)/i.test(input.publicText) && !input.closeBy) missing.push("closeBy");
  return missing;
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

const communityInput = z.object({
  id: z.number().int().positive().optional(), builder: z.enum(["Chesmar", "M/I Homes", "Manual"]), privateName: z.string().trim().min(2).max(190),
  sourceUrl: z.string().url(), publicLabel: z.string().trim().min(2).max(190), areaLabel: z.string().trim().min(2).max(120),
  privateAddress: z.string().trim().max(255).default(""), salesPhone: z.string().max(60).nullable().optional(), reelUrl: z.string().url().nullable().optional(),
  reelCode: z.string().trim().regex(/^[a-z0-9_-]{1,40}$/), scrubList: z.array(z.string().trim().min(1).max(190)).min(1).max(500),
});
const manualHomeInput = z.object({
  id: z.number().int().positive().optional(), communityId: z.number().int().positive(), sourceUrl: z.string().url().optional(),
  privateAddress: z.string().trim().max(255).optional(), privatePlanName: z.string().trim().max(190).optional(), kind: z.enum(["quick_move_in", "to_be_built"]),
  status: z.enum(["available", "sold", "hidden"]).default("available"), beds: z.string().max(30).optional(), baths: z.string().max(30).optional(),
  sqft: z.number().int().min(0).max(2_147_483_647).optional(), price: z.number().int().min(0).max(2_147_483_647).optional(),
  moveInDate: z.string().max(100).optional(), lotSize: z.string().max(100).optional(),
});
const incentiveInput = z.object({
  id: z.number().int().positive().optional(), communityId: z.number().int().positive(), publicText: z.string().trim().min(2).max(20_000), manual: z.boolean(),
  contractBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), closeBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  headlineRate: z.string().max(80).nullable().optional(), followOnRate: z.string().max(80).nullable().optional(), followOnPeriod: z.string().max(100).nullable().optional(),
  apr: z.string().max(80).nullable().optional(), loanType: z.string().max(80).nullable().optional(), downPayment: z.string().max(80).nullable().optional(), repaymentTerms: z.string().max(120).nullable().optional(),
});
function adminDate(value: string | null | undefined) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a valid calendar date." });
  return chicagoEndOfDay(year, month, day);
}

const gateInput = z.object({
  phone: z.string().trim().min(1).max(60),
  choice: z.enum(["buyer", "has_agent"]),
  src: z.string().max(120).optional(),
  ig: z.string().max(160).optional(),
});

export const dealsRouter = router({
  publicCatalog: publicProcedure.query(async ({ ctx }) => {
    dealsPublicHeaders(ctx.res);
    return publicDealsCatalog();
  }),
  state: publicProcedure.query(async ({ ctx }) => {
    dealsPublicHeaders(ctx.res);
    const [settings, session, pending] = await Promise.all([getDealSettings(), isLiveDealSession(ctx.req), currentPending(ctx.req)]);
    return {
      session: session ? leadPresentation(session.lead) : null,
      pending: pending ? { displayPhone: maskPhone(pending.phoneE164), expiresAt: pending.expiresAt.toISOString() } : null,
      googleEnabled: showGoogleDealsButton(ctx.req),
      consentText: DEALS_CONSENT_TEXT,
      commentKeyword: settings.commentKeyword,
      textLine: settings.textLine,
      blockedMessage: safeBlockedMessage(settings),
    };
  }),
  start: publicProcedure.input(gateInput).mutation(async ({ input, ctx }) => {
    dealsPublicHeaders(ctx.res);
    const settings = await getDealSettings();
    const cookieState = ensureDealsCookies(ctx.req, ctx.res);
    const sourceCode = currentDealSource(sanitizeSourceCode(input.src), settings);
    const ip = ctx.req.ip || ctx.req.socket.remoteAddress || "0.0.0.0";
    if (!cookieState.hasProbe || !(await reserveGateSubmit({ ip, deviceHash: cookieState.deviceHash, sourceCode }))) {
      return { ok: false as const, kind: cookieState.hasProbe ? "rate_limited" : "cookie_blocked", message: cookieState.hasProbe ? `We're getting a lot of traffic, so please try again in a bit. Or text ${settings.commentKeyword} to ${settings.textLine}.` : `Your browser is blocking cookies. Open this link in Safari or Chrome. Or text ${settings.commentKeyword} to ${settings.textLine}.` };
    }
    const result = await createPendingVerification({ req: ctx.req, res: ctx.res, rawPhone: input.phone, choice: input.choice, source: sanitizeSourceCode(input.src), ig: sanitizeInstagramHandle(input.ig) });
    if (!result.ok) {
      const settings = await getDealSettings();
      if (result.kind === "has_agent" || result.kind === "blocked") return { ok: false as const, kind: "blocked", message: safeBlockedMessage(settings) };
      if (result.kind === "cookie_blocked") return { ok: false as const, kind: "cookie_blocked", message: `Your browser is blocking cookies. Open this link in Safari or Chrome. Or text ${settings.commentKeyword} to ${settings.textLine}.` };
      if (result.kind === "outside_us") return { ok: false as const, kind: "outside_us", message: `Outside the US? Text ${settings.commentKeyword} to ${settings.textLine}.` };
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
      await removePending(ctx.req, ctx.res);
      return { ok: false as const, kind: sent.reason, message: sent.reason === "cannot_receive" ? "That number can't receive texts. Try a mobile number or tap Call me." : "We couldn't send a code right now. Please try again." };
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
    if (sent.ok) await logDealEvent({ kind: "twilio_verify_success", sourceCode: pending.sourceCode, deviceHash: pending.deviceHash, ip: pending.clientIp, phone: pending.phoneE164 });
    return sent.ok ? { ok: true as const, test: false } : { ok: false as const, kind: sent.reason, message: "We couldn't send a code right now. Please try again." };
  }),
  gateFocused: publicProcedure.input(z.object({ src: z.string().max(120).optional() })).mutation(async ({ input, ctx }) => {
    dealsPublicHeaders(ctx.res);
    const settings = await getDealSettings();
    const { ensureDealsCookies } = await import("./dealsService");
    const { deviceHash } = ensureDealsCookies(ctx.req, ctx.res);
    await recordGateFocus({
      sourceCode: currentDealSource(input.src, settings), deviceHash,
      ip: ctx.req.ip || ctx.req.socket.remoteAddress || "0.0.0.0",
    });
    return { ok: true as const };
  }),
  changeNumber: publicProcedure.mutation(async ({ ctx }) => { await removePending(ctx.req, ctx.res); return { ok: true as const }; }),
  mine: publicProcedure.query(async ({ ctx }) => {
    dealsPublicHeaders(ctx.res);
    const session = await isLiveDealSession(ctx.req);
    if (!session) throw new TRPCError({ code: "UNAUTHORIZED", message: "A current Builder Deals session is required." });
    const communities = await gatedDealsCatalog(session.leadId);
    const connection = await getDb();
    if (connection) {
      const active = await connection.select({ id: dealCommunities.id }).from(dealCommunities).where(and(eq(dealCommunities.active, true), eq(dealCommunities.paused, false)));
      const hourAgo = new Date(Date.now() - 60 * 60_000);
      for (const community of active) {
        const recent = (await connection.select({ id: dealCommunityViews.id }).from(dealCommunityViews).where(and(eq(dealCommunityViews.leadId, session.leadId), eq(dealCommunityViews.communityId, community.id), sql`${dealCommunityViews.viewedAt} > ${hourAgo}`)).limit(1))[0];
        if (!recent) await connection.insert(dealCommunityViews).values({ leadId: session.leadId, communityId: community.id });
      }
      const recentListView = (await connection.select({ id: dealEvents.id }).from(dealEvents).where(and(eq(dealEvents.leadId, session.leadId), eq(dealEvents.kind, "viewed_listings"), sql`${dealEvents.createdAt} > ${hourAgo}`)).limit(1))[0];
      if (!recentListView) await logDealEvent({ leadId: session.leadId, kind: "viewed_listings", sourceCode: session.lead.sourceCode, deviceHash: session.deviceHash, ip: ctx.req.ip || ctx.req.socket.remoteAddress || "0.0.0.0" });
    }
    return { lead: leadPresentation(session.lead), communities };
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
    const profileFlags = await profileRealtorFlags({ name: input.name ?? session.lead.name, instagramHandle: session.lead.instagramHandle, handleKeywords: settings.handleKeywords, trecCounties: settings.trecCounties });
    const storedFlags = (() => { try { const value = JSON.parse(session.lead.flags); return Array.isArray(value) ? value : value.flags ?? []; } catch { return []; } })();
    const newProfileFlags = profileFlags.filter((flag) => !storedFlags.includes(flag));
    const nextLead = { ...session.lead, name: input.name ?? session.lead.name, timeline: input.timeline ?? session.lead.timeline };
    await connection.update(dealLeads).set({ name: nextLead.name, timeline: nextLead.timeline, flags: JSON.stringify(Array.from(new Set([...storedFlags, ...profileFlags]))) }).where(eq(dealLeads.id, session.leadId));
    // Flags are review signals, not silent access revocations. Queue an alert
    // only for a newly discovered signal; test flows stay quiet unless staff
    // deliberately enable the existing full-pipeline test setting.
    if (newProfileFlags.length && (!settings.testNumbers.includes(session.lead.phoneE164) || settings.testModeFullPipeline)) {
      const { queueProfileFlagAlert } = await import("./dealsAlerts");
      await queueProfileFlagAlert(nextLead, newProfileFlags);
    }
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
      const [homes, photos, agents, team, tours, imports, fubJobs, doNotAutoImport, alerts, emailLogs, incentives] = await Promise.all([
        db.select().from(dealHomes).orderBy(desc(dealHomes.createdAt)).limit(500),
        db.select({ id: dealPhotos.id, homeId: dealPhotos.homeId, sourceUrl: dealPhotos.sourceUrl, processingState: dealPhotos.processingState, automaticHidden: dealPhotos.automaticHidden, adminHidden: dealPhotos.adminHidden, bottomCrop: dealPhotos.bottomCrop }).from(dealPhotos).orderBy(desc(dealPhotos.createdAt)).limit(200),
        db.select().from(dealKnownAgents).orderBy(desc(dealKnownAgents.createdAt)).limit(100),
        db.select().from(dealTeamAllowlist).orderBy(desc(dealTeamAllowlist.createdAt)).limit(100),
        db.select().from(dealTourRequests).orderBy(desc(dealTourRequests.createdAt)).limit(100),
        db.select().from(dealTrecImports).orderBy(desc(dealTrecImports.createdAt)).limit(1),
        db.select({ id: dealFubJobs.id, leadId: dealFubJobs.leadId, operation: dealFubJobs.operation, status: dealFubJobs.status, attempts: dealFubJobs.attempts, nextAttemptAt: dealFubJobs.nextAttemptAt, lastError: dealFubJobs.lastError }).from(dealFubJobs).orderBy(desc(dealFubJobs.createdAt)).limit(100),
        db.select().from(dealDoNotAutoImport).orderBy(desc(dealDoNotAutoImport.createdAt)).limit(100),
        db.select({ id: dealAlerts.id, leadId: dealAlerts.leadId, kind: dealAlerts.kind, deliveryMode: dealAlerts.deliveryMode, status: dealAlerts.status, subject: dealAlerts.subject, scheduledFor: dealAlerts.scheduledFor, deliveryLog: dealAlerts.deliveryLog, lastError: dealAlerts.lastError, attempts: dealAlerts.attempts }).from(dealAlerts).orderBy(desc(dealAlerts.createdAt)).limit(100),
        db.select().from(dealEmailLogs).orderBy(desc(dealEmailLogs.createdAt)).limit(100),
        db.select().from(dealIncentives).orderBy(desc(dealIncentives.createdAt)).limit(200),
      ]);
      const [{ builderDealsEmailStatus }, { trecImportSummary }] = await Promise.all([import("./dealsEmail"), import("./dealsTrec")]);
      const [settings, trecSummary, daily, leadStats, blockStats] = await Promise.all([
        getDealSettings(), trecImportSummary(),
        db.select({ n: sql<number>`count(*)` }).from(dealEvents).where(and(eq(dealEvents.kind, "code_sent"), gte(dealEvents.createdAt, chicagoDayStart()), sql`COALESCE(${dealEvents.detail}, '') NOT LIKE '%;test'`)),
        db.select({ status: dealLeads.status, n: sql<number>`count(*)` }).from(dealLeads).groupBy(dealLeads.status),
        db.select({ n: sql<number>`count(*)` }).from(dealBlocklist),
      ]);
      const dailyCount = Number(daily[0]?.n ?? 0);
      return { communities, leads, blocks, homes, photos, agents, team, tours, fubJobs, doNotAutoImport, alerts, emailLogs, incentives, email: builderDealsEmailStatus(settings.alertRecipients), import: imports[0] ?? null, trecSummary, dailyCount, capReached: dailyCount >= settings.dailyVerificationCap, leadCounts: Object.fromEntries(leadStats.map((row) => [row.status, Number(row.n)])), blockCount: Number(blockStats[0]?.n ?? 0), limits: { homes: 500, photos: 200, recentActivity: 100 } };
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
        db.select({ id: dealTourRequests.id, requestType: dealTourRequests.requestType, preferredAt: dealTourRequests.preferredAt, createdAt: dealTourRequests.createdAt, fubTaskId: dealTourRequests.fubTaskId, privateAddress: dealHomes.privateAddress, privatePlanName: dealHomes.privatePlanName }).from(dealTourRequests).leftJoin(dealHomes, eq(dealHomes.id, dealTourRequests.homeId)).where(eq(dealTourRequests.leadId, input.id)).orderBy(desc(dealTourRequests.createdAt)).limit(100),
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
      const { id, scrubList, salesPhone, ...data } = input;
      validateAdminCommunityUrl(data.builder, data.sourceUrl);
      const phone = salesPhone?.trim() ? normalizeAdminDealIdentity({ phoneE164: salesPhone }).phoneE164 : null;
      const privateTerms = Array.from(new Set([data.builder, data.privateName, ...scrubList].filter((value) => value !== "Manual")));
      if (hasPrivateTerm(data.publicLabel, privateTerms) || hasPrivateTerm(data.areaLabel, privateTerms)) throw new TRPCError({ code: "BAD_REQUEST", message: "Public labels must not contain private builder/community names." });
      const patch = { ...data, salesPhone: phone, scrubList: JSON.stringify(privateTerms) };
      const duplicate = (await db.select({ id: dealCommunities.id }).from(dealCommunities).where(eq(dealCommunities.reelCode, data.reelCode)).limit(1))[0];
      if (duplicate && duplicate.id !== id) throw new TRPCError({ code: "CONFLICT", message: "This reel code is already in use." });
      if (id) {
        if (!(await db.select({ id: dealCommunities.id }).from(dealCommunities).where(eq(dealCommunities.id, id)).limit(1))[0]) throw new TRPCError({ code: "NOT_FOUND" });
        await db.update(dealCommunities).set(patch).where(eq(dealCommunities.id, id));
      } else await db.insert(dealCommunities).values(patch);
      return { ok: true as const };
    }),
    removeCommunity: adminProcedure.input(z.object({ id: z.number().int().positive(), confirm: z.literal(true) })).mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // Archive the mapping so historical lead views, tours, and private photos retain their meaning.
      await db.update(dealCommunities).set({ active: false, paused: true }).where(eq(dealCommunities.id, input.id));
      return { ok: true as const, archived: true as const };
    }),
    saveIncentive: adminProcedure.input(incentiveInput).mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const community = (await db.select().from(dealCommunities).where(eq(dealCommunities.id, input.communityId)).limit(1))[0]; if (!community) throw new TRPCError({ code: "NOT_FOUND" });
      const { id, contractBy, closeBy, ...data } = input;
      if (id && !(await db.select({ id: dealIncentives.id }).from(dealIncentives).where(and(eq(dealIncentives.id, id), eq(dealIncentives.communityId, input.communityId))).limit(1))[0]) throw new TRPCError({ code: "NOT_FOUND" });
      const terms = JSON.parse(community.scrubList) as string[];
      const publicText = scrubPrivateNames(data.publicText, [...terms, community.builder, community.privateName]);
      if (hasPrivateTerm(publicText, terms)) throw new TRPCError({ code: "BAD_REQUEST", message: "Private names remain in incentive text." });
      const dates = { contractBy: adminDate(contractBy), closeBy: adminDate(closeBy) };
      const required = adminIncentiveRequiredFields({ ...data, publicText, ...dates });
      if (required.length) throw new TRPCError({ code: "BAD_REQUEST", message: `Required before publication: ${required.join(", ")}` });
      const expiresAt = dates.contractBy && dates.closeBy ? new Date(Math.min(dates.contractBy.getTime(), dates.closeBy.getTime())) : dates.contractBy ?? dates.closeBy;
      await db.transaction(async (tx) => {
        await tx.update(dealIncentives).set({ active: false }).where(eq(dealIncentives.communityId, input.communityId));
        const values = { ...data, publicText, normalizedText: normalizedText(publicText), ...dates, expiresAt, confirmedAt: new Date(), active: true, held: false, holdReason: null };
        if (id) await tx.update(dealIncentives).set(values).where(eq(dealIncentives.id, id)); else await tx.insert(dealIncentives).values(values);
        await tx.update(dealCommunities).set({ catalogUpdatedAt: new Date() }).where(eq(dealCommunities.id, input.communityId));
      });
      return { ok: true as const };
    }),
    acceptHold: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const incentive = (await db.select().from(dealIncentives).where(eq(dealIncentives.id, input.id)).limit(1))[0]; if (!incentive || !incentive.held) throw new TRPCError({ code: "NOT_FOUND" });
      const community = (await db.select().from(dealCommunities).where(eq(dealCommunities.id, incentive.communityId)).limit(1))[0];
      const required = adminIncentiveRequiredFields(incentive);
      if (required.length || !community || hasPrivateTerm(incentive.publicText, JSON.parse(community.scrubList) as string[])) throw new TRPCError({ code: "BAD_REQUEST", message: `Edit and complete this incentive before accepting: ${required.join(", ") || "private text"}` });
      await db.transaction(async (tx) => {
        await tx.update(dealIncentives).set({ active: false }).where(eq(dealIncentives.communityId, incentive.communityId));
        await tx.update(dealIncentives).set({ active: true, held: false, holdReason: null, confirmedAt: new Date() }).where(eq(dealIncentives.id, incentive.id));
        await tx.update(dealCommunities).set({ catalogUpdatedAt: new Date() }).where(eq(dealCommunities.id, incentive.communityId));
      });
      return { ok: true as const };
    }),
    dismissHold: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(dealIncentives).set({ active: false, held: false, holdReason: null }).where(eq(dealIncentives.id, input.id));
      return { ok: true as const };
    }),
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
      await db.delete(dealTeamAllowlist).where(eq(dealTeamAllowlist.id, input.id));
      const remaining = await db.select().from(dealTeamAllowlist).where(eq(dealTeamAllowlist.active, true));
      for (const [kind, value] of [["phone", member.phoneE164], ["email", member.email]] as const) {
        if (value && !remaining.some((row) => kind === "phone" ? row.phoneE164 === value : row.email === value)) await db.delete(dealDoNotAutoImport).where(and(eq(dealDoNotAutoImport.kind, kind), eq(dealDoNotAutoImport.value, value)));
      }
      const { revokeOrphanedTeamPreviewLinks } = await import("./dealsEligibility");
      const revoked = await revokeOrphanedTeamPreviewLinks(db);
      return { ok: true as const, revoked, nextStep: "fresh_verification_required", mirrorWarning: member.source === "fub" ? "Active FUB users return on the next mirror; deactivate them in FUB to remove permanently." : null };
    }),
    photoPreview: adminProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ input, ctx }) => {
      ctx.res.setHeader("Cache-Control", "no-store, private");
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const photo = (await db.select({ original: dealPhotos.originalStorageKey, processed: dealPhotos.processedStorageKey }).from(dealPhotos).where(eq(dealPhotos.id, input.id)).limit(1))[0];
      const key = photo?.processed ?? photo?.original; if (!key) throw new TRPCError({ code: "NOT_FOUND", message: "No stored preview is available yet." });
      try {
        const { storageReadPrivate } = await import("./storage"); const { default: sharp } = await import("sharp");
        const { data } = await storageReadPrivate(key);
        const thumbnail = await sharp(data, { limitInputPixels: 50_000_000 }).rotate().resize({ width: 360, height: 240, fit: "inside", withoutEnlargement: true }).webp({ quality: 70 }).toBuffer();
        return { dataUrl: `data:image/webp;base64,${thumbnail.toString("base64")}` };
      } catch { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The protected thumbnail could not be loaded." }); }
    }),
    reprocessPhoto: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => {
      const { requeueDealPhoto } = await import("./dealsPhotos"); await requeueDealPhoto(input.id); return { ok: true as const, queued: true as const };
    }),
    removeManualHome: adminProcedure.input(z.object({ id: z.number().int().positive(), confirm: z.literal(true) })).mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const home = (await db.select().from(dealHomes).where(and(eq(dealHomes.id, input.id), eq(dealHomes.origin, "manual"))).limit(1))[0]; if (!home) throw new TRPCError({ code: "NOT_FOUND" });
      // Soft deletion preserves request history and keeps private stored images unreachable to buyers.
      await db.update(dealHomes).set({ status: "hidden" }).where(eq(dealHomes.id, input.id));
      await db.update(dealCommunities).set({ catalogUpdatedAt: new Date() }).where(eq(dealCommunities.id, home.communityId)); return { ok: true as const };
    }),
    settings: adminProcedure.query(() => getDealSettings()),
    health: adminProcedure.query(async () => (await import("./dealsMaintenance")).builderDealsHealthCheck()),
    mondayReport: adminProcedure.query(async () => (await import("./dealsMaintenance")).builderDealsMondayReport()),
    addTrecFakeRow: adminProcedure.input(z.object({ fullName: z.string().trim().min(3).max(190), confirm: z.literal(true) })).mutation(async ({ input }) => (await import("./dealsTrec")).addTrecFakeRow(input.fullName)),
    refreshCommunity: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async () => {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Per-community background refresh requires a scoped sync worker. No global scrape was started." });
    }),
    runFubRetry: adminProcedure.mutation(async () => (await import("./dealsFubJobs")).runPendingDealsFubJobs()),
    saveSettings: adminProcedure.input(z.object({
      allowCanada: z.boolean().optional(), commentKeyword: z.string().min(1).max(30).optional(), textLine: z.string().min(1).max(40).optional(), expiryHours: z.number().int().min(1).max(168).optional(), hasAgentBlockDays: z.number().int().min(1).max(400).optional(), incentiveLapseDays: z.number().int().min(1).max(90).optional(), dailyVerificationCap: z.number().int().min(1).max(10000).optional(), phoneLimitPerHour: z.number().int().min(1).max(50).optional(), ipLimitPerHour: z.number().int().min(1).max(1000).optional(), testPhoneLimitPerHour: z.number().int().min(1).max(100).optional(), skipTwilioForTestNumbers: z.boolean().optional(), testNumbersSkipChecks: z.boolean().optional(), testModeFullPipeline: z.boolean().optional(), testNumbers: z.array(z.string()).max(20).optional(), testTeamNumbers: z.array(z.string()).max(20).optional(), activeReelCodes: z.array(z.string()).max(50).optional(), brokerageDomains: z.array(z.string().min(3)).max(100).optional(), fubRealtorTags: z.array(z.string()).max(100).optional(), fubRealtorSources: z.array(z.string()).max(100).optional(), handleKeywords: z.array(z.string()).max(100).optional(), trecCounties: z.array(z.string()).max(100).optional(), alertRecipients: z.array(z.string().email()).min(1).max(20).optional(), alertMode: z.enum(["immediate", "hourly_digest"]).optional(),
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
      await db.update(dealCommunities).set(patch).where(eq(dealCommunities.id, id));
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
      const identity = normalizeAdminDealIdentity({ phoneE164: block.phoneE164, email: block.email, deviceHash: block.deviceHash });
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
      if (input.bottomCrop !== undefined || input.adminHidden === false) { const { requeueDealPhoto } = await import("./dealsPhotos"); await requeueDealPhoto(id); }
      return { ok: true as const, queued: input.bottomCrop !== undefined || input.adminHidden === false };
    }),
  }),
});
