import { storagePut, storageReadPrivate } from "./storage";

/**
 * Oct 28, 2026 (sweep: the team list took 6.5 s to open after a quiet evening; 1 s once warm). The host starts new
 * server processes all day, and a fresh process has no list in memory: its first visitor waited for the whole build
 * (every community, home and photo row). The last build is now kept in private storage, so a fresh process answers its
 * first visitor from that copy and builds its own on the cache's next refresh (three minutes). The copy may be a few
 * hours old after a quiet spell, so the caller re-checks it on the way out (communities taken off since are dropped;
 * photos are checked on every request anyway). It lives under the private prefix the storage proxy never serves.
 */
const PREFIX = "builder-deals-private/catalog-snapshots/";
export const SNAPSHOT_MAX_AGE_MS = 12 * 60 * 60_000;
/** A process writes its copy at most this often (a build is several MB of JSON). */
export const SNAPSHOT_WRITE_EVERY_MS = 5 * 60_000;
/** Past this, the stored copy is skipped and the visitor waits for the build as before. */
const SNAPSHOT_READ_TIMEOUT_MS = 3_000;

type Snapshot<T> = { v: 1; at: number; value: T };
export type SnapshotStore = {
  read: (key: string) => Promise<Buffer>;
  write: (key: string, data: Buffer) => Promise<unknown>;
};
const defaultStore: SnapshotStore = {
  read: async (key) => (await storageReadPrivate(key)).data,
  write: (key, data) => storagePut(key, data, "application/json", { unique: false }),
};

const opened = new Set<string>();
const written = new Map<string, number>();
/** Test seam. */
export function resetCatalogSnapshots() { opened.clear(); written.clear(); }

export function catalogSnapshotKey(viewKey: string) {
  return `${PREFIX}${viewKey.replace(/[^a-z0-9_-]/gi, "_")}.json`;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("snapshot read timed out")), ms);
    (timer as { unref?: () => void }).unref?.();
    work.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

/**
 * The first load of `viewKey` in this process takes the stored copy when it is fresh; every other load builds, and a
 * build is stored again when this process has not stored one for SNAPSHOT_WRITE_EVERY_MS. Never throws for storage.
 */
export async function catalogWithSnapshot<T>(viewKey: string, build: () => Promise<T>, options: { store?: SnapshotStore; now?: () => number; /** Brings a stored copy up to date with what changed since (it is never trusted as is). */ recheck?: (value: T) => Promise<T> } = {}): Promise<T> {
  const store = options.store ?? defaultStore;
  const now = options.now ?? (() => Date.now());
  const key = catalogSnapshotKey(viewKey);
  if (!opened.has(viewKey)) {
    opened.add(viewKey);
    try {
      const parsed = JSON.parse((await withTimeout(store.read(key), SNAPSHOT_READ_TIMEOUT_MS)).toString("utf8")) as Partial<Snapshot<T>>;
      if (parsed?.v === 1 && typeof parsed.at === "number" && now() - parsed.at >= 0 && now() - parsed.at < SNAPSHOT_MAX_AGE_MS && parsed.value !== undefined) {
        return options.recheck ? await options.recheck(parsed.value as T) : parsed.value as T;
      }
    } catch { /* none yet, unreadable or slow: build below */ }
  }
  const value = await build();
  const at = now();
  if (at - (written.get(viewKey) ?? Number.NEGATIVE_INFINITY) >= SNAPSHOT_WRITE_EVERY_MS) {
    written.set(viewKey, at);
    try {
      void store.write(key, Buffer.from(JSON.stringify({ v: 1, at, value } satisfies Snapshot<T>))).catch(() => { written.delete(viewKey); });
    } catch { written.delete(viewKey); }
  }
  return value;
}
