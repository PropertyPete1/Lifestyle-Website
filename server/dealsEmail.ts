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
const DEFAULT_FROM = "Lifestyle Design Realty <onboarding@resend.dev>";

function normalizedRecipients(recipients: readonly string[]) {
  return Array.from(new Set(recipients.map((value) => value.trim().toLowerCase()).filter(Boolean)));
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 1_000) : "Email delivery failed";
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
 * The only Builder Deals email transport. When a Resend key is configured it
 * sends one transactional message addressed to every saved recipient. Without
 * that key it deliberately uses the established owner notification service and
 * records the exact fallback phrase required for operational review.
 */
export async function sendBuilderDealsEmail(input: BuilderDealsEmailInput): Promise<BuilderDealsEmailResult> {
  const recipients = normalizedRecipients(input.recipients);
  const normalized = { ...input, recipients };
  const resendKey = process.env.RESEND_API_KEY?.trim();

  if (!resendKey) {
    let accepted = false;
    try {
      accepted = await notifyOwner({
        title: normalized.subject,
        content: `To: ${recipients.join(", ")}\n\n${normalized.content}`,
      });
    } catch {
      accepted = false;
    }
    const result: BuilderDealsEmailResult = {
      ok: accepted,
      status: "owner_only_fallback",
      deliveryLog: "owner-only fallback",
      ...(accepted ? {} : { error: "Owner notification was not accepted" }),
    };
    await persistEmailLog(normalized, result, "owner_notification");
    return result;
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
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_FROM,
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
  return {
    provider: process.env.RESEND_API_KEY?.trim() ? "resend" as const : "owner_notification_fallback" as const,
    recipients: normalizedRecipients(recipients),
  };
}
