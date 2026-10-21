/**
 * Photo queue throughput: the time-budgeted drain, lane and per-host bounds,
 * same-source reuse (and its limits), priority order, lease fencing and
 * stale-claim recovery, and overlapping drains. The database is a small
 * in-memory deal_photos table behind the drizzle fake from dealsPhotosTestKit,
 * so claims and fenced writes behave like the real conditional UPDATEs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import sharp from "sharp";
import { dealPhotos, dealSettings } from "../drizzle/schema";
import { createFakeDb, renderOrderBy, renderWhere, type FakeOp } from "./dealsPhotosTestKit";

type FakeWord = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } };
const ocr = vi.hoisted(() => ({
  recognize: null as null | ((bytes: Buffer) => Promise<FakeWord[][]>),
  calls: 0,
}));

vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./storage", () => ({ storagePut: vi.fn(), storageReadPrivate: vi.fn(), storageDelete: vi.fn() }));
vi.mock("tesseract.js", () => ({
  createWorker: vi.fn(async () => ({
    recognize: async (bytes: Buffer) => {
      ocr.calls++;
      const lines = ocr.recognize ? await ocr.recognize(bytes) : [];
      return { data: { blocks: lines.length ? [{ paragraphs: [{ lines: lines.map((words) => ({ words })) }] }] : [] } };
    },
    terminate: async () => undefined,
  })),
}));

import { getDb } from "./db";
import { storageDelete, storagePut, storageReadPrivate } from "./storage";
import * as photos from "./dealsPhotos";

const sha256 = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");
const objects = new Map<string, Buffer>();
let jpeg: Buffer;

type Community = { id: number; builder: string; privateName: string; scrubList: string; active: boolean; paused: boolean };
type Home = { id: number; communityId: number; privateAddress: string | null; privatePlanName: string | null; status: string; price: number | null };
type SimPhoto = {
  id: number; homeId: number; sourceUrl: string; sourceHash: string; originalStorageKey: string | null; processedStorageKey: string | null;
  originalVersion: string | null; processedVersion: string | null; automaticHidden: boolean; adminHidden: boolean;
  processingState: "pending" | "processing" | "processed" | "failed"; processingAttempts: number; nextProcessingAttemptAt: Date | null;
  processingStartedAt: Date | null; lastProcessingError: string | null; processedAt: Date | null; ocrMatches: string; bottomCrop: number; sortOrder: number;
  createdAt: Date; updatedAt: Date;
};

const parseDbDate = (value: unknown) => value instanceof Date ? value : new Date(`${String(value).replace(" ", "T")}Z`);
const isHash = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

/** A tiny deal_photos table: answers the drain's selects and applies claims and fenced writes like MySQL would. */
function simulatedQueue(options: { communities: Community[]; homes: Home[]; photos: Array<Partial<SimPhoto> & { id: number; homeId: number; sourceUrl: string }>; settings?: Record<string, photos.BuilderPhotoSettings>; candidateCap?: number }) {
  const fake = createFakeDb();
  const now = () => new Date();
  const rows = new Map<number, SimPhoto>(options.photos.map((photo) => [photo.id, {
    sourceHash: sha256(photo.sourceUrl), originalStorageKey: null, processedStorageKey: null, originalVersion: null, processedVersion: null,
    automaticHidden: true, adminHidden: false, processingState: "pending", processingAttempts: 0, nextProcessingAttemptAt: new Date(Date.now() - 1_000),
    processingStartedAt: null, lastProcessingError: null, processedAt: null, ocrMatches: "[]", bottomCrop: 0, sortOrder: 0, createdAt: new Date(), updatedAt: new Date(),
    ...photo,
  } as SimPhoto]));
  const homeOf = (photo: SimPhoto) => options.homes.find((home) => home.id === photo.homeId);
  const communityOf = (photo: SimPhoto) => { const home = homeOf(photo); return options.communities.find((community) => community.id === home?.communityId); };
  const due = (photo: SimPhoto) => photo.processingState === "pending" && photo.nextProcessingAttemptAt !== null && photo.nextProcessingAttemptAt <= now();
  const processedWrites: number[] = [];
  const candidateSelects: FakeOp[] = [];

  const photoTables = new Set<unknown>([dealPhotos]);
  const selectPhotos = (op: FakeOp) => {
    const fields = (op.fields ?? {}) as Record<string, unknown>;
    const where = renderWhere(op.where);
    if ("photo" in fields) {
      const photo = rows.get(where.params[0] as number);
      return photo ? [{ photo: { ...photo }, home: homeOf(photo), community: communityOf(photo) }] : [];
    }
    const hashes = where.params.filter(isHash);
    if ("originalStorageKey" in fields) {
      return Array.from(rows.values()).filter((photo) => hashes.includes(photo.sourceHash) && photo.originalStorageKey && photo.originalVersion)
        .map((photo) => ({ sourceUrl: photo.sourceUrl, originalStorageKey: photo.originalStorageKey, originalVersion: photo.originalVersion, builder: communityOf(photo)?.builder ?? null }));
    }
    const excluded = new Set(where.params.filter((param): param is number => typeof param === "number"));
    const isSiblings = hashes.length > 0;
    if (!isSiblings) candidateSelects.push(op);
    const matching = Array.from(rows.values())
      .filter((photo) => due(photo) && !excluded.has(photo.id) && (!isSiblings || hashes.includes(photo.sourceHash)))
      .sort((a, b) => a.id - b.id)
      .slice(0, Math.min(op.limit ?? Infinity, isSiblings ? Infinity : options.candidateCap ?? Infinity));
    return matching.map((photo) => ({ id: photo.id, sourceUrl: photo.sourceUrl, sourceHash: photo.sourceHash, builder: communityOf(photo)?.builder ?? null }));
  };
  const selectSettings = (op: FakeOp) => {
    const key = renderWhere(op.where).params[0];
    const entry = Object.entries(options.settings ?? {}).find(([builder]) => photos.builderSettingsKey(builder) === key);
    return entry ? [{ key, value: JSON.stringify(entry[1]) }] : [];
  };
  /** A second module graph (vi.resetModules) has its own schema objects; route them to the same table. */
  const attachSchema = (schema: { dealPhotos: unknown; dealSettings: unknown }) => {
    photoTables.add(schema.dealPhotos);
    fake.onSelect(schema.dealPhotos, selectPhotos);
    fake.onSelect(schema.dealSettings, selectSettings);
  };
  attachSchema({ dealPhotos, dealSettings });
  fake.setUpdateResult((op: FakeOp) => {
    if (!photoTables.has(op.table)) return [{ affectedRows: 1 }];
    const set = op.set ?? {};
    const where = renderWhere(op.where);
    if (set.processingState === "processing") {
      const photo = rows.get(where.params[0] as number);
      if (!photo || !due(photo)) return [{ affectedRows: 0 }];
      Object.assign(photo, { processingState: "processing", processingAttempts: photo.processingAttempts + 1, processingStartedAt: set.processingStartedAt, lastProcessingError: null });
      return [{ affectedRows: 1 }];
    }
    if (set.lastProcessingError === "processing_lease_expired") {
      const cutoff = parseDbDate(where.params.find((param) => param !== "processing"));
      let affected = 0;
      for (const photo of Array.from(rows.values())) {
        if (photo.processingState === "processing" && photo.processingStartedAt && photo.processingStartedAt < cutoff) {
          Object.assign(photo, { processingState: "pending", nextProcessingAttemptAt: set.nextProcessingAttemptAt, processingStartedAt: null, lastProcessingError: "processing_lease_expired" });
          affected++;
        }
      }
      return [{ affectedRows: affected }];
    }
    if (where.sql.includes("`processing_attempts` =")) {
      const [id, state, attempts] = where.params as [number, string, number];
      const photo = rows.get(id);
      if (!photo || photo.processingState !== state || photo.processingAttempts !== attempts) return [{ affectedRows: 0 }];
      Object.assign(photo, set);
      if (set.processingState === "processed") processedWrites.push(id);
      return [{ affectedRows: 1 }];
    }
    return [{ affectedRows: 0 }];
  });
  vi.mocked(getDb).mockResolvedValue(fake.db as never);
  return { fake, rows, processedWrites, candidateSelects, attachSchema };
}

