import { parsePhoneNumberFromString } from "libphonenumber-js";

/** Text and constants are centralized so UI, server validation, and tests agree. */
export const DEALS_CONSENT_TEXT =
  "By tapping Continue, you agree that Lifestyle Design Realty may call and text you about new-build homes at the number you entered, including automated texts. Consent is not a condition of purchase. Msg and data rates may apply. Msg frequency varies. Reply STOP to opt out, HELP for help.";

/** Buyer SMS contact copy is rendered from the protected admin setting. */
export const DEALS_BLOCKED_SUFFIX = "Made a mistake? Contact our team by text.";

export const DEALS_COOKIE = {
  probe: "ldr_deals_probe",
  device: "ldr_deals_device",
  pending: "ldr_deals_pending",
  session: "ldr_deals_session",
} as const;

export const DEALS_PRIVATE_FIELDS = [
  "builder",
  "privateName",
  "privateAddress",
  "privatePlanName",
  "sourceUrl",
  "sourceKey",
  "homeId",
  "communityId",
  "salesPhone",
] as const;

export function sanitizeInstagramHandle(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.trim().replace(/^@+/, "");
  if (!cleaned || /[{}]/.test(cleaned) || /^(username|\{\{username\}\})$/i.test(cleaned)) return null;
  const allowed = cleaned.replace(/[^A-Za-z0-9._]/g, "").slice(0, 30);
  return allowed || null;
}

export function sanitizeSourceCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const allowed = value.trim().replace(/[^A-Za-z0-9-]/g, "").slice(0, 40);
  return allowed || null;
}

export function normalizeUsPhone(
  raw: string,
  options: { allowCanada?: boolean } = {}
): { ok: true; e164: string; display: string } | { ok: false; reason: "empty" | "outside_us" | "invalid" } {
  const value = raw.trim();
  if (!value) return { ok: false, reason: "empty" };
  const parsed = parsePhoneNumberFromString(value, "US");
  if (!parsed || !parsed.isValid()) return { ok: false, reason: "invalid" };
  if (parsed.country !== "US" && !(options.allowCanada && parsed.country === "CA")) {
    return { ok: false, reason: "outside_us" };
  }
  // North American Caribbean numbers share +1 but are not accepted by this gate.
  if (parsed.country !== "US" && parsed.country !== "CA") return { ok: false, reason: "outside_us" };
  return { ok: true, e164: parsed.number, display: parsed.formatNational() };
}

export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return `${e164.slice(0, Math.max(0, e164.length - 4))}••••`;
}

export function normalizedText(input: string): string {
  return input
    .toLowerCase()
    // Presentation punctuation at a token boundary must not create a distinct
    // incentive/source identity. Decimal points followed by digits remain.
    .replace(/[.,;:!?]+(?=\s|$)/g, " ")
    .replace(/[^a-z0-9%+.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Stable private identity input for a builder record. Tracking parameters,
 * fragments, host case, and an incidental trailing slash must not create a
 * second listing row. Invalid values stay distinguishable rather than being
 * silently treated as a URL.
 */
export function normalizedDealSourceKey(input: string): string {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return `invalid:${normalizedText(trimmed)}`;
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    url.username = "";
    url.password = "";
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return `invalid:${normalizedText(trimmed)}`;
  }
}

/** Public storage/output scrubber. It purposely performs no guessing. */
export function scrubPrivateNames(
  input: string,
  names: string[],
  options: { planField?: boolean } = {}
): string {
  let out = input;
  for (const raw of names) {
    const name = raw.trim();
    if (name.length < 4) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const planPattern = options.planField
      ? new RegExp(`\\b${escaped}\\b`, "gi")
      : new RegExp(`\\b(?:the\\s+)?${escaped}(?:\\s+plan)?\\b`, "gi");
    out = out.replace(planPattern, options.planField ? "this plan" : "this community");
  }
  return out;
}

export function hasPrivateTerm(input: string, names: string[]): boolean {
  const normalized = normalizedText(input);
  return names.some((raw) => {
    const value = normalizedText(raw);
    return value.length >= 4 && normalized.includes(value);
  });
}

export function clientIpKey(ip: string): string {
  const value = ip.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/^::ffff:/, "");
  if (value.includes(":")) {
    const [left, right = ""] = value.split("::", 2);
    const leftParts = left ? left.split(":").filter(Boolean) : [];
    const rightParts = right ? right.split(":").filter(Boolean) : [];
    const expanded = [...leftParts, ...Array(Math.max(0, 8 - leftParts.length - rightParts.length)).fill("0"), ...rightParts]
      .map((part) => part.padStart(4, "0"));
    return expanded.slice(0, 4).join(":") + "::/64";
  }
  return value;
}

export function isCrawler(userAgent: string | undefined): boolean {
  return /bot|crawler|spider|facebookexternalhit|slurp|bingpreview/i.test(userAgent ?? "");
}

export function isInAppBrowser(userAgent: string | undefined): boolean {
  const ua = userAgent ?? "";
  return /Instagram|FBAN|FBAV|TikTok|\bwv\b/i.test(ua) || (/iPhone|iPad/i.test(ua) && !/Safari/i.test(ua));
}

export function displayForLead(input: { name?: string | null; instagramHandle?: string | null; phoneE164: string }): string {
  if (input.name?.trim()) return input.name.trim();
  if (input.instagramHandle) return `@${input.instagramHandle}`;
  return `••••${input.phoneE164.replace(/\D/g, "").slice(-4)}`;
}
