import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PARTICLES_BY_TIER, particleCount, selectTier, type DeviceHints } from "../shared/livingLogo";
import { swarmCount } from "../shared/naniteSwarm";

/**
 * ORB FIDELITY — the gap between dev screenshots and what live visitors got.
 *
 * The live bundle was confirmed to contain the v3 intensity pass, so the cause
 * was never a stale deploy: it was tiering. Every iPhone was scored as a budget
 * device and rendered 240 of 1150 particles, and any tier lost to load jank was
 * lost for the rest of the session because degradation was one-way.
 *
 * These cases pin the outcome (what a real phone actually receives) and the
 * component wiring that makes it reversible. The arithmetic behind them lives
 * in livingLogo.test.ts.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
/** Strip comments so explanatory prose can neither satisfy nor trip a check. */
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const ORB = strip(read("client/src/components/LivingLogo.tsx"));
const SWARM = strip(read("client/src/components/NaniteSwarm.tsx"));

/** What browsers actually report. `undefined` memory = Safari or Firefox. */
const DEVICES: Array<[string, Partial<DeviceHints>]> = [
  ["iPhone 12/13/14 Safari", { dpr: 3, viewportWidth: 390, cores: 4, memoryGb: undefined }],
  ["iPhone 15/16 Pro Safari", { dpr: 3, viewportWidth: 393, cores: 6, memoryGb: undefined }],
  ["iPhone SE3 Safari", { dpr: 2, viewportWidth: 375, cores: 4, memoryGb: undefined }],
  ["iPad Pro Safari", { dpr: 2, viewportWidth: 1024, cores: 8, memoryGb: undefined }],
  ["Pixel 8 Chrome", { dpr: 2.625, viewportWidth: 412, cores: 8, memoryGb: 8 }],
  ["Galaxy S23 Chrome", { dpr: 3, viewportWidth: 360, cores: 8, memoryGb: 8 }],
  ["Android Firefox", { dpr: 3, viewportWidth: 412, cores: 8, memoryGb: undefined }],
];

const tierFor = (over: Partial<DeviceHints>) =>
  selectTier({
    dpr: 2,
    viewportWidth: 375,
    reducedMotion: false,
    canvasSupported: true,
    ...over,
  });

describe("what a real phone actually receives", () => {
  it("gives every modern phone the top tier — the dev-vs-live gap is closed", () => {
    for (const [name, hints] of DEVICES) {
      expect(tierFor(hints), name).toBe("high");
    }
  });

  it("no longer hands phones a fifth of the desktop's density", () => {
    const desktop = particleCount(tierFor({ dpr: 2, viewportWidth: 1512, cores: 12 }));
    for (const [name, hints] of DEVICES) {
      expect(particleCount(tierFor(hints)), name).toBe(desktop);
    }
    // The old policy put these devices on `low`. Whatever the tier names mean
    // later, the gap that produced the complaint was this ratio.
    expect(PARTICLES_BY_TIER.high / PARTICLES_BY_TIER.low).toBeGreaterThan(4);
  });

  it("raises the homepage swarm on the same devices, since the policy is shared", () => {
    for (const [name, hints] of DEVICES) {
      expect(swarmCount(tierFor(hints)), name).toBe(swarmCount("high"));
    }
  });

  it("does not raise devices that are genuinely weak", () => {
    expect(tierFor({ cores: 4, memoryGb: 2 })).toBe("low");
    expect(tierFor({ cores: 2 })).toBe("low");
    expect(tierFor({ cores: 4, memoryGb: 4 })).toBe("medium");
  });
});

describe("both renderers cap DPR — which is why the DPR penalty was wrong", () => {
  it("clamps the backing store to 2x", () => {
    for (const [name, src] of [["orb", ORB], ["swarm", SWARM]] as const) {
      expect(src, name).toContain("const MAX_DPR = 2");
      expect(src, name).toMatch(/Math\.min\(window\.devicePixelRatio \|\| 1, MAX_DPR\)/);
    }
  });
});