const community = (id: number, builder: string, privateName = `Community ${id}`): Community => ({ id, builder, privateName, scrubList: JSON.stringify([builder, privateName]), active: true, paused: false });
const home = (id: number, communityId: number, privateAddress: string | null = `${100 + id} Oak Bend`): Home => ({ id, communityId, privateAddress, privatePlanName: "Magnolia", status: "available", price: 300_000 + id });
const off = (builder: string): photos.BuilderPhotoSettings => ({ enabled: false, region: null, keywords: [], reviewedSampleIds: [], revision: "test" });
const imageResponse = (bytes: Buffer) => new Response(bytes, { status: 200, headers: { "content-type": "image/jpeg", "content-length": String(bytes.byteLength) } });
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
async function waitFor(condition: () => boolean, attempts = 600) {
  for (let i = 0; i < attempts && !condition(); i++) await tick();
  expect(condition()).toBe(true);
}

beforeEach(async () => {
  jpeg ??= await sharp({ create: { width: 640, height: 480, channels: 3, background: "#d9e4ec" } }).jpeg().toBuffer();
  objects.clear();
  ocr.recognize = null;
  ocr.calls = 0;
  photos.resetDealPhotoRuntimeState();
  vi.mocked(storagePut).mockImplementation(async (key, data) => { objects.set(key, Buffer.from(data as Buffer)); return { key, url: `/manus-storage/${key}` }; });
  vi.mocked(storageReadPrivate).mockImplementation(async (key) => { const data = objects.get(key); if (!data) throw new Error("missing object"); return { data, contentType: "image/webp" }; });
  vi.mocked(storageDelete).mockImplementation(async (key) => objects.delete(key));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.mocked(getDb).mockReset();
  vi.mocked(storagePut).mockReset();
  vi.mocked(storageReadPrivate).mockReset();
  vi.mocked(storageDelete).mockReset();
});

