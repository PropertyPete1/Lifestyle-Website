import { and, eq, lte } from "drizzle-orm";
import {
  dealDoNotAutoImport,
  dealFubRecords,
  dealKnownAgents,
  dealLeads,
  dealTeamAllowlist,
} from "../drizzle/schema";
import { normalizeUsPhone } from "../shared/deals";
import { notifyOwner } from "./_core/notification";
import { getDb } from "./db";
import { fubHeaders } from "./fub";
import { cleanupBuilderDealsFubRecord, stripBuilderDealsTestTag } from "./dealsFub";
import { getDealSettings } from "./dealsService";

const FUB_API_URL = "https://api.followupboss.com/v1";
const FUB_TIMEOUT_MS = 15_000;
const FUB_PAGE_SIZE = 100;
const MAX_RECRUIT_PAGES = 5;

export type CredentialState = "configured" | "missing";
export type AvailabilityState = "available" | "unavailable" | "not_checked";

type FubUser = Record<string, unknown>;
type FubPerson = Record<string, unknown>;
type FubResponse = Record<string, unknown>;
type FubErrorReason = "fub_not_configured" | "fub_unavailable" | "fub_invalid_response";

type FubFetchResult =
  | { ok: true; body: FubResponse }
  | { ok: false; reason: FubErrorReason };

type FubFailure = Extract<FubFetchResult, { ok: false }>;
type RecruitListResult = FubFailure | { ok: true; people: FubPerson[] };

type TeamAllowlistSyncResult =
  | { ok: true; usersFetched: number; upserted: number; skipped: number }
  | { ok: false; usersFetched: number; upserted: number; skipped: number; reason: "database_unavailable" | FubErrorReason };

type KnownAgentsSyncResult =
  | { ok: true; peopleFetched: number; recruitTagged: number; upserted: number; skipped: number; noteFetchFailures: number }
  | { ok: false; peopleFetched: number; recruitTagged: number; upserted: number; skipped: number; noteFetchFailures: number; reason: "database_unavailable" | FubErrorReason };

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
    // An unparseable value cannot prove this is a test record.
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

function firstFubEmail(record: Record<string, unknown>): string | null {
  return [record.email, record.emails]
    .flatMap(valuesFromField)
    .map(normalizeEmail)
    .find((value): value is string => Boolean(value)) ?? null;
}

function fubPhones(record: Record<string, unknown>): string[] {
  return Array.from(new Set(
    [record.phone, record.mobile, record.mobilePhone, record.phones]
      .flatMap(valuesFromField)
      .map(normalizeFubPhone)
      .filter((value): value is string => Boolean(value)),
  ));
}

function firstFubPhone(record: Record<string, unknown>): string | null {
  return fubPhones(record)[0] ?? null;
}

function fubName(record: Record<string, unknown>): string | null {
  const direct = nonEmptyString(record.name, 190);
  if (direct) return direct;
  const first = nonEmptyString(record.firstName ?? record.first_name, 90);
  const last = nonEmptyString(record.lastName ?? record.last_name, 90);
  return nonEmptyString([first, last].filter(Boolean).join(" "), 190);
}

function fubTags(record: FubPerson): string[] {
  const tags = record.tags;
  if (Array.isArray(tags)) return tags.filter((tag): tag is string => typeof tag === "string");
  if (typeof tags === "string") return [tags];
  return [];
}

function isRecruitTagged(record: FubPerson): boolean {
  return fubTags(record).some((tag) => tag.toLowerCase().includes("recruit"));
}

function noteText(note: unknown): string[] {
  if (!note || typeof note !== "object") return typeof note === "string" ? [note] : [];
  const record = note as Record<string, unknown>;
  const direct = [record.body, record.content, record.text, record.message, record.note]
    .filter((value): value is string => typeof value === "string");
  const nested = [record.notes, record.items].flatMap((value) => Array.isArray(value) ? value.flatMap(noteText) : []);
  return [...direct, ...nested];
}

function peopleFromResponse(body: FubResponse): FubPerson[] {
  return Array.isArray(body.people)
    ? body.people.filter((person): person is FubPerson => Boolean(person) && typeof person === "object")
    : [];
}

