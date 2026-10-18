import crypto from "node:crypto";
import { and, asc, desc, eq, gt, isNull, lte, notLike, or, sql } from "drizzle-orm";
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
import { notifyOwner } from "./_core/notification";

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
  testTeamNumbers: string[];
  activeReelCodes: string[];
  brokerageDomains: string[];
  fubRealtorTags: string[];
  fubRealtorSources: string[];
  handleKeywords: string[];
  trecCounties: string[];
  alertMode: "instant" | "hourly_digest";
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
  testTeamNumbers: [],
  activeReelCodes: ["sl1", "vg1"],
  brokerageDomains: ["exprealty.com", "kw.com", "kwrealty.com", "compass.com", "redfin.com", "remax.net", "coldwellbanker.com", "c21.com", "century21.com", "bhhs.com", "jpar.com", "realbrokerage.com", "therealbrokerage.com", "lptrealty.com", "fathomrealty.com", "homesmart.com", "sothebysrealty.com", "douglaselliman.com", "elliman.com", "realtyaustin.com", "kuperrealty.com", "phyllisbrowning.com"],
  fubRealtorTags: ["Recruit - Website", "Agent - Blocked", "Agent - FUB Match", "Recruit"],
  fubRealtorSources: ["New Agent Inquiry", "Agent Scouting"],
  handleKeywords: ["realtor", "realty", "homes", "sells", "estate", "broker", "exprealty", "kw", "compass"],
  trecCounties: ["Bexar", "Comal", "Guadalupe", "Wilson", "Medina", "Kendall", "Atascosa", "Bandera", "Travis", "Williamson", "Hays", "Bastrop", "Caldwell"],
  alertMode: "instant",
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

function cookieBase(maxAgeSeconds: number, path = "/") {
  // The private data APIs live under /api/trpc, so Deals cookies must be
  // same-origin—not /deals-scoped—or the browser will silently omit them.
  // Express expects `maxAge` in milliseconds; call sites intentionally use
  // seconds to match token/verification expiry calculations.
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path, maxAge: maxAgeSeconds * 1000 };
}

export function setDealCookie(res: Response, name: string, value: string, maxAgeSeconds: number) {
  res.cookie(name, value, cookieBase(maxAgeSeconds));
  // Retire the previous /deals-only value so duplicate-name ordering cannot
  // make a stale device/pending cookie win during migration.
  res.clearCookie(name, cookieBase(0, "/deals"));
}

export function clearDealCookie(res: Response, name: string) {
  res.clearCookie(name, cookieBase(0));
  res.clearCookie(name, cookieBase(0, "/deals"));
}

export function ensureDealsCookies(req: Request, res: Response): { deviceHash: string; hasProbe: boolean } {
  const cookies = parseCookie(req.headers.cookie || "");
  let device = cookies[DEALS_COOKIE.device];
  if (!device) {
    device = randomOpaqueToken(32);
    setDealCookie(res, DEALS_COOKIE.device, device, 400 * 24 * 60 * 60);
  }
  // Return only an *incoming* probe. A cookie emitted in this response does
  // not prove this browser will retain it for Continue or token exchange.
  const hasProbe = Boolean(cookies[DEALS_COOKIE.probe]);
  if (!hasProbe) {
    setDealCookie(res, DEALS_COOKIE.probe, randomOpaqueToken(16), 400 * 24 * 60 * 60);
  }
  return { deviceHash: hashSecret(device), hasProbe };
}

/** Normalize admin-entered test numbers at the server trust boundary. */
export function normalizeTestNumbers(values: readonly string[], allowCanada = false): string[] {
  const result = new Set<string>();
  for (const value of values) {
    const parsed = normalizeUsPhone(value, { allowCanada });
    if (!parsed.ok) throw new Error(`Invalid test number: ${value}`);
    result.add(parsed.e164);
  }
  return Array.from(result);
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
  if (settings.testNumbers) merged.testNumbers = normalizeTestNumbers(settings.testNumbers, merged.allowCanada);
  if (settings.testTeamNumbers) merged.testTeamNumbers = normalizeTestNumbers(settings.testTeamNumbers, merged.allowCanada);
  await db.insert(dealSettings).values({ key: SETTINGS_KEY, value: JSON.stringify(merged) }).onDuplicateKeyUpdate({ set: { value: JSON.stringify(merged) } });
  return merged;
}

