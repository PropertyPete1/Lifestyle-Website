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
export const HELD_INCENTIVE_ADMIN_STATUS = "Held for review: buyers see its non-rate highlights, or 'Builder incentive available'";
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

/**
 * Oct 28, 2026 (Peter: "yes show the incentives"): a held offer shows what it gives that is not a rate or a loan term,
 * in fixed words of our own (a buydown named without its figures, closing-cost help, a move-in package...), so buyers see
 * more than the neutral line while the rate waits for review. Nothing is copied from the builder's text: no figure
 * beside a rate, no payment, down payment or term (Reg Z), no name. Only rate-review holds (RATE_REVIEW_REASONS) do this.
 */
/**
 * Only an offer held for the rate review shows its highlights. One held for a private name, a manual override, or a
 * deadline the reader could not date keeps the neutral line (a dollar offer with an unread date could outlive it).
 */
export const RATE_REVIEW_REASONS: readonly string[] = ["ambiguous_rate", "apr_check", "adjustable_rate", "missing_apr", "missing_repayment_term", "missing_down_payment", "missing_follow_on_rate", "missing_follow_on_period", "missing_promotional_rate", "missing_promotional_period", "missing_loan_type"];
const DOLLARS = "\\$\\s?(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{2})?\\s?([kK])?";

function dollarsLabel(amount: string, thousands?: string): string | null {
  const value = Number(amount.replace(/,/g, "")) * (thousands ? 1000 : 1);
  if (!Number.isFinite(value) || value < 500 || value > 250_000) return null;
  return `$${value.toLocaleString("en-US")}`;
}

/** The offer's parts that are not a rate or a loan term, in our own words, most valuable first (at most three). */
export function heldIncentiveHighlights(text: string): string[] {
  const t = text.replace(/\s+/g, " ");
  const parts: string[] = [];
  const add = (part: string | null) => { if (part && !parts.some((have) => have.toLowerCase() === part.toLowerCase())) parts.push(part); };
  const buydown = t.match(/\b(3[\/-]2[\/-]1|2[\/-]1|1[\/-]0)\s*(?:temporary\s+)?(?:rate\s+)?(?:buy[- ]?down|program)\b/i) ?? t.match(/\btemporary\s+(3[\/-]2[\/-]1|2[\/-]1|1[\/-]0)\s*(?:rate\s+)?buy[- ]?down\b/i);
  if (buydown) add(`${buydown[1]!.replace(/\//g, "-")} rate buydown`);
  else if (/\bbuy[- ]?down\b/i.test(t)) add("Rate buydown");
  const closingDollars = t.match(new RegExp(`(up to\\s+)?${DOLLARS}\\s+(?:in\\s+)?(?:paid\\s+)?(?:towards?\\s+|for\\s+)?(?:your\\s+|buyer'?s?\\s+)?closing costs?`, "i"));
  const closingShare = t.match(/(up to\s+)?(\d{1,2}(?:\.\d+)?)%\s+(?:in\s+)?(?:paid\s+)?(?:towards?\s+|of\s+)?closing costs?/i);
  if (closingDollars) { const label = dollarsLabel(closingDollars[2]!, closingDollars[3]); if (label) add(`${closingDollars[1] ? "Up to " : ""}${label} toward closing costs`); }
  else if (closingShare) add(`${closingShare[1] ? "Up to " : ""}${closingShare[2]}% toward closing costs`);
  else if (/\b(?:paid|free)\s+closing costs?\b/i.test(t)) add("Paid closing costs");
  const flex = t.match(new RegExp(`(up to\\s+)?(?:${DOLLARS}|(\\d{1,2}(?:\\.\\d+)?)%)\\s+(?:in\\s+)?flex\\s+cash`, "i"));
  if (flex) {
    const label = flex[2] ? dollarsLabel(flex[2], flex[3]) : flex[4] ? `${flex[4]}%` : null;
    // The same dollars named twice (flex cash a buyer may put toward closing costs) count once, as flex cash.
    if (label) { const same = parts.findIndex((part) => part.endsWith(`${label} toward closing costs`)); if (same >= 0) parts.splice(same, 1); add(`${flex[1] ? "Up to " : ""}${label} in flex cash`); }
  }
  const incentives = t.match(new RegExp(`(up to\\s+)?${DOLLARS}\\s+(?:in\\s+)?(?:customi[sz]ed\\s+|builder\\s+|bonus\\s+)?incentives\\b`, "i"));
  if (incentives) { const label = dollarsLabel(incentives[2]!, incentives[3]); if (label) add(`${incentives[1] ? "Up to " : ""}${label} in incentives`); }
  if (/\bhalf[- ]off\s+(?:homesite|lot)\s+premiums?\b/i.test(t)) add("Half-off homesite premiums");
  if (/\breduced\s+(?:sales\s+)?prices?\b/i.test(t)) add("Reduced prices");
  if (/\b(?:paid|free)\s+owner'?s'?\s+title\s+(?:policy|insurance)\b/i.test(t)) add("Paid owner's title policy");
  if (/\bprepaid\s+HOA\b/i.test(t)) add("Prepaid HOA fees");
  if (/\bappliance\s+package\b/i.test(t)) add("Appliance package");
  else if (/\bmove[- ]in\s+package\b/i.test(t)) add("Move-in package");
  // A rate with no buydown named: the financing is mentioned without any figure.
  if (!parts.some((part) => /buydown/i.test(part)) && /\b(?:rates?|financing|APR|fixed[- ]rate|mortgage)\b/i.test(t) && /\d(?:\.\d+)?\s?%/.test(t)) parts.unshift("Special financing");
  return parts.slice(0, 3);
}

