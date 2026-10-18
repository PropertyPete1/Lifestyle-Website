import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import {
  dealCommunities,
  dealEvents,
  dealFubRecords,
  dealFubJobs,
  dealIncentives,
  dealLeads,
  dealPhotos,
  dealTeamAllowlist,
  dealTrecImports,
} from "../drizzle/schema";
import { normalizeUsPhone } from "../shared/deals";
import { notifyOwner } from "./_core/notification";
import { getDb } from "./db";
import { makeMatchingLeadsTeam, revokeOrphanedTeamPreviewLinks } from "./dealsEligibility";
import { cleanupBuilderDealsFubRecord, stripBuilderDealsTestTag } from "./dealsFub";
import { getDealSettings } from "./dealsService";
import { syncKnownAgentsFromFub } from "./dealsKnownAgents";
import { fubHeaders } from "./fub";

export { syncKnownAgentsFromFub } from "./dealsKnownAgents";
export type { KnownAgentsSyncResult } from "./dealsKnownAgents";

const FUB_API_URL = "https://api.followupboss.com/v1";
const FUB_TIMEOUT_MS = 15_000;
const FUB_PAGE_SIZE = 100;
const MAX_FUB_PAGES = 10_000;

export type CredentialState = "configured" | "missing";
export type AvailabilityState = "available" | "unavailable" | "not_checked";

type FubUser = Record<string, unknown>;
type FubResponse = Record<string, unknown>;
type FubErrorReason = "fub_not_configured" | "fub_unavailable" | "fub_invalid_response";
type FubFetchResult =
  | { ok: true; body: FubResponse }
  | { ok: false; reason: FubErrorReason };
type FubFailure = Extract<FubFetchResult, { ok: false }>;
type FubUserListResult = FubFailure | { ok: true; users: FubUser[] };

type TeamAllowlistSyncResult =
  | { ok: true; usersFetched: number; activeUsers: number; upserted: number; skipped: number; deactivated: number; orphanedTeamLeads: number }
  | { ok: false; usersFetched: number; activeUsers: number; upserted: number; skipped: number; deactivated: number; orphanedTeamLeads: number; reason: "database_unavailable" | FubErrorReason };

function credentialState(value: string | undefined): CredentialState {
  return value?.trim() ? "configured" : "missing";
}

function nonEmptyString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function normalizeEmail(value: unknown): string | null {
  const email = nonEmptyString(value, 320)?.toLowerCase() ?? null;
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** Normalizes a valid North American FUB phone to E.164; unsupported values are not stored. */
export function normalizeFubPhone(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = normalizeUsPhone(String(value), { allowCanada: true });
  return normalized.ok ? normalized.e164 : null;
}

/**
 * Extracts standalone ten-digit strings only. It deliberately does not try to
 * reconstruct formatted, partial, or longer digit sequences from CRM notes.
 */
export function extractTenDigitPhoneStrings(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const matches = value.match(/(?<!\d)\d{10}(?!\d)/g) ?? [];
  return Array.from(new Set(matches));
}

/** Parses the two flag shapes used by Builder Deals without treating substrings such as CONTEST as TEST. */
export function hasDealsTestFlag(flagsJson: string | null | undefined): boolean {
  if (!flagsJson) return false;
  try {
    const parsed: unknown = JSON.parse(flagsJson);
    const flags = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).flags)
        ? (parsed as Record<string, unknown>).flags as unknown[]
        : [];
    return flags.some((value) => typeof value === "string" && value.trim().toUpperCase() === "TEST");
  } catch {
    return false;
  }
}

function fubId(value: unknown): string | null {
  return nonEmptyString(value, 80);
}

function valuesFromField(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(valuesFromField);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return [record.value, record.email, record.phone, record.number].filter((item) => item !== undefined);
  }
  return value === undefined || value === null ? [] : [value];
}

function firstFubEmail(record: FubUser): string | null {
  return [record.email, record.emails]
    .flatMap(valuesFromField)
    .map(normalizeEmail)
    .find((value): value is string => Boolean(value)) ?? null;
}

function fubPhones(record: FubUser): string[] {
  return Array.from(new Set(
    [record.phone, record.mobile, record.mobilePhone, record.phones]
      .flatMap(valuesFromField)
      .map(normalizeFubPhone)
      .filter((value): value is string => Boolean(value)),
  ));
}

