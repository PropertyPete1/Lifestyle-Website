import { and, eq, or } from "drizzle-orm";
import { dealDoNotAutoImport, dealFubRecords, dealJobRuns, dealKnownAgents, dealLeads, dealTeamAllowlist } from "../drizzle/schema";
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

/**
 * The nightly mirror runs inside one cron request: it stops starting FUB reads after this long, so the request always
 * answers and records a result (a request the host cuts off leaves its run "running" with no reason at all).
 */
export const KNOWN_AGENT_SYNC_BUDGET_MS = 4 * 60_000;
/**
 * The people and users scan has its own share of that budget: a large account (tens of thousands of people at 100 a
 * page) must not leave the notes pass nothing, nor run the whole budget and end every night "time_budget_exceeded".
 * The notes pass gets whatever the scan left, up to the overall cap.
 */
export const KNOWN_AGENT_SCAN_BUDGET_MS = 3 * 60_000;
/** FUB answers about one notes request a second ("notes": 10 per 10 seconds). */
const NOTES_PER_SECOND = 1;
/** Time kept for the database writes after the last notes read. */
const WRITE_RESERVE_MS = 20_000;
/** A 429 is retried this many times, waiting what FUB's Retry-After says (capped), while the budget allows. */
const MAX_RATE_LIMIT_RETRIES = 4;
const MAX_RETRY_WAIT_MS = 30_000;
const DEFAULT_RETRY_WAIT_MS = 10_000;
/** A gateway error, timeout or dropped connection is retried twice, with a short pause. */
const MAX_TRANSIENT_RETRIES = 2;
const TRANSIENT_WAIT_MS = 2_000;
/** Where the notes pass resumes when one night's budget did not reach every recruit. */
const NOTES_CURSOR_JOB = "builder-deals-known-agent-cursor";
const NOTES_CURSOR_DAY = "cursor";

type FubRecord = Record<string, unknown>;
type FubFailureReason = "fub_not_configured" | "fub_unavailable" | "fub_invalid_response" | "fub_rate_limited" | "fub_timeout" | "fub_auth_failed" | "time_budget_exceeded";
type FubFetchResult = { ok: true; body: FubRecord } | { ok: false; reason: FubFailureReason; detail: string };

/** Timing for the FUB reads of one sync; tests pass a fake clock and sleep. */
export type KnownAgentSyncOptions = { clock?: () => number; sleep?: (ms: number) => Promise<void>; budgetMs?: number; scanBudgetMs?: number };
/** `deadline` is the current phase's (the scan's, then the overall cap); `end` is the overall cap. */
type FubClient = { start: number; deadline: number; end: number; clock: () => number; sleep: (ms: number) => Promise<void>; requests: number; rateLimited: number; pausedUntil: Map<string, number> };

function fubClient(options: KnownAgentSyncOptions = {}): FubClient {
  const clock = options.clock ?? Date.now;
  const start = clock();
  const end = start + (options.budgetMs ?? KNOWN_AGENT_SYNC_BUDGET_MS);
  return {
    start,
    end,
    deadline: Math.min(end, start + (options.scanBudgetMs ?? KNOWN_AGENT_SCAN_BUDGET_MS)),
    clock,
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    requests: 0,
    rateLimited: 0,
    pausedUntil: new Map(),
  };
}

/** Retry-After in seconds or as an HTTP date; null when absent or unreadable. */
export function retryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

/** FUB counts requests per context ("notes" has its own small limit); this run paces itself by the same split. */
const rateContext = (path: string) => (path.startsWith("/notes") ? "notes" : "global");

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

/** How the FUB reads went: requests made, 429s met, and recruits whose notes this run's time budget did not reach (their rows stay as they were). */
export type KnownAgentsSyncRun = {
  fubRequests?: number;
  rateLimited?: number;
  notesDeferred?: number;
  /** The people and users scan, to size the budget from deals.admin.jobRuns: people read, pages, and how long it took. */
  scan?: { peopleFetched: number; peoplePages: number; usersPages: number; ms: number };
  /** Recruits with no rows yet, whose notes are read before the rotating pass. */
  newRecruits?: number;
};

