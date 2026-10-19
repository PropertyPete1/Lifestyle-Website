import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import sharp from "sharp";
import { dealCommunities, dealHomes, dealPhotos, dealSettings } from "../drizzle/schema";
import { createFakeDb, renderWhere, type FakeOp } from "./dealsPhotosTestKit";

vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./storage", () => ({ storagePut: vi.fn(), storageReadPrivate: vi.fn(), storageDelete: vi.fn() }));
vi.mock("./dealsPhotos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./dealsPhotos")>()),
  processPendingDealPhotos: vi.fn(async () => ({ processed: 0, hidden: 0, awaitingRegion: 0, retried: 0, failed: 0, skipped: 0 })),
}));

import { getDb } from "./db";
import { storagePut, storageReadPrivate } from "./storage";
import { DEFAULT_LAUNCH_WATERMARK_REGION, DEFAULT_PHOTO_HIDE_KEYWORDS, builderSettingsKey, processPendingDealPhotos } from "./dealsPhotos";
import {
  PhotoAdminError,
  getBuilderPhotoSettingsForAdmin,
  getDealPhotoPreview,
  listBuilderPhotoSamples,
  normalizePhotoKeywords,
  saveBuilderPhotoSettings,
  uploadManualHomePhoto,
} from "./dealsPhotosAdmin";

const sha256 = (value: Buffer) => crypto.createHash("sha256").update(value).digest("hex");
const objects = new Map<string, Buffer>();
const storedSettings = (builder: string, settings: Record<string, unknown>) => ({ key: builderSettingsKey(builder), value: JSON.stringify({ enabled: true, region: null, keywords: [], reviewedSampleIds: [], revision: "stored", ...settings }) });
const photo = (width = 800, height = 600) => sharp({ create: { width, height, channels: 3, background: { r: 120, g: 140, b: 160 } } }).jpeg({ quality: 85 }).toBuffer();

beforeEach(() => {
  objects.clear();
  vi.mocked(storagePut).mockImplementation(async (key, data) => { objects.set(key, Buffer.from(data as Buffer)); return { key, url: `/manus-storage/${key}` }; });
  vi.mocked(storageReadPrivate).mockImplementation(async (key) => { const data = objects.get(key); if (!data) throw new Error("missing object"); return { data, contentType: "image/webp" }; });
});

afterEach(() => {
  vi.mocked(getDb).mockReset();
  vi.mocked(storagePut).mockReset();
  vi.mocked(storageReadPrivate).mockReset();
  vi.mocked(processPendingDealPhotos).mockClear();
});

