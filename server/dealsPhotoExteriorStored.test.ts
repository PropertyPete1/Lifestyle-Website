import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Nov 17, 2026 (Peter: "why are some photos of the kitchen that should be the front of the house?"): the outside score
 * is kept on the photo's row, so every home's list card leads with its front, not only the Best Deals row, and a
 * restart forgets nothing.
 */
const state = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, updates: [] as Array<{ id: number; value: number }>, db: true }));
vi.mock("./db", () => ({
  getDb: async () => state.db ? {
    execute: async () => [state.rows.filter((row) => row.exteriorScore === undefined), []],
    update: () => ({ set: (values: { exteriorScore: number }) => ({ where: async () => {
      // The fake applies the write to the next unscored row the loop reached (calls arrive in loop order).
      const target = state.rows.find((row) => row.pending === true)!;
      target.pending = false; target.exteriorScore = values.exteriorScore;
      state.updates.push({ id: target.id as number, value: values.exteriorScore });
    } }) }),
  } : null,
}));
vi.mock("./storage", () => ({ storageReadPrivate: async () => { throw new Error("not used"); } }));

const { exteriorFirst, backfillExteriorScores, storedExteriorScore, exteriorScoreToStore, EXTERIOR_UNREADABLE } = await import("./dealsPhotoExterior");

async function picture(kind: "outside" | "inside"): Promise<Buffer> {
  const width = 96, height = 64;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 3;
    const color = kind === "inside" ? [205, 190, 170] : y < height * 0.4 ? [110, 160, 230] : y >= height * 0.6 ? [60, 150, 50] : [200, 190, 180];
    pixels[at] = color[0]!; pixels[at + 1] = color[1]!; pixels[at + 2] = color[2]!;
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg().toBuffer();
}

beforeEach(() => { state.rows = []; state.updates = []; state.db = true; });

describe("a home's cover is its outside shot, from the score kept on the photo", () => {
  it("moves the first outside photo to the front and leaves a home with none, or not yet measured, in the builder's order", () => {
    const row = (id: number, exteriorScore: number | null) => ({ id, processedVersion: `v${id}`, exteriorScore });
    expect(exteriorFirst([row(1, 20), row(2, 0), row(3, 812), row(4, 900)]).map((photo) => photo.id)).toEqual([3, 1, 2, 4]);
    expect(exteriorFirst([row(1, 20), row(2, 249)]).map((photo) => photo.id)).toEqual([1, 2]);
    expect(exteriorFirst([row(1, null), row(2, null)]).map((photo) => photo.id)).toEqual([1, 2]);
    // A photo that could not be read is never an outside shot.
    expect(exteriorFirst([row(1, EXTERIOR_UNREADABLE), row(2, 400)]).map((photo) => photo.id)).toEqual([2, 1]);
    expect(storedExteriorScore(812)).toBe(0.812);
    expect(storedExteriorScore(null)).toBeUndefined();
    expect(exteriorScoreToStore(0.7349)).toBe(735);
  });

  it("measures older photos in gallery order and stops each home at its first outside shot", async () => {
    const outside = await picture("outside"), inside = await picture("inside");
    const images: Record<string, Buffer> = { a1: inside, a2: outside, a3: inside, b1: inside, b2: inside };
    state.rows = [
      { id: 1, homeId: 10, processedStorageKey: "a1", processedVersion: "v1" },
      { id: 2, homeId: 10, processedStorageKey: "a2", processedVersion: "v2" },
      { id: 3, homeId: 10, processedStorageKey: "a3", processedVersion: "v3" },
      { id: 4, homeId: 20, processedStorageKey: "b1", processedVersion: "v4" },
      { id: 5, homeId: 20, processedStorageKey: "gone", processedVersion: "v5" },
    ];
    const read = vi.fn(async (key: string) => { state.rows.find((row) => row.processedStorageKey === key)!.pending = true; const image = images[key]; if (!image) throw new Error("missing"); return image; });
    const result = await backfillExteriorScores({ read });
    expect(result).toEqual({ scored: 3, unreadable: 1, remainingBatch: 0 });
    // Home 10's third photo is never read: its cover was settled by the second.
    expect(read.mock.calls.map((call) => call[0])).toEqual(["a1", "a2", "b1", "gone"]);
    const byId = new Map(state.updates.map((update) => [update.id, update.value]));
    expect(byId.get(1)!).toBeLessThan(250);
    expect(byId.get(2)!).toBeGreaterThanOrEqual(250);
    expect(byId.get(4)!).toBeLessThan(250);
    expect(byId.get(5)).toBe(EXTERIOR_UNREADABLE);
    expect(byId.has(3)).toBe(false);
  });

  it("stops at its time budget and does nothing without a database", async () => {
    const inside = await picture("inside");
    state.rows = [1, 2, 3].map((id) => ({ id, homeId: id, processedStorageKey: `k${id}`, processedVersion: `v${id}` }));
    let clock = 0;
    const read = vi.fn(async (key: string) => { state.rows.find((row) => row.processedStorageKey === key)!.pending = true; clock += 4_000; return inside; });
    expect(await backfillExteriorScores({ read, now: () => clock, budgetMs: 6_000 })).toEqual({ scored: 2, unreadable: 0, remainingBatch: 1 });
    state.db = false;
    expect(await backfillExteriorScores({ read })).toEqual({ scored: 0, unreadable: 0, remainingBatch: 0 });
  });
});