export type KnownAgentsSyncResult =
  | ({
    ok: true;
    peopleFetched: number;
    recruitTagged: number;
    upserted: number;
    skipped: number;
    noteFetchFailures: number;
    linksKilled: number;
    skippedBy: KnownAgentSkipLists;
  } & KnownAgentsSyncRun)
  | ({
    ok: false;
    peopleFetched: number;
    recruitTagged: number;
    upserted: number;
    skipped: number;
    noteFetchFailures: number;
    linksKilled: number;
    skippedBy: KnownAgentSkipLists;
    reason: "database_unavailable" | FubFailureReason;
    /** Where and why it stopped (the page, the HTTP status, how far the scan got); never a credential. */
    detail?: string;
  } & KnownAgentsSyncRun);

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

/**
 * One FUB GET. A 429 waits what Retry-After says (FUB: the request was not processed and must be resent) and is
 * retried a few times; a gateway error, timeout or dropped connection is retried twice; nothing waits past the run's
 * budget. When FUB's X-RateLimit-Remaining runs out, the next request of that context waits for its window first,
 * so the notes pass (10 requests per 10 seconds) is paced instead of answered with 429s.
 */
async function getFubJson(path: string, client: FubClient): Promise<FubFetchResult> {
  const apiKey = process.env.FUB_API_KEY?.trim();
  if (!apiKey) return { ok: false, reason: "fub_not_configured", detail: "FUB_API_KEY is not set" };
  const context = rateContext(path);
  const label = path.split("?")[0];
  let rateRetries = 0;
  let transientRetries = 0;
  const wait = async (ms: number) => {
    if (client.clock() + ms >= client.deadline) return false;
    await client.sleep(ms);
    return true;
  };
  for (;;) {
    const pause = (client.pausedUntil.get(context) ?? 0) - client.clock();
    if (pause > 0 && !(await wait(pause))) return { ok: false, reason: "time_budget_exceeded", detail: `${label}: the run's ${Math.round((client.deadline - client.clock()) / 1000)}s left did not cover FUB's rate-limit window` };
    const remaining = client.deadline - client.clock();
    if (remaining <= 0) return { ok: false, reason: "time_budget_exceeded", detail: `${label}: the run's time budget was spent` };
    client.requests += 1;
    let response: Response;
    try {
      response = await fetch(`${FUB_API_URL}${path}`, { headers: fubHeaders(apiKey), signal: AbortSignal.timeout(Math.min(FUB_TIMEOUT_MS, remaining)) });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      if (transientRetries < MAX_TRANSIENT_RETRIES && (await wait(TRANSIENT_WAIT_MS * (transientRetries + 1)))) { transientRetries += 1; continue; }
      return timedOut
        ? { ok: false, reason: "fub_timeout", detail: `${label}: no answer within ${Math.round(Math.min(FUB_TIMEOUT_MS, remaining) / 1000)}s (${transientRetries + 1} tries)` }
        : { ok: false, reason: "fub_unavailable", detail: `${label}: connection failed (${transientRetries + 1} tries)` };
    }
    const left = Number(response.headers.get("x-ratelimit-remaining"));
    const windowSeconds = Number(response.headers.get("x-ratelimit-window"));
    if (response.headers.has("x-ratelimit-remaining") && Number.isFinite(left) && left <= 1) {
      client.pausedUntil.set(context, client.clock() + Math.min(MAX_RETRY_WAIT_MS, Number.isFinite(windowSeconds) && windowSeconds > 0 ? windowSeconds * 1_000 : DEFAULT_RETRY_WAIT_MS));
    }
    if (response.status === 429) {
      client.rateLimited += 1;
      const after = Math.min(MAX_RETRY_WAIT_MS, retryAfterMs(response.headers.get("retry-after"), client.clock()) ?? DEFAULT_RETRY_WAIT_MS);
      client.pausedUntil.set(context, client.clock() + after);
      if (rateRetries < MAX_RATE_LIMIT_RETRIES && client.clock() + after < client.deadline) { rateRetries += 1; continue; }
      return { ok: false, reason: "fub_rate_limited", detail: `${label}: HTTP 429 after ${rateRetries + 1} tries (Retry-After ${response.headers.get("retry-after") ?? "not given"}, context ${response.headers.get("x-ratelimit-context") ?? context})` };
    }
    if ([502, 503, 504].includes(response.status) && transientRetries < MAX_TRANSIENT_RETRIES && (await wait(TRANSIENT_WAIT_MS * (transientRetries + 1)))) { transientRetries += 1; continue; }
    if (response.status === 401 || response.status === 403) return { ok: false, reason: "fub_auth_failed", detail: `${label}: HTTP ${response.status} (check FUB_API_KEY and the X-System registration)` };
    if (!response.ok) return { ok: false, reason: "fub_unavailable", detail: `${label}: HTTP ${response.status}` };
    const body: unknown = await response.json().catch(() => null);
    return body && typeof body === "object" && !Array.isArray(body) ? { ok: true, body: body as FubRecord } : { ok: false, reason: "fub_invalid_response", detail: `${label}: the body was not a JSON object` };
  }
}

