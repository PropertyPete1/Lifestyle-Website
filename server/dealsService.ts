import crypto from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, lte, notInArray, notLike, or, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { parse as parseCookie } from "cookie";
import {
  dealAccessTokens,
  dealBlocklist,
  dealCommunities,
  dealEvents,
  dealHomes,
  dealIncentives,
  dealJobRuns,
  dealLeads,
  dealPendingVerifications,
  dealPhotos,
  dealSettings,
  dealTourRequests,
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
  normalizeRateFigure,
  normalizeUsPhone,
  sanitizeInstagramHandle,
  sanitizeSourceCode,
  scrubPrivateNames,
  selectDealCatalogHomes,
  type DealScrubConfig,
} from "../shared/deals";
import { getDb } from "./db";
import { sendBuilderDealsEmail } from "./dealsEmail";
import { effectiveScrubConfig } from "./dealsScrub";
import { loanTypeLabel, priceBandFloor, priceBandLabel } from "../shared/dealsFeatured";
import { incentiveTeaser } from "../shared/dealsTeaser";
import { heldIncentivePublicEntry, heldIncentiveShowsLine } from "../shared/dealsHeldIncentive";
import { checkTwilioVerify } from "./dealsVerification";
import { mentionsRate, mentionsTriggeringTerm } from "./dealsAdapters";

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
  /** Resend recipient list; used by owner-notification fallback only as context. */
  alertRecipients: string[];
  alertMode: "immediate" | "hourly_digest";
  /** Builder refresh summaries, holds and incentive expiry/lapse notices. */
  syncEmailRecipients: string[];
  /** Drive-time chip destinations measured from each community's ZIP centroid. */
  driveDestinations: string[];
  /** Access length for a buyer who verified through an LDR agent's client link (reel leads use expiryHours). */
  clientLinkExpiryHours: number;
  /** How long an agent's client link can still be opened and verified through. */
  clientLinkDays: number;
  /** Best Deals: the 30-year market rate a payment is figured at when the builder offers no rate. */
  paymentMarketRate: number;
  /** Best Deals: the down payment assumed when the builder's offer does not state one (percent). */
  paymentDownPercent: number;
  /** Best Deals: builders never featured (still listed). */
  featuredExcludedBuilders: string[];
  /** Best Deals payment: total property tax, percent of price a year. */
  paymentTaxRate: number;
  /** Best Deals payment: homeowners insurance, percent of price a year. */
  paymentInsuranceRate: number;
  /** Best Deals payment: HOA dues, dollars a month. */
  paymentHoaMonthly: number;
  /** Best Deals payment: annual mortgage insurance under 20% down, percent of the loan. */
  paymentMortgageInsuranceRate: number;
  /** Area map circle on the private list, in miles, around the ZIP code centroid. */
  areaMapRadiusMiles: number;
  /** Area map circle on the public landing card (wider, zoomed out). */
  publicAreaMapRadiusMiles: number;
  /** How often each community's builder page is pulled again, in Chicago calendar days. */
  catalogRefreshDays: number;
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
  fubRealtorTags: ["Recruit - Website", "Agent - Blocked", "Agent - FUB Match", "Possible Agent - Email Domain", "Recruit"],
  fubRealtorSources: ["New Agent Inquiry", "Agent Scouting"],
  handleKeywords: ["realtor", "realty", "homes", "sells", "estate", "broker", "exprealty", "kw", "compass"],
  trecCounties: ["Bexar", "Comal", "Guadalupe", "Wilson", "Medina", "Kendall", "Atascosa", "Bandera", "Travis", "Williamson", "Hays", "Bastrop", "Caldwell"],
  alertRecipients: ["peter@lifestyledesignrealty.com", "steven@lifestyledesignrealty.com"],
  alertMode: "immediate",
  syncEmailRecipients: ["peter@lifestyledesignrealty.com"],
  driveDestinations: ["downtown San Antonio", "Randolph AFB", "Lackland AFB", "The Pearl"],
  clientLinkExpiryHours: 24 * 7,
  clientLinkDays: 30,
  // Freddie Mac's 30-year average was 7.4% in mid-October 2026; Admin updates it as rates move.
  paymentMarketRate: 7.4,
  paymentDownPercent: 5,
  featuredExcludedBuilders: ["Lennar"],
  paymentTaxRate: 3,
  paymentInsuranceRate: 1.2,
  paymentHoaMonthly: 60,
  paymentMortgageInsuranceRate: 0.55,
  areaMapRadiusMiles: 5,
  publicAreaMapRadiusMiles: 8,
  catalogRefreshDays: 1,
};

/** Operational owner alerts go through the one Builder Deals email transport (owner notification is its fallback). */
function sendOperationalAlert(settings: DealSettings, category: string, subject: string, content: string) {
  void sendBuilderDealsEmail({ category, recipients: settings.alertRecipients, subject, content }).catch(console.error);
}

const SETTINGS_KEY = "builder_deals";
const PENDING_MINUTES = 10;

export function hashSecret(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** Without a cookie secret (a misconfigured deployment) the handles are keyed per process: never computable from a listing URL or row id, just not stable across restarts. */
const FALLBACK_HANDLE_KEY = crypto.randomBytes(32).toString("hex");
/** An opaque handle (hex) for a value the browser must not be able to compute from public facts (a listing URL, a row id). */
export function dealsHandle(value: string, length: number): string {
  return crypto.createHmac("sha256", process.env.JWT_SECRET || FALLBACK_HANDLE_KEY).update(value).digest("hex").slice(0, length);
}
/** A home's card handle on the signed-up list (save, request, viewed). */
export const dealsCardHandle = (sourceKey: string) => dealsHandle(`deals-card:${sourceKey}`, 20);

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
    const parsed = JSON.parse(row.value) as Partial<DealSettings> & { alertMode?: unknown };
    const alertMode = parsed.alertMode === "hourly_digest" ? "hourly_digest" : "immediate";
    // Preserve the previous stored label while exposing only the clearer,
    // requested immediate/hourly modes to the current admin surface.
    return { ...DEFAULT_SETTINGS, ...parsed, alertMode };
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
  if (settings.alertRecipients) {
    const recipients = Array.from(new Set(settings.alertRecipients.map((value) => value.trim().toLowerCase()).filter(Boolean)));
    if (!recipients.length || recipients.length > 20 || recipients.some((value) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) {
      throw new Error("Enter one to twenty valid Builder Deals alert email addresses");
    }
    merged.alertRecipients = recipients;
  }
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

/** Stable Chicago calendar identity used for jobs, requests, and daily caps. */
export function chicagoDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (key: string) => parts.find((part) => part.type === key)?.value || "00";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/** Chicago wall-clock values; never derive schedules from fixed UTC offsets. */
export function chicagoClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(now);
  const value = (key: string) => parts.find((part) => part.type === key)?.value || "";
  return { hour: Number(value("hour")), minute: Number(value("minute")), weekday: value("weekday") };
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
      sendOperationalAlert(settings, "deals_verify_cap", "Builder Deals verification cap reached", `The Builder Deals daily Verify cap (${settings.dailyVerificationCap}) refused a code request. Review or raise the cap in Admin, Builder Deals: /admin/deals.`);
    }
    return { ok: false, kind: "daily_cap" };
  }
  await logDealEvent({
    kind: "code_sent", sourceCode: input.sourceCode, deviceHash: input.deviceHash, ip: input.ip,
    phone: input.phone, detail: `channel:${input.channel};${input.isTest ? "TEST" : "live"}`,
  });
  const nextCount = dailyCount + 1;
  // Concurrent reads can skip the exact 300th count, so the threshold is a
  // floor. `deal_job_runs` has a (job, Chicago day) unique key: claiming it
  // first makes the alert fire exactly once per day however many requests cross it.
  if (nextCount >= Math.min(300, settings.dailyVerificationCap)) {
    try {
      await db.insert(dealJobRuns).values({ jobName: "builder-deals-verify-threshold", chicagoDay: chicagoDay(), status: "running" });
      void sendBuilderDealsEmail({ category: "deals_verify_threshold", recipients: settings.alertRecipients, subject: "Builder Deals Verify threshold reached", content: `Builder Deals reached ${nextCount} verification sends today. Review safety settings or raise the cap in Admin, Builder Deals: /admin/deals.` }).finally(() => db.update(dealJobRuns).set({ status: "ok", completedAt: new Date() }).where(and(eq(dealJobRuns.jobName, "builder-deals-verify-threshold"), eq(dealJobRuns.chicagoDay, chicagoDay())))).catch(console.error);
    } catch { /* an already-claimed daily threshold alert is intentionally silent */ }
  }
  return { ok: true, dailyCount: nextCount };
}

