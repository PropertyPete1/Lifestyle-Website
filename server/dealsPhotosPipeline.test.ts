import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { dealCommunities, dealLeads, dealPhotoRenders, dealPhotos, dealSettings } from "../drizzle/schema";
import { createFakeDb, renderWhere, type FakeDb, type FakeOp } from "./dealsPhotosTestKit";

type FakeWord = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } };
const ocr = vi.hoisted(() => ({
  /** Lines of words the fake worker "reads" from an image; receives the image bytes so it can react to crops. */
  recognize: null as null | ((bytes: Buffer) => Promise<FakeWord[][]>),
  calls: 0,
  terminated: 0,
  createOptions: [] as Array<Record<string, unknown>>,
}));

vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./storage", () => ({ storagePut: vi.fn(), storageReadPrivate: vi.fn(), storageDelete: vi.fn() }));
vi.mock("tesseract.js", () => ({
  createWorker: vi.fn(async (_lang: string, _oem: number, options: Record<string, unknown>) => {
    ocr.createOptions.push(options);
    return {
      recognize: async (bytes: Buffer) => {
        ocr.calls++;
        const lines = ocr.recognize ? await ocr.recognize(bytes) : [];
        return { data: { blocks: lines.length ? [{ paragraphs: [{ lines: lines.map((words) => ({ words })) }] }] : [] } };
      },
      terminate: async () => { ocr.terminated++; },
    };
  }),
}));

import { getDb } from "./db";
import { storageDelete, storagePut, storageReadPrivate } from "./storage";
import * as photos from "./dealsPhotos";

const sha256 = (value: Buffer) => crypto.createHash("sha256").update(value).digest("hex");
const objects = new Map<string, Buffer>();
const WIDTH = 1600;
const HEIGHT = 1200;

