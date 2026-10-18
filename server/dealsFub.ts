import { fubHeaders } from "./fub";
import { hashSecret } from "./dealsService";

const FUB_API_URL = "https://api.followupboss.com/v1";
const BASE_TAG = "IG Builder Deals";
const PETER_EMAIL = "peter@lifestyledesignrealty.com";
const FUB_PAGE_SIZE = 100;
const MAX_FUB_PAGES = 100;

type FubValue = { value?: string; email?: string; phone?: string; number?: string; [key: string]: unknown };
type FubPerson = {
  id?: string | number;
  tags?: Array<string | { name?: string; value?: string }> | string;
  assignedUserId?: string | number;
  emails?: FubValue[];
  phones?: FubValue[];
  [key: string]: unknown;
};
type BuilderLead = { id: number; phone: string; email?: string | null; name?: string | null; instagramHandle?: string | null; sourceCode: string; consentText: string; consentAt: Date; consentIp: string | null; flags?: string[]; timeline?: string | null; isTest?: boolean };

export type FubRecordWrite = { kind: "person" | "event" | "note" | "task"; fubId: string; createdByUs: boolean };
export type FubDeliveryResult =
  | { ok: true; personId?: string; taskId?: string; records: FubRecordWrite[]; warning?: string }
  | { ok: false; error: string };

function timeout(ms = 30_000) { return AbortSignal.timeout(ms); }
function intentTag(timeline?: string | null) {
  if (!timeline) return null;
  if (timeline.startsWith("0-3")) return "Intent - Hot";
  if (timeline.startsWith("3-6")) return "Intent - Warm";
  return "Intent - Cold";
}
function tagsFor(lead: BuilderLead) {
  return Array.from(new Set([BASE_TAG, ...(lead.flags ?? []).filter((flag) => flag === "Possible Agent - TREC Name Match" || flag === "Possible Agent - Handle"), intentTag(lead.timeline), lead.isTest ? "TEST" : null].filter(Boolean) as string[]));
}
function stringValue(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() || null : null;
}
function fubValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(fubValues);
  if (value && typeof value === "object") {
    const record = value as FubValue;
    return [record.value, record.email, record.phone, record.number].flatMap(fubValues);
  }
  const result = stringValue(value);
  return result ? [result] : [];
}
function fubTags(person?: FubPerson | null): string[] {
  const tags = person?.tags;
  if (typeof tags === "string") return [tags];
  if (!Array.isArray(tags)) return [];
  return tags.flatMap((tag) => typeof tag === "string" ? [tag] : fubValues(tag.name ?? tag.value));
}
function contactValueKey(value: string, kind: "email" | "phone") {
  if (kind === "email") return value.trim().toLowerCase();
  const digits = value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return digits.length === 10 ? digits : value.replace(/\D/g, "");
}
function unionValues(existing: unknown, additions: Array<string | null | undefined>, kind: "email" | "phone") {
  const seen = new Set<string>();
  const kept: FubValue[] = [];
  const original = Array.isArray(existing) ? existing : [];
  for (const entry of original) {
    const value = fubValues(entry)[0]?.trim();
    if (!value) continue;
    const key = contactValueKey(value, kind);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    // Never reduce FUB's typed/primary/status objects to a bare `{value}`.
    kept.push(typeof entry === "object" && entry !== null ? { ...(entry as FubValue) } : { value });
  }
  for (const value of additions) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = contactValueKey(trimmed, kind);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept.push({ value: trimmed });
  }
  return kept;
}
/** Exported for regression tests: no FUB update is allowed to discard a known contact value. */
export function unionFubContactValues(person: FubPerson | null | undefined, lead: Pick<BuilderLead, "phone" | "email">) {
  return {
    phones: unionValues(person?.phones, [lead.phone], "phone"),
    emails: unionValues(person?.emails, [lead.email ?? undefined], "email"),
  };
}
export function unionFubTags(person: FubPerson | null | undefined, lead: BuilderLead) {
  return Array.from(new Set([...fubTags(person), ...tagsFor(lead)]));
}

