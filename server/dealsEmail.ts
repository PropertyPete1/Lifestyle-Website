import { dealEmailLogs } from "../drizzle/schema";
import { notifyOwner } from "./_core/notification";
import { getDb } from "./db";

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

async function ownerOnlyFallback(normalized: BuilderDealsEmailInput, recipients: string[], configurationError?: string): Promise<BuilderDealsEmailResult> {
  let accepted = false;
  try {
    accepted = await notifyOwner({
      title: normalized.subject,
      content: `To: ${recipients.join(", ")} (owner-only fallback: these recipients were NOT emailed)\n\n${normalized.content}`,
    });
  } catch {
    accepted = false;
  }
  const error = [configurationError, accepted ? null : "Owner notification was not accepted"].filter(Boolean).join(" ");
  const result: BuilderDealsEmailResult = {
    ok: accepted,
    status: "owner_only_fallback",
    deliveryLog: OWNER_ONLY_DELIVERY_LOG,
    ...(error ? { error } : {}),
  };
  await persistEmailLog(normalized, result, "owner_notification");
  return result;
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
  const normalized = { ...input, recipients };
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