/** Server-side de-duplication prevents focus/remount activity inflating funnel data. */
/** Landing and gate-focus analytics rows one address may write per hour (a shared office or carrier NAT stays well under it). */
export const ANALYTICS_EVENTS_PER_IP_HOUR = 60;

export async function recordGateFocus(input: { sourceCode: string; deviceHash: string; ip: string }) {
  const db = await getDb();
  if (!db) return;
  const recent = (await db.select({ id: dealEvents.id }).from(dealEvents).where(and(
    eq(dealEvents.kind, "started_gate"), eq(dealEvents.deviceHash, input.deviceHash),
    eq(dealEvents.sourceCode, input.sourceCode), gt(dealEvents.createdAt, new Date(Date.now() - 60 * 60_000)),
  )).limit(1))[0];
  // One address writes at most this many analytics rows an hour: a script without cookies cannot fill the events table.
  if (!recent && (await rateLimitCount("started_gate", new Date(Date.now() - 60 * 60_000), { ip: input.ip })) < ANALYTICS_EVENTS_PER_IP_HOUR) await logDealEvent({ kind: "started_gate", ...input });
}

/** Every real Verify send has a terminal outcome. Normal STOP/landline refusals
 * break an API-error streak but do not themselves count as account failures. */
export async function recordTwilioVerifyOutcome(input: { sourceCode: string; deviceHash: string; ip: string; phone?: string; outcome: "success" | "rejected" | "error" }) {
  const { outcome, ...event } = input;
  if (outcome === "error") return recordTwilioVerifyFailure(event);
  await logDealEvent({ kind: outcome === "success" ? "twilio_verify_success" : "twilio_verify_rejected", ...event });
}

