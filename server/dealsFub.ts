import { fubHeaders } from "./fub";
import { hashSecret } from "./dealsService";

const FUB_API_URL = "https://api.followupboss.com/v1";
const FUB_APP_PERSON_URL = "https://app.followupboss.com/2/people/view";
const BASE_TAG = "IG Builder Deals";
const PETER_EMAIL = "peter@lifestyledesignrealty.com";
const FUB_PAGE_SIZE = 100;
const MAX_FUB_PAGES = 100;
const FUB_TIMEOUT_MS = 30_000;

type FubValue = { value?: string; email?: string; phone?: string; number?: string; [key: string]: unknown };
export type FubPerson = {
  id?: string | number;
  name?: string;
  firstName?: string;
  lastName?: string;
  tags?: Array<string | { name?: string; value?: string }> | string;
  assignedUserId?: string | number;
  assignedTo?: string;
  emails?: FubValue[];
  phones?: FubValue[];
  [key: string]: unknown;
};
/** The LDR agent who sent a buyer their client link; FUB objects for that buyer belong to this user, not Peter. */
export type FubAgentRef = { name: string; fubUserId: string | null; email: string | null };
type BuilderLead = { id: number; phone: string; email?: string | null; name?: string | null; instagramHandle?: string | null; sourceCode: string; consentText: string; consentAt: Date; consentIp: string | null; flags?: string[]; timeline?: string | null; isTest?: boolean; fubPersonId?: string | null; agent?: FubAgentRef | null };
type FubIdentity = { phone?: string | null; email?: string | null };
const AGENT_CLIENT_TAG = "Agent Client";
/** Oct 28, 2026: a buyer who signed up through an agent's own page link (their Instagram profile link). */
export const AGENT_PAGE_TAG = "Agent Page Link";
const AGENT_PAGE_SOURCE_CODE = "agent-page";

export type FubRecordWrite = { kind: "person" | "event" | "note" | "task"; fubId: string; createdByUs: boolean };
/** Facts about the pre-existing FUB contact that only the unlock alert needs. */
export type FubUnlockScreening = { alreadyAssignedTo: string | null; previouslyOptedOut: boolean };
export type FubDeliveryResult =
  | { ok: true; personId?: string; taskId?: string; records: FubRecordWrite[]; warning?: string; screening?: FubUnlockScreening }
  /** `terminal` marks a failure that a retry can never fix (for example FUB declining the event with 204). */
  | { ok: false; error: string; terminal?: boolean };

function timeout(ms = FUB_TIMEOUT_MS) { return AbortSignal.timeout(ms); }
function intentTag(timeline?: string | null) {
  if (!timeline) return null;
  if (timeline.startsWith("0-3")) return "Intent - Hot";
  if (timeline.startsWith("3-6")) return "Intent - Warm";
  return "Intent - Cold";
}
function tagsFor(lead: BuilderLead) {
  return Array.from(new Set([BASE_TAG, ...(lead.flags ?? []).filter((flag) => flag === "Possible Agent - TREC Name Match" || flag === "Possible Agent - Handle"), intentTag(lead.timeline), lead.agent ? AGENT_CLIENT_TAG : null, lead.agent && lead.sourceCode === AGENT_PAGE_SOURCE_CODE ? AGENT_PAGE_TAG : null, lead.isTest ? "TEST" : null].filter(Boolean) as string[]));
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
/** The FUB web link alert emails may carry; it never includes the personal access URL. */
export function fubPersonLink(personId: string | number) {
  return `${FUB_APP_PERSON_URL}/${encodeURIComponent(String(personId))}`;
}

const ASSIGNMENT_TTL_MS = 3 * 60_000;
const ASSIGNMENT_CACHE_MAX = 5_000;
const assignmentCache = new Map<string, { userId: string | null; at: number }>();
/** Test seam: forget the remembered assignments. */
export function resetFubAssignmentCache() { assignmentCache.clear(); }

/**
 * Oct 28, 2026 (Peter: whichever agent a lead is assigned to sees what they hearted, even after the lead moves between
 * agents): who each FUB contact is assigned to right now, read 100 contacts per call and remembered for three minutes.
 * A contact FUB no longer returns (trashed, merged, deleted) or one sitting in a pond maps to null. When FUB does not
 * answer, those contacts are left out of the result (and not remembered), so a hiccup never moves anything.
 */
export async function fubAssignedUserIds(personIds: readonly string[], now = Date.now()): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  const missing: string[] = [];
  for (const id of Array.from(new Set(personIds.map((value) => String(value).trim()).filter((value) => /^\d{1,18}$/.test(value))))) {
    const cached = assignmentCache.get(id);
    if (cached && now - cached.at < ASSIGNMENT_TTL_MS) result.set(id, cached.userId);
    else missing.push(id);
  }
  if (assignmentCache.size > ASSIGNMENT_CACHE_MAX) assignmentCache.clear();
  for (let start = 0; start < missing.length; start += FUB_PAGE_SIZE) {
    const chunk = missing.slice(start, start + FUB_PAGE_SIZE);
    try {
      const params = new URLSearchParams({ id: chunk.join(","), fields: "id,assignedUserId", limit: String(FUB_PAGE_SIZE) });
      const res = await fub(`/people?${params.toString()}`);
      const body = await res.json().catch(() => null) as { people?: FubPerson[] } | null;
      if (!body || !Array.isArray(body.people)) continue;
      const found = new Map<string, string | null>();
      for (const person of body.people) {
        const id = stringValue(person.id);
        const userId = stringValue(person.assignedUserId);
        if (id) found.set(id, userId && userId !== "0" ? userId : null);
      }
      for (const id of chunk) {
        const userId = found.get(id) ?? null;
        result.set(id, userId);
        assignmentCache.set(id, { userId, at: now });
      }
    } catch { /* FUB unavailable: these contacts are simply not matched this time. */ }
  }
  return result;
}

