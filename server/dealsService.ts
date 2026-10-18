import crypto from "node:crypto";
import { and, asc, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { parse as parseCookie } from "cookie";
import {
  dealAccessTokens,
  dealBlocklist,
  dealCommunities,
  dealEvents,
  dealHomes,
  dealIncentives,
  dealLeads,
  dealPendingVerifications,
  dealPhotos,
  dealSettings,
} from "../drizzle/schema";
import {
  DEALS_BLOCKED_SUFFIX,
  DEALS_CONSENT_TEXT,
  DEALS_COOKIE,
  clientIpKey,
  displayForLead,
  hasPrivateTerm,
  isCrawler,
  isInAppBrowser,
  maskPhone,
  normalizeUsPhone,
  sanitizeInstagramHandle,
  sanitizeSourceCode,
  scrubPrivateNames,
} from "../shared/deals";
import { getDb } from "./db";

export type DealSettings = {
  allowCanada: boolean;
  commentKeyword: string;
  textLine: string;
  expiryHours: number;
  hasAgentBlockDays: number;
  incentiveLapseDays: number;
  dailyVerificationCap: number;
  phoneLimitPerHour: number;
  ipLimitPerHour: number;
  testPhoneLimitPerHour: number;
  skipTwilioForTestNumbers: boolean;
  testNumbersSkipChecks: boolean;
  testModeFullPipeline: boolean;
  testNumbers: string[];
  activeReelCodes: string[];
};

const DEFAULT_SETTINGS: DealSettings = {
  allowCanada: false,
  commentKeyword: "HOME",
  textLine: "(512) 542-1477",
  expiryHours: 24,
  hasAgentBlockDays: 60,
  incentiveLapseDays: 14,
  dailyVerificationCap: 1500,
  phoneLimitPerHour: 3,
  ipLimitPerHour: 100,
  testPhoneLimitPerHour: 10,
  skipTwilioForTestNumbers: true,
  testNumbersSkipChecks: true,
  testModeFullPipeline: false,
  testNumbers: [],
  activeReelCodes: ["sl1", "vg1"],
};

const SETTINGS_KEY = "builder_deals";
const PENDING_MINUTES = 10;

export function hashSecret(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function randomOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

type GoogleDealsIdentity = { email: string; name: string | null };

function cookieSignature(value: string): string {
  const key = process.env.JWT_SECRET;
  if (!key) return "";
  return crypto.createHmac("sha256", key).update(value).digest("base64url");
}

export function setGoogleDealsIdentity(res: Response, identity: GoogleDealsIdentity) {
  const payload = Buffer.from(JSON.stringify(identity)).toString("base64url");
  const signature = cookieSignature(payload);
  if (!signature) return;
  setDealCookie(res, "ldr_deals_google", `${payload}.${signature}`, 10 * 60);
}

export function getGoogleDealsIdentity(req: Request): GoogleDealsIdentity | null {
  const value = parseCookie(req.headers.cookie || "")["ldr_deals_google"];
  if (!value) return null;
  const [payload, signature] = value.split(".");
  const expected = payload ? cookieSignature(payload) : "";
  if (!payload || !signature || !expected || Buffer.byteLength(signature) !== Buffer.byteLength(expected) || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as GoogleDealsIdentity;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.email) ? { email: parsed.email.toLowerCase(), name: parsed.name?.trim() || null } : null;
  } catch { return null; }
}

export function realClientIp(req: Request): string {
  // Express uses the configured one-hop proxy chain in server/_core/index.ts.
  // req.ip is therefore the client address, not an arbitrary forwarded header.
  return req.ip || req.socket.remoteAddress || "0.0.0.0";
}

export function dealDeviceHash(req: Request): string | null {
  const cookies = parseCookie(req.headers.cookie || "");
  const device = cookies[DEALS_COOKIE.device];
  return device ? hashSecret(device) : null;
}

function cookieBase(maxAgeSeconds: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/deals", maxAge: maxAgeSeconds };
}

export function setDealCookie(res: Response, name: string, value: string, maxAgeSeconds: number) {
  res.cookie(name, value, cookieBase(maxAgeSeconds));
}

export function clearDealCookie(res: Response, name: string) {
  res.clearCookie(name, cookieBase(0));
}

export function ensureDealsCookies(req: Request, res: Response): { deviceHash: string; hasProbe: boolean } {
  const cookies = parseCookie(req.headers.cookie || "");
  let device = cookies[DEALS_COOKIE.device];
  if (!device) {
    device = randomOpaqueToken(32);
    setDealCookie(res, DEALS_COOKIE.device, device, 400 * 24 * 60 * 60);
  }
  let hasProbe = Boolean(cookies[DEALS_COOKIE.probe]);
  if (!hasProbe) {
    setDealCookie(res, DEALS_COOKIE.probe, randomOpaqueToken(16), 24 * 60 * 60);
    hasProbe = true;
  }
  return { deviceHash: hashSecret(device), hasProbe };
}

export async function getDealSettings(): Promise<DealSettings> {
  const db = await getDb();
  if (!db) return { ...DEFAULT_SETTINGS };
  const row = (await db.select().from(dealSettings).where(eq(dealSettings.key, SETTINGS_KEY)).limit(1))[0];
  if (!row) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveDealSettings(settings: Partial<DealSettings>) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const merged = { ...(await getDealSettings()), ...settings };
  await db.insert(dealSettings).values({ key: SETTINGS_KEY, value: JSON.stringify(merged) }).onDuplicateKeyUpdate({ set: { value: JSON.stringify(merged) } });
  return merged;
}

export async function logDealEvent(input: { leadId?: number; kind: string; sourceCode?: string | null; deviceHash?: string | null; ip?: string | null; detail?: string | null }) {
  const db = await getDb();
  if (!db) return;
  await db.insert(dealEvents).values({
    leadId: input.leadId ?? null,
    kind: input.kind,
    sourceCode: input.sourceCode ?? null,
    deviceHash: input.deviceHash ?? null,
    ipPrefix: input.ip ? clientIpKey(input.ip) : null,
    detail: input.detail ?? null,
  });
}

export function currentDealSource(source: string | null | undefined, settings: DealSettings): string {
  const sanitized = sanitizeSourceCode(source);
  return sanitized && settings.activeReelCodes.includes(sanitized) ? sanitized : "other";
}

export async function rateLimitCount(kind: string, since: Date, fields: { phone?: string; ip?: string; deviceHash?: string }) {
  const db = await getDb();
  if (!db) return 0;
  const detailPredicates = [
    fields.phone ? sql`${dealEvents.detail} = ${`phone:${fields.phone}`}` : undefined,
    fields.ip ? eq(dealEvents.ipPrefix, clientIpKey(fields.ip)) : undefined,
    fields.deviceHash ? eq(dealEvents.deviceHash, fields.deviceHash) : undefined,
  ].filter(Boolean) as any[];
  if (!detailPredicates.length) return 0;
  const rows = await db.select({ n: sql<number>`count(*)` }).from(dealEvents).where(and(eq(dealEvents.kind, kind), gt(dealEvents.createdAt, since), or(...detailPredicates)));
  return Number(rows[0]?.n ?? 0);
}

export async function getActiveBlock(input: { phone?: string; email?: string; deviceHash?: string }) {
  const db = await getDb();
  if (!db) return undefined;
  const matches = [
    input.phone ? eq(dealBlocklist.phoneE164, input.phone) : undefined,
    input.email ? eq(dealBlocklist.email, input.email.toLowerCase()) : undefined,
    input.deviceHash ? eq(dealBlocklist.deviceHash, input.deviceHash) : undefined,
  ].filter(Boolean) as any[];
  if (!matches.length) return undefined;
  const now = new Date();
  return (await db.select().from(dealBlocklist).where(and(or(...matches), or(isNull(dealBlocklist.expiresAt), gt(dealBlocklist.expiresAt, now)))).limit(1))[0];
}

export async function blockDealAccess(input: { phone?: string | null; email?: string | null; deviceHash?: string | null; searchPhone?: string | null; reason: string; expiresAt?: Date | null }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(dealBlocklist).values({
    phoneE164: input.phone ?? null,
    email: input.email?.toLowerCase() ?? null,
    deviceHash: input.deviceHash ?? null,
    searchPhone: input.searchPhone ?? null,
    reason: input.reason,
    expiresAt: input.expiresAt ?? null,
  });
}

export async function publicDealsCatalog() {
  const db = await getDb();
  if (!db) return [];
  const now = new Date();
  const communities = await db.select().from(dealCommunities).where(and(eq(dealCommunities.active, true), eq(dealCommunities.paused, false))).orderBy(asc(dealCommunities.id));
  const result = [] as Array<{ label: string; area: string; fromPrice: number | null; reelUrl: string | null; homesAvailable: number; incentive: ReturnType<typeof publicIncentive> | null }>;
  for (const community of communities) {
    const [homes, incentives] = await Promise.all([
      db.select({ n: sql<number>`count(*)` }).from(dealHomes).where(and(eq(dealHomes.communityId, community.id), eq(dealHomes.status, "available"), eq(dealHomes.kind, "quick_move_in"))),
      db.select().from(dealIncentives).where(and(eq(dealIncentives.communityId, community.id), eq(dealIncentives.active, true), eq(dealIncentives.held, false), or(isNull(dealIncentives.expiresAt), gt(dealIncentives.expiresAt, now)))).orderBy(desc(dealIncentives.confirmedAt)).limit(1),
    ]);
    result.push({
      label: community.publicLabel,
      area: community.areaLabel,
      fromPrice: community.fromPrice,
      reelUrl: community.reelUrl,
      homesAvailable: Number(homes[0]?.n ?? 0),
      incentive: incentives[0] ? publicIncentive(incentives[0]) : null,
    });
  }
  return result;
}

function publicIncentive(row: typeof dealIncentives.$inferSelect) {
  // The landing can show the builder's rate wording, period, and APR without
  // exposing the full gated catalog narrative. Detailed terms remain present
  // in `text` for the verified personal list.
  const teaser = row.publicText.includes("Selected Quick Move-In homes:")
    ? row.publicText.split("Selected Quick Move-In homes:")[0].trim()
    : row.publicText;
  return {
    text: row.publicText,
    teaser,
    headlineRate: row.headlineRate,
    followOnRate: row.followOnRate,
    followOnPeriod: row.followOnPeriod,
    apr: row.apr,
    loanType: row.loanType,
    downPayment: row.downPayment,
    repaymentTerms: row.repaymentTerms,
    contractBy: row.contractBy?.toISOString() ?? null,
    closeBy: row.closeBy?.toISOString() ?? null,
  };
}

export async function gatedDealsCatalog(leadId: number) {
  const db = await getDb();
  if (!db) return [];
  const lead = (await db.select().from(dealLeads).where(eq(dealLeads.id, leadId)).limit(1))[0];
  if (!lead || lead.status !== "verified" || lead.expiresAt <= new Date()) return [];
  const communities = await db.select().from(dealCommunities).where(and(eq(dealCommunities.active, true), eq(dealCommunities.paused, false))).orderBy(asc(dealCommunities.id));
  const data = [] as unknown[];
  for (const community of communities) {
    const scrubNames = JSON.parse(community.scrubList) as string[];
    const [incentiveRows, homeRows] = await Promise.all([
      db.select().from(dealIncentives).where(and(eq(dealIncentives.communityId, community.id), eq(dealIncentives.active, true), eq(dealIncentives.held, false), or(isNull(dealIncentives.expiresAt), gt(dealIncentives.expiresAt, new Date())))).orderBy(desc(dealIncentives.confirmedAt)).limit(1),
      db.select().from(dealHomes).where(and(eq(dealHomes.communityId, community.id), eq(dealHomes.status, "available"))).orderBy(asc(dealHomes.price), asc(dealHomes.id)),
    ]);
    const homes = [] as Array<Record<string, unknown>>;
    for (const home of homeRows) {
      const photos = await db.select({ id: dealPhotos.id }).from(dealPhotos).where(and(eq(dealPhotos.homeId, home.id), eq(dealPhotos.processingState, "processed"), eq(dealPhotos.automaticHidden, false), eq(dealPhotos.adminHidden, false))).orderBy(asc(dealPhotos.sortOrder));
      homes.push({
        // Opaque, deterministic card handle for React only. It is not a
        // builder listing ID, database ID, source URL, or reversible key.
        card: hashSecret(`deals-card:${home.sourceKey}`).slice(0, 20),
        kind: home.kind,
        beds: home.beds,
        baths: home.baths,
        sqft: home.sqft,
        price: home.price,
        previousPrice: home.previousPrice,
        moveInDate: home.moveInDate,
        lotSize: home.lotSize,
        // Photo identifiers are deliberately not returned until the protected
        // image route has its signed per-lead resolver in place.
        photoCount: photos.length,
        photosOnRequest: photos.length === 0,
      });
    }
    data.push({
      label: scrubPrivateNames(community.publicLabel, scrubNames),
      area: scrubPrivateNames(community.areaLabel, scrubNames),
      schoolDistrict: scrubPrivateNames(community.schoolDistrict ?? "", scrubNames),
      lotSizes: scrubPrivateNames(community.lotSizes ?? "", scrubNames),
      amenities: (JSON.parse(community.amenities ?? "[]") as string[]).map((v) => scrubPrivateNames(v, scrubNames)),
      fromPrice: community.fromPrice,
      reelUrl: community.reelUrl,
      incentive: incentiveRows[0] ? publicIncentive(incentiveRows[0]) : null,
      homes,
    });
  }
  return data;
}

export async function isLiveDealSession(req: Request): Promise<{ leadId: number; lead: typeof dealLeads.$inferSelect; deviceHash: string } | null> {
  const cookies = parseCookie(req.headers.cookie || "");
  const token = cookies[DEALS_COOKIE.session];
  const deviceHash = dealDeviceHash(req);
  if (!token || !deviceHash) return null;
  const db = await getDb();
  if (!db) return null;
  const tokenRow = (await db.select().from(dealAccessTokens).where(and(eq(dealAccessTokens.tokenHash, hashSecret(token)), eq(dealAccessTokens.deviceHash, deviceHash), isNull(dealAccessTokens.revokedAt), gt(dealAccessTokens.expiresAt, new Date()))).limit(1))[0];
  if (!tokenRow) return null;
  const lead = (await db.select().from(dealLeads).where(and(eq(dealLeads.id, tokenRow.leadId), eq(dealLeads.status, "verified"), gt(dealLeads.expiresAt, new Date()))).limit(1))[0];
  return lead ? { leadId: lead.id, lead, deviceHash } : null;
}

export async function issueAccessToken(leadId: number, deviceHash: string, expiresAt: Date): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const token = randomOpaqueToken(32);
  await db.insert(dealAccessTokens).values({ leadId, tokenHash: hashSecret(token), deviceHash, expiresAt });
  return token;
}

