/**
 * Oct 30, 2026 (Peter): "Get first dibs on new deals". Shared by the card (what the visitor reads) and the server
 * (what is stored as their consent), so the stored wording is always the wording they saw.
 */
export const FIRST_DIBS_CONSENT = "Pick an area and we'll email you new homes and price drops there as they come up. Unsubscribe anytime.";

/** The longest address the server keeps (RFC 5321 path limit). */
export const FIRST_DIBS_EMAIL_MAX = 254;

/** A lowercased, trimmed email address, or null when it is not one. */
export function normalizeFirstDibsEmail(value: string | null | undefined): string | null {
  const email = (value ?? "").trim().toLowerCase();
  if (!email || email.length > FIRST_DIBS_EMAIL_MAX) return null;
  return /^[^\s@<>()",;:]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(email) ? email : null;
}