async function fub(path: string, init: RequestInit = {}) {
  const apiKey = process.env.FUB_API_KEY;
  if (!apiKey) throw new Error("FUB_API_KEY not configured");
  const res = await fetch(`${FUB_API_URL}${path}`, { ...init, headers: { ...fubHeaders(apiKey), ...(init.headers ?? {}) }, signal: timeout() });
  if (!res.ok) throw new Error(`FUB ${res.status}`);
  return res;
}

/** Search both phone formats because FUB can index a saved number in national form; an email-only identity searches by email only. */
async function findPerson(identity: FubIdentity): Promise<FubPerson | null> {
  const phone = identity.phone?.trim() || null;
  const candidates = [phone, phone ? nationalPhone(phone) : null, identity.email?.trim().toLowerCase() || null].filter((value): value is string => Boolean(value));
  const checked = new Set<string>();
  for (const value of candidates) {
    if (checked.has(value)) continue;
    checked.add(value);
    // Build only the query here: `fub()` already carries the /v1 base path.
    const query = new URLSearchParams(value.includes("@") ? { email: value } : { phone: value });
    const res = await fub(`/people?${query.toString()}`);
    const body = await res.json().catch(() => ({})) as { people?: FubPerson[] };
    if (body.people?.[0]) return body.people[0];
  }
  return null;
}

/** Exported so an admin cascade can find the contact a pre-verification screening tagged (there is no local lead yet). */
export async function findBuilderDealsFubPersonId(identity: FubIdentity): Promise<string | null> {
  try {
    const person = await findPerson(identity);
    return person?.id === undefined ? null : String(person.id);
  } catch { return null; }
}

async function loadPerson(personId: string): Promise<FubPerson | null> {
  const response = await fub(`/people/${encodeURIComponent(personId)}`);
  const person = await response.json().catch(() => ({})) as FubPerson;
  return person && typeof person === "object" ? person : null;
}

/** Best-effort screening annotation. It is deliberately independent from buyer
 * gating: FUB being unavailable must not change a completed gate response. */
export async function tagBuilderDealsScreeningContact(input: { phone: string | null; email: string | null; personId?: string; tag: "Agent - FUB Match" | "Possible Agent - Email Domain"; matchOn?: "phone" | "email" }) {
  try {
    // An email-only match must never tag whoever owns an unverified typed phone.
    const identity: FubIdentity = input.matchOn === "email" ? { email: input.email } : { phone: input.phone, email: input.email };
    const personId = input.personId ?? ((identity.phone || identity.email) ? (await findPerson(identity))?.id : null);
    if (!personId) return { ok: false as const, error: "FUB contact unavailable" };
    const person = await loadPerson(String(personId));
    const tags = Array.from(new Set([...fubTags(person), input.tag]));
    await fub(`/people/${encodeURIComponent(String(personId))}`, { method: "PUT", body: JSON.stringify({ tags, mergeTags: false }) });
    const marker = `Builder Deals screening: ${input.tag}; match ${input.matchOn ?? "identity"}.`;
    await postFubNote(String(personId), "Builder Deals screening", marker);
    return { ok: true as const, personId: String(personId) };
  } catch { return { ok: false as const, error: "FUB screening update failed" }; }
}

