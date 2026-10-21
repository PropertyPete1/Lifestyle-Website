/**
 * The Builder Deals sync email: a short "at a glance" summary, the holds, then
 * one line per community with long lists capped ("+N more"). It is composed
 * from digest entries (one per community check) and split into numbered parts
 * under the email limits (dealsEmailLimits), each part carrying the ids of the
 * entries it reports, so the sync marks an entry sent only once every part that
 * names it went out. Pure: no I/O.
 */
import { AUTO_ACCEPTED_ADMIN_STATUS, AUTO_ACCEPTED_DATED_ADMIN_STATUS, HELD_INCENTIVE_PUBLIC_LINE } from "../shared/dealsHeldIncentive";
import { EMAIL_PART_MAX, capSubject, packEmailParts, partSubject, type EmailBlock } from "./dealsEmailLimits";
import type { CommunityChangeSummary, HoldNotice } from "./dealsSync";

export type DigestEntry = { id?: number; createdAt?: Date | null; summaries: readonly CommunityChangeSummary[]; holds: readonly HoldNotice[] };
/** Today's check counts from deal_communities (null when they could not be read). */
export type DigestStats = { checkedToday: number; cleanToday: number };
export type DigestEmail = { category: "deals_sync_summary" | "deals_sync_hold"; subject: string; content: string; entryIds: number[]; part: number; parts: number };
export type DigestOptions = {
  /** "morning summary", "evening follow-up" or "update" (a single run). */
  label?: string;
  now?: Date;
  stats?: DigestStats | null;
  /** Entries created before this are older than the digest keeps: counted, not listed. */
  staleBefore?: Date | null;
  limit?: number;
};

/** Names shown per list before "+N more" (homes, then price changes). */
const LIST_SHOWN = 2;
const PRICES_SHOWN = 1;
/** Offer updates shown per community, each cut to this length. */
const OFFER_LINES_SHOWN = 2;
const OFFER_LINE_MAX = 240;
const HOLD_DETAIL_MAX = 600;
const NAME_MAX = 80;

export const HOLD_GUIDANCE = `Catalog holds offer Dismiss hold or Switch to Manual. A held incentive needs nothing from you: buyers see "${HELD_INCENTIVE_PUBLIC_LINE}" for that community until it is reviewed (or the manual override, where one is live), and Accept this update (optional) publishes the full offer. Offers held only for a deadline the text does not date are published by themselves.`;

type Group = {
  communityId: number;
  privateName: string;
  builder: string;
  added: string[];
  sold: string[];
  reappeared: string[];
  priceChanges: Array<{ name: string; from: number; to: number }>;
  offers: string[][];
  holds: HoldNotice[];
  ids: Set<number>;
};

type Counts = { added: number; sold: number; reappeared: number; drops: number; increases: number; offers: number; autoPublished: number; cameOff: number; catalogHolds: number; incentiveHolds: number };

const emptyCounts = (): Counts => ({ added: 0, sold: 0, reappeared: 0, drops: 0, increases: 0, offers: 0, autoPublished: 0, cameOff: 0, catalogHolds: 0, incentiveHolds: 0 });
const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
const money = (value: number) => `$${value.toLocaleString("en-US")}`;
const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);
const unique = <T,>(values: readonly T[]) => Array.from(new Set(values));

/**
 * The offer lines of one summary, grouped: a line that starts with spaces continues the line before it (the evening
 * job writes the retired text on its own indented line). Each group is one offer update.
 */
function offerGroups(lines: readonly string[]): string[][] {
  const groups: string[][] = [];
  for (const line of lines) {
    if (/^\s/.test(line) && groups.length) groups[groups.length - 1]!.push(line.trim());
    else groups.push([line.trim()]);
  }
  return groups;
}

function countOffer(group: readonly string[], counts: Counts) {
  const head = group[0] ?? "";
  counts.offers += 1;
  if (head.startsWith(AUTO_ACCEPTED_ADMIN_STATUS) || head.startsWith(AUTO_ACCEPTED_DATED_ADMIN_STATUS)) counts.autoPublished += 1;
  else if (/came off|no longer shows/i.test(head)) counts.cameOff += 1;
}

/** The number of changes in one run's summaries (each offer update counts once, however many lines it takes). */
export function changeCount(summaries: readonly CommunityChangeSummary[]): number {
  return summaries.reduce((total, summary) => total + summary.added.length + summary.sold.length + summary.reappeared.length + summary.priceChanges.length + offerGroups(summary.incentive).length, 0);
}

function listed(label: string, names: readonly string[]): string | null {
  if (!names.length) return null;
  const shown = names.slice(0, LIST_SHOWN).map((name) => clip(name, NAME_MAX));
  const more = names.length - shown.length;
  return `${names.length.toLocaleString("en-US")} ${label}: ${shown.join(", ")}${more ? `, +${more} more` : ""}`;
}