describe("time-budgeted drain", () => {
  it("keeps starting photos past the old fixed count until the budget is spent, then stops claiming and lets in-flight work finish", async () => {
    const sim = simulatedQueue({
      communities: [community(1, "Perry Homes")],
      homes: Array.from({ length: 80 }, (_, i) => home(i + 1, 1)),
      photos: Array.from({ length: 80 }, (_, i) => ({ id: i + 1, homeId: i + 1, sourceUrl: `https://res.cloudinary.com/perryhomes/p/${i + 1}.jpg` })),
      settings: { "Perry Homes": off("Perry Homes") },
    });
    let fakeNow = 1_000_000;
    // Each download "takes" two seconds of the budget.
    vi.stubGlobal("fetch", vi.fn(async () => { fakeNow += 2_000; return imageResponse(jpeg); }));

    const result = await photos.processPendingDealPhotos({ budgetMs: 100_000, clock: () => fakeNow });

    // 100 s / 2 s per photo = 50 started (plus at most one per lane already past the check) — more than the old cap of 40, far fewer than 80.
    expect(result.processed).toBeGreaterThanOrEqual(50);
    expect(result.processed).toBeLessThanOrEqual(52);
    expect(result.stoppedForTime).toBe(true);
    const untouched = Array.from(sim.rows.values()).filter((row) => row.processingState === "pending");
    expect(untouched.length).toBe(80 - result.processed);
    // Nothing is left claimed: rows past the budget were never claimed at all.
    expect(Array.from(sim.rows.values()).some((row) => row.processingState === "processing")).toBe(false);
    expect(untouched.every((row) => row.processingAttempts === 0)).toBe(true);
    // Refills read 40 candidates at a time in priority order.
    expect(sim.candidateSelects[0].limit).toBe(40);
  }, 60_000);

  it("ends early with stoppedForTime false when the queue runs dry, and a count-limited kick still stops at its count", async () => {
    simulatedQueue({
      communities: [community(1, "Perry Homes")],
      homes: [home(1, 1), home(2, 1), home(3, 1)],
      photos: [1, 2, 3].map((id) => ({ id, homeId: id, sourceUrl: `https://res.cloudinary.com/perryhomes/p/${id}.jpg` })),
      settings: { "Perry Homes": off("Perry Homes") },
    });
    vi.stubGlobal("fetch", vi.fn(async () => imageResponse(jpeg)));
    expect(await photos.processPendingDealPhotos(2)).toMatchObject({ processed: 2 });
    const rest = await photos.processPendingDealPhotos({ budgetMs: 60_000 });
    expect(rest).toMatchObject({ processed: 1, stoppedForTime: false });
  });
});

