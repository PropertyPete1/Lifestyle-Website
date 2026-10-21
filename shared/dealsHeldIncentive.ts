/**
 * What a held builder incentive does while it waits (owner's decision, 2026-10-21):
 * - a text held only because the parser found deadline wording without a date it could read as a date
 *   (missing_contract_deadline / missing_closing_deadline) publishes by itself, as if an admin had accepted it with
 *   "no deadline in the text", unless the text carries a date-like phrase the parser could not read, or a manual
 *   override is live. It then follows the undated lapse rule like any record without dates.
 * - every other held text stays held, and the buyer pages show only HELD_INCENTIVE_PUBLIC_LINE for that community:
 *   no figure, name or wording from the builder's text (Reg Z: no rate, APR, payment, down payment or term without
 *   its disclosures). Admin Accept, or a later read that clears the hold, replaces the line with the full offer.
 * Pure, so the server, the admin page and the tests share one rule.
 */

/** The one line the public and gated lists show for a community whose offer is held. Exactly this text, nothing from the builder. */
export const HELD_INCENTIVE_PUBLIC_LINE = "Builder incentive available — ask us for details";

/**
 * Stored in deal_incentives.hold_reason of a live (active, not held) record the sync published by itself under the
 * deadline-only rule. A human Accept or save always clears hold_reason and sets accepted_at, so the two never look alike.
 */
export const AUTO_ACCEPTED_NO_DEADLINE = "auto_accepted:no_deadline";

/** The hold reasons that only say a deadline was named without a readable date. */
export const DEADLINE_HOLD_REASONS: readonly string[] = ["missing_contract_deadline", "missing_closing_deadline"];

/** Admin wording for the two states. */
export const HELD_INCENTIVE_ADMIN_STATUS = "Showing 'Builder incentive available' until reviewed";
export const AUTO_ACCEPTED_ADMIN_STATUS = "Published automatically: no deadline in the builder's text";

export function isAutoAcceptedIncentive(row: { holdReason?: string | null } | null | undefined): boolean {
  return row?.holdReason === AUTO_ACCEPTED_NO_DEADLINE;
}

/** True when the reasons are only deadline reasons (and there is at least one). */
export function deadlineOnlyHold(reasons: readonly string[]): boolean {
  return reasons.length > 0 && reasons.every((reason) => DEADLINE_HOLD_REASONS.includes(reason));
}

/** The reasons stored on a held record (a JSON list; a bare legacy string is one reason). */
export function heldReasonsOf(holdReason: string | null | undefined): string[] {
  if (!holdReason) return [];
  try {
    const parsed: unknown = JSON.parse(holdReason);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [holdReason];
  } catch {
    return [holdReason];
  }
}

/**
 * Whether a held record puts the neutral line on the buyer pages: it is held for a publication rule (a reason other
 * than "a manual override is live", which shows the override instead), it is not past a date it carries, and the builder
 * still showed it within the lapse window (a held text nobody has read for weeks is not "available").
 */
export function heldIncentiveShowsLine(row: { held: boolean; holdReason: string | null; expiresAt: Date | null; confirmedAt: Date }, now: Date, lapseDays: number): boolean {
  if (!row.held) return false;
  if (!heldReasonsOf(row.holdReason).some((reason) => reason !== "differs_from_manual_override")) return false;
  if (row.expiresAt && row.expiresAt <= now) return false;
  return row.confirmedAt > new Date(now.getTime() - lapseDays * 24 * 60 * 60_000);
}

/** The buyer-facing incentive for a held offer: the line and nothing else. */
export function heldIncentivePublicEntry() {
  return {
    text: HELD_INCENTIVE_PUBLIC_LINE,
    teaser: HELD_INCENTIVE_PUBLIC_LINE,
    headlineRate: null,
    followOnRate: null,
    followOnPeriod: null,
    apr: null,
    loanType: null,
    downPayment: null,
    repaymentTerms: null,
    contractBy: null,
    closeBy: null,
    pending: true as const,
  };
}

const FULL_MONTH = "(?:January|February|April|June|July|August|September|October|November|December)";
const SHORT_MONTH = "(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)";
/** A day/month pair that is a plan, bath, buydown or ARM figure, not a date ("2/1 buydown", "5/1 ARM", "3/2 homes"). */
const NOT_A_DAY_MONTH = /^\s*-?\s*(?:temporary\s+)?(?:buy|arm\b|arms\b|adj|sofr|hybrid|program|rate|interest|acre|option|lot|bath|ba\b|bed|br\b|bd\b|car\b|garage|split|plan|homes?\b|with\b|study)/i;