/** The FUB tag a realtor sent from Builder Deals to recruiting carries (its own recruiting track, Peter, Oct 24 2026). */
export const BUILDER_DEALS_RECRUIT_TAG = "Recruit - Builder Deals";

/**
 * A visitor told the Builder Deals gate they are a realtor: an existing FUB contact gets the recruiting tag and a note;
 * otherwise a new contact is created through an event (source "Builder Deals - Agent Recruiting") so recruiting follows up.
 */
export async function recordBuilderDealsRealtor(input: { phone: string; name?: string | null; email?: string | null; source?: string | null }) {
  try {
    const note = `Said they are a realtor on the Builder Deals gate${input.source ? ` (came in from ${input.source})` : ""}. Sent to the agent recruiting page and kept off Builder Deals until they join the team.`;
    const person = await findPerson({ phone: input.phone, email: null }) ?? (input.email ? await findPerson({ phone: null, email: input.email }) : null);
    if (person?.id !== undefined) {
      const personId = String(person.id);
      const full = await loadPerson(personId);
      const tags = Array.from(new Set([...fubTags(full), BUILDER_DEALS_RECRUIT_TAG]));
      await fub(`/people/${encodeURIComponent(personId)}`, { method: "PUT", body: JSON.stringify({ tags, mergeTags: false }) });
      await postFubNote(personId, "Builder Deals: realtor", note);
      return { ok: true as const, personId, created: false };
    }
    const res = await fub("/events", { method: "POST", body: JSON.stringify({
      source: "Builder Deals - Agent Recruiting", system: "Lifestyle Design Realty", type: "General Inquiry", message: note,
      person: {
        ...(input.name ? { firstName: input.name.split(" ")[0], lastName: input.name.split(" ").slice(1).join(" ") || undefined } : {}),
        phones: [{ value: input.phone }], ...(input.email ? { emails: [{ value: input.email }] } : {}), tags: [BUILDER_DEALS_RECRUIT_TAG],
      },
    }) });
    const body = await res.json().catch(() => ({})) as { person?: { id?: string | number }; personId?: string | number };
    const personId = body.person?.id ?? body.personId;
    return { ok: true as const, personId: personId === undefined ? null : String(personId), created: true };
  } catch { return { ok: false as const, error: "FUB realtor update failed" }; }
}

export const BUILDER_DEALS_CLIENT_TAG = "Builder Deals Client";
export const CLIENT_LINK_TEXT_SOURCE = "Builder Deals - Client Link";

export type ClientLinkTextRecord =
  | { ok: true; personId: string | null; created: boolean; logged: boolean }
  | { ok: false; kind: "opted_out"; personId: string }
  | { ok: false; kind: "unavailable"; error: string };

/**
 * An agent texted a client their Builder Deals link (from their own phone: FUB's text endpoint only records a
 * message on the timeline, it never delivers one). The client is found or created in FUB, assigned to the agent (else
 * Peter), tagged, the text is written to their timeline as an outgoing message from the agent's number, and a note
 * says who sent the link and when. A contact who opted out of texts is never written to and the caller is told.
 */