function priceList(changes: Group["priceChanges"]): string | null {
  const [first] = changes;
  if (!first) return null;
  const one = (change: Group["priceChanges"][number]) => `${clip(change.name, NAME_MAX)} ${money(change.from)} to ${money(change.to)}`;
  if (changes.length === 1) return `price ${first.to < first.from ? "drop" : "change"}: ${one(first)}`;
  const down = changes.filter((change) => change.to < change.from).length;
  return `${changes.length} price changes (${down} down, ${changes.length - down} up): ${changes.slice(0, PRICES_SHOWN).map(one).join(", ")}, +${changes.length - Math.min(PRICES_SHOWN, changes.length)} more`;
}

function communityLine(group: Group): string[] {
  const parts = [listed("new", group.added), listed("sold", group.sold), listed("back on the market", group.reappeared), priceList(group.priceChanges)].filter((value): value is string => Boolean(value));
  const offers = group.offers.slice(0, OFFER_LINES_SHOWN).map((lines) => `    offer: ${clip(lines.join(" "), OFFER_LINE_MAX)}`);
  const moreOffers = group.offers.length - offers.length;
  return [
    `- ${group.privateName} (${group.builder})${parts.length ? `: ${parts.join("; ")}` : ": offer update"}`,
    ...offers,
    ...(moreOffers ? [`    +${moreOffers} more offer update${moreOffers === 1 ? "" : "s"} (see Admin, Builder Deals)`] : []),
  ];
}

