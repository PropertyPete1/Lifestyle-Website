/**
 * Size limits every Builder Deals email respects, and the splitter that keeps a
 * long message under them. Pure (no I/O), so the sync can compose its digest
 * parts with it and the transport can guard any other path the same way.
 *
 * Without a Resend key every Builder Deals email goes through notifyOwner
 * (server/_core/notification.ts), which REJECTS a title over 1,200 characters or
 * content over 20,000: a bigger message is not shortened, it is not delivered.
 */

export const OWNER_NOTIFICATION_TITLE_MAX = 1_200;
export const OWNER_NOTIFICATION_CONTENT_MAX = 20_000;
/** Every subject stays far below the notification limit and the 255-character email log column. */
export const EMAIL_SUBJECT_MAX = 200;
/** One body part, in UTF-8 bytes (so also in characters): room is left for the fallback's "To:" line and a part header. */
export const EMAIL_PART_MAX = 18_000;
/** Room kept in every part for the "Part 2 of 3" header. */
const PART_HEADER_RESERVE = 120;

/** A subject cut at a word boundary with an ellipsis; a short subject is returned unchanged. */
export function capSubject(subject: string, max = EMAIL_SUBJECT_MAX): string {
  const clean = subject.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, "")}…`;
}

/** "Subject (2/3)" for a part of a split message; the subject alone when it is one part. */
export function partSubject(subject: string, index: number, total: number, max = EMAIL_SUBJECT_MAX): string {
  if (total <= 1) return capSubject(subject, max);
  const suffix = ` (${index}/${total})`;
  return `${capSubject(subject, max - suffix.length)}${suffix}`;
}

/** A piece of a message that should stay together; `tags` travel with the part it lands in (the digest's entry ids). */
export type EmailBlock<T = never> = { text: string; tags?: readonly T[] };
export type EmailPart<T = never> = { content: string; tags: T[] };
export type PackOptions = {
  /** The sentence after "Part i of n." in every part; the default only says the message continues. */
  note?: (total: number) => string;
};

/** A part's size: UTF-8 bytes, which is never less than its length in characters, so one cap covers both limits. */
export const emailSize = (text: string) => Buffer.byteLength(text, "utf8");

/** The longest prefix of `text` (by characters) whose UTF-8 size fits `limit`, never splitting a surrogate pair. */
function fittingPrefix(text: string, limit: number): string {
  let end = Math.min(text.length, limit);
  while (end > 0 && emailSize(text.slice(0, end)) > limit) end = Math.max(0, end - Math.max(1, Math.ceil((emailSize(text.slice(0, end)) - limit) / 4)));
  if (end > 0 && end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end -= 1;
  return text.slice(0, Math.max(1, end));
}

/** Cuts a block that is too big for one part at line breaks, and a line that is too long at the limit. */
function splitOversized<T>(block: EmailBlock<T>, limit: number): EmailBlock<T>[] {
  if (emailSize(block.text) <= limit) return [block];
  const pieces: EmailBlock<T>[] = [];
  let current = "";
  const flush = () => { if (current) pieces.push({ text: current, tags: block.tags }); current = ""; };
  for (const line of block.text.split("\n")) {
    let rest = line;
    do {
      const chunk = emailSize(rest) <= limit ? rest : fittingPrefix(rest, limit);
      rest = rest.slice(chunk.length);
      if (current && emailSize(current) + 1 + emailSize(chunk) > limit) flush();
      current = current ? `${current}\n${chunk}` : chunk;
    } while (rest.length);
  }
  flush();
  return pieces;
}

const defaultNote = (total: number) => `The message continues in the other part${total > 2 ? "s" : ""}.`;

/**
 * Packs blocks (joined by a line break) into as few parts as fit `limit` each, header included, measured in UTF-8
 * bytes (so the character limit holds too). A message that fits is one part with no header; otherwise every part
 * opens with "Part i of n." and the caller's note. No block is ever dropped.
 */
export function packEmailParts<T = never>(blocks: readonly EmailBlock<T>[], limit = EMAIL_PART_MAX, options: PackOptions = {}): EmailPart<T>[] {
  const whole = blocks.map((block) => block.text).join("\n");
  if (emailSize(whole) <= limit) return [{ content: whole, tags: Array.from(new Set(blocks.flatMap((block) => block.tags ?? []))) }];
  const note = options.note ?? defaultNote;
  const reserve = PART_HEADER_RESERVE + emailSize(note(999));
  const room = Math.max(200, limit - reserve);
  const bodies: Array<{ text: string; tags: Set<T> }> = [];
  let current: { text: string; tags: Set<T> } | null = null;
  for (const block of blocks.flatMap((value) => splitOversized(value, room))) {
    if (current && emailSize(current.text) + 1 + emailSize(block.text) > room) { bodies.push(current); current = null; }
    if (!current) current = { text: block.text, tags: new Set(block.tags ?? []) };
    else { current.text = `${current.text}\n${block.text}`; for (const tag of block.tags ?? []) current.tags.add(tag); }
  }
  if (current) bodies.push(current);
  return bodies.map((body, index) => ({
    content: `Part ${index + 1} of ${bodies.length}${index ? ` (continued from part ${index})` : ""}. ${note(bodies.length)}\n\n${body.text.replace(/^\n+/, "")}`,
    tags: Array.from(body.tags),
  }));
}

/** Plain text split by lines, for a transport that must keep any message under a limit. */
export function splitEmailContent(content: string, limit = EMAIL_PART_MAX): string[] {
  return packEmailParts(content.split("\n").map((text) => ({ text })), limit).map((part) => part.content);
}