export async function recordClientLinkText(input: { clientPhone: string; clientName: string; message: string; agent: { name: string; fubUserId: string | null; phoneE164: string | null }; linkUrl: string; sentAt?: Date }) {
  const sentAt = input.sentAt ?? new Date();
  try {
    let person = await findPerson({ phone: input.clientPhone, email: null });
    let created = false;
    if (person?.id !== undefined) {
      const personId = String(person.id);
      const full = (await loadPerson(personId)) ?? person;
      const history = await personHistory(personId);
      if (detectPriorOptOut(full, history.notes)) return { ok: false as const, kind: "opted_out" as const, personId };
      const tags = Array.from(new Set([...fubTags(full), BUILDER_DEALS_CLIENT_TAG]));
      await fub(`/people/${encodeURIComponent(personId)}`, { method: "PUT", body: JSON.stringify({ tags, mergeTags: false }) });
      person = full;
    } else {
      const assignedUserId = input.agent.fubUserId?.trim() || await peterUserId();
      const [firstName, ...rest] = input.clientName.trim().split(/\s+/);
      const res = await fub("/events", { method: "POST", body: JSON.stringify({
        source: CLIENT_LINK_TEXT_SOURCE, system: "Lifestyle Design Realty", type: "General Inquiry",
        message: `${input.agent.name} sent their Builder Deals client link.`,
        person: { firstName, ...(rest.length ? { lastName: rest.join(" ") } : {}), phones: [{ value: input.clientPhone }], tags: [BUILDER_DEALS_CLIENT_TAG], ...(assignedUserId ? { assignedUserId: Number(assignedUserId) } : {}) },
      }) });
      const body = await res.json().catch(() => ({})) as { person?: { id?: string | number }; personId?: string | number; id?: string | number };
      const id = body.person?.id ?? body.personId ?? body.id;
      person = id === undefined ? null : { id };
      created = true;
    }
    const personId = person?.id === undefined ? null : String(person.id);
    let logged = false;
    if (personId) {
      // The timeline record (FUB does not send it); the agent's own number is the "from" when the team list has it.
      try {
        await fub("/textMessages", { method: "POST", body: JSON.stringify({ personId: Number(personId), message: input.message, isIncoming: false, toNumber: input.clientPhone, ...(input.agent.phoneE164 ? { fromNumber: input.agent.phoneE164 } : {}), externalLabel: "Builder Deals client link" }) });
        logged = true;
      } catch { logged = false; }
      await postFubNote(personId, "Builder Deals: client link texted", `${input.agent.name} texted their Builder Deals client link on ${formatChicagoDateTime(sentAt)}.\nLink: ${input.linkUrl}`);
    }
    return { ok: true as const, personId, created, logged };
  } catch (error) {
    return { ok: false as const, kind: "unavailable" as const, error: error instanceof Error ? error.message : "FUB unavailable" };
  }
}

function textInFubObject(value: unknown): string[] {
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(textInFubObject);
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(textInFubObject);
  return [];
}

async function listFubCollection(path: string, collection: string, params: Record<string, string>, maxPages = MAX_FUB_PAGES): Promise<unknown[]> {
  const values: unknown[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const query = new URLSearchParams({ ...params, limit: String(FUB_PAGE_SIZE), offset: String(page * FUB_PAGE_SIZE) });
    const res = await fub(`${path}?${query.toString()}`);
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    const batch = Array.isArray(body[collection]) ? body[collection] as unknown[] : [];
    values.push(...batch);
    if (batch.length < FUB_PAGE_SIZE) break;
  }
  return values;
}

type FubHistory = { notes: unknown[]; events: unknown[]; available: boolean };
/**
 * A timed-out create may still land remotely. Before any resend, scan the
 * person's system-visible notes/events for our opaque marker and treat it as
 * complete. An unavailable history endpoint deliberately does not claim a
 * match; the durable runner will retry with a lease and backoff.
 */
async function personHistory(personId: string | number): Promise<FubHistory> {
  let available = true;
  const notes = await listFubCollection("/notes", "notes", { personId: String(personId) }).catch(() => { available = false; return [] as unknown[]; });
  const events = await listFubCollection("/events", "events", { personId: String(personId) }, 1).catch(() => { available = false; return [] as unknown[]; });
  return { notes, events, available };
}
function historyHasMarker(history: FubHistory, marker: string) {
  return [...history.notes, ...history.events].some((item) => textInFubObject(item).some((text) => text.includes(marker)));
}
async function personHasLeadMarker(personId: string | number, marker: string): Promise<boolean> {
  return historyHasMarker(await personHistory(personId), marker);
}

/** Every note this system writes starts with "Builder Deals" or carries the opaque lead marker. */
export function isBuilderDealsSystemNote(note: unknown): boolean {
  return textInFubObject(note).some((text) => /\bBDL-[a-f0-9]{20}\b/.test(text) || /^Builder Deals\b/.test(text.trim()));
}

