import { and, eq, or } from "drizzle-orm";
import { dealDoNotAutoImport, dealFubRecords, dealKnownAgents, dealLeads, dealTeamAllowlist } from "../drizzle/schema";
import { normalizeUsPhone } from "../shared/deals";
import { getDb } from "./db";
import { isBuilderDealsSystemNote } from "./dealsFub";
import { getDealSettings } from "./dealsService";
import { fubHeaders } from "./fub";
import { revokeNonTeamMatchingDealLinks } from "./dealsEligibility";

export type KnownAgentRow = {
  name?: string;
  phone?: string;
  email?: string;
  /** Present only for the FUB mirror so refreshes update the same remote person. */
  fubPersonId?: string;
};

const FUB_API_URL = "https://api.followupboss.com/v1";
const FUB_PAGE_SIZE = 100;
const FUB_TIMEOUT_MS = 15_000;
const MAX_FUB_PAGES = 10_000;
/** `fields` is documented for /people; it keeps the nightly full scan small. */
const PEOPLE_FIELDS = "id,name,firstName,lastName,phones,emails,tags,source";
/** Every tag starting with this word marks a recruit, in addition to the exact admin list. */
const RECRUIT_TAG_PREFIX = "recruit";

type FubRecord = Record<string, unknown>;
type FubFailureReason = "fub_not_configured" | "fub_unavailable" | "fub_invalid_response";
type FubFetchResult = { ok: true; body: FubRecord } | { ok: false; reason: FubFailureReason };

/** Every automatic-import exclusion is counted per skipped identifier, not per person. */
export type KnownAgentSkipLists = {
  doNotAutoImport: number;
  teamAllowlist: number;
  activeFubUsers: number;
  teamPreviewLeads: number;
  manuallyManagedKnownAgents: number;
  textLineAndTestNumbers: number;
  nonRecruitContacts: number;
  systemNotes: number;
};

export type KnownAgentsSyncResult =
  | {
    ok: true;
    peopleFetched: number;
    recruitTagged: number;
    upserted: number;
    skipped: number;
    noteFetchFailures: number;
    linksKilled: number;
    skippedBy: KnownAgentSkipLists;
  }
  | {
    ok: false;
    peopleFetched: number;
    recruitTagged: number;
    upserted: number;
    skipped: number;
    noteFetchFailures: number;
    linksKilled: number;
    skippedBy: KnownAgentSkipLists;
    reason: "database_unavailable" | FubFailureReason;
  };

const emptySkipLists = (): KnownAgentSkipLists => ({
  doNotAutoImport: 0,
  teamAllowlist: 0,
  activeFubUsers: 0,
  teamPreviewLeads: 0,
  manuallyManagedKnownAgents: 0,
  textLineAndTestNumbers: 0,
  nonRecruitContacts: 0,
  systemNotes: 0,
});

const lower = (value?: string | null) => value?.trim().toLowerCase() || null;
const phone = (value?: string | null) => {
  if (!value) return null;
  const parsed = normalizeUsPhone(value, { allowCanada: true });
  return parsed.ok ? parsed.e164 : null;
};
const validEmail = (value?: string | null) => {
  const normalized = lower(value);
  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
};
const nonEmpty = (value: unknown, maxLength: number) => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
};
const fubId = (value: unknown) => nonEmpty(value, 80);
const fubIdentityKey = (personId: string, phoneE164: string | null, email: string | null) =>
  `fub:${personId}:${phoneE164 ?? `email:${email ?? "none"}`}`;

/** Small RFC4180-compatible row parser for the three supported columns. */
export function parseKnownAgentsCsv(csv: string): KnownAgentRow[] {
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < csv.length; i++) { const ch = csv[i], next = csv[i + 1]; if (ch === '"' && quoted && next === '"') { cell += '"'; i++; } else if (ch === '"') quoted = !quoted; else if (ch === "," && !quoted) { row.push(cell.trim()); cell = ""; } else if ((ch === "\n" || ch === "\r") && !quoted) { if (ch === "\r" && next === "\n") i++; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; } else cell += ch; }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift()!.map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  return rows.map((values) => ({ name: values[headers.findIndex((h) => h === "name" || h === "fullname")]?.trim() || undefined, phone: values[headers.findIndex((h) => h.includes("phone"))]?.trim() || undefined, email: values[headers.findIndex((h) => h.includes("email"))]?.trim() || undefined })).filter((item) => item.name || item.phone || item.email);
}

