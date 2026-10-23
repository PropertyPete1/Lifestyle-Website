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
import { dealHomes, dealPhotos, dealSettings } from "../drizzle/schema";
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

/**
 * The bound parameters of a rendered where clause, keyed by "column operator"
 * (e.g. "id =", "source_hash in", "id not in", "processing_attempts >="), so
 * the simulation reads predicates the way the database would.
 */
function paramsByColumn(where: unknown): Map<string, unknown[]> {
  const { sql, params } = renderWhere(where);
  const chunks = sql.split("?");
  const out = new Map<string, unknown[]>();
  let current = "";
  params.forEach((param, index) => {
    const match = /`(\w+)`\s*(not in \(|in \(|<>|<=|>=|=|<|>)\s*$/.exec(chunks[index]);
    if (match) current = `${match[1]} ${match[2].replace(" (", "")}`;
    out.set(current, [...(out.get(current) ?? []), param]);
  });
  return out;
}

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
  const lookupSelects: FakeOp[] = [];
  let failNextCandidateRead = 0;
  /** While set, candidate reads never answer (a hung database call). */
  let hangCandidateReads = false;

  const photoTables = new Set<unknown>([dealPhotos]);
  const selectPhotos = (op: FakeOp) => {
    const fields = (op.fields ?? {}) as Record<string, unknown>;
    const cols = paramsByColumn(op.where);
    if ("photo" in fields) {
      const photo = rows.get(cols.get("id =")?.[0] as number);
      return photo ? [{ photo: { ...photo }, home: homeOf(photo), community: communityOf(photo) }] : [];
    }
    candidateSelects.push(op);
    if (hangCandidateReads) return new Promise<never>(() => undefined) as unknown as unknown[];
    if (failNextCandidateRead > 0) { failNextCandidateRead--; throw new Error("priority query failed", { cause: new Error("Unknown column 'served.home_id' in 'where clause'") }); }
    const excluded = new Set(cols.get("id not in") ?? []);
    return Array.from(rows.values())
      .filter((photo) => due(photo) && !excluded.has(photo.id))
      .sort((a, b) => a.id - b.id)
      .slice(0, Math.min(op.limit ?? Infinity, options.candidateCap ?? Infinity))
      .map((photo) => ({ id: photo.id, sourceUrl: photo.sourceUrl, sourceHash: photo.sourceHash, builder: communityOf(photo)?.builder ?? null, communityId: homeOf(photo)?.communityId ?? null, originalVersion: photo.originalVersion }));
  };
  /** Sibling and donor lookups start from deal_homes and are confined to the candidates' communities. */
  const selectHomes = (op: FakeOp) => {
    lookupSelects.push(op);
    const fields = (op.fields ?? {}) as Record<string, unknown>;
    const cols = paramsByColumn(op.where);
    const communities = cols.get("community_id in") ?? [];
    const hashes = cols.get("source_hash in") ?? [];
    const inScope = Array.from(rows.values()).filter((photo) => communities.includes(homeOf(photo)?.communityId) && hashes.includes(photo.sourceHash));
    if ("originalStorageKey" in fields) {
      return inScope.filter((photo) => photo.originalStorageKey && photo.originalVersion)
        .map((photo) => ({ sourceUrl: photo.sourceUrl, originalStorageKey: photo.originalStorageKey, originalVersion: photo.originalVersion, builder: communityOf(photo)?.builder ?? null }));
    }
    const excluded = new Set(cols.get("id not in") ?? []);
    return inScope.filter((photo) => due(photo) && !excluded.has(photo.id)).sort((a, b) => a.id - b.id).slice(0, op.limit ?? Infinity)
      .map((photo) => ({ id: photo.id, sourceUrl: photo.sourceUrl, builder: communityOf(photo)?.builder ?? null }));
  };
  const selectSettings = (op: FakeOp) => {
    const key = paramsByColumn(op.where).get("key =")?.[0];
    const entry = Object.entries(options.settings ?? {}).find(([builder]) => photos.builderSettingsKey(builder) === key);
    return entry ? [{ key, value: JSON.stringify(entry[1]) }] : [];
  };
  /** A second module graph (vi.resetModules) has its own schema objects; route them to the same table. */
  const attachSchema = (schema: { dealPhotos: unknown; dealSettings: unknown; dealHomes: unknown }) => {
    photoTables.add(schema.dealPhotos);
    fake.onSelect(schema.dealPhotos, selectPhotos);
    fake.onSelect(schema.dealHomes, selectHomes);
    fake.onSelect(schema.dealSettings, selectSettings);
  };
  attachSchema({ dealPhotos, dealSettings, dealHomes });
  fake.setUpdateResult((op: FakeOp) => {
    if (!photoTables.has(op.table)) return [{ affectedRows: 1 }];
    const set = op.set ?? {};
    const cols = paramsByColumn(op.where);
    if (set.processingState === "processing") {
      const photo = rows.get(cols.get("id =")?.[0] as number);
      if (!photo || !due(photo)) return [{ affectedRows: 0 }];
      Object.assign(photo, { processingState: "processing", processingAttempts: photo.processingAttempts + 1, processingStartedAt: set.processingStartedAt, lastProcessingError: set.lastProcessingError });
      return [{ affectedRows: 1 }];
    }
    if (set.lastProcessingError === "processing_lease_expired" || set.lastProcessingError === "processing_abandoned") {
      const cutoff = parseDbDate(cols.get("processing_started_at <")?.[0]);
      const atLeast = cols.get("processing_attempts >=")?.[0] as number | undefined;
      const below = cols.get("processing_attempts <")?.[0] as number | undefined;
      let affected = 0;
      for (const photo of Array.from(rows.values())) {
        if (photo.processingState !== "processing" || !photo.processingStartedAt || photo.processingStartedAt >= cutoff) continue;
        if (atLeast !== undefined && photo.processingAttempts < atLeast) continue;
        if (below !== undefined && photo.processingAttempts >= below) continue;
        Object.assign(photo, set);
        affected++;
      }
      return [{ affectedRows: affected }];
    }
    if (set.processingState === "pending" && set.processingAttempts === 0 && cols.get("processing_state =")?.[0] === "failed") {
      // Once-per-boot recovery of failed rows, except permanent codes.
      const permanent = cols.get("last_processing_error not in") ?? [];
      let affected = 0;
      for (const photo of Array.from(rows.values())) {
        if (photo.processingState !== "failed" || (photo.lastProcessingError && permanent.includes(photo.lastProcessingError))) continue;
        Object.assign(photo, set);
        affected++;
      }
      return [{ affectedRows: affected }];
    }
    if (cols.has("last_processing_error =") && cols.has("processing_attempts =")) {
      const photo = rows.get(cols.get("id =")?.[0] as number);
      const matches = photo && photo.processingState === cols.get("processing_state =")?.[0] && photo.processingAttempts === cols.get("processing_attempts =")?.[0] && photo.lastProcessingError === cols.get("last_processing_error =")?.[0];
      if (!photo || !matches) return [{ affectedRows: 0 }];
      Object.assign(photo, set);
      if (set.processingState === "processed") processedWrites.push(photo.id);
      return [{ affectedRows: 1 }];
    }
    return [{ affectedRows: 0 }];
  });
  vi.mocked(getDb).mockResolvedValue(fake.db as never);
  return { fake, rows, processedWrites, candidateSelects, lookupSelects, attachSchema, failNextCandidateRead: (times = 1) => { failNextCandidateRead = times; }, hangCandidateReads: (hang: boolean) => { hangCandidateReads = hang; } };
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

describe("memory guards (the host stops a process at about 500-550 MB)", () => {
  afterEach(() => photos.setDealPhotoRssReader(null));
  const queue = () => simulatedQueue({
    communities: [community(1, "Perry Homes")],
    homes: [home(1, 1), home(2, 1), home(3, 1)],
    photos: [1, 2, 3].map((id) => ({ id, homeId: id, sourceUrl: `https://res.cloudinary.com/perryhomes/p/${id}.jpg` })),
    settings: { "Perry Homes": off("Perry Homes") },
  });

  it("starts no photo once the process is past PHOTO_RSS_STOP_MB, and leaves every row unclaimed", async () => {
    const sim = queue();
    vi.stubGlobal("fetch", vi.fn(async () => imageResponse(jpeg)));
    photos.setDealPhotoRssReader(() => (photos.PHOTO_RSS_STOP_MB + 10) * 1024 * 1024);
    const result = await photos.processPendingDealPhotos({ budgetMs: 60_000 });
    expect(result).toMatchObject({ processed: 0, stoppedForMemory: true });
    expect(Array.from(sim.rows.values()).every((row) => row.processingState === "pending" && row.processingAttempts === 0)).toBe(true);
  });

  it("closes the OCR worker after a drain that ends above PHOTO_RSS_RELEASE_MB, and the next drain starts a new one", async () => {
    queue();
    vi.stubGlobal("fetch", vi.fn(async () => imageResponse(jpeg)));
    const { createWorker } = await import("tesseract.js");
    photos.setDealPhotoRssReader(() => (photos.PHOTO_RSS_RELEASE_MB + 10) * 1024 * 1024);
    const first = await photos.processPendingDealPhotos({ budgetMs: 60_000, maxPhotos: 1 });
    expect(first).toMatchObject({ processed: 1, ocrReleased: true });
    const workersBefore = vi.mocked(createWorker).mock.calls.length;
    photos.setDealPhotoRssReader(() => 200 * 1024 * 1024);
    const second = await photos.processPendingDealPhotos({ budgetMs: 60_000, maxPhotos: 1 });
    expect(second.processed).toBe(1);
    expect(second.ocrReleased).toBeUndefined();
    expect(vi.mocked(createWorker).mock.calls.length).toBe(workersBefore + 1);
  });
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
    // The priority query itself ran (no plain-order fallback).
    expect(rest.warning).toBeUndefined();
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
      const row = sim.rows.get(id) as SimPhoto;
      expect(row.processedStorageKey).toBe(photos.dealPhotoMasterKey(id, row.processedVersion as string));
      expect(sha256(objects.get(row.processedStorageKey as string) as Buffer)).toBe(row.processedVersion);
    }
    // Same builder: identical masters. The other builder's region crop gives a different master.
    expect(sim.rows.get(1)?.processedVersion).toBe(sim.rows.get(3)?.processedVersion);
    expect(sim.rows.get(4)?.processedVersion).not.toBe(sim.rows.get(1)?.processedVersion);
    const tollMaster = await sharp(objects.get(sim.rows.get(4)?.processedStorageKey as string) as Buffer).metadata();
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
      const match = /masters\/(\d+)-[0-9a-f]{64}\.webp$/.exec(key);
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
  it("runs the real candidate query (node:sqlite): shown homes, then homes without a photo, covers first, cheapest first, oldest due; skips rows not due", async () => {
    // Loaded through Node directly: the test bundler does not know this newer builtin.
    const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      CREATE TABLE deal_communities (id INTEGER PRIMARY KEY, builder TEXT, active INTEGER, paused INTEGER);
      CREATE TABLE deal_homes (id INTEGER PRIMARY KEY, community_id INTEGER, status TEXT, price INTEGER);
      CREATE TABLE deal_photos (id INTEGER PRIMARY KEY, home_id INTEGER, source_url TEXT, source_hash TEXT, original_version TEXT, processing_state TEXT,
        next_processing_attempt_at TEXT, sort_order INTEGER, automatic_hidden INTEGER, admin_hidden INTEGER);`);
    const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString().slice(0, 23).replace("T", " ");
    sqlite.exec("INSERT INTO deal_communities VALUES (1, 'Perry Homes', 1, 0), (2, 'Perry Homes', 1, 1)");
    // Homes: A already shows a photo; B-F show none; G is sold; H is in a paused community.
    const homeRows: Array<[number, number, string, number | null]> = [[1, 1, "available", 350_000], [2, 1, "available", 300_000], [3, 1, "available", 500_000], [4, 1, "available", 400_000], [5, 1, "available", null], [6, 1, "available", 450_000], [7, 1, "sold", 100_000], [8, 2, "available", 200_000]];
    for (const row of homeRows) sqlite.prepare("INSERT INTO deal_homes VALUES (?, ?, ?, ?)").run(...row);
    const photo = sqlite.prepare("INSERT INTO deal_photos VALUES (?, ?, 'u', 'h', NULL, ?, ?, ?, ?, ?)");
    photo.run(100, 1, "processed", null, 0, 0, 0); // home A's served cover
    photo.run(101, 6, "processed", null, 0, 1, 0); // home F's only processed photo is auto-hidden: F shows nothing
    photo.run(2, 1, "pending", at(-60_000), 1, 1, 0); // A, second photo
    photo.run(3, 2, "pending", at(-60_000), 1, 1, 0); // B, second photo (B shows nothing)
    photo.run(4, 3, "pending", at(-60_000), 0, 1, 0); // C cover, 500k
    photo.run(5, 4, "pending", at(-60_000), 0, 1, 0); // D cover, 400k
    photo.run(7, 5, "pending", at(-60_000), 0, 1, 0); // E cover, no price
    photo.run(8, 6, "pending", at(-60_000), 0, 1, 0); // F cover, 450k
    photo.run(1, 7, "pending", at(-60_000), 0, 1, 0); // sold home
    photo.run(6, 8, "pending", at(-60_000), 0, 1, 0); // paused community
    photo.run(9, 4, "pending", at(+60_000), 0, 1, 0); // not due yet
    photo.run(10, 4, "processing", at(-60_000), 0, 1, 0); // claimed elsewhere
    photo.run(11, 2, "pending", at(-120_000), 0, 1, 0); // B cover, oldest due
    photo.run(12, 2, "pending", at(-60_000), 0, 1, 0); // B cover duplicate gallery entry, newer

    // The real query text, rendered by drizzle's MySQL query builder (backticks and ? placeholders run on SQLite too).
    const { QueryBuilder } = await import("drizzle-orm/mysql-core");
    const built = photos.dealPhotoCandidateQuery(new QueryBuilder() as never, new Date(), 40, [12]).toSQL();
    // TiDB rejects a correlated subquery in ORDER BY (error 1054): the query must not contain one.
    expect(built.sql).not.toMatch(/order by[^;]*exists/i);
    const params = built.params.map((value) => typeof value === "boolean" ? Number(value) : value instanceof Date ? value.toISOString().slice(0, 23).replace("T", " ") : value) as Array<string | number>;
    const ids = sqlite.prepare(built.sql).all(...params).map((row) => Number((row as { id: number }).id));
    // B's cover (11: shown, no photo, cover, 300k) before D (400k), F (450k), C (500k), then E (no price);
    // then B's second photo (no photo yet, position 1); then A's second photo (A already shows one);
    // then the homes nobody can see: sold (cheaper) and paused. 9 is not due, 10 is claimed, 12 was excluded.
    expect(ids).toEqual([11, 5, 8, 4, 7, 3, 2, 1, 6]);
    sqlite.close();
  });
});

describe("claims, leases and overlapping drains", () => {
  it("recovers a claim left by a dead run after three minutes and drops that run's late write", async () => {
    expect(photos.PROCESSING_LEASE_MS).toBe(3 * 60_000);
    const sim = simulatedQueue({
      communities: [community(1, "Perry Homes")],
      homes: [home(1, 1), home(2, 1)],
      photos: [
        // Claimed 11 minutes ago by an instance that was recycled.
        { id: 1, homeId: 1, sourceUrl: "https://res.cloudinary.com/perryhomes/p/1.jpg", processingState: "processing", processingAttempts: 1, lastProcessingError: "claim:dead", processingStartedAt: new Date(Date.now() - 4 * 60_000), nextProcessingAttemptAt: null },
        // Claimed a minute ago by a live run: left alone.
        { id: 2, homeId: 2, sourceUrl: "https://res.cloudinary.com/perryhomes/p/2.jpg", processingState: "processing", processingAttempts: 1, lastProcessingError: "claim:live", processingStartedAt: new Date(Date.now() - 60_000), nextProcessingAttemptAt: null },
      ],
      settings: { "Perry Homes": off("Perry Homes") },
    });
    vi.stubGlobal("fetch", vi.fn(async () => imageResponse(jpeg)));

    // Put back in the queue, after a five-minute pause rather than straight to the front.
    expect(await photos.processPendingDealPhotos({ budgetMs: 60_000 })).toMatchObject({ processed: 0 });
    expect(sim.rows.get(1)).toMatchObject({ processingState: "pending", processingAttempts: 1, lastProcessingError: "processing_lease_expired" });
    expect((sim.rows.get(1)?.nextProcessingAttemptAt as Date).getTime()).toBeGreaterThan(Date.now() + 90_000);
    expect(sim.rows.get(2)).toMatchObject({ processingState: "processing", processingAttempts: 1, lastProcessingError: "claim:live" });

    (sim.rows.get(1) as SimPhoto).nextProcessingAttemptAt = new Date(Date.now() - 1_000);
    expect(await photos.processPendingDealPhotos({ budgetMs: 60_000 })).toMatchObject({ processed: 1 });
    expect(sim.rows.get(1)).toMatchObject({ processingState: "processed", processingAttempts: 2 });

    // The dead run's fenced write (attempt 1, its token) no longer matches the row.
    const late = await sim.fake.db.update(dealPhotos).set({ processingState: "processed", automaticHidden: false }).where(photos.dealPhotoLeaseWhere(1, 1, "claim:dead"));
    expect(late).toEqual([{ affectedRows: 0 }]);
    expect(sim.processedWrites).toEqual([1]);
  });

  it("fails a claim abandoned on its last attempt for good (a photo that kills its instance is not retried forever), and the boot recovery leaves it alone", async () => {
    const sim = simulatedQueue({
      communities: [community(1, "Perry Homes")],
      homes: [home(1, 1), home(2, 1), home(3, 1)],
      photos: [
        { id: 1, homeId: 1, sourceUrl: "https://res.cloudinary.com/perryhomes/p/1.jpg", processingState: "processing", processingAttempts: 8, lastProcessingError: "claim:dead", processingStartedAt: new Date(Date.now() - 4 * 60_000), nextProcessingAttemptAt: null },
        // Cut off seven times so far (host aborts): still retried, not treated as a poison photo yet.
        { id: 3, homeId: 3, sourceUrl: "https://res.cloudinary.com/perryhomes/p/3.jpg", processingState: "processing", processingAttempts: 7, lastProcessingError: "claim:dead", processingStartedAt: new Date(Date.now() - 4 * 60_000), nextProcessingAttemptAt: null },
        // Failed under earlier code for a fixable reason: the boot recovery retries it.
        { id: 2, homeId: 2, sourceUrl: "https://res.cloudinary.com/perryhomes/p/2.jpg", processingState: "failed", processingAttempts: 5, lastProcessingError: "storage_unavailable", nextProcessingAttemptAt: null },
      ],
      settings: { "Perry Homes": off("Perry Homes") },
    });
    const fetchMock = vi.fn(async () => imageResponse(jpeg));
    vi.stubGlobal("fetch", fetchMock);
    expect(await photos.processPendingDealPhotos({ budgetMs: 60_000 })).toMatchObject({ processed: 1 });
    expect(sim.rows.get(1)).toMatchObject({ processingState: "failed", lastProcessingError: "processing_abandoned", automaticHidden: true, nextProcessingAttemptAt: null });
    expect(sim.rows.get(2)).toMatchObject({ processingState: "processed" });
    expect(sim.rows.get(3)).toMatchObject({ processingState: "pending", processingAttempts: 7, lastProcessingError: "processing_lease_expired" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // A new process boots: the recovery runs again and still skips the poison row.
    photos.resetDealPhotoRuntimeState();
    expect(await photos.processPendingDealPhotos({ budgetMs: 60_000 })).toMatchObject({ processed: 0 });
    expect(sim.rows.get(1)).toMatchObject({ processingState: "failed", lastProcessingError: "processing_abandoned" });
  });

  it("P1 (review probe): a stale run that loses its claim can never replace the master a published row points at, and a render refuses bytes that do not match", async () => {
    const sim = simulatedQueue({
      communities: [community(1, "Perry Homes")],
      homes: [home(1, 1, "8310 Whiskey River Dr")],
      photos: [{ id: 1, homeId: 1, sourceUrl: "https://res.cloudinary.com/perryhomes/p/1.jpg" }],
      settings: { "Perry Homes": off("Perry Homes") },
    });
    // The house number is only visible in the uncropped (480 px) image.
    ocr.recognize = async (bytes) => ((await sharp(bytes).metadata()).height === 480 ? [[{ text: "8310", confidence: 95, bbox: { x0: 10, y0: 400, x1: 60, y1: 430 } }]] : []);
    const gates: Array<() => void> = [];
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (++calls === 1) await new Promise<void>((resolve) => gates.push(resolve));
      return imageResponse(jpeg);
    }));
    const runA = photos.processDealPhoto(1);
    await waitFor(() => gates.length === 1);
    // Admin crops 200 px off the bottom and requeues while run A is in flight.
    Object.assign(sim.rows.get(1) as SimPhoto, { bottomCrop: 200, processingState: "pending", processingAttempts: 0, lastProcessingError: null, nextProcessingAttemptAt: new Date(Date.now() - 1000), processingStartedAt: null });
    expect(await photos.processDealPhoto(1)).toMatchObject({ processed: true, hidden: false });
    const published = { ...(sim.rows.get(1) as SimPhoto) };
    (gates.shift() as () => void)();
    // Run A finishes its uncropped master (OCR finds the house number) and loses its claim.
    expect(await runA).toEqual({ ok: false, skipped: true, leaseLost: true });
    expect(sim.rows.get(1)).toMatchObject({ processingState: "processed", automaticHidden: false, processedVersion: published.processedVersion, processedStorageKey: published.processedStorageKey });
    const servedBytes = objects.get(published.processedStorageKey as string) as Buffer;
    expect(sha256(servedBytes)).toBe(published.processedVersion);
    expect((await sharp(servedBytes).metadata()).height).toBe(280);
    // A's object went to its own version's key, which nothing references.
    const masters = Array.from(objects.keys()).filter((key) => key.startsWith("builder-deals-private/masters/1-"));
    expect(masters.length).toBe(2);

    // Even if the published object's bytes were replaced somehow, a lead render fails closed.
    const lead = { id: 9, name: null, instagramHandle: "propertypete", phoneE164: "+15125550100", status: "verified", expiresAt: new Date(Date.now() + 3_600_000) };
    sim.fake.onSelect(dealPhotos, () => [{ photo: { id: 1, processedStorageKey: published.processedStorageKey, processedVersion: published.processedVersion }, home: { id: 1 }, community: { id: 1 }, lead }]);
    objects.set(published.processedStorageKey as string, await sharp(jpeg).webp().toBuffer());
    expect(await photos.renderDealPhotoForLead(1, 9)).toBeNull();
  });

  it("P2 (review probe): after an admin requeue and a new claim with the same attempt count, the stale run is dropped and the new run wins", async () => {
    const sim = simulatedQueue({
      communities: [community(1, "Perry Homes")],
      homes: [home(1, 1, "100 Oak Bend")],
      photos: [{ id: 1, homeId: 1, sourceUrl: "https://res.cloudinary.com/perryhomes/p/1.jpg" }],
      settings: { "Perry Homes": off("Perry Homes") },
    });
    const gates: Array<() => void> = [];
    vi.stubGlobal("fetch", vi.fn(async () => {
      await new Promise<void>((resolve) => gates.push(resolve));
      return imageResponse(jpeg);
    }));
    const runA = photos.processDealPhoto(1);
    await waitFor(() => gates.length === 1);
    Object.assign(sim.rows.get(1) as SimPhoto, { bottomCrop: 200, processingState: "pending", processingAttempts: 0, lastProcessingError: null, nextProcessingAttemptAt: new Date(Date.now() - 1000), processingStartedAt: null });
    const runB = photos.processDealPhoto(1);
    await waitFor(() => gates.length === 2);
    // Same attempt count as A's claim: only the token tells them apart.
    expect(sim.rows.get(1)?.processingAttempts).toBe(1);
    (gates.shift() as () => void)(); // A finishes first
    expect(await runA).toEqual({ ok: false, skipped: true, leaseLost: true });
    (gates.shift() as () => void)();
    expect(await runB).toMatchObject({ processed: true });
    const row = sim.rows.get(1) as SimPhoto;
    expect(sim.processedWrites).toEqual([1]);
    expect((await sharp(objects.get(row.processedStorageKey as string) as Buffer).metadata()).height).toBe(280);
    expect(sha256(objects.get(row.processedStorageKey as string) as Buffer)).toBe(row.processedVersion);
  });

  it("a photo past its time limit is failed for retry (revoking the claim), its late result is dropped, and its lane stops starting photos", async () => {
    const sim = simulatedQueue({
      communities: [community(1, "Perry Homes")],
      homes: [home(1, 1), home(2, 1)],
      photos: [1, 2].map((id) => ({ id, homeId: id, sourceUrl: `https://res.cloudinary.com/perryhomes/p/${id}.jpg` })),
      settings: { "Perry Homes": off("Perry Homes") },
    });
    let releaseOcr: () => void = () => undefined;
    ocr.recognize = () => new Promise((resolve) => { releaseOcr = () => resolve([]); });
    vi.stubGlobal("fetch", vi.fn(async () => imageResponse(jpeg)));
    const result = await photos.processPendingDealPhotos({ budgetMs: 60_000, concurrency: 1, photoTimeoutMs: 300 });
    expect(result).toMatchObject({ timedOut: 1, retried: 1, processed: 0 });
    expect(sim.rows.get(1)).toMatchObject({ processingState: "pending", lastProcessingError: "processing_timeout" });
    // The lane stopped: photo 2 was never claimed.
    expect(sim.rows.get(2)).toMatchObject({ processingState: "pending", processingAttempts: 0 });
    releaseOcr();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(sim.processedWrites).toEqual([]);
    expect(sim.rows.get(1)).toMatchObject({ processingState: "pending", lastProcessingError: "processing_timeout", processedStorageKey: null });
    expect(photos.PHOTO_TIMEOUT_MS + photos.PHOTO_DRAIN_BUDGET_MS).toBeLessThanOrEqual(4 * 60_000);
  });

  it("surfaces a failed queue read in the result and the drain status, instead of a silent empty drain", async () => {
    const sim = simulatedQueue({
      communities: [community(1, "Perry Homes")],
      homes: [home(1, 1)],
      photos: [{ id: 1, homeId: 1, sourceUrl: "https://res.cloudinary.com/perryhomes/p/1.jpg" }],
      settings: { "Perry Homes": off("Perry Homes") },
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    // Both the priority read and the plain fallback fail: nothing can be read.
    sim.failNextCandidateRead(2);
    const result = await photos.processPendingDealPhotos({ budgetMs: 60_000 });
    expect(result).toMatchObject({ processed: 0, error: "queue_read_failed", errorDetail: "Unknown column 'served.home_id' in 'where clause'" });
    const statusWrite = sim.fake.opsFor("insert", dealSettings).map((op) => op.values as { key: string; value: string }).find((values) => values.key === "photos.drain.status");
    expect(JSON.parse(statusWrite?.value ?? "{}")).toMatchObject({ lastError: "queue_read_failed: Unknown column 'served.home_id' in 'where clause'", last: { error: "queue_read_failed" } });
  });

  it("keeps photos moving in plain due order when only the priority query fails, and reports why", async () => {
    const sim = simulatedQueue({
      communities: [community(1, "Perry Homes")],
      homes: [home(1, 1)],
      photos: [{ id: 1, homeId: 1, sourceUrl: "https://res.cloudinary.com/perryhomes/p/1.jpg" }],
      settings: { "Perry Homes": off("Perry Homes") },
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => imageResponse(jpeg)));
    sim.failNextCandidateRead(1);
    const result = await photos.processPendingDealPhotos({ budgetMs: 60_000 });
    expect(result.error).toBeUndefined();
    expect(result.processed).toBe(1);
    expect(result.warning).toBe("priority query failed: Unknown column 'served.home_id' in 'where clause'");
    const statusWrite = sim.fake.opsFor("insert", dealSettings).map((op) => op.values as { key: string; value: string }).find((values) => values.key === "photos.drain.status");
    expect(JSON.parse(statusWrite?.value ?? "{}")).toMatchObject({ lastError: null, lastWarning: "priority query failed: Unknown column 'served.home_id' in 'where clause'" });
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

describe("scheduled calls inside the host's 30 s limit", () => {
  const statusWrites = (sim: ReturnType<typeof simulatedQueue>) => sim.fake.opsFor("insert", dealSettings)
    .map((op) => op.values as { key: string; value: string })
    .filter((values) => values.key === "photos.drain.status")
    .map((values) => JSON.parse(values.value) as { lastHealthyAt: string | null; last: Record<string, unknown> });

  it("a cron drain stops starting photos after 20 s on its own clock", async () => {
    expect(photos.PHOTO_DRAIN_BUDGET_MS).toBe(20_000);
    simulatedQueue({
      communities: [community(1, "Perry Homes")],
      homes: Array.from({ length: 30 }, (_, i) => home(i + 1, 1)),
      photos: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, homeId: i + 1, sourceUrl: `https://res.cloudinary.com/perryhomes/p/${i + 1}.jpg` })),
      settings: { "Perry Homes": off("Perry Homes") },
    });
    let fakeNow = 5_000_000;
    vi.stubGlobal("fetch", vi.fn(async () => { fakeNow += 2_000; return imageResponse(jpeg); }));
    const result = await photos.runScheduledDealPhotoDrain({ clock: () => fakeNow, respondWithinMs: 60_000 });
    // 20 s of budget at 2 s a photo: about ten photos, then stop (no partial: the drain finished first).
    expect(result.processed).toBeGreaterThanOrEqual(10);
    expect(result.processed).toBeLessThanOrEqual(12);
    expect(result).toMatchObject({ stoppedForTime: true });
    expect(result.partial).toBeUndefined();
  });

  it("answers by its deadline with the counts so far (partial) and records them; the photo in flight then finishes, fenced on its claim", async () => {
    const sim = simulatedQueue({
      communities: [community(1, "Perry Homes")],
      homes: [home(1, 1), home(2, 1), home(3, 1)],
      photos: [1, 2, 3].map((id) => ({ id, homeId: id, sourceUrl: `https://res.cloudinary.com/perryhomes/p/${id}.jpg` })),
      settings: { "Perry Homes": off("Perry Homes") },
    });
    const gates: Array<() => void> = [];
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (++calls === 2) await new Promise<void>((resolve) => gates.push(resolve));
      return imageResponse(jpeg);
    }));
    // One lane: photo 1 finishes, photo 2 hangs in its download past the answer.
    const answer = await photos.runScheduledDealPhotoDrain({ respondWithinMs: 400, concurrency: 1 });
    expect(answer).toMatchObject({ partial: true, processed: 1 });
    await waitFor(() => statusWrites(sim).some((status) => status.last.partial === true));
    const partialStatus = statusWrites(sim).find((status) => status.last.partial === true);
    expect(partialStatus?.last).toMatchObject({ processed: 1, partial: true });
    // Claim taken back meanwhile (an admin requeue): the straggler's result is dropped.
    Object.assign(sim.rows.get(2) as SimPhoto, { processingState: "pending", processingAttempts: 0, lastProcessingError: null, nextProcessingAttemptAt: new Date(Date.now() + 60_000) });
    await waitFor(() => gates.length === 1);
    (gates.shift() as () => void)();
    await waitFor(() => statusWrites(sim).length === 2);
    // Photo 3 was started after the answer and published normally; photo 2's late result was dropped.
    expect(sim.processedWrites).toEqual([1, 3]);
    expect(sim.rows.get(2)).toMatchObject({ processingState: "pending", processedStorageKey: null });
  });

  it("a timed-out photo is retried at least five minutes later and gets eight tries before it fails for good", async () => {
    expect(photos.PHOTO_TIMEOUT_MS).toBeLessThanOrEqual(22_000);
    const sim = simulatedQueue({
      communities: [community(1, "Perry Homes")],
      homes: [home(1, 1), home(2, 1)],
      photos: [
        { id: 1, homeId: 1, sourceUrl: "https://res.cloudinary.com/perryhomes/p/1.jpg", processingAttempts: 4 },
        { id: 2, homeId: 2, sourceUrl: "https://res.cloudinary.com/perryhomes/p/2.jpg", processingAttempts: 7 },
      ],
      settings: { "Perry Homes": off("Perry Homes") },
    });
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    // Attempt 5: past the usual five-attempt cap, a timeout still retries.
    expect(await photos.processDealPhoto(1, undefined, { timeoutMs: 50 })).toMatchObject({ timedOut: true, retryScheduled: true });
    expect(sim.rows.get(1)).toMatchObject({ processingState: "pending", processingAttempts: 5, lastProcessingError: "processing_timeout" });
    expect((sim.rows.get(1)?.nextProcessingAttemptAt as Date).getTime()).toBeGreaterThanOrEqual(Date.now() + 5 * 60_000 - 1_000);
    // Attempt 8: failed for good.
    expect(await photos.processDealPhoto(2, undefined, { timeoutMs: 50 })).toMatchObject({ timedOut: true, retryScheduled: false });
    expect(sim.rows.get(2)).toMatchObject({ processingState: "failed", lastProcessingError: "processing_timeout" });
  });

  it("a hung drain never blocks: past 45 s a cron call runs its own beside it, at most two per process, and every call records a status", async () => {
    const sim = simulatedQueue({
      communities: [community(1, "Perry Homes")],
      homes: [home(1, 1), home(2, 1)],
      photos: [1, 2].map((id) => ({ id, homeId: id, sourceUrl: `https://res.cloudinary.com/perryhomes/p/${id}.jpg` })),
      settings: { "Perry Homes": off("Perry Homes") },
    });
    vi.stubGlobal("fetch", vi.fn(async () => imageResponse(jpeg)));
    const t0 = 9_000_000;
    // Drain A hangs on its queue read.
    sim.hangCandidateReads(true);
    void photos.processPendingDealPhotos({ budgetMs: 20_000, clock: () => t0 });
    await waitFor(() => sim.candidateSelects.length === 1);
    // 10 s later: A is fresh, so a cron call waits for it (within its tiny budget) and records a coalesced call.
    const waiting = await photos.processPendingDealPhotos({ budgetMs: 20, clock: (() => { let n = t0 + 10_000; return () => (n += 10); })() });
    expect(waiting).toMatchObject({ coalesced: true, processed: 0 });
    await waitFor(() => statusWrites(sim).length === 1);
    expect(statusWrites(sim)[0].last).toMatchObject({ coalesced: true });

    // 46 s later: A is presumed hung, B runs beside it and drains the queue.
    sim.hangCandidateReads(false);
    const b = await photos.processPendingDealPhotos({ budgetMs: 20_000, clock: () => t0 + 46_000 });
    expect(b).toMatchObject({ processed: 2, steppedAroundStaleDrain: true });
    expect(statusWrites(sim).at(-1)?.last).toMatchObject({ processed: 2 });

    // Two hung drains (A and a second one): the third call does not start a third.
    sim.hangCandidateReads(true);
    void photos.processPendingDealPhotos({ budgetMs: 20_000, clock: () => t0 + 50_000 });
    await waitFor(() => sim.candidateSelects.length === 4);
    const selectsBefore = sim.candidateSelects.length;
    const third = await photos.processPendingDealPhotos({ budgetMs: 20, clock: (() => { let n = t0 + 200_000; return () => (n += 10); })() });
    expect(third).toMatchObject({ coalesced: true });
    expect(sim.candidateSelects.length).toBe(selectsBefore);
  });
});