type FubListResult = ({ ok: true; values: FubRecord[] } | { ok: false; reason: FubFailureReason; detail: string }) & { pages: number; read: number };

/** Uses FUB's keyset cursor when present, with offset fallback for older responses. A failure names the page and how far the scan got. */
async function listAllFub(path: string, collection: string, params: Record<string, string>, client: FubClient): Promise<FubListResult> {
  const values: FubRecord[] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null;
  let offset = 0;
  for (let page = 0; page < MAX_FUB_PAGES; page += 1) {
    const query = new URLSearchParams({ ...params, limit: String(FUB_PAGE_SIZE) });
    if (cursor) query.set("next", cursor); else query.set("offset", String(offset));
    const response = await getFubJson(`${path}?${query.toString()}`, client);
    const at = `${path} page ${page + 1} (${values.length.toLocaleString("en-US")} read so far)`;
    const progress = { pages: page, read: values.length };
    if (!response.ok) return { ...response, detail: `${at}: ${response.detail}`, ...progress };
    const raw = response.body[collection];
    if (!Array.isArray(raw)) return { ok: false, reason: "fub_invalid_response", detail: `${at}: no "${collection}" list`, ...progress };
    const batch = raw.filter((value): value is FubRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value));
    if (batch.length !== raw.length) return { ok: false, reason: "fub_invalid_response", detail: `${at}: a non-object entry`, ...progress };
    values.push(...batch);
    const metadata = response.body._metadata && typeof response.body._metadata === "object" ? response.body._metadata as FubRecord : {};
    const next = nonEmpty(metadata.next, 2_000);
    if (next) {
      if (cursors.has(next)) return { ok: false, reason: "fub_invalid_response", detail: `${at}: the next cursor repeated`, pages: page + 1, read: values.length };
      cursors.add(next);
      cursor = next;
      continue;
    }
    const total = Number(metadata.total);
    if (Number.isFinite(total) && total >= 0 && values.length < total && batch.length === 0) return { ok: false, reason: "fub_invalid_response", detail: `${at}: an empty page before the reported total ${total}`, pages: page + 1, read: values.length };
    if (batch.length < FUB_PAGE_SIZE || (Number.isFinite(total) && values.length >= total)) return { ok: true, values, pages: page + 1, read: values.length };
    cursor = null;
    offset += batch.length;
  }
  return { ok: false, reason: "fub_invalid_response", detail: `${path}: more than ${MAX_FUB_PAGES} pages`, pages: MAX_FUB_PAGES, read: values.length };
}

/**
 * Numbers parked in a recruit's notes (agents who replied STOP had their number
 * moved out of the phone field). Notes this system wrote are skipped by their
 * recorded id and, as a second guard, by their system marker.
 */
