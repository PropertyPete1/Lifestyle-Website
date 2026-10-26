/**
 * The landing's public reads (every community, the featured row) are the same for every visitor and take seconds to
 * build. Oct 26, 2026: with a plain one-minute cache, the visitor who arrived right after it expired waited 5–10 s for
 * the rebuild (worse while the photo drain had the CPU). Now a value is served as is while fresh, served stale while a
 * rebuild runs in the background, and rebuilt on a timer for as long as someone keeps asking, so no visitor waits on a
 * rebuild unless the page has gone quiet for a long time (or it never loaded).
 */
export type PublicPageCacheOptions = {
  /** Served without question. */
  freshMs?: number;
  /** Past this, a request waits for a rebuild instead of taking the stale value. */
  staleMs?: number;
  /** A key read within this window keeps being rebuilt on the fresh timer; after it, the timer stops. */
  keepWarmMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

type Entry<T> = { at: number; value: Promise<T>; lastRead: number; lastAttempt: number; refreshing: Promise<T> | null; timer: unknown };

export function createPublicPageCache(options: PublicPageCacheOptions = {}) {
  const freshMs = options.freshMs ?? 60_000;
  const staleMs = options.staleMs ?? 15 * 60_000;
  const keepWarmMs = options.keepWarmMs ?? 10 * 60_000;
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((fn, ms) => { const handle = setTimeout(fn, ms); (handle as { unref?: () => void }).unref?.(); return handle; });
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const entries = new Map<string, Entry<unknown>>();
  const loaders = new Map<string, () => Promise<unknown>>();

  function rebuild<T>(key: string, load: () => Promise<T>): Promise<T> {
    const entry = entries.get(key) as Entry<T> | undefined;
    if (entry?.refreshing) return entry.refreshing;
    const run = load();
    if (entry) {
      entry.lastAttempt = now();
      entry.refreshing = run;
      run.then((value) => { entry.at = now(); entry.value = Promise.resolve(value); }).catch(() => undefined).finally(() => { entry.refreshing = null; schedule(key); });
    }
    return run;
  }

  /** Rebuild again when this value goes stale, as long as the page is still being read. */
  function schedule(key: string) {
    const entry = entries.get(key);
    if (!entry) return;
    if (entry.timer) clearTimer(entry.timer);
    entry.timer = null;
    if (now() - entry.lastRead > keepWarmMs) return;
    const load = loaders.get(key);
    if (!load) return;
    // A full interval from the last attempt, so a failing rebuild (database down) retries once a minute, never in a loop.
    entry.timer = setTimer(() => { entry.timer = null; if (now() - entry.lastRead <= keepWarmMs) void rebuild(key, load).catch(() => undefined); }, Math.max(1, freshMs - (now() - Math.max(entry.at, entry.lastAttempt))));
  }

  function get<T>(key: string, load: () => Promise<T>): Promise<T> {
    loaders.set(key, load);
    const t = now();
    const hit = entries.get(key) as Entry<T> | undefined;
    if (hit) {
      hit.lastRead = t;
      const age = t - hit.at;
      if (age < freshMs) { if (!hit.timer && !hit.refreshing) schedule(key); return hit.value; }
      if (age < staleMs) { void rebuild(key, load).catch(() => undefined); return hit.value; }
      // Too old to show: this request waits for the rebuild (shared by anyone else waiting).
      if (hit.refreshing) return hit.refreshing;
      entries.delete(key);
    }
    const value = load();
    const entry: Entry<T> = { at: t, value, lastRead: t, lastAttempt: t, refreshing: null, timer: null };
    entries.set(key, entry as Entry<unknown>);
    value.then(() => schedule(key)).catch(() => { if (entries.get(key) === entry) entries.delete(key); });
    if (entries.size > 200) { const oldest = entries.keys().next().value as string; const old = entries.get(oldest); if (old?.timer) clearTimer(old.timer); entries.delete(oldest); }
    return value;
  }

  function clear() {
    for (const entry of Array.from(entries.values())) if (entry.timer) clearTimer(entry.timer);
    entries.clear();
    loaders.clear();
  }

  return { get, clear, size: () => entries.size };
}
