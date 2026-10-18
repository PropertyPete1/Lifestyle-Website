import { fubHeaders, sendFubNote } from "./fub";

const FUB_API_URL = "https://api.followupboss.com/v1";
const BASE_TAG = "IG Builder Deals";
const PETER_EMAIL = "peter@lifestyledesignrealty.com";

type FubPerson = { id?: string | number; tags?: string[]; assignedUserId?: string | number; emails?: Array<{ value?: string }>; phones?: Array<{ value?: string }>; [key: string]: unknown };
type BuilderLead = { id: number; phone: string; email?: string | null; name?: string | null; instagramHandle?: string | null; sourceCode: string; consentText: string; consentAt: Date; consentIp: string | null; flags?: string[]; timeline?: string | null; isTest?: boolean };

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
async function fub(path: string, init: RequestInit = {}) {
  const apiKey = process.env.FUB_API_KEY;
  if (!apiKey) throw new Error("FUB_API_KEY not configured");
  const res = await fetch(`${FUB_API_URL}${path}`, { ...init, headers: { ...fubHeaders(apiKey), ...(init.headers ?? {}) }, signal: timeout() });
  if (!res.ok) throw new Error(`FUB ${res.status}`);
  return res;
}
async function findPerson(lead: BuilderLead): Promise<FubPerson | null> {
  const candidates = [lead.phone, lead.email].filter(Boolean) as string[];
  for (const value of candidates) {
    const url = new URL(`${FUB_API_URL}/people`);
    if (value.startsWith("+")) url.searchParams.set("phone", value); else url.searchParams.set("email", value);
    const res = await fub(`${url.pathname}${url.search}`);
    const body = await res.json().catch(() => ({})) as { people?: FubPerson[] };
    if (body.people?.[0]) return body.people[0];
  }
  return null;
}
async function peterUserId() {
  const res = await fub(`/users?email=${encodeURIComponent(PETER_EMAIL)}`);
  const body = await res.json().catch(() => ({})) as { users?: Array<{ id?: number | string }> };
  return body.users?.[0]?.id ? String(body.users[0].id) : null;
}
function leadNote(lead: BuilderLead, action: string) {
  return [
    `Builder Deals lead ${lead.id}`, action, `Source: ${lead.sourceCode}`,
    lead.instagramHandle ? `Instagram: @${lead.instagramHandle}` : undefined,
    lead.isTest ? "TEST RECORD - eligible for Builder Deals cleanup" : undefined,
    `TCPA consent captured: ${lead.consentAt.toISOString()}`,
    lead.consentIp ? `Consent IP: ${lead.consentIp}` : undefined,
    `Consent text: ${lead.consentText}`,
  ].filter(Boolean).join("\n");
}