/** A stable opaque marker for all FUB objects written for one Builder Deals lead. */
export function builderDealsLeadMarker(leadId: number) {
  return `BDL-${hashSecret(`builder-deals-lead:${leadId}`).slice(0, 20)}`;
}
function builderDealsOperationMarker(leadId: number, operation: "first_unlock" | "reverify", occurrenceId?: string) {
  return `${builderDealsLeadMarker(leadId)}:${operation}${occurrenceId ? `:${occurrenceId}` : ""}`;
}
function nationalPhone(phone: string) {
  const digits = phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return digits.length === 10 ? digits : null;
}

async function fub(path: string, init: RequestInit = {}) {
  const apiKey = process.env.FUB_API_KEY;
  if (!apiKey) throw new Error("FUB_API_KEY not configured");
  const res = await fetch(`${FUB_API_URL}${path}`, { ...init, headers: { ...fubHeaders(apiKey), ...(init.headers ?? {}) }, signal: timeout() });
  if (!res.ok) throw new Error(`FUB ${res.status}`);
  return res;
}

/** Search both formats because FUB can index a saved number in national form. */
async function findPerson(lead: Pick<BuilderLead, "phone" | "email">): Promise<FubPerson | null> {
  const candidates = [lead.phone, nationalPhone(lead.phone), lead.email?.trim().toLowerCase()].filter(Boolean) as string[];
  const checked = new Set<string>();
  for (const value of candidates) {
    if (checked.has(value)) continue;
    checked.add(value);
    const url = new URL(`${FUB_API_URL}/people`);
    if (value.includes("@")) url.searchParams.set("email", value); else url.searchParams.set("phone", value);
    const res = await fub(`${url.pathname}${url.search}`);
    const body = await res.json().catch(() => ({})) as { people?: FubPerson[] };
    if (body.people?.[0]) return body.people[0];
  }
  return null;
}

function textInFubObject(value: unknown): string[] {
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(textInFubObject);
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(textInFubObject);
  return [];
}
/**
 * A timed-out create may still land remotely. Before any resend, scan the
 * person's system-visible notes/events for our opaque marker and treat it as
 * complete. An unavailable history endpoint deliberately does not claim a
 * match; the durable runner will retry with a lease and backoff.
 */
async function personHasLeadMarker(personId: string | number, marker: string): Promise<boolean> {
  const queries = [
    `/notes?${new URLSearchParams({ personId: String(personId), limit: String(FUB_PAGE_SIZE) })}`,
    `/events?${new URLSearchParams({ personId: String(personId), limit: String(FUB_PAGE_SIZE) })}`,
  ];
  for (const path of queries) {
    try {
      const res = await fub(path);
      const body = await res.json().catch(() => ({}));
      if (textInFubObject(body).some((text) => text.includes(marker))) return true;
    } catch {
      // Do not turn a history endpoint variation into a false-positive skip.
    }
  }
  return false;
}

type CachedPeter = { id: string | null; expiresAt: number };
let cachedPeter: CachedPeter | null = null;
/** FUB's users endpoint is paged and does not rely on an undocumented email filter. */
export async function peterUserId() {
  if (cachedPeter && cachedPeter.expiresAt > Date.now()) return cachedPeter.id;
  for (let page = 0; page < MAX_FUB_PAGES; page += 1) {
    const params = new URLSearchParams({ limit: String(FUB_PAGE_SIZE), offset: String(page * FUB_PAGE_SIZE) });
    const res = await fub(`/users?${params.toString()}`);
    const body = await res.json().catch(() => ({})) as { users?: Array<Record<string, unknown>> };
    const users = Array.isArray(body.users) ? body.users : [];
    const found = users.find((user) => fubValues(user.email ?? user.emails).some((email) => email.toLowerCase() === PETER_EMAIL));
    const id = found ? stringValue(found.id) : null;
    if (id) {
      cachedPeter = { id, expiresAt: Date.now() + 5 * 60_000 };
      return id;
    }
    // Some FUB accounts return pages smaller than the requested limit while
    // still exposing a following offset page; only an empty page is terminal.
    if (users.length === 0) break;
  }
  // Short negative cache avoids a thundering herd, while allowing a newly added
  // user to become visible shortly afterwards.
  cachedPeter = { id: null, expiresAt: Date.now() + 60_000 };
  return null;
}

