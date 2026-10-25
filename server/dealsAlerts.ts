import { and, eq, lt, lte, or, sql } from "drizzle-orm";
import { dealAlerts, dealClientLinks, dealLeads } from "../drizzle/schema";
import { normalizeUsPhone } from "../shared/deals";
import { getDb } from "./db";
import { sendBuilderDealsEmail } from "./dealsEmail";
import { fubPersonLink } from "./dealsFub";
import { getDealSettings } from "./dealsService";

export type DealAlertKind = "first_unlock" | "profile_flag" | "agent_update";
type AlertRow = typeof dealAlerts.$inferSelect;
type AlertLead = Pick<typeof dealLeads.$inferSelect, "id" | "name" | "phoneE164" | "email" | "instagramHandle" | "sourceCode" | "timeline"> & { agentTeamId?: number | null; clientLinkId?: number | null };
/**
 * The agent who sent the buyer. They get their own copy of the buyer's alerts:
 * written to them, with their client's details, and without the owners' admin
 * links (agents have no admin login).
 */
type AlertAgent = { name: string; email: string | null; fubUserId?: string | null };

const STALE_SEND_MS = 15 * 60_000;
const DEFAULT_SITE_ORIGIN = "https://lifestyledesignrealty.com";

function validRecipients(values: readonly string[]) {
  return Array.from(new Set(values.map((value) => value.trim().toLowerCase()).filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))));
}

function parseRecipients(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? validRecipients(parsed.filter((item): item is string => typeof item === "string")) : [];
  } catch {
    return [];
  }
}

function nextHour(now = new Date()) {
  const scheduled = new Date(now);
  scheduled.setUTCMinutes(0, 0, 0);
  scheduled.setUTCHours(scheduled.getUTCHours() + 1);
  return scheduled;
}

/** Every link in an alert opens admin (login required, confirm button); never the personal page. */
export function adminLeadLink(leadId: number) {
  const origin = (process.env.DEALS_SITE_ORIGIN?.trim() || DEFAULT_SITE_ORIGIN).replace(/\/+$/, "");
  return `${origin}/admin/deals?lead=${leadId}`;
}

/** The agent's own page: their client links and what each client did. */
export function agentTeamLink() {
  const origin = (process.env.DEALS_SITE_ORIGIN?.trim() || DEFAULT_SITE_ORIGIN).replace(/\/+$/, "");
  return `${origin}/deals/team`;
}

function displayPhone(phoneE164: string) {
  const parsed = normalizeUsPhone(phoneE164, { allowCanada: true });
  return parsed.ok ? parsed.display : phoneE164;
}

/** How the agent knows this client: the name they typed on the link, else the profile name, else the number. */
async function clientLabel(lead: AlertLead) {
  const db = lead.clientLinkId ? await getDb() : null;
  const link = db && lead.clientLinkId ? (await db.select({ clientName: dealClientLinks.clientName }).from(dealClientLinks).where(eq(dealClientLinks.id, lead.clientLinkId)).limit(1))[0] : undefined;
  return link?.clientName?.trim() || lead.name?.trim() || displayPhone(lead.phoneE164);
}

/** The client's details for their own agent: contact lines and the FUB contact, never admin links. */
function agentClientLines(lead: AlertLead, fubPersonId?: string | null) {
  return [
    `Phone: ${displayPhone(lead.phoneE164)}`,
    ...(lead.email ? [`Email: ${lead.email}`] : []),
    ...(lead.timeline ? [`Timeline: ${lead.timeline}`] : []),
    ...(fubPersonId ? [`Follow Up Boss: ${fubPersonLink(fubPersonId)}`] : []),
    `Your clients and their activity: ${agentTeamLink()}`,
  ];
}

function privateLeadLines(lead: AlertLead) {
  return [
    `Phone: ${lead.phoneE164}`,
    `Instagram: ${lead.instagramHandle ? `@${lead.instagramHandle}` : "Not provided"}`,
    `Source: ${lead.sourceCode}`,
    `Name: ${lead.name || "Not provided"}`,
    `Email: ${lead.email || "Not provided"}`,
    `Timeline: ${lead.timeline || "Not provided"}`,
    `Lead ID: ${lead.id}`,
  ];
}