describe("load jank is no longer a life sentence", () => {
  for (const [name, src] of [["orb", ORB], ["swarm", SWARM]] as const) {
    it(`${name}: discards frames until the warm-up has elapsed`, () => {
      expect(src).toContain("isWarmedUp");
      expect(src).toMatch(/const warm = isWarmedUp\(now - builtAt, warmupMs\)/);
      // Measurement is gated on `warm`, both for sampling and for the decision.
      expect(src).toMatch(/\} else if \(warm\) \{[\s\S]{0,120}frameTimes\.push\(dtMs\)/);
      expect(src).toMatch(/if \(warm && shouldDegrade\(/);
    });

    it(`${name}: can step a tier back up, capped at the assigned tier`, () => {
      expect(src).toContain("shouldRecover");
      expect(src).toContain("nextTierUp");
      expect(src).toMatch(/tierRank\(tier\) > tierRank\(assignedTier\)/);
      expect(src).toMatch(/const assignedTier = tier/);
    });

    it(`${name}: keeps the trustworthy-frame stall guard intact`, () => {
      expect(src).toContain("isTrustworthyFrame");
      // A stall still wipes the window — and now also breaks the healthy streak,
      // so time spent stalled can never be counted as proof of health.
      expect(src).toMatch(/if \(!isTrustworthyFrame\(dtMs\)\) \{[\s\S]{0,160}healthySince = -1/);
    });

    it(`${name}: a resume after hidden/offscreen re-arms rather than resumes judging`, () => {
      expect(src).toMatch(/rearm\(now, REBUILD_WARMUP_MS\)/);
    });

    it(`${name}: still gives up to the static fallback at the floor`, () => {
      expect(src).toContain('if (next === "static")');
    });
  }
});

describe("?orbDebug=1 overlay", () => {
  it("is opt-in and reads the flag from the URL", () => {
    expect(ORB).toContain("isOrbDebugEnabled");
    expect(ORB).toMatch(/isOrbDebugEnabled\(window\.location\.search\)/);
  });

  it("reports tier, particle count and rolling fps", () => {
    expect(ORB).toContain("rollingFps");
    expect(ORB).toMatch(/stats\.tier = tier/);
    expect(ORB).toMatch(/stats\.particles = n/);
    expect(ORB).toMatch(/stats\.fps = rollingFps\(frameTimes\)/);
  });

  it("shows the assigned tier too, so a downgrade is visible as such", () => {
    expect(ORB).toContain("stats.assigned = assignedTier");
    expect(ORB).toContain("debug.assigned");
  });

  it("contributes zero layout — fixed and pointer-events-none", () => {
    const panel = ORB.slice(ORB.indexOf('data-testid="orb-debug"'));
    const cls = panel.slice(panel.indexOf("className="), panel.indexOf(">"));
    expect(cls).toContain("fixed");
    expect(cls).toContain("pointer-events-none");
  });

  it("costs nothing when the flag is absent — no timer, no per-frame work", () => {
    // The 4Hz publish interval is only created under the flag...
    expect(ORB).toMatch(/if \(debugOn\) \{[\s\S]{0,600}setInterval/);
    // ...and the hot loop's writes are guarded too, so a normal visitor pays
    // nothing per frame.
    expect(ORB).toMatch(/if \(debugOn\) \{\s*stats\.tier = tier/);
  });

  it("cleans its timer up on unmount, including the static-only path", () => {
    expect(ORB).toContain("window.clearInterval(debugTimer)");
    expect(ORB).toMatch(/return \(\) => window\.clearInterval\(debugTimer\)/);
  });

  it("never renders for a visitor who did not ask for it", () => {
    // `debug` state starts null and is only ever set inside the debugOn branch.
    expect(ORB).toMatch(/useState<OrbDebug \| null>\(null\)/);
    expect(ORB).toContain("{debug && (");
  });
});

describe("fallbacks and perf discipline unchanged", () => {
  it("orb still honours reduced motion and a missing canvas", () => {
    expect(ORB).toContain("prefers-reduced-motion: reduce");
    expect(ORB).toMatch(/canvasSupported: !!probe/);
    expect(ORB).toContain("setStaticOnly(true)");
  });

  it("orb still reserves its box up-front, so the canvas cannot shift layout", () => {
    expect(ORB).toMatch(/style=\{\{ width: size, height: size \}\}/);
    expect(ORB).toContain("absolute inset-0");
  });

  it("both loops still stop entirely when hidden or scrolled away", () => {
    for (const [name, src] of [["orb", ORB], ["swarm", SWARM]] as const) {
      expect(src, name).toContain("IntersectionObserver");
      expect(src, name).toContain("visibilitychange");
    }
  });

  it("keeps the tier budgets exactly where the v3 pass put them", () => {
    expect(PARTICLES_BY_TIER).toEqual({ high: 1150, medium: 620, low: 240 });
  });
});

describe("the healthy streak is about health, not uptime", () => {
  for (const [name, src] of [["orb", ORB], ["swarm", SWARM]] as const) {
    it(`${name}: a slow-but-trustworthy frame restarts the streak`, () => {
      // Caught in live driving: the streak was only broken by stalls, so a
      // device running steadily at 33fps accrued a "healthy" 10s and could
      // claim a tier back off one brief good patch.
      expect(src).toMatch(/if \(dtMs > DEGRADE_BUDGET_MS\) healthySince = -1;\s*else if \(healthySince < 0\) healthySince = now;/);
    });

    it(`${name}: tolerates 60fps jitter rather than resetting on every frame`, () => {
      // The threshold is the DEGRADE budget (21ms), not the stricter recovery
      // budget — a 17-20ms frame is normal at 60fps and must not reset the clock.
      expect(src).not.toMatch(/dtMs > RECOVERY_BUDGET_MS\) healthySince/);
    });
  }
});
