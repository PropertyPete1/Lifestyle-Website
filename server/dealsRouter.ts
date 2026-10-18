import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isAdminEmail } from "../shared/site";
import { DEALS_CONSENT_TEXT, maskPhone, sanitizeInstagramHandle, sanitizeSourceCode } from "../shared/deals";
import { ENV } from "./_core/env";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { dealAccessTokens, dealBlocklist, dealCommunities, dealCommunityViews, dealDoNotAutoImport, dealFubJobs, dealHomes, dealIncentives, dealKnownAgents, dealLeads, dealPhotos, dealTeamAllowlist, dealTourRequests, dealTrecImports, dealTrecLicenses, dealTrecVerifications } from "../drizzle/schema";
import { checkTwilioVerify, sendTwilioVerify } from "./dealsVerification";
import { and, desc, eq, or } from "drizzle-orm";
import {
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
  reserveVerificationAttempt,
  showGoogleDealsButton,
  createPendingVerification,
} from "./dealsService";

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  const allowlisted = isAdminEmail(ctx.user.email) || ctx.user.openId === ENV.ownerOpenId;
  if (ctx.user.role !== "admin" || !allowlisted) throw new TRPCError({ code: "FORBIDDEN" });
  return next();
});

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
    };
  }),
  start: publicProcedure.input(gateInput).mutation(async ({ input, ctx }) => {
    dealsPublicHeaders(ctx.res);
    const result = await createPendingVerification({ req: ctx.req, res: ctx.res, rawPhone: input.phone, choice: input.choice, source: sanitizeSourceCode(input.src), ig: sanitizeInstagramHandle(input.ig) });
    if (!result.ok) {
      const settings = await getDealSettings();
      if (result.kind === "has_agent" || result.kind === "blocked") return { ok: false as const, kind: "blocked", message: "This page is for buyers who aren't working with an agent yet. Thanks for checking us out!" };
      if (result.kind === "cookie_blocked") return { ok: false as const, kind: "cookie_blocked", message: "Your browser is blocking cookies. Open this link in Safari or Chrome" };
      if (result.kind === "outside_us") return { ok: false as const, kind: "outside_us", message: "US mobile numbers only for now. We'll help you directly by text." };
      if (result.kind === "rate_limited") return { ok: false as const, kind: "rate_limited", message: "We're getting a lot of traffic, so please try again in a bit." };
      return { ok: false as const, kind: "invalid_phone", message: "Enter a valid mobile number." };
    }
    const reserved = await reserveVerificationAttempt({
      phone: result.phone, sourceCode: result.sourceCode, deviceHash: result.deviceHash,
      ip: result.ip, channel: "sms", isTest: result.isTest,
    });
    if (!reserved.ok) {
      await removePending(ctx.req, ctx.res);
      return { ok: false as const, kind: reserved.kind, message: "We're getting a lot of traffic, so please try again in a bit." };
    }
    if (result.isTest && result.settings.skipTwilioForTestNumbers) return { ok: true as const, status: "code_sent", displayPhone: result.displayPhone, test: true };
    const sent = await sendTwilioVerify(result.phone, "sms");
    if (!sent.ok) {
      if (sent.reason === "twilio") await recordTwilioVerifyFailure({ sourceCode: result.sourceCode, deviceHash: result.deviceHash, ip: result.ip });
      await removePending(ctx.req, ctx.res);
      return { ok: false as const, kind: sent.reason, message: sent.reason === "cannot_receive" ? "That number can't receive texts. Try a mobile number or tap Call me." : "We couldn't send a code right now. Please try again." };
    }
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
    if (!reserved.ok) return { ok: false as const, kind: reserved.kind, message: "We're getting a lot of traffic, so please try again in a bit." };
    if (isTest && settings.skipTwilioForTestNumbers) return { ok: true as const, test: true };
    const sent = await sendTwilioVerify(pending.phoneE164, input.channel);
    if (!sent.ok && sent.reason === "twilio") await recordTwilioVerifyFailure({ sourceCode: pending.sourceCode, deviceHash: pending.deviceHash, ip: pending.clientIp });
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
      const all = await connection.select({ id: dealCommunities.id }).from(dealCommunities);
      await Promise.all(all.map((community) => connection.insert(dealCommunityViews).values({ leadId: session.leadId, communityId: community.id })));
    }
    await logDealEvent({ leadId: session.leadId, kind: "viewed_listings", sourceCode: session.lead.sourceCode, deviceHash: session.deviceHash, ip: ctx.req.ip || ctx.req.socket.remoteAddress || "0.0.0.0" });
    return { lead: leadPresentation(session.lead), communities };
  }),
  requestHome: publicProcedure.input(z.object({ card: z.string().length(20), requestType: z.enum(["tour", "ask"]), preferredAt: z.string().datetime() })).mutation(async ({ input, ctx }) => {
    dealsPublicHeaders(ctx.res);
    const session = await isLiveDealSession(ctx.req);
    if (!session) throw new TRPCError({ code: "UNAUTHORIZED" });
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
    await connection.update(dealLeads).set({ name: input.name ?? session.lead.name, timeline: input.timeline ?? session.lead.timeline, flags: JSON.stringify(Array.from(new Set([...storedFlags, ...profileFlags]))) }).where(eq(dealLeads.id, session.leadId));
    return { ok: true as const };
  }),
  admin: router({
    overview: adminProcedure.query(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [communities, leads, blocks, checks] = await Promise.all([
        db.select().from(dealCommunities),
        db.select().from(dealLeads).orderBy(dealLeads.createdAt),
        db.select().from(dealBlocklist),
        db.select().from(dealTrecVerifications).orderBy(dealTrecVerifications.verifiedAt).limit(40),
      ]);
      const [homes, photos, agents, team, tours, imports, fubJobs, doNotAutoImport] = await Promise.all([
        db.select().from(dealHomes), db.select().from(dealPhotos), db.select().from(dealKnownAgents), db.select().from(dealTeamAllowlist), db.select().from(dealTourRequests).orderBy(desc(dealTourRequests.createdAt)), db.select().from(dealTrecImports).orderBy(desc(dealTrecImports.createdAt)).limit(1), db.select().from(dealFubJobs).orderBy(desc(dealFubJobs.createdAt)), db.select().from(dealDoNotAutoImport),
      ]);
      return { communities, leads, blocks, checks, homes, photos, agents, team, tours, fubJobs, doNotAutoImport, import: imports[0] ?? null };
    }),
    settings: adminProcedure.query(() => getDealSettings()),
    health: adminProcedure.query(async () => (await import("./dealsMaintenance")).builderDealsHealthCheck()),
    refreshCommunity: adminProcedure.input(z.object({ id: z.number().positive() })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); const community = (await db.select().from(dealCommunities).where(eq(dealCommunities.id, input.id)).limit(1))[0]; if (!community) throw new TRPCError({ code: "NOT_FOUND" }); return (await import("./dealsSync")).refreshOfficialDeals(); }),
    runFubRetry: adminProcedure.mutation(async () => (await import("./dealsFubJobs")).runPendingDealsFubJobs()),
    saveSettings: adminProcedure.input(z.object({
      allowCanada: z.boolean().optional(), commentKeyword: z.string().min(1).max(30).optional(), textLine: z.string().min(1).max(40).optional(), expiryHours: z.number().int().min(1).max(168).optional(), hasAgentBlockDays: z.number().int().min(1).max(400).optional(), incentiveLapseDays: z.number().int().min(1).max(90).optional(), dailyVerificationCap: z.number().int().min(1).max(10000).optional(), phoneLimitPerHour: z.number().int().min(1).max(50).optional(), ipLimitPerHour: z.number().int().min(1).max(1000).optional(), testPhoneLimitPerHour: z.number().int().min(1).max(100).optional(), skipTwilioForTestNumbers: z.boolean().optional(), testNumbersSkipChecks: z.boolean().optional(), testModeFullPipeline: z.boolean().optional(), testNumbers: z.array(z.string()).max(20).optional(), testTeamNumbers: z.array(z.string()).max(20).optional(), activeReelCodes: z.array(z.string()).max(50).optional(), brokerageDomains: z.array(z.string().min(3)).max(100).optional(), fubRealtorTags: z.array(z.string()).max(100).optional(), fubRealtorSources: z.array(z.string()).max(100).optional(), handleKeywords: z.array(z.string()).max(100).optional(), trecCounties: z.array(z.string()).max(100).optional(), alertMode: z.enum(["instant", "hourly_digest"]).optional(),
    })).mutation(async ({ input }) => {
      const { saveDealSettings } = await import("./dealsService");
      return saveDealSettings(input);
    }),
    raiseDailyVerificationCap: adminProcedure.input(z.object({ confirm: z.literal(true) })).mutation(async () => {
      const settings = await getDealSettings();
      const { saveDealSettings } = await import("./dealsService");
      return saveDealSettings({ dailyVerificationCap: settings.dailyVerificationCap + 1000 });
    }),
    saveCommunityState: adminProcedure.input(z.object({ id: z.number().int().positive(), active: z.boolean().optional(), paused: z.boolean().optional(), manualMode: z.boolean().optional(), reelUrl: z.string().url().nullable().optional() })).mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, ...patch } = input;
      await db.update(dealCommunities).set(patch).where(eq(dealCommunities.id, id));
      return { ok: true as const };
    }),
    addBlock: adminProcedure.input(z.object({ phone: z.string().optional(), email: z.string().email().optional(), deviceHash: z.string().optional(), reason: z.string().min(3).max(500) })).mutation(async ({ input }) => {
      const { blockDealAccess } = await import("./dealsService"); await blockDealAccess({ phone: input.phone, email: input.email, deviceHash: input.deviceHash, reason: input.reason }); return { ok: true as const };
    }),
    blockLeadAndKillLink: adminProcedure.input(z.object({ leadId: z.number().positive(), reason: z.string().min(3).max(500) })).mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const lead = (await db.select().from(dealLeads).where(eq(dealLeads.id, input.leadId)).limit(1))[0]; if (!lead) throw new TRPCError({ code: "NOT_FOUND" });
      const { blockDealAccess } = await import("./dealsService");
      await blockDealAccess({ phone: lead.phoneE164, email: lead.email, deviceHash: lead.deviceHash, reason: input.reason });
      await db.update(dealLeads).set({ status: "blocked" }).where(eq(dealLeads.id, lead.id));
      await db.update(dealAccessTokens).set({ revokedAt: new Date() }).where(eq(dealAccessTokens.leadId, lead.id));
      return { ok: true as const };
    }),
    unblock: adminProcedure.input(z.object({ id: z.number().positive() })).mutation(async ({ input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const block = (await db.select().from(dealBlocklist).where(eq(dealBlocklist.id, input.id)).limit(1))[0]; if (!block) throw new TRPCError({ code: "NOT_FOUND" });
      await db.delete(dealBlocklist).where(eq(dealBlocklist.id, input.id));
      const matches = [block.phoneE164 ? eq(dealLeads.phoneE164, block.phoneE164) : undefined, block.email ? eq(dealLeads.email, block.email) : undefined, block.deviceHash ? eq(dealLeads.deviceHash, block.deviceHash) : undefined].filter(Boolean) as any[];
      // Unblocking never resurrects a prior private link. It merely lets the
      // visitor pass screening again with a fresh code and fresh device check.
      if (matches.length) await db.update(dealLeads).set({ status: "expired" }).where(and(eq(dealLeads.status, "blocked"), or(...matches)));
      return { ok: true as const, nextStep: "fresh_verification_required" };
    }),
    addKnownAgent: adminProcedure.input(z.object({ name: z.string().max(190).optional(), phoneE164: z.string().max(20).optional(), email: z.string().email().optional(), source: z.enum(["csv", "fub_recruit", "manual"]).default("manual") })).mutation(async ({ input }) => { const { importKnownAgents } = await import("./dealsKnownAgents"); return importKnownAgents([{ name: input.name, phone: input.phoneE164, email: input.email }], input.source); }),
    importKnownAgentsCsv: adminProcedure.input(z.object({ csv: z.string().min(2).max(2_000_000) })).mutation(async ({ input }) => { const { importKnownAgents, parseKnownAgentsCsv } = await import("./dealsKnownAgents"); return importKnownAgents(parseKnownAgentsCsv(input.csv), "csv"); }),
    addDoNotAutoImport: adminProcedure.input(z.object({ value: z.string().min(3).max(320), kind: z.enum(["phone", "email"]) })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); await db.insert(dealDoNotAutoImport).values({ value: input.value.trim().toLowerCase(), kind: input.kind }).onDuplicateKeyUpdate({ set: { value: input.value.trim().toLowerCase() } }); return { ok: true as const }; }),
    addTeam: adminProcedure.input(z.object({ name: z.string().max(190).optional(), phoneE164: z.string().max(20).optional(), email: z.string().email().optional(), source: z.enum(["fub", "manual", "test"]).default("manual") })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); const { normalizeUsPhone } = await import("../shared/deals"); const parsed = input.phoneE164 ? normalizeUsPhone(input.phoneE164) : null; if (parsed && !parsed.ok) throw new TRPCError({ code: "BAD_REQUEST", message: "Use a valid US mobile number" }); await db.insert(dealTeamAllowlist).values({ ...input, phoneE164: parsed?.ok ? parsed.e164 : undefined, email: input.email?.toLowerCase() }); return { ok: true as const }; }),
    makeLeadTeam: adminProcedure.input(z.object({ leadId: z.number().positive() })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); const lead = (await db.select().from(dealLeads).where(eq(dealLeads.id, input.leadId)).limit(1))[0]; if (!lead) throw new TRPCError({ code: "NOT_FOUND" }); await db.insert(dealTeamAllowlist).values({ name: lead.name, phoneE164: lead.phoneE164, email: lead.email, source: "manual" }); await db.update(dealLeads).set({ status: "team" }).where(eq(dealLeads.id, lead.id)); return { ok: true as const }; }),
    retryFub: adminProcedure.input(z.object({ id: z.number().positive() })).mutation(async ({ input }) => { const { retryDealsFubJob, runPendingDealsFubJobs } = await import("./dealsFubJobs"); await retryDealsFubJob(input.id); return runPendingDealsFubJobs(1); }),
    addManualHome: adminProcedure.input(z.object({ communityId: z.number().positive(), sourceUrl: z.string().url(), privateAddress: z.string().max(255).optional(), privatePlanName: z.string().max(190).optional(), kind: z.enum(["quick_move_in", "to_be_built"]), beds: z.string().max(30).optional(), baths: z.string().max(30).optional(), sqft: z.number().int().optional(), price: z.number().int().optional() })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); const { hashSecret } = await import("./dealsService"); await db.insert(dealHomes).values({ ...input, sourceKey: hashSecret(input.sourceUrl), origin: "manual" }).onDuplicateKeyUpdate({ set: { ...input, origin: "manual" } }); return { ok: true as const }; }),
    setPhotoState: adminProcedure.input(z.object({ id: z.number().positive(), adminHidden: z.boolean().optional(), bottomCrop: z.number().int().min(0).max(10000).optional() })).mutation(async ({ input }) => { const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" }); const { id, ...patch } = input; await db.update(dealPhotos).set(patch).where(eq(dealPhotos.id, id)); return { ok: true as const }; }),
  }),
});