function usersFromResponse(body: FubResponse): FubUser[] {
  return Array.isArray(body.users)
    ? body.users.filter((user): user is FubUser => Boolean(user) && typeof user === "object")
    : [];
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

async function upsertFubTeamUser(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  user: FubUser,
): Promise<boolean> {
  const id = fubId(user.id);
  if (!id) return false;
  const values = {
    name: fubName(user),
    email: firstFubEmail(user),
    phoneE164: firstFubPhone(user),
    fubUserId: id,
    source: "fub" as const,
    active: true,
  };
  const existing = await db
    .select({ id: dealTeamAllowlist.id })
    .from(dealTeamAllowlist)
    .where(and(eq(dealTeamAllowlist.fubUserId, id), eq(dealTeamAllowlist.source, "fub")))
    .limit(1);
  if (existing[0]) {
    await db.update(dealTeamAllowlist).set(values).where(eq(dealTeamAllowlist.id, existing[0].id));
  } else {
    await db.insert(dealTeamAllowlist).values(values);
  }
  return true;
}

/** Mirrors a nonempty authoritative FUB users response while leaving manual rows alone. */
export async function syncTeamAllowlistFromFub(): Promise<TeamAllowlistSyncResult> {
  const db = await getDb();
  if (!db) return { ok: false, usersFetched: 0, upserted: 0, skipped: 0, reason: "database_unavailable" };

  const response = await getFubJson("/users");
  if (!response.ok) return { ok: false, usersFetched: 0, upserted: 0, skipped: 0, reason: response.reason };

  const users = usersFromResponse(response.body);
  if (!users.length) {
    await createDealsAlert("Builder Deals team sync needs attention", "Follow Up Boss returned zero users. The existing team allowlist was left unchanged.");
    return { ok: false, usersFetched: 0, upserted: 0, skipped: 0, reason: "fub_invalid_response" };
  }
  let upserted = 0;
  let skipped = 0;
  try {
    for (const user of users) {
      if (await upsertFubTeamUser(db, user)) upserted += 1;
      else skipped += 1;
    }
    const remoteIds = new Set(users.map((user) => fubId(user.id)).filter((value): value is string => Boolean(value)));
    const currentRows = await db.select().from(dealTeamAllowlist).where(eq(dealTeamAllowlist.source, "fub"));
    for (const row of currentRows) if (!row.fubUserId || !remoteIds.has(row.fubUserId)) await db.delete(dealTeamAllowlist).where(eq(dealTeamAllowlist.id, row.id));
  } catch {
    // Do not delete, deactivate, or continue into a partial write after a local persistence failure.
    return { ok: false, usersFetched: users.length, upserted: 0, skipped: 0, reason: "database_unavailable" };
  }
  return { ok: true, usersFetched: users.length, upserted, skipped };
}

async function listRecruitTaggedPeople(): Promise<RecruitListResult> {
  const people: FubPerson[] = [];
  for (let page = 0; page < MAX_RECRUIT_PAGES; page += 1) {
    const params = new URLSearchParams({ tag: "Recruit", limit: String(FUB_PAGE_SIZE), offset: String(page * FUB_PAGE_SIZE) });
    const response = await getFubJson(`/people?${params.toString()}`);
    if (!response.ok) return response;
    const batch = peopleFromResponse(response.body);
    // The tag query is a server-side narrowing request; filter again locally so
    // an ignored or broadened upstream filter can never import non-recruits.
    people.push(...batch.filter(isRecruitTagged));
    if (batch.length < FUB_PAGE_SIZE) break;
  }
  return { ok: true, people };
}

async function notePhonesForPerson(person: FubPerson): Promise<{ phones: string[]; fetchFailed: boolean }> {
  const personId = fubId(person.id);
  const embedded = noteText(person).flatMap(extractTenDigitPhoneStrings).map(normalizeFubPhone).filter((value): value is string => Boolean(value));
  if (!personId) return { phones: Array.from(new Set(embedded)), fetchFailed: false };

  const params = new URLSearchParams({ personId, limit: String(FUB_PAGE_SIZE) });
  const response = await getFubJson(`/notes?${params.toString()}`);
  if (!response.ok) return { phones: Array.from(new Set(embedded)), fetchFailed: true };
  const notes = Array.isArray(response.body.notes) ? response.body.notes : [];
  const fromNotes = notes.flatMap(noteText).flatMap(extractTenDigitPhoneStrings).map(normalizeFubPhone).filter((value): value is string => Boolean(value));
  return { phones: Array.from(new Set([...embedded, ...fromNotes])), fetchFailed: false };
}

function suppressedValues(rows: Array<{ value: string; kind: "phone" | "email" }>) {
  return {
    phones: new Set(rows.filter((row) => row.kind === "phone").map((row) => normalizeFubPhone(row.value)).filter((value): value is string => Boolean(value))),
    emails: new Set(rows.filter((row) => row.kind === "email").map((row) => row.value.trim().toLowerCase())),
  };
}

async function upsertFubRecruit(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  person: FubPerson,
  phoneE164: string | null,
  email: string | null,
): Promise<boolean> {
  const id = fubId(person.id);
  if (!id || (!phoneE164 && !email)) return false;
  const values = {
    name: fubName(person),
    phoneE164,
    email,
    fubPersonId: id,
    source: "fub_recruit" as const,
    active: true,
  };
  const existing = await db
    .select({ id: dealKnownAgents.id })
    .from(dealKnownAgents)
    .where(and(eq(dealKnownAgents.fubPersonId, id), eq(dealKnownAgents.source, "fub_recruit")))
    .limit(1);
  if (existing[0]) {
    await db.update(dealKnownAgents).set(values).where(eq(dealKnownAgents.id, existing[0].id));
  } else {
    await db.insert(dealKnownAgents).values(values);
  }
  return true;
}

/**
 * Imports only FUB people explicitly tagged as recruits. Note-phone extraction
 * is intentionally limited to standalone ten-digit strings. Any matching
 * do-not-auto-import identifier suppresses the whole person, preserving the
 * stronger local privacy preference rather than importing another identifier.
 */
export async function syncKnownAgentsFromFub(): Promise<KnownAgentsSyncResult> {
  const db = await getDb();
  if (!db) return { ok: false, peopleFetched: 0, recruitTagged: 0, upserted: 0, skipped: 0, noteFetchFailures: 0, reason: "database_unavailable" };

  const response = await listRecruitTaggedPeople();
  if (!response.ok) return { ok: false, peopleFetched: 0, recruitTagged: 0, upserted: 0, skipped: 0, noteFetchFailures: 0, reason: response.reason };

  const doNotImportRows = await db.select({ value: dealDoNotAutoImport.value, kind: dealDoNotAutoImport.kind }).from(dealDoNotAutoImport);
  const suppressed = suppressedValues(doNotImportRows);
  let upserted = 0;
  let skipped = 0;
  let noteFetchFailures = 0;

  try {
    for (const person of response.people) {
      const notes = await notePhonesForPerson(person);
      if (notes.fetchFailed) {
        // We cannot verify note-only identifiers against the suppression list.
        // Skip rather than risk importing someone who opted out locally.
        noteFetchFailures += 1;
        skipped += 1;
        continue;
      }
      const phones = Array.from(new Set([...fubPhones(person), ...notes.phones]));
      const email = firstFubEmail(person);
      // A single suppressed identifier is enough to opt this FUB person out.
      if ((email && suppressed.emails.has(email)) || phones.some((phone) => suppressed.phones.has(phone))) {
        skipped += 1;
        continue;
      }
      if (await upsertFubRecruit(db, person, phones[0] ?? null, email)) upserted += 1;
      else skipped += 1;
    }
  } catch {
    // Fail closed: this routine has no deletion/deactivation path and does not retry a partially failed batch.
    return { ok: false, peopleFetched: response.people.length, recruitTagged: response.people.length, upserted: 0, skipped: 0, noteFetchFailures, reason: "database_unavailable" };
  }
  return { ok: true, peopleFetched: response.people.length, recruitTagged: response.people.length, upserted, skipped, noteFetchFailures };
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

async function checkTwilioBalance(): Promise<AvailabilityState> {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const service = process.env.TWILIO_VERIFY_SERVICE_SID?.trim();
  if (!sid || !token || !service) return "not_checked";
  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Balance.json`, {
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` },
      signal: AbortSignal.timeout(FUB_TIMEOUT_MS),
    });
    return response.ok ? "available" : "unavailable";
  } catch {
    return "unavailable";
  }
}