async function prohibited(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, value: string | null, kind: "phone" | "email") {
  if (!value) return false;
  return Boolean((await db.select({ id: dealDoNotAutoImport.id }).from(dealDoNotAutoImport).where(and(eq(dealDoNotAutoImport.value, value), eq(dealDoNotAutoImport.kind, kind))).limit(1))[0]);
}

function identitiesFromRows(rows: Array<{ phoneE164: string | null; email: string | null }>) {
  return {
    phones: new Set(rows.map((row) => row.phoneE164).filter((value): value is string => Boolean(value))),
    emails: new Set(rows.map((row) => row.email).filter((value): value is string => Boolean(value))),
  };
}

/**
 * Imports manually supplied rows and automatic FUB rows through the same
 * normalized upsert and live-link-revocation path. Suppression is checked
 * before any persistence for every source, so a privacy exclusion cannot be
 * bypassed by an alternate import entry point.
 */
export async function importKnownAgents(rows: KnownAgentRow[], source: "csv" | "fub_recruit" | "manual" = "csv") {
  const db = await getDb(); if (!db) throw new Error("Database unavailable");
  let imported = 0, skipped = 0, linksKilled = 0;
  for (const row of rows) {
    const phoneE164 = phone(row.phone), email = validEmail(row.email);
    const personId = source === "fub_recruit" ? fubId(row.fubPersonId) : null;
    const remoteIdentityKey = personId ? fubIdentityKey(personId, phoneE164, email) : null;
    if (!row.name && !phoneE164 && !email) { skipped++; continue; }
    if (await prohibited(db, phoneE164, "phone") || await prohibited(db, email, "email")) { skipped++; continue; }

    const matches = [phoneE164 ? eq(dealKnownAgents.phoneE164, phoneE164) : undefined, email ? eq(dealKnownAgents.email, email) : undefined].filter(Boolean) as any[];
    const existing = remoteIdentityKey
      ? (await db.select().from(dealKnownAgents).where(eq(dealKnownAgents.fubIdentityKey, remoteIdentityKey)).limit(1))[0]
      : matches.length ? (await db.select().from(dealKnownAgents).where(or(...matches)).limit(1))[0] : undefined;

    // Automatic FUB refreshes never overwrite a locally curated row, even when
    // a later FUB contact shares an identifier with it.
    if (source === "fub_recruit" && existing && existing.source !== "fub_recruit") { skipped++; continue; }
    const values = { name: row.name?.trim() || null, phoneE164, email, source, ...(source === "fub_recruit" ? { fubPersonId: personId, fubIdentityKey: remoteIdentityKey } : {}) } as const;
    if (existing) await db.update(dealKnownAgents).set({ ...values, active: true }).where(eq(dealKnownAgents.id, existing.id));
    else await db.insert(dealKnownAgents).values(values);
    linksKilled += await revokeNonTeamMatchingDealLinks(db, { phoneE164, email });
    imported++;
  }
  return { imported, skipped, linksKilled };
}

function valuesFromField(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(valuesFromField);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return [record.value, record.email, record.phone, record.number].filter((item) => item !== undefined);
  }
  return value === undefined || value === null ? [] : [value];
}

function fubPhones(record: FubRecord): string[] {
  return Array.from(new Set([record.phone, record.mobile, record.mobilePhone, record.phones]
    .flatMap(valuesFromField)
    .map((value) => phone(typeof value === "string" || typeof value === "number" ? String(value) : null))
    .filter((value): value is string => Boolean(value))));
}

function firstFubEmail(record: FubRecord) {
  return [record.email, record.emails].flatMap(valuesFromField)
    .map((value) => validEmail(typeof value === "string" || typeof value === "number" ? String(value) : null))
    .find((value): value is string => Boolean(value)) ?? null;
}

function fubName(record: FubRecord) {
  const direct = nonEmpty(record.name, 190);
  if (direct) return direct;
  const first = nonEmpty(record.firstName ?? record.first_name, 90);
  const last = nonEmpty(record.lastName ?? record.last_name, 90);
  return nonEmpty([first, last].filter(Boolean).join(" "), 190) ?? undefined;
}