function leadNote(lead: BuilderLead, action: string, operation: "first_unlock" | "reverify", occurrenceId?: string) {
  return [
    `Builder Deals ${builderDealsOperationMarker(lead.id, operation, occurrenceId)}`, action, `Source: ${lead.sourceCode}`,
    lead.instagramHandle ? `Instagram: @${lead.instagramHandle}` : undefined,
    lead.isTest ? "TEST RECORD - eligible for Builder Deals cleanup" : undefined,
    `TCPA consent captured: ${lead.consentAt.toISOString()}`,
    lead.consentIp ? `Consent IP: ${lead.consentIp}` : undefined,
    `Consent text: ${lead.consentText}`,
  ].filter(Boolean).join("\n");
}
function nameForNewPerson(lead: BuilderLead) {
  const supplied = (lead.name || (lead.instagramHandle ? `@${lead.instagramHandle}` : "")).trim();
  if (supplied) {
    const [firstName, ...last] = supplied.split(/\s+/);
    return { firstName, lastName: last.join(" ") || undefined };
  }
  return { firstName: "IG Lead", lastName: lead.phone.replace(/\D/g, "").slice(-4) };
}
function personBody(lead: BuilderLead, existing: FubPerson | null, assignedUserId?: string | null) {
  const contact = unionFubContactValues(existing, lead);
  return {
    ...(existing?.id ? {} : nameForNewPerson(lead)),
    phones: contact.phones,
    emails: contact.emails.length ? contact.emails : undefined,
    tags: unionFubTags(existing, lead),
    assignedUserId: existing?.assignedUserId ?? assignedUserId ?? undefined,
  };
}
async function putPersonUnion(personId: string, existing: FubPerson | null, lead: BuilderLead, assignedUserId?: string | null) {
  const person = personBody(lead, existing, assignedUserId);
  await fub(`/people/${encodeURIComponent(personId)}`, { method: "PUT", body: JSON.stringify({ ...person, mergeTags: true }) });
}
async function postFubNote(personId: string, subject: string, body: string): Promise<{ ok: true; id?: string } | { ok: false; error: string }> {
  try {
    const response = await fub("/notes", { method: "POST", body: JSON.stringify({ personId: Number(personId), subject, body }) });
    const note = await response.json().catch(() => ({})) as { id?: string | number; note?: { id?: string | number } };
    const id = note.note?.id ?? note.id;
    return { ok: true, id: id === undefined ? undefined : String(id) };
  } catch {
    return { ok: false, error: "FUB note delivery failed" };
  }
}