/** A first phone-verified unlock gets exactly one FUB event/action-plan trigger. */
export async function sendBuilderDealsLeadToFub(lead: BuilderLead) {
  try {
    const existing = await findPerson(lead);
    const peterId = await peterUserId();
    const [firstName, ...last] = (lead.name || (lead.instagramHandle ? `@${lead.instagramHandle}` : "Builder Deals Buyer")).trim().split(/\s+/);
    const body = {
      source: "IG Builder Deals", system: "Lifestyle Design Realty Website", type: "General Inquiry",
      message: leadNote(lead, "First Builder Deals unlock."),
      person: { firstName, lastName: last.join(" ") || undefined, phones: [{ value: lead.phone }], emails: lead.email ? [{ value: lead.email }] : undefined, tags: tagsFor(lead), assignedUserId: existing?.assignedUserId ?? peterId ?? undefined },
    };
    const res = await fub("/events", { method: "POST", body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({})) as { id?: string | number; personId?: string | number; person?: FubPerson };
    const personId = data.person?.id ?? data.personId ?? data.id ?? existing?.id;
    // If the event endpoint did not retain the intended assignee for a new or
    // unassigned contact, explicitly repair only that case.
    if (personId && peterId && !existing?.assignedUserId) {
      await fub(`/people/${personId}`, { method: "PUT", body: JSON.stringify({ assignedUserId: peterId, tags: tagsFor(lead), mergeTags: true }) });
    }
    return { ok: true as const, personId: personId ? String(personId) : undefined };
  } catch { return { ok: false as const, error: "FUB delivery failed" }; }
}

/** Later device/expiry rechecks update and note an existing person, never re-fire events. */
export async function updateBuilderDealsLeadInFub(lead: BuilderLead, reason: "re-verified on a second device" | "returned for a new link") {
  try {
    const person = await findPerson(lead);
    if (!person?.id) return sendBuilderDealsLeadToFub(lead);
    const unionTags = Array.from(new Set([...(person.tags ?? []), ...tagsFor(lead)]));
    await fub(`/people/${person.id}`, { method: "PUT", body: JSON.stringify({ phones: [{ value: lead.phone }], emails: lead.email ? [{ value: lead.email }] : undefined, tags: unionTags, mergeTags: true }) });
    const note = await sendFubNote(String(person.id), "Builder Deals access", leadNote(lead, reason));
    return note.ok ? { ok: true as const, personId: String(person.id) } : { ok: false as const, error: note.error };
  } catch { return { ok: false as const, error: "FUB update failed" }; }
}

/** Creates a single Peter-assigned task for the first Chicago-day request. */
export async function createBuilderDealsTourTask(input: { lead: { id: number; fubPersonId: string | null; phoneE164: string; email: string | null }; privateDescription: string; requestType: "tour" | "ask"; preferredAt: Date }) {
  try {
    let personId = input.lead.fubPersonId;
    if (!personId) {
      const person = await findPerson({ id: input.lead.id, phone: input.lead.phoneE164, email: input.lead.email, sourceCode: "other", consentText: "", consentAt: new Date(), consentIp: null });
      personId = person?.id ? String(person.id) : null;
    }
    const assignedUserId = await peterUserId();
    if (!personId || !assignedUserId) return { ok: false as const, error: "FUB contact or Peter assignment unavailable" };
    const response = await fub("/tasks", { method: "POST", body: JSON.stringify({ personId: Number(personId), assignedUserId: Number(assignedUserId), name: `Builder Deals ${input.requestType}: ${input.privateDescription}`, type: "Appointment", dueDateTime: input.preferredAt.toISOString() }) });
    const task = await response.json().catch(() => ({})) as { id?: string | number };
    await sendFubNote(String(personId), "Builder Deals request", `Builder Deals lead ${input.lead.id}\n${input.requestType}: ${input.privateDescription}\nPreferred: ${input.preferredAt.toISOString()}`);
    return { ok: true as const, taskId: task.id ? String(task.id) : undefined };
  } catch { return { ok: false as const, error: "FUB task delivery failed" }; }
}

export async function appendBuilderDealsActivity(lead: { id: number; fubPersonId: string | null; phoneE164: string; email: string | null }, detail: string) {
  try {
    const personId = lead.fubPersonId ?? (await findPerson({ id: lead.id, phone: lead.phoneE164, email: lead.email, sourceCode: "other", consentText: "", consentAt: new Date(), consentIp: null }))?.id;
    if (!personId) return { ok: false as const, error: "FUB contact unavailable" };
    return await sendFubNote(String(personId), "Builder Deals activity", `Builder Deals lead ${lead.id}\n${detail}`);
  } catch { return { ok: false as const, error: "FUB activity delivery failed" }; }
}

export function builderDealsRelayedNote(input: { sourceCode: string; instagramHandle?: string | null }) {
  return ["Builder Deals access verified.", `Source: ${input.sourceCode}`, input.instagramHandle ? `Instagram: @${input.instagramHandle}` : undefined].filter(Boolean).join("\n");
}