async function listingPhotoJpeg(options: { bottomText?: string; width?: number; height?: number } = {}) {
  const width = options.width ?? WIDTH;
  const height = options.height ?? HEIGHT;
  const bottomText = options.bottomText ?? "Chesmar Homes";
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="${height}" fill="#d9e4ec"/>
    <rect x="${width * 0.125}" y="${height / 3}" width="${width * 0.75}" height="${height / 2}" fill="#b08968"/>
    <rect x="0" y="${height * 0.9}" width="${width}" height="${height * 0.1}" fill="#ffffff"/>
    <text x="${width * 0.04}" y="${height * 0.97}" font-family="Arial" font-size="${Math.round(height * 0.06)}" font-weight="700" fill="#102a43">${bottomText}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

const bottomBandWords = (height: number): FakeWord[][] => [[
  { text: "Chesmar", confidence: 93, bbox: { x0: 60, y0: Math.round(height * 0.92), x1: 420, y1: Math.round(height * 0.985) } },
  { text: "Homes", confidence: 91, bbox: { x0: 440, y0: Math.round(height * 0.92), x1: 700, y1: Math.round(height * 0.985) } },
]];

function imageResponse(bytes: Buffer, contentType = "image/jpeg") {
  return new Response(bytes, { status: 200, headers: { "content-type": contentType, "content-length": String(bytes.byteLength) } });
}

type Row = { photo: Record<string, unknown>; home: Record<string, unknown>; community: Record<string, unknown> };
function photoRow(overrides: { photo?: Record<string, unknown>; home?: Record<string, unknown>; community?: Record<string, unknown> } = {}): Row {
  return {
    photo: { id: 7, homeId: 3, sourceUrl: "https://dam.mihomes.com/gallery/front.jpg", originalStorageKey: null, processedStorageKey: null, sourceHash: "src", originalVersion: null, automaticHidden: true, adminHidden: false, processingState: "processing", processingAttempts: 1, nextProcessingAttemptAt: null, processingStartedAt: new Date(), lastProcessingError: null, processedVersion: null, processedAt: null, ocrMatches: "[]", bottomCrop: 0, sortOrder: 0, createdAt: new Date(), updatedAt: new Date(), ...overrides.photo },
    home: { id: 3, communityId: 2, privateAddress: "8310 Whiskey River Dr", privatePlanName: "Magnolia", status: "available", ...overrides.home },
    community: { id: 2, builder: "Chesmar", privateName: "Sienna Lakes", scrubList: JSON.stringify(["Chesmar", "Sienna Lakes", "M/I Financial"]), watermarkRemovalApproved: false, active: true, paused: false, ...overrides.community },
  };
}

const settingsRow = (builder: string, settings: Partial<photos.BuilderPhotoSettings>) => ({
  key: photos.builderSettingsKey(builder),
  value: JSON.stringify({ enabled: true, region: null, keywords: [], reviewedSampleIds: [], revision: "test", ...settings }),
});

function scenario(options: { row?: Row; settings?: ReturnType<typeof settingsRow> | null } = {}) {
  const fake = createFakeDb();
  const row = options.row ?? photoRow();
  fake.onSelect(dealPhotos, (op: FakeOp) => {
    const fields = op.fields as Record<string, unknown> | undefined;
    if (fields && "photo" in fields) return [row];
    return [];
  });
  if (options.settings === null || options.settings === undefined) fake.onSelect(dealSettings, [], []);
  else fake.onSelect(dealSettings, [options.settings]);
  vi.mocked(getDb).mockResolvedValue(fake.db as never);
  return { fake, row };
}

const finalPhotoUpdate = (fake: FakeDb) => fake.updatesFor(dealPhotos).at(-1) ?? {};
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
async function waitFor(condition: () => boolean, attempts = 400) {
  for (let i = 0; i < attempts && !condition(); i++) await tick();
  expect(condition()).toBe(true);
}

beforeEach(() => {
  objects.clear();
  ocr.recognize = null;
  ocr.calls = 0;
  ocr.terminated = 0;
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

describe("processDealPhoto: pipeline steps 1 to 6", () => {
  it("seeds the launch builder defaults, crops the bottom region off, and publishes a text-free photo", async () => {
    const jpeg = await listingPhotoJpeg();
    vi.stubGlobal("fetch", vi.fn(async () => imageResponse(jpeg)));
    const { fake } = scenario({ settings: null });
    ocr.recognize = async (bytes) => ((await sharp(bytes).metadata()).height ?? 0) >= HEIGHT ? bottomBandWords(HEIGHT) : [];

    const result = await photos.processDealPhoto(7);

    expect(result).toMatchObject({ ok: true, processed: true, hidden: false, regionAction: "cropped" });
    const seeded = fake.opsFor("insert", dealSettings)[0]?.values as { key: string; value: string };
    expect(seeded.key).toBe(photos.builderSettingsKey("Chesmar"));
    expect(JSON.parse(seeded.value)).toMatchObject({ enabled: true, region: photos.DEFAULT_LAUNCH_WATERMARK_REGION });
    expect(JSON.parse(JSON.stringify(photos.defaultBuilderPhotoSettings("M/I Homes")))).toMatchObject({ enabled: true, region: photos.DEFAULT_LAUNCH_WATERMARK_REGION });
    expect(photos.defaultBuilderPhotoSettings("Perry Homes")).toMatchObject({ enabled: false, region: null });

    const master = objects.get("builder-deals-private/masters/7.webp");
    const original = objects.get("builder-deals-private/originals/7.webp");
    expect(master && original).toBeTruthy();
    const masterMeta = await sharp(master as Buffer).metadata();
    expect(masterMeta.width).toBe(WIDTH);
    expect(masterMeta.height).toBe(HEIGHT - Math.round(HEIGHT * 0.12));
    expect(masterMeta.exif).toBeUndefined();
    expect(ocr.calls).toBe(1);
    expect(finalPhotoUpdate(fake)).toMatchObject({
      processingState: "processed",
      automaticHidden: false,
      ocrMatches: "[]",
      processedStorageKey: "builder-deals-private/masters/7.webp",
      originalStorageKey: "builder-deals-private/originals/7.webp",
      processedVersion: sha256(master as Buffer),
      originalVersion: sha256(original as Buffer),
      nextProcessingAttemptAt: null,
      lastProcessingError: null,
    });
  });

  it("upgrades a legacy unreviewed launch-builder row (region null) to the default region, but honours an admin-saved null region", async () => {
    const jpeg = await listingPhotoJpeg();
    vi.stubGlobal("fetch", vi.fn(async () => imageResponse(jpeg)));
    const legacy = scenario({ settings: { key: photos.builderSettingsKey("Chesmar"), value: JSON.stringify({ enabled: true, region: null, keywords: ["Welcome"], reviewedSampleIds: [], revision: "unconfigured-v1" }) } });
    ocr.recognize = async (bytes) => ((await sharp(bytes).metadata()).height ?? 0) >= HEIGHT ? bottomBandWords(HEIGHT) : [];

    expect(await photos.processDealPhoto(7)).toMatchObject({ ok: true, processed: true, regionAction: "cropped" });
    const upgraded = legacy.fake.updatesFor(dealSettings)[0] as { value: string };
    expect(JSON.parse(upgraded.value)).toMatchObject({ enabled: true, region: photos.DEFAULT_LAUNCH_WATERMARK_REGION, revision: "launch-default-v1", keywords: expect.arrayContaining(["Welcome", "MLS"]) });

    const adminCleared = scenario({ settings: { key: photos.builderSettingsKey("Chesmar"), value: JSON.stringify({ enabled: true, region: null, keywords: [], reviewedSampleIds: [], revision: "admin-2026-10-18T00:00:00.000Z" }) } });
    expect(await photos.processDealPhoto(7)).toEqual({ ok: false, awaitingRegion: true });
    expect(adminCleared.fake.updatesFor(dealSettings).length).toBe(0);
  });

  it("step 5: a bottom-band OCR hit after region cover crops the band, OCRs once more, and publishes", async () => {
    const jpeg = await listingPhotoJpeg();
    vi.stubGlobal("fetch", vi.fn(async () => imageResponse(jpeg)));
    // Corner logo region: covered, not cropped, so the bottom-left text survives step 3.
    const { fake } = scenario({ settings: settingsRow("Chesmar", { enabled: true, region: { x: 84, y: 90, width: 16, height: 10 } }) });
    ocr.recognize = async (bytes) => ((await sharp(bytes).metadata()).height ?? 0) >= HEIGHT ? bottomBandWords(HEIGHT) : [];

    const result = await photos.processDealPhoto(7);

    expect(result).toMatchObject({ ok: true, processed: true, hidden: false, bandCropped: "bottom", regionAction: "covered" });
    expect(ocr.calls).toBe(2);
    const masterMeta = await sharp(objects.get("builder-deals-private/masters/7.webp") as Buffer).metadata();
    expect(masterMeta.height).toBe(HEIGHT - Math.ceil(HEIGHT * 0.2));
    expect(masterMeta.width).toBe(WIDTH);
    expect(finalPhotoUpdate(fake)).toMatchObject({ processingState: "processed", automaticHidden: false, ocrMatches: "[]" });
  });

  it("a mid-frame hit on the home's own house number hides the photo but still stores original and master", async () => {
    const jpeg = await listingPhotoJpeg({ bottomText: "" });
    vi.stubGlobal("fetch", vi.fn(async () => imageResponse(jpeg)));
    const { fake } = scenario({ settings: settingsRow("Chesmar", { enabled: true, region: { x: 0, y: 88, width: 100, height: 12 } }) });
    ocr.recognize = async () => [[{ text: "8310", confidence: 88, bbox: { x0: 700, y0: 520, x1: 900, y1: 640 } }]];

    const result = await photos.processDealPhoto(7);

    expect(result).toMatchObject({ ok: false, processed: true, hidden: true });
    expect(result.matches).toEqual([expect.objectContaining({ term: "8310", words: ["8310"] })]);
    expect(ocr.calls).toBe(1);
    expect(objects.has("builder-deals-private/originals/7.webp")).toBe(true);
    expect(objects.has("builder-deals-private/masters/7.webp")).toBe(true);
    const update = finalPhotoUpdate(fake);
    expect(update).toMatchObject({ processingState: "processed", automaticHidden: true, lastProcessingError: null, nextProcessingAttemptAt: null });
    expect(JSON.parse(String(update.ocrMatches))).toEqual([expect.objectContaining({ term: "8310" })]);
  });

  it("hides straight away when the removal toggle is off even for a bottom-band hit", async () => {
    const jpeg = await listingPhotoJpeg();
    vi.stubGlobal("fetch", vi.fn(async () => imageResponse(jpeg)));
    const { fake } = scenario({ settings: settingsRow("Chesmar", { enabled: false, region: null }) });
    ocr.recognize = async () => bottomBandWords(HEIGHT);

    const result = await photos.processDealPhoto(7);

    expect(result).toMatchObject({ ok: false, processed: true, hidden: true, regionAction: "none" });
    expect(result.bandCropped).toBeUndefined();
    expect(ocr.calls).toBe(1);
    expect(finalPhotoUpdate(fake)).toMatchObject({ processingState: "processed", automaticHidden: true });
    expect(JSON.parse(String(finalPhotoUpdate(fake).ocrMatches)).map((m: { term: string }) => m.term)).toContain("Chesmar");
  });

  it("parks an enabled builder without a region at awaiting_region without burning an attempt, after storing the original", async () => {
    const jpeg = await listingPhotoJpeg();
    vi.stubGlobal("fetch", vi.fn(async () => imageResponse(jpeg)));
    const { fake } = scenario({ row: photoRow({ community: { builder: "Perry Homes" }, photo: { processingAttempts: 1 } }), settings: settingsRow("Perry Homes", { enabled: true, region: null }) });

    const result = await photos.processDealPhoto(7);

    expect(result).toEqual({ ok: false, awaitingRegion: true });
    expect(ocr.calls).toBe(0);
    expect(objects.has("builder-deals-private/originals/7.webp")).toBe(true);
    expect(objects.has("builder-deals-private/masters/7.webp")).toBe(false);
    expect(finalPhotoUpdate(fake)).toMatchObject({ processingState: "pending", processingAttempts: 0, nextProcessingAttemptAt: null, lastProcessingError: "awaiting_region", automaticHidden: true });
  });

  it("reprocesses from the stored original and never re-downloads an upload or an already-stored source", async () => {
    const stored = await photos.normalizeDealPhotoOriginal(await listingPhotoJpeg({ bottomText: "" }));
    objects.set("builder-deals-private/originals/7.webp", stored);
    const fetchMock = vi.fn(async () => imageResponse(Buffer.alloc(0)));
    vi.stubGlobal("fetch", fetchMock);
    const { fake } = scenario({ row: photoRow({ photo: { sourceUrl: "upload:abc123", originalStorageKey: "builder-deals-private/originals/7.webp", originalVersion: sha256(stored), bottomCrop: 100, processedVersion: "previous-master" } }), settings: settingsRow("Chesmar", { enabled: true, region: { x: 0, y: 88, width: 100, height: 12 } }) });
    fake.onSelect(dealPhotoRenders, [{ id: 31, storageKey: "builder-deals-private/renders/9/7-abc.webp" }], [{ n: 0 }]);
    objects.set("builder-deals-private/renders/9/7-abc.webp", Buffer.from("old render"));

    const result = await photos.processDealPhoto(7);

    expect(result).toMatchObject({ ok: true, processed: true, regionAction: "cropped" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.mocked(storageReadPrivate)).toHaveBeenCalledWith("builder-deals-private/originals/7.webp");
    expect(vi.mocked(storagePut).mock.calls.map(([key]) => key)).toEqual(["builder-deals-private/masters/7.webp"]);
    // Admin bottom crop applies unconditionally after the region crop; no approval flag is consulted.
    const masterMeta = await sharp(objects.get("builder-deals-private/masters/7.webp") as Buffer).metadata();
    expect(masterMeta.height).toBe(HEIGHT - Math.round(HEIGHT * 0.12) - 100);
    // A changed master invalidates that photo's cached renders (rows and objects).
    await waitFor(() => fake.opsFor("delete", dealPhotoRenders).length === 1);
    await waitFor(() => !objects.has("builder-deals-private/renders/9/7-abc.webp"));
  });

  it("re-downloads a remote source whose stored original no longer matches its version", async () => {
    objects.set("builder-deals-private/originals/7.webp", Buffer.from("corrupt"));
    const jpeg = await listingPhotoJpeg({ bottomText: "" });
    const fetchMock = vi.fn(async () => imageResponse(jpeg));
    vi.stubGlobal("fetch", fetchMock);
    scenario({ row: photoRow({ photo: { originalStorageKey: "builder-deals-private/originals/7.webp", originalVersion: "stale" } }), settings: settingsRow("Chesmar", { enabled: false, region: null }) });

    const result = await photos.processDealPhoto(7);

    expect(result).toMatchObject({ ok: true, processed: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sha256(objects.get("builder-deals-private/originals/7.webp") as Buffer)).not.toBe(sha256(Buffer.from("corrupt")));
  });
});

describe("processDealPhoto: download wiring and queue state machine", () => {
  it("follows a same-host redirect with the streaming downloader and rejects a cross-host one as non-retryable", async () => {
    const jpeg = await listingPhotoJpeg({ bottomText: "" });
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: URL, init: RequestInit) => {
      calls.push(String(input));
      expect(init.redirect).toBe("manual");
      if (calls.length === 1) return new Response(null, { status: 302, headers: { location: "/cdn/front-2.jpg" } });
      return imageResponse(jpeg);
    }));
    const { fake } = scenario({ settings: settingsRow("Chesmar", { enabled: false, region: null }) });

    expect(await photos.processDealPhoto(7)).toMatchObject({ ok: true, processed: true });
    expect(calls).toEqual(["https://dam.mihomes.com/gallery/front.jpg", "https://dam.mihomes.com/cdn/front-2.jpg"]);
    expect(finalPhotoUpdate(fake).processingState).toBe("processed");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 301, headers: { location: "https://evil.example/front.jpg" } })));
    const second = scenario({ settings: settingsRow("Chesmar", { enabled: false, region: null }) });
    expect(await photos.processDealPhoto(7)).toMatchObject({ ok: false, retryScheduled: false });
    expect(finalPhotoUpdate(second.fake)).toMatchObject({ processingState: "failed", lastProcessingError: "unapproved_source", nextProcessingAttemptAt: null, automaticHidden: true });
  });

  it("claims only due pending rows, retries with backoff, and fails for good on the fifth attempt", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network down"); }));
    const { fake } = scenario();
    const before = Date.now();
    expect(await photos.processDealPhoto(7)).toMatchObject({ ok: false, retryScheduled: true });
    const claim = fake.opsFor("update", dealPhotos)[0];
    expect(claim.set).toMatchObject({ processingState: "processing", processingStartedAt: expect.any(Date), lastProcessingError: null });
    const claimWhere = renderWhere(claim.where);
    expect(claimWhere.sql).toMatch(/is not null/i);
    expect(claimWhere.params).toEqual(expect.arrayContaining([7, "pending"]));
    const retry = finalPhotoUpdate(fake);
    expect(retry).toMatchObject({ processingState: "pending", lastProcessingError: "processing_failed", automaticHidden: true });
    expect((retry.nextProcessingAttemptAt as Date).getTime()).toBeGreaterThanOrEqual(before + 30_000);
    expect((retry.nextProcessingAttemptAt as Date).getTime()).toBeLessThanOrEqual(Date.now() + 30_000);

    const exhausted = scenario({ row: photoRow({ photo: { processingAttempts: 5 } }) });
    expect(await photos.processDealPhoto(7)).toMatchObject({ ok: false, retryScheduled: false });
    expect(finalPhotoUpdate(exhausted.fake)).toMatchObject({ processingState: "failed", nextProcessingAttemptAt: null, lastProcessingError: "processing_failed" });

    const unclaimable = scenario();
    unclaimable.fake.setUpdateResult(() => [{ affectedRows: 0 }]);
    expect(await photos.processDealPhoto(7)).toEqual({ ok: false, skipped: true });
    expect(unclaimable.fake.opsFor("select").length).toBe(0);
  });

  it("drains the queue with at most two photos in flight, coalesces overlapping calls, and reruns once for rows added meanwhile", async () => {
    const jpeg = await listingPhotoJpeg({ bottomText: "" });
    const fake = createFakeDb();
    const batches: number[][] = [[1, 2, 3, 4, 5], [], []];
    fake.onSelect(dealPhotos, (op: FakeOp) => {
      const fields = op.fields as Record<string, unknown> | undefined;
      // Distinct sources: rows sharing one source URL would share a single download (see dealsPhotosThroughput.test.ts).
      if (fields && "photo" in fields) { const id = renderWhere(op.where).params[0] as number; return [photoRow({ photo: { id, sourceUrl: `https://dam.mihomes.com/gallery/${id}.jpg` } })]; }
      return (batches.shift() ?? []).map((id) => ({ id }));
    });
    fake.onSelect(dealSettings, [settingsRow("Chesmar", { enabled: false, region: null })]);
    vi.mocked(getDb).mockResolvedValue(fake.db as never);
    let inFlight = 0;
    let maxInFlight = 0;
    const gates: Array<() => void> = [];
    vi.stubGlobal("fetch", vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => gates.push(resolve));
      inFlight--;
      return imageResponse(jpeg);
    }));

    const drain = photos.processPendingDealPhotos(5);
    const overlapping = await photos.processPendingDealPhotos(5);
    expect(overlapping).toMatchObject({ coalesced: true, processed: 0 });
    await waitFor(() => gates.length === 2);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    for (let released = 0; released < 5; released++) {
      await waitFor(() => gates.length > 0);
      (gates.shift() as () => void)();
    }
    const result = await drain;

    expect(maxInFlight).toBe(2);
    expect(result).toMatchObject({ processed: 5, hidden: 0, retried: 0, failed: 0, skipped: 0, awaitingRegion: 0 });
    expect(batches.length).toBe(1); // the coalesced call triggered exactly one rerun (two of three batches consumed)
    const maintenance = fake.updatesFor(dealPhotos).slice(0, 3);
    expect(maintenance[0]).toMatchObject({ processingState: "pending", lastProcessingError: "processing_lease_expired" });
    expect(maintenance[1]).toMatchObject({ nextProcessingAttemptAt: expect.any(Date) });
    // Once per boot: rows that failed under earlier code get fresh attempts, except permanent failures.
    expect(maintenance[2]).toMatchObject({ processingState: "pending", processingAttempts: 0, nextProcessingAttemptAt: expect.any(Date) });
    const recoveryWhere = renderWhere(fake.opsFor("update", dealPhotos)[2].where);
    expect(recoveryWhere.params).toEqual(expect.arrayContaining(["failed", "unapproved_source", "invalid_crop", "invalid_image"]));
    expect(recoveryWhere.sql).toMatch(/not in/i);
    const recoveries = () => fake.opsFor("update", dealPhotos).filter((op) => renderWhere(op.where).params.includes("unapproved_source")).length;
    expect(recoveries()).toBe(1);
    expect(await photos.processPendingDealPhotos(5)).toMatchObject({ processed: 0 });
    expect(batches.length).toBe(0);
    expect(recoveries()).toBe(1);
  }, 20_000);

  it("requeues every photo of a builder's communities as pending with zero attempts", async () => {
    const fake = createFakeDb();
    fake.onSelect(dealCommunities, [{ id: 2 }, { id: 4 }]);
    fake.setUpdateResult(() => [{ affectedRows: 14 }]);
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    expect(await photos.reprocessBuilderPhotos("M/I Homes")).toBe(14);
    const update = fake.opsFor("update", dealPhotos)[0];
    expect(update.set).toMatchObject({ processingState: "pending", processingAttempts: 0, nextProcessingAttemptAt: expect.any(Date), lastProcessingError: null, automaticHidden: true, ocrMatches: "[]" });
    expect(renderWhere(update.where).params).toContain("processing");
    expect(await photos.reprocessBuilderPhotos("  ")).toBe(0);
  });
});

