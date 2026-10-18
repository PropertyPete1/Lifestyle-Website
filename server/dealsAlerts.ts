import { and, eq, lt, lte, or, sql } from "drizzle-orm";
import { dealAlerts, dealLeads } from "../drizzle/schema";
import { getDb } from "./db";
import { sendBuilderDealsEmail } from "./dealsEmail";
import { getDealSettings } from "./dealsService";

export type DealAlertKind = "first_unlock" | "profile_flag";
type AlertRow = typeof dealAlerts.$inferSelect;

const STALE_SEND_MS = 15 * 60_000;

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

function privateLeadLines(lead: Pick<typeof dealLeads.$inferSelect, "id" | "name" | "phoneE164" | "email" | "instagramHandle" | "sourceCode" | "timeline">) {
  return [
    `Lead ID: ${lead.id}`,
    `Name: ${lead.name || "Not provided"}`,
    `Phone: ${lead.phoneE164}`,
    `Email: ${lead.email || "Not provided"}`,
    `Instagram: ${lead.instagramHandle ? `@${lead.instagramHandle}` : "Not provided"}`,
    `Source: ${lead.sourceCode}`,
    `Timeline: ${lead.timeline || "Not provided"}`,
  ];
}

async function queueDealAlert(input: {
  dedupeKey: string;
  lead: Pick<typeof dealLeads.$inferSelect, "id" | "name" | "phoneE164" | "email" | "instagramHandle" | "sourceCode" | "timeline">;
  kind: DealAlertKind;
  subject: string;
  content: string;
}) {
  const db = await getDb();
  if (!db) return { queued: false, reason: "database_unavailable" as const };
  const settings = await getDealSettings();
  const recipients = validRecipients(settings.alertRecipients);
  const deliveryMode = settings.alertMode;
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

/** Queue exactly one immutable, auditable first-unlock alert per lead. */
export async function queueFirstUnlockAlert(lead: Pick<typeof dealLeads.$inferSelect, "id" | "name" | "phoneE164" | "email" | "instagramHandle" | "sourceCode" | "timeline">) {
  return queueDealAlert({
    dedupeKey: `first_unlock:${lead.id}`,
    lead,
    kind: "first_unlock",
    subject: "Builder Deals — first buyer unlock",
    content: [
      "A buyer unlocked Builder Deals for the first time.",
      "",
      ...privateLeadLines(lead),
      "",
      "Review the protected record in Admin → Builder Deals.",
    ].join("\n"),
  });
}

/** Queue one alert only when a newly discovered profile screening flag exists. */
export async function queueProfileFlagAlert(
  lead: Pick<typeof dealLeads.$inferSelect, "id" | "name" | "phoneE164" | "email" | "instagramHandle" | "sourceCode" | "timeline">,
  newFlags: readonly string[],
) {
  const flags = Array.from(new Set(newFlags.map((flag) => flag.trim()).filter(Boolean))).sort();
  if (!flags.length) return { queued: false, reason: "no_new_flags" as const };
  return queueDealAlert({
    dedupeKey: `profile_flag:${lead.id}:${flags.join("|").toLowerCase()}`,
    lead,
    kind: "profile_flag",
    subject: "Builder Deals — buyer profile flag",
    content: [
      "A Builder Deals buyer profile needs review.",
      "",
      ...privateLeadLines(lead),
      "",
      `New profile flag${flags.length === 1 ? "" : "s"}:`,
      ...flags.map((flag) => `- ${flag}`),
      "",
      "This alert does not revoke buyer access. Review it in Admin → Builder Deals.",
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

function digestContent(alerts: AlertRow[]) {
  return [
    `Builder Deals hourly alert digest — ${alerts.length} alert${alerts.length === 1 ? "" : "s"}.`,
    "",
    ...alerts.flatMap((alert, index) => [
      `${index + 1}. ${alert.subject}`,
      alert.content,
      "",
    ]),
    "Review the protected records in Admin → Builder Deals.",
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