function fubTags(record: FubRecord): string[] {
  const tags = record.tags;
  const values = Array.isArray(tags) ? tags : tags === undefined || tags === null ? [] : [tags];
  return values.flatMap((tag) => typeof tag === "string" ? [tag] : tag && typeof tag === "object" ? [((tag as FubRecord).name ?? (tag as FubRecord).value)].flatMap(valuesFromField).filter((value): value is string => typeof value === "string") : []);
}

function noteText(note: unknown): string[] {
  if (!note || typeof note !== "object") return typeof note === "string" ? [note] : [];
  const record = note as FubRecord;
  const direct = [record.body, record.content, record.text, record.message, record.note]
    .filter((value): value is string => typeof value === "string");
  const nested = [record.notes, record.items].flatMap((value) => Array.isArray(value) ? value.flatMap(noteText) : []);
  return [...direct, ...nested];
}

/**
 * Finds North American numbers typed into CRM notes in any common shape:
 * "2105550123", "(210) 555-0123", "210-555-0123", "210.555.0123", "+1 210 555
 * 0123" or "12105550123". Longer digit runs (account numbers) never match, and
 * every candidate still has to normalize to a valid US/Canada number.
 */
const NOTE_PHONE_PATTERN = /(?<!\d)(?:\+?1[\s.-]*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}(?!\d)/g;
export function extractNotePhones(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const matches = value.match(NOTE_PHONE_PATTERN) ?? [];
  return Array.from(new Set(matches.map((match) => phone(match)).filter((item): item is string => Boolean(item))));
}

async function getFubJson(path: string): Promise<FubFetchResult> {
  const apiKey = process.env.FUB_API_KEY?.trim();
  if (!apiKey) return { ok: false, reason: "fub_not_configured" };
  try {
    const response = await fetch(`${FUB_API_URL}${path}`, { headers: fubHeaders(apiKey), signal: AbortSignal.timeout(FUB_TIMEOUT_MS) });
    if (!response.ok) return { ok: false, reason: "fub_unavailable" };
    const body: unknown = await response.json().catch(() => null);
    return body && typeof body === "object" && !Array.isArray(body) ? { ok: true, body: body as FubRecord } : { ok: false, reason: "fub_invalid_response" };
  } catch {
    return { ok: false, reason: "fub_unavailable" };
  }
}

type FubListResult = { ok: true; values: FubRecord[] } | { ok: false; reason: FubFailureReason };

/** Uses FUB's keyset cursor when present, with offset fallback for older responses. */
async function listAllFub(path: string, collection: string, params: Record<string, string> = {}): Promise<FubListResult> {
  const values: FubRecord[] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null;
  let offset = 0;
  for (let page = 0; page < MAX_FUB_PAGES; page += 1) {
    const query = new URLSearchParams({ ...params, limit: String(FUB_PAGE_SIZE) });
    if (cursor) query.set("next", cursor); else query.set("offset", String(offset));
    const response = await getFubJson(`${path}?${query.toString()}`);
    if (!response.ok) return response;
    const raw = response.body[collection];
    if (!Array.isArray(raw)) return { ok: false, reason: "fub_invalid_response" };
    const batch = raw.filter((value): value is FubRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value));
    if (batch.length !== raw.length) return { ok: false, reason: "fub_invalid_response" };
    values.push(...batch);
    const metadata = response.body._metadata && typeof response.body._metadata === "object" ? response.body._metadata as FubRecord : {};
    const next = nonEmpty(metadata.next, 2_000);
    if (next) {
      if (cursors.has(next)) return { ok: false, reason: "fub_invalid_response" };
      cursors.add(next);
      cursor = next;
      continue;
    }
    const total = Number(metadata.total);
    if (Number.isFinite(total) && total >= 0 && values.length < total && batch.length === 0) return { ok: false, reason: "fub_invalid_response" };
    if (batch.length < FUB_PAGE_SIZE || (Number.isFinite(total) && values.length >= total)) return { ok: true, values };
    cursor = null;
    offset += batch.length;
  }
  return { ok: false, reason: "fub_invalid_response" };
}