describe("OCR worker lifecycle", () => {
  it("reads langPath from DEALS_OCR_LANG_PATH, creates the cache dir, and closes the worker on SIGTERM then re-raises when unhandled", async () => {
    const cacheDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "deals-ocr-")), "nested", "cache");
    vi.stubEnv("DEALS_OCR_LANG_PATH", "/opt/deals/ocr");
    vi.stubEnv("DEALS_OCR_CACHE_PATH", cacheDir);
    const target = Object.assign(new EventEmitter(), { pid: 4242, kill: vi.fn() });
    expect(photos.installDealPhotoOcrShutdownHooks(target)).toBe(true);
    expect(photos.installDealPhotoOcrShutdownHooks(target)).toBe(false);
    // Earlier tests already started a worker; a fresh one must pick up the env paths.
    await photos.closeDealPhotoOcrWorker();
    await waitFor(() => ocr.terminated === 1);
    ocr.terminated = 0;
    try {
      ocr.recognize = async () => [[{ text: "Realty", confidence: 95, bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } }]];
      const words = await photos.recognizeDealPhotoWords(await sharp({ create: { width: 64, height: 48, channels: 3, background: "#000" } }).png().toBuffer());
      expect(words).toEqual([{ text: "Realty", confidence: 95, bbox: { x0: 0, y0: 0, x1: 10, y1: 10 }, lineId: "0:0:0" }]);
      expect(ocr.createOptions.at(-1)).toMatchObject({ langPath: "/opt/deals/ocr", cachePath: cacheDir, gzip: false });
      expect(fs.existsSync(cacheDir)).toBe(true);

      target.emit("SIGTERM");
      await waitFor(() => ocr.terminated === 1);
      await waitFor(() => target.kill.mock.calls.length === 1);
      expect(target.kill).toHaveBeenCalledWith(4242, "SIGTERM");
    } finally {
      fs.rmSync(path.dirname(path.dirname(cacheDir)), { recursive: true, force: true });
    }
  });
});