/** What the buyer pages show for a held offer: its highlights in our words when it may show them, else the neutral line. */
export function heldIncentiveLine(row: { holdReason: string | null; publicText?: string | null }): string {
  const reasons = heldReasonsOf(row.holdReason);
  if (!row.publicText || !reasons.length || reasons.some((reason) => !RATE_REVIEW_REASONS.includes(reason))) return HELD_INCENTIVE_PUBLIC_LINE;
  const parts = heldIncentiveHighlights(row.publicText);
  if (!parts.length) return HELD_INCENTIVE_PUBLIC_LINE;
  const scope = /\bselect\s+(?:quick[- ]move[- ]in\s+|inventory\s+|move[- ]in[- ]ready\s+)?homes\b/i.test(row.publicText) ? " on select homes" : "";
  // Mid-sentence parts start lower case ("and up to $10,000..."); a choice the builder offers ("a rate OR flex cash") reads "or".
  const lower = (part: string) => /^[A-Z][a-z]/.test(part) ? `${part.charAt(0).toLowerCase()}${part.slice(1)}` : part;
  const list = (items: string[]) => items.length === 1 ? items[0]! : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]!}`;
  const financing = parts.filter((part) => /buydown|special financing/i.test(part));
  const perks = parts.filter((part) => !financing.includes(part));
  const either = financing.length > 0 && perks.length > 0 && /(?:rates?|financing|buy[- ]?down)\b[^.!?]{0,160}\bor\b[^.!?]{0,60}(?:flex cash|closing costs?|incentives)/i.test(row.publicText);
  const ordered = [...financing, ...perks].map((part, index) => index === 0 ? part : lower(part));
  const joined = either ? `${list(ordered.slice(0, financing.length))} or ${list(ordered.slice(financing.length))}` : list(ordered);
  return `Builder incentive: ${joined}${scope} — ask us for details`;
}

/** The buyer-facing incentive for a held offer: the line (the neutral one, or its highlights in our words) and nothing else. */
export function heldIncentivePublicEntry(line: string = HELD_INCENTIVE_PUBLIC_LINE) {
  return {
    text: line,
    teaser: line,
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
