import { and, desc, eq, gte, isNull, lte, lt, sql } from "drizzle-orm";
import {
  dealCommunities,
  dealEmailLogs,
  dealEvents,
  dealFubRecords,
  dealFubJobs,
  dealIncentives,
  dealJobRuns,
  dealLeads,
  dealPhotos,
  dealTeamAllowlist,
  dealTrecImports,
} from "../drizzle/schema";
import { normalizeUsPhone } from "../shared/deals";
import { getDb } from "./db";
import { makeMatchingLeadsTeam, revokeOrphanedTeamPreviewLinks } from "./dealsEligibility";
import { resendConfiguration, sendBuilderDealsEmail } from "./dealsEmail";
import { cleanupBuilderDealsFubRecord, formatChicagoDateTime, stripBuilderDealsTestTag } from "./dealsFub";
import { pruneDealPhotoRenders, type DealPhotoRenderPruneResult } from "./dealsPhotos";
import { lastPhotoDrain, photoDrainStall, readDealPhotoDrainStatus, type LastPhotoDrain } from "./dealsPhotoDrainStatus";
import { type ProcessSnapshot, processLine, processSnapshot, readServerBeats, readServerBoots, readServerExits, serverBootsSince, serverLives } from "./dealsProcessTelemetry";

/** "last drain processed N (M min ago)" for the health payload's readers. */
export function photoDrainLine(lastDrain: Pick<LastPhotoDrain, "at" | "processed" | "hidden" | "partial" | "coalesced"> & Partial<Pick<LastPhotoDrain, "msPerPhoto" | "stageMsPerPhoto">> | null, now: Date): string {
  if (!lastDrain) return "no photo drain recorded yet";
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(lastDrain.at)) / 60_000));
  const stages = lastDrain.stageMsPerPhoto ? Object.entries(lastDrain.stageMsPerPhoto).map(([stage, ms]) => `${stage} ${ms}`).join(", ") : "";
  const cost = lastDrain.msPerPhoto ? `; about ${lastDrain.msPerPhoto} ms per photo${stages ? ` (busy ms per photo: ${stages})` : ""}` : "";
  return `last drain processed ${lastDrain.processed}${lastDrain.hidden ? ` (+${lastDrain.hidden} hidden)` : ""}${lastDrain.partial ? ", answered early" : ""}${lastDrain.coalesced ? ", another drain was running" : ""} ${minutes} min ago${cost}`;
}
import { PRIVACY_RESIDUE_EVENT_KIND, catalogBuildsSinceStart, getDealSettings, privacyResidueCommunityId, privacyResidueSinceStart, type CatalogBuildStat } from "./dealsService";
import { hasBuilderReader } from "./dealsAdapters";
import { heldReasonsOf } from "../shared/dealsHeldIncentive";

/**
 * Whether a held offer puts the neutral line on the buyer pages, as the catalogs decide it: not one held because a manual
 * override is live (the override shows; the sync records that as differs_from_manual_override on every read), not past
 * a date it carries, and re-read within the lapse window. A row without those columns (older snapshot) counts.
 */
export function heldIncentiveCountsAsShowingLine(row: { holdReason: string | null; confirmedAt?: Date | null; expiresAt?: Date | null }, now: Date, lapseDays: number): boolean {
  const reasons = heldReasonsOf(row.holdReason);
  if (!reasons.length || reasons.includes("differs_from_manual_override")) return false;
  if (row.expiresAt && row.expiresAt <= now) return false;
  return !row.confirmedAt || row.confirmedAt.getTime() > now.getTime() - lapseDays * 86_400_000;
}
import { activeCatalogHold } from "./dealsSync";
import { fubHeaders } from "./fub";

export { syncKnownAgentsFromFub } from "./dealsKnownAgents";
export type { KnownAgentsSyncResult } from "./dealsKnownAgents";

const FUB_API_URL = "https://api.followupboss.com/v1";
const FUB_TIMEOUT_MS = 15_000;
const FUB_PAGE_SIZE = 100;
const MAX_FUB_PAGES = 10_000;
const HEALTH_JOB_NAME = "builder-deals-health";

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

type TeamSyncCounts = { usersFetched: number; activeUsers: number; upserted: number; skipped: number; deactivated: number; orphanedTeamLeads: number };
export type TeamAllowlistSyncAbortReason = "database_unavailable" | "fub_no_users" | "fub_no_active_users" | FubErrorReason;
type TeamAllowlistSyncResult =
  | ({ ok: true } & TeamSyncCounts)
  | ({ ok: false; reason: TeamAllowlistSyncAbortReason; emailed: boolean } & TeamSyncCounts);

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