/**
 * Numbers parked in a recruit's notes (agents who replied STOP had their number
 * moved out of the phone field). Notes this system wrote are skipped by their
 * recorded id and, as a second guard, by their system marker.
 */
async function fullNotePhones(person: FubRecord, systemNoteIds: Set<string>): Promise<{ phones: string[]; fetchFailed: boolean; systemNotesSkipped: number }> {
  const embedded = noteText(person).flatMap(extractNotePhones);
  const personId = fubId(person.id);
  if (!personId) return { phones: Array.from(new Set(embedded)), fetchFailed: false, systemNotesSkipped: 0 };
  const notes = await listAllFub("/notes", "notes", { personId });
  if (!notes.ok) return { phones: Array.from(new Set(embedded)), fetchFailed: true, systemNotesSkipped: 0 };
  let systemNotesSkipped = 0;
  const found = notes.values.flatMap((note) => {
    const noteId = fubId(note.id);
    if ((noteId && systemNoteIds.has(noteId)) || isBuilderDealsSystemNote(note)) { systemNotesSkipped += 1; return []; }
    return noteText(note).flatMap(extractNotePhones);
  });
  return { phones: Array.from(new Set([...embedded, ...found])), fetchFailed: false, systemNotesSkipped };
}

const INACTIVE_USER_STATUS = /^(inactive|deactivated|deleted|disabled|archived|suspended)$/i;
/** A FUB user is a team member unless FUB explicitly says otherwise (the same rule the team mirror uses). */
function fubUserIsActive(user: FubRecord) {
  if (user.active === false) return false;
  if (user.deleted === true || user.isDeleted === true) return false;
  const status = nonEmpty(user.status, 80);
  return !(status && INACTIVE_USER_STATUS.test(status));
}

/** Exact match on the admin-editable tags, any tag starting with "Recruit", or an admin-listed source. */
export function configuredRealtorMatch(person: FubRecord, configuredTags: Set<string>, configuredSources: Set<string>) {
  const tagMatch = fubTags(person).some((tag) => {
    const normalized = tag.trim().toLowerCase();
    return configuredTags.has(normalized) || normalized.startsWith(RECRUIT_TAG_PREFIX);
  });
  const source = nonEmpty(person.source, 320)?.toLowerCase() ?? null;
  return tagMatch || Boolean(source && configuredSources.has(source));
}

function fubRowsForPerson(person: FubRecord, phones: string[], email: string | null): KnownAgentRow[] {
  const id = fubId(person.id);
  if (!id || (!phones.length && !email)) return [];
  const name = fubName(person);
  // Persist a row for every normalized phone. FUB permits several phones per
  // person, and screening only sees identifiers which are stored locally.
  return (phones.length ? phones : [undefined]).map((candidatePhone) => ({
    name,
    phone: candidatePhone,
    email: email ?? undefined,
    fubPersonId: id,
  }));
}

/**
 * Deactivates FUB-sourced identity rows the latest scan did not produce, except
 * rows of a person whose notes could not be read this pass: those stay active so
 * a transient FUB error never un-blocks a known agent for a day.
 */
async function deactivateStaleFubRecruits(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  activeIdentityKeys: Set<string>,
  retainPersonIds: Set<string>,
) {
  const current = await db.select({ id: dealKnownAgents.id, fubPersonId: dealKnownAgents.fubPersonId, fubIdentityKey: dealKnownAgents.fubIdentityKey, active: dealKnownAgents.active })
    .from(dealKnownAgents)
    .where(eq(dealKnownAgents.source, "fub_recruit"));
  const stale = current.filter((row) => !(row.fubIdentityKey && activeIdentityKeys.has(row.fubIdentityKey)) && !(row.fubPersonId && retainPersonIds.has(row.fubPersonId)));
  for (const row of stale) {
    if (row.active) await db.update(dealKnownAgents).set({ active: false }).where(eq(dealKnownAgents.id, row.id));
  }
  return stale.filter((row) => row.active).length;
}

/**
 * Performs the sole FUB known-agent mirror. It reads every page of people and
 * users once, evaluates the saved tag/source settings (plus the Recruit prefix)
 * locally, and only then writes. Every skip list is applied per identifier: a
 * spouse's number swept from a note is skipped, the recruit's own number is not.
 */