describe("saveBuilderPhotoSettings", () => {
  it("rejects a region outside the frame and an invalid keyword list without writing anything", async () => {
    const fake = createFakeDb();
    vi.mocked(getDb).mockResolvedValue(fake.db as never);
    await expect(saveBuilderPhotoSettings({ builder: "Chesmar", enabled: true, region: { x: 0, y: 90, width: 100, height: 20 } })).rejects.toMatchObject({ code: "invalid_region" });
    await expect(saveBuilderPhotoSettings({ builder: "Chesmar", enabled: true, region: { x: -1, y: 0, width: 10, height: 10 } })).rejects.toBeInstanceOf(PhotoAdminError);
    await expect(saveBuilderPhotoSettings({ builder: "Chesmar", enabled: true, region: null, keywords: ["x".repeat(61)] })).rejects.toMatchObject({ code: "invalid_keywords" });
    await expect(saveBuilderPhotoSettings({ builder: "   ", enabled: true, region: null })).rejects.toMatchObject({ code: "builder_required" });
    expect(fake.opsFor("insert").length).toBe(0);
    expect(fake.opsFor("update").length).toBe(0);
  });

  it("writes the photos.builder JSON, keeps the seeded keywords, requeues the builder's photos, and kicks a drain", async () => {
    const fake = createFakeDb();
    fake.onSelect(dealSettings, [storedSettings("M/I Homes", { enabled: true, region: DEFAULT_LAUNCH_WATERMARK_REGION })]);
    fake.onSelect(dealCommunities, [{ id: 2 }]);
    fake.setUpdateResult((op: FakeOp) => [{ affectedRows: op.table === dealPhotos ? 9 : 1 }]);
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    const result = await saveBuilderPhotoSettings({ builder: "M/I Homes", enabled: true, region: { x: 70, y: 85, width: 30, height: 15 }, keywords: [" Builder ", "builder", "Welcome Home"] });

    expect(result).toMatchObject({ builder: "M/I Homes", changed: true, requeued: 9 });
    expect(result.settings).toMatchObject({ enabled: true, region: { x: 70, y: 85, width: 30, height: 15 } });
    expect(result.settings.keywords).toEqual([...DEFAULT_PHOTO_HIDE_KEYWORDS, "Builder", "Welcome Home"]);
    const written = fake.opsFor("insert", dealSettings)[0].values as { key: string; value: string };
    expect(written.key).toBe(builderSettingsKey("M/I Homes"));
    expect(JSON.parse(written.value)).toMatchObject({ enabled: true, region: { x: 70, y: 85, width: 30, height: 15 }, keywords: expect.arrayContaining(["Builder", "Welcome Home", "MLS"]) });
    const requeue = fake.opsFor("update", dealPhotos)[0];
    expect(requeue.set).toMatchObject({ processingState: "pending", processingAttempts: 0, nextProcessingAttemptAt: expect.any(Date) });
    expect(vi.mocked(processPendingDealPhotos)).toHaveBeenCalledTimes(1);
  });

  it("does not requeue when nothing changed, and clearing the region of an enabled builder is a change", async () => {
    const fake = createFakeDb();
    fake.onSelect(dealSettings, [storedSettings("Chesmar", { enabled: true, region: DEFAULT_LAUNCH_WATERMARK_REGION })]);
    fake.onSelect(dealCommunities, [{ id: 2 }]);
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    const same = await saveBuilderPhotoSettings({ builder: "Chesmar", enabled: true, region: { ...DEFAULT_LAUNCH_WATERMARK_REGION }, keywords: [] });
    expect(same).toMatchObject({ changed: false, requeued: 0 });
    expect(fake.opsFor("update", dealPhotos).length).toBe(0);
    expect(vi.mocked(processPendingDealPhotos)).not.toHaveBeenCalled();

    const cleared = await saveBuilderPhotoSettings({ builder: "Chesmar", enabled: true, region: null });
    expect(cleared).toMatchObject({ changed: true, requeued: 1 });
    expect(cleared.settings.region).toBeNull();
    expect(fake.opsFor("update", dealPhotos).length).toBe(1);
  });

  it("normalizes keywords: trims, collapses spaces, de-duplicates case-insensitively", () => {
    expect(normalizePhotoKeywords([" Real   Estate ", "real estate", "", "Builder"])).toEqual(["Real Estate", "Builder"]);
    expect(() => normalizePhotoKeywords("Builder")).toThrow(PhotoAdminError);
    expect(() => normalizePhotoKeywords(Array.from({ length: 101 }, (_, i) => `k${i}`))).toThrow(/At most 100/);
  });
});

describe("getBuilderPhotoSettingsForAdmin", () => {
  it("lists launch builders and every community builder with needsRegion and queue counts", async () => {
    const fake = createFakeDb();
    fake.onSelect(dealCommunities, [{ builder: "Chesmar" }, { builder: "Perry Homes" }]);
    fake.onSelect(dealSettings, (op: FakeOp) => {
      const key = renderWhere(op.where).params[0];
      if (key === builderSettingsKey("Perry Homes")) return [storedSettings("Perry Homes", { enabled: true, region: null })];
      if (key === builderSettingsKey("Chesmar")) return [storedSettings("Chesmar", { enabled: true, region: DEFAULT_LAUNCH_WATERMARK_REGION })];
      return [];
    });
    fake.onSelect(dealPhotos, [
      { builder: "Perry Homes", total: 4, processed: 0, pending: 4, failed: 0, awaitingRegion: 4, autoHidden: 4 },
      { builder: "Chesmar", total: 10, processed: 9, pending: 0, failed: 1, awaitingRegion: 0, autoHidden: 2 },
    ]);
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    const views = await getBuilderPhotoSettingsForAdmin();

    expect(views.map((view) => view.builder)).toEqual(["Chesmar", "M/I Homes", "Perry Homes"]);
    expect(views[0]).toMatchObject({ needsRegion: false, enabled: true, photos: { total: 10, processed: 9, failed: 1, awaitingRegion: 0, autoHidden: 2 } });
    expect(views[1]).toMatchObject({ needsRegion: false, enabled: true, region: DEFAULT_LAUNCH_WATERMARK_REGION, photos: { total: 0 } });
    expect(views[2]).toMatchObject({ needsRegion: true, enabled: true, region: null, photos: { awaitingRegion: 4, pending: 4 } });
    // M/I Homes had no stored row: the admin view shows its effective launch default without seeding it (no admin GET changes state).
    expect(views[1]).toMatchObject({ revision: "launch-default-v1", keywords: [...DEFAULT_PHOTO_HIDE_KEYWORDS] });
    expect(fake.opsFor("insert", dealSettings)).toHaveLength(0);
    expect(fake.opsFor("update", dealSettings)).toHaveLength(0);
  });

  it("shows a legacy unreviewed launch row as upgraded without writing the upgrade back", async () => {
    const fake = createFakeDb();
    fake.onSelect(dealCommunities, [{ builder: "Chesmar" }]);
    fake.onSelect(dealSettings, (op: FakeOp) => {
      const key = renderWhere(op.where).params[0];
      return key === builderSettingsKey("Chesmar") ? [storedSettings("Chesmar", { enabled: false, region: null, revision: "unconfigured-v1", keywords: ["Welcome Home"] })] : [];
    });
    fake.onSelect(dealPhotos, []);
    vi.mocked(getDb).mockResolvedValue(fake.db as never);
    const [chesmar] = await getBuilderPhotoSettingsForAdmin("Chesmar");
    expect(chesmar).toMatchObject({ builder: "Chesmar", enabled: true, region: DEFAULT_LAUNCH_WATERMARK_REGION, needsRegion: false, revision: "launch-default-v1" });
    expect(chesmar.keywords).toEqual(expect.arrayContaining(["Welcome Home", ...DEFAULT_PHOTO_HIDE_KEYWORDS]));
    expect(fake.opsFor("insert", dealSettings)).toHaveLength(0);
    expect(fake.opsFor("update", dealSettings)).toHaveLength(0);
  });
});

