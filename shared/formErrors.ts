/**
 * FORM ERROR HANDLING — shared, testable helpers.
 *
 * Why this exists: tRPC surfaces a failed zod validation as `err.message`, and
 * that message is the RAW JSON array of issues. Piping it straight into a toast
 * showed live visitors something like:
 *
 *   [ { "code": "custom", "path": ["phone"], "message": "A valid phone..." } ]
 *
 * These helpers turn that into one human sentence, and give the forms a shared
 * definition of "is this phone number usable" so the common mistakes are caught
 * before a request is ever sent.
 */

/** Brokerage phone, offered as the fallback path whenever a submit fails. */
export const SUPPORT_PHONE = "(210) 981-3830";

/** Shown when we genuinely don't know what went wrong (network, 5xx, timeout). */
export const GENERIC_SUBMIT_ERROR = `Something went wrong — please try again or call us at ${SUPPORT_PHONE}.`;

/** Shown when the request timed out or the device is offline. */
export const NETWORK_SUBMIT_ERROR = `We couldn't reach our server. Check your connection and try again, or call us at ${SUPPORT_PHONE}.`;

/**
 * Turn a thrown submit error into one sentence a visitor can act on.
 *
 * - A zod issue array (tRPC BAD_REQUEST) → the first issue's own message, which
 *   is already written for humans ("A valid phone number is required.").
 * - Anything network-shaped → the offline/timeout wording.
 * - Everything else → the generic message, which always includes the phone.
 */
export function humanizeSubmitError(raw: unknown): string {
  const message = typeof raw === "string" ? raw : (raw as { message?: string })?.message;
  if (!message || typeof message !== "string") return GENERIC_SUBMIT_ERROR;

  // tRPC serialises zod failures as a JSON array of issues.
  const trimmed = message.trim();
  if (trimmed.startsWith("[")) {
    try {
      const issues = JSON.parse(trimmed) as { message?: string }[];
      const first = Array.isArray(issues)
        ? issues.find((i) => typeof i?.message === "string" && i.message.trim())
        : undefined;
      if (first?.message) return first.message;
    } catch {
      /* not JSON after all — fall through */
    }
    return GENERIC_SUBMIT_ERROR;
  }

  // Network / abort / timeout shapes, from fetch or AbortSignal.timeout().
  if (/failed to fetch|networkerror|load failed|timed out|timeout|aborted|abort/i.test(message)) {
    return NETWORK_SUBMIT_ERROR;
  }

  // A message that still looks like machine output should not reach a visitor.
  // NOTE: match TRPC unanchored — "TRPCClientError" has no word boundary after
  // "TRPC", so a \bTRPC\b guard let raw client errors through to the UI.
  if (/[{}]|"code"|TRPC|\bError:/i.test(message)) return GENERIC_SUBMIT_ERROR;

  return message;
}

/**
 * Phone validity, matching the server rule (>= 7 digits after stripping
 * formatting) so the client can catch it first and point at the field instead
 * of round-tripping to a server rejection.
 */
export function isUsablePhone(phone: string | undefined | null): boolean {
  return (phone ?? "").replace(/\D/g, "").length >= 7;
}

/** Inline message shown beneath the phone field. */
export const PHONE_HINT = "Please enter a valid phone number so we can reach you.";

/** Minimal email sanity check — the server is authoritative. */
export function isUsableEmail(email: string | undefined | null): boolean {
  const v = (email ?? "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export const EMAIL_HINT = "Please enter a valid email address.";