export async function exchangeAccessToken(req: Request, res: Response, rawToken: string): Promise<"ok" | "needs_gate" | "expired"> {
  const deviceHash = dealDeviceHash(req);
  if (!deviceHash) return "needs_gate";
  const db = await getDb();
  if (!db) return "needs_gate";
  const token = (await db.select().from(dealAccessTokens).where(eq(dealAccessTokens.tokenHash, hashSecret(rawToken))).limit(1))[0];
  if (!token || token.revokedAt || token.expiresAt <= new Date()) return "expired";
  if (token.deviceHash !== deviceHash) return "needs_gate";
  const lead = (await db.select().from(dealLeads).where(eq(dealLeads.id, token.leadId)).limit(1))[0];
  if (!lead || lead.expiresAt <= new Date() || lead.status !== "verified") return "expired";
  const session = randomOpaqueToken(32);
  await db.insert(dealAccessTokens).values({ leadId: lead.id, tokenHash: hashSecret(session), deviceHash, expiresAt: lead.expiresAt });
  if (!token.consumedAt) await db.update(dealAccessTokens).set({ consumedAt: new Date() }).where(eq(dealAccessTokens.id, token.id));
  setDealCookie(res, DEALS_COOKIE.session, session, Math.max(60, Math.floor((lead.expiresAt.getTime() - Date.now()) / 1000)));
  return "ok";
}