/** Account/API failures only; alert on three consecutive terminal API errors. */
export async function recordTwilioVerifyFailure(input: { sourceCode: string; deviceHash: string; ip: string; phone?: string }) {
  const db = await getDb(); if (!db) return;
  await logDealEvent({ kind: "twilio_api_error", ...input });
  const outcomes = await db.select({ kind: dealEvents.kind }).from(dealEvents).where(and(
    gt(dealEvents.createdAt, new Date(Date.now() - 60 * 60_000)),
    inArray(dealEvents.kind, ["twilio_api_error", "twilio_verify_success", "twilio_verify_rejected"]),
  )).orderBy(desc(dealEvents.createdAt), desc(dealEvents.id));
  const sends = outcomes.length;
  const errors = outcomes.filter((row) => row.kind === "twilio_api_error").length;
  const consecutive = outcomes.slice(0, 3).length === 3 && outcomes.slice(0, 3).every((row) => row.kind === "twilio_api_error");
  const alertSent = (await db.select({ id: dealEvents.id }).from(dealEvents).where(and(eq(dealEvents.kind, "twilio_alert"), gt(dealEvents.createdAt, new Date(Date.now() - 6 * 60 * 60_000)))).limit(1))[0];
  if (!alertSent && (consecutive || (sends >= 10 && errors / sends > 0.2))) {
    await logDealEvent({ kind: "twilio_alert", sourceCode: input.sourceCode, deviceHash: input.deviceHash, ip: input.ip, detail: `sends:${sends};errors:${errors}` });
    const settings = await getDealSettings();
    sendOperationalAlert(settings, "deals_twilio_alert", "Builder Deals Twilio Verify alert", `Verify API/account errors need attention. Last hour: ${errors} API errors across ${sends} attempts. Review Admin, Builder Deals: /admin/deals.`);
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
  if (!recent && (await rateLimitCount("landed", new Date(Date.now() - 60 * 60_000), { ip: input.ip })) < ANALYTICS_EVENTS_PER_IP_HOUR) await logDealEvent({ kind: "landed", ...input });
}

/** The reason written when a visitor answers "Yes" to the agent question; an LDR agent's own client is exempt from it. */
export const HAS_AGENT_BLOCK_REASON = "Confirmed working with an agent";
/** Reasons the automatic realtor screening writes. An agent's own client is exempt from these; an admin's block is not. */
const SCREENING_BLOCK_REASONS = new Set([HAS_AGENT_BLOCK_REASON, "has_agent", "known_agent", "fub_realtor", "brokerage_domain", "post_verification", "realtor screening"]);
/** Every stored form of a screening reason: the reason itself and its 24 h device cooldown row. */
const SCREENING_REASON_VALUES = Array.from(SCREENING_BLOCK_REASONS).flatMap((reason) => [reason, `${reason} device cooldown`]);
export function isScreeningBlockReason(reason: string) {
  return SCREENING_BLOCK_REASONS.has(reason) || (reason.endsWith(" device cooldown") && SCREENING_BLOCK_REASONS.has(reason.slice(0, -" device cooldown".length)));
}

export async function getActiveBlock(input: { phone?: string; email?: string; deviceHash?: string; ignoreHasAgent?: boolean }) {
  const db = await getDb();
  if (!db) return undefined;
  const matches = [
    input.phone ? eq(dealBlocklist.phoneE164, input.phone) : undefined,
    input.email ? eq(dealBlocklist.email, input.email.toLowerCase()) : undefined,
    input.deviceHash ? eq(dealBlocklist.deviceHash, input.deviceHash) : undefined,
  ].filter(Boolean) as any[];
  if (!matches.length) return undefined;
  const now = new Date();
  // An agent's client: the screening reasons are excluded in SQL, so no number of them can hide an admin block.
  const screening = input.ignoreHasAgent ? [notInArray(dealBlocklist.reason, SCREENING_REASON_VALUES)] : [];
  return (await db.select().from(dealBlocklist).where(and(or(...matches), or(isNull(dealBlocklist.expiresAt), gt(dealBlocklist.expiresAt, now)), ...screening)).limit(1))[0];
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

/** Private per-community scrub categories (admin-excluded false positives removed); a legacy flat list lands in "other". */
export function communityScrubConfig(community: Pick<typeof dealCommunities.$inferSelect, "builder" | "privateName" | "scrubList">): DealScrubConfig {
  const config = effectiveScrubConfig(community.scrubList);
  if (community.builder !== "Manual" && !config.builder.some((term) => term.toLowerCase() === community.builder.toLowerCase())) config.builder.push(community.builder);
  if (!config.community.some((term) => term.toLowerCase() === community.privateName.toLowerCase())) config.community.push(community.privateName);
  return config;
}

/**
 * The currently displayable incentive: active, not held, not past its date and,
 * when it has no dates, re-confirmed within the lapse window. Evaluated at
 * render time so a rate never stays up past its date between scheduled jobs.
 */
function liveIncentiveWhere(communityIds: number[], now: Date, lapseDays: number) {
  const lapseCutoff = new Date(now.getTime() - lapseDays * 24 * 60 * 60_000);
  return and(
    inArray(dealIncentives.communityId, communityIds),
    eq(dealIncentives.active, true),
    eq(dealIncentives.held, false),
    or(and(isNull(dealIncentives.expiresAt), gt(dealIncentives.confirmedAt, lapseCutoff)), gt(dealIncentives.expiresAt, now)),
  );
}

/** The newest live incentive of each community, in one read for the whole list. */
async function liveIncentivesByCommunity(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, communityIds: number[], now: Date, lapseDays: number) {
  const byCommunity = new Map<number, typeof dealIncentives.$inferSelect>();
  if (!communityIds.length) return byCommunity;
  const rows = await db.select().from(dealIncentives).where(liveIncentiveWhere(communityIds, now, lapseDays)).orderBy(desc(dealIncentives.confirmedAt), desc(dealIncentives.id));
  for (const row of rows) if (!byCommunity.has(row.communityId)) byCommunity.set(row.communityId, row);
  return byCommunity;
}

/**
 * Communities whose current offer is held for a publication rule (shared/dealsHeldIncentive): the buyer pages show
 * the neutral "Builder incentive available" line for them, never anything from the held text. Only consulted for a
 * community with no live incentive.
 */
async function heldLineCommunities(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, communityIds: number[], now: Date, lapseDays: number): Promise<Set<number>> {
  const shown = new Set<number>();
  if (!communityIds.length) return shown;
  const rows = await db.select({ communityId: dealIncentives.communityId, held: dealIncentives.held, holdReason: dealIncentives.holdReason, expiresAt: dealIncentives.expiresAt, confirmedAt: dealIncentives.confirmedAt })
    .from(dealIncentives).where(and(inArray(dealIncentives.communityId, communityIds), eq(dealIncentives.held, true)));
  for (const row of rows) if (heldIncentiveShowsLine(row, now, lapseDays)) shown.add(row.communityId);
  return shown;
}

/** Rows grouped by a numeric key, keeping their order. */
function groupBy<T>(rows: readonly T[], key: (row: T) => number): Map<number, T[]> {
  const grouped = new Map<number, T[]>();
  for (const row of rows) {
    const id = key(row);
    const list = grouped.get(id);
    if (list) list.push(row); else grouped.set(id, [row]);
  }
  return grouped;
}

type ResidueSurface = "public" | "gated";
export const PRIVACY_RESIDUE_EVENT_KIND = "privacy_residue";
const RESIDUE_RECORD_INTERVAL_MS = 60 * 60_000;
/** Since process start: how often each community's entry was dropped, and when its deal_events marker was last written. */
const privacyResidue = new Map<number, { dropped: number; lastRecordedAt: number }>();

export function privacyResidueSinceStart(): { dropped: number; communityIds: number[] } {
  let dropped = 0;
  privacyResidue.forEach((entry) => { dropped += entry.dropped; });
  return { dropped, communityIds: Array.from(privacyResidue.keys()).sort((a, b) => a - b) };
}
/** Test seam for the process-wide counter. */
export function resetPrivacyResidueCounter() { privacyResidue.clear(); }

/** The deal_events detail carries ids and a hash only, never the term or any private name. */
export function privacyResidueDetail(communityId: number, surface: ResidueSurface, marker: string) {
  return `community:${communityId};surface:${surface};marker:${marker}`;
}
export function privacyResidueCommunityId(detail: string | null | undefined): number | null {
  const match = /(?:^|;)community:(\d+)(?:;|$)/.exec(detail ?? "");
  return match ? Number(match[1]) : null;
}

/**
 * A private name that survives scrubbing never reaches a buyer, and never takes
 * the other communities down with it: the offending entry is dropped from the
 * response, counted in memory, logged as a hashed marker and recorded (at most
 * once an hour per community) as a deal_events row the health check reports.
 */
async function dropPrivateResidue(communityId: number, payload: unknown, config: DealScrubConfig, surface: ResidueSurface, now = Date.now()): Promise<boolean> {
  if (publicNoPrivateNames(payload, config)) return false;
  const marker = hashSecret(`privacy-residue:${surface}:${communityId}:${JSON.stringify(payload)}`).slice(0, 16);
  const entry = privacyResidue.get(communityId) ?? { dropped: 0, lastRecordedAt: 0 };
  entry.dropped += 1;
  privacyResidue.set(communityId, entry);
  console.error(`[deals] private residue: community ${communityId} dropped from the ${surface} catalog (marker ${marker})`);
  if (now - entry.lastRecordedAt >= RESIDUE_RECORD_INTERVAL_MS) {
    entry.lastRecordedAt = now;
    await logDealEvent({ kind: PRIVACY_RESIDUE_EVENT_KIND, detail: privacyResidueDetail(communityId, surface, marker) }).catch((error) => console.error("[deals] private residue event failed", error instanceof Error ? error.message : error));
  }
  return true;
}

/**
 * List order for every community in the area: the one whose reel brought the
 * visitor first, then the ones with Peter's reels, then the rest by age.
 */
export function browseOrder<T extends { id: number; reelCode: string; reelUrl: string | null }>(communities: readonly T[], reelCode: string | null | undefined): T[] {
  const code = reelCode?.trim().toLowerCase() || null;
  return [...communities].sort((a, b) =>
    Number(Boolean(code) && b.reelCode.toLowerCase() === code) - Number(Boolean(code) && a.reelCode.toLowerCase() === code)
    || Number(Boolean(b.reelUrl)) - Number(Boolean(a.reelUrl))
    || a.id - b.id);
}

/** The catalog hold a reader gives a community its builder lists as coming soon with nothing for sale. */
export const COMING_SOON_HOLD = "community_coming_soon";
export type ComingSoonEntry = { key: string; area: string; fromPriceLabel: string | null };

/**
 * The Coming Soon section, for every visitor (landing and unlocked list alike): communities a builder lists as
 * coming soon that are not live yet, by area and price band only, never a builder, community name or address.
 * When a read finds homes or plans the hold clears, the first clean sync turns the community on, and it leaves
 * this list for the main one. A paused, manual or admin-switched-off community is never listed.
 */
export async function comingSoonCommunities(): Promise<ComingSoonEntry[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(dealCommunities).where(and(
    eq(dealCommunities.catalogHoldReason, COMING_SOON_HOLD), eq(dealCommunities.active, false), eq(dealCommunities.awaitingFirstSync, true),
    eq(dealCommunities.paused, false), eq(dealCommunities.manualMode, false),
  )).orderBy(asc(dealCommunities.areaLabel), asc(dealCommunities.id));
  const result: ComingSoonEntry[] = [];
  for (const community of rows) {
    const scrubNames = communityScrubConfig(community);
    const entry: ComingSoonEntry = {
      key: dealsHandle(`deals-coming-soon:${community.id}`, 16),
      area: scrubPrivateNames(community.areaLabel, scrubNames).trim(),
      fromPriceLabel: community.fromPrice ? `From the ${priceBandLabel(community.fromPrice)}` : null,
    };
    // An area that needed scrubbing named the community: a placeholder area tells a buyer nothing, so the row is left out.
    if (!entry.area || entry.area !== community.areaLabel.trim()) continue;
    if (await dropPrivateResidue(community.id, entry, scrubNames, "public")) continue;
    result.push(entry);
  }
  return result;
}

export async function publicDealsCatalog(src?: string | null) {
  const db = await getDb();
  if (!db) return [];
  const now = new Date();
  const settings = await getDealSettings();
  const communities = await db.select().from(dealCommunities).where(and(eq(dealCommunities.active, true), eq(dealCommunities.paused, false))).orderBy(asc(dealCommunities.id));
  const { areaMapRadius, areaMapGeometry, communityAreaMap } = await import("./dealsMap");
  const { regionPin } = await import("./dealsRegionMap");
  const { publicPhotoUrl } = await import("./dealsPhotoToken");
  const publicRadius = areaMapRadius(settings, "public");
  const result = [] as Array<{ key: string; label: string; area: string; fromPrice: number | null; fromPriceLabel: string | null; reelUrl: string | null; homesAvailable: number; incentive: (ReturnType<typeof publicIncentive> & { pending?: true }) | null; updatedAt: string | null; areaMap: ReturnType<typeof communityAreaMap>; fromYourReel: boolean; cover: string | null; pin: { x: number; y: number } | null }>;
  if (!communities.length) return result;
  const reelCode = src?.trim().toLowerCase() || null;
  // Two reads for the whole page, however many communities there are.
  const ids = communities.map((community) => community.id);
  const [availableHomes, incentives, heldLine] = await Promise.all([
    db.select({ id: dealHomes.id, communityId: dealHomes.communityId, kind: dealHomes.kind, price: dealHomes.price }).from(dealHomes).where(and(inArray(dealHomes.communityId, ids), eq(dealHomes.status, "available"))).orderBy(asc(dealHomes.price), asc(dealHomes.id)),
    liveIncentivesByCommunity(db, ids, now, settings.incentiveLapseDays),
    heldLineCommunities(db, ids, now, settings.incentiveLapseDays),
  ]);
  const availableCount = new Map<number, number>();
  for (const home of availableHomes) if (home.kind === "quick_move_in") availableCount.set(home.communityId, (availableCount.get(home.communityId) ?? 0) + 1);
  // Each community's cover: the first shown photo of its cheapest shown home (a few homes are tried, cheapest first).
  const homesByCommunity = groupBy(availableHomes, (home) => home.communityId);
  const coverCandidates = new Map<number, number[]>();
  for (const id of ids) coverCandidates.set(id, selectDealCatalogHomes(homesByCommunity.get(id) ?? []).slice(0, 3).map((home) => home.id));
  const candidateIds = Array.from(coverCandidates.values()).flat();
  const coverPhotos = candidateIds.length
    ? await db.select({ id: dealPhotos.id, homeId: dealPhotos.homeId }).from(dealPhotos).where(and(inArray(dealPhotos.homeId, candidateIds), eq(dealPhotos.processingState, "processed"), eq(dealPhotos.automaticHidden, false), eq(dealPhotos.adminHidden, false))).orderBy(asc(dealPhotos.sortOrder), asc(dealPhotos.id))
    : [];
  const firstPhoto = new Map<number, number>();
  for (const photo of coverPhotos) if (!firstPhoto.has(photo.homeId)) firstPhoto.set(photo.homeId, photo.id);

  for (const community of browseOrder(communities, reelCode)) {
    const incentive = incentives.get(community.id);
    // Opaque per community: the page's key for the card, its map marker and its cover photo. Never the row id.
    const key = dealsHandle(`deals-landing:${community.id}`, 12);
    const coverPhoto = (coverCandidates.get(community.id) ?? []).map((homeId) => firstPhoto.get(homeId)).find((id): id is number => id !== undefined);
    const geometry = areaMapGeometry(community, "public", publicRadius);
    const entry = {
      key,
      fromYourReel: Boolean(reelCode) && community.reelCode.toLowerCase() === reelCode,
      label: community.publicLabel,
      area: community.areaLabel,
      // October 24, 2026: prices are public (the address, builder and community name are what sign-up opens).
      fromPrice: community.fromPrice ?? null,
      fromPriceLabel: community.fromPrice ? `From $${community.fromPrice.toLocaleString("en-US")}` : null,
      reelUrl: community.reelUrl,
      homesAvailable: availableCount.get(community.id) ?? 0,
      // The landing card shows the teaser and figures; the full wording and the deadlines wait for sign-up.
      // A held offer shows the neutral line only, never a figure or name from its text.
      // A rate never shows without its APR (rateDisclosedIncentive).
      incentive: incentive ? (() => { const shown = rateDisclosedIncentive(incentive); return shown ? (({ text: _text, contractBy: _contractBy, closeBy: _closeBy, ...teaser }) => ({ ...teaser, text: teaser.teaser, contractBy: null, closeBy: null }))(publicIncentive(shown, (value) => scrubPrivateNames(value, communityScrubConfig(community)))) : null; })() : heldLine.has(community.id) ? heldIncentivePublicEntry() : null,
      updatedAt: (community.catalogUpdatedAt ?? community.lastSuccessfulSyncAt ?? community.createdAt).toISOString(),
      // A wide circle around the ZIP code centroid: "this side of town", never the community.
      areaMap: communityAreaMap(community, { variant: "public", radiusMiles: publicRadius }),
      // A public render of the cover, by the community's opaque key; null until a photo is ready.
      cover: coverPhoto ? publicPhotoUrl(coverPhoto) : null,
      // The region map marker sits at the same coarse grid cell the public area map is centered on.
      pin: geometry ? regionPin(geometry.center) : null,
    };
    if (await dropPrivateResidue(community.id, entry, communityScrubConfig(community), "public")) continue;
    result.push(entry);
  }
  return result;
}

/**
 * One community's homes for the landing page (October 24, 2026: visitors see every home, its photos and its price
 * before signing up). The same homes the private list shows, with no address, plan, builder or community name and
 * no card handle; photos by sealed public token. Sign-up is what opens the addresses (an agent sends them).
 */
const publicHomesCache = new Map<string, { at: number; value: unknown[] | null }>();
const PUBLIC_HOMES_CACHE_MS = 120_000;
export async function publicCommunityHomes(key: string): Promise<unknown[] | null> {
  if (!/^[a-f0-9]{12}$/.test(key)) return null;
  const cached = publicHomesCache.get(key);
  if (cached && Date.now() - cached.at < PUBLIC_HOMES_CACHE_MS) return cached.value;
  const value = await readPublicCommunityHomes(key);
  if (publicHomesCache.size >= 200) publicHomesCache.delete(publicHomesCache.keys().next().value as string);
  publicHomesCache.set(key, { at: Date.now(), value });
  return value;
}

async function readPublicCommunityHomes(key: string): Promise<unknown[] | null> {
  const db = await getDb();
  if (!db) return null;
  const communities = await db.select().from(dealCommunities).where(and(eq(dealCommunities.active, true), eq(dealCommunities.paused, false)));
  const community = communities.find((row) => dealsHandle(`deals-landing:${row.id}`, 12) === key);
  if (!community) return null;
  const { publicPhotoUrl } = await import("./dealsPhotoToken");
  const homes = selectDealCatalogHomes(await db.select().from(dealHomes).where(and(eq(dealHomes.communityId, community.id), eq(dealHomes.status, "available"))).orderBy(asc(dealHomes.price), asc(dealHomes.id)));
  const photoRows = homes.length
    ? await db.select({ id: dealPhotos.id, homeId: dealPhotos.homeId }).from(dealPhotos).where(and(inArray(dealPhotos.homeId, homes.map((home) => home.id)), eq(dealPhotos.processingState, "processed"), eq(dealPhotos.automaticHidden, false), eq(dealPhotos.adminHidden, false))).orderBy(asc(dealPhotos.sortOrder), asc(dealPhotos.id))
    : [];
  const photosBy = groupBy(photoRows, (photo) => photo.homeId);
  const result = homes.map((home, index) => {
    const photos = photosBy.get(home.id) ?? [];
    return {
      // Position on this page only: never an id, a source key or a card handle.
      card: `${key}-${index}`,
      kind: home.kind,
      beds: home.beds,
      baths: home.baths,
      sqft: home.sqft,
      price: home.price,
      previousPrice: home.previousPrice,
      moveInDate: home.moveInDate,
      lotSize: home.lotSize,
      photos: photos.map((photo) => publicPhotoUrl(photo.id)),
      photoCount: photos.length,
      photosOnRequest: photos.length === 0,
    };
  });
  // The same residue check as every public surface: a private name anywhere in the payload drops it.
  if (await dropPrivateResidue(community.id, { homes: result }, communityScrubConfig(community), "public")) return null;
  return result;
}

/** Test seam only. */
export function resetPublicHomesCache() {
  publicHomesCache.clear();
}

/**
 * Reg Z on every buyer surface (1026.24(c), (d)): a rate, and any triggering term (a payment amount, a down payment, a
 * number of payments or a repayment period), is printed only beside its APR. A live record with no stored APR shows
 * only its sentences that state neither; its rate, follow-on, down payment and repayment-term fields are left out.
 * Nothing left means no incentive at all. A record with an APR is returned as it is.
 */
export function rateDisclosedIncentive<T extends Pick<typeof dealIncentives.$inferSelect, "publicText" | "headlineRate" | "followOnRate" | "followOnPeriod" | "apr" | "downPayment" | "repaymentTerms">>(row: T): T | null {
  if (normalizeRateFigure(row.apr)) return row;
  const discloses = (sentence: string) => mentionsRate(sentence) || mentionsTriggeringTerm(sentence);
  const kept = row.publicText.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=["“(]?[A-Z0-9$])/).filter((sentence) => sentence.trim() && !discloses(sentence)).join(" ").trim();
  if (!/[A-Za-z]/.test(kept)) return null;
  return { ...row, publicText: kept, headlineRate: null, followOnRate: null, followOnPeriod: null, downPayment: null, repaymentTerms: null };
}

/**
 * The incentive as a buyer may see it. The typed loan type becomes the program
 * name only (FHA, VA, USDA, Conventional, Jumbo), never a lender's name; the
 * other typed fields are scrubbed with the community's list. The team
 * (`full`) sees what the admin typed.
 */
function publicIncentive(row: typeof dealIncentives.$inferSelect, scrub: (value: string) => string = (value) => value, full = false) {
  // The landing shows the sentence that names the rate, without its dates;
  // the full wording, the homes it names and the deadlines stay in `text` for
  // the verified personal list.
  const teaser = incentiveTeaser(row.publicText);
  return {
    text: row.publicText,
    teaser,
    // Rows stored before the figure-only rule, and admin-typed values, may
    // still carry their own "APR" or "rate" label; the card prints the label.
    headlineRate: normalizeRateFigure(row.headlineRate),
    followOnRate: normalizeRateFigure(row.followOnRate),
    followOnPeriod: row.followOnPeriod ? scrub(row.followOnPeriod) : row.followOnPeriod,
    apr: normalizeRateFigure(row.apr),
    loanType: full ? row.loanType : loanTypeLabel(row.loanType),
    downPayment: row.downPayment ? scrub(row.downPayment) : row.downPayment,
    repaymentTerms: row.repaymentTerms ? scrub(row.repaymentTerms) : row.repaymentTerms,
    contractBy: row.contractBy?.toISOString() ?? null,
    closeBy: row.closeBy?.toISOString() ?? null,
  };
}

/**
 * Which list a session gets. The gated list is the reel buyer's: private names
 * scrubbed and residue dropped. The full list is for the team and for buyers an
 * LDR agent sent through a client link: the builder, community, address and
 * plan are shown (names stay off the page markup only through the gate itself),
 * and the builder's own page link is added for the team alone.
 */
export type DealsCatalogView = { view: "gated" } | { view: "full"; builderPages: boolean };

/**
 * Team sessions and buyers whose agent link is still live (not turned off,
 * agent still on the team) see the full list; everyone else the scrubbed one.
 * The live agent comes back with it so the page can name them.
 */
export async function catalogViewForSession(lead: Pick<typeof dealLeads.$inferSelect, "id" | "status" | "agentTeamId" | "clientLinkId">): Promise<{ view: DealsCatalogView; agent: import("./dealsClientLinks").DealsAgent | null }> {
  if (lead.status === "team") return { view: { view: "full", builderPages: true }, agent: null };
  const { liveAgentForClient } = await import("./dealsClientLinks");
  const agent = await liveAgentForClient(lead);
  return agent ? { view: { view: "full", builderPages: false }, agent } : { view: { view: "gated" }, agent: null };
}

export async function gatedDealsCatalog(leadId: number, view: DealsCatalogView = { view: "gated" }) {
  const db = await getDb();
  if (!db) return [];
  const lead = (await db.select().from(dealLeads).where(eq(dealLeads.id, leadId)).limit(1))[0];
  if (!lead || !["verified", "team"].includes(lead.status) || lead.expiresAt <= new Date()) return [];
  const full = view.view === "full";
  const now = new Date();
  const settings = await getDealSettings();
  const { areaMapRadius, communityAreaMap } = await import("./dealsMap");
  const gatedRadius = areaMapRadius(settings, "gated");
  const communities = await db.select().from(dealCommunities).where(and(eq(dealCommunities.active, true), eq(dealCommunities.paused, false))).orderBy(asc(dealCommunities.id));
  const data = [] as unknown[];
  if (!communities.length) return data;
  // Three reads for the whole list (incentives, homes, photos), however many communities there are.
  const ids = communities.map((community) => community.id);
  const [incentives, allHomes, heldLine] = await Promise.all([
    liveIncentivesByCommunity(db, ids, now, settings.incentiveLapseDays),
    db.select().from(dealHomes).where(and(inArray(dealHomes.communityId, ids), eq(dealHomes.status, "available"))).orderBy(asc(dealHomes.price), asc(dealHomes.id)),
    heldLineCommunities(db, ids, now, settings.incentiveLapseDays),
  ]);
  const homesBy = groupBy(allHomes, (home) => home.communityId);
  const shownHomes = new Map(communities.map((community) => [community.id, selectDealCatalogHomes(homesBy.get(community.id) ?? [])]));
  const shownHomeIds = Array.from(shownHomes.values()).flatMap((homes) => homes.map((home) => home.id));
  const photoRows = shownHomeIds.length
    ? await db.select({ id: dealPhotos.id, homeId: dealPhotos.homeId }).from(dealPhotos).where(and(inArray(dealPhotos.homeId, shownHomeIds), eq(dealPhotos.processingState, "processed"), eq(dealPhotos.automaticHidden, false), eq(dealPhotos.adminHidden, false))).orderBy(asc(dealPhotos.sortOrder), asc(dealPhotos.id))
    : [];
  const photosBy = groupBy(photoRows, (photo) => photo.homeId);
  for (const community of browseOrder(communities, lead.sourceCode)) {
    const scrubNames = communityScrubConfig(community);
    const scrub = (value: string) => full ? value : scrubPrivateNames(value, scrubNames);
    const incentive = incentives.get(community.id);
    const homes = [] as Array<Record<string, unknown>>;
    // Quick move-ins win; To Be Built cards appear only when there are none.
    for (const home of shownHomes.get(community.id) ?? []) {
      const photos = photosBy.get(home.id) ?? [];
      homes.push({
        // Opaque, deterministic card handle for React only. It is not a
        // builder listing ID, database ID, source URL, or reversible key.
        card: dealsCardHandle(home.sourceKey),
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
        ...(full ? { details: { address: home.privateAddress, planName: home.privatePlanName, builderPage: view.builderPages && /^https?:\/\//i.test(home.sourceUrl) ? builderPageFor(home.sourceUrl) : null } } : {}),
      });
    }
    const entry = {
      // The community whose reel this buyer commented on opens first on their list.
      fromYourReel: Boolean(lead.sourceCode) && community.reelCode.toLowerCase() === lead.sourceCode.toLowerCase(),
      // Opaque handle the page keys its open/closed state on.
      key: dealsHandle(`deals-community:${community.id}`, 16),
      label: scrub(community.publicLabel),
      area: scrub(community.areaLabel),
      schoolDistrict: scrub(community.schoolDistrict ?? ""),
      lotSizes: scrub(community.lotSizes ?? ""),
      amenities: (JSON.parse(community.amenities ?? "[]") as string[]).map(scrub),
      driveTimes: (JSON.parse(community.driveTimeChips ?? "[]") as string[]).map(scrub),
      // Only the ZIP centroid and radius; never the community's own coordinates.
      areaMap: communityAreaMap(community, { radiusMiles: gatedRadius }),
      fromPrice: community.fromPrice,
      reelUrl: community.reelUrl,
      updatedAt: (community.catalogUpdatedAt ?? community.lastSuccessfulSyncAt ?? community.createdAt).toISOString(),
      // A held offer shows the neutral line only (the team reads the held text in Admin).
      incentive: incentive ? (() => { const shown = rateDisclosedIncentive(incentive); return shown ? publicIncentive(shown, scrub, full) : null; })() : heldLine.has(community.id) ? heldIncentivePublicEntry() : null,
      homes,
      ...(full ? { details: { builderName: community.builder === "Manual" ? null : community.builder, communityName: community.privateName, address: community.privateAddress || null, salesLine: view.builderPages ? community.salesPhone : null, builderPage: view.builderPages && /^https?:\/\//i.test(community.sourceUrl) ? community.sourceUrl : null } } : {}),
    };
    if (!full && await dropPrivateResidue(community.id, entry, scrubNames, "gated")) continue;
    data.push(entry);
  }
  return data;
}

/** Opaque card handles of the homes this lead currently has saved. */
export async function savedDealCards(leadId: number): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const saves = await db.select({ homeId: dealTourRequests.homeId }).from(dealTourRequests).where(and(eq(dealTourRequests.leadId, leadId), eq(dealTourRequests.requestType, "save"), isNull(dealTourRequests.removedAt)));
  if (!saves.length) return [];
  const homes = await db.select({ sourceKey: dealHomes.sourceKey }).from(dealHomes).where(inArray(dealHomes.id, Array.from(new Set(saves.map((save) => save.homeId)))));
  return homes.map((home) => dealsCardHandle(home.sourceKey));
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

/**
 * A buyer keeps the session cookie 30 days past their access. A lapsed cookie
 * unlocks nothing (the session row has expired). For an agent's client it names
 * their agent's link, so they go back through it instead of the reel gate and
 * its "are you working with an agent" question; for a reel buyer it shows the
 * expired screen (comment again or reach out) when they come back from a
 * bookmark instead of a fresh DM link. Team sessions end with their access.
 */
const LAPSED_SESSION_COOKIE_GRACE_SECONDS = 30 * 24 * 60 * 60;
function sessionCookieSeconds(expiresAt: Date, keepAfterExpiry: boolean) {
  return Math.max(60, Math.floor((expiresAt.getTime() - Date.now()) / 1000)) + (keepAfterExpiry ? LAPSED_SESSION_COOKIE_GRACE_SECONDS : 0);
}

/** The lead behind this browser's session cookie even after it lapsed or was revoked; used only to keep an agent's link on the expired page. */
export async function staleSessionLeadId(req: Request): Promise<number | null> {
  const token = parseCookie(req.headers.cookie || "")[DEALS_COOKIE.session];
  const deviceHash = dealDeviceHash(req);
  const db = await getDb();
  if (!token || !deviceHash || !db) return null;
  const row = (await db.select({ leadId: dealAccessTokens.leadId }).from(dealAccessTokens).where(and(eq(dealAccessTokens.kind, "session"), eq(dealAccessTokens.tokenHash, hashSecret(token)), eq(dealAccessTokens.deviceHash, deviceHash))).limit(1))[0];
  return row?.leadId ?? null;
}

/** The live session's row and cookie follow a longer lead expiry (an agent's client link attached mid-session). */
export async function extendLiveSession(req: Request, res: Response, expiresAt: Date) {
  const token = parseCookie(req.headers.cookie || "")[DEALS_COOKIE.session];
  const deviceHash = dealDeviceHash(req);
  const db = await getDb();
  if (!token || !deviceHash || !db) return;
  await db.update(dealAccessTokens).set({ expiresAt }).where(and(eq(dealAccessTokens.kind, "session"), eq(dealAccessTokens.tokenHash, hashSecret(token)), eq(dealAccessTokens.deviceHash, deviceHash), isNull(dealAccessTokens.revokedAt)));
  setDealCookie(res, DEALS_COOKIE.session, token, sessionCookieSeconds(expiresAt, true));
}

export async function issueAccessToken(leadId: number, deviceHash: string, expiresAt: Date): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const token = randomOpaqueToken(32);
  await db.insert(dealAccessTokens).values({ leadId, tokenHash: hashSecret(token), deviceHash, expiresAt, kind: "exchange" });
  return token;
}

/** "ok_team" is a live team session: the redirect goes to the agent tools instead of the buyer list. */
export async function exchangeAccessToken(req: Request, res: Response, rawToken: string): Promise<"ok" | "ok_team" | "needs_gate" | "expired" | "cookie_blocked"> {
  const cookieState = ensureDealsCookies(req, res);
  if (!cookieState.hasProbe) return "cookie_blocked";
  const deviceHash = cookieState.deviceHash;
  const db = await getDb();
  if (!db) return "needs_gate";
  const token = (await db.select().from(dealAccessTokens).where(and(eq(dealAccessTokens.kind, "exchange"), eq(dealAccessTokens.tokenHash, hashSecret(rawToken)))).limit(1))[0];
  if (!token || token.revokedAt || token.expiresAt <= new Date()) return "expired";
  if (token.deviceHash !== deviceHash) return "needs_gate";
  if (token.consumedAt) {
    const live = await isLiveDealSession(req);
    return live ? (live.lead.status === "team" ? "ok_team" : "ok") : "expired";
  }
  const lead = (await db.select().from(dealLeads).where(eq(dealLeads.id, token.leadId)).limit(1))[0];
  if (!lead || lead.expiresAt <= new Date() || !["verified", "team"].includes(lead.status)) return "expired";
  const session = randomOpaqueToken(32);
  await db.insert(dealAccessTokens).values({ leadId: lead.id, tokenHash: hashSecret(session), deviceHash, expiresAt: lead.expiresAt, kind: "session" });
  if (!token.consumedAt) await db.update(dealAccessTokens).set({ consumedAt: new Date() }).where(eq(dealAccessTokens.id, token.id));
  setDealCookie(res, DEALS_COOKIE.session, session, sessionCookieSeconds(lead.expiresAt, lead.status !== "team"));
  return lead.status === "team" ? "ok_team" : "ok";
}

/** Buyers an LDR agent sent carry this source; it is never one of the reel codes. */
export const AGENT_CLIENT_SOURCE = "agent";

export async function createPendingVerification(input: { req: Request; res: Response; rawPhone: string; choice: "buyer" | "has_agent"; source?: string | null; ig?: string | null; clientLinkToken?: string | null }) {
  const settings = await getDealSettings();
  const normalized = normalizeUsPhone(input.rawPhone, { allowCanada: settings.allowCanada });
  if (!normalized.ok) return { ok: false as const, kind: normalized.reason === "outside_us" ? "outside_us" : "invalid_phone" };
  const { deviceHash, hasProbe } = ensureDealsCookies(input.req, input.res);
  if (!hasProbe) return { ok: false as const, kind: "cookie_blocked" };
  const ip = realClientIp(input.req);
  const ig = sanitizeInstagramHandle(input.ig);
  const google = getGoogleDealsIdentity(input.req);
  const isTest = settings.testNumbers.includes(normalized.e164);
  // An agent's client link wins over any reel code on the same URL. It opens
  // only for its own client (the number the agent typed, or the first number
  // that verified through it); a dead link or another number is told so and
  // never falls through to the realtor question. Team members pass either way.
  const { clientLinkForPhone, teamRowsForLead } = await import("./dealsClientLinks");
  const linkCheck = input.clientLinkToken ? await clientLinkForPhone(input.clientLinkToken, normalized.e164) : null;
  if (linkCheck && !linkCheck.ok) {
    const teamMember = settings.testTeamNumbers.includes(normalized.e164) || (await teamRowsForLead({ phoneE164: normalized.e164, email: google?.email ?? null })).length > 0;
    if (!teamMember) {
      await logDealEvent({ kind: "client_link_refused", sourceCode: AGENT_CLIENT_SOURCE, deviceHash, ip, phone: normalized.e164, detail: linkCheck.kind });
      return { ok: false as const, kind: linkCheck.kind === "other_phone" ? "link_other_phone" as const : "link_dead" as const, agentName: linkCheck.agentName };
    }
  }
  const clientLink = linkCheck?.ok ? linkCheck.resolved : null;
  const sourceCode = input.clientLinkToken ? AGENT_CLIENT_SOURCE : currentDealSource(input.source, settings);
  const { classifyDealsAccess } = await import("./dealsEligibility");
  const eligibility = await classifyDealsAccess({
    phone: normalized.e164, email: google?.email, deviceHash, isTest,
    testSkipChecks: settings.testNumbersSkipChecks, testTeamNumbers: settings.testTeamNumbers,
    brokerageDomains: settings.brokerageDomains, fubRealtorTags: settings.fubRealtorTags,
    fubRealtorSources: settings.fubRealtorSources, choice: input.clientLinkToken ? "buyer" : input.choice, clientLink: Boolean(clientLink),
  });
  // Staff/test previews must not create an accidental "has agent" device
  // block merely because they test the visible confirmation choice.
  if (input.choice === "has_agent" && !eligibility.team) {
    await blockDealAccess({ searchPhone: normalized.e164, deviceHash, reason: HAS_AGENT_BLOCK_REASON, expiresAt: new Date(Date.now() + (isTest ? 10 * 60_000 : settings.hasAgentBlockDays * 86400_000)) });
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
  // An agent vouches for their own client: no "possible agent" profile flags for them.
  const profileFlags = eligibility.team || clientLink ? [] : await profileRealtorFlags({
    name: google?.name,
    instagramHandle: ig,
    handleKeywords: settings.handleKeywords,
    trecCounties: settings.trecCounties,
  });

  const db = await getDb();
  if (!db) return { ok: false as const, kind: "unavailable" };
  const opaque = randomOpaqueToken(24);
  // A team member who opens a client link is still the team member: the link is not attached.
  const clientLinkRef = clientLink && !eligibility.team ? { clientLinkId: clientLink.link.id, agentTeamId: clientLink.agent.teamId } : {};
  await db.insert(dealPendingVerifications).values({
    opaqueIdHash: hashSecret(opaque), phoneE164: normalized.e164, choice: "buyer", sourceCode, instagramHandle: ig,
    deviceHash, clientIp: ip, consentAt: new Date(), flags: JSON.stringify({ google, flags: [...eligibility.flags, ...profileFlags], team: eligibility.team, ...clientLinkRef }), expiresAt: new Date(Date.now() + PENDING_MINUTES * 60_000),
  });
  await logDealEvent({ kind: "consent", sourceCode, deviceHash, ip, phone: normalized.e164, detail: DEALS_CONSENT_TEXT });
  setDealCookie(input.res, DEALS_COOKIE.pending, opaque, PENDING_MINUTES * 60);
  return { ok: true as const, pendingId: opaque, phone: normalized.e164, displayPhone: normalized.display, isTest, settings, sourceCode, deviceHash, ip, clientLink: Boolean(clientLink) };
}

async function lookupPending(req: Request) {
  const opaque = parseCookie(req.headers.cookie || "")[DEALS_COOKIE.pending];
  const deviceHash = dealDeviceHash(req);
  if (!opaque || !deviceHash) return null;
  const db = await getDb();
  if (!db) return null;
  return (await db.select().from(dealPendingVerifications).where(and(eq(dealPendingVerifications.opaqueIdHash, hashSecret(opaque)), eq(dealPendingVerifications.deviceHash, deviceHash), gt(dealPendingVerifications.expiresAt, new Date()))).limit(1))[0] ?? null;
}

export async function currentPending(req: Request) {
  const pending = await lookupPending(req);
  if (!pending) return null;
  try { if (JSON.parse(pending.flags || "{}").completed) return null; } catch { /* legacy flags */ }
  return pending;
}

export async function removePending(req: Request, res: Response) {
  const pending = await currentPending(req);
  const db = await getDb();
  if (pending && db) await db.delete(dealPendingVerifications).where(eq(dealPendingVerifications.id, pending.id));
  clearDealCookie(res, DEALS_COOKIE.pending);
}

type VerificationInput = { req: Request; res: Response; code: string; verifiedBy?: "test" | "twilio" };
type VerificationReceipt = { codeHash: string; leadId: number; expiresAt: string; isTeam: boolean; isTest: boolean; fubCheckDeferred: boolean };
type DealWriteDb = any;

/** A post-OTP match owns a verified phone, unlike the unverified typed gate. */
export async function blockVerifiedDealsIdentity(input: { phone: string; email?: string | null; deviceHash: string; reason: string }, connection?: DealWriteDb) {
  const db = connection ?? await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(dealBlocklist).values({ phoneE164: input.phone, email: input.email?.toLowerCase() ?? null, reason: input.reason });
  await db.insert(dealBlocklist).values({ deviceHash: input.deviceHash, reason: `${input.reason} device cooldown`, expiresAt: new Date(Date.now() + 24 * 60 * 60_000) });
  const { revokeNonTeamMatchingDealLinks } = await import("./dealsEligibility");
  await revokeNonTeamMatchingDealLinks(db as never, { phoneE164: input.phone, email: input.email, deviceHash: input.deviceHash });
}

/** Lock the pending row, not the phone: a double tap shares one approval and one
 * exchange token across workers. The retained receipt expires with the pending
 * record and is excluded from state/resend; no raw token or code is stored. */
export async function completeVerification(input: VerificationInput) {
  const opaque = parseCookie(input.req.headers.cookie || "")[DEALS_COOKIE.pending];
  const deviceHash = dealDeviceHash(input.req);
  const db = await getDb();
  if (!opaque || !deviceHash || !db) return { ok: false as const, kind: "expired" };
  return db.transaction(async (tx) => {
    const pending = (await tx.select().from(dealPendingVerifications).where(and(
      eq(dealPendingVerifications.opaqueIdHash, hashSecret(opaque)), eq(dealPendingVerifications.deviceHash, deviceHash),
      gt(dealPendingVerifications.expiresAt, new Date()),
    )).limit(1).for("update"))[0];
    return finishVerification(input, pending ?? null, tx);
  });
}

async function finishVerification(input: VerificationInput, pending: typeof dealPendingVerifications.$inferSelect | null, db: DealWriteDb) {
  const deviceHash = dealDeviceHash(input.req);
  if (!pending || !deviceHash) return { ok: false as const, kind: "expired" };
  const settings = await getDealSettings();
  const isTest = settings.testNumbers.includes(pending.phoneE164);
  const identity = JSON.parse(pending.flags || "{}") as { google?: GoogleDealsIdentity; flags?: string[]; team?: boolean; completed?: VerificationReceipt; clientLinkId?: number; agentTeamId?: number };
  const storedLink = Number.isSafeInteger(identity.clientLinkId) && Number.isSafeInteger(identity.agentTeamId) ? { linkId: identity.clientLinkId as number, agentTeamId: identity.agentTeamId as number } : null;
  const cookies = parseCookie(input.req.headers.cookie || "");
  // Both cookie values are high-entropy, HTTP-only, device-bound secrets. This
  // stable value lets a concurrent response redirect to the very same link.
  const token = hashSecret(`deals-verified:${cookies[DEALS_COOKIE.pending]}:${cookies[DEALS_COOKIE.device]}`);
  if (identity.completed) {
    const receipt = identity.completed;
    const lead = (await db.select().from(dealLeads).where(eq(dealLeads.id, receipt.leadId)).limit(1))[0];
    if (receipt.codeHash !== hashSecret(input.code)) return { ok: false as const, kind: "invalid_code" };
    if (!lead || lead.revokedAt || !["verified", "team"].includes(lead.status) || lead.expiresAt <= new Date()) return { ok: false as const, kind: "expired" };
    clearDealCookie(input.res, DEALS_COOKIE.pending);
    return { ok: true as const, token, leadId: lead.id, expiresAt: lead.expiresAt, firstUnlock: false, reverifiedActive: true, isTeam: lead.status === "team", isTest: receipt.isTest, fubCheckDeferred: receipt.fubCheckDeferred, duplicate: true, clientLinkAttached: null };
  }
  const expectedTestCode = process.env.DEALS_TEST_OTP?.trim();
  if (isTest && input.code === expectedTestCode) {
    input.verifiedBy = "test";
  } else if (input.verifiedBy !== "twilio" && !await checkTwilioVerify(pending.phoneE164, input.code)) {
    await db.update(dealPendingVerifications).set({ wrongCodes: pending.wrongCodes + 1 }).where(eq(dealPendingVerifications.id, pending.id));
    if (pending.wrongCodes + 1 >= 5) {
      await db.delete(dealPendingVerifications).where(eq(dealPendingVerifications.id, pending.id));
      clearDealCookie(input.res, DEALS_COOKIE.pending);
    }
    return { ok: false as const, kind: "invalid_code" };
  } else {
    input.verifiedBy = "twilio";
  }

  // Re-evaluate the mutable checks after the code is approved and before any
  // token is created. A discovered match cannot inherit an issued link.
  // The link is checked again now: turned off, agent removed, or bound to another number meanwhile attaches nothing.
  const clientLink = storedLink && await (await import("./dealsClientLinks")).clientLinkStillValid(storedLink.linkId, pending.phoneE164) ? storedLink : null;
  const eligibility = await (await import("./dealsEligibility")).classifyDealsAccess({
    phone: pending.phoneE164, email: identity.google?.email, deviceHash,
    isTest, testSkipChecks: settings.testNumbersSkipChecks, testTeamNumbers: settings.testTeamNumbers,
    brokerageDomains: settings.brokerageDomains, fubRealtorTags: settings.fubRealtorTags,
    fubRealtorSources: settings.fubRealtorSources, clientLink: Boolean(clientLink),
  });
  if (!eligibility.allowed) {
    await blockVerifiedDealsIdentity({ phone: pending.phoneE164, email: identity.google?.email, deviceHash, reason: eligibility.blockedBy ?? "post_verification" }, db);
    await db.delete(dealPendingVerifications).where(eq(dealPendingVerifications.id, pending.id));
    clearDealCookie(input.res, DEALS_COOKIE.pending);
    await db.insert(dealEvents).values({ kind: "blocked", sourceCode: pending.sourceCode, deviceHash, ipPrefix: clientIpKey(pending.clientIp), phoneE164: pending.phoneE164, detail: eligibility.blockedBy ?? "post_verification" });
    return { ok: false as const, kind: "blocked" };
  }
  // The link belongs to a buyer: a team member stays a team member even when they open one.
  const attachLink = clientLink && !eligibility.team ? clientLink : null;
  const accessHours = attachLink ? settings.clientLinkExpiryHours : settings.expiryHours;
  let old = (await db.select().from(dealLeads).where(eq(dealLeads.phoneE164, pending.phoneE164)).limit(1))[0];
  let reverifiedActive = Boolean(old && old.expiresAt > new Date());
  // An agent's client keeps the longer access window even when a shorter reel link is still live.
  const freshExpiry = new Date(Date.now() + accessHours * 60 * 60_000);
  let expiresAt = old && old.expiresAt > new Date() ? (attachLink && old.expiresAt < freshExpiry ? freshExpiry : old.expiresAt) : freshExpiry;
  const agentFields = attachLink ? { agentTeamId: attachLink.agentTeamId, clientLinkId: attachLink.linkId } : {};
  // "fub_check_deferred" is an operational marker for the deferred re-check,
  // never a persisted lead flag; it is carried to the caller separately.
  const fubCheckDeferred = eligibility.flags.includes("fub_check_deferred") || (identity.flags ?? []).includes("fub_check_deferred");
  const flags = Array.from(new Set([...(identity.flags ?? []), ...eligibility.flags])).filter((flag) => flag !== "fub_check_deferred");
  // A forwarded DM handle belongs to its first verified phone. Do not expose
  // that identity in another person’s private watermark or list, whether the
  // returning lead is new or has no handle of their own yet.
  const handleOwner = pending.instagramHandle ? (await db.select({ id: dealLeads.id }).from(dealLeads).where(and(eq(dealLeads.instagramHandle, pending.instagramHandle), sql`${dealLeads.phoneE164} <> ${pending.phoneE164}`)).limit(1))[0] : null;
  const instagramHandle = handleOwner ? null : pending.instagramHandle;
  let leadId: number;
  if (old) {
    await db.update(dealLeads).set({ status: eligibility.team ? "team" : "verified", deviceHash, expiresAt, sourceCode: pending.sourceCode, instagramHandle: old.instagramHandle ?? instagramHandle, email: old.email ?? identity.google?.email ?? null, name: old.name ?? identity.google?.name ?? null, flags: JSON.stringify(flags), ...agentFields }).where(eq(dealLeads.id, old.id));
    leadId = old.id;
  } else {
    try {
      const result = await db.insert(dealLeads).values({ phoneE164: pending.phoneE164, instagramHandle, email: identity.google?.email ?? null, name: identity.google?.name ?? null, sourceCode: pending.sourceCode, consentText: DEALS_CONSENT_TEXT, consentAt: pending.consentAt, consentIp: pending.clientIp, deviceHash, expiresAt, status: eligibility.team ? "team" : "verified", flags: JSON.stringify(flags), ...agentFields });
      leadId = Number((result as unknown as [{ insertId: number }])[0].insertId);
    } catch (error) {
      // Two verify submissions can legitimately race. The unique normalized
      // phone key makes this safe: retrieve the winner and continue exactly as
      // a re-verification instead of leaking an ER_DUP_ENTRY out of Express.
      const cause = error && typeof error === "object" ? (error as { code?: string; errno?: number; cause?: { code?: string; errno?: number } }) : null;
      if (cause?.code !== "ER_DUP_ENTRY" && cause?.errno !== 1062 && cause?.cause?.code !== "ER_DUP_ENTRY" && cause?.cause?.errno !== 1062) throw error;
      const raced = (await db.select().from(dealLeads).where(eq(dealLeads.phoneE164, pending.phoneE164)).limit(1).for("update"))[0];
      if (!raced) throw error;
      old = raced;
      reverifiedActive = raced.expiresAt > new Date();
      expiresAt = reverifiedActive ? (attachLink && raced.expiresAt < freshExpiry ? freshExpiry : raced.expiresAt) : expiresAt;
      await db.update(dealLeads).set({ status: eligibility.team ? "team" : "verified", deviceHash, expiresAt, sourceCode: pending.sourceCode, flags: JSON.stringify(flags), ...agentFields }).where(eq(dealLeads.id, raced.id));
      leadId = raced.id;
    }
  }
  if (attachLink) {
    const { attachLeadToClientLink } = await import("./dealsClientLinks");
    await attachLeadToClientLink(db, attachLink.linkId, leadId, old?.clientLinkId ?? null);
  }
  await db.insert(dealAccessTokens).values({ leadId, tokenHash: hashSecret(token), deviceHash, expiresAt, kind: "exchange" });
  await db.update(dealPendingVerifications).set({ flags: JSON.stringify({ ...identity, completed: { codeHash: hashSecret(input.code), leadId, expiresAt: expiresAt.toISOString(), isTeam: eligibility.team, isTest, fubCheckDeferred } satisfies VerificationReceipt }) }).where(eq(dealPendingVerifications.id, pending.id));
  clearDealCookie(input.res, DEALS_COOKIE.pending);
  await db.insert(dealEvents).values({ leadId, kind: eligibility.team ? "team" : "verified", sourceCode: pending.sourceCode, deviceHash, ipPrefix: clientIpKey(pending.clientIp), phoneE164: pending.phoneE164, detail: attachLink ? `${input.verifiedBy};client_link:${attachLink.linkId}` : input.verifiedBy });
  // An existing lead newly attached to this link: the agent is told (a first unlock already alerts them).
  const clientLinkAttached = attachLink && old && old.clientLinkId !== attachLink.linkId ? attachLink.linkId : null;
  return { ok: true as const, token, leadId, expiresAt, firstUnlock: !old, reverifiedActive, isTeam: eligibility.team, isTest, fubCheckDeferred, duplicate: false, clientLinkAttached };
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

/** Bare plan words outside plan fields are not residue (see hasPrivateTerm). */
export function publicNoPrivateNames(payload: unknown, privateTerms: readonly string[] | DealScrubConfig): boolean {
  return !hasPrivateTerm(JSON.stringify(payload), privateTerms);
}

export function safeBlockedMessage(settings: DealSettings) {
  return `This page is for buyers who aren't working with an agent yet. Thanks for checking us out! Made a mistake? Text ${settings.commentKeyword} to ${settings.textLine}.`;
}

export function leadPresentation(lead: typeof dealLeads.$inferSelect) {
  return { display: displayForLead(lead), expiresAt: lead.expiresAt.toISOString(), name: lead.name, timeline: lead.timeline, teamPreview: lead.status === "team", agentClient: Boolean(lead.agentTeamId) };
}

/** The builder's own page for a home: its source URL, except a home keyed under a path the site does not serve (Starlight's `/available-homes/<street>` keys, on Starlight's host only — Davidson's home pages live under the same segment for real), whose page is the community's. */
export function builderPageFor(sourceUrl: string): string {
  return /^https:\/\/www\.starlighthomes\.com\//i.test(sourceUrl) ? sourceUrl.replace(/\/available-homes\/[^/?#]+\/?(?=$|[?#])/i, "") : sourceUrl;
}
