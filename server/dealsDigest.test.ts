import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dealCommunities, dealJobRuns, dealSyncDigestEntries } from "../drizzle/schema";
import { FakeDealsDb } from "./dealsSync.fakeDb";
import { realisticDigestDay } from "./dealsDigest.test-support";
import { EMAIL_PART_MAX, EMAIL_SUBJECT_MAX, OWNER_NOTIFICATION_CONTENT_MAX, OWNER_NOTIFICATION_TITLE_MAX, capSubject, emailSize, packEmailParts, splitEmailContent } from "./dealsEmailLimits";
import { composeBuilderDealsDigest, deliveredEntryIds } from "./dealsDigest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), sendBuilderDealsEmail: vi.fn(), processPendingDealPhotos: vi.fn() }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));
vi.mock("./dealsEmail", () => ({ sendBuilderDealsEmail: (...args: unknown[]) => mocks.sendBuilderDealsEmail(...args) }));
vi.mock("./dealsPhotos", () => ({ processPendingDealPhotos: (...args: unknown[]) => mocks.processPendingDealPhotos(...args) }));

import { DIGEST_KEEP_DAYS, DIGEST_MAX_ATTEMPTS, sendSyncDigestIfReady } from "./dealsSync";

type Sent = { category: string; subject: string; content: string; recipients: string[] };
const sent = () => mocks.sendBuilderDealsEmail.mock.calls.map(([input]) => input as Sent);
/** 10:05 AM Chicago, Tuesday Oct 21 2026: the morning slot. */
const MORNING = new Date("2026-10-21T15:05:00Z");

let db: FakeDealsDb;

function seedDay(day = realisticDigestDay(), createdAt = new Date(MORNING.getTime() - 3_600_000)) {
  const ids: number[] = [];
  day.summaries.forEach((summaries, index) => {
    const holds = day.holds[index]!;
    if (summaries.length || holds.length) ids.push(db.seed(dealSyncDigestEntries, { summaries: JSON.stringify(summaries), holds: JSON.stringify(holds), createdAt }));
  });
  return ids;
}

beforeEach(() => {
  db = new FakeDealsDb();
  mocks.getDb.mockResolvedValue(db);
  mocks.sendBuilderDealsEmail.mockResolvedValue({ ok: true, status: "owner_only_fallback", deliveryLog: "owner only" });
  mocks.processPendingDealPhotos.mockResolvedValue({});
});
afterEach(() => vi.clearAllMocks());

describe("email limits", () => {
  it("caps a subject at a word and leaves a short one alone", () => {
    expect(capSubject("Builder Deals update: 3 changes")).toBe("Builder Deals update: 3 changes");
    const long = capSubject(`Builder Deals hold: ${Array.from({ length: 80 }, (_, index) => `Community ${index}`).join(", ")}`);
    expect(long.length).toBeLessThanOrEqual(EMAIL_SUBJECT_MAX);
    expect(long.endsWith("…")).toBe(true);
  });

  it("splits by block, never drops text, and numbers the parts", () => {
    const blocks = Array.from({ length: 50 }, (_, index) => ({ text: `block ${index} ${"x".repeat(900)}`, tags: [index] }));
    const parts = packEmailParts(blocks, 10_000);
    expect(parts.length).toBe(5);
    for (const [index, part] of parts.entries()) {
      expect(part.content.length).toBeLessThanOrEqual(10_000);
      expect(part.content.startsWith(`Part ${index + 1} of 5`)).toBe(true);
    }
    expect(parts.flatMap((part) => part.tags).sort((a, b) => a - b)).toEqual(blocks.map((_, index) => index));
    for (const index of [0, 17, 49]) expect(parts.some((part) => part.content.includes(`block ${index} `))).toBe(true);
    // A single line longer than a part is cut, not lost.
    const giant = splitEmailContent("y".repeat(45_000), 18_000);
    expect(giant.every((part) => part.length <= 18_000)).toBe(true);
    expect(giant.join("").replace(/Part \d of \d[^\n]*\n\n/g, "").length).toBe(45_000);
  });

  it("caps every part by UTF-8 bytes as well as characters", () => {
    // "—" and "é" are 3 and 2 bytes: 18,000 characters of them would be far over 18,000 bytes.
    const lines = Array.from({ length: 600 }, (_, index) => `- Résidence ${index} — Château Élan: ${"—".repeat(40)}`);
    const parts = splitEmailContent(lines.join("\n"), 18_000);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) { expect(emailSize(part)).toBeLessThanOrEqual(18_000); expect(part.length).toBeLessThanOrEqual(18_000); }
    for (const index of [0, 299, 599]) expect(parts.some((part) => part.includes(`- Résidence ${index} —`))).toBe(true);
    // A single multi-byte line longer than a part is cut on a character boundary, never mid-character.
    const giant = splitEmailContent("😀".repeat(10_000), 18_000);
    expect(giant.every((part) => emailSize(part) <= 18_000 && !part.includes("\uFFFD"))).toBe(true);
    expect(giant.join("").replace(/Part \d of \d[^\n]*\n\n/g, "")).toBe("😀".repeat(10_000));
  });
});