export async function createPendingVerification(input: { req: Request; res: Response; rawPhone: string; choice: "buyer" | "has_agent"; source?: string | null; ig?: string | null }) {
  const settings = await getDealSettings();
  const normalized = normalizeUsPhone(input.rawPhone, { allowCanada: settings.allowCanada });
  if (!normalized.ok) return { ok: false as const, kind: normalized.reason === "outside_us" ? "outside_us" : "invalid_phone" };
  const { deviceHash } = ensureDealsCookies(input.req, input.res);
  const ip = realClientIp(input.req);
  const sourceCode = currentDealSource(input.source, settings);
  const ig = sanitizeInstagramHandle(input.ig);
  const google = getGoogleDealsIdentity(input.req);
  const isTest = settings.testNumbers.includes(normalized.e164);

  if (input.choice === "has_agent") {
    await blockDealAccess({ searchPhone: normalized.e164, deviceHash, reason: "Confirmed working with an agent", expiresAt: new Date(Date.now() + settings.hasAgentBlockDays * 86400_000) });
    await logDealEvent({ kind: "has_agent", sourceCode, deviceHash, ip, detail: `phone:${normalized.e164}` });
    return { ok: false as const, kind: "has_agent" };
  }

  if (!(isTest && settings.testNumbersSkipChecks)) {
    const block = await getActiveBlock({ phone: normalized.e164, deviceHash });
    if (block) {
      await logDealEvent({ kind: "blocked", sourceCode, deviceHash, ip, detail: "blocklist" });
      return { ok: false as const, kind: "blocked" };
    }
  }

  const hourAgo = new Date(Date.now() - 60 * 60_000);
  const phoneLimit = isTest ? settings.testPhoneLimitPerHour : settings.phoneLimitPerHour;
  const [perPhone, perIp] = await Promise.all([
    rateLimitCount("code_sent", hourAgo, { phone: normalized.e164 }),
    rateLimitCount("code_sent", hourAgo, { ip }),
  ]);
  if (perPhone >= phoneLimit || perIp >= settings.ipLimitPerHour) return { ok: false as const, kind: "rate_limited" };

  const db = await getDb();
  if (!db) return { ok: false as const, kind: "unavailable" };
  const opaque = randomOpaqueToken(24);
  await db.insert(dealPendingVerifications).values({
    opaqueIdHash: hashSecret(opaque), phoneE164: normalized.e164, choice: "buyer", sourceCode, instagramHandle: ig,
    deviceHash, clientIp: ip, flags: JSON.stringify(google ? { google } : {}), expiresAt: new Date(Date.now() + PENDING_MINUTES * 60_000),
  });
  setDealCookie(input.res, DEALS_COOKIE.pending, opaque, PENDING_MINUTES * 60);
  await logDealEvent({ kind: "started_gate", sourceCode, deviceHash, ip, detail: null });
  return { ok: true as const, pendingId: opaque, phone: normalized.e164, displayPhone: normalized.display, isTest, settings };
}