const OPT_OUT_FIELD = /opt[\s_-]?out|opted|unsubscri|do[\s_-]?not[\s_-]?(?:call|text|contact|email)|^dnc$|do_not_disturb/i;
const OPT_OUT_STATUS = /opt(?:ed)?[\s-]?out|unsubscrib|do not (?:call|text|contact)|\bdnc\b|\bstop\b/i;
const OPT_OUT_NOTE = /\b(?:opt(?:ed|s)?[\s-]?out|unsubscribed?|do not (?:text|call|contact)|dnc|(?:replied|texted|said|sent|responded|answered)(?:\s+(?:with|back))?\s+["'“]?stop\b|stop\s+(?:reply|request|received))/i;
function truthy(value: unknown) {
  return value === true || value === 1 || (typeof value === "string" && /^(true|yes|1)$/i.test(value.trim()));
}
/**
 * Detects a prior opt-out ONLY from FUB's own opt-out / do-not-contact fields on
 * the person and its phone/email entries, or from notes this system did not
 * write. The consent text this system writes mentions "Reply STOP", so system
 * notes are excluded by marker before any text match.
 */
export function detectPriorOptOut(person: FubPerson | null | undefined, notes: unknown[] = []): boolean {
  if (person && typeof person === "object") {
    const entries: unknown[] = [person, ...(Array.isArray(person.phones) ? person.phones : []), ...(Array.isArray(person.emails) ? person.emails : [])];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
        if (value && typeof value === "object") continue;
        if (OPT_OUT_FIELD.test(key) && truthy(value)) return true;
        if (/status$/i.test(key) && typeof value === "string" && OPT_OUT_STATUS.test(value)) return true;
      }
    }
  }
  return notes.some((note) => !isBuilderDealsSystemNote(note) && textInFubObject(note).some((text) => OPT_OUT_NOTE.test(text)));
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
/** Test seam: the Peter lookup is cached for five minutes. */
export function resetPeterUserCache() { cachedPeter = null; }

async function fubUserName(userId: string): Promise<string | null> {
  try {
    const res = await fub(`/users/${encodeURIComponent(userId)}`);
    const user = await res.json().catch(() => ({})) as Record<string, unknown>;
    return stringValue(user.name) ?? ([stringValue(user.firstName), stringValue(user.lastName)].filter(Boolean).join(" ") || null);
  } catch { return null; }
}

/** "already assigned to" and "previously opted out" come only from the pre-existing contact, never from anything we wrote. */
async function unlockScreening(existing: FubPerson | null, notes: unknown[], peterId: string | null): Promise<FubUnlockScreening> {
  if (!existing) return { alreadyAssignedTo: null, previouslyOptedOut: false };
  const assignedUserId = stringValue(existing.assignedUserId);
  let alreadyAssignedTo: string | null = null;
  if (assignedUserId && assignedUserId !== peterId) {
    alreadyAssignedTo = stringValue(existing.assignedTo) ?? await fubUserName(assignedUserId) ?? `FUB user ${assignedUserId}`;
  }
  return { alreadyAssignedTo, previouslyOptedOut: detectPriorOptOut(existing, notes) };
}

function leadNote(lead: BuilderLead, action: string, operation: "first_unlock" | "reverify", occurrenceId?: string) {
  return [
    `Builder Deals ${builderDealsOperationMarker(lead.id, operation, occurrenceId)}`, action, `Source: ${lead.sourceCode}`,
    lead.agent ? `LDR agent: ${lead.agent.name} (${lead.sourceCode === AGENT_PAGE_SOURCE_CODE ? "signed up through their own Builder Deals link" : "sent through their client link"})` : undefined,
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
/** True when the FUB contact still carries the placeholder this system would have created (or no name at all). */
export function fubNameIsPlaceholder(person: Pick<FubPerson, "name" | "firstName" | "lastName">, lead: Pick<BuilderLead, "phone" | "instagramHandle">) {
  const normalize = (value: unknown) => (stringValue(value) ?? "").toLowerCase().replace(/^@/, "");
  let first = normalize(person.firstName);
  let last = normalize(person.lastName);
  if (!first && !last) {
    const [head, ...rest] = (stringValue(person.name) ?? "").split(/\s+/);
    first = normalize(head);
    last = normalize(rest.join(" "));
  }
  if (!first && !last) return true;
  const placeholder = nameForNewPerson({ ...lead, name: null } as BuilderLead);
  return first === normalize(placeholder.firstName) && last === normalize(placeholder.lastName ?? "");
}
type PersonBodyOptions = { assignedUserId?: string | null; forceAssignment?: boolean; includeName?: boolean };
function personBody(lead: BuilderLead, existing: FubPerson | null, options: PersonBodyOptions = {}) {
  const contact = unionFubContactValues(existing, lead);
  const assign = options.forceAssignment || !existing?.assignedUserId ? stringValue(options.assignedUserId) : null;
  return {
    ...((options.includeName ?? !existing?.id) ? nameForNewPerson(lead) : {}),
    phones: contact.phones,
    emails: contact.emails.length ? contact.emails : undefined,
    tags: unionFubTags(existing, lead),
    // An existing assignment is left alone unless the caller repairs a new or
    // unassigned person; omitting the field never changes FUB's value.
    ...(assign ? { assignedUserId: /^\d+$/.test(assign) ? Number(assign) : assign } : {}),
  };
}
async function putPersonUnion(personId: string, existing: FubPerson | null, lead: BuilderLead, options: PersonBodyOptions = {}) {
  const person = personBody(lead, existing, options);
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

/**
 * A first verified unlock gets one marker-protected FUB event/action-plan trigger.
 * FUB's POST /v1/events answers with the PERSON (201 = created, 200 = matched an
 * existing person, 204 = the lead flow ignored/archived the event); it returns
 * no event id, so no event record is written.
 */
/** The FUB user a new or unassigned Builder Deals contact belongs to: the sending agent when there is one, else Peter. */
async function assigneeFor(lead: Pick<BuilderLead, "agent">) {
  const agentId = lead.agent?.fubUserId?.trim();
  return agentId ? agentId : peterUserId();
}

export async function sendBuilderDealsLeadToFub(lead: BuilderLead): Promise<FubDeliveryResult> {
  try {
    const existing = await findPerson(lead);
    const peterId = await peterUserId();
    const assigneeId = await assigneeFor(lead);
    const history: FubHistory = existing?.id ? await personHistory(existing.id) : { notes: [], events: [], available: true };
    // "Already assigned" is measured against the user who should own this contact.
    const screening = await unlockScreening(existing, history.notes, assigneeId ?? peterId);
    if (existing?.id && historyHasMarker(history, builderDealsOperationMarker(lead.id, "first_unlock"))) {
      return { ok: true, personId: String(existing.id), records: [{ kind: "person", fubId: String(existing.id), createdByUs: false }], screening };
    }
    if (!existing?.assignedUserId && !assigneeId) return { ok: false, error: "Peter FUB user not found" };
    const body = {
      source: "IG Builder Deals", system: "Lifestyle Design Realty Website", type: "General Inquiry",
      message: leadNote(lead, lead.agent ? (lead.sourceCode === AGENT_PAGE_SOURCE_CODE ? `First Builder Deals unlock through ${lead.agent.name}'s own Builder Deals link.` : "First Builder Deals unlock through an agent's client link.") : "First Builder Deals unlock.", "first_unlock"),
      person: personBody(lead, existing, { assignedUserId: assigneeId }),
    };
    const res = await fub("/events", { method: "POST", body: JSON.stringify(body) });
    if (res.status === 204) {
      return { ok: false, terminal: true, error: "FUB did not accept the lead event (HTTP 204): the IG Builder Deals lead flow is set to ignore or archive these leads" };
    }
    const data = await res.json().catch(() => ({})) as FubPerson & { personId?: string | number; person?: FubPerson };
    const returned: FubPerson | null = data.person ?? (data.id !== undefined ? data : null);
    const personId = data.person?.id ?? data.personId ?? data.id ?? existing?.id;
    if (personId === undefined || personId === null || String(personId).trim() === "") return { ok: false, error: "FUB event did not return a contact" };
    // 201 is FUB's "new person" answer. A 200 means FUB matched a person we did
    // not find; that contact pre-existed and must never be deleted by cleanup.
    const createdByUs = res.status === 201 || (res.status !== 200 && !existing?.id);
    const records: FubRecordWrite[] = [{ kind: "person", fubId: String(personId), createdByUs }];
    // Assignment repair is best-effort after the irreversible event. A repair
    // failure must never retry the event or trigger a second action plan.
    if (assigneeId && (!existing?.id || !existing.assignedUserId)) {
      try { await putPersonUnion(String(personId), existing ?? returned, lead, { assignedUserId: assigneeId, forceAssignment: true }); }
      catch { return { ok: true, personId: String(personId), records, warning: "FUB assignment repair failed", screening }; }
    }
    return { ok: true, personId: String(personId), records, screening };
  } catch { return { ok: false, error: "FUB delivery failed" }; }
}

/** Why a lead's FUB contact is being noted again; the wording lands in the note as written. */
export type ReverifyReason = "re-verified on a second device" | "returned for a new link" | "attached to an agent's client link";

/** Later device/expiry rechecks update and note an existing person, never re-fire events. */
export async function updateBuilderDealsLeadInFub(lead: BuilderLead, reason: ReverifyReason, occurrenceId?: string): Promise<FubDeliveryResult> {
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

/**
 * The name prompt and timeline answer reach FUB through one union PUT: the
 * Intent tag, any newly stored Possible Agent flags, and the real name only
 * while the contact still carries the placeholder this system created.
 */
export async function updateBuilderDealsProfileInFub(lead: BuilderLead): Promise<FubDeliveryResult> {
  try {
    let person: FubPerson | null = null;
    if (lead.fubPersonId) person = await loadPerson(lead.fubPersonId).catch(() => null);
    if (!person?.id) person = await findPerson(lead);
    if (!person?.id) return { ok: false, error: "FUB contact unavailable" };
    const personId = String(person.id);
    const includeName = Boolean(lead.name?.trim()) && fubNameIsPlaceholder(person, lead);
    await putPersonUnion(personId, person, lead, { includeName });
    return { ok: true, personId, records: [{ kind: "person", fubId: personId, createdByUs: false }] };
  } catch { return { ok: false, error: "FUB profile update failed" }; }
}

export function formatChicagoDateTime(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(value);
}

type RequestLead = { id: number; fubPersonId: string | null; phoneE164: string; email: string | null; name?: string | null; instagramHandle?: string | null; sourceCode?: string; consentText?: string; consentAt?: Date; consentIp?: string | null; isTest?: boolean; agent?: FubAgentRef | null };
export type DealsRequestType = "tour" | "ask" | "save";
type TourRequest = { id: number; requestType: DealsRequestType; preferredAt: Date; chicagoDay: string; fubTaskId: string | null; fubNoteSentAt: Date | null };
const REQUEST_LABEL: Record<DealsRequestType, string> = { tour: "Tour", ask: "Question", save: "Saved" };
/** Toggle (c): everything a full-pipeline test lead creates in FUB is marked TEST so cleanup and the team can tell it apart. */
const TEST_RECORD_LINE = "TEST RECORD - eligible for Builder Deals cleanup";
function testPrefix(lead: Pick<RequestLead, "isTest">) { return lead.isTest ? "TEST " : ""; }
function testLines(lead: Pick<RequestLead, "isTest">): string[] { return lead.isTest ? [TEST_RECORD_LINE] : []; }

async function taskPersonId(lead: RequestLead) {
  if (lead.fubPersonId) return lead.fubPersonId;
  const person = await findPerson({ phone: lead.phoneE164, email: lead.email });
  return person?.id ? String(person.id) : null;
}
function requestMarker(leadId: number, requestId: number) { return `${builderDealsLeadMarker(leadId)}-R${requestId}`; }
function requestDayMarker(leadId: number, chicagoDay: string) { return `${builderDealsLeadMarker(leadId)}:request-day:${chicagoDay}`; }
function activityDayMarker(leadId: number, chicagoDay: string) { return `${builderDealsLeadMarker(leadId)}:activity:${chicagoDay}`; }
function requestLine(request: TourRequest, privateDescription: string) {
  if (request.requestType === "save") return `Saved: ${privateDescription}\nSaved at: ${formatChicagoDateTime(request.preferredAt)}`;
  return `${REQUEST_LABEL[request.requestType]}: ${privateDescription}\nPreferred: ${formatChicagoDateTime(request.preferredAt)}`;
}

/**
 * Create one FUB task for a Chicago-day request group. It goes to whoever the contact is assigned to in FUB right now
 * (Oct 28, 2026: a lead Peter hands to an agent keeps sending that agent the saves and tours), else the agent who sent
 * the buyer, else Peter.
 */
export async function createBuilderDealsTourTask(input: { lead: RequestLead; request: TourRequest; privateDescription: string }): Promise<FubDeliveryResult> {
  try {
    const personId = await taskPersonId(input.lead);
    const current = personId ? (await fubAssignedUserIds([personId])).get(personId) ?? null : null;
    const assignedUserId = current ?? await assigneeFor(input.lead);
    if (!personId || !assignedUserId) return { ok: false, error: "FUB contact or Peter assignment unavailable" };
    const description = [requestMarker(input.lead.id, input.request.id), ...testLines(input.lead), requestLine(input.request, input.privateDescription)].join("\n");
    const save = input.request.requestType === "save";
    const name = `${testPrefix(input.lead)}Builder Deals ${save ? "saved home" : input.request.requestType}: ${input.privateDescription}`;
    const response = await fub("/tasks", { method: "POST", body: JSON.stringify({ personId: Number(personId), assignedUserId: Number(assignedUserId), name, description, type: save ? "Follow Up" : "Appointment", dueDateTime: input.request.preferredAt.toISOString() }) });
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

function fubNoteId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const note = record.note && typeof record.note === "object" ? record.note as Record<string, unknown> : record;
  return stringValue(note.id ?? record.id) ?? undefined;
}
function fubNoteBody(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const note = record.note && typeof record.note === "object" ? record.note as Record<string, unknown> : record;
  return stringValue(note.body ?? record.body) ?? "";
}
/** Pages through every note of the person: a chatty contact must not get a second day note. */
async function findBuilderDealsMarkedNote(personId: string, marker: string) {
  const notes = await listFubCollection("/notes", "notes", { personId });
  const matching = notes.find((note) => textInFubObject(note).some((text) => text.includes(marker)));
  return matching === undefined ? null : { id: fubNoteId(matching) };
}

/** Create the one marker-protected FUB note for a lead's Chicago request day. */
export async function createBuilderDealsRequestNote(input: { lead: RequestLead; request: TourRequest; privateDescription: string }): Promise<FubDeliveryResult> {
  try {
    const personId = await taskPersonId(input.lead);
    if (!personId) return { ok: false, error: "FUB contact unavailable" };
    const dayMarker = requestDayMarker(input.lead.id, input.request.chicagoDay);
    const existing = await findBuilderDealsMarkedNote(personId, dayMarker);
    if (existing?.id) return appendBuilderDealsRequestNote({ ...input, noteId: existing.id });
    if (existing) return { ok: false, error: "FUB per-day note id unavailable" };
    const marker = requestMarker(input.lead.id, input.request.id);
    const note = await postFubNote(personId, `${testPrefix(input.lead)}Builder Deals request`, [dayMarker, ...testLines(input.lead), marker, requestLine(input.request, input.privateDescription)].join("\n"));
    if (note.ok && !note.id) return { ok: false, error: "FUB note did not return an id" };
    return note.ok
      ? { ok: true, personId, records: [{ kind: "person", fubId: personId, createdByUs: false }, ...(note.id ? [{ kind: "note" as const, fubId: note.id, createdByUs: true }] : [])] }
      : { ok: false, error: note.error };
  } catch { return { ok: false, error: "FUB request note failed" }; }
}

/** Append a request to the existing daily FUB note; its request marker makes retries safe. */
export async function appendBuilderDealsRequestNote(input: { lead: RequestLead; request: TourRequest; noteId: string; privateDescription: string }): Promise<FubDeliveryResult> {
  try {
    const personId = await taskPersonId(input.lead);
    if (!personId) return { ok: false, error: "FUB contact unavailable" };
    const response = await fub(`/notes/${encodeURIComponent(input.noteId)}`);
    const current = fubNoteBody(await response.json().catch(() => ({})));
    const marker = requestMarker(input.lead.id, input.request.id);
    if (!current.includes(marker)) {
      const addition = `${marker}\n${requestLine(input.request, input.privateDescription)}`;
      await fub(`/notes/${encodeURIComponent(input.noteId)}`, { method: "PUT", body: JSON.stringify({ body: [current, addition].filter(Boolean).join("\n\n") }) });
    }
    return { ok: true, personId, records: [{ kind: "person", fubId: personId, createdByUs: false }, { kind: "note", fubId: input.noteId, createdByUs: true }] };
  } catch { return { ok: false, error: "FUB request note append failed" }; }
}

/** The ONE activity note per lead per Chicago day; a day marker makes the nightly job idempotent. */
export async function appendBuilderDealsActivity(lead: RequestLead, chicagoDay: string, detail: string): Promise<FubDeliveryResult> {
  try {
    const personId = await taskPersonId(lead);
    if (!personId) return { ok: false, error: "FUB contact unavailable" };
    const dayMarker = activityDayMarker(lead.id, chicagoDay);
    const existing = await findBuilderDealsMarkedNote(personId, dayMarker);
    if (existing) {
      return { ok: true, personId, records: [{ kind: "person", fubId: personId, createdByUs: false }, ...(existing.id ? [{ kind: "note" as const, fubId: existing.id, createdByUs: true }] : [])] };
    }
    const note = await postFubNote(personId, "Builder Deals activity", `${dayMarker}\n${detail}`);
    return note.ok
      ? { ok: true, personId, records: [{ kind: "person", fubId: personId, createdByUs: false }, ...(note.id ? [{ kind: "note" as const, fubId: note.id, createdByUs: true }] : [])] }
      : { ok: false, error: note.error };
  } catch { return { ok: false, error: "FUB activity delivery failed" }; }
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
    const person = await loadPerson(personId);
    const tags = fubTags(person).filter((tag) => tag.toUpperCase() !== "TEST");
    await fub(`/people/${encodeURIComponent(personId)}`, { method: "PUT", body: JSON.stringify({ tags, mergeTags: false }) });
    return { ok: true as const };
  } catch { return { ok: false as const, error: "FUB TEST-tag cleanup failed" }; }
}