function fubName(record: FubUser): string | null {
  const direct = nonEmptyString(record.name, 190);
  if (direct) return direct;
  const first = nonEmptyString(record.firstName ?? record.first_name, 90);
  const last = nonEmptyString(record.lastName ?? record.last_name, 90);
  return nonEmptyString([first, last].filter(Boolean).join(" "), 190);
}

async function getFubJson(path: string): Promise<FubFetchResult> {
  const apiKey = process.env.FUB_API_KEY?.trim();
  if (!apiKey) return { ok: false, reason: "fub_not_configured" };
  try {
    const response = await fetch(`${FUB_API_URL}${path}`, {
      headers: fubHeaders(apiKey),
      signal: AbortSignal.timeout(FUB_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, reason: "fub_unavailable" };
    const body: unknown = await response.json().catch(() => null);
    return body && typeof body === "object" && !Array.isArray(body)
      ? { ok: true, body: body as FubResponse }
      : { ok: false, reason: "fub_invalid_response" };
  } catch {
    return { ok: false, reason: "fub_unavailable" };
  }
}

/** FUB recommends cursor pagination; legacy accounts still work through offset fallback. */
async function listAllFubUsers(): Promise<FubUserListResult> {
  const users: FubUser[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let offset = 0;
  for (let page = 0; page < MAX_FUB_PAGES; page += 1) {
    const params = new URLSearchParams({
      limit: String(FUB_PAGE_SIZE),
      fields: "id,name,firstName,lastName,email,emails,phone,phones,status,active",
    });
    if (cursor) params.set("next", cursor); else params.set("offset", String(offset));
    const response = await getFubJson(`/users?${params.toString()}`);
    if (!response.ok) return response;
    const raw = response.body.users;
    if (!Array.isArray(raw)) return { ok: false, reason: "fub_invalid_response" };
    const batch = raw.filter((user): user is FubUser => Boolean(user) && typeof user === "object" && !Array.isArray(user));
    if (batch.length !== raw.length) return { ok: false, reason: "fub_invalid_response" };
    users.push(...batch);
    const metadata = response.body._metadata && typeof response.body._metadata === "object" ? response.body._metadata as FubResponse : {};
    const next = nonEmptyString(metadata.next, 2_000);
    if (next) {
      if (seenCursors.has(next)) return { ok: false, reason: "fub_invalid_response" };
      seenCursors.add(next);
      cursor = next;
      continue;
    }
    const total = Number(metadata.total);
    if (Number.isFinite(total) && total >= 0 && users.length < total && batch.length === 0) return { ok: false, reason: "fub_invalid_response" };
    if (batch.length < FUB_PAGE_SIZE || (Number.isFinite(total) && users.length >= total)) return { ok: true, users };
    cursor = null;
    offset += batch.length;
  }
  return { ok: false, reason: "fub_invalid_response" };
}

/** Only a documented Active status (or explicit true field) may grant team-preview access. */
function isActiveFubUser(user: FubUser) {
  if (user.active === false) return false;
  if (user.active === true) return true;
  return nonEmptyString(user.status, 80)?.toLowerCase() === "active";
}

function fubIdentityKey(userId: string, phoneE164: string | null, email: string | null) {
  return `fub:${userId}:${phoneE164 ?? `email:${email ?? "none"}`}`;
}

async function upsertFubTeamIdentity(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  user: FubUser,
  phoneE164: string | null,
  email: string | null,
): Promise<boolean> {
  const userId = fubId(user.id);
  if (!userId || (!phoneE164 && !email)) return false;
  const key = fubIdentityKey(userId, phoneE164, email);
  const values = { name: fubName(user), phoneE164, email, fubUserId: userId, fubIdentityKey: key, source: "fub" as const, active: true };
  // Upgrade the earlier one-row-per-user representation on the first pass; all
  // subsequent phones receive their own durable, uniquely keyed mirror row.
  const existing = (await db.select({ id: dealTeamAllowlist.id })
    .from(dealTeamAllowlist)
    .where(eq(dealTeamAllowlist.fubIdentityKey, key))
    .limit(1))[0] ?? (await db.select({ id: dealTeamAllowlist.id, fubIdentityKey: dealTeamAllowlist.fubIdentityKey })
      .from(dealTeamAllowlist)
      .where(and(eq(dealTeamAllowlist.fubUserId, userId), eq(dealTeamAllowlist.source, "fub"), isNull(dealTeamAllowlist.fubIdentityKey)))
      .limit(1))[0];
  if (existing) await db.update(dealTeamAllowlist).set(values).where(eq(dealTeamAllowlist.id, existing.id));
  else await db.insert(dealTeamAllowlist).values(values);
  await makeMatchingLeadsTeam(db, { phoneE164, email });
  return true;
}

/**
 * Mirrors every identity of every active FUB user. A completed remote scan is
 * authoritative for FUB-sourced rows only; manual/test rows are untouched.
 * Missing or inactive remote users are deactivated, then their no-longer-team
 * sessions are expired and revoked by the reverse cascade.
 */
export async function syncTeamAllowlistFromFub(): Promise<TeamAllowlistSyncResult> {
  const db = await getDb();
  const empty = { usersFetched: 0, activeUsers: 0, upserted: 0, skipped: 0, deactivated: 0, orphanedTeamLeads: 0 };
  if (!db) return { ok: false, ...empty, reason: "database_unavailable" };
  const response = await listAllFubUsers();
  if (!response.ok) return { ok: false, ...empty, reason: response.reason };

  let upserted = 0;
  let skipped = 0;
  const activeUsers = response.users.filter(isActiveFubUser);
  const remoteKeys = new Set<string>();
  try {
    for (const user of activeUsers) {
      const userId = fubId(user.id);
      const email = firstFubEmail(user);
      const phones = fubPhones(user);
      const identities = phones.length ? phones.map((phoneE164) => ({ phoneE164, email })) : [{ phoneE164: null, email }];
      for (const identity of identities) {
        if (userId && (identity.phoneE164 || identity.email)) remoteKeys.add(fubIdentityKey(userId, identity.phoneE164, identity.email));
        if (await upsertFubTeamIdentity(db, user, identity.phoneE164, identity.email)) upserted += 1;
        else skipped += 1;
      }
    }
    const localRows = await db.select({ id: dealTeamAllowlist.id, fubIdentityKey: dealTeamAllowlist.fubIdentityKey, active: dealTeamAllowlist.active })
      .from(dealTeamAllowlist)
      .where(eq(dealTeamAllowlist.source, "fub"));
    const staleRows = localRows.filter((row) => !row.fubIdentityKey || !remoteKeys.has(row.fubIdentityKey));
    for (const row of staleRows) {
      if (row.active) await db.update(dealTeamAllowlist).set({ active: false }).where(eq(dealTeamAllowlist.id, row.id));
    }
    const orphanedTeamLeads = await revokeOrphanedTeamPreviewLinks(db);
    return {
      ok: true,
      usersFetched: response.users.length,
      activeUsers: activeUsers.length,
      upserted,
      skipped,
      deactivated: staleRows.filter((row) => row.active).length,
      orphanedTeamLeads,
    };
  } catch {
    return { ok: false, usersFetched: response.users.length, activeUsers: activeUsers.length, upserted: 0, skipped: 0, deactivated: 0, orphanedTeamLeads: 0, reason: "database_unavailable" };
  }
}

export type DealsTestCleanupResult = {
  ok: boolean;
  eligible: number;
  markedExpired: number;
  /** Count of DELETE requests made only for explicitly system-created objects. */
  fubDeletionAttempted: number;
  fubDeleted: number;
  /** Existing found contacts are retained; only their TEST tag is removed. */
  fubTagsStripped: number;
  /** Failed or unsupported tracked artifacts remain for retry/manual review. */
  fubRecordsRequiringManualCleanup: number;
  manualFubCleanupRequired: boolean;
  reason?: "database_unavailable";
};

/**
 * Expires local test leads only after both their 24-hour age threshold and
 * access expiration. The FUB audit table distinguishes created artifacts from
 * found contacts: only created objects are deleted; a found contact has TEST
 * removed. Failed cleanup is persisted for a later retry rather than lost.
 */
export async function cleanupDealsTestRecords(now = new Date()): Promise<DealsTestCleanupResult> {
  const db = await getDb();
  if (!db) {
    return {
      ok: false,
      eligible: 0,
      markedExpired: 0,
      fubDeletionAttempted: 0,
      fubDeleted: 0,
      fubTagsStripped: 0,
      fubRecordsRequiringManualCleanup: 0,
      manualFubCleanupRequired: false,
      reason: "database_unavailable",
    };
  }

  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60_000);
  const settings = await getDealSettings();
  try {
    const candidates = await db
      .select({ id: dealLeads.id, phoneE164: dealLeads.phoneE164 })
      .from(dealLeads)
      .where(and(lte(dealLeads.createdAt, twentyFourHoursAgo), lte(dealLeads.expiresAt, now)));
    // The configured normalized number list, not a conditional screening flag,
    // is authoritative when full-pipeline test mode runs with that flag off.
    const eligible = candidates.filter((lead) => settings.testNumbers.includes(lead.phoneE164));

    for (const lead of eligible) {
      await db.update(dealLeads).set({ status: "expired" }).where(eq(dealLeads.id, lead.id));
    }
    let fubDeletionAttempted = 0;
    let fubDeleted = 0;
    let fubTagsStripped = 0;
    let fubRecordsRequiringManualCleanup = 0;
    for (const lead of eligible) {
      const records = await db.select().from(dealFubRecords).where(eq(dealFubRecords.leadId, lead.id));
      const owned = records.filter((record) => record.createdByUs && !record.cleanedAt);
      const foundPeople = records.filter((record) => record.kind === "person" && !record.createdByUs && !record.cleanedAt);
      // Delete child artifacts before an owned contact; a FUB event is retained
      // for manual attention because FUB exposes no documented event DELETE.
      const ordered = [...owned.filter((record) => record.kind !== "person"), ...owned.filter((record) => record.kind === "person")];
      for (const record of ordered) {
        fubDeletionAttempted += 1;
        const result = await cleanupBuilderDealsFubRecord(record.kind, record.fubId);
        if (result.ok) {
          fubDeleted += 1;
          await db.update(dealFubRecords).set({ cleanedAt: now, lastCleanupError: null }).where(eq(dealFubRecords.id, record.id));
        } else {
          fubRecordsRequiringManualCleanup += 1;
          await db.update(dealFubRecords).set({ lastCleanupError: result.error }).where(eq(dealFubRecords.id, record.id));
        }
      }
      for (const record of foundPeople) {
        const result = await stripBuilderDealsTestTag(record.fubId);
        if (result.ok) {
          fubTagsStripped += 1;
          await db.update(dealFubRecords).set({ cleanedAt: now, lastCleanupError: null }).where(eq(dealFubRecords.id, record.id));
        } else {
          fubRecordsRequiringManualCleanup += 1;
          await db.update(dealFubRecords).set({ lastCleanupError: result.error }).where(eq(dealFubRecords.id, record.id));
        }
      }
    }
    return {
      ok: true,
      eligible: eligible.length,
      markedExpired: eligible.length,
      fubDeletionAttempted,
      fubDeleted,
      fubTagsStripped,
      fubRecordsRequiringManualCleanup,
      manualFubCleanupRequired: fubRecordsRequiringManualCleanup > 0,
    };
  } catch {
    return {
      ok: false,
      eligible: 0,
      markedExpired: 0,
      fubDeletionAttempted: 0,
      fubDeleted: 0,
      fubTagsStripped: 0,
      fubRecordsRequiringManualCleanup: 0,
      manualFubCleanupRequired: false,
      reason: "database_unavailable",
    };
  }
}

export const BUILDER_DEALS_HEALTH_THRESHOLDS = {
  /** The TREC source runs nightly; older than 36 hours needs review. */
  trecImportHours: 36,
  /** Official community data is refreshed nightly, with room for a missed run. */
  communityUpdateHours: 72,
  /** A photo left in the queue for a day is operationally stale. */
  pendingPhotoHours: 24,
  /** A small queue is expected; ten pending/processing photos needs review. */
  pendingPhotoCount: 10,
  /** Never expose a precise balance to the admin client or scheduled result. */
  twilioMinimumBalanceUsd: 5,
} as const;

export type HealthState = "ok" | "attention" | "unknown";
export type TwilioAccountState = "active" | "inactive" | "unavailable" | "not_checked";
export type TwilioBalanceState = "available" | "low" | "unavailable" | "not_checked";

function healthState(ok: boolean, known = true): HealthState {
  return !known ? "unknown" : ok ? "ok" : "attention";
}

export function ageHours(at: Date | string | null | undefined, now = new Date()): number | null {
  if (!at) return null;
  const value = new Date(at).getTime();
  return Number.isFinite(value) ? Math.max(0, Math.floor((now.getTime() - value) / 3_600_000)) : null;
}

type TwilioInspection = { account: TwilioAccountState; balance: TwilioBalanceState };

/** Queries both account status and balance, returning only threshold states—not amounts or credentials. */
async function inspectTwilioAccount(): Promise<TwilioInspection> {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const service = process.env.TWILIO_VERIFY_SERVICE_SID?.trim();
  if (!sid || !token || !service) return { account: "not_checked", balance: "not_checked" };
  const headers = { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` };
  try {
    const base = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}`;
    const [accountResponse, balanceResponse] = await Promise.all([
      fetch(`${base}.json`, { headers, signal: AbortSignal.timeout(FUB_TIMEOUT_MS) }),
      fetch(`${base}/Balance.json`, { headers, signal: AbortSignal.timeout(FUB_TIMEOUT_MS) }),
    ]);
    const accountBody: unknown = accountResponse.ok ? await accountResponse.json().catch(() => null) : null;
    const balanceBody: unknown = balanceResponse.ok ? await balanceResponse.json().catch(() => null) : null;
    const accountStatus = accountBody && typeof accountBody === "object" && typeof (accountBody as { status?: unknown }).status === "string"
      ? (accountBody as { status: string }).status.toLowerCase()
      : "";
    const balanceValue = balanceBody && typeof balanceBody === "object" ? Number((balanceBody as { balance?: unknown }).balance) : Number.NaN;
    return {
      account: !accountResponse.ok ? "unavailable" : accountStatus === "active" ? "active" : "inactive",
      balance: !balanceResponse.ok || !Number.isFinite(balanceValue) ? "unavailable" : balanceValue < BUILDER_DEALS_HEALTH_THRESHOLDS.twilioMinimumBalanceUsd ? "low" : "available",
    };
  } catch {
    return { account: "unavailable", balance: "unavailable" };
  }
}

async function checkFubAvailability(): Promise<AvailabilityState> {
  const result = await getFubJson("/identity");
  return result.ok ? "available" : result.reason === "fub_not_configured" ? "not_checked" : "unavailable";
}

type OperationalSnapshot = {
  available: boolean;
  funnel: { landed: number; consented: number; verificationSends: number; verified: number; listingViews: number; requests: number };
  trecImport: { completedAt: Date | null; ageHours: number | null; state: HealthState };
  sourceUpdates: { activeCommunities: number; staleCommunities: number; oldestAgeHours: number | null; state: HealthState };
  photos: { pending: number; processing: number; failed: number; oldestPendingAgeHours: number | null; state: HealthState };
  fubFailures: { jobs: number; leads: number; state: HealthState };
  holds: { communities: number; incentives: number; state: HealthState };
};

const emptyOperationalSnapshot = (): OperationalSnapshot => ({
  available: false,
  funnel: { landed: 0, consented: 0, verificationSends: 0, verified: 0, listingViews: 0, requests: 0 },
  trecImport: { completedAt: null, ageHours: null, state: "unknown" },
  sourceUpdates: { activeCommunities: 0, staleCommunities: 0, oldestAgeHours: null, state: "unknown" },
  photos: { pending: 0, processing: 0, failed: 0, oldestPendingAgeHours: null, state: "unknown" },
  fubFailures: { jobs: 0, leads: 0, state: "unknown" },
  holds: { communities: 0, incentives: 0, state: "unknown" },
});

/** Collects all B9 local thresholds without making an outbound request or sending a notification. */
export async function builderDealsOperationalSnapshot(now = new Date()): Promise<OperationalSnapshot> {
  const db = await getDb();
  if (!db) return emptyOperationalSnapshot();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
  try {
    const [funnelRows, latestImport, communities, photoRows, failedJobRows, failedLeadRows, heldCommunityRows, heldIncentiveRows] = await Promise.all([
      db.select({
        landed: sql<number>`SUM(${dealEvents.kind} = 'landed')`,
        consented: sql<number>`SUM(${dealEvents.kind} = 'consent')`,
        verificationSends: sql<number>`SUM(${dealEvents.kind} = 'twilio_verify_success')`,
        verified: sql<number>`SUM(${dealEvents.kind} = 'verified')`,
        listingViews: sql<number>`SUM(${dealEvents.kind} = 'viewed_listings')`,
        requests: sql<number>`SUM(${dealEvents.kind} = 'tour_request')`,
      }).from(dealEvents).where(gte(dealEvents.createdAt, sevenDaysAgo)),
      db.select({ completedAt: dealTrecImports.completedAt }).from(dealTrecImports).where(eq(dealTrecImports.current, true)).orderBy(desc(dealTrecImports.completedAt)).limit(1),
      db.select({ lastSuccessfulSyncAt: dealCommunities.lastSuccessfulSyncAt }).from(dealCommunities).where(and(eq(dealCommunities.active, true), eq(dealCommunities.paused, false))),
      db.select({
        pending: sql<number>`SUM(${dealPhotos.processingState} = 'pending')`,
        processing: sql<number>`SUM(${dealPhotos.processingState} = 'processing')`,
        failed: sql<number>`SUM(${dealPhotos.processingState} = 'failed')`,
        oldestPendingAt: sql<Date | null>`MIN(CASE WHEN ${dealPhotos.processingState} IN ('pending', 'processing') THEN ${dealPhotos.createdAt} END)`,
      }).from(dealPhotos),
      db.select({ count: sql<number>`COUNT(*)` }).from(dealFubJobs).where(eq(dealFubJobs.status, "failed")),
      db.select({ count: sql<number>`COUNT(*)` }).from(dealLeads).where(eq(dealLeads.fubStatus, "failed")),
      db.select({ count: sql<number>`COUNT(*)` }).from(dealCommunities).where(sql`${dealCommunities.holdReason} IS NOT NULL AND TRIM(${dealCommunities.holdReason}) <> ''`),
      db.select({ count: sql<number>`COUNT(*)` }).from(dealIncentives).where(sql`${dealIncentives.held} = true OR (${dealIncentives.holdReason} IS NOT NULL AND TRIM(${dealIncentives.holdReason}) <> '')`),
    ]);
    const number = (value: unknown) => Number(value ?? 0);
    const importAgeHours = ageHours(latestImport[0]?.completedAt, now);
    const communityAges = communities.map((community) => ageHours(community.lastSuccessfulSyncAt, now));
    const staleCommunities = communityAges.filter((age) => age === null || age > BUILDER_DEALS_HEALTH_THRESHOLDS.communityUpdateHours).length;
    const finiteCommunityAges = communityAges.filter((age): age is number => age !== null);
    const photo = photoRows[0];
    const pending = number(photo?.pending), processing = number(photo?.processing), failed = number(photo?.failed);
    const oldestPendingAgeHours = ageHours(photo?.oldestPendingAt, now);
    return {
      available: true,
      funnel: {
        landed: number(funnelRows[0]?.landed), consented: number(funnelRows[0]?.consented), verificationSends: number(funnelRows[0]?.verificationSends),
        verified: number(funnelRows[0]?.verified), listingViews: number(funnelRows[0]?.listingViews), requests: number(funnelRows[0]?.requests),
      },
      trecImport: { completedAt: latestImport[0]?.completedAt ?? null, ageHours: importAgeHours, state: healthState(importAgeHours !== null && importAgeHours <= BUILDER_DEALS_HEALTH_THRESHOLDS.trecImportHours) },
      sourceUpdates: { activeCommunities: communities.length, staleCommunities, oldestAgeHours: finiteCommunityAges.length ? Math.max(...finiteCommunityAges) : null, state: healthState(staleCommunities === 0) },
      photos: { pending, processing, failed, oldestPendingAgeHours, state: healthState(failed === 0 && pending + processing < BUILDER_DEALS_HEALTH_THRESHOLDS.pendingPhotoCount && (oldestPendingAgeHours === null || oldestPendingAgeHours <= BUILDER_DEALS_HEALTH_THRESHOLDS.pendingPhotoHours)) },
      fubFailures: { jobs: number(failedJobRows[0]?.count), leads: number(failedLeadRows[0]?.count), state: healthState(number(failedJobRows[0]?.count) === 0 && number(failedLeadRows[0]?.count) === 0) },
      holds: { communities: number(heldCommunityRows[0]?.count), incentives: number(heldIncentiveRows[0]?.count), state: healthState(number(heldCommunityRows[0]?.count) === 0 && number(heldIncentiveRows[0]?.count) === 0) },
    };
  } catch {
    return emptyOperationalSnapshot();
  }
}

/** Reports only configured/missing credential states and threshold states; no secret or balance amount is exposed. */
export async function builderDealsHealthCheck(now = new Date()) {
  const twilioVerify = {
    accountSid: credentialState(process.env.TWILIO_ACCOUNT_SID),
    authToken: credentialState(process.env.TWILIO_AUTH_TOKEN),
    serviceSid: credentialState(process.env.TWILIO_VERIFY_SERVICE_SID),
  };
  const fub = { apiKey: credentialState(process.env.FUB_API_KEY) };
  const twilioConfigured = Object.values(twilioVerify).every((value) => value === "configured");
  const [twilio, fubAvailability, operational] = await Promise.all([
    twilioConfigured ? inspectTwilioAccount() : Promise.resolve<TwilioInspection>({ account: "not_checked", balance: "not_checked" }),
    checkFubAvailability(),
    builderDealsOperationalSnapshot(now),
  ]);
  return {
    twilioVerify: { ...twilioVerify, account: twilio.account, balance: twilio.balance, state: healthState(twilio.account === "active" && twilio.balance === "available", twilio.account !== "not_checked") },
    fub: { ...fub, availability: fubAvailability },
    operational,
  };
}

const stateLabel = (state: HealthState) => state.toUpperCase();
const numberLabel = (value: number | null) => value === null ? "not available" : `${value}h`;

/**
 * Formats the scheduled Monday report from the exact health-check values. It
 * intentionally performs no delivery: the caller can store/review its body
 * without sending any real email or alert.
 */
export async function builderDealsMondayReport(now = new Date()) {
  const health = await builderDealsHealthCheck(now);
  const { operational } = health;
  const body = [
    "Builder Deals Monday operational report (no message was sent)",
    "",
    `1. Twilio Verify: ${stateLabel(health.twilioVerify.state)} — account ${health.twilioVerify.account}; balance ${health.twilioVerify.balance}.`,
    `2. Follow Up Boss: ${health.fub.availability.toUpperCase()} (${health.fub.apiKey}).`,
    `3. TREC import freshness: ${stateLabel(operational.trecImport.state)} — ${numberLabel(operational.trecImport.ageHours)} old; limit ${BUILDER_DEALS_HEALTH_THRESHOLDS.trecImportHours}h.`,
    `4. 7-day funnel: landed ${operational.funnel.landed}; consented ${operational.funnel.consented}; verification sends ${operational.funnel.verificationSends}; verified ${operational.funnel.verified}; listing views ${operational.funnel.listingViews}; tour/question requests ${operational.funnel.requests}.`,
    `5. Official-source updates: ${stateLabel(operational.sourceUpdates.state)} — ${operational.sourceUpdates.staleCommunities}/${operational.sourceUpdates.activeCommunities} active communities stale; oldest ${numberLabel(operational.sourceUpdates.oldestAgeHours)}; limit ${BUILDER_DEALS_HEALTH_THRESHOLDS.communityUpdateHours}h.`,
    `6. Photo queue: ${stateLabel(operational.photos.state)} — pending ${operational.photos.pending}, processing ${operational.photos.processing}, failed ${operational.photos.failed}; oldest queued ${numberLabel(operational.photos.oldestPendingAgeHours)}.`,
    `7. CRM and holds: FUB jobs failed ${operational.fubFailures.jobs}, leads failed ${operational.fubFailures.leads}, community holds ${operational.holds.communities}, incentive holds ${operational.holds.incentives}.`,
    "",
    "This report is generated for protected admin review only. No email or alert was sent.",
  ].join("\n");
  return { ok: true as const, subject: "Builder Deals Monday operational report", body, health };
}

/** Sends an owner-facing maintenance alert through the established notification service. */
export async function createDealsAlert(title: string, body: string): Promise<boolean> {
  return notifyOwner({ title, content: body });
}
