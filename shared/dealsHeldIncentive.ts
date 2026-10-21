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
/** The same, for a text with one readable deadline kept and one undated one left out. */
export const AUTO_ACCEPTED_DATED_ADMIN_STATUS = "Published automatically: one deadline in the builder's text has no date; it comes off by the dated one";

/** The admin wording for a record the sync published by itself: it says "no deadline" only when it carries no date. */
export function autoAcceptedStatus(row: { contractBy?: Date | string | null; closeBy?: Date | string | null }): string {
  return row.contractBy || row.closeBy ? AUTO_ACCEPTED_DATED_ADMIN_STATUS : AUTO_ACCEPTED_ADMIN_STATUS;
}

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

/** A month name, full or short; never "APR" (the annual percentage rate). */
const MONTH_WORD = "(?!APR\\b)(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
/** Words that put a deadline next to whatever follows them. */
const DEADLINE_CUE = "(?:by|through|thru|until|till|til|before|ends?|ending|ended|expires?|expiring|expiration|deadline|on|valid|good|limited[- ]time|starting|beginning|between|in)";
/** A figure that can be a day or a month: one or two digits, not money, not a percentage, not a loan length or an area. */
const DAY_FIGURE = "(?<![$\\d.,])\\d{1,2}(?:st|nd|rd|th)?(?![\\d%]|\\s*%|,\\d{3}|\\.\\d+\\s*%|[-\\s]*(?:years?|yrs?|percent|sq|square|acres?)\\b)";
/** Counts written out ("thirty days from today"). */
const COUNT_WORD = "(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen|fifteen|twenty|twenty-one|thirty|forty|forty-five|fifty|sixty|seventy-five|ninety)";
/** Holidays and calendar periods a builder writes as a deadline (anywhere in the text they count). */
const PERIOD_CORE = "(?:EO[MYQDW]|COB|close\\s+of\\s+business|last\\s+(?:business\\s+)?day\\s+of(?:\\s+(?:the\\s+)?[A-Za-z]+)?|month'?s?[- ]end|year'?s?[- ]end|quarter'?s?[- ]end|end\\s+of\\s+(?:the\\s+)?(?:month|year|quarter|week|day|season|sales?\\s+event|event|promotion|program|" + MONTH_WORD + ")|(?:first|second|third|fourth|last|1st|2nd|3rd|4th)\\s+quarter|Q[1-4]|(?:this|next)\\s+(?:weekend|week|month|quarter|year|season|spring|summer|fall|autumn|winter|holidays?)|mid[- ]?" + MONTH_WORD + "|Halloween|Thanksgiving|Christmas|Xmas|Hanukkah|Easter|New\\s+Year'?s?(?:\\s+(?:Eve|Day))?|Black\\s+Friday|Cyber\\s+Monday|(?:Labor|Memorial|Independence|Presidents'?|Veterans'?|Columbus|Valentine'?s|Mother'?s|Father'?s)\\s+Day|Fourth\\s+of\\s+July|(?:the\\s+)?holidays|holiday\\s+season|weekend|(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day)";
/** Also a deadline right after a deadline word: a season or a day word ("by fall", "ends today"); alone they are names or sales talk. */
const PERIOD_WORD = `(?:${PERIOD_CORE}|spring|summer|fall|autumn|winter|today|tomorrow|tonight)`;

/**
 * Date-like phrases a reader could take as the offer's deadline. Deliberately broad: a false positive only keeps a
 * text held (as before this rule, with the neutral line showing), a miss would publish a dated offer as undated.
 */
const DATE_LIKE: readonly RegExp[] = [
  // A deadline word followed (after at most a few small words) by a day figure, a month, a holiday or a period.
  new RegExp(`\\b${DEADLINE_CUE}\\b[\\s,:-]+(?:(?:the|a|an|or|on|of|end|mid|early|late|this|next)[\\s-]+){0,3}(?:${DAY_FIGURE}|${MONTH_WORD}\\b|${PERIOD_WORD}\\b)`, "i"),
  // Any month name, full or short ("Sept", "Dec.", "Oct-31"); "May" and "March" only beside a figure or a deadline word (above).
  /\b(?:January|February|April|June|July|August|September|October|November|December)\b/i,
  /\b(?!APR\b)(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\b\.?/i,
  new RegExp(`\\b(?:March|May)\\.?[\\s-]*(?:\\d{1,2}(?!\\d)|20\\d{2})`, "i"),
  // Holidays, quarters and calendar periods anywhere; a season or "today" only after a deadline word ("Fall Savings Event", "call today").
  new RegExp(`\\b${PERIOD_CORE}\\b`, "i"),
  /\b(?:spring|summer|fall|autumn|winter)\s+20\d{2}\b/i,
  /\b20\d{2}\b/,
  /\b\d{1,2}(?:st|nd|rd|th)\b(?![\s-]*(?:year|yr|month|mo\b|time|anniversary|floor|buyers?|percentile|lien|mortgage|loan))/i,
  /\b(?:ends?|expires?|left|remaining)\b[^.]{0,20}\b\d+\s+(?:days?|weeks?)\b|\b\d+\s+(?:days?|weeks?)\s+(?:left|only|remaining)\b/i,
  // A period counted from an event: "thirty days from today", "60 days of contract", "two weeks after purchase".
  new RegExp(`\\b(?:\\d+|${COUNT_WORD})\\s+(?:business\\s+|calendar\\s+)?(?:days?|weeks?|months?)\\s+(?:from|after|of|following)\\s+(?:the\\s+)?(?:today|now|purchase|contract|contracting|signing|acceptance|ratification|execution|date|offer)\\b`, "i"),
];

/** A numeric pair that is a buydown or an adjustable-rate figure ("2/1 buydown", "5/1 ARM", "2-1 buydown"), not a date. */
const LOAN_STRUCTURE_AFTER = /^(?:[/-]\d)*\s*-?\s*(?:temporary\s+)?(?:buy[- ]?downs?|arms?\b|adjustable|adj\b|sofr|hybrid)/i;
const LOAN_STRUCTURE_BEFORE = /(?:\bbuy[- ]?down|\barm)\s*:?\s*$/i;

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
  // A month/day pair in any separator ("12/31", "11.30", "11-30", "10/31/26" left over), whatever word follows it,
  // unless it is a buydown or ARM figure.
  for (const match of Array.from(rest.matchAll(/(?<![\d.$,/])(\d{1,2})[/.-](\d{1,2})(?:[/.-]\d{2,4})?(?![\d%]|\s*%|\.\d|,\d{3}|\/\d)/g))) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const at = match.index ?? 0;
    if (LOAN_STRUCTURE_AFTER.test(rest.slice(at + match[0].length, at + match[0].length + 24)) || LOAN_STRUCTURE_BEFORE.test(rest.slice(Math.max(0, at - 14), at))) continue;
    return match[0];
  }
  return null;
}