describe("samples and previews", () => {
  it("returns up to five stored originals as data URLs, one per home first, skipping unreadable objects", async () => {
    const fake = createFakeDb();
    const original = await sharp(await photo(1600, 1200)).webp().toBuffer();
    for (const id of [1, 2, 3, 4]) objects.set(`builder-deals-private/originals/${id}.webp`, original);
    fake.onSelect(dealPhotos, [
      { id: 1, homeId: 10, storageKey: "builder-deals-private/originals/1.webp" },
      { id: 2, homeId: 10, storageKey: "builder-deals-private/originals/2.webp" },
      { id: 3, homeId: 11, storageKey: "builder-deals-private/originals/3.webp" },
      { id: 4, homeId: 12, storageKey: "builder-deals-private/originals/4.webp" },
      { id: 5, homeId: 12, storageKey: "builder-deals-private/originals/5-missing.webp" },
    ]);
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    const samples = await listBuilderPhotoSamples("Chesmar");

    expect(samples.map((sample) => sample.photoId)).toEqual([1, 3, 4, 2]);
    expect(samples[0]).toMatchObject({ homeId: 10, width: 1600, height: 1200 });
    expect(samples[0].dataUrl.startsWith("data:image/webp;base64,")).toBe(true);
    const decoded = await sharp(Buffer.from(samples[0].dataUrl.split(",")[1], "base64")).metadata();
    expect(Math.max(decoded.width ?? 0, decoded.height ?? 0)).toBeLessThanOrEqual(720);
    expect(renderWhere(fake.opsFor("select", dealPhotos)[0].where).params).toContain("chesmar");
  });

  it("previews the master when present, else the original, as a small data URL with the screening state", async () => {
    const fake = createFakeDb();
    objects.set("builder-deals-private/originals/7.webp", await sharp(await photo(1600, 1200)).webp().toBuffer());
    const rows: Array<Record<string, unknown>> = [
      { id: 7, originalStorageKey: "builder-deals-private/originals/7.webp", processedStorageKey: "builder-deals-private/masters/7.webp", processingState: "processed", automaticHidden: true, adminHidden: false, lastProcessingError: null, ocrMatches: JSON.stringify([{ term: "Homes", confidence: 91, words: ["homes"] }]) },
      { id: 8, originalStorageKey: null, processedStorageKey: null, processingState: "pending", automaticHidden: true, adminHidden: false, lastProcessingError: "awaiting_region", ocrMatches: "[]" },
    ];
    fake.onSelect(dealPhotos, (op: FakeOp) => rows.filter((row) => row.id === renderWhere(op.where).params[0]));
    vi.mocked(getDb).mockResolvedValue(fake.db as never);

    const fallback = await getDealPhotoPreview({ id: 7 });
    expect(fallback).toMatchObject({ id: 7, source: "original", processingState: "processed", automaticHidden: true, ocrMatches: [{ term: "Homes", confidence: 91, words: ["homes"] }] });
    const decoded = await sharp(Buffer.from((fallback?.dataUrl ?? "").split(",")[1], "base64")).metadata();
    expect(Math.max(decoded.width ?? 0, decoded.height ?? 0)).toBeLessThanOrEqual(320);

    objects.set("builder-deals-private/masters/7.webp", await sharp(await photo(640, 480)).webp().toBuffer());
    expect(await getDealPhotoPreview({ id: 7 })).toMatchObject({ source: "master", width: 640, height: 480 });
    expect(await getDealPhotoPreview({ id: 8 })).toBeNull();
    await expect(getDealPhotoPreview({ id: 9 })).rejects.toMatchObject({ code: "photo_not_found" });
  });
});

