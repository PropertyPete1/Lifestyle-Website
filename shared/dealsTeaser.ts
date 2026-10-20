/**
 * The landing page's one-line version of an offer: the sentence that names
 * the rate (or the first sentence), with its dates taken out. The full wording,
 * the homes it names and its deadlines wait for sign-up. Pure, so the rule is
 * tested without a database.
 */
const MONTH = "(?<![A-Za-z])(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
/** A sentence does not end at "Dec." when a day follows ("through Dec. 31."). */
const MONTH_ABBREVIATION_END = "(?<!(?<![A-Za-z])(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\\.)";
/**
 * Date forms a builder writes: 11/30, 10/31/26, 11-30-2026, 11.30.2026,
 * 2026-11-30, October 31, Oct. 31st, 2026, 31 October 2026, the 30th of
 * November, May 2026, end of October 2026. A bare day/month slash needs a year
 * (so "2/1 buydown" and "1/2 acre" stay), and a month-year never leaves its
 * year behind.
 */
const DAY = "\\d{1,2}(?:st|nd|rd|th)?(?!\\d)";
const YEAR = "(?:20\\d{2}|\\d{2}(?!\\d))";
const DATE = `(?:\\d{1,2}[\\/.-]\\d{1,2}[\\/.-]${YEAR}|20\\d{2}-\\d{2}-\\d{2}(?!\\d)|${MONTH}\\s+${DAY}(?:,?\\s+20\\d{2})?|(?:the\\s+)?${DAY}\\s+(?:of\\s+)?${MONTH}(?:,?\\s+20\\d{2})?|(?:the\\s+)?(?:end|start|beginning|middle)\\s+of\\s+${MONTH}(?:\\s+20\\d{2})?|${MONTH}\\s+20\\d{2}(?!\\d))`;
/** A day/month without a year, only where a lead word makes it a date ("closing by 11/30", "contracts by 11/30"); "on 4/2.5 homes" is a figure. */
const SHORT_DATE = `(?:\\d{1,2}\\/\\d{1,2}(?![\\d\\/]|\\.\\d)(?!\\s*-?\\s*(?:acre|buydown|ARM\\b|option|lot)))`;
/** "closing by 11/30", "through October 31", "between 10/12/2026 and 11/8/2026", "by 10/31/26" and the like. */
const LEAD = "(?:(?:must\\s+)?clos(?:e|ing)(?:\\s+on)?|(?:written|signed|accepted)(?:\\s+by\\s+builder)?|valid|(?:offer\\s+)?(?:ends?|expires?)|available|good)";
const CONNECTOR = "(?:by|through|thru|until|till|before|on\\s+or\\s+before|no\\s+later\\s+than|between|from|starting|beginning|on|in)";
/** After a preposition the noun "contracts" stays when its date clause goes ("on contracts through 10.31.26" -> "on contracts"); leading it off, it goes too ("Contracts written by 11/8 get 5.5%" -> "Get 5.5%"). */
const DATE_CLAUSE = new RegExp(`(\\s*(?:,\\s*)?)((?:contracts?\\s+)?)(?:${LEAD}\\s+(?:${CONNECTOR}\\s+)?(?:${DATE}|${SHORT_DATE})|${CONNECTOR}\\s+${DATE}|(?<=contracts?\\s)${CONNECTOR}\\s+${SHORT_DATE})(?:\\s*(?:and|to|through|-|–)\\s*(?:${DATE}|${SHORT_DATE}))?`, "gi");
const BARE_DATE = new RegExp(`\\s*\\(?(?<![\\d.$])${DATE}\\)?`, "gi");
/** An adjustable-rate offer says so on the card even when the chosen sentence does not. */
const ADJUSTABLE = (text: string) => /\bARM\b/.test(text) || /\b\d{1,2}\/\d\s+arm\b|\badjustable[- ]rate|\brate\s+adjusts|\binitial\s+(?:interest\s+)?rate\b/i.test(text);
export const TEASER_MAX = 220;

export function incentiveTeaser(publicText: string): string {
  const text = publicText.replace(/\s+/g, " ").trim();
  if (!text) return "";
  // A list of named homes after a colon is the private list's business.
  const head = text.split(/Selected Quick Move-In homes:/i)[0]!.trim();
  // A sentence ends at a period followed by a capitalised word; "4.25%" and "6.051% APR" are figures, not sentence ends.
  const sentences = head.split(new RegExp(`(?<=[.!?])${MONTH_ABBREVIATION_END}\\s+(?=["“(]?[A-Z0-9$])`)).map((sentence) => sentence.trim()).filter(Boolean);
  if (!sentences.length) return "";
  // The sentence that names a rate carries the deal; a figure in parentheses ("(6.051% APR)") stays with it.
  const chosen = sentences.find((sentence) => /\d+(?:\.\d+)?\s*%/.test(sentence)) ?? sentences[0]!;
  let teaser = chosen.replace(DATE_CLAUSE, (_match, lead: string, noun: string, offset: number, whole: string) => noun && /\b(?:on|for|with|to|of)\s*$/i.test(whole.slice(0, offset)) ? `${lead}${noun.trim()}` : "").replace(BARE_DATE, "").replace(/\s+([,.;:!?])/g, "$1").replace(/,\s*,/g, ",").replace(/\s{2,}/g, " ").replace(/[,;:\s]+([.!?]?)$/, "$1").replace(/^[\s,;:]+/, "").trim();
  teaser = teaser.replace(/^[a-z]/, (letter) => letter.toUpperCase());
  // A sentence that was nothing but its deadline leaves nothing to show.
  if (!/[A-Za-z0-9]/.test(teaser)) return "";
  if (teaser && ADJUSTABLE(text) && !ADJUSTABLE(teaser)) teaser = `${teaser.replace(/[.!?]+$/, "")} (adjustable rate)`;
  if (teaser && !/[.!?]$/.test(teaser)) teaser += ".";
  if (teaser.length > TEASER_MAX) {
    const cut = teaser.slice(0, TEASER_MAX - 1);
    teaser = `${cut.slice(0, Math.max(cut.lastIndexOf(" "), TEASER_MAX - 40)).replace(/[,;:\s]+$/, "")}…`;
  }
  return teaser;
}
