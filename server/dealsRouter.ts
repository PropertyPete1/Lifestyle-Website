import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isAdminEmail } from "../shared/site";
import { DEALS_CONSENT_TEXT, maskPhone, sanitizeInstagramHandle, sanitizeSourceCode } from "../shared/deals";
import { ENV } from "./_core/env";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { dealBlocklist, dealCommunities, dealIncentives, dealLeads, dealTrecVerifications } from "../drizzle/schema";
import { checkTwilioVerify, sendTwilioVerify } from "./dealsVerification";
import { eq } from "drizzle-orm";
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
  removePending,
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
      if (result.kind === "outside_us") return { ok: false as const, kind: "outside_us", message: "US mobile numbers only for now. We'll help you directly by text." };
      if (result.kind === "rate_limited") return { ok: false as const, kind: "rate_limited", message: "We're getting a lot of traffic, so please try again in a bit." };
      return { ok: false as const, kind: "invalid_phone", message: "Enter a valid mobile number." };
    }
    if (result.isTest && result.settings.skipTwilioForTestNumbers) return { ok: true as const, status: "code_sent", displayPhone: result.displayPhone, test: true };
    const sent = await sendTwilioVerify(result.phone, "sms");
    if (!sent.ok) return { ok: false as const, kind: sent.reason, message: sent.reason === "cannot_receive" ? "That number can't receive texts. Try a mobile number or tap Call me." : "We couldn't send a code right now. Please try again." };
    return { ok: true as const, status: "code_sent", displayPhone: result.displayPhone, test: false };
  }),
  resend: publicProcedure.input(z.object({ channel: z.enum(["sms", "call"]).default("sms") })).mutation(async ({ input, ctx }) => {
    dealsPublicHeaders(ctx.res);
    const pending = await currentPending(ctx.req);
    if (!pending) return { ok: false as const, kind: "expired", message: "Your code session expired. Start again." };
    const settings = await getDealSettings();
    if (settings.testNumbers.includes(pending.phoneE164) && settings.skipTwilioForTestNumbers) return { ok: true as const, test: true };
    const sent = await sendTwilioVerify(pending.phoneE164, input.channel);
    return sent.ok ? { ok: true as const, test: false } : { ok: false as const, kind: sent.reason, message: "We couldn't send a code right now. Please try again." };
  }),
  changeNumber: publicProcedure.mutation(async ({ ctx }) => { await removePending(ctx.req, ctx.res); return { ok: true as const }; }),
  mine: publicProcedure.query(async ({ ctx }) => {
    dealsPublicHeaders(ctx.res);
    const session = await isLiveDealSession(ctx.req);
    if (!session) throw new TRPCError({ code: "UNAUTHORIZED", message: "A current Builder Deals session is required." });
    return { lead: leadPresentation(session.lead), communities: await gatedDealsCatalog(session.leadId) };
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
    await connection.update(dealLeads).set({ name: input.name ?? session.lead.name, timeline: input.timeline ?? session.lead.timeline }).where(eq(dealLeads.id, session.leadId));
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
      return { communities, leads, blocks, checks };
    }),
    settings: adminProcedure.query(() => getDealSettings()),
    saveSettings: adminProcedure.input(z.object({
      allowCanada: z.boolean().optional(), commentKeyword: z.string().min(1).max(30).optional(), textLine: z.string().min(1).max(40).optional(), expiryHours: z.number().int().min(1).max(168).optional(), hasAgentBlockDays: z.number().int().min(1).max(400).optional(), incentiveLapseDays: z.number().int().min(1).max(90).optional(), dailyVerificationCap: z.number().int().min(1).max(10000).optional(), phoneLimitPerHour: z.number().int().min(1).max(50).optional(), ipLimitPerHour: z.number().int().min(1).max(1000).optional(), testPhoneLimitPerHour: z.number().int().min(1).max(100).optional(), skipTwilioForTestNumbers: z.boolean().optional(), testNumbersSkipChecks: z.boolean().optional(), testModeFullPipeline: z.boolean().optional(), testNumbers: z.array(z.string()).max(20).optional(), activeReelCodes: z.array(z.string()).max(50).optional(),
    })).mutation(async ({ input }) => {
      const { saveDealSettings } = await import("./dealsService");
      return saveDealSettings(input);
    }),
    saveCommunityState: adminProcedure.input(z.object({ id: z.number().int().positive(), active: z.boolean().optional(), paused: z.boolean().optional(), manualMode: z.boolean().optional(), reelUrl: z.string().url().nullable().optional() })).mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, ...patch } = input;
      await db.update(dealCommunities).set(patch).where(eq(dealCommunities.id, id));
      return { ok: true as const };
    }),
  }),
});
