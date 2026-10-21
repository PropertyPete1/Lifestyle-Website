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
/** One body part: room is left for the fallback's "To:" line and a part header. */
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

/** Cuts a block that is too big for one part at line breaks, and a line that is too long at the limit. */
function splitOversized<T>(block: EmailBlock<T>, limit: number): EmailBlock<T>[] {
  if (block.text.length <= limit) return [block];
  const pieces: EmailBlock<T>[] = [];
  let current = "";
  const flush = () => { if (current) pieces.push({ text: current, tags: block.tags }); current = ""; };
  for (const line of block.text.split("\n")) {
    for (let start = 0; start < Math.max(line.length, 1); start += limit) {
      const chunk = line.slice(start, start + limit);
      if (current && current.length + 1 + chunk.length > limit) flush();
      current = current ? `${current}\n${chunk}` : chunk;
    }
  }
  flush();
  return pieces;
}

/**
 * Packs blocks (joined by a line break) into as few parts as fit `limit`
 * characters each, header included. A message that fits is one part with no
 * header; otherwise every part opens with "Part i of n." so the reader knows
 * nothing was cut. Nothing is ever dropped.
 */
export function packEmailParts<T = never>(blocks: readonly EmailBlock<T>[], limit = EMAIL_PART_MAX): EmailPart<T>[] {
  const whole = blocks.map((block) => block.text).join("\n");
  if (whole.length <= limit) return [{ content: whole, tags: Array.from(new Set(blocks.flatMap((block) => block.tags ?? []))) }];
  const room = Math.max(200, limit - PART_HEADER_RESERVE);
  const bodies: Array<{ text: string; tags: Set<T> }> = [];
  let current: { text: string; tags: Set<T> } | null = null;
  for (const block of blocks.flatMap((value) => splitOversized(value, room))) {
    if (current && current.text.length + 1 + block.text.length > room) { bodies.push(current); current = null; }
    if (!current) current = { text: block.text, tags: new Set(block.tags ?? []) };
    else { current.text = `${current.text}\n${block.text}`; for (const tag of block.tags ?? []) current.tags.add(tag); }
  }
  if (current) bodies.push(current);
  return bodies.map((body, index) => ({
    content: `Part ${index + 1} of ${bodies.length}${index ? ` (continued from part ${index})` : ""}. Nothing was left out: the rest is in the other part${bodies.length > 2 ? "s" : ""}.\n\n${body.text.replace(/^\n+/, "")}`,
    tags: Array.from(body.tags),
  }));
}

/** Plain text split by lines, for a transport that must keep any message under a limit. */
export function splitEmailContent(content: string, limit = EMAIL_PART_MAX): string[] {
  return packEmailParts(content.split("\n").map((text) => ({ text })), limit).map((part) => part.content);
}