async function checkFubAvailability(): Promise<AvailabilityState> {
  const result = await getFubJson("/identity");
  return result.ok ? "available" : result.reason === "fub_not_configured" ? "not_checked" : "unavailable";
}

/** Reports only configured/missing credential states; no secret or balance amount is exposed. */
export async function builderDealsHealthCheck() {
  const twilioVerify = {
    accountSid: credentialState(process.env.TWILIO_ACCOUNT_SID),
    authToken: credentialState(process.env.TWILIO_AUTH_TOKEN),
    serviceSid: credentialState(process.env.TWILIO_VERIFY_SERVICE_SID),
  };
  const fub = { apiKey: credentialState(process.env.FUB_API_KEY) };
  const twilioConfigured = Object.values(twilioVerify).every((value) => value === "configured");
  const [twilioBalance, fubAvailability] = await Promise.all([
    twilioConfigured ? checkTwilioBalance() : Promise.resolve<AvailabilityState>("not_checked"),
    checkFubAvailability(),
  ]);
  return {
    twilioVerify: { ...twilioVerify, balance: twilioBalance },
    fub: { ...fub, availability: fubAvailability },
  };
}

/** Sends an owner-facing maintenance alert through the established notification service. */
export async function createDealsAlert(title: string, body: string): Promise<boolean> {
  return notifyOwner({ title, content: body });
}
