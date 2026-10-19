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
 * A rate figure as the cards print it, "5.737%". Builder pages, older stored
 * rows and admins write "5.737% APR", "4.25% interest rate" or a bare "5.737";
 * the card adds its own label, so the figure itself must not carry one.
 */
export function normalizeRateFigure(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  let figure = value.replace(/\s+/g, " ").trim();
  figure = figure.replace(/^(?:annual percentage rate|interest rate|apr|rate)\s*[:\-]?\s*/i, "");
  figure = figure.replace(/\s*(?:annual percentage rate|interest rate|apr|rate|fixed)\s*[.;:,]*$/i, "");
  figure = figure.replace(/(\d)\s+%/g, "$1%").replace(/[.;:,]+$/, "").trim();
  if (!figure) return null;
  return /^\d+(?:\.\d+)?$/.test(figure) ? `${figure}%` : figure;
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

/** Categories contain private values supplied by the server, never builder constants. */
export const DEAL_SCRUB_CATEGORIES = ["builder", "lender", "community", "plan", "street", "other"] as const;
export type DealScrubCategory = (typeof DEAL_SCRUB_CATEGORIES)[number];
export type DealScrubConfig = Record<DealScrubCategory, string[]>;
export function emptyDealScrubConfig(): DealScrubConfig {
  return { builder: [], lender: [], community: [], plan: [], street: [], other: [] };
}
export function parseDealScrubConfig(value: unknown): DealScrubConfig {
  const result = emptyDealScrubConfig();
  if (Array.isArray(value)) value = { other: value }; // Legacy flat arrays remain supported.
  if (!value || typeof value !== "object") return result;
  for (const category of DEAL_SCRUB_CATEGORIES) {
    const terms = (value as Record<string, unknown>)[category];
    if (Array.isArray(terms)) result[category] = Array.from(new Set(terms.filter((term): term is string => typeof term === "string").map((term) => term.trim()).filter(Boolean)));
  }
  return result;
}
export function dealScrubTerms(value: DealScrubConfig | readonly string[]): string[] {
  const config = parseDealScrubConfig(value);
  return Array.from(new Set(DEAL_SCRUB_CATEGORIES.flatMap((category) => config[category])));
}
export type DealScrubConfigInput = Partial<Record<DealScrubCategory, readonly string[]>> | readonly string[];
/** Union per category; a term already known under one category is not duplicated into another. */
export function mergeDealScrubConfig(...values: Array<DealScrubConfigInput | null | undefined>): DealScrubConfig {
  const result = emptyDealScrubConfig();
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const config = parseDealScrubConfig(value);
    for (const category of DEAL_SCRUB_CATEGORIES) {
      for (const term of config[category]) {
        const key = term.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result[category].push(term);
      }
    }
  }
  return result;
}
/** Public storage/output scrubber. It purposely performs no guessing. */
export function scrubPrivateNames(
  input: string,
  names: readonly string[] | DealScrubConfig,
  options: { planField?: boolean } = {}
): string {
  let out = input;
  const config = parseDealScrubConfig(names);
  const replacements: Record<DealScrubCategory, string> = { builder: "the builder", lender: "the builder's lender", community: "this community", plan: "this plan", street: "this street", other: "this community" };
  const entries = DEAL_SCRUB_CATEGORIES.flatMap((category) => config[category].map((name) => ({ category, name })));
  // Longest first prevents a shorter brand alias from leaving private residue.
  for (const { category, name } of entries.sort((a, b) => b.name.length - a.name.length)) {
    if (name.length < 4 && category !== "builder" && category !== "lender") continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const boundary = `(?<![a-z0-9])${escaped}(?![a-z0-9])`;
    // "the Magnolia", "Magnolia plan" and "the Magnolia plan" each become one "this plan".
    const pattern = category === "plan" && !options.planField
      ? new RegExp(`(?<![a-z0-9])(?:the\\s+${escaped}(?:\\s+plans?)?(?![a-z0-9])|${escaped}\\s+plans?(?![a-z0-9]))`, "gi")
      : new RegExp(boundary, "gi");
    out = out.replace(pattern, replacements[category]);
  }
  return out;
}

/**
 * Residue check. Plan names are common words (Magnolia, Cypress), so outside a
 * plan field a bare plan word is not residue; only "the {plan}" or "{plan} plan"
 * is, mirroring how scrubPrivateNames replaces them.
 */
export function hasPrivateTerm(input: string, names: readonly string[] | DealScrubConfig, options: { planField?: boolean } = {}): boolean {
  const normalized = normalizedText(input);
  const config = parseDealScrubConfig(names);
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return DEAL_SCRUB_CATEGORIES.some((category) => config[category].some((raw) => {
    const value = normalizedText(raw);
    if (!value) return false;
    const escaped = escape(value);
    if (category === "plan" && !options.planField) {
      return new RegExp(`(?<![a-z0-9])(?:the\\s+${escaped}(?![a-z0-9])|${escaped}\\s+plan(?![a-z0-9]))`, "i").test(normalized);
    }
    return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i").test(normalized);
  }));
}

/** One community: available QMIs win; plans are the zero-QMI fallback only. */
export function selectDealCatalogHomes<T extends { kind: string; status?: string }>(homes: readonly T[]): T[] {
  const available = homes.filter((home) => !home.status || home.status === "available");
  const qmis = available.filter((home) => home.kind === "quick_move_in");
  return qmis.length ? qmis : available.filter((home) => home.kind === "to_be_built");
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
