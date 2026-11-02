import { afterEach, describe, expect, it, vi } from "vitest";
import { loadRegionMap, resetRegionMap } from "./dealsRegionMap";

/** Nov 2, 2026 (Peter: on his phone "the map does too" take a minute to load). */
describe("the landing map's picture on a new server process", () => {
  afterEach(() => resetRegionMap());

  it("is read from storage at once, without fetching or stitching the map tiles", async () => {
    const stored = Buffer.from("stored-region-webp");
    const read = vi.fn(async () => stored);
    const write = vi.fn(async () => undefined);
    const fetcher = vi.fn() as unknown as typeof fetch;
    expect(await loadRegionMap(fetcher, { read, write })).toBe(stored);
    // Later requests on the same process are served from memory.
    expect(await loadRegionMap(fetcher, { read, write })).toBe(stored);
    expect(read).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("checks storage once per process and never fails the page when storage is unreadable", async () => {
    const read = vi.fn(async () => { throw new Error("storage down"); });
    const store = { read, write: vi.fn(async () => undefined) };
    const fetcher = vi.fn() as unknown as typeof fetch;
    // No map service configured in tests: nothing to build, so no picture (the page shows its plain background).
    await expect(loadRegionMap(fetcher, store)).resolves.toBeNull();
    await expect(loadRegionMap(fetcher, store)).resolves.toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });
});