export async function syncKnownAgentsFromFub(): Promise<KnownAgentsSyncResult> {
  const skippedBy = emptySkipLists();
  const db = await getDb();
  if (!db) {
    return { ok: false, peopleFetched: 0, recruitTagged: 0, upserted: 0, skipped: 0, noteFetchFailures: 0, linksKilled: 0, skippedBy, reason: "database_unavailable" };
  }

  const settings = await getDealSettings();
  const configuredTags = new Set(settings.fubRealtorTags.map((value) => value.trim().toLowerCase()).filter(Boolean));
  const configuredSources = new Set(settings.fubRealtorSources.map((value) => value.trim().toLowerCase()).filter(Boolean));
  if (!configuredTags.size && !configuredSources.size) {
    // A missing configuration must never turn a broad FUB scan into a broad
    // import, but a successful empty configuration can safely retire prior
    // automatic rows.
    try {
      const deactivated = await deactivateStaleFubRecruits(db, new Set(), new Set());
      return { ok: true, peopleFetched: 0, recruitTagged: 0, upserted: 0, skipped: deactivated, noteFetchFailures: 0, linksKilled: 0, skippedBy };
    } catch {
      return { ok: false, peopleFetched: 0, recruitTagged: 0, upserted: 0, skipped: 0, noteFetchFailures: 0, linksKilled: 0, skippedBy, reason: "database_unavailable" };
    }
  }

  // One full people scan: FUB's tags filter is exact, so "any tag starting with
  // Recruit" and the non-recruit ownership check both need every person locally.
  const [peopleResult, usersResult] = await Promise.all([
    listAllFub("/people", "people", { fields: PEOPLE_FIELDS }),
    listAllFub("/users", "users"),
  ]);
  if (!peopleResult.ok || !usersResult.ok) {
    const failure = !peopleResult.ok ? peopleResult : usersResult as Extract<FubListResult, { ok: false }>;
    return {
      ok: false,
      peopleFetched: peopleResult.ok ? peopleResult.values.length : 0,
      recruitTagged: 0,
      upserted: 0,
      skipped: 0,
      noteFetchFailures: 0,
      linksKilled: 0,
      skippedBy,
      reason: failure.reason,
    };
  }

  const isRecruit = (person: FubRecord) => configuredRealtorMatch(person, configuredTags, configuredSources);
  const selected = peopleResult.values.filter(isRecruit);
  // Any number on a FUB person WITHOUT recruiting tags or sources belongs to a
  // buyer or contact, so it is never imported from another person's notes.
  const nonRecruitPhones = new Set<string>();
  for (const person of peopleResult.values) {
    if (isRecruit(person)) continue;
    for (const value of fubPhones(person)) nonRecruitPhones.add(value);
  }
  try {
    const [suppressionRows, teamRows, teamLeads, curatedRows, systemNoteRows] = await Promise.all([
      db.select({ value: dealDoNotAutoImport.value, kind: dealDoNotAutoImport.kind }).from(dealDoNotAutoImport),
      db.select({ phoneE164: dealTeamAllowlist.phoneE164, email: dealTeamAllowlist.email }).from(dealTeamAllowlist).where(eq(dealTeamAllowlist.active, true)),
      db.select({ phoneE164: dealLeads.phoneE164, email: dealLeads.email }).from(dealLeads).where(eq(dealLeads.status, "team")),
      db.select({ phoneE164: dealKnownAgents.phoneE164, email: dealKnownAgents.email }).from(dealKnownAgents).where(and(eq(dealKnownAgents.active, true), or(eq(dealKnownAgents.source, "csv"), eq(dealKnownAgents.source, "manual")))),
      db.select({ fubId: dealFubRecords.fubId }).from(dealFubRecords).where(eq(dealFubRecords.kind, "note")),
    ]);
    const suppressed = {
      phones: new Set(suppressionRows.filter((row) => row.kind === "phone").map((row) => phone(row.value)).filter((value): value is string => Boolean(value))),
      emails: new Set(suppressionRows.filter((row) => row.kind === "email").map((row) => lower(row.value)).filter((value): value is string => Boolean(value))),
    };
    const settingsPhones = new Set([phone(settings.textLine), ...settings.testNumbers.map((value) => phone(value))].filter((value): value is string => Boolean(value)));
    const systemNoteIds = new Set(systemNoteRows.map((row) => row.fubId));
    const teamIdentities = identitiesFromRows(teamRows);
    const teamLeadIdentities = identitiesFromRows(teamLeads);
    const curatedIdentities = identitiesFromRows(curatedRows);
    const activeFubUserIdentities = identitiesFromRows(usersResult.values.filter(fubUserIsActive).flatMap<{ phoneE164: string | null; email: string | null }>((user) => {
      const phones = fubPhones(user);
      const email = firstFubEmail(user);
      return phones.length ? phones.map((phoneE164) => ({ phoneE164, email })) : [{ phoneE164: null, email }];
    }));
    const skipReason = (candidate: string, kind: "phone" | "email", fromNote: boolean): keyof KnownAgentSkipLists | null => {
      const has = (set: { phones: Set<string>; emails: Set<string> }) => (kind === "phone" ? set.phones : set.emails).has(candidate);
      if (has(suppressed)) return "doNotAutoImport";
      if (kind === "phone" && settingsPhones.has(candidate)) return "textLineAndTestNumbers";
      if (has(teamIdentities)) return "teamAllowlist";
      if (has(activeFubUserIdentities)) return "activeFubUsers";
      if (has(teamLeadIdentities)) return "teamPreviewLeads";
      if (has(curatedIdentities)) return "manuallyManagedKnownAgents";
      if (kind === "phone" && fromNote && nonRecruitPhones.has(candidate)) return "nonRecruitContacts";
      return null;
    };

    let upserted = 0;
    let skipped = 0;
    let linksKilled = 0;
    let noteFetchFailures = 0;
    const activeIdentityKeys = new Set<string>();
    const retainPersonIds = new Set<string>();
    for (const person of selected) {
      const id = fubId(person.id);
      if (!id) { skipped += 1; continue; }
      const noteResult = await fullNotePhones(person, systemNoteIds);
      skippedBy.systemNotes += noteResult.systemNotesSkipped;
      if (noteResult.fetchFailed) {
        // Notes are part of the privacy exclusion check. If they cannot be
        // read, importing would be less safe than waiting for the next pass,
        // and the person's existing rows stay active meanwhile.
        noteFetchFailures += 1;
        skipped += 1;
        retainPersonIds.add(id);
        continue;
      }
      const ownPhones = fubPhones(person);
      const keptPhones: string[] = [];
      for (const candidate of Array.from(new Set([...ownPhones, ...noteResult.phones]))) {
        const reason = skipReason(candidate, "phone", !ownPhones.includes(candidate));
        if (reason) { skippedBy[reason] += 1; skipped += 1; continue; }
        keptPhones.push(candidate);
      }
      const email = firstFubEmail(person);
      let keptEmail = email;
      if (email) {
        const reason = skipReason(email, "email", false);
        if (reason) { skippedBy[reason] += 1; skipped += 1; keptEmail = null; }
      }
      const rows = fubRowsForPerson(person, keptPhones, keptEmail);
      if (!rows.length) continue;
      for (const row of rows) {
        const result = await importKnownAgents([row], "fub_recruit");
        if (result.imported) activeIdentityKeys.add(fubIdentityKey(id, phone(row.phone), validEmail(row.email)));
        upserted += result.imported;
        skipped += result.skipped;
        linksKilled += result.linksKilled;
      }
    }
    const deactivated = await deactivateStaleFubRecruits(db, activeIdentityKeys, retainPersonIds);
    return {
      ok: true,
      peopleFetched: peopleResult.values.length,
      recruitTagged: selected.length,
      upserted,
      skipped: skipped + deactivated,
      noteFetchFailures,
      linksKilled,
      skippedBy,
    };
  } catch {
    return {
      ok: false,
      peopleFetched: peopleResult.values.length,
      recruitTagged: selected.length,
      upserted: 0,
      skipped: 0,
      noteFetchFailures: 0,
      linksKilled: 0,
      skippedBy,
      reason: "database_unavailable",
    };
  }
}