/** The hold lines of one community; a note already printed in this section (`notes`) is not repeated. */
function holdLines(group: Group, kind: HoldNotice["kind"], notes = new Set<string>()): string[] {
  const seen = new Set<string>();
  return group.holds.filter((hold) => hold.kind === kind).flatMap((hold) => {
    const key = `${hold.reason}\u0000${hold.detail ?? ""}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const detail = hold.detail ? clip(hold.detail, HOLD_DETAIL_MAX) : null;
    const repeated = detail !== null && notes.has(detail);
    if (detail) notes.add(detail);
    return [`- ${group.privateName} (${group.builder}), ${hold.kind} hold: ${clip(hold.reason, 300)}`, ...(detail ? [repeated ? "  (same note as above)" : `  ${detail}`] : [])];
  });
}

function chicagoDate(now: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "long", month: "long", day: "numeric" }).format(now);
}

/**
 * Composes the email(s) for a set of digest entries. Every entry id is carried by the first part (its counts are in
 * the summary) and by each part that lists its community, so a part that failed keeps its entries for the next try.
 */
export function composeBuilderDealsDigest(entries: readonly DigestEntry[], options: DigestOptions = {}): DigestEmail[] {
  const groups = new Map<number, Group>();
  const counts = emptyCounts();
  const stale = { entries: 0, changes: 0, holds: 0 };
  const allIds: number[] = [];
  for (const entry of entries) {
    if (typeof entry.id === "number") allIds.push(entry.id);
    if (options.staleBefore && entry.createdAt && entry.createdAt < options.staleBefore) {
      stale.entries += 1;
      stale.changes += changeCount(entry.summaries);
      stale.holds += entry.holds.length;
      continue;
    }
    const groupOf = (value: { communityId: number; privateName: string; builder: string }) => {
      let group = groups.get(value.communityId);
      if (!group) { group = { communityId: value.communityId, privateName: clip(value.privateName || `community ${value.communityId}`, NAME_MAX), builder: value.builder || "builder unknown", added: [], sold: [], reappeared: [], priceChanges: [], offers: [], holds: [], ids: new Set() }; groups.set(value.communityId, group); }
      if (typeof entry.id === "number") group.ids.add(entry.id);
      return group;
    };
    for (const summary of entry.summaries) {
      const group = groupOf(summary);
      group.added.push(...summary.added);
      group.sold.push(...summary.sold);
      group.reappeared.push(...summary.reappeared);
      group.priceChanges.push(...summary.priceChanges);
      group.offers.push(...offerGroups(summary.incentive));
    }
    for (const hold of entry.holds) groupOf(hold).holds.push(hold);
  }
  for (const group of Array.from(groups.values())) {
    // A home seen twice in a backlog (added, then sold) is listed in each list once.
    group.added = unique(group.added); group.sold = unique(group.sold); group.reappeared = unique(group.reappeared);
    counts.added += group.added.length; counts.sold += group.sold.length; counts.reappeared += group.reappeared.length;
    for (const change of group.priceChanges) { if (change.to < change.from) counts.drops += 1; else counts.increases += 1; }
    for (const offer of group.offers) countOffer(offer, counts);
    counts.catalogHolds += holdLines(group, "catalog").filter((line) => line.startsWith("- ")).length;
    counts.incentiveHolds += holdLines(group, "incentive").filter((line) => line.startsWith("- ")).length;
  }
  const list = Array.from(groups.values());
  const changed = list.filter((group) => group.added.length + group.sold.length + group.reappeared.length + group.priceChanges.length + group.offers.length > 0);
  const catalogHeld = list.filter((group) => group.holds.some((hold) => hold.kind === "catalog"));
  const incentiveHeld = list.filter((group) => group.holds.some((hold) => hold.kind === "incentive"));
  const changes = counts.added + counts.sold + counts.reappeared + counts.drops + counts.increases + counts.offers;
  const holds = counts.catalogHolds + counts.incentiveHolds;
  if (!changes && !holds && !stale.entries) return [];

  const label = options.label ?? "update";
  const glance = [
    `Builder Deals ${label}${options.now ? ` for ${chicagoDate(options.now)}` : ""}.`,
    "",
    "At a glance",
    ...(options.stats ? [`- Builder pages checked today: ${options.stats.checkedToday.toLocaleString("en-US")} (${options.stats.cleanToday.toLocaleString("en-US")} read cleanly, ${Math.max(0, options.stats.checkedToday - options.stats.cleanToday).toLocaleString("en-US")} held or not read).`] : []),
    `- Communities with news: ${list.length.toLocaleString("en-US")} (changes in ${changed.length.toLocaleString("en-US")}, holds in ${unique([...catalogHeld, ...incentiveHeld]).length.toLocaleString("en-US")}).`,
    `- Homes: ${counts.added.toLocaleString("en-US")} new, ${counts.sold.toLocaleString("en-US")} sold, ${counts.reappeared.toLocaleString("en-US")} back on the market.`,
    `- Prices: ${plural(counts.drops + counts.increases, "change")} (${counts.drops.toLocaleString("en-US")} down, ${counts.increases.toLocaleString("en-US")} up).`,
    `- Offers: ${plural(counts.offers, "update")} (${counts.autoPublished.toLocaleString("en-US")} published automatically, ${counts.cameOff.toLocaleString("en-US")} came off).`,
    `- Holds: ${counts.catalogHolds.toLocaleString("en-US")} need a look (catalog), ${counts.incentiveHolds.toLocaleString("en-US")} need nothing from you (offers held for review).`,
    ...(stale.entries ? [`- Older than the digest keeps (not listed): ${plural(stale.entries, "check")} with ${plural(stale.changes, "change")} and ${plural(stale.holds, "hold")}; Admin, Builder Deals shows the current state.`] : []),
  ].join("\n");

  const blocks: Array<EmailBlock<number>> = [{ text: glance, tags: allIds }];
  const section = (title: string, rows: Group[], render: (group: Group) => string[]) => {
    if (!rows.length) return;
    blocks.push({ text: `\n${title}` });
    for (const group of rows) blocks.push({ text: render(group).join("\n"), tags: Array.from(group.ids) });
  };
  const catalogNotes = new Set<string>();
  const incentiveNotes = new Set<string>();
  section("NEEDS A LOOK: catalog holds (the last good data stays live)", catalogHeld, (group) => holdLines(group, "catalog", catalogNotes));
  section("NEEDS NOTHING FROM YOU: offers held for review", incentiveHeld, (group) => holdLines(group, "incentive", incentiveNotes));
  if (holds) blocks.push({ text: `\n${HOLD_GUIDANCE}` });
  section("CHANGES BY COMMUNITY", changed, communityLine);
  blocks.push({ text: "\nReview in Admin, Builder Deals: /admin/deals" });

  const subject = holds && changes
    ? `Builder Deals ${label}: ${plural(changes, "change")}, ${plural(holds, "hold")}`
    : changes || !holds
      ? `Builder Deals ${label}: ${plural(changes, "change")}`
      : (() => {
        const names = unique([...catalogHeld, ...incentiveHeld].map((group) => group.privateName)).join(", ");
        return `Builder Deals hold: ${names.length <= 120 && catalogHeld.length + incentiveHeld.length <= 5 ? names : plural(unique([...catalogHeld, ...incentiveHeld]).length, "community", "communities")}`;
      })();
  const category = holds ? "deals_sync_hold" as const : "deals_sync_summary" as const;
  const parts = packEmailParts(blocks, options.limit ?? EMAIL_PART_MAX);
  return parts.map((part, index) => ({
    category,
    subject: parts.length > 1 ? partSubject(subject, index + 1, parts.length) : capSubject(subject),
    content: part.content,
    entryIds: part.tags,
    part: index + 1,
    parts: parts.length,
  }));
}

/** Entry ids every part of which was delivered: a part that failed keeps all the entries it names unsent. */
export function deliveredEntryIds(parts: ReadonlyArray<Pick<DigestEmail, "entryIds">>, delivered: readonly boolean[]): number[] {
  const failed = new Set<number>();
  const seen = new Set<number>();
  parts.forEach((part, index) => { for (const id of part.entryIds) { seen.add(id); if (!delivered[index]) failed.add(id); } });
  return Array.from(seen).filter((id) => !failed.has(id));
}