describe("lanes and per-host politeness", () => {
  async function peakDownloads(concurrency: number, hostFor: (id: number) => string) {
    photos.resetDealPhotoRuntimeState();
    simulatedQueue({
      communities: [community(1, "Perry Homes")],
      homes: Array.from({ length: 8 }, (_, i) => home(i + 1, 1)),
      photos: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, homeId: i + 1, sourceUrl: hostFor(i + 1) })),
      settings: { "Perry Homes": off("Perry Homes") },
    });
    let inFlight = 0;
    let peak = 0;
    const perHost = new Map<string, number>();
    let peakPerHost = 0;
    const gates: Array<() => void> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: URL) => {
      const host = new URL(String(input)).hostname;
      inFlight++;
      perHost.set(host, (perHost.get(host) ?? 0) + 1);
      peak = Math.max(peak, inFlight);
      peakPerHost = Math.max(peakPerHost, perHost.get(host) ?? 0);
      await new Promise<void>((resolve) => gates.push(resolve));
      inFlight--;
      perHost.set(host, (perHost.get(host) ?? 0) - 1);
      return imageResponse(jpeg);
    }));
    const drain = photos.processPendingDealPhotos({ budgetMs: 60_000, concurrency });
    for (let released = 0; released < 8; released++) {
      await waitFor(() => gates.length > 0);
      (gates.shift() as () => void)();
    }
    expect(await drain).toMatchObject({ processed: 8 });
    return { peak, peakPerHost };
  }

  it("keeps the default two photos in flight, honours a higher lane count, and never sends more than two downloads to one host", async () => {
    expect(photos.PHOTO_PROCESSING_CONCURRENCY).toBe(2);
    expect(await peakDownloads(photos.PHOTO_PROCESSING_CONCURRENCY, (id) => `https://res.cloudinary.com/perryhomes/p/${id}.jpg`)).toEqual({ peak: 2, peakPerHost: 2 });
    // Four lanes, one host: the host limit holds at two.
    expect(await peakDownloads(4, (id) => `https://res.cloudinary.com/perryhomes/p/${id}.jpg`)).toEqual({ peak: 2, peakPerHost: 2 });
    // Four lanes over two hosts: four in flight, still two per host.
    expect(await peakDownloads(4, (id) => id % 2 ? `https://res.cloudinary.com/perryhomes/p/${id}.jpg` : `https://www.drhorton.com/p/${id}.jpg`)).toEqual({ peak: 4, peakPerHost: 2 });
  }, 60_000);
});