async function fullNotePhones(person: FubRecord, systemNoteIds: Set<string>, client: FubClient): Promise<{ phones: string[]; fetchFailed: boolean; failure?: FubFailureReason; systemNotesSkipped: number }> {
  const embedded = noteText(person).flatMap(extractNotePhones);
  const personId = fubId(person.id);
  if (!personId) return { phones: Array.from(new Set(embedded)), fetchFailed: false, systemNotesSkipped: 0 };
  const notes = await listAllFub("/notes", "notes", { personId }, client);
  if (!notes.ok) return { phones: Array.from(new Set(embedded)), fetchFailed: true, failure: notes.reason, systemNotesSkipped: 0 };
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

/** Recruits in FUB id order, starting after the id where the last pass stopped (then wrapping around). */
function notesOrder(people: readonly FubRecord[], cursor: string | null): FubRecord[] {
  const key = (person: FubRecord) => fubId(person.id) ?? "";
  const byId = (a: string, b: string) => (/^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) - Number(b) : a.localeCompare(b));
  const sorted = [...people].sort((a, b) => byId(key(a), key(b)));
  if (!cursor) return sorted;
  const start = sorted.findIndex((person) => byId(key(person), cursor) > 0);
  return start <= 0 ? sorted : [...sorted.slice(start), ...sorted.slice(0, start)];
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** FUB person ids that already have mirror rows (active or not). */
async function mirroredPersonIds(db: Db): Promise<Set<string>> {
  const rows = await db.select({ fubPersonId: dealKnownAgents.fubPersonId }).from(dealKnownAgents).where(eq(dealKnownAgents.source, "fub_recruit"));
  return new Set(rows.map((row) => row.fubPersonId).filter((value): value is string => Boolean(value)));
}

async function readNotesCursor(db: Db): Promise<{ value: string | null; exists: boolean }> {
  try {
    const row = (await db.select({ detail: dealJobRuns.detail }).from(dealJobRuns).where(and(eq(dealJobRuns.jobName, NOTES_CURSOR_JOB), eq(dealJobRuns.chicagoDay, NOTES_CURSOR_DAY))).limit(1))[0];
    return { value: row?.detail?.trim() || null, exists: Boolean(row) };
  } catch {
    return { value: null, exists: false };
  }
}

/** Saves (or clears) the resume point; a failed write only means the next pass starts from the beginning. */
async function writeNotesCursor(db: Db, value: string | null, exists: boolean) {
  try {
    const values = { status: "ok" as const, detail: value, startedAt: new Date(), completedAt: new Date() };
    if (exists) await db.update(dealJobRuns).set(values).where(and(eq(dealJobRuns.jobName, NOTES_CURSOR_JOB), eq(dealJobRuns.chicagoDay, NOTES_CURSOR_DAY)));
    else await db.insert(dealJobRuns).values({ jobName: NOTES_CURSOR_JOB, chicagoDay: NOTES_CURSOR_DAY, ...values });
  } catch (error) {
    console.warn("[deals known agents] could not save the notes cursor", error instanceof Error ? error.message : error);
  }
}

/**
 * Performs the sole FUB known-agent mirror. It reads every page of people and
 * users once, evaluates the saved tag/source settings (plus the Recruit prefix)
 * locally, and only then writes. Every skip list is applied per identifier: a
 * spouse's number swept from a note is skipped, the recruit's own number is not.
 */
export async function syncKnownAgentsFromFub(options: KnownAgentSyncOptions = {}): Promise<KnownAgentsSyncResult> {
  const skippedBy = emptySkipLists();
  const client = fubClient(options);
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
    listAllFub("/people", "people", { fields: PEOPLE_FIELDS }, client),
    listAllFub("/users", "users", {}, client),
  ]);
  const scan = { peopleFetched: peopleResult.read, peoplePages: peopleResult.pages, usersPages: usersResult.pages, ms: client.clock() - client.start };
  const scanLine = `scan: ${scan.peopleFetched.toLocaleString("en-US")} people in ${scan.peoplePages} page${scan.peoplePages === 1 ? "" : "s"} and ${scan.usersPages} users page${scan.usersPages === 1 ? "" : "s"}, ${Math.round(scan.ms / 1000)}s of a ${Math.round((client.deadline - client.start) / 1000)}s scan budget`;
  // The notes pass may use what the scan left, up to the overall cap.
  client.deadline = client.end;
  if (!peopleResult.ok || !usersResult.ok) {
    // A partial scan writes nothing: the ownership checks need every person.
    const failure = !peopleResult.ok ? peopleResult : usersResult as Extract<FubListResult, { ok: false }>;
    return {
      ok: false,
      peopleFetched: peopleResult.read,
      recruitTagged: 0,
      upserted: 0,
      skipped: 0,
      noteFetchFailures: 0,
      linksKilled: 0,
      skippedBy,
      reason: failure.reason,
      detail: `${failure.detail}; ${scanLine}`,
      fubRequests: client.requests,
      rateLimited: client.rateLimited,
      scan,
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
    let notesDeferred = 0;
    let lastRead: string | null = null;
    const activeIdentityKeys = new Set<string>();
    const retainPersonIds = new Set<string>();
    // FUB allows about one notes request a second, so a large recruit list may not fit one night's budget. The pass
    // resumes where the last one stopped; a recruit it does not reach keeps its rows exactly as a notes failure does.
    const cursor = await readNotesCursor(db);
    // When the pass may not reach everyone tonight (more recruits than about one notes read a second fits, or a pass
    // already rotating), recruits with no rows yet go first: they are not screened at all until they are read.
    const capacity = Math.floor(((client.end - client.clock() - WRITE_RESERVE_MS) / 1_000) * NOTES_PER_SECOND);
    const known = cursor.value || selected.length > capacity ? await mirroredPersonIds(db) : null;
    const fresh = known ? notesOrder(selected.filter((person) => !known.has(fubId(person.id) ?? "")), null) : [];
    const freshIds = new Set(fresh.map((person) => fubId(person.id)));
    const rotating = notesOrder(known ? selected.filter((person) => !freshIds.has(fubId(person.id))) : selected, cursor.value);
    for (const person of [...fresh, ...rotating]) {
      const id = fubId(person.id);
      if (!id) { skipped += 1; continue; }
      if (client.clock() >= client.deadline - WRITE_RESERVE_MS) { notesDeferred += 1; retainPersonIds.add(id); continue; }
      const noteResult = await fullNotePhones(person, systemNoteIds, client);
      skippedBy.systemNotes += noteResult.systemNotesSkipped;
      if (noteResult.fetchFailed && noteResult.failure === "time_budget_exceeded") { notesDeferred += 1; retainPersonIds.add(id); continue; }
      // The cursor marks the rotating pass only; new recruits are read ahead of it.
      if (!freshIds.has(id)) lastRead = id;
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
    if (notesDeferred || cursor.value) await writeNotesCursor(db, notesDeferred ? lastRead ?? cursor.value : null, cursor.exists);
    return {
      ok: true,
      peopleFetched: peopleResult.values.length,
      recruitTagged: selected.length,
      upserted,
      skipped: skipped + deactivated,
      noteFetchFailures,
      linksKilled,
      skippedBy,
      fubRequests: client.requests,
      rateLimited: client.rateLimited,
      notesDeferred,
      newRecruits: fresh.length,
      scan,
    };
  } catch (error) {
    // The error text can carry SQL values (phone numbers), so it goes to the server log only.
    console.error("[deals known agents] database step failed", error instanceof Error ? error.message.slice(0, 300) : error);
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
      detail: `a database read or write failed after the FUB scan; nothing past that point was changed; ${scanLine}`,
      fubRequests: client.requests,
      rateLimited: client.rateLimited,
      scan,
    };
  }
}