describe("per-photo cost and the overlapped original upload", () => {
  const scenario1 = () => simulatedQueue({
    communities: [community(1, "Perry Homes")],
    homes: [home(1, 1), home(2, 1)],
    photos: [1, 2].map((id) => ({ id, homeId: id, sourceUrl: `https://res.cloudinary.com/perryhomes/p/${id}.jpg` })),
    settings: { "Perry Homes": off("Perry Homes") },
  });

  it("reports busy time per stage for the drain (download, normalize, master, OCR, store)", async () => {
    scenario1();
    vi.stubGlobal("fetch", vi.fn(async () => { await new Promise((resolve) => setTimeout(resolve, 15)); return imageResponse(jpeg); }));
    const result = await photos.processPendingDealPhotos({ budgetMs: 60_000 });
    expect(result.processed).toBe(2);
    expect(Object.keys(result.stageMs ?? {}).sort()).toEqual(["download", "master", "normalize", "ocr", "store"]);
    expect(result.stageMs?.download).toBeGreaterThanOrEqual(25);
    for (const stage of photos.DEAL_PHOTO_STAGES) expect(result.stageMs?.[stage]).toBeGreaterThan(0);
  });

  it("makes the master and runs OCR while the original uploads, and publishes only once the upload has finished", async () => {
    const sim = scenario1();
    vi.stubGlobal("fetch", vi.fn(async () => imageResponse(jpeg)));
    let releaseOriginal: () => void = () => undefined;
    vi.mocked(storagePut).mockImplementation(async (key, data) => {
      if (key.includes("/originals/")) await new Promise<void>((resolve) => { releaseOriginal = resolve; });
      objects.set(key, Buffer.from(data as Buffer));
      return { key, url: `/manus-storage/${key}` };
    });
    const run = photos.processDealPhoto(1);
    await waitFor(() => ocr.calls === 1);
    // OCR has run while the original upload is still open; nothing is published yet.
    expect(sim.rows.get(1)?.processingState).toBe("processing");
    expect(sim.processedWrites).toEqual([]);
    releaseOriginal();
    expect(await run).toMatchObject({ processed: true, hidden: false });
    expect(sim.rows.get(1)).toMatchObject({ processingState: "processed", originalStorageKey: "builder-deals-private/originals/1.webp" });
  });

  it("does not publish when the original upload fails, and keeps a finished upload on any other failure so the retry does not download again", async () => {
    const sim = scenario1();
    vi.stubGlobal("fetch", vi.fn(async () => imageResponse(jpeg)));
    vi.mocked(storagePut).mockImplementation(async (key, data) => {
      if (key.includes("/originals/1.")) throw new Error("store down");
      objects.set(key, Buffer.from(data as Buffer));
      return { key, url: `/manus-storage/${key}` };
    });
    expect(await photos.processDealPhoto(1)).toMatchObject({ ok: false, retryScheduled: true });
    expect(sim.rows.get(1)).toMatchObject({ processingState: "pending", lastProcessingError: "storage_unavailable", originalStorageKey: null, processedStorageKey: null });

    // Photo 2: the original stores fine, then OCR fails.
    ocr.recognize = async () => { throw new Error("worker crashed"); };
    expect(await photos.processDealPhoto(2)).toMatchObject({ ok: false, retryScheduled: true });
    const row = sim.rows.get(2) as SimPhoto;
    expect(row).toMatchObject({ processingState: "pending", lastProcessingError: "ocr_unavailable", originalStorageKey: "builder-deals-private/originals/2.webp", processedStorageKey: null });
    expect(row.originalVersion).toBe(sha256(objects.get("builder-deals-private/originals/2.webp") as Buffer));
  });
});