/**
 * Date-like phrases a reader could take as the offer's deadline. Deliberately broad: a false positive only keeps a
 * text held (as before this rule), a miss would publish a dated offer as undated.
 */
const DATE_LIKE: readonly RegExp[] = [
  new RegExp(`\\b${FULL_MONTH}\\b`, "i"),
  new RegExp(`\\b${SHORT_MONTH}\\.?\\s*\\d{1,2}(?!\\d)`, "i"),
  /\b(?:March|May)\s+(?:\d{1,2}(?!\d)|20\d{2})/i,
  /\b(?:by|through|thru|until|till|before|in|of|end\s+of|from|between|starting|beginning|ends?|expires?)\s+(?:the\s+)?(?:March|May)\b/i,
  /(?<![\d.])\d{1,2}-\d{1,2}-\d{2,4}(?!\d)/,
  /(?<![\d.])\d{1,2}\.\d{1,2}\.\d{2,4}(?![\d%])/,
  /\b20\d{2}-\d{2}-\d{2}\b/,
  /\b20\d{2}\b/,
  /\b\d{1,2}(?:st|nd|rd|th)\b(?![\s-]*(?:year|yr|month|mo\b|time|anniversary|floor|homes?|buyers?|percentile|lien|mortgage|loan))/i,
  /\bend\s+of\s+(?:the\s+)?(?:month|year|quarter|week|day|season|sales?\s+event|event|promotion|program)\b/i,
  /\b(?:month|year|quarter|week)[- ]end\b/i,
  /\bthis\s+(?:weekend|week|month|quarter|year|season|spring|summer|fall|autumn|winter|holiday)\b/i,
  /\b(?:by|through|thru|until|till|before|end\s+of|in)\s+(?:the\s+)?(?:spring|summer|fall|autumn|winter)\b/i,
  /\b(?:spring|summer|fall|autumn|winter)\s+20\d{2}\b/i,
  /\b(?:today|tomorrow|tonight|weekend)\b/i,
  /\b(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\b/i,
  /\b(?:Labor|Memorial|Independence|Presidents'?|Veterans'?|Columbus|Valentine'?s|Mother'?s|Father'?s|New\s+Year'?s)\s+Day\b|\bThanksgiving\b|\bChristmas\b|\bBlack\s+Friday\b|\bCyber\s+Monday\b|\bFourth\s+of\s+July\b/i,
  /\bQ[1-4]\b/,
  /\b(?:ends?|expires?|left|remaining)\b[^.]{0,20}\b\d+\s+(?:days?|weeks?)\b|\b\d+\s+(?:days?|weeks?)\s+(?:left|only|remaining)\b/i,
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The first date-like phrase in the offer text that is not one of the deadlines the parser read as a date, or null.
 * `deadlines` are the parser's readable deadlines (their raw text); a window's opening date before a read closing date
 * ("between September 4 and September 30, 2026") goes with it. Expects the parser's normalized text
 * (normalizeIncentiveText), so the raws match.
 */
export function unreadDateIn(text: string, deadlines: ReadonlyArray<{ raw: string; isoDate: string | null } | null | undefined>): string | null {
  let rest = text.replace(/\s+/g, " ");
  for (const deadline of deadlines) {
    if (!deadline?.isoDate || !deadline.raw.trim()) continue;
    const raw = escapeRegExp(deadline.raw.replace(/\s+/g, " ").trim());
    rest = rest.replace(new RegExp(`(?:\\b(?:between|from)\\s+[^.]{1,40}?\\s*,?\\s*(?:and|to|through|-)\\s+)?${raw}`, "gi"), " ");
  }
  for (const pattern of DATE_LIKE) {
    const match = pattern.exec(rest);
    if (match) return match[0].trim();
  }
  // A month/day pair with no year ("by 10/31", "11/30/26" left over) unless it is a plan, bath, buydown or ARM figure.
  for (const match of Array.from(rest.matchAll(/(?<![\d/.])(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?(?![\d/])(?!\.\d)/g))) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    if (NOT_A_DAY_MONTH.test(rest.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 24))) continue;
    if (/(?:\bbuy[- ]?down|\barm|\bbed(?:room)?s?|\bbaths?)\s*$/i.test(rest.slice(Math.max(0, (match.index ?? 0) - 12), match.index ?? 0))) continue;
    return match[0];
  }
  return null;
}
