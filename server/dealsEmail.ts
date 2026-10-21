import { dealEmailLogs } from "../drizzle/schema";
import { notifyOwner } from "./_core/notification";
import { getDb } from "./db";
import { OWNER_NOTIFICATION_CONTENT_MAX, capSubject, emailSize, partSubject, splitEmailContent } from "./dealsEmailLimits";

export type BuilderDealsEmailInput = {
  alertId?: number | null;
  category: string;
  recipients: string[];
  subject: string;
  content: string;
};

export type BuilderDealsEmailResult = {
  ok: boolean;
  status: "sent" | "failed" | "owner_only_fallback";
  deliveryLog: string;
  error?: string;
};

const RESEND_ENDPOINT = "https://api.resend.com/emails";
/** The exact audit phrase for a delivery that reached only the project owner notification, not the recipients. */
export const OWNER_ONLY_DELIVERY_LOG = "owner only: project-owner notification, recipients not emailed";
/** The audit phrase for an owner notification the service did not accept: nothing was delivered, so it is logged as failed. */
export const OWNER_ONLY_REJECTED_LOG = "owner only: project-owner notification NOT accepted, nothing delivered";
export const RESEND_FROM_MISSING_ERROR = "RESEND_FROM_EMAIL is not set. Resend needs a verified sender on the lifestyledesignrealty.com domain (for example deals@lifestyledesignrealty.com) before any Builder Deals email can reach peter@ and steven@; the onboarding@resend.dev sender only delivers to the Resend account owner.";

function normalizedRecipients(recipients: readonly string[]) {
  return Array.from(new Set(recipients.map((value) => value.trim().toLowerCase()).filter(Boolean)));
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 1_000) : "Email delivery failed";
}

/** Resend is configured only when both the key and a verified sender exist. */
export function resendConfiguration() {
  const apiKey = process.env.RESEND_API_KEY?.trim() || null;
  const from = process.env.RESEND_FROM_EMAIL?.trim() || null;
  return { apiKey, from, ready: Boolean(apiKey && from), fromMissing: Boolean(apiKey && !from) };
}

async function persistEmailLog(input: BuilderDealsEmailInput, result: BuilderDealsEmailResult, provider: "resend" | "owner_notification") {
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(dealEmailLogs).values({
      alertId: input.alertId ?? null,
      category: input.category.slice(0, 60),
      recipients: JSON.stringify(normalizedRecipients(input.recipients)),
      subject: input.subject.slice(0, 255),
      provider,
      deliveryStatus: result.status,
      deliveryLog: result.deliveryLog,
      lastError: result.error ?? null,
      deliveredAt: result.status === "failed" ? null : new Date(),
    });
  } catch (error) {
    // A notification must never fail a buyer flow merely because its audit write
    // could not be recorded. The caller still receives the provider outcome.
    console.error("[deals email] could not persist delivery log", error);
  }
}

/**
 * The owner notification rejects content over 20,000 characters (and a title over 1,200), so a longer message is sent
 * as numbered parts ("Subject (2/3)"), every part logged on its own row. A part the service did not accept is logged as
 * "failed" (the health check's email-failure count reads that status), and the message is ok only when every part went.
 */
