import { beforeEach, describe, expect, it } from "vitest";
import { SNAPSHOT_MAX_AGE_MS, SNAPSHOT_WRITE_EVERY_MS, catalogSnapshotKey, catalogWithSnapshot, resetCatalogSnapshots, type SnapshotStore } from "./dealsCatalogSnapshot";

/** Oct 28, 2026: a fresh server process opens the list from the last stored build instead of making its first visitor wait. */
function memoryStore() {
  const objects = new Map<string, Buffer>();
  const writes: string[] = [];
  const store: SnapshotStore = {
    read: async (key) => { const data = objects.get(key); if (!data) throw new Error("missing"); return data; },
    write: async (key, data) => { writes.push(key); objects.set(key, data); },
  };
  return { objects, writes, store };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the stored list for a fresh server process", () => {
  beforeEach(() => resetCatalogSnapshots());

  it("serves a fresh stored build on a process's first load, builds after that, and stores a build at most every five minutes", async () => {
    const { objects, writes, store } = memoryStore();
    let t = 1_000_000;
    let builds = 0;
    const build = async () => ({ list: `build ${++builds}` });
    // No copy yet: the first visitor waits for the build, which is stored.
    expect(await catalogWithSnapshot("full:pages", build, { store, now: () => t })).toEqual({ list: "build 1" });
    await flush();
    expect(writes).toEqual([catalogSnapshotKey("full:pages")]);
    expect(catalogSnapshotKey("full:pages")).toBe("builder-deals-private/catalog-snapshots/full_pages.json");
    // The same process builds again on its next refresh, without storing again so soon.
    t += 3 * 60_000;
    expect(await catalogWithSnapshot("full:pages", build, { store, now: () => t })).toEqual({ list: "build 2" });
    await flush();
    expect(writes).toHaveLength(1);
    // A new process (the host started another one): its first visitor gets the stored copy straight away.
    resetCatalogSnapshots();
    t += 60_000;
    expect(await catalogWithSnapshot("full:pages", build, { store, now: () => t })).toEqual({ list: "build 1" });
    expect(builds).toBe(2);
    expect(await catalogWithSnapshot("full:pages", build, { store, now: () => t + SNAPSHOT_WRITE_EVERY_MS })).toEqual({ list: "build 3" });
    await flush();
    expect(writes).toHaveLength(2);
    expect(JSON.parse(objects.get(catalogSnapshotKey("full:pages"))!.toString()).value).toEqual({ list: "build 3" });
  });

  it("re-checks a stored copy before serving it (communities taken off since are dropped), never a fresh build", async () => {
    const { store } = memoryStore();
    let t = 1_000;
    const build = async () => [{ id: 1 }, { id: 2 }];
    const recheck = async (value: Array<{ id: number }>) => value.filter((entry) => entry.id !== 2);
    expect(await catalogWithSnapshot("gated", build, { store, now: () => t, recheck })).toEqual([{ id: 1 }, { id: 2 }]);
    await flush();
    resetCatalogSnapshots();
    t += 2 * 60 * 60_000; // a quiet evening: still served from the copy, re-checked
    expect(await catalogWithSnapshot("gated", build, { store, now: () => t, recheck })).toEqual([{ id: 1 }]);
  });

  it("ignores a stale, unreadable or missing copy and never fails the list over storage", async () => {
    const { objects, store } = memoryStore();
    const key = catalogSnapshotKey("gated");
    objects.set(key, Buffer.from(JSON.stringify({ v: 1, at: 0, value: { list: "old" } })));
    expect(await catalogWithSnapshot("gated", async () => ({ list: "new" }), { store, now: () => SNAPSHOT_MAX_AGE_MS + 1 })).toEqual({ list: "new" });
    resetCatalogSnapshots();
    objects.set(key, Buffer.from("not json"));
    expect(await catalogWithSnapshot("gated", async () => ({ list: "rebuilt" }), { store, now: () => 5 })).toEqual({ list: "rebuilt" });
    resetCatalogSnapshots();
    const broken: SnapshotStore = { read: async () => { throw new Error("storage down"); }, write: async () => { throw new Error("storage down"); } };
    expect(await catalogWithSnapshot("gated", async () => ({ list: "built" }), { store: broken, now: () => 5 })).toEqual({ list: "built" });
    await flush();
  });
});