describe("uploadManualHomePhoto", () => {
  it("normalizes, stores the original, inserts a pending upload row, makes it due, and kicks the queue", async () => {
    const fake = createFakeDb();
    fake.onSelect(dealHomes, [{ id: 5, communityId: 2 }]);
    fake.onSelect(dealPhotos, [{ next: 3 }]);
    fake.setInsertResult(() => [{ insertId: 77, affectedRows: 1 }]);
    vi.mocked(getDb).mockResolvedValue(fake.db as never);
    const jpeg = await sharp(await photo(3200, 1600)).withMetadata({ exif: { IFD0: { Artist: "Private builder" } } }).jpeg().toBuffer();

    const result = await uploadManualHomePhoto({ homeId: 5, base64: `data:image/jpeg;base64,${jpeg.toString("base64")}`, contentType: "image/jpeg" });

    expect(result).toEqual({ id: 77, homeId: 5, sortOrder: 3, width: 1600, height: 800 });
    const inserted = fake.opsFor("insert", dealPhotos)[0].values as Record<string, unknown>;
    expect(String(inserted.sourceUrl)).toMatch(/^upload:[A-Za-z0-9_-]{16}$/);
    expect(inserted).toMatchObject({ homeId: 5, sortOrder: 3, processingState: "pending", processingAttempts: 0, nextProcessingAttemptAt: null, automaticHidden: true });
    expect(inserted.sourceHash).toBe(crypto.createHash("sha256").update(String(inserted.sourceUrl)).digest("hex"));
    const stored = objects.get("builder-deals-private/originals/77.webp") as Buffer;
    const meta = await sharp(stored).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    expect(meta.width).toBe(1600);
    expect(fake.updatesFor(dealPhotos)[0]).toMatchObject({ originalStorageKey: "builder-deals-private/originals/77.webp", originalVersion: sha256(stored), nextProcessingAttemptAt: expect.any(Date) });
    expect(fake.updatesFor(dealCommunities)[0]).toMatchObject({ catalogUpdatedAt: expect.any(Date) });
    expect(vi.mocked(processPendingDealPhotos)).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing home, a non-image type, undecodable data, and removes the row when storage fails", async () => {
    const fake = createFakeDb();
    fake.onSelect(dealHomes, [], [{ id: 5, communityId: 2 }]);
    fake.onSelect(dealPhotos, [{ next: 0 }]);
    fake.setInsertResult(() => [{ insertId: 78, affectedRows: 1 }]);
    vi.mocked(getDb).mockResolvedValue(fake.db as never);
    const jpeg = await photo();

    await expect(uploadManualHomePhoto({ homeId: 99, base64: jpeg.toString("base64"), contentType: "image/jpeg" })).rejects.toMatchObject({ code: "home_not_found" });
    await expect(uploadManualHomePhoto({ homeId: 5, base64: jpeg.toString("base64"), contentType: "text/html" })).rejects.toMatchObject({ code: "invalid_upload" });
    await expect(uploadManualHomePhoto({ homeId: 5, base64: Buffer.from("not an image").toString("base64"), contentType: "image/png" })).rejects.toMatchObject({ code: "invalid_upload" });
    await expect(uploadManualHomePhoto({ homeId: 5, base64: "%%%", contentType: "image/png" })).rejects.toMatchObject({ code: "invalid_upload" });
    expect(fake.opsFor("insert", dealPhotos).length).toBe(0);

    vi.mocked(storagePut).mockRejectedValueOnce(new Error("presign failed"));
    await expect(uploadManualHomePhoto({ homeId: 5, base64: jpeg.toString("base64"), contentType: "image/jpeg" })).rejects.toMatchObject({ code: "storage_unavailable" });
    expect(renderWhere(fake.opsFor("delete", dealPhotos)[0].where).params).toEqual([78]);
    expect(vi.mocked(processPendingDealPhotos)).not.toHaveBeenCalled();
  });
});
