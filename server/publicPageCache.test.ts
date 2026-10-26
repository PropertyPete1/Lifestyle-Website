import { describe, expect, it } from "vitest";
import { createPublicPageCache } from "./publicPageCache";

/** A clock and timer the test drives by hand. */
function harness() {
  let t = 1_000_000;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let nextId = 1;
  const cache = createPublicPageCache({
    freshMs: 60_000, staleMs: 15 * 60_000, keepWarmMs: 10 * 60_000,
    now: () => t,
    setTimer: (fn, ms) => { const id = nextId++; timers.push({ at: t + ms, fn, id }); return id; },
    clearTimer: (handle) => { const index = timers.findIndex((timer) => timer.id === handle); if (index >= 0) timers.splice(index, 1); },
  });
  const advance = async (ms: number) => {
    const until = t + ms;
    while (true) {
      const due = timers.filter((timer) => timer.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      t = due.at; timers.splice(timers.indexOf(due), 1); due.fn();
      // Let the rebuild's promise chain (then / catch / finally / schedule) settle before looking for the next timer.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    t = until;
  };
  return { cache, advance, timers, now: () => t };
}

describe("public page cache (Oct 26: nobody waits on a rebuild while the page is being read)", () => {
  it("serves the fresh value, serves stale while rebuilding in the background, and keeps itself warm on a timer", async () => {
    const { cache, advance, timers } = harness();
    let builds = 0;
    let resolveSlow: ((value: string) => void) | null = null;
    const load = () => { builds += 1; return builds === 2 ? new Promise<string>((resolve) => { resolveSlow = resolve; }) : Promise.resolve(`v${builds}`); };
    expect(await cache.get("catalog", load)).toBe("v1");
    expect(builds).toBe(1);
    // Within the fresh window: no rebuild, and a keep-warm timer is waiting.
    await advance(30_000);
    expect(await cache.get("catalog", load)).toBe("v1");
    expect(builds).toBe(1);
    expect(timers).toHaveLength(1);
    // The timer fires at the fresh boundary: a background rebuild starts (slow), readers still get v1 at once.
    await advance(31_000);
    expect(builds).toBe(2);
    expect(await cache.get("catalog", load)).toBe("v1");
    // The rebuild lands: the next read has v2 without waiting, and a new timer is set.
    resolveSlow!("v2");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await cache.get("catalog", load)).toBe("v2");
    expect(timers).toHaveLength(1);
  });

  it("stops rebuilding once nobody has read the page for the keep-warm window, then rebuilds on the next read", async () => {
    const { cache, advance, timers } = harness();
    let builds = 0;
    const load = () => { builds += 1; return Promise.resolve(`v${builds}`); };
    await cache.get("featured", load);
    // Eleven minutes of silence: timers fire at 1, 2, … minutes while within keep-warm, then stop.
    await advance(11 * 60_000);
    const quietBuilds = builds;
    expect(quietBuilds).toBeGreaterThanOrEqual(10);
    expect(quietBuilds).toBeLessThanOrEqual(11);
    expect(timers).toHaveLength(0);
    await advance(2 * 60_000);
    expect(builds).toBe(quietBuilds);
    // 13 minutes since the last rebuild: still within the stale window, so the reader gets the old value and a rebuild runs.
    const stale = await cache.get("featured", load);
    expect(stale).toBe(`v${quietBuilds}`);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(builds).toBe(quietBuilds + 1);
  });

  it("makes a reader wait only when the value is older than the stale window, and shares that wait", async () => {
    const { cache, advance } = harness();
    let builds = 0;
    let resolveSlow: ((value: string) => void) | null = null;
    const load = () => { builds += 1; return builds === 1 ? Promise.resolve("v1") : new Promise<string>((resolve) => { resolveSlow = resolve; }); };
    await cache.get("catalog", load);
    await advance(20 * 60_000); // past keep-warm (timers stopped) and past stale
    const a = cache.get("catalog", load);
    const b = cache.get("catalog", load);
    expect(builds).toBe(2);
    resolveSlow!("v2");
    expect(await a).toBe("v2");
    expect(await b).toBe("v2");
  });

  it("keeps a pinned key warm with no readers at all, and retries a pinned key whose first load failed", async () => {
    const { cache, advance, timers } = harness();
    let builds = 0;
    const load = () => { builds += 1; return builds === 1 ? Promise.reject(new Error("db down")) : Promise.resolve(`v${builds}`); };
    cache.pin("catalog", load);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(builds).toBe(1);
    expect(timers).toHaveLength(1); // the retry
    await advance(61_000);
    expect(builds).toBe(2);
    // Thirty minutes with nobody reading: still rebuilt every minute, never stale, never cold.
    await advance(30 * 60_000);
    expect(builds).toBeGreaterThanOrEqual(31);
    expect(await cache.get("catalog", load)).toBe(`v${builds}`);
  });

  it("drops a failed first load so the next read tries again, and keeps the old value when a background rebuild fails", async () => {
    const { cache, advance } = harness();
    let builds = 0;
    const load = () => { builds += 1; return builds === 1 || builds === 3 ? Promise.reject(new Error("db down")) : Promise.resolve(`v${builds}`); };
    await expect(cache.get("catalog", load)).rejects.toThrow("db down");
    expect(await cache.get("catalog", load)).toBe("v2");
    await advance(61_000); // timer rebuild #3 fails: the old value stays, and the retry waits a full minute (no tight loop)
    expect(builds).toBe(3);
    // This read is past the fresh window: it gets the old value at once and starts rebuild #4 in the background.
    expect(await cache.get("catalog", load)).toBe("v2");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(builds).toBe(4);
    expect(await cache.get("catalog", load)).toBe("v4");
    await advance(61_000); // the keep-warm timer carries on: #5
    expect(builds).toBe(5);
  });
});
