/**
 * The landing page's one-line version of an offer: the sentence that names
 * the rate (or the first sentence), with its dates taken out. The full wording,
 * the homes it names and its deadlines wait for sign-up. Pure, so the rule is
 * tested without a database.
 */
const MONTH = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
const DATE = `(?:\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?|${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}(?:,?\\s+\\d{4})?)`;
/** "closing by 11/30", "through October 31", "between 10/12/2026 and 11/8/2026", "by 10/31/26" and the like. */
const LEAD = "(?:(?:must\\s+)?clos(?:e|ing)(?:\\s+on)?|contracts?(?:\\s+(?:written|signed|accepted))?|valid|(?:offer\\s+)?(?:ends?|expires?)|accepted(?:\\s+by\\s+builder)?|available|good)";
const CONNECTOR = "(?:by|through|thru|until|till|before|on\\s+or\\s+before|no\\s+later\\s+than|between|from|starting|beginning|on)";
const DATE_CLAUSE = new RegExp(`\\s*(?:,\\s*)?(?:${LEAD}\\s+(?:${CONNECTOR}\\s+)?|${CONNECTOR}\\s+)${DATE}(?:\\s*(?:and|to|through|-|–)\\s*${DATE})?`, "gi");
const BARE_DATE = new RegExp(`\\s*\\(?${DATE}\\)?`, "gi");
export const TEASER_MAX = 220;

export function incentiveTeaser(publicText: string): string {
  const text = publicText.replace(/\s+/g, " ").trim();
  if (!text) return "";
  // A list of named homes after a colon is the private list's business.
  const head = text.split(/Selected Quick Move-In homes:/i)[0]!.trim();
  // A sentence ends at a period followed by a capitalised word; "4.25%" and "6.051% APR" are figures, not sentence ends.
  const sentences = head.split(/(?<=[.!?])\s+(?=["“(]?[A-Z0-9$])/).map((sentence) => sentence.trim()).filter(Boolean);
  if (!sentences.length) return "";
  // The sentence that names a rate carries the deal; a figure in parentheses ("(6.051% APR)") stays with it.
  const chosen = sentences.find((sentence) => /\d+(?:\.\d+)?\s*%/.test(sentence)) ?? sentences[0]!;
  let teaser = chosen.replace(DATE_CLAUSE, "").replace(BARE_DATE, "").replace(/\s+([,.;:!?])/g, "$1").replace(/,\s*,/g, ",").replace(/\s{2,}/g, " ").replace(/[,;:\s]+([.!?]?)$/, "$1").replace(/^[\s,;:]+/, "").trim();
  teaser = teaser.replace(/^[a-z]/, (letter) => letter.toUpperCase());
  if (teaser && !/[.!?]$/.test(teaser)) teaser += ".";
  if (teaser.length > TEASER_MAX) {
    const cut = teaser.slice(0, TEASER_MAX - 1);
    teaser = `${cut.slice(0, Math.max(cut.lastIndexOf(" "), TEASER_MAX - 40)).replace(/[,;:\s]+$/, "")}…`;
  }
  return teaser;
}