export async function logDealEvent(input: { leadId?: number; kind: string; sourceCode?: string | null; deviceHash?: string | null; ip?: string | null; phone?: string | null; detail?: string | null }) {
  const db = await getDb();
  if (!db) return;
  await db.insert(dealEvents).values({
    leadId: input.leadId ?? null,
    kind: input.kind,
    sourceCode: input.sourceCode ?? null,
    deviceHash: input.deviceHash ?? null,
    ipPrefix: input.ip ? clientIpKey(input.ip) : null,
    phoneE164: input.phone ?? null,
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
    fields.phone ? eq(dealEvents.phoneE164, fields.phone) : undefined,
    fields.ip ? eq(dealEvents.ipPrefix, clientIpKey(fields.ip)) : undefined,
    fields.deviceHash ? eq(dealEvents.deviceHash, fields.deviceHash) : undefined,
  ].filter(Boolean) as any[];
  if (!detailPredicates.length) return 0;
  const rows = await db.select({ n: sql<number>`count(*)` }).from(dealEvents).where(and(eq(dealEvents.kind, kind), gt(dealEvents.createdAt, since), or(...detailPredicates)));
  return Number(rows[0]?.n ?? 0);
}

/** Bound expensive FUB screening before any external lookup or blocklist write. */
export async function reserveGateSubmit(input: { ip: string; deviceHash: string; sourceCode: string }): Promise<boolean> {
  const settings = await getDealSettings();
  const count = await rateLimitCount("gate_submit", new Date(Date.now() - 60 * 60_000), { ip: input.ip });
  if (count >= settings.ipLimitPerHour) return false;
  await logDealEvent({ kind: "gate_submit", sourceCode: input.sourceCode, deviceHash: input.deviceHash, ip: input.ip });
  return true;
}

function chicagoDate(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  // Two passes resolve the zone offset at the requested local wall-clock time,
  // including the spring/fall Central Time transitions.
  for (let index = 0; index < 2; index++) {
    const parts = formatter.formatToParts(guess);
    const read = (name: string) => Number(parts.find((part) => part.type === name)?.value ?? 0);
    const seenAsUtc = Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute"), read("second"));
    const intendedAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    guess = new Date(guess.getTime() + intendedAsUtc - seenAsUtc);
  }
  return guess;
}

export function chicagoDayStart(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (name: string) => Number(parts.find((part) => part.type === name)?.value ?? 0);
  return chicagoDate(get("year"), get("month"), get("day"));
}

export function chicagoEndOfDay(year: number, month: number, day: number): Date {
  return chicagoDate(year, month, day, 23, 59, 59);
}

/**
 * Reserve exactly one verification attempt before it is sent. This makes test
 * OTP, SMS and voice requests share the same auditable safety limits.
 */
export async function reserveVerificationAttempt(input: {
  phone: string;
  sourceCode: string;
  deviceHash: string;
  ip: string;
  channel: "sms" | "call";
  isTest: boolean;
}): Promise<{ ok: true; dailyCount: number } | { ok: false; kind: "rate_limited" | "daily_cap" }> {
  const settings = await getDealSettings();
  const sinceHour = new Date(Date.now() - 60 * 60_000);
  const dayStart = chicagoDayStart();
  const perPhoneLimit = input.isTest ? settings.testPhoneLimitPerHour : settings.phoneLimitPerHour;
  const [perPhone, perIp, daily] = await Promise.all([
    rateLimitCount("code_sent", sinceHour, { phone: input.phone }),
    rateLimitCount("code_sent", sinceHour, { ip: input.ip }),
    rateLimitCount("code_sent", dayStart, { deviceHash: "__all__" }).catch(() => 0),
  ]);
  // `rateLimitCount` needs a predicate, so obtain the daily total explicitly.
  const db = await getDb();
  if (!db) return { ok: false, kind: "daily_cap" };
  const dayRows = await db.select({ n: sql<number>`count(*)` }).from(dealEvents)
    .where(and(eq(dealEvents.kind, "code_sent"), gt(dealEvents.createdAt, dayStart), notLike(dealEvents.detail, "%TEST%")));
  const dailyCount = Number(dayRows[0]?.n ?? daily);
  if (perPhone >= perPhoneLimit || perIp >= settings.ipLimitPerHour) return { ok: false, kind: "rate_limited" };
  if (dailyCount >= settings.dailyVerificationCap) {
    const prior = (await db.select({ id: dealEvents.id }).from(dealEvents).where(and(eq(dealEvents.kind, "cap_refused_alert"), gt(dealEvents.createdAt, dayStart))).limit(1))[0];
    if (!prior) {
      await logDealEvent({ kind: "cap_refused_alert", sourceCode: input.sourceCode, deviceHash: input.deviceHash, ip: input.ip });
      void notifyOwner({ title: "Builder Deals verification cap reached", content: `The Builder Deals daily Verify cap (${settings.dailyVerificationCap}) refused a code request. Review or raise the cap in Admin → Builder Deals: /admin/deals.` }).catch(console.error);
    }
    return { ok: false, kind: "daily_cap" };
  }
  await logDealEvent({
    kind: "code_sent", sourceCode: input.sourceCode, deviceHash: input.deviceHash, ip: input.ip,
    phone: input.phone, detail: `channel:${input.channel};${input.isTest ? "TEST" : "live"}`,
  });
  const nextCount = dailyCount + 1;
  if (nextCount === Math.min(300, settings.dailyVerificationCap)) void notifyOwner({ title: "Builder Deals Verify threshold reached", content: `Builder Deals reached ${nextCount} verification sends today. Review safety settings or raise the cap in Admin → Builder Deals: /admin/deals.` }).catch(console.error);
  return { ok: true, dailyCount: nextCount };
}

/** Server-side de-duplication prevents focus/remount activity inflating funnel data. */
export async function recordGateFocus(input: { sourceCode: string; deviceHash: string; ip: string }) {
  const db = await getDb();
  if (!db) return;
  const recent = (await db.select({ id: dealEvents.id }).from(dealEvents).where(and(
    eq(dealEvents.kind, "started_gate"), eq(dealEvents.deviceHash, input.deviceHash),
    eq(dealEvents.sourceCode, input.sourceCode), gt(dealEvents.createdAt, new Date(Date.now() - 60 * 60_000)),
  )).limit(1))[0];
  if (!recent) await logDealEvent({ kind: "started_gate", ...input });
}

/** Account/API failures only: caller omits normal landline and STOP outcomes. */
export async function recordTwilioVerifyFailure(input: { sourceCode: string; deviceHash: string; ip: string }) {
  const db = await getDb(); if (!db) return;
  await logDealEvent({ kind: "twilio_api_error", ...input });
  const recent = await db.select({ kind: dealEvents.kind }).from(dealEvents).where(gt(dealEvents.createdAt, new Date(Date.now() - 60 * 60_000))).orderBy(desc(dealEvents.createdAt)).limit(400);
  const sends = recent.filter((row) => row.kind === "code_sent").length;
  const errors = recent.filter((row) => row.kind === "twilio_api_error").length;
  // Only terminal outcome events participate. A code_sent event sits between
  // every send and its failure, so looking at raw adjacent events can never
  // observe three failed verification attempts.
  const outcomes = recent.filter((row) => row.kind === "twilio_api_error" || row.kind === "twilio_verify_success");
  const consecutive = outcomes.slice(0, 3).length === 3 && outcomes.slice(0, 3).every((row) => row.kind === "twilio_api_error");
  const alertSent = (await db.select({ id: dealEvents.id }).from(dealEvents).where(and(eq(dealEvents.kind, "twilio_alert"), gt(dealEvents.createdAt, new Date(Date.now() - 6 * 60 * 60_000)))).limit(1))[0];
  if (!alertSent && (consecutive || (sends >= 10 && errors / sends > 0.2))) {
    await logDealEvent({ kind: "twilio_alert", sourceCode: input.sourceCode, deviceHash: input.deviceHash, ip: input.ip, detail: `sends:${sends};errors:${errors}` });
    void notifyOwner({ title: "Builder Deals Twilio Verify alert", content: `Verify API/account errors need attention. Last hour: ${errors} API errors across ${sends} attempts. Review Admin → Builder Deals: /admin/deals.` }).catch(console.error);
  }
}

/** Records a browser landing once per device/source/hour; callers exclude HEAD and crawlers. */
export async function recordDealsLanding(input: { sourceCode: string; deviceHash: string; ip: string }) {
  const db = await getDb();
  if (!db) return;
  const recent = (await db.select({ id: dealEvents.id }).from(dealEvents).where(and(
    eq(dealEvents.kind, "landed"), eq(dealEvents.deviceHash, input.deviceHash),
    eq(dealEvents.sourceCode, input.sourceCode), gt(dealEvents.createdAt, new Date(Date.now() - 60 * 60_000)),
  )).limit(1))[0];
  if (!recent) await logDealEvent({ kind: "landed", ...input });
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
  const result = [] as Array<{ label: string; area: string; fromPrice: number | null; reelUrl: string | null; homesAvailable: number; incentive: ReturnType<typeof publicIncentive> | null; updatedAt: string | null }>;
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
      updatedAt: (community.catalogUpdatedAt ?? community.lastSuccessfulSyncAt ?? community.createdAt).toISOString(),
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
  if (!lead || !["verified", "team"].includes(lead.status) || lead.expiresAt <= new Date()) return [];
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
        // The server route checks the active session again before streaming a
        // per-lead derivative; neither storage nor builder URLs are exposed.
        photos: photos.map((photo) => `/deals/mine/img/${photo.id}`),
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
      driveTimes: (JSON.parse(community.driveTimeChips ?? "[]") as string[]).map((v) => scrubPrivateNames(v, scrubNames)),
      fromPrice: community.fromPrice,
      reelUrl: community.reelUrl,
      updatedAt: (community.catalogUpdatedAt ?? community.lastSuccessfulSyncAt ?? community.createdAt).toISOString(),
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
  const tokenRow = (await db.select().from(dealAccessTokens).where(and(eq(dealAccessTokens.kind, "session"), eq(dealAccessTokens.tokenHash, hashSecret(token)), eq(dealAccessTokens.deviceHash, deviceHash), isNull(dealAccessTokens.revokedAt), gt(dealAccessTokens.expiresAt, new Date()))).limit(1))[0];
  if (!tokenRow) return null;
  const lead = (await db.select().from(dealLeads).where(and(eq(dealLeads.id, tokenRow.leadId), or(eq(dealLeads.status, "verified"), eq(dealLeads.status, "team")), gt(dealLeads.expiresAt, new Date()))).limit(1))[0];
  return lead ? { leadId: lead.id, lead, deviceHash } : null;
}

export async function issueAccessToken(leadId: number, deviceHash: string, expiresAt: Date): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const token = randomOpaqueToken(32);
  await db.insert(dealAccessTokens).values({ leadId, tokenHash: hashSecret(token), deviceHash, expiresAt, kind: "exchange" });
  return token;
}