describe("same-source reuse", () => {
  it("downloads and OCRs a shared plan photo once per builder, yet decides publish or hide per home and stores each row's own objects", async () => {
    const shared = "https://dam.mihomes.com/plans/magnolia-front.jpg";
    const sim = simulatedQueue({
      communities: [community(1, "Perry Homes", "Sienna Lakes"), community(2, "Toll Brothers", "Rough Hollow")],
      // Home 2's own house number (8310) is painted on the front in the shared photo.
      homes: [home(1, 1, "100 Oak Bend"), home(2, 1, "8310 Whiskey River Dr"), home(3, 1, "220 Elm St"), home(4, 2, "300 Pine Rd")],
      photos: [1, 2, 3, 4].map((id) => ({ id, homeId: id, sourceUrl: shared })),
      settings: { "Perry Homes": off("Perry Homes"), "Toll Brothers": { enabled: true, region: { x: 0, y: 80, width: 100, height: 20 }, keywords: [], reviewedSampleIds: [], revision: "test" } },
    });
    const fetchMock = vi.fn(async () => imageResponse(jpeg));
    vi.stubGlobal("fetch", fetchMock);
    ocr.recognize = async () => [[{ text: "8310", confidence: 92, bbox: { x0: 200, y0: 200, x1: 260, y1: 230 } }]];

    const result = await photos.processPendingDealPhotos({ budgetMs: 60_000, concurrency: 1 });

    expect(result).toMatchObject({ processed: 3, hidden: 1 });
    // One download and one OCR for the three Perry homes; the Toll Brothers row (another builder) did its own.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(ocr.calls).toBe(2);
    expect(result.reused).toMatchObject({ originals: 2, masters: 2, ocr: 2 });
    // Only the home whose own number is in the photo is hidden.
    expect(sim.rows.get(2)).toMatchObject({ processingState: "processed", automaticHidden: true });
    expect(JSON.parse(sim.rows.get(2)?.ocrMatches ?? "[]")).toEqual([expect.objectContaining({ term: "8310" })]);
    for (const id of [1, 3, 4]) expect(sim.rows.get(id)).toMatchObject({ processingState: "processed", automaticHidden: false });
    // Every row stores its own original and master under its own keys.
    for (const id of [1, 2, 3, 4]) {
      expect(objects.has(`builder-deals-private/originals/${id}.webp`)).toBe(true);
      expect(objects.has(`builder-deals-private/masters/${id}.webp`)).toBe(true);
      expect(sim.rows.get(id)?.processedStorageKey).toBe(`builder-deals-private/masters/${id}.webp`);
    }
    // Same builder: identical masters. The other builder's region crop gives a different master.
    expect(sim.rows.get(1)?.processedVersion).toBe(sim.rows.get(3)?.processedVersion);
    expect(sim.rows.get(4)?.processedVersion).not.toBe(sim.rows.get(1)?.processedVersion);
    const tollMaster = await sharp(objects.get("builder-deals-private/masters/4.webp") as Buffer).metadata();
    expect(tollMaster.height).toBe(480 - Math.round(480 * 0.2));
  });

  it("queues same-source rows right behind their candidate, and a first import reads another row's stored original instead of downloading", async () => {
    const shared = "https://res.cloudinary.com/perryhomes/p/shared.jpg";
    const stored = await photos.normalizeDealPhotoOriginal(jpeg);
    objects.set("builder-deals-private/originals/90.webp", stored);
    const sim = simulatedQueue({
      communities: [community(1, "Perry Homes")],
      homes: [home(1, 1), home(2, 1), home(3, 1), home(90, 1)],
      photos: [
        { id: 1, homeId: 1, sourceUrl: shared },
        { id: 2, homeId: 2, sourceUrl: "https://res.cloudinary.com/perryhomes/p/other.jpg" },
        { id: 3, homeId: 3, sourceUrl: shared },
        // Processed in an earlier run: its stored original is the donor.
        { id: 90, homeId: 90, sourceUrl: shared, processingState: "processed", originalStorageKey: "builder-deals-private/originals/90.webp", originalVersion: sha256(stored) },
      ],
      settings: { "Perry Homes": off("Perry Homes") },
      candidateCap: 2,
    });
    // The candidate read returns rows 1 and 2 only; row 3 must arrive as row 1's sibling.
    const order: number[] = [];
    const fetched: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: URL) => { fetched.push(String(input)); return imageResponse(jpeg); }));
    vi.mocked(storagePut).mockImplementation(async (key, data) => {
      const match = /masters\/(\d+)\.webp$/.exec(key);
      if (match) order.push(Number(match[1]));
      objects.set(key, Buffer.from(data as Buffer));
      return { key, url: `/manus-storage/${key}` };
    });

    const result = await photos.processPendingDealPhotos({ budgetMs: 60_000, concurrency: 1 });

    expect(result).toMatchObject({ processed: 3 });
    expect(order).toEqual([1, 3, 2]);
    expect(fetched).toEqual(["https://res.cloudinary.com/perryhomes/p/other.jpg"]);
    expect(vi.mocked(storageReadPrivate)).toHaveBeenCalledWith("builder-deals-private/originals/90.webp");
    expect(sim.rows.get(1)?.originalVersion).toBe(sha256(stored));
    expect(sim.rows.get(3)?.originalStorageKey).toBe("builder-deals-private/originals/3.webp");
  });

  it("never takes a donor original from another builder, and downloads when the donor copy fails its digest", async () => {
    const shared = "https://dam.mihomes.com/plans/front.jpg";
    objects.set("builder-deals-private/originals/90.webp", await photos.normalizeDealPhotoOriginal(jpeg));
    objects.set("builder-deals-private/originals/91.webp", Buffer.from("corrupt"));
    simulatedQueue({
      communities: [community(1, "Perry Homes"), community(2, "Toll Brothers")],
      homes: [home(1, 1), home(90, 2), home(2, 2), home(91, 1)],
      photos: [
        { id: 1, homeId: 1, sourceUrl: shared },
        { id: 90, homeId: 90, sourceUrl: shared, processingState: "processed", originalStorageKey: "builder-deals-private/originals/90.webp", originalVersion: sha256(objects.get("builder-deals-private/originals/90.webp") as Buffer) },
      ],
      settings: { "Perry Homes": off("Perry Homes") },
    });
    const fetchMock = vi.fn(async () => imageResponse(jpeg));
    vi.stubGlobal("fetch", fetchMock);
    expect(await photos.processPendingDealPhotos({ budgetMs: 60_000 })).toMatchObject({ processed: 1 });
    // The only donor belongs to Toll Brothers: Perry's row downloads its own copy.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.mocked(storageReadPrivate)).not.toHaveBeenCalledWith("builder-deals-private/originals/90.webp");

    photos.resetDealPhotoRuntimeState();
    simulatedQueue({
      communities: [community(1, "Perry Homes")],
      homes: [home(1, 1), home(91, 1)],
      photos: [
        { id: 1, homeId: 1, sourceUrl: shared },
        { id: 91, homeId: 91, sourceUrl: shared, processingState: "processed", originalStorageKey: "builder-deals-private/originals/91.webp", originalVersion: "a".repeat(64) },
      ],
      settings: { "Perry Homes": off("Perry Homes") },
    });
    fetchMock.mockClear();
    expect(await photos.processPendingDealPhotos({ budgetMs: 60_000 })).toMatchObject({ processed: 1 });
    expect(vi.mocked(storageReadPrivate)).toHaveBeenCalledWith("builder-deals-private/originals/91.webp");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("priority order", () => {
  it("reads due rows with shown homes first, then homes without a photo yet, covers before later photos, cheapest first", async () => {
    const sim = simulatedQueue({ communities: [], homes: [], photos: [] });
    await photos.processPendingDealPhotos({ budgetMs: 60_000 });
    const order = renderOrderBy(sim.candidateSelects[0].orderBy);
    expect(order[0]).toMatch(/CASE WHEN \(`deal_homes`\.`status` = 'available' AND `deal_communities`\.`active` = 1 AND `deal_communities`\.`paused` = 0\) THEN 0 ELSE 1 END/);
    expect(order[1]).toMatch(/CASE WHEN EXISTS \(SELECT 1 FROM `deal_photos` AS served WHERE served\.home_id = `deal_photos`\.`home_id` AND served\.processing_state = 'processed' AND served\.automatic_hidden = 0 AND served\.admin_hidden = 0\) THEN 1 ELSE 0 END/);
    expect(order[2]).toMatch(/`deal_photos`\.`sort_order` asc/);
    expect(order[3]).toMatch(/`deal_homes`\.`price` IS NULL/);
    expect(order[4]).toMatch(/`deal_homes`\.`price` asc/);
    expect(order[5]).toMatch(/`next_processing_attempt_at` asc/);
    expect(order[6]).toMatch(/`deal_photos`\.`id` asc/);
    // Orphan rows (home gone) are still read, last: the joins are left joins.
    expect(sim.candidateSelects[0].joins.length).toBe(2);
    expect(renderWhere(sim.candidateSelects[0].where).params).toEqual(expect.arrayContaining(["pending"]));
  });
});

describe("claims, leases and overlapping drains", () => {
  it("recovers a claim left by a dead run after ten minutes and drops that run's late write", async () => {
    expect(photos.PROCESSING_LEASE_MS).toBe(10 * 60_000);
    const sim = simulatedQueue({
      communities: [community(1, "Perry Homes")],
      homes: [home(1, 1), home(2, 1)],
      photos: [
        // Claimed 11 minutes ago by an instance that was recycled.
        { id: 1, homeId: 1, sourceUrl: "https://res.cloudinary.com/perryhomes/p/1.jpg", processingState: "processing", processingAttempts: 1, processingStartedAt: new Date(Date.now() - 11 * 60_000), nextProcessingAttemptAt: null },
        // Claimed 2 minutes ago by a live run: left alone.
        { id: 2, homeId: 2, sourceUrl: "https://res.cloudinary.com/perryhomes/p/2.jpg", processingState: "processing", processingAttempts: 1, processingStartedAt: new Date(Date.now() - 2 * 60_000), nextProcessingAttemptAt: null },
      ],
      settings: { "Perry Homes": off("Perry Homes") },
    });
    vi.stubGlobal("fetch", vi.fn(async () => imageResponse(jpeg)));

    expect(await photos.processPendingDealPhotos({ budgetMs: 60_000 })).toMatchObject({ processed: 1 });
    expect(sim.rows.get(1)).toMatchObject({ processingState: "processed", processingAttempts: 2 });
    expect(sim.rows.get(2)).toMatchObject({ processingState: "processing", processingAttempts: 1 });

    // The dead run's fenced write (attempt 1) no longer matches the row (attempt 2).
    const late = await sim.fake.db.update(dealPhotos).set({ processingState: "processed", automaticHidden: false }).where(photos.dealPhotoLeaseWhere(1, 1));
    expect(late).toEqual([{ affectedRows: 0 }]);
    expect(sim.processedWrites).toEqual([1]);
  });

  it("drops a result whose lease was lost mid-flight instead of overwriting the row", async () => {
    const sim = simulatedQueue({
      communities: [community(1, "Perry Homes")],
      homes: [home(1, 1)],
      photos: [{ id: 1, homeId: 1, sourceUrl: "https://res.cloudinary.com/perryhomes/p/1.jpg" }],
      settings: { "Perry Homes": off("Perry Homes") },
    });
    vi.stubGlobal("fetch", vi.fn(async () => {
      // An admin requeues the row while it downloads.
      Object.assign(sim.rows.get(1) as SimPhoto, { processingState: "pending", processingAttempts: 0, nextProcessingAttemptAt: new Date(Date.now() + 60_000) });
      return imageResponse(jpeg);
    }));
    expect(await photos.processDealPhoto(1)).toEqual({ ok: false, skipped: true, leaseLost: true });
    expect(sim.rows.get(1)).toMatchObject({ processingState: "pending", processingAttempts: 0, processedStorageKey: null });
    expect(sim.processedWrites).toEqual([]);
  });

  it("two drains on different instances over one queue process every row exactly once", async () => {
    const sim = simulatedQueue({
      communities: [community(1, "Perry Homes")],
      homes: Array.from({ length: 12 }, (_, i) => home(i + 1, 1)),
      photos: Array.from({ length: 12 }, (_, i) => ({ id: i + 1, homeId: i + 1, sourceUrl: `https://res.cloudinary.com/perryhomes/p/${i + 1}.jpg` })),
      settings: { "Perry Homes": off("Perry Homes") },
    });
    vi.stubGlobal("fetch", vi.fn(async () => { await tick(); return imageResponse(jpeg); }));
    // A second module instance is a second process: its own drain guard, the same database.
    vi.resetModules();
    const other = await import("./dealsPhotos");
    const otherDb = await import("./db");
    const otherStorage = await import("./storage");
    sim.attachSchema(await import("../drizzle/schema"));
    vi.mocked(otherDb.getDb).mockResolvedValue(sim.fake.db as never);
    vi.mocked(otherStorage.storagePut).mockImplementation(async (key, data) => { objects.set(key, Buffer.from(data as Buffer)); return { key, url: `/manus-storage/${key}` }; });
    vi.mocked(otherStorage.storageReadPrivate).mockImplementation(async (key) => { const data = objects.get(key); if (!data) throw new Error("missing object"); return { data, contentType: "image/webp" }; });

    const [a, b] = await Promise.all([photos.processPendingDealPhotos({ budgetMs: 60_000 }), other.processPendingDealPhotos({ budgetMs: 60_000 })]);

    expect(a.processed + b.processed).toBe(12);
    expect(a.processed).toBeGreaterThan(0);
    expect(b.processed).toBeGreaterThan(0);
    expect(sim.processedWrites.slice().sort((x, y) => x - y)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(Array.from(sim.rows.values()).every((row) => row.processingState === "processed" && row.processingAttempts === 1)).toBe(true);
  }, 60_000);

  it("in one process, a cron drain waits for a running kick drain (never two side by side) and a kick during a cron drain coalesces", async () => {
    simulatedQueue({
      communities: [community(1, "Perry Homes")],
      homes: Array.from({ length: 4 }, (_, i) => home(i + 1, 1)),
      photos: Array.from({ length: 4 }, (_, i) => ({ id: i + 1, homeId: i + 1, sourceUrl: `https://res.cloudinary.com/perryhomes/p/${i + 1}.jpg` })),
      settings: { "Perry Homes": off("Perry Homes") },
    });
    const gates: Array<() => void> = [];
    let inFlight = 0;
    let peak = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => gates.push(resolve));
      inFlight--;
      return imageResponse(jpeg);
    }));
    const kick = photos.processPendingDealPhotos(1);
    await waitFor(() => gates.length === 1);
    const cron = photos.processPendingDealPhotos({ budgetMs: 60_000 });
    await tick();
    // The cron drain has not started a second drain beside the kick.
    expect(gates.length).toBe(1);
    (gates.shift() as () => void)();
    expect(await kick).toMatchObject({ processed: 1 });
    await waitFor(() => gates.length === 2);
    expect(await photos.processPendingDealPhotos(5)).toMatchObject({ coalesced: true, processed: 0 });
    for (let released = 0; released < 3; released++) {
      await waitFor(() => gates.length > 0);
      (gates.shift() as () => void)();
    }
    const result = await cron;
    expect(result).toMatchObject({ processed: 3 });
    expect(result.waitedMs).toBeGreaterThanOrEqual(0);
    expect(peak).toBe(2);
  }, 30_000);
});