/** A first verified unlock gets one marker-protected FUB event/action-plan trigger. */
export async function sendBuilderDealsLeadToFub(lead: BuilderLead): Promise<FubDeliveryResult> {
  try {
    const existing = await findPerson(lead);
    if (existing?.id && await personHasLeadMarker(existing.id, builderDealsOperationMarker(lead.id, "first_unlock"))) {
      return { ok: true, personId: String(existing.id), records: [{ kind: "person", fubId: String(existing.id), createdByUs: false }] };
    }
    const peterId = await peterUserId();
    if (!existing?.assignedUserId && !peterId) return { ok: false, error: "Peter FUB user not found" };
    const body = {
      source: "IG Builder Deals", system: "Lifestyle Design Realty Website", type: "General Inquiry",
      message: leadNote(lead, "First Builder Deals unlock.", "first_unlock"),
      person: personBody(lead, existing, peterId),
    };
    const res = await fub("/events", { method: "POST", body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({})) as { id?: string | number; personId?: string | number; person?: FubPerson; event?: { id?: string | number } };
    const personId = data.person?.id ?? data.personId ?? existing?.id;
    if (!personId) return { ok: false, error: "FUB event did not return a contact" };
    const eventId = data.event?.id ?? data.id;
    const records: FubRecordWrite[] = [
      { kind: "person", fubId: String(personId), createdByUs: !existing?.id },
      ...(eventId === undefined ? [] : [{ kind: "event" as const, fubId: String(eventId), createdByUs: true }]),
    ];
    // Assignment repair is best-effort after the irreversible event. A repair
    // failure must never retry the event or trigger a second action plan.
    if (peterId && !existing?.assignedUserId) {
      try { await putPersonUnion(String(personId), data.person ?? existing, lead, peterId); }
      catch { return { ok: true, personId: String(personId), records, warning: "FUB assignment repair failed" }; }
    }
    return { ok: true, personId: String(personId), records };
  } catch { return { ok: false, error: "FUB delivery failed" }; }
}

/** Later device/expiry rechecks update and note an existing person, never re-fire events. */
export async function updateBuilderDealsLeadInFub(lead: BuilderLead, reason: "re-verified on a second device" | "returned for a new link", occurrenceId?: string): Promise<FubDeliveryResult> {
  try {
    const person = await findPerson(lead);
    // Search both phone forms before this fallback. It remains necessary when a
    // former contact has been deleted, and the first-unlock path is marker-safe.
    if (!person?.id) return sendBuilderDealsLeadToFub(lead);
    const personId = String(person.id);
    if (occurrenceId && await personHasLeadMarker(personId, builderDealsOperationMarker(lead.id, "reverify", occurrenceId))) {
      return { ok: true, personId, records: [{ kind: "person", fubId: personId, createdByUs: false }] };
    }
    await putPersonUnion(personId, person, lead);
    const note = await postFubNote(personId, "Builder Deals access", leadNote(lead, reason, "reverify", occurrenceId));
    return note.ok
      ? { ok: true, personId, records: [{ kind: "person", fubId: personId, createdByUs: false }, ...(note.id ? [{ kind: "note" as const, fubId: note.id, createdByUs: true }] : [])] }
      : { ok: false, error: note.error };
  } catch { return { ok: false, error: "FUB update failed" }; }
}

export function formatChicagoDateTime(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(value);
}

type RequestLead = { id: number; fubPersonId: string | null; phoneE164: string; email: string | null; name?: string | null; instagramHandle?: string | null; sourceCode?: string; consentText?: string; consentAt?: Date; consentIp?: string | null };
type TourRequest = { id: number; requestType: "tour" | "ask"; preferredAt: Date; fubTaskId: string | null; fubNoteSentAt: Date | null };

async function taskPersonId(lead: RequestLead) {
  if (lead.fubPersonId) return lead.fubPersonId;
  const person = await findPerson({ phone: lead.phoneE164, email: lead.email });
  return person?.id ? String(person.id) : null;
}
function requestMarker(leadId: number, requestId: number) { return `${builderDealsLeadMarker(leadId)}-R${requestId}`; }
function requestLine(request: TourRequest, privateDescription: string) {
  return `${request.requestType === "tour" ? "Tour" : "Question"}: ${privateDescription}\nPreferred: ${formatChicagoDateTime(request.preferredAt)}`;
}

/** Create one FUB task for a Chicago-day request group. */
export async function createBuilderDealsTourTask(input: { lead: RequestLead; request: TourRequest; privateDescription: string }): Promise<FubDeliveryResult> {
  try {
    const personId = await taskPersonId(input.lead);
    const assignedUserId = await peterUserId();
    if (!personId || !assignedUserId) return { ok: false, error: "FUB contact or Peter assignment unavailable" };
    const description = `${requestMarker(input.lead.id, input.request.id)}\n${requestLine(input.request, input.privateDescription)}`;
    const response = await fub("/tasks", { method: "POST", body: JSON.stringify({ personId: Number(personId), assignedUserId: Number(assignedUserId), name: `Builder Deals ${input.request.requestType}: ${input.privateDescription}`, description, type: "Appointment", dueDateTime: input.request.preferredAt.toISOString() }) });
    const task = await response.json().catch(() => ({})) as { id?: string | number; task?: { id?: string | number } };
    const taskId = task.task?.id ?? task.id;
    if (!taskId) return { ok: false, error: "FUB task did not return an id" };
    return { ok: true, personId, taskId: String(taskId), records: [{ kind: "person", fubId: personId, createdByUs: false }, { kind: "task", fubId: String(taskId), createdByUs: true }] };
  } catch { return { ok: false, error: "FUB task delivery failed" }; }
}

/** Append a same-day request to the already-created task instead of creating a second task. */
export async function appendBuilderDealsTourTask(input: { lead: RequestLead; request: TourRequest; taskId: string; privateDescription: string }): Promise<FubDeliveryResult> {
  try {
    const response = await fub(`/tasks/${encodeURIComponent(input.taskId)}`);
    const task = await response.json().catch(() => ({})) as Record<string, unknown>;
    const current = stringValue(task.description) ?? "";
    const addition = `${requestMarker(input.lead.id, input.request.id)}\n${requestLine(input.request, input.privateDescription)}`;
    if (!current.includes(requestMarker(input.lead.id, input.request.id))) {
      await fub(`/tasks/${encodeURIComponent(input.taskId)}`, { method: "PUT", body: JSON.stringify({ description: [current, addition].filter(Boolean).join("\n\n") }) });
    }
    const personId = await taskPersonId(input.lead);
    return { ok: true, personId: personId ?? undefined, taskId: input.taskId, records: personId ? [{ kind: "person", fubId: personId, createdByUs: false }, { kind: "task", fubId: input.taskId, createdByUs: true }] : [{ kind: "task", fubId: input.taskId, createdByUs: true }] };
  } catch { return { ok: false, error: "FUB task append failed" }; }
}

/** One marker-protected note per request; retries never append duplicate notes. */
export async function appendBuilderDealsRequestNote(input: { lead: RequestLead; request: TourRequest; privateDescription: string }): Promise<FubDeliveryResult> {
  try {
    const personId = await taskPersonId(input.lead);
    if (!personId) return { ok: false, error: "FUB contact unavailable" };
    const marker = requestMarker(input.lead.id, input.request.id);
    if (await personHasLeadMarker(personId, marker)) return { ok: true, personId, records: [{ kind: "person", fubId: personId, createdByUs: false }] };
    const note = await postFubNote(personId, "Builder Deals request", `${marker}\n${requestLine(input.request, input.privateDescription)}`);
    return note.ok
      ? { ok: true, personId, records: [{ kind: "person", fubId: personId, createdByUs: false }, ...(note.id ? [{ kind: "note" as const, fubId: note.id, createdByUs: true }] : [])] }
      : { ok: false, error: note.error };
  } catch { return { ok: false, error: "FUB request note failed" }; }
}

export async function appendBuilderDealsActivity(lead: { id: number; fubPersonId: string | null; phoneE164: string; email: string | null }, detail: string) {
  try {
    const personId = lead.fubPersonId ?? (await findPerson({ phone: lead.phoneE164, email: lead.email }))?.id;
    if (!personId) return { ok: false as const, error: "FUB contact unavailable" };
    const note = await postFubNote(String(personId), "Builder Deals activity", `${builderDealsLeadMarker(lead.id)}\n${detail}`);
    return note.ok ? { ok: true as const, noteId: note.id } : { ok: false as const, error: note.error };
  } catch { return { ok: false as const, error: "FUB activity delivery failed" }; }
}

/** Deletes only an object that is explicitly recorded as created by this system. */
export async function cleanupBuilderDealsFubRecord(kind: "person" | "event" | "note" | "task", fubId: string) {
  try {
    // FUB does not document event deletion. Events are subsumed by the person
    // deletion when applicable; a standalone event remains tracked for manual
    // cleanup rather than issuing an invented destructive endpoint.
    if (kind === "event") return { ok: false as const, error: "FUB event deletion is not documented" };
    const path = kind === "person" ? `/people/${encodeURIComponent(fubId)}` : `/${kind}s/${encodeURIComponent(fubId)}`;
    await fub(path, { method: "DELETE" });
    return { ok: true as const };
  } catch { return { ok: false as const, error: `FUB ${kind} cleanup failed` }; }
}

/** A found existing contact is retained; only the Builder Deals TEST tag is removed. */
export async function stripBuilderDealsTestTag(personId: string) {
  try {
    const response = await fub(`/people/${encodeURIComponent(personId)}`);
    const person = await response.json().catch(() => ({})) as FubPerson;
    const tags = fubTags(person).filter((tag) => tag.toUpperCase() !== "TEST");
    await fub(`/people/${encodeURIComponent(personId)}`, { method: "PUT", body: JSON.stringify({ tags, mergeTags: false }) });
    return { ok: true as const };
  } catch { return { ok: false as const, error: "FUB TEST-tag cleanup failed" }; }
}

export function builderDealsRelayedNote(input: { sourceCode: string; instagramHandle?: string | null }) {
  return ["Builder Deals access verified.", `Source: ${input.sourceCode}`, input.instagramHandle ? `Instagram: @${input.instagramHandle}` : undefined].filter(Boolean).join("\n");
}