export async function exchangeAccessToken(req: Request, res: Response, rawToken: string): Promise<"ok" | "needs_gate" | "expired" | "cookie_blocked"> {
  const cookieState = ensureDealsCookies(req, res);
  if (!cookieState.hasProbe) return "cookie_blocked";
  const deviceHash = cookieState.deviceHash;
  const db = await getDb();
  if (!db) return "needs_gate";
  const token = (await db.select().from(dealAccessTokens).where(and(eq(dealAccessTokens.kind, "exchange"), eq(dealAccessTokens.tokenHash, hashSecret(rawToken)))).limit(1))[0];
  if (!token || token.revokedAt || token.expiresAt <= new Date()) return "expired";
  if (token.deviceHash !== deviceHash) return "needs_gate";
  if (token.consumedAt) return (await isLiveDealSession(req)) ? "ok" : "expired";
  const lead = (await db.select().from(dealLeads).where(eq(dealLeads.id, token.leadId)).limit(1))[0];
  if (!lead || lead.expiresAt <= new Date() || !["verified", "team"].includes(lead.status)) return "expired";
  const session = randomOpaqueToken(32);
  await db.insert(dealAccessTokens).values({ leadId: lead.id, tokenHash: hashSecret(session), deviceHash, expiresAt: lead.expiresAt, kind: "session" });
  if (!token.consumedAt) await db.update(dealAccessTokens).set({ consumedAt: new Date() }).where(eq(dealAccessTokens.id, token.id));
  setDealCookie(res, DEALS_COOKIE.session, session, Math.max(60, Math.floor((lead.expiresAt.getTime() - Date.now()) / 1000)));
  return "ok";
}