async function ownerOnlyFallback(normalized: BuilderDealsEmailInput, recipients: string[], configurationError?: string): Promise<BuilderDealsEmailResult> {
  const prefix = `To: ${recipients.join(", ")} (owner-only fallback: these recipients were NOT emailed)\n\n`;
  const room = Math.max(2_000, OWNER_NOTIFICATION_CONTENT_MAX - emailSize(prefix) - 500);
  const parts = emailSize(normalized.content) <= room ? [normalized.content] : splitEmailContent(normalized.content, room);
  const rejected: number[] = [];
  for (let index = 0; index < parts.length; index++) {
    const title = parts.length > 1 ? partSubject(normalized.subject, index + 1, parts.length) : normalized.subject;
    let accepted = false;
    try {
      accepted = await notifyOwner({ title, content: `${prefix}${parts[index]}` });
    } catch {
      accepted = false;
    }
    if (!accepted) rejected.push(index + 1);
    const error = [configurationError, accepted ? null : "Owner notification was not accepted"].filter(Boolean).join(" ");
    await persistEmailLog({ ...normalized, subject: title }, {
      ok: accepted,
      status: accepted ? "owner_only_fallback" : "failed",
      deliveryLog: accepted ? OWNER_ONLY_DELIVERY_LOG : OWNER_ONLY_REJECTED_LOG,
      ...(error ? { error } : {}),
    }, "owner_notification");
  }
  const notAccepted = rejected.length ? (parts.length > 1 ? `Owner notification was not accepted for part${rejected.length === 1 ? "" : "s"} ${rejected.join(", ")} of ${parts.length}` : "Owner notification was not accepted") : null;
  const error = [configurationError, notAccepted].filter(Boolean).join(" ");
  return {
    ok: rejected.length === 0,
    status: "owner_only_fallback",
    deliveryLog: OWNER_ONLY_DELIVERY_LOG,
    ...(error ? { error } : {}),
  };
}

/**
 * The only Builder Deals email transport. With a Resend key AND a verified
 * sender it sends one transactional message addressed to every saved recipient.
 * Without the key it deliberately uses the established owner notification
 * service and records the exact "owner only" phrase for operational review. A
 * key without RESEND_FROM_EMAIL is a misconfiguration: it is logged loudly,
 * recorded on the audit row, and the owner notification still goes out.
 */
export async function sendBuilderDealsEmail(input: BuilderDealsEmailInput): Promise<BuilderDealsEmailResult> {
  const recipients = normalizedRecipients(input.recipients);
  // Every path (digest, holds, health, Monday report, alerts) gets the same subject cap; a body too big for the owner
  // notification is split by the fallback below.
  const normalized = { ...input, recipients, subject: capSubject(input.subject) };
  const resend = resendConfiguration();

  if (!resend.apiKey) return ownerOnlyFallback(normalized, recipients);
  if (!resend.from) {
    console.error(`[deals email] ${RESEND_FROM_MISSING_ERROR}`);
    return ownerOnlyFallback(normalized, recipients, RESEND_FROM_MISSING_ERROR);
  }

  if (!recipients.length) {
    const result: BuilderDealsEmailResult = {
      ok: false,
      status: "failed",
      deliveryLog: "resend failed",
      error: "No Builder Deals email recipients are configured",
    };
    await persistEmailLog(normalized, result, "resend");
    return result;
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resend.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: resend.from,
        to: recipients,
        subject: normalized.subject,
        text: normalized.content,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 1_000);
      const result: BuilderDealsEmailResult = {
        ok: false,
        status: "failed",
        deliveryLog: "resend failed",
        error: `Resend ${response.status}${detail ? `: ${detail}` : ""}`,
      };
      await persistEmailLog(normalized, result, "resend");
      return result;
    }
    const result: BuilderDealsEmailResult = { ok: true, status: "sent", deliveryLog: "resend sent" };
    await persistEmailLog(normalized, result, "resend");
    return result;
  } catch (error) {
    const result: BuilderDealsEmailResult = {
      ok: false,
      status: "failed",
      deliveryLog: "resend failed",
      error: safeError(error),
    };
    await persistEmailLog(normalized, result, "resend");
    return result;
  }
}

/** Safe operational status only; it never exposes a credential. */
export function builderDealsEmailStatus(recipients: readonly string[]) {
  const resend = resendConfiguration();
  return {
    provider: resend.ready ? "resend" as const : "owner_notification_fallback" as const,
    fromConfigured: Boolean(resend.from),
    misconfiguration: resend.fromMissing ? RESEND_FROM_MISSING_ERROR : null,
    recipients: normalizedRecipients(recipients),
  };
}
