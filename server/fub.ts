/**
 * Follow Up Boss integration.
 * Server-side only — uses FUB_API_KEY env var; NEVER expose client-side.
 * Graceful fallback: on failure, the lead remains in local DB (fubStatus =
 * "failed") and the owner is notified.
 */
import type { IntentLevel } from "../shared/site";

const FUB_API_URL = "https://api.followupboss.com/v1";

export interface FubLeadInput {
  name: string;
  email: string;
  phone?: string;
  message?: string;
  sourceTag: string;
  intent: IntentLevel;
  answers?: Record<string, unknown>;
}

export interface FubResult {
  ok: boolean;
  fubId?: string;
  error?: string;
}

/** Compute intent level from qualifying answers (Hot / Warm / Cold). */
export function computeIntent(answers: Record<string, unknown> | undefined): IntentLevel {
  if (!answers) return "Unknown";
  const timeline = String(answers.timeline ?? "").toLowerCase();
  const preApproved = String(answers.preApproved ?? "").toLowerCase();
  const licenseStatus = String(answers.licenseStatus ?? "").toLowerCase();

  // Recruiting logic: active license + full-time + closed transactions = Hot
  if (licenseStatus) {
    if (licenseStatus.includes("licensed active")) {
      const fullTime = String(answers.fullTime ?? answers.fullTimeAgent ?? "").toLowerCase();
      const closed = Number(answers.transactionsClosed ?? NaN);
      // If screening answers present, require full-time + at least one closed deal for Hot
      if ("fullTime" in answers || "fullTimeAgent" in answers || "transactionsClosed" in answers) {
        return fullTime.startsWith("yes") && closed > 0 ? "Hot" : "Warm";
      }
      return "Hot";
    }
    if (licenseStatus.includes("licensed inactive") || licenseStatus.includes("in progress")) return "Warm";
    return "Cold";
  }

  if (timeline.includes("asap")) {
    if (!("preApproved" in answers)) return "Hot"; // seller ASAP
    return preApproved.startsWith("yes") ? "Hot" : "Warm";
  }
  if (timeline.includes("3-6") || timeline.includes("3–6")) return "Warm";
  if (timeline) return "Cold";
  return "Unknown";
}

/** Build the full FUB tag: e.g. "Website - Valuation - Hot" */
export function buildTag(sourceTag: string, intent: IntentLevel): string[] {
  const tags = [sourceTag];
  if (intent !== "Unknown") tags.push(`${sourceTag} - ${intent}`);
  return tags;
}

function answersToNote(answers?: Record<string, unknown>, message?: string): string {
  const parts: string[] = [];
  if (message) parts.push(`Message: ${message}`);
  if (answers) {
    for (const [k, v] of Object.entries(answers)) {
      if (v !== undefined && v !== null && String(v).length > 0) {
        parts.push(`${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
      }
    }
  }
  return parts.join("\n");
}

/** Send a lead to Follow Up Boss via the events endpoint. */
export async function sendToFub(input: FubLeadInput): Promise<FubResult> {
  const apiKey = process.env.FUB_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "FUB_API_KEY not configured" };
  }

  const [firstName, ...rest] = input.name.trim().split(/\s+/);
  const lastName = rest.join(" ");

  const body = {
    source: "lifestyledesignrealty.com",
    system: "lifestyle design realty",
    type: "General Inquiry",
    message: answersToNote(input.answers, input.message) || undefined,
    person: {
      firstName,
      lastName: lastName || undefined,
      emails: [{ value: input.email }],
      phones: input.phone ? [{ value: input.phone }] : undefined,
      tags: buildTag(input.sourceTag, input.intent),
    },
  };

  try {
    const res = await fetch(`${FUB_API_URL}/events`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
        // FUB's CloudFront edge rejects requests without a User-Agent (403)
        "User-Agent": "LifestyleDesignRealty-Website/1.0",
        "X-System": "lifestyle-design-realty",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `FUB ${res.status}: ${text.slice(0, 300)}` };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: number | string };
    return { ok: true, fubId: data?.id ? String(data.id) : undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown FUB error" };
  }
}