export async function currentPending(req: Request) {
  const opaque = parseCookie(req.headers.cookie || "")[DEALS_COOKIE.pending];
  const deviceHash = dealDeviceHash(req);
  if (!opaque || !deviceHash) return null;
  const db = await getDb();
  if (!db) return null;
  return (await db.select().from(dealPendingVerifications).where(and(eq(dealPendingVerifications.opaqueIdHash, hashSecret(opaque)), eq(dealPendingVerifications.deviceHash, deviceHash), gt(dealPendingVerifications.expiresAt, new Date()))).limit(1))[0] ?? null;
}

export async function removePending(req: Request, res: Response) {
  const pending = await currentPending(req);
  const db = await getDb();
  if (pending && db) await db.delete(dealPendingVerifications).where(eq(dealPendingVerifications.id, pending.id));
  clearDealCookie(res, DEALS_COOKIE.pending);
}

export async function completeVerification(input: { req: Request; res: Response; code: string; verifiedBy: "test" | "twilio" }) {
  const pending = await currentPending(input.req);
  const deviceHash = dealDeviceHash(input.req);
  if (!pending || !deviceHash) return { ok: false as const, kind: "expired" };
  const settings = await getDealSettings();
  const isTest = settings.testNumbers.includes(pending.phoneE164);
  const expectedTestCode = process.env.DEALS_TEST_OTP;
  if (isTest && input.code === expectedTestCode) {
    input.verifiedBy = "test";
  } else if (input.verifiedBy !== "twilio") {
    const db = await getDb();
    if (db) await db.update(dealPendingVerifications).set({ wrongCodes: pending.wrongCodes + 1 }).where(eq(dealPendingVerifications.id, pending.id));
    if (pending.wrongCodes + 1 >= 5) await removePending(input.req, input.res);
    return { ok: false as const, kind: "invalid_code" };
  }

  const db = await getDb();
  if (!db) return { ok: false as const, kind: "unavailable" };
  const old = (await db.select().from(dealLeads).where(eq(dealLeads.phoneE164, pending.phoneE164)).limit(1))[0];
  const expiresAt = old && old.expiresAt > new Date() ? old.expiresAt : new Date(Date.now() + settings.expiryHours * 60 * 60_000);
  let leadId: number;
  if (old) {
    const identity = JSON.parse(pending.flags || "{}") as { google?: GoogleDealsIdentity };
    await db.update(dealLeads).set({ status: "verified", deviceHash, expiresAt, sourceCode: pending.sourceCode, instagramHandle: old.instagramHandle ?? pending.instagramHandle, email: old.email ?? identity.google?.email ?? null, name: old.name ?? identity.google?.name ?? null }).where(eq(dealLeads.id, old.id));
    leadId = old.id;
  } else {
    const identity = JSON.parse(pending.flags || "{}") as { google?: GoogleDealsIdentity };
    const result = await db.insert(dealLeads).values({ phoneE164: pending.phoneE164, instagramHandle: pending.instagramHandle, email: identity.google?.email ?? null, name: identity.google?.name ?? null, sourceCode: pending.sourceCode, consentText: DEALS_CONSENT_TEXT, consentIp: pending.clientIp, deviceHash, expiresAt });
    leadId = Number((result as unknown as [{ insertId: number }])[0].insertId);
  }
  const token = await issueAccessToken(leadId, deviceHash, expiresAt);
  await db.delete(dealPendingVerifications).where(eq(dealPendingVerifications.id, pending.id));
  clearDealCookie(input.res, DEALS_COOKIE.pending);
  await logDealEvent({ leadId, kind: "verified", sourceCode: pending.sourceCode, deviceHash, ip: pending.clientIp, detail: input.verifiedBy });
  return { ok: true as const, token, leadId, expiresAt };
}