describe("renderDealPhotoForLead", () => {
  const future = new Date(Date.now() + 6 * 60 * 60_000);
  async function master(width = 96, height = 64) {
    return sharp({ create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } } }).webp().toBuffer();
  }
  function renderScenario(options: { photoIds?: number[]; leadStatus?: string; cachedRows?: unknown[] } = {}) {
    const fake = createFakeDb();
    fake.onSelect(dealPhotos, (op: FakeOp) => {
      const photoId = renderWhere(op.where).params[0] as number;
      return [{
        photo: { id: photoId, processedStorageKey: `builder-deals-private/masters/${photoId}.webp`, processedVersion: `v-${photoId}` },
        home: { id: 3 }, community: { id: 2 },
        lead: { id: 9, name: null, instagramHandle: "propertypete", phoneE164: "+15125550100", status: options.leadStatus ?? "verified", expiresAt: future },
      }];
    });
    fake.onSelect(dealPhotoRenders, options.cachedRows ?? []);
    vi.mocked(getDb).mockResolvedValue(fake.db as never);
    return fake;
  }
  const litPixels = async (bytes: Buffer) => {
    const { data } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    let lit = 0;
    for (let i = 0; i < data.length; i += 3) if (data[i] > 24) lit++;
    return lit;
  };

  it("burns the identity into the bytes, answers before the cache write, serves repeats from memory, and admits team leads", async () => {
    objects.set("builder-deals-private/masters/7.webp", await master());
    const fake = renderScenario({ leadStatus: "team" });
    let resolvePut: (value: { key: string; url: string }) => void = () => undefined;
    vi.mocked(storagePut).mockImplementationOnce(() => new Promise((resolve) => { resolvePut = resolve; }));

    const first = await photos.renderDealPhotoForLead(7, 9);
    expect(first?.contentType).toBe("image/webp");
    expect(await litPixels(first?.data as Buffer)).toBeGreaterThan(0);
    expect(vi.mocked(storagePut)).toHaveBeenCalledTimes(1);
    expect(fake.opsFor("insert", dealPhotoRenders).length).toBe(0);
    const whereParams = renderWhere(fake.opsFor("select", dealPhotos)[0].where).params;
    expect(whereParams).toEqual(expect.arrayContaining(["verified", "team"]));

    resolvePut({ key: "builder-deals-private/renders/9/7-x.webp", url: "/manus-storage/x" });
    await waitFor(() => fake.opsFor("insert", dealPhotoRenders).length === 1);
    expect(fake.opsFor("insert", dealPhotoRenders)[0].values).toMatchObject({ photoId: 7, leadId: 9, storageKey: "builder-deals-private/renders/9/7-x.webp" });

    const readsBefore = vi.mocked(storageReadPrivate).mock.calls.length;
    const second = await photos.renderDealPhotoForLead(7, 9);
    expect(second?.data.equals(first?.data as Buffer)).toBe(true);
    expect(vi.mocked(storageReadPrivate).mock.calls.length).toBe(readsBefore);
    expect(vi.mocked(storagePut)).toHaveBeenCalledTimes(1);
  });

  it("returns nothing when the processed row is not eligible and uses a durable cached render when present", async () => {
    const fake = createFakeDb();
    fake.onSelect(dealPhotos, []);
    vi.mocked(getDb).mockResolvedValue(fake.db as never);
    expect(await photos.renderDealPhotoForLead(7, 9)).toBeNull();

    objects.set("builder-deals-private/renders/9/7-cached.webp", Buffer.from("cached-bytes"));
    renderScenario({ cachedRows: [{ id: 1, photoId: 7, leadId: 9, version: "any", storageKey: "builder-deals-private/renders/9/7-cached.webp", expiresAt: future }] });
    const cached = await photos.renderDealPhotoForLead(7, 9);
    expect(cached?.data.toString()).toBe("cached-bytes");
    expect(vi.mocked(storagePut)).not.toHaveBeenCalled();
  });

  it("limits uncached renders to three in flight and keeps a fifty-entry in-memory LRU", async () => {
    for (let id = 1; id <= 60; id++) objects.set(`builder-deals-private/masters/${id}.webp`, await master());
    renderScenario();
    let inFlight = 0;
    let maxInFlight = 0;
    const gates: Array<() => void> = [];
    vi.mocked(storageReadPrivate).mockImplementation(async (key) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => gates.push(resolve));
      inFlight--;
      return { data: objects.get(key) as Buffer, contentType: "image/webp" };
    });
    const renders = Promise.all([1, 2, 3, 4, 5, 6].map((id) => photos.renderDealPhotoForLead(id, 9)));
    await waitFor(() => gates.length === 3);
    expect(inFlight).toBe(3);
    for (let released = 0; released < 6; released++) {
      await waitFor(() => gates.length > 0);
      (gates.shift() as () => void)();
    }
    const results = await renders;
    expect(maxInFlight).toBe(3);
    expect(results.every((result) => result?.contentType === "image/webp")).toBe(true);

    vi.mocked(storageReadPrivate).mockImplementation(async (key) => ({ data: objects.get(key) as Buffer, contentType: "image/webp" }));
    // The concurrent batch completed in arbitrary order; touch 1..6 in order so id 1 is the least recent entry.
    for (let id = 1; id <= 6; id++) await photos.renderDealPhotoForLead(id, 9);
    expect(vi.mocked(storageReadPrivate).mock.calls.length).toBe(6);
    for (let id = 7; id <= 51; id++) await photos.renderDealPhotoForLead(id, 9);
    const reads = vi.mocked(storageReadPrivate).mock.calls.length;
    expect(reads).toBe(51);
    await photos.renderDealPhotoForLead(51, 9); // most recent: still in memory
    await photos.renderDealPhotoForLead(2, 9); // second oldest of fifty-one: still in memory
    expect(vi.mocked(storageReadPrivate).mock.calls.length).toBe(reads);
    await photos.renderDealPhotoForLead(1, 9); // the oldest of fifty-one distinct entries was evicted
    expect(vi.mocked(storageReadPrivate).mock.calls.length).toBe(reads + 1);
  });
});