export async function createPendingVerification(input: { req: Request; res: Response; rawPhone: string; choice: "buyer" | "has_agent"; source?: string | null; ig?: string | null }) {
  const settings = await getDealSettings();
  const normalized = normalizeUsPhone(input.rawPhone, { allowCanada: settings.allowCanada });
  if (!normalized.ok) return { ok: false as const, kind: normalized.reason === "outside_us" ? "outside_us" : "invalid_phone" };
  const { deviceHash, hasProbe } = ensureDealsCookies(input.req, input.res);
  if (!hasProbe) return { ok: false as const, kind: "cookie_blocked" };
  const ip = realClientIp(input.req);
  const sourceCode = currentDealSource(input.source, settings);
  const ig = sanitizeInstagramHandle(input.ig);
  const google = getGoogleDealsIdentity(input.req);
  const isTest = settings.testNumbers.includes(normalized.e164);
  const { classifyDealsAccess } = await import("./dealsEligibility");
  const eligibility = await classifyDealsAccess({
    phone: normalized.e164, email: google?.email, deviceHash, isTest,
    testSkipChecks: settings.testNumbersSkipChecks, testTeamNumbers: settings.testTeamNumbers,
    brokerageDomains: settings.brokerageDomains, fubRealtorTags: settings.fubRealtorTags,
    fubRealtorSources: settings.fubRealtorSources,
  });
  // Staff/test previews must not create an accidental "has agent" device
  // block merely because they test the visible confirmation choice.
  if (input.choice === "has_agent" && !eligibility.team) {
    await blockDealAccess({ searchPhone: normalized.e164, deviceHash, reason: "Confirmed working with an agent", expiresAt: new Date(Date.now() + (isTest ? 10 * 60_000 : settings.hasAgentBlockDays * 86400_000)) });
    await logDealEvent({ kind: "has_agent", sourceCode, deviceHash, ip, phone: normalized.e164 });
    return { ok: false as const, kind: "has_agent" };
  }
  if (!eligibility.allowed) {
    if (eligibility.blockedBy !== "blocklist") {
      // Before SMS verification, never permanently block an unverified typed
      // phone because of an email-only match. A matching phone can be blocked.
      await blockDealAccess({ phone: eligibility.matchOn === "phone" ? normalized.e164 : null, email: eligibility.matchOn === "email" ? google?.email ?? null : null, reason: eligibility.blockedBy ?? "realtor screening" });
      await blockDealAccess({ deviceHash, reason: `${eligibility.blockedBy ?? "realtor screening"} device cooldown`, expiresAt: new Date(Date.now() + 24 * 60 * 60_000) });
    }
    await logDealEvent({ kind: "blocked", sourceCode, deviceHash, ip, detail: eligibility.blockedBy ?? "screening" });
    return { ok: false as const, kind: "blocked" };
  }

  const { profileRealtorFlags } = await import("./dealsEligibility");
  const profileFlags = eligibility.team ? [] : await profileRealtorFlags({
    name: google?.name,
    instagramHandle: ig,
    handleKeywords: settings.handleKeywords,
    trecCounties: settings.trecCounties,
  });

  const db = await getDb();
  if (!db) return { ok: false as const, kind: "unavailable" };
  const opaque = randomOpaqueToken(24);
  await db.insert(dealPendingVerifications).values({
    opaqueIdHash: hashSecret(opaque), phoneE164: normalized.e164, choice: "buyer", sourceCode, instagramHandle: ig,
    deviceHash, clientIp: ip, consentAt: new Date(), flags: JSON.stringify({ google, flags: [...eligibility.flags, ...profileFlags], team: eligibility.team }), expiresAt: new Date(Date.now() + PENDING_MINUTES * 60_000),
  });
  await logDealEvent({ kind: "consent", sourceCode, deviceHash, ip, phone: normalized.e164, detail: DEALS_CONSENT_TEXT });
  setDealCookie(input.res, DEALS_COOKIE.pending, opaque, PENDING_MINUTES * 60);
  return { ok: true as const, pendingId: opaque, phone: normalized.e164, displayPhone: normalized.display, isTest, settings, sourceCode, deviceHash, ip };
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
  const expectedTestCode = process.env.DEALS_TEST_OTP?.trim();
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
  const identity = JSON.parse(pending.flags || "{}") as { google?: GoogleDealsIdentity; flags?: string[]; team?: boolean };
  // Re-evaluate the mutable checks after the code is approved and before any
  // token is created. A discovered match cannot inherit an issued link.
  const eligibility = await (await import("./dealsEligibility")).classifyDealsAccess({
    phone: pending.phoneE164, email: identity.google?.email, deviceHash,
    isTest, testSkipChecks: settings.testNumbersSkipChecks, testTeamNumbers: settings.testTeamNumbers,
    brokerageDomains: settings.brokerageDomains, fubRealtorTags: settings.fubRealtorTags,
    fubRealtorSources: settings.fubRealtorSources,
  });
  if (!eligibility.allowed) {
    await db.delete(dealPendingVerifications).where(eq(dealPendingVerifications.id, pending.id));
    clearDealCookie(input.res, DEALS_COOKIE.pending);
    await logDealEvent({ kind: "blocked", sourceCode: pending.sourceCode, deviceHash, ip: pending.clientIp, detail: eligibility.blockedBy ?? "post_verification" });
    return { ok: false as const, kind: "blocked" };
  }
  let old = (await db.select().from(dealLeads).where(eq(dealLeads.phoneE164, pending.phoneE164)).limit(1))[0];
  let reverifiedActive = Boolean(old && old.expiresAt > new Date());
  let expiresAt = old && old.expiresAt > new Date() ? old.expiresAt : new Date(Date.now() + settings.expiryHours * 60 * 60_000);
  const flags = Array.from(new Set([...(identity.flags ?? []), ...eligibility.flags]));
  let leadId: number;
  if (old) {
    await db.update(dealLeads).set({ status: eligibility.team ? "team" : "verified", deviceHash, expiresAt, sourceCode: pending.sourceCode, instagramHandle: old.instagramHandle ?? pending.instagramHandle, email: old.email ?? identity.google?.email ?? null, name: old.name ?? identity.google?.name ?? null, flags: JSON.stringify(flags) }).where(eq(dealLeads.id, old.id));
    leadId = old.id;
  } else {
    // A forwarded DM handle belongs to its first verified phone. Do not expose
    // that identity in another person’s private watermark or list.
    const handleOwner = pending.instagramHandle ? (await db.select({ id: dealLeads.id }).from(dealLeads).where(and(eq(dealLeads.instagramHandle, pending.instagramHandle), sql`${dealLeads.phoneE164} <> ${pending.phoneE164}`)).limit(1))[0] : null;
    const instagramHandle = handleOwner ? null : pending.instagramHandle;
    try {
      const result = await db.insert(dealLeads).values({ phoneE164: pending.phoneE164, instagramHandle, email: identity.google?.email ?? null, name: identity.google?.name ?? null, sourceCode: pending.sourceCode, consentText: DEALS_CONSENT_TEXT, consentAt: pending.consentAt, consentIp: pending.clientIp, deviceHash, expiresAt, status: eligibility.team ? "team" : "verified", flags: JSON.stringify(flags) });
      leadId = Number((result as unknown as [{ insertId: number }])[0].insertId);
    } catch (error) {
      // Two verify submissions can legitimately race. The unique normalized
      // phone key makes this safe: retrieve the winner and continue exactly as
      // a re-verification instead of leaking an ER_DUP_ENTRY out of Express.
      const raced = (await db.select().from(dealLeads).where(eq(dealLeads.phoneE164, pending.phoneE164)).limit(1))[0];
      if (!raced) throw error;
      old = raced;
      reverifiedActive = raced.expiresAt > new Date();
      expiresAt = reverifiedActive ? raced.expiresAt : expiresAt;
      await db.update(dealLeads).set({ status: eligibility.team ? "team" : "verified", deviceHash, expiresAt, sourceCode: pending.sourceCode, flags: JSON.stringify(flags) }).where(eq(dealLeads.id, raced.id));
      leadId = raced.id;
    }
  }
  const token = await issueAccessToken(leadId, deviceHash, expiresAt);
  await db.delete(dealPendingVerifications).where(eq(dealPendingVerifications.id, pending.id));
  clearDealCookie(input.res, DEALS_COOKIE.pending);
  await logDealEvent({ leadId, kind: eligibility.team ? "team" : "verified", sourceCode: pending.sourceCode, deviceHash, ip: pending.clientIp, phone: pending.phoneE164, detail: input.verifiedBy });
  return { ok: true as const, token, leadId, expiresAt, firstUnlock: !old, reverifiedActive, isTeam: eligibility.team };
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
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' https://www.instagram.com https://*.cdninstagram.com data:; frame-src https://www.instagram.com https://*.cdninstagram.com; frame-ancestors 'none'; script-src 'self' 'unsafe-inline' https://www.instagram.com https://*.cdninstagram.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'");
}

export function isDealsCrawler(req: Request) { return req.method === "HEAD" || isCrawler(req.headers["user-agent"]); }
export function showGoogleDealsButton(req: Request) { return !isInAppBrowser(req.headers["user-agent"]) && Boolean((process.env.GOOGLE_OAUTH_CLIENT_ID ?? process.env.GOOGLE_DEALS_CLIENT_ID) && (process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? process.env.GOOGLE_DEALS_CLIENT_SECRET)); }

export function publicNoPrivateNames(payload: unknown, privateTerms: string[]): boolean {
  return !hasPrivateTerm(JSON.stringify(payload), privateTerms);
}

export function safeBlockedMessage(settings: DealSettings) {
  return `This page is for buyers who aren't working with an agent yet. Thanks for checking us out! Made a mistake? Text ${settings.commentKeyword} to ${settings.textLine}.`;
}

export function leadPresentation(lead: typeof dealLeads.$inferSelect) {
  return { display: displayForLead(lead), expiresAt: lead.expiresAt.toISOString(), name: lead.name, timeline: lead.timeline, teamPreview: lead.status === "team" };
}