export function dealsPublicHeaders(res: Response) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
}

export function dealsCsp(res: Response) {
  // Vite and the production HTML both use an inline bootstrap. Allow only that
  // bootstrap and same-origin app code; external telemetry hosts remain blocked
  // by script-src and connect-src on every Deals response.
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' https://www.instagram.com https://*.cdninstagram.com data:; frame-src https://www.instagram.com; frame-ancestors 'none'; script-src 'self' 'unsafe-inline' https://www.instagram.com; style-src 'self' 'unsafe-inline'; connect-src 'self'");
}

export function isDealsCrawler(req: Request) { return req.method === "HEAD" || isCrawler(req.headers["user-agent"]); }
export function showGoogleDealsButton(req: Request) { return !isInAppBrowser(req.headers["user-agent"]) && Boolean(process.env.GOOGLE_DEALS_CLIENT_ID && process.env.GOOGLE_DEALS_CLIENT_SECRET); }

export function publicNoPrivateNames(payload: unknown, privateTerms: string[]): boolean {
  return !hasPrivateTerm(JSON.stringify(payload), privateTerms);
}

export function safeBlockedMessage(settings: DealSettings) {
  return `This page is for buyers who aren't working with an agent yet. Thanks for checking us out! Made a mistake? Text ${settings.commentKeyword} to ${settings.textLine}.`;
}

export function leadPresentation(lead: typeof dealLeads.$inferSelect) {
  return { display: displayForLead(lead), expiresAt: lead.expiresAt.toISOString(), name: lead.name, timeline: lead.timeline };
}