async function queueDealAlert(input: {
  dedupeKey: string;
  lead: AlertLead;
  kind: DealAlertKind;
  subject: string;
  content: string;
  /** The agent's own copy: sent to them alone, right away (the owners' digest setting is theirs). */
  agentEmail?: string;
}) {
  const db = await getDb();
  if (!db) return { queued: false, reason: "database_unavailable" as const };
  const settings = await getDealSettings();
  const recipients = validRecipients(input.agentEmail ? [input.agentEmail] : settings.alertRecipients);
  if (!recipients.length) return { queued: false, reason: "no_recipients" as const };
  const deliveryMode = input.agentEmail ? "immediate" : settings.alertMode;
  const scheduledFor = deliveryMode === "immediate" ? new Date() : nextHour();
  const result = await db.insert(dealAlerts).values({
    dedupeKey: input.dedupeKey,
    leadId: input.lead.id,
    kind: input.kind,
    deliveryMode,
    recipients: JSON.stringify(recipients),
    subject: input.subject,
    content: input.content,
    status: "pending",
    scheduledFor,
  }).onDuplicateKeyUpdate({ set: { status: sql`${dealAlerts.status}` } });
  const affected = Number((result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0);
  const queued = affected === 1;
  if (queued && deliveryMode === "immediate") {
    // The alert has already been durably stored. Delivery is deliberately
    // asynchronous so a verified buyer never waits on Resend or Forge.
    void dispatchPendingDealAlerts({ limit: 1 }).catch((error) => console.error("[deals alerts] immediate dispatch failed", error));
  }
  return { queued, reason: queued ? undefined : "duplicate" as const };
}

export type FirstUnlockAlertDetails = {
  /** Stored screening flags, for example "Possible Agent - TREC Name Match". */
  flags?: readonly string[];
  fubPersonId?: string | null;
  /** The agent FUB already had on the contact; the assignment was left alone. */
  alreadyAssignedTo?: string | null;
  /** From FUB's own opt-out fields or notes this system did not write. */
  previouslyOptedOut?: boolean;
  /** Why the FUB sync has not completed, when the alert goes out before FUB answered. */
  fubIssue?: string | null;
  /** FUB took the contact but a follow-up write (the assignment to the agent) failed. */
  fubWarning?: string | null;
};

/**
 * Queue exactly one immutable, auditable first-unlock alert per lead. The job
 * runner calls this after the first_unlock FUB job resolves, so the email can
 * carry the FUB link, the prior assignment and the opt-out marker in ONE email.
 */
export async function queueFirstUnlockAlert(lead: AlertLead, details: FirstUnlockAlertDetails = {}) {
  const flags = Array.from(new Set((details.flags ?? []).map((flag) => flag.trim()).filter(Boolean)));
  const agent = await alertAgent(lead);
  if (agent?.email) {
    const client = await clientLabel(lead);
    await queueDealAlert({
      dedupeKey: `first_unlock:${lead.id}:agent`,
      lead,
      kind: "agent_update",
      agentEmail: agent.email,
      subject: `Builder Deals: ${client} opened the list you sent`,
      content: [
        `${client} opened the Builder Deals list you sent and verified their number. They see every address, and you get an email when they save a home or ask for a tour.`,
        agentAssignmentLine(agent, details),
        "",
        ...agentClientLines(lead, details.fubPersonId),
      ].join("\n"),
    });
  }
  return queueDealAlert({
    dedupeKey: `first_unlock:${lead.id}`,
    lead,
    kind: "first_unlock",
    subject: agent ? `Builder Deals: ${agent.name}'s client unlocked the list` : "Builder Deals: new buyer unlocked the list",
    content: [
      agent ? `${agent.name}'s client unlocked Builder Deals through their client link. ${assignmentLine(agent, details)}` : "A buyer unlocked Builder Deals for the first time.",
      ...(details.previouslyOptedOut ? ["", "Previously opted out, do not text manually."] : []),
      "",
      ...privateLeadLines(lead),
      `Flags: ${flags.length ? flags.join(", ") : "none"}`,
      ...(details.alreadyAssignedTo ? [`FUB assignment: already assigned to ${details.alreadyAssignedTo}. The assignment was left alone and a note was added.`] : []),
      "",
      details.fubPersonId
        ? `FUB contact: ${fubPersonLink(details.fubPersonId)}`
        : `FUB contact: not synced yet${details.fubIssue ? ` (${details.fubIssue})` : ""}. The retry queue is in Admin, Builder Deals.`,
      `Turn off access (opens admin, login required, confirm button): ${adminLeadLink(lead.id)}`,
    ].join("\n"),
  });
}

/** What actually happened to the FUB owner, never a promise the sync did not keep. */
function assignmentLine(agent: AlertAgent, details: FirstUnlockAlertDetails) {
  if (details.alreadyAssignedTo) return `The FUB contact was already assigned to ${details.alreadyAssignedTo}; the assignment was left alone.`;
  if (!details.fubPersonId) return `The FUB contact is not synced yet; it will be assigned to ${agent.fubUserId ? agent.name : "Peter"}.`;
  if (!agent.fubUserId) return `${agent.name} has no Follow Up Boss user yet, so the FUB contact is assigned to Peter.`;
  if (details.fubWarning) return `Assigning the FUB contact to ${agent.name} did not go through (${details.fubWarning}); assign it in FUB.`;
  return `The FUB contact is assigned to ${agent.name}.`;
}

/** The same facts, written to the agent. */
function agentAssignmentLine(agent: AlertAgent, details: FirstUnlockAlertDetails) {
  if (details.alreadyAssignedTo) return `They were already in Follow Up Boss with ${details.alreadyAssignedTo}, so that assignment was left alone; a note names you.`;
  if (!agent.fubUserId) return "Your team profile has no Follow Up Boss user yet, so their Follow Up Boss contact is assigned to Peter for now.";
  if (!details.fubPersonId) return "Their Follow Up Boss contact is still syncing; it will be assigned to you.";
  if (details.fubWarning) return "Their Follow Up Boss contact could not be assigned to you automatically; Peter has been told and will assign it.";
  return "Their Follow Up Boss contact is assigned to you.";
}

async function alertAgent(lead: AlertLead): Promise<AlertAgent | null> {
  if (!lead.agentTeamId) return null;
  const { agentForTeamId } = await import("./dealsClientLinks");
  const agent = await agentForTeamId(lead.agentTeamId);
  // An agent who left the team is not emailed about a client they can no longer serve.
  return agent && agent.active ? { name: agent.name, email: agent.email, fubUserId: agent.fubUserId } : null;
}

/** The verify route's entry: load the lead and its live agent, then queue the once-per-link alert. */
export async function notifyClientLinkAttached(leadId: number, linkId: number) {
  const db = await getDb();
  if (!db) return { queued: false };
  const lead = (await db.select().from(dealLeads).where(eq(dealLeads.id, leadId)).limit(1))[0];
  if (!lead?.agentTeamId) return { queued: false };
  const { agentForTeamId } = await import("./dealsClientLinks");
  const agent = await agentForTeamId(lead.agentTeamId);
  if (!agent?.active) return { queued: false };
  return queueClientLinkAttachedAlert(lead, { name: agent.name, email: agent.email, fubUserId: agent.fubUserId }, linkId);
}

/**
 * The agent's copy of a client's save, tour request or question. The owners'
 * email (with the admin link) is sent by the request job; this one is the
 * agent's, once per request.
 */
export async function queueAgentRequestAlert(input: {
  lead: AlertLead;
  agent: AlertAgent;
  requestId: number;
  requestType: "tour" | "ask" | "save";
  description: string;
  when: string;
  taskCreated: boolean;
  isTest: boolean;
}) {
  if (!input.agent.email) return { queued: false, reason: "no_recipients" as const };
  const client = await clientLabel(input.lead);
  const action = { save: "saved a home", tour: "asked for a tour", ask: "asked about a home" }[input.requestType];
  const sentence = { save: `${client} saved ${input.description}.`, tour: `${client} asked to tour ${input.description}.`, ask: `${client} asked about ${input.description}.` }[input.requestType];
  const task = !input.agent.fubUserId
    ? "Your team profile has no Follow Up Boss user yet, so the Follow Up Boss task is assigned to Peter for now."
    : input.taskCreated ? "A Follow Up Boss task for this is assigned to you." : "A Follow Up Boss task for you is being created.";
  return queueDealAlert({
    dedupeKey: `request:${input.requestId}:agent`,
    lead: input.lead,
    kind: "agent_update",
    agentEmail: input.agent.email,
    subject: `${input.isTest ? "TEST: " : ""}Builder Deals: ${client} ${action}`,
    content: [
      input.isTest ? "TEST RECORD (full-pipeline test mode)." : null,
      sentence,
      input.requestType === "save" ? `Saved: ${input.when}` : `Preferred time: ${input.when}`,
      task,
      "",
      ...agentClientLines(input.lead),
    ].filter((line): line is string => line !== null).join("\n"),
  });
}

/**
 * A buyer with a live list opened an agent's client link and was attached
 * without a second code: the owners and the agent hear about it once per
 * link, through the same durable alert path as the first unlock.
 */
export async function queueClientLinkAttachedAlert(lead: AlertLead, agent: AlertAgent, linkId: number) {
  if (agent.email) {
    const client = await clientLabel({ ...lead, clientLinkId: lead.clientLinkId ?? linkId });
    await queueDealAlert({
      dedupeKey: `client_link_attached:${lead.id}:${linkId}:agent`,
      lead,
      kind: "agent_update",
      agentEmail: agent.email,
      subject: `Builder Deals: ${client} connected to the list you sent`,
      content: [
        `${client} already had a Builder Deals list and connected it to the link you sent. They now see every address, and you get an email when they save a home or ask for a tour.`,
        "They were already in Follow Up Boss, so their contact keeps its current assignment; a note on it names you.",
        "",
        ...agentClientLines(lead),
      ].join("\n"),
    });
  }
  return queueDealAlert({
    dedupeKey: `client_link_attached:${lead.id}:${linkId}`,
    lead,
    kind: "first_unlock",
    subject: `Builder Deals: ${agent.name}'s client is on their list`,
    content: [
      `${agent.name}'s client is now connected through ${agent.name}'s client link: they see the full list, and ${agent.name} hears about their saves and tour requests.`,
      `They already had a Builder Deals contact, so the FUB contact keeps its current assignment; a note on it names ${agent.name}.`,
      "",
      ...privateLeadLines(lead),
      `Turn off access (opens admin, login required, confirm button): ${adminLeadLink(lead.id)}`,
    ].join("\n"),
  });
}

/** Queue one alert only when a newly discovered profile screening flag exists (the name prompt answered later). */
export async function queueProfileFlagAlert(
  lead: AlertLead,
  newFlags: readonly string[],
) {
  const flags = Array.from(new Set(newFlags.map((flag) => flag.trim()).filter(Boolean))).sort();
  if (!flags.length) return { queued: false, reason: "no_new_flags" as const };
  return queueDealAlert({
    dedupeKey: `profile_flag:${lead.id}:${flags.join("|").toLowerCase()}`,
    lead,
    kind: "profile_flag",
    subject: "Builder Deals: buyer profile flag",
    content: [
      "A Builder Deals buyer profile needs review.",
      "",
      ...privateLeadLines(lead),
      "",
      `New profile flag${flags.length === 1 ? "" : "s"}:`,
      ...flags.map((flag) => `- ${flag}`),
      "",
      "This alert does not revoke buyer access. The flag was added as a FUB tag.",
      `Turn off access (opens admin, login required, confirm button): ${adminLeadLink(lead.id)}`,
    ].join("\n"),
  });
}

function canClaim(alert: AlertRow, now: Date) {
  return alert.status === "pending" || alert.status === "failed" || (alert.status === "sending" && alert.updatedAt < new Date(now.getTime() - STALE_SEND_MS));
}

async function claimAlert(id: number, status: AlertRow["status"]) {
  const db = await getDb();
  if (!db) return false;
  const now = new Date();
  const allowed = status === "sending"
    ? and(eq(dealAlerts.status, "sending"), lt(dealAlerts.updatedAt, new Date(now.getTime() - STALE_SEND_MS)))
    : or(eq(dealAlerts.status, "pending"), eq(dealAlerts.status, "failed"));
  const result = await db.update(dealAlerts).set({ status: "sending", attempts: sql`${dealAlerts.attempts} + 1`, lastError: null }).where(and(eq(dealAlerts.id, id), allowed));
  return Number((result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0) === 1;
}

async function completeAlerts(alerts: AlertRow[], result: Awaited<ReturnType<typeof sendBuilderDealsEmail>>) {
  const db = await getDb();
  if (!db) return;
  const now = new Date();
  for (const alert of alerts) {
    await db.update(dealAlerts).set({
      status: result.ok ? "sent" : "failed",
      deliveryLog: result.deliveryLog,
      lastError: result.error ?? null,
      deliveredAt: result.ok ? now : null,
    }).where(eq(dealAlerts.id, alert.id));
  }
}

export function digestContent(alerts: Array<Pick<AlertRow, "subject" | "content">>) {
  return [
    `Builder Deals hourly alert digest: ${alerts.length} alert${alerts.length === 1 ? "" : "s"}.`,
    "",
    ...alerts.flatMap((alert, index) => [
      `${index + 1}. ${alert.subject}`,
      alert.content,
      "",
    ]),
    "Review the protected records in Admin, Builder Deals.",
  ].join("\n");
}

/**
 * Delivers due durable alerts. Immediate alerts retain their own formatted
 * subject; hourly-mode rows sharing the same recipient snapshot form one digest.
 * Failed delivery stays durable and can be retried from the admin panel.
 */
export async function dispatchPendingDealAlerts(options: { limit?: number; includeFailed?: boolean } = {}) {
  const db = await getDb();
  if (!db) return { attempted: 0, sent: 0, failed: 0, skipped: 0 };
  const now = new Date();
  const candidates = await db.select().from(dealAlerts).where(and(
    lte(dealAlerts.scheduledFor, now),
    options.includeFailed
      ? or(eq(dealAlerts.status, "pending"), eq(dealAlerts.status, "failed"), and(eq(dealAlerts.status, "sending"), lt(dealAlerts.updatedAt, new Date(now.getTime() - STALE_SEND_MS))))
      : or(eq(dealAlerts.status, "pending"), and(eq(dealAlerts.status, "sending"), lt(dealAlerts.updatedAt, new Date(now.getTime() - STALE_SEND_MS)))),
  )).orderBy(dealAlerts.scheduledFor, dealAlerts.id).limit(Math.max(1, Math.min(options.limit ?? 50, 100)));

  const claimed: AlertRow[] = [];
  for (const candidate of candidates) if (canClaim(candidate, now) && await claimAlert(candidate.id, candidate.status)) claimed.push(candidate);
  if (!claimed.length) return { attempted: 0, sent: 0, failed: 0, skipped: candidates.length };

  let sent = 0;
  let failed = 0;
  const immediate = claimed.filter((alert) => alert.deliveryMode === "immediate");
  for (const alert of immediate) {
    const result = await sendBuilderDealsEmail({ alertId: alert.id, category: alert.kind, recipients: parseRecipients(alert.recipients), subject: alert.subject, content: alert.content });
    await completeAlerts([alert], result);
    if (result.ok) sent += 1; else failed += 1;
  }

  const digests = new Map<string, AlertRow[]>();
  for (const alert of claimed.filter((candidate) => candidate.deliveryMode === "hourly_digest")) {
    const key = alert.recipients;
    digests.set(key, [...(digests.get(key) ?? []), alert]);
  }
  for (const [recipientJson, alerts] of Array.from(digests.entries())) {
    const result = await sendBuilderDealsEmail({
      alertId: alerts.length === 1 ? alerts[0].id : null,
      category: "hourly_digest",
      recipients: parseRecipients(recipientJson),
      subject: `Builder Deals hourly alert digest (${alerts.length})`,
      content: digestContent(alerts),
    });
    await completeAlerts(alerts, result);
    if (result.ok) sent += alerts.length; else failed += alerts.length;
  }
  return { attempted: claimed.length, sent, failed, skipped: candidates.length - claimed.length };
}