describe("Builder Deals digest", () => {
  it("says accurately what a multi-part summary holds: every community, with long lists shortened", () => {
    const day = realisticDigestDay();
    const messages = composeBuilderDealsDigest(day.summaries.map((summaries, index) => ({ id: index + 1, summaries, holds: day.holds[index]! })), { label: "morning summary" });
    expect(messages.length).toBeGreaterThan(1);
    for (const message of messages) {
      expect(message.content.startsWith(`Part ${message.part} of ${messages.length}`)).toBe(true);
      expect(message.content.split("\n")[0]).toContain(`Every community in this summary is included across the ${messages.length} parts; long lists of homes and offers are shortened ("+N more")`);
      expect(message.content).not.toContain("Nothing was left out");
      expect(emailSize(message.content)).toBeLessThanOrEqual(EMAIL_PART_MAX);
    }
  });

  it("stops retrying a slot after its last attempt, records it, and lets the evening follow-up carry the entries", async () => {
    seedDay(realisticDigestDay({ communities: 6, seed: 5 }));
    mocks.sendBuilderDealsEmail.mockResolvedValue({ ok: false, status: "owner_only_fallback", deliveryLog: "owner only", error: "Owner notification was not accepted" });
    for (let attempt = 1; attempt <= DIGEST_MAX_ATTEMPTS; attempt++) expect(await sendSyncDigestIfReady(new Date(MORNING.getTime() + attempt * 10 * 60_000), true)).toBe("waiting");
    expect(sent()).toHaveLength(DIGEST_MAX_ATTEMPTS);
    const slot = () => db.rows(dealJobRuns).find((row) => row.jobName === "builder-deals-sync-digest-morning")!;
    expect(slot()).toMatchObject({ status: "failed", detail: expect.stringMatching(new RegExp(`^attempt ${DIGEST_MAX_ATTEMPTS}: .*No more tries in this slot`)) });
    // The rest of the day's batches leave the morning slot alone.
    mocks.sendBuilderDealsEmail.mockClear();
    expect(await sendSyncDigestIfReady(new Date(MORNING.getTime() + 3 * 3_600_000), true)).toBe("waiting");
    expect(sent()).toEqual([]);
    expect(db.rows(dealSyncDigestEntries).every((row) => row.sentAt === null)).toBe(true);
    // 7:05 PM: the evening follow-up sends them.
    mocks.sendBuilderDealsEmail.mockResolvedValue({ ok: true, status: "owner_only_fallback", deliveryLog: "owner only" });
    expect(await sendSyncDigestIfReady(new Date("2026-10-22T00:05:00Z"), true)).toBe("sent");
    expect(sent()[0]!.subject).toMatch(/^Builder Deals evening follow-up: /);
    expect(db.rows(dealSyncDigestEntries).every((row) => row.sentAt !== null)).toBe(true);
    expect(db.rows(dealJobRuns).find((row) => row.jobName === "builder-deals-sync-digest-evening")).toMatchObject({ status: "ok", detail: expect.stringMatching(/^attempt 1: /) });
  });

  it("was over the owner-notification limit in the old format (the root cause) and now fits in numbered parts that lose nothing", () => {
    const day = realisticDigestDay();
    const entries = day.summaries.map((summaries, index) => ({ id: index + 1, summaries, holds: day.holds[index]! })).filter((entry) => entry.summaries.length || entry.holds.length);
    const messages = composeBuilderDealsDigest(entries, { label: "morning summary", now: MORNING, stats: { checkedToday: 320, cleanToday: 306 } });
    const total = messages.reduce((sum, message) => sum + message.content.length, 0);
    // This heavy day (320 checks, 600+ new homes) measured 89,245 characters in the old one-email format: 4.5x the
    // 20,000 the owner notification accepts, so the send threw, the slot failed and the backlog grew. The compact
    // format is about a third smaller and goes out in a few parts, each under the limit.
    expect(total).toBeLessThan(60_000);
    expect(messages.length).toBeGreaterThan(1);
    for (const message of messages) {
      expect(message.content.length).toBeLessThanOrEqual(EMAIL_PART_MAX);
      expect(message.content.length + 300).toBeLessThan(OWNER_NOTIFICATION_CONTENT_MAX);
      expect(message.subject.length).toBeLessThanOrEqual(Math.min(EMAIL_SUBJECT_MAX, OWNER_NOTIFICATION_TITLE_MAX));
      expect(message.subject).toMatch(new RegExp(`\\(${message.part}/${messages.length}\\)$`));
      expect(message.category).toBe("deals_sync_hold");
    }
    const all = messages.map((message) => message.content).join("\n");
    // Every community with news is named; every entry id rides with a part.
    for (const entry of entries) for (const summary of entry.summaries) expect(all).toContain(`- ${summary.privateName} (${summary.builder})`);
    expect(new Set(messages.flatMap((message) => message.entryIds))).toEqual(new Set(entries.map((entry) => entry.id)));
    // The summary leads part 1.
    expect(messages[0]!.content).toContain("At a glance");
    expect(messages[0]!.content).toMatch(/- Builder pages checked today: 320 \(306 read cleanly, 14 held or not read\)\./);
    expect(messages[0]!.content).toMatch(/- Holds: \d+ need a look \(catalog\), \d+ need nothing from you/);
    // Long lists are capped.
    expect(all).toMatch(/, \+\d+ more/);
  });

  it("counts each change once in the subject and caps a hold-only subject", () => {
    const holds = Array.from({ length: 40 }, (_, index) => ({ communityId: index + 1, privateName: `Long Community Name Number ${index}`, builder: "Lennar", kind: "catalog" as const, reason: "community_fetch_failed" }));
    const [message] = composeBuilderDealsDigest([{ id: 1, summaries: [], holds }], { label: "update" });
    expect(message!.subject).toBe("Builder Deals hold: 40 communities");
    const few = composeBuilderDealsDigest([{ id: 1, summaries: [], holds: holds.slice(0, 2) }]);
    expect(few[0]!.subject).toBe("Builder Deals hold: Long Community Name Number 0, Long Community Name Number 1");
    const lapse = composeBuilderDealsDigest([{ id: 1, summaries: [{ communityId: 1, privateName: "A", builder: "B", added: [], sold: [], reappeared: [], priceChanges: [], incentive: ["came off the page: reached its close-by date (2026-10-18)", "  \"Dated promo\""] }], holds: [] }], { label: "evening follow-up" });
    expect(lapse[0]!.subject).toBe("Builder Deals evening follow-up: 1 change");
    expect(lapse[0]!.content).toContain("    offer: came off the page: reached its close-by date (2026-10-18) \"Dated promo\"");
  });

  it("marks an entry delivered only when every part naming it went out", () => {
    const parts = [{ entryIds: [1, 2, 3] }, { entryIds: [1, 2] }, { entryIds: [1, 3] }];
    expect(deliveredEntryIds(parts, [true, true, false]).sort()).toEqual([2]);
    expect(deliveredEntryIds(parts, [true, true, true]).sort()).toEqual([1, 2, 3]);
  });

  it("sends a 300-community morning in parts; a failed part keeps only its entries for the next try, which sends the rest without repeating what went", async () => {
    const ids = seedDay();
    db.seed(dealCommunities, Array.from({ length: 5 }, (_, index) => ({ builder: "Lennar", privateName: `C${index}`, sourceUrl: "https://www.lennar.com/x", privateAddress: "", publicLabel: "L", areaLabel: "A", reelCode: `c${index}`, scrubList: "[]", active: true, lastAttemptAt: new Date(MORNING.getTime() - 3_600_000), lastSuccessfulSyncAt: index < 4 ? new Date(MORNING.getTime() - 3_600_000) : null })));
    // The owner notification refuses the second part.
    mocks.sendBuilderDealsEmail.mockImplementation(async (input: Sent) => (/\(2\/\d\)$/.test(input.subject) ? { ok: false, status: "owner_only_fallback", deliveryLog: "owner only", error: "Owner notification was not accepted" } : { ok: true, status: "owner_only_fallback", deliveryLog: "owner only" }));
    expect(await sendSyncDigestIfReady(MORNING, true)).toBe("waiting");
    const firstTry = sent();
    expect(firstTry.length).toBeGreaterThan(1);
    expect(firstTry[0]!.subject).toMatch(/^Builder Deals morning summary: [\d,]+ changes, \d+ holds \(1\/\d\)$/);
    expect(firstTry[0]!.content).toContain("- Builder pages checked today: 5 (4 read cleanly, 1 held or not read).");
    const slot = db.rows(dealJobRuns).find((row) => row.jobName === "builder-deals-sync-digest-morning")!;
    expect(slot).toMatchObject({ status: "failed", detail: expect.stringMatching(/failed part 2: Owner notification was not accepted/) });
    const unsentAfterFirst = db.rows(dealSyncDigestEntries).filter((row) => row.sentAt === null).map((row) => row.id as number);
    // Only the communities listed in the refused part stay unsent; everything that went out is marked sent.
    expect(unsentAfterFirst.length).toBeGreaterThan(0);
    expect(unsentAfterFirst.length).toBeLessThan(ids.length / 2);
    const refused = firstTry[1]!.content;
    const names = (content: string) => Array.from(content.matchAll(/^- ([^:\n]+?) \([^()\n]+\)[:,] /gm), (match) => match[1]!);
    const refusedNames = names(refused);

    mocks.sendBuilderDealsEmail.mockClear();
    mocks.sendBuilderDealsEmail.mockResolvedValue({ ok: true, status: "owner_only_fallback", deliveryLog: "owner only" });
    expect(await sendSyncDigestIfReady(new Date(MORNING.getTime() + 10 * 60_000), true)).toBe("sent");
    expect(db.rows(dealSyncDigestEntries).every((row) => row.sentAt !== null)).toBe(true);
    // The retry is the refused part's communities only (a fresh, smaller summary), not the whole morning again.
    const retry = sent().map((message) => message.content).join("\n");
    expect(retry.length).toBeLessThan(firstTry.reduce((sum, message) => sum + message.content.length, 0) / 2);
    for (const name of refusedNames) expect(retry).toContain(`- ${name} (`);
    const firstPartNames = names(firstTry[0]!.content).filter((name) => !refusedNames.includes(name));
    expect(firstPartNames.length).toBeGreaterThan(0);
    for (const name of firstPartNames) expect(retry).not.toContain(`- ${name} (`);
    expect(db.rows(dealJobRuns).find((row) => row.jobName === "builder-deals-sync-digest-morning")).toMatchObject({ status: "ok" });
    for (const message of sent()) expect(message.content.length).toBeLessThanOrEqual(EMAIL_PART_MAX);
    // Spent: a later batch sends nothing more this morning.
    mocks.sendBuilderDealsEmail.mockClear();
    expect(await sendSyncDigestIfReady(new Date(MORNING.getTime() + 20 * 60_000), true)).toBe("nothing_new");
    expect(sent()).toEqual([]);
  });

  it("keeps a partly-sent backlog small: only the entries of the failed part stay unsent when part 1 is not the one that names them", async () => {
    // Two entries, forced into separate parts by a tiny limit through many homes each.
    const big = (communityId: number) => ({ communityId, privateName: `Big ${communityId}`, builder: "Lennar", added: [], sold: [], reappeared: [], priceChanges: [], incentive: Array.from({ length: 3 }, (_, index) => `New incentive published: "${String(index).repeat(290)}"`) });
    const messages = composeBuilderDealsDigest([{ id: 1, summaries: [big(1)], holds: [] }, { id: 2, summaries: [big(2)], holds: [] }], { limit: 1_200 });
    expect(messages.length).toBeGreaterThanOrEqual(2);
    // Part 1 (the summary) names both; a failure of the part listing only "Big 2" keeps entry 2 alone.
    const failing = messages.findIndex((message) => message.content.includes("- Big 2 (Lennar)"));
    expect(failing).toBeGreaterThan(0);
    const delivered = deliveredEntryIds(messages, messages.map((_, index) => index !== failing));
    expect(delivered).toEqual([1]);
  });

  it("counts unsent entries older than the keep window in one line instead of listing them", async () => {
    const old = new Date(MORNING.getTime() - (DIGEST_KEEP_DAYS + 2) * 86_400_000);
    seedDay(realisticDigestDay({ communities: 200, seed: 3 }), old);
    seedDay(realisticDigestDay({ communities: 4, catalogHolds: 0, incentiveHolds: 0, seed: 11 }));
    expect(await sendSyncDigestIfReady(MORNING, true)).toBe("sent");
    const content = sent().map((message) => message.content).join("\n");
    expect(content).toMatch(/- Older than the digest keeps \(not listed\): \d+ checks with [\d,]+ changes and \d+ holds/);
    expect(sent()).toHaveLength(1);
    expect(db.rows(dealSyncDigestEntries).every((row) => row.sentAt !== null)).toBe(true);
  });
});