/** Every phone field FUB exposes on a user; each one becomes its own mirror row. */
function fubPhones(record: FubUser): string[] {
  return Array.from(new Set(
    [record.phone, record.mobile, record.mobilePhone, record.cellPhone, record.workPhone, record.homePhone, record.phones]
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

/** FUB recommends cursor pagination; legacy accounts still work through offset fallback. Only documented parameters are sent. */
async function listAllFubUsers(): Promise<FubUserListResult> {
  const users: FubUser[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let offset = 0;
  for (let page = 0; page < MAX_FUB_PAGES; page += 1) {
    const params = new URLSearchParams({ limit: String(FUB_PAGE_SIZE) });
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

const INACTIVE_USER_STATUS = /^(inactive|deactivated|deleted|disabled|archived|suspended)$/i;
/**
 * A returned FUB user is a team member unless FUB explicitly says otherwise:
 * `active: false`, `deleted: true`, or an inactive-style status. A response that
 * simply omits these fields must never deactivate the whole team.
 */
export function isActiveFubUser(user: FubUser) {
  if (user.active === false) return false;
  if (user.deleted === true || user.isDeleted === true) return false;
  const status = nonEmptyString(user.status, 80);
  if (status && INACTIVE_USER_STATUS.test(status)) return false;
  return true;
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

/** An aborted mirror changes nothing and tells the alert recipients why. */
async function abortTeamSync(counts: TeamSyncCounts, reason: TeamAllowlistSyncAbortReason, detail: string): Promise<TeamAllowlistSyncResult> {
  let emailed = false;
  try {
    const settings = await getDealSettings();
    const sent = await sendBuilderDealsEmail({
      category: "team_sync",
      recipients: settings.alertRecipients,
      subject: "Builder Deals team sync aborted",
      content: [
        "The nightly Follow Up Boss team mirror was aborted and changed nothing.",
        `Reason: ${detail}`,
        `Users returned: ${counts.usersFetched}; active users: ${counts.activeUsers}.`,
        "The current team allowlist was left exactly as it was. Check FUB_API_KEY and the FUB users list, then run the team sync again from Admin, Builder Deals.",
      ].join("\n"),
    });
    emailed = sent.ok;
  } catch (error) {
    console.error("[deals team sync] abort email failed", error);
  }
  return { ok: false, ...counts, reason, emailed };
}

/**
 * Mirrors every identity of every active FUB user. A completed remote scan is
 * authoritative for FUB-sourced rows only; manual/test rows are untouched.
 * Missing or inactive remote users are deactivated, then their no-longer-team
 * sessions are expired and revoked by the reverse cascade. An errored, empty or
 * all-inactive users list aborts BEFORE any row changes and emails the owners.
 */
export async function syncTeamAllowlistFromFub(): Promise<TeamAllowlistSyncResult> {
  const db = await getDb();
  const empty: TeamSyncCounts = { usersFetched: 0, activeUsers: 0, upserted: 0, skipped: 0, deactivated: 0, orphanedTeamLeads: 0 };
  if (!db) return abortTeamSync(empty, "database_unavailable", "The database was unavailable.");
  const response = await listAllFubUsers();
  if (!response.ok) return abortTeamSync(empty, response.reason, `The FUB users request failed (${response.reason.replace(/_/g, " ")}).`);
  if (response.users.length === 0) return abortTeamSync(empty, "fub_no_users", "FUB returned zero users.");
  const activeUsers = response.users.filter(isActiveFubUser);
  const counts: TeamSyncCounts = { ...empty, usersFetched: response.users.length, activeUsers: activeUsers.length };
  if (activeUsers.length === 0) return abortTeamSync(counts, "fub_no_active_users", "FUB returned users but every one of them is marked inactive.");

  let upserted = 0;
  let skipped = 0;
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
  } catch (error) {
    return abortTeamSync({ ...counts, upserted, skipped }, "database_unavailable", `A database write failed before the mirror completed (${error instanceof Error ? error.message.slice(0, 200) : "unknown error"}). Rows already refreshed are correct; nothing was deactivated.`);
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

/** The spec's daily health thresholds. */
export const BUILDER_DEALS_HEALTH_THRESHOLDS = {
  /** The TREC source runs nightly; older than 36 hours needs review. */
  trecImportHours: 36,
  /** Official community data refreshes daily by default; a day of slack past the Admin cadence means a missed run. */
  communityUpdateHours: 48,
  /** No photo may wait in the processing queue for over an hour. */
  pendingPhotoMinutes: 60,
  /** More claims than this put back after their run vanished in the last hour: runs are being cut off or recycled. */
  photoLeaseExpiredPerHour: 50,
  /** A FUB write still failing an hour after it was queued needs review. */
  fubFailureMinutes: 60,
  /** Alert emails that failed to send in the last day. */
  emailFailureHours: 24,
  /** Scheduled job runs that failed in the last day (team/agent sync, imports, refresh). */
  jobFailureHours: 24,
  /** Alert when the Twilio balance drops under this amount. */
  twilioMinimumBalanceUsd: 20,
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
export function ageMinutes(at: Date | string | null | undefined, now = new Date()): number | null {
  if (!at) return null;
  const value = new Date(at).getTime();
  return Number.isFinite(value) ? Math.max(0, Math.floor((now.getTime() - value) / 60_000)) : null;
}

type TwilioInspection = { account: TwilioAccountState; accountStatus: string | null; balance: TwilioBalanceState; balanceUsd: number | null; currency: string | null };

/** Reads the account status and the balance amount; the Monday email reports the amount, never a credential. */
async function inspectTwilioAccount(): Promise<TwilioInspection> {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const service = process.env.TWILIO_VERIFY_SERVICE_SID?.trim();
  if (!sid || !token || !service) return { account: "not_checked", accountStatus: null, balance: "not_checked", balanceUsd: null, currency: null };
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
      : null;
    const balanceValue = balanceBody && typeof balanceBody === "object" ? Number((balanceBody as { balance?: unknown }).balance) : Number.NaN;
    const currency = balanceBody && typeof balanceBody === "object" && typeof (balanceBody as { currency?: unknown }).currency === "string" ? (balanceBody as { currency: string }).currency : null;
    return {
      account: !accountResponse.ok ? "unavailable" : accountStatus === "active" ? "active" : "inactive",
      accountStatus,
      balance: !balanceResponse.ok || !Number.isFinite(balanceValue) ? "unavailable" : balanceValue < BUILDER_DEALS_HEALTH_THRESHOLDS.twilioMinimumBalanceUsd ? "low" : "available",
      balanceUsd: Number.isFinite(balanceValue) ? Math.round(balanceValue * 100) / 100 : null,
      currency,
    };
  } catch {
    return { account: "unavailable", accountStatus: null, balance: "unavailable", balanceUsd: null, currency: null };
  }
}

async function checkFubAvailability(): Promise<AvailabilityState> {
  const result = await getFubJson("/identity");
  return result.ok ? "available" : result.reason === "fub_not_configured" ? "not_checked" : "unavailable";
}

export type HoldItem = { kind: "community" | "incentive"; communityId: number; label: string; reason: string; since: Date | null; ageHours: number | null };

type OperationalSnapshot = {
  available: boolean;
  funnel: { landed: number; consented: number; verificationSends: number; verified: number; listingViews: number; requests: number; newLeads: number };
  trecImport: { completedAt: Date | null; ageHours: number | null; state: HealthState };
  sourceUpdates: { activeCommunities: number; staleCommunities: number; heldCommunities: number; oldestAgeHours: number | null; lastSuccessfulSyncAt: Date | null; state: HealthState };
  photos: { pending: number; processing: number; failed: number; awaitingRegion: number; oldestPendingAgeHours: number | null; oldestPendingMinutes: number | null; drainStalledMinutes: number | null; drainError: string | null; drainWarning?: string | null; leaseExpiredLastHour: number; lastDrain: LastPhotoDrain | null; serverBootsLast24h?: number | null; serverLife?: { mallocArenaMax: string | null; answeringProcess: ProcessSnapshot; bootsLastHour: number | null; recent: ReturnType<typeof serverLives> }; state: HealthState };
  fubFailures: { jobs: number; leads: number; failingOverAnHour: number; state: HealthState };
  emailFailures: { failed: number; state: HealthState };
  jobFailures: { failed: number; jobs: string[]; state: HealthState };
  /** incentivesShowingLine: held offers whose community shows "Builder incentive available" (not those behind a manual override, nor stale ones). */
  holds: { communities: number; incentives: number; incentivesShowingLine: number; items: HoldItem[]; state: HealthState };
  /** Buyer-facing community entries dropped because a private name survived scrubbing (deal_events rows in the window, plus the in-process counter). */
  privacyResidue: { dropped: number; communityIds: number[]; droppedSinceStart: number; state: HealthState };
  /** The last build of each unlocked-list view in this process (Oct 27: what a cold open waits on), by view key. */
  catalogBuilds: Record<string, CatalogBuildStat>;
};

const emptyOperationalSnapshot = (): OperationalSnapshot => ({
  available: false,
  funnel: { landed: 0, consented: 0, verificationSends: 0, verified: 0, listingViews: 0, requests: 0, newLeads: 0 },
  trecImport: { completedAt: null, ageHours: null, state: "unknown" },
  sourceUpdates: { activeCommunities: 0, staleCommunities: 0, heldCommunities: 0, oldestAgeHours: null, lastSuccessfulSyncAt: null, state: "unknown" },
  photos: { pending: 0, processing: 0, failed: 0, awaitingRegion: 0, oldestPendingAgeHours: null, oldestPendingMinutes: null, drainStalledMinutes: null, drainError: null, leaseExpiredLastHour: 0, lastDrain: null, state: "unknown" },
  fubFailures: { jobs: 0, leads: 0, failingOverAnHour: 0, state: "unknown" },
  emailFailures: { failed: 0, state: "unknown" },
  jobFailures: { failed: 0, jobs: [], state: "unknown" },
  holds: { communities: 0, incentives: 0, incentivesShowingLine: 0, items: [], state: "unknown" },
  privacyResidue: { dropped: 0, communityIds: [], droppedSinceStart: privacyResidueSinceStart().dropped, state: "unknown" },
  catalogBuilds: catalogBuildsSinceStart(),
});

function holdText(value: string | null | undefined) {
  return (value ?? "").trim();
}

/** A Manual-builder or manual-mode community never refreshes, so it is neither on schedule nor late. */
/** Only a community the scheduled refresh maintains can be on schedule or stale: not manual, and its builder has a reader. */
function isManagedCommunity(community: { manualMode: boolean; builder: string }) {
  return !community.manualMode && community.builder !== "Manual" && hasBuilderReader(community.builder);
}

/** Collects every local B9 threshold without an outbound request or notification. */
export async function builderDealsOperationalSnapshot(now = new Date()): Promise<OperationalSnapshot> {
  const db = await getDb();
  if (!db) return emptyOperationalSnapshot();
  const thresholds: { -readonly [K in keyof typeof BUILDER_DEALS_HEALTH_THRESHOLDS]: number } = { ...BUILDER_DEALS_HEALTH_THRESHOLDS };
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
  const fubFailureCutoff = new Date(now.getTime() - thresholds.fubFailureMinutes * 60_000);
  const emailFailureCutoff = new Date(now.getTime() - thresholds.emailFailureHours * 60 * 60_000);
  const jobFailureCutoff = new Date(now.getTime() - thresholds.jobFailureHours * 60 * 60_000);
  try {
    const [funnelRows, newLeadRows, latestImport, communities, photoRows, failedJobRows, staleJobRows, failedLeadRows, heldIncentives, failedEmailRows, failedRunRows, residueRows] = await Promise.all([
      db.select({
        landed: sql<number>`SUM(${dealEvents.kind} = 'landed')`,
        consented: sql<number>`SUM(${dealEvents.kind} = 'consent')`,
        verificationSends: sql<number>`SUM(${dealEvents.kind} = 'code_sent')`,
        verified: sql<number>`SUM(${dealEvents.kind} = 'verified')`,
        listingViews: sql<number>`SUM(${dealEvents.kind} = 'viewed_listings')`,
        requests: sql<number>`SUM(${dealEvents.kind} = 'tour_request')`,
      }).from(dealEvents).where(gte(dealEvents.createdAt, sevenDaysAgo)),
      db.select({ count: sql<number>`COUNT(*)` }).from(dealLeads).where(gte(dealLeads.createdAt, sevenDaysAgo)),
      db.select({ completedAt: dealTrecImports.completedAt }).from(dealTrecImports).where(eq(dealTrecImports.current, true)).orderBy(desc(dealTrecImports.completedAt)).limit(1),
      db.select({
        id: dealCommunities.id, privateName: dealCommunities.privateName, publicLabel: dealCommunities.publicLabel, builder: dealCommunities.builder, manualMode: dealCommunities.manualMode,
        lastSuccessfulSyncAt: dealCommunities.lastSuccessfulSyncAt,
        // The two hold columns, never the "catalog: ...; incentive: ..." summary: an incentive hold is not a community-update hold.
        catalogHoldReason: dealCommunities.catalogHoldReason, catalogHoldSeenAt: dealCommunities.catalogHoldSeenAt, incentiveHoldReason: dealCommunities.incentiveHoldReason, incentiveHoldSeenAt: dealCommunities.incentiveHoldSeenAt,
      }).from(dealCommunities).where(and(eq(dealCommunities.active, true), eq(dealCommunities.paused, false))),
      db.select({
        pending: sql<number>`SUM(${dealPhotos.processingState} = 'pending')`,
        processing: sql<number>`SUM(${dealPhotos.processingState} = 'processing')`,
        failed: sql<number>`SUM(${dealPhotos.processingState} = 'failed')`,
        // Parked rows (awaiting a builder watermark region) are reported separately and never age the queue;
        // updatedAt (not createdAt) so a requeued old photo does not trip the limit instantly.
        oldestPendingAt: sql<Date | null>`MIN(CASE WHEN ${dealPhotos.processingState} IN ('pending', 'processing') AND (${dealPhotos.lastProcessingError} IS NULL OR ${dealPhotos.lastProcessingError} <> 'awaiting_region') THEN ${dealPhotos.updatedAt} END)`,
        awaitingRegion: sql<number>`SUM(${dealPhotos.lastProcessingError} = 'awaiting_region' AND ${dealPhotos.processingState} = 'pending')`,
        // Claims put back in the last hour because their run vanished (cut off by the host, or the instance recycled).
        leaseExpiredLastHour: sql<number>`SUM(${dealPhotos.lastProcessingError} = 'processing_lease_expired' AND ${dealPhotos.updatedAt} >= ${new Date(now.getTime() - 60 * 60_000)})`,
      }).from(dealPhotos),
      db.select({ count: sql<number>`COUNT(*)` }).from(dealFubJobs).where(eq(dealFubJobs.status, "failed")),
      db.select({ count: sql<number>`COUNT(*)` }).from(dealFubJobs).where(and(eq(dealFubJobs.status, "failed"), lt(dealFubJobs.createdAt, fubFailureCutoff))),
      db.select({ count: sql<number>`COUNT(*)` }).from(dealLeads).where(eq(dealLeads.fubStatus, "failed")),
      db.select({ id: dealIncentives.id, communityId: dealIncentives.communityId, holdReason: dealIncentives.holdReason, createdAt: dealIncentives.createdAt, confirmedAt: dealIncentives.confirmedAt, expiresAt: dealIncentives.expiresAt }).from(dealIncentives).where(eq(dealIncentives.held, true)),
      db.select({ count: sql<number>`COUNT(*)` }).from(dealEmailLogs).where(and(eq(dealEmailLogs.deliveryStatus, "failed"), gte(dealEmailLogs.createdAt, emailFailureCutoff))),
      db.select({ jobName: dealJobRuns.jobName }).from(dealJobRuns).where(and(eq(dealJobRuns.status, "failed"), gte(dealJobRuns.startedAt, jobFailureCutoff))),
      db.select({ detail: dealEvents.detail }).from(dealEvents).where(and(eq(dealEvents.kind, PRIVACY_RESIDUE_EVENT_KIND), gte(dealEvents.createdAt, jobFailureCutoff))),
    ]);
    // The stale limit follows Admin's "Check each builder page every (days)" plus a day of slack.
    const dealSettings = await getDealSettings().catch(() => null);
    const refreshDays = dealSettings?.catalogRefreshDays ?? 1;
    const lapseDays = dealSettings?.incentiveLapseDays ?? 14;
    const cadenceDays = Number.isInteger(refreshDays) && refreshDays >= 1 && refreshDays <= 30 ? refreshDays : 1;
    thresholds.communityUpdateHours = Math.max(BUILDER_DEALS_HEALTH_THRESHOLDS.communityUpdateHours, (cadenceDays + 1) * 24);
    const number = (value: unknown) => Number(value ?? 0);
    const importAgeHours = ageHours(latestImport[0]?.completedAt, now);
    // Only communities the official refresh maintains can be on schedule or stale.
    const managed = communities.filter(isManagedCommunity);
    const communityAges = managed.map((community) => ageHours(community.lastSuccessfulSyncAt, now));
    const staleCommunities = communityAges.filter((age) => age === null || age > thresholds.communityUpdateHours).length;
    const finiteCommunityAges = communityAges.filter((age): age is number => age !== null);
    const lastSyncTimes = managed.map((community) => community.lastSuccessfulSyncAt?.getTime() ?? null).filter((value): value is number => value !== null);
    const photo = photoRows[0];
    const pending = number(photo?.pending), processing = number(photo?.processing), failed = number(photo?.failed), awaitingRegion = number(photo?.awaitingRegion);
    const oldestPendingAgeHours = ageHours(photo?.oldestPendingAt, now);
    const oldestPendingMinutes = ageMinutes(photo?.oldestPendingAt, now);
    const drainStatus = await readDealPhotoDrainStatus().catch(() => null);
    const drain = photoDrainStall(drainStatus, Math.max(0, pending - awaitingRegion), now);
    const lastDrain = lastPhotoDrain(drainStatus);
    const serverBoots = await readServerBoots().catch(() => null);
    const serverBootsLast24h = serverBoots ? serverBootsSince(serverBoots, new Date(now.getTime() - 24 * 3_600_000)) : null;
    const [beats, exits] = await Promise.all([readServerBeats().catch(() => []), readServerExits().catch(() => [])]);
    const serverLife = { mallocArenaMax: process.env.MALLOC_ARENA_MAX ?? null, answeringProcess: processSnapshot(now), bootsLastHour: serverBoots ? serverBootsSince(serverBoots, new Date(now.getTime() - 3_600_000)) : null, recent: serverLives(beats, exits, now) };
    const leaseExpiredLastHour = number(photo?.leaseExpiredLastHour);
    const communityLabel = (communityId: number) => {
      const community = communities.find((row) => row.id === communityId);
      return community ? `${community.privateName} (${community.publicLabel})` : `community ${communityId}`;
    };
    // A community-update hold is an active (not dismissed) catalog hold, as old
    // as the parse result that caused it; an incentive hold is as old as the held
    // record, because hold rules run only when it is created. A Manual community
    // never refreshes, so a leftover catalog hold on it is not actionable.
    const holdItems: HoldItem[] = [
      ...managed.flatMap((community): HoldItem[] => {
        const reason = activeCatalogHold(community);
        return reason ? [{ kind: "community", communityId: community.id, label: communityLabel(community.id), reason: holdText(reason), since: community.catalogHoldSeenAt ?? null, ageHours: ageHours(community.catalogHoldSeenAt, now) }] : [];
      }),
      ...heldIncentives.map((incentive): HoldItem => ({ kind: "incentive", communityId: incentive.communityId, label: communityLabel(incentive.communityId), reason: holdText(incentive.holdReason) || "Incentive hold awaiting Accept", since: incentive.createdAt, ageHours: ageHours(incentive.createdAt, now) })),
    ];
    const heldCommunities = holdItems.filter((item) => item.kind === "community").length;
    const failingOverAnHour = number(staleJobRows[0]?.count);
    const failedEmails = number(failedEmailRows[0]?.count);
    const failedRunNames = Array.from(new Set(failedRunRows.map((row) => row.jobName)));
    const residueCommunityIds = Array.from(new Set(residueRows.map((row) => privacyResidueCommunityId(row.detail)).filter((id): id is number => id !== null))).sort((a, b) => a - b);
    return {
      available: true,
      funnel: {
        landed: number(funnelRows[0]?.landed), consented: number(funnelRows[0]?.consented), verificationSends: number(funnelRows[0]?.verificationSends),
        verified: number(funnelRows[0]?.verified), listingViews: number(funnelRows[0]?.listingViews), requests: number(funnelRows[0]?.requests), newLeads: number(newLeadRows[0]?.count),
      },
      trecImport: { completedAt: latestImport[0]?.completedAt ?? null, ageHours: importAgeHours, state: healthState(importAgeHours !== null && importAgeHours <= thresholds.trecImportHours) },
      // A held run does not count as on schedule; a dismissed hold is not a hold and does.
      sourceUpdates: { activeCommunities: managed.length, staleCommunities, heldCommunities, oldestAgeHours: finiteCommunityAges.length ? Math.max(...finiteCommunityAges) : null, lastSuccessfulSyncAt: lastSyncTimes.length ? new Date(Math.max(...lastSyncTimes)) : null, state: healthState(staleCommunities === 0 && heldCommunities === 0) },
      photos: { pending, processing, failed, awaitingRegion, oldestPendingAgeHours, oldestPendingMinutes, drainStalledMinutes: drain.stalled ? drain.stalledMinutes : null, drainError: drain.lastError, drainWarning: drain.lastWarning, leaseExpiredLastHour, lastDrain, serverBootsLast24h, serverLife, state: healthState(failed === 0 && awaitingRegion === 0 && !drain.stalled && !drain.lastError && leaseExpiredLastHour <= thresholds.photoLeaseExpiredPerHour && (oldestPendingMinutes === null || oldestPendingMinutes <= thresholds.pendingPhotoMinutes)) },
      fubFailures: { jobs: number(failedJobRows[0]?.count), leads: number(failedLeadRows[0]?.count), failingOverAnHour, state: healthState(failingOverAnHour === 0) },
      emailFailures: { failed: failedEmails, state: healthState(failedEmails === 0) },
      jobFailures: { failed: failedRunRows.length, jobs: failedRunNames, state: healthState(failedRunRows.length === 0) },
      holds: { communities: heldCommunities, incentives: heldIncentives.length, incentivesShowingLine: heldIncentives.filter((row) => heldIncentiveCountsAsShowingLine(row, now, lapseDays)).length, items: holdItems, state: healthState(holdItems.length === 0) },
      privacyResidue: { dropped: residueRows.length, communityIds: residueCommunityIds, droppedSinceStart: privacyResidueSinceStart().dropped, state: healthState(residueRows.length === 0) },
      catalogBuilds: catalogBuildsSinceStart(),
    };
  } catch {
    return emptyOperationalSnapshot();
  }
}

const money = (value: number | null, currency: string | null) => value === null ? "unavailable" : `$${value.toFixed(2)}${currency && currency !== "USD" ? ` ${currency}` : ""}`;
const hoursLabel = (value: number | null) => value === null ? "not available" : `${value}h`;

export type HealthCheckOptions = {
  /** Delete cached renders for links expired more than a day ago (HIDE THE SAUCE step 7). Only the scheduled jobs pass true; an admin GET never changes state. */
  prune?: boolean;
};

/** Reports credential presence, the Twilio account state and balance, FUB and email configuration, and every local threshold. Read-only unless `prune` is set. */
export async function builderDealsHealthCheck(now = new Date(), options: HealthCheckOptions = {}) {
  const thresholds = BUILDER_DEALS_HEALTH_THRESHOLDS;
  const twilioVerify = {
    accountSid: credentialState(process.env.TWILIO_ACCOUNT_SID),
    authToken: credentialState(process.env.TWILIO_AUTH_TOKEN),
    serviceSid: credentialState(process.env.TWILIO_VERIFY_SERVICE_SID),
  };
  const fub = { apiKey: credentialState(process.env.FUB_API_KEY) };
  const twilioConfigured = Object.values(twilioVerify).every((value) => value === "configured");
  const [twilio, fubAvailability, operational, renderPrune] = await Promise.all([
    twilioConfigured ? inspectTwilioAccount() : Promise.resolve<TwilioInspection>({ account: "not_checked", accountStatus: null, balance: "not_checked", balanceUsd: null, currency: null }),
    checkFubAvailability(),
    builderDealsOperationalSnapshot(now),
    options.prune
      ? pruneDealPhotoRenders().catch((error) => { console.warn("[builder-deals] render prune failed", error); return null; })
      : Promise.resolve<DealPhotoRenderPruneResult | null>(null),
  ]);
  const resend = resendConfiguration();
  const attention: string[] = [];
  /** The items that stop leads (texting codes, Follow Up Boss, the database) or expose private details: only these are emailed. */
  const urgent: string[] = [];
  const urgentPush = (item: string) => { attention.push(item); urgent.push(item); };
  if (!twilioConfigured) urgentPush("Twilio Verify credentials are missing (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN or TWILIO_VERIFY_SERVICE_SID), so no code can be sent.");
  else {
    if (twilio.account === "unavailable") urgentPush("Twilio credentials did not work: the account lookup failed.");
    else if (twilio.account === "inactive") urgentPush(`Twilio account status is ${twilio.accountStatus ?? "unknown"}, not active.`);
    if (twilio.balance === "low") urgentPush(`Twilio balance is ${money(twilio.balanceUsd, twilio.currency)}, under the $${thresholds.twilioMinimumBalanceUsd} minimum.`);
    else if (twilio.balance === "unavailable") urgentPush("Twilio balance could not be read.");
  }
  if (fubAvailability === "not_checked") urgentPush("FUB_API_KEY is missing, so no lead reaches Follow Up Boss.");
  else if (fubAvailability === "unavailable") urgentPush("Follow Up Boss credentials did not work (the identity request failed).");
  if (resend.fromMissing) attention.push("RESEND_API_KEY is set but RESEND_FROM_EMAIL is not, so alert emails fall back to the project-owner notification and never reach steven@.");
  if (!operational.available) urgentPush("The database snapshot was unavailable, so the local checks could not run.");
  else {
    if (operational.trecImport.state === "attention") attention.push(operational.trecImport.completedAt ? `TREC file is ${hoursLabel(operational.trecImport.ageHours)} old (limit ${thresholds.trecImportHours}h).` : "No TREC import has completed yet.");
    if (operational.sourceUpdates.staleCommunities > 0) attention.push(`Last builder update is over ${thresholds.communityUpdateHours / 24} days old for ${operational.sourceUpdates.staleCommunities} of ${operational.sourceUpdates.activeCommunities} active communities (oldest ${hoursLabel(operational.sourceUpdates.oldestAgeHours)}).`);
    if (operational.sourceUpdates.heldCommunities > 0) attention.push(`${operational.sourceUpdates.heldCommunities} community update${operational.sourceUpdates.heldCommunities === 1 ? " is" : "s are"} held, which does not count as on schedule.`);
    const drainError = operational.photos.drainError ? operational.photos.drainError.replaceAll("_", " ") : null;
    if (operational.photos.drainStalledMinutes !== null) attention.push(`Photo processing is stuck: no photo moved in ${operational.photos.drainStalledMinutes} minutes while ${operational.photos.pending - operational.photos.awaitingRegion} are queued${drainError ? ` (last run: ${drainError})` : ""}.`);
    else if (drainError) attention.push(`The last photo processing run failed: ${drainError}.`);
    if (operational.photos.leaseExpiredLastHour > BUILDER_DEALS_HEALTH_THRESHOLDS.photoLeaseExpiredPerHour) attention.push(`Photo runs are being cut off: ${operational.photos.leaseExpiredLastHour} photos were put back in the last hour because their run vanished (limit ${BUILDER_DEALS_HEALTH_THRESHOLDS.photoLeaseExpiredPerHour}).`);
    if (operational.photos.drainWarning) attention.push(`Photo processing is running in plain order (oldest first): ${operational.photos.drainWarning}.`);
    if (operational.photos.state === "attention") attention.push(`Photo queue: ${operational.photos.failed} failed, ${operational.photos.awaitingRegion} awaiting a builder watermark region (Set watermark region in Admin, Builder Deals, Photos), oldest pending ${operational.photos.oldestPendingMinutes ?? 0} minutes (limit ${thresholds.pendingPhotoMinutes}).`);
    if (operational.fubFailures.state === "attention") urgentPush(`${operational.fubFailures.failingOverAnHour} FUB write${operational.fubFailures.failingOverAnHour === 1 ? " has" : "s have"} been failing for over ${thresholds.fubFailureMinutes} minutes.`);
    if (operational.emailFailures.state === "attention") attention.push(`${operational.emailFailures.failed} alert email${operational.emailFailures.failed === 1 ? "" : "s"} failed to send in the last ${thresholds.emailFailureHours} hours.`);
    if (operational.jobFailures.state === "attention") attention.push(`${operational.jobFailures.failed} scheduled job run${operational.jobFailures.failed === 1 ? "" : "s"} failed in the last ${thresholds.jobFailureHours} hours: ${operational.jobFailures.jobs.join(", ")}.`);
    if (operational.holds.incentives > 0) {
      const { incentives, incentivesShowingLine: showing } = operational.holds;
      attention.push(`${incentives} incentive hold${incentives === 1 ? "" : "s"}${showing ? `: ${showing} show${showing === 1 ? "s" : ""} "Builder incentive available" until reviewed` : ""}${incentives - showing ? `${showing ? "," : ":"} ${incentives - showing} behind a manual override or no longer re-read` : ""} (Accept is optional).`);
    }
    if (operational.privacyResidue.state === "attention") urgentPush(`${operational.privacyResidue.dropped} buyer-facing community entr${operational.privacyResidue.dropped === 1 ? "y was" : "ies were"} dropped for private residue in the last ${thresholds.jobFailureHours} hours (community id${operational.privacyResidue.communityIds.length === 1 ? "" : "s"} ${operational.privacyResidue.communityIds.join(", ") || "unknown"}). Review the names to hide and excluded terms in Admin, Builder Deals, Communities.`);
  }
  return {
    checkedAt: now,
    twilioVerify: { ...twilioVerify, account: twilio.account, accountStatus: twilio.accountStatus, balance: twilio.balance, balanceUsd: twilio.balanceUsd, currency: twilio.currency, state: healthState(twilioConfigured && twilio.account === "active" && twilio.balance === "available") },
    fub: { ...fub, availability: fubAvailability, state: healthState(fubAvailability === "available") },
    email: { provider: resend.ready ? "resend" as const : "owner_notification_fallback" as const, fromConfigured: Boolean(resend.from), state: healthState(!resend.fromMissing) },
    operational,
    renderPrune,
    attention,
    urgent,
    state: healthState(attention.length === 0),
  };
}

export type BuilderDealsHealth = Awaited<ReturnType<typeof builderDealsHealthCheck>>;

/** "Both the failure email and the Monday email list every community currently in a hold and how old the hold is." */
export function holdLines(items: HoldItem[]) {
  if (!items.length) return ["Holds: none."];
  return ["Holds:", ...items.map((item) => `- ${item.kind === "community" ? "Community update hold" : "Incentive hold"}, ${item.label}: ${item.reason || "no reason recorded"} (hold age ${item.ageHours === null ? "unknown" : `${item.ageHours}h`}${item.since ? `, since ${formatChicagoDateTime(item.since)}` : ""})`)];
}

/**
 * The 7:00 AM job: silent when every check passes; when any check needs
 * attention it emails the alert recipients the failing checks and every hold
 * with its age. Returns ok:false when that email could not be delivered so the
 * scheduled run is recorded as failed and shows up in tomorrow's check.
 */
export async function runBuilderDealsHealthJob(now = new Date()) {
  // The scheduled run owns the render prune; admin previews of the same check never change state.
  const health = await builderDealsHealthCheck(now, { prune: true });
  // Only what stops leads or exposes private details is emailed (no routine email, October 23, 2026); the rest stays in Admin.
  if (!health.urgent.length) return { ok: true as const, state: health.state, attention: health.attention, emailed: false, health };
  const settings = await getDealSettings();
  const sent = await sendBuilderDealsEmail({
    category: "health",
    recipients: settings.alertRecipients,
    subject: `Builder Deals health check: ${health.urgent.length} item${health.urgent.length === 1 ? "" : "s"} need attention`,
    content: [
      `Builder Deals daily health check at ${formatChicagoDateTime(now)} found ${health.urgent.length} item${health.urgent.length === 1 ? "" : "s"} that need attention:`,
      ...health.urgent.map((item) => `- ${item}`),
      "",
      ...holdLines(health.operational.holds.items),
      "",
      "Review Admin, Builder Deals (login required).",
    ].join("\n"),
  });
  return { ok: sent.ok, state: health.state, attention: health.attention, emailed: sent.ok, emailError: sent.error, health };
}

async function lastHealthJobRun() {
  const db = await getDb();
  if (!db) return null;
  try {
    return (await db.select({ status: dealJobRuns.status, chicagoDay: dealJobRuns.chicagoDay, completedAt: dealJobRuns.completedAt, startedAt: dealJobRuns.startedAt }).from(dealJobRuns).where(eq(dealJobRuns.jobName, HEALTH_JOB_NAME)).orderBy(desc(dealJobRuns.startedAt)).limit(1))[0] ?? null;
  } catch { return null; }
}

/**
 * Formats the Monday "System OK" body from the exact health-check values. It
 * performs no delivery itself so admin can preview it; the scheduled job sends
 * it through sendBuilderDealsMondayReport.
 */
export async function builderDealsMondayReport(now = new Date()) {
  const [health, lastRun] = await Promise.all([builderDealsHealthCheck(now), lastHealthJobRun()]);
  const { operational } = health;
  const attentionCount = health.attention.length;
  const body = [
    `Builder Deals System OK report for ${formatChicagoDateTime(now)}.`,
    "",
    `Last health check result: ${attentionCount === 0 ? "OK, every check passed" : `ATTENTION, ${attentionCount} item${attentionCount === 1 ? "" : "s"}`} (run at ${formatChicagoDateTime(health.checkedAt)}).`,
    ...health.attention.map((item) => `- ${item}`),
    `Last scheduled 7:00 AM check: ${lastRun ? `${lastRun.status} on ${lastRun.chicagoDay}${lastRun.completedAt ? ` at ${formatChicagoDateTime(lastRun.completedAt)}` : ""}` : "none recorded yet"}.`,
    `Last builder update: ${operational.sourceUpdates.lastSuccessfulSyncAt ? `${formatChicagoDateTime(operational.sourceUpdates.lastSuccessfulSyncAt)} (${hoursLabel(ageHours(operational.sourceUpdates.lastSuccessfulSyncAt, now))} ago)` : "never"}; ${operational.sourceUpdates.staleCommunities} of ${operational.sourceUpdates.activeCommunities} active communities stale (limit ${BUILDER_DEALS_HEALTH_THRESHOLDS.communityUpdateHours}h).`,
    `Twilio: account ${health.twilioVerify.accountStatus ?? health.twilioVerify.account}; balance ${money(health.twilioVerify.balanceUsd, health.twilioVerify.currency)} (alert under $${BUILDER_DEALS_HEALTH_THRESHOLDS.twilioMinimumBalanceUsd}).`,
    `Follow Up Boss: ${health.fub.availability} (${health.fub.apiKey}). Email transport: ${health.email.provider}.`,
    `Last 7 days: ${operational.funnel.verified} verifications, ${operational.funnel.newLeads} new leads, ${operational.funnel.verificationSends} code sends, ${operational.funnel.landed} landings, ${operational.funnel.listingViews} list views, ${operational.funnel.requests} tour or question requests.`,
    `TREC file: ${operational.trecImport.completedAt ? `${hoursLabel(operational.trecImport.ageHours)} old` : "no import yet"} (limit ${BUILDER_DEALS_HEALTH_THRESHOLDS.trecImportHours}h).`,
    `Photo queue: pending ${operational.photos.pending}, processing ${operational.photos.processing}, failed ${operational.photos.failed}; oldest queued ${operational.photos.oldestPendingMinutes === null ? "none" : `${operational.photos.oldestPendingMinutes} min`}; ${photoDrainLine(operational.photos.lastDrain, now)}; ${operational.photos.leaseExpiredLastHour} cut-off runs put back in the last hour; ${processLine(operational.photos.lastDrain?.process, operational.photos.serverBootsLast24h ?? null)}.`,
    `FUB writes failing over an hour: ${operational.fubFailures.failingOverAnHour} (failed jobs ${operational.fubFailures.jobs}, leads marked failed ${operational.fubFailures.leads}). Email send failures in 24h: ${operational.emailFailures.failed}. Scheduled job failures in 24h: ${operational.jobFailures.failed}${operational.jobFailures.jobs.length ? ` (${operational.jobFailures.jobs.join(", ")})` : ""}.`,
    "",
    ...holdLines(operational.holds.items),
    "",
    "If this email ever stops arriving on Monday, the cron or the email transport is down.",
  ].join("\n");
  const subject = attentionCount === 0 ? "Builder Deals System OK: all checks passed" : `Builder Deals System OK: ${attentionCount} item${attentionCount === 1 ? "" : "s"} need attention`;
  return { ok: true as const, subject, body, health };
}

/** The Monday 7:05 AM job: the System OK email goes out unconditionally. */
export async function sendBuilderDealsMondayReport(now = new Date()) {
  const report = await builderDealsMondayReport(now);
  const settings = await getDealSettings();
  const sent = await sendBuilderDealsEmail({ category: "weekly", recipients: settings.alertRecipients, subject: report.subject, content: report.body });
  return { ok: sent.ok, subject: report.subject, emailed: sent.ok, emailError: sent.error, attention: report.health.attention };
}