describe("render cache pruning", () => {
  it("deletes expired rows and their objects, keeping an object another row still references", async () => {
    const fake = createFakeDb();
    objects.set("builder-deals-private/renders/1/7-a.webp", Buffer.from("a"));
    objects.set("builder-deals-private/renders/2/7-b.webp", Buffer.from("b"));
    fake.onSelect(dealPhotoRenders,
      [{ id: 11, storageKey: "builder-deals-private/renders/1/7-a.webp" }, { id: 12, storageKey: "builder-deals-private/renders/2/7-b.webp" }],
      (op: FakeOp) => [{ n: renderWhere(op.where).params[0] === "builder-deals-private/renders/2/7-b.webp" ? 1 : 0 }],
    );
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    expect(await photos.cleanupExpiredDealPhotoRenders()).toEqual({ recordsDeleted: 2, storageObjectsDeleted: 1, storageObjectsFailed: 0 });
    expect(fake.opsFor("delete", dealPhotoRenders).map((op) => renderWhere(op.where).params[0])).toEqual([11, 12]);
    expect(objects.has("builder-deals-private/renders/1/7-a.webp")).toBe(false);
    expect(objects.has("builder-deals-private/renders/2/7-b.webp")).toBe(true);
  });

  it("prunes rows whose version no longer matches the photo master or the lead identity and reports counts", async () => {
    const fake = createFakeDb();
    const lead = { name: null, instagramHandle: "propertypete", phoneE164: "+15125550100" };
    const fresh = photos.dealPhotoRenderCacheVersion("master-2", 9, "@propertypete");
    const future = new Date(Date.now() + 60_000);
    fake.onSelect(dealPhotoRenders,
      [],
      [
        { id: 1, leadId: 9, version: fresh, storageKey: "builder-deals-private/renders/9/7-fresh.webp", expiresAt: future, photoVersion: "master-2", leadName: lead.name, leadHandle: lead.instagramHandle, leadPhone: lead.phoneE164 },
        { id: 2, leadId: 9, version: photos.dealPhotoRenderCacheVersion("master-1", 9, "@propertypete"), storageKey: "builder-deals-private/renders/9/7-old.webp", expiresAt: future, photoVersion: "master-2", leadName: lead.name, leadHandle: lead.instagramHandle, leadPhone: lead.phoneE164 },
        { id: 3, leadId: 9, version: "anything", storageKey: "builder-deals-private/renders/9/8-gone.webp", expiresAt: future, photoVersion: null, leadName: null, leadHandle: null, leadPhone: null },
        { id: 4, leadId: 9, version: "expired-later", storageKey: "builder-deals-private/renders/9/9-exp.webp", expiresAt: new Date(Date.now() - 60_000), photoVersion: "master-2", leadName: lead.name, leadHandle: lead.instagramHandle, leadPhone: lead.phoneE164 },
      ],
      [{ n: 0 }],
    );
    vi.mocked(storageDelete).mockImplementation(async (key) => key.includes("old"));
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    const result = await photos.pruneDealPhotoRenders({ pageSize: 10 });

    expect(result).toEqual({ scanned: 4, expiredRows: 0, staleRows: 2, rowsDeleted: 2, objectsDeleted: 1, objectsFailed: 1 });
    expect(fake.opsFor("delete", dealPhotoRenders).map((op) => renderWhere(op.where).params[0])).toEqual([2, 3]);
    expect(vi.mocked(storageDelete).mock.calls.map(([key]) => key).sort()).toEqual(["builder-deals-private/renders/9/7-old.webp", "builder-deals-private/renders/9/8-gone.webp"]);
  });
});
