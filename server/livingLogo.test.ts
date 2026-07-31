import { describe, expect, it } from "vitest";
import {
  bandAngularVelocity,
  breathe,
  DEPTH_BUCKETS,
  fibonacciSphere,
  isOrbHero,
  isTrustworthyFrame,
  TRUSTWORTHY_FRAME_MS,
  FIRST_CHECK_SAMPLES,
  haloCount,
  HALO_BY_TIER,
  MICRO_EVENT_MAX_GAP,
  MICRO_EVENT_MIN_GAP,
  nextMicroEventDelay,
  ORB_HERO_FRACTION,
  nextTierDown,
  nextTierUp,
  tierRank,
  isWarmedUp,
  isOrbDebugEnabled,
  rollingFps,
  recoveryWindowMs,
  shouldRecover,
  DEGRADE_BUDGET_MS,
  RECOVERY_BACKOFF_MAX,
  RECOVERY_BUDGET_MS,
  RECOVERY_MIN_SAMPLES,
  RECOVERY_WINDOW_MS,
  REBUILD_WARMUP_MS,
  WARMUP_MS,
  particleCount,
  PARTICLES_BY_TIER,
  selectTier,
  shimmerBoost,
  shouldDegrade,
  STEADY_CHECK_SAMPLES,
  swell,
  type DeviceHints,
  type PerfTier,
} from "../shared/livingLogo";

/**
 * The Living Logo's hard requirements are performance ones, so the tiering and
 * degradation decisions are tested rather than eyeballed. A regression here
 * ships a janky animation to phones — the exact failure mode the spec forbids.
 */

const base: DeviceHints = {
  dpr: 2,
  viewportWidth: 375,
  cores: 6,
  memoryGb: 6,
  reducedMotion: false,
  canvasSupported: true,
};

describe("selectTier — hard opt-outs win over any hardware hint", () => {
  it("returns static for prefers-reduced-motion, even on a monster device", () => {
    expect(
      selectTier({ ...base, reducedMotion: true, cores: 16, memoryGb: 32, dpr: 1 })
    ).toBe("static");
  });

  it("returns static when no 2D canvas context is available", () => {
    expect(selectTier({ ...base, canvasSupported: false, cores: 16, memoryGb: 32 })).toBe(
      "static"
    );
  });
});

/**
 * Tiering is asserted against what browsers ACTUALLY report on real devices,
 * because the previous policy failed on exactly that ground: live visitors saw
 * a far weaker orb than dev screenshots, and the reason was that every iPhone
 * was being scored as a budget device.
 *
 * The three facts these cases encode:
 *   - iOS Safari reports hardwareConcurrency 4 (6 on 15/16 Pro) and NEVER
 *     reports deviceMemory. Firefox doesn't report it either.
 *   - deviceMemory is Chromium-only and quantised, capping at 8.
 *   - Both renderers clamp their backing store to MAX_DPR = 2, so a 3x screen
 *     paints no more device pixels than a 2x one at the same CSS size.
 */
const phone = (over: Partial<DeviceHints>): DeviceHints => ({
  ...base,
  dpr: 3,
  viewportWidth: 390,
  cores: 4,
  memoryGb: undefined,
  ...over,
});

describe("selectTier — real devices, not guesses", () => {
  it("gives a high-end desktop the top tier", () => {
    expect(
      selectTier({ ...base, dpr: 1, viewportWidth: 1440, cores: 12, memoryGb: 16 })
    ).toBe("high");
  });

  it("REGRESSION: a modern iPhone is not a budget device", () => {
    // iPhone 12/13/14 and SE3 all report 4 cores and no deviceMemory. Under the
    // old `cores <= 4 → low` rule every one of them rendered 240 particles
    // while the dev machine rendered 1150 — the whole reported fidelity gap.
    expect(selectTier(phone({ cores: 4 }))).toBe("high"); // 12/13/14
    expect(selectTier(phone({ cores: 6 }))).toBe("high"); // 15/16 Pro
    expect(selectTier(phone({ cores: 4, dpr: 2, viewportWidth: 375 }))).toBe("high"); // SE3
  });

  it("REGRESSION: unknown memory is no signal, not a small number", () => {
    // Safari/Firefox never expose deviceMemory. Defaulting it to 4GB scored
    // every Apple device as mid-range Android.
    const unknown = selectTier(phone({ cores: 8, memoryGb: undefined }));
    const known = selectTier(phone({ cores: 8, memoryGb: 8 }));
    expect(unknown).toBe(known);
    expect(unknown).toBe("high");
  });

  it("REGRESSION: 3x screens are not penalised for pixels nobody paints", () => {
    // MAX_DPR = 2 in both LivingLogo and NaniteSwarm, so the fill cost at 3x is
    // identical to 2x. The old demotion charged for it anyway.
    for (const cores of [4, 8, 12]) {
      expect(selectTier({ ...base, dpr: 3, cores, memoryGb: 8 })).toBe(
        selectTier({ ...base, dpr: 2, cores, memoryGb: 8 })
      );
    }
  });

  it("still routes flagship and mid Android correctly", () => {
    expect(selectTier(phone({ dpr: 2.625, cores: 8, memoryGb: 8 }))).toBe("high"); // Pixel 8
    expect(selectTier(phone({ cores: 8, memoryGb: 4 }))).toBe("high"); // mid, 8 cores
    expect(selectTier(phone({ dpr: 2, cores: 4, memoryGb: 4 }))).toBe("medium"); // budget
  });

  it("still holds genuinely weak hardware at the floor", () => {
    expect(selectTier({ ...base, cores: 8, memoryGb: 2 })).toBe("low"); // 2GB
    expect(selectTier({ ...base, cores: 2, memoryGb: 8 })).toBe("low"); // dual core
    expect(selectTier({ ...base, cores: 1, memoryGb: 4 })).toBe("low");
  });

  it("lands genuinely mid-range hardware on medium", () => {
    expect(selectTier({ ...base, cores: 6, memoryGb: 6 })).toBe("medium");
    expect(selectTier({ ...base, cores: 4, memoryGb: 4 })).toBe("medium");
  });

  it("never returns static from a hardware hint — only from opt-outs", () => {
    // static is reserved for reduced-motion and no-canvas, plus MEASURED
    // slowness at the cheapest tier. No hint combination may produce it.
    for (const cores of [1, 2, 4, 8, 16]) {
      for (const memoryGb of [undefined, 0.5, 1, 2, 4, 8]) {
        for (const dpr of [1, 2, 3, 4]) {
          expect(selectTier({ ...base, cores, memoryGb, dpr })).not.toBe("static");
        }
      }
    }
  });

  it("is a starting point the measured loop can move in both directions", () => {
    // The optimism above is only safe because assignment is no longer final.
    const assigned = selectTier(phone({ cores: 4 }));
    expect(nextTierDown(assigned)).toBe("medium");
    expect(nextTierUp("medium")).toBe(assigned);
  });
});

describe("tier stepping and budgets", () => {
  it("steps high → medium → low → static and stays there", () => {
    expect(nextTierDown("high")).toBe("medium");
    expect(nextTierDown("medium")).toBe("low");
    expect(nextTierDown("low")).toBe("static");
    expect(nextTierDown("static")).toBe("static");
  });

  it("budgets get strictly cheaper as tiers drop", () => {
    expect(PARTICLES_BY_TIER.high).toBeGreaterThan(PARTICLES_BY_TIER.medium);
    expect(PARTICLES_BY_TIER.medium).toBeGreaterThan(PARTICLES_BY_TIER.low);
    expect(particleCount("static")).toBe(0);
  });
});

describe("shouldDegrade — only sustained slowness counts", () => {
  it("does not react before a full sample window exists", () => {
    expect(shouldDegrade(Array(20).fill(60))).toBe(false); // 20 awful frames, too few
  });

  it("ignores a single hitch inside an otherwise smooth run", () => {
    const frames = Array(60).fill(16.6);
    frames[30] = 180; // one GC pause / scroll jank spike
    expect(shouldDegrade(frames)).toBe(false);
  });

  it("degrades when the average genuinely exceeds the budget", () => {
    expect(shouldDegrade(Array(60).fill(30))).toBe(true); // ~33fps sustained
  });

  it("holds steady at a comfortable 60fps", () => {
    expect(shouldDegrade(Array(90).fill(16.6))).toBe(false);
  });

  it("does not degrade at the borderline just under budget", () => {
    expect(shouldDegrade(Array(60).fill(20))).toBe(false);
    expect(shouldDegrade(Array(60).fill(22))).toBe(true);
  });

  it("only judges the most recent window, so recovery is possible", () => {
    // 45 terrible frames followed by 45 good ones → recent window is good
    const frames = [...Array(45).fill(50), ...Array(45).fill(16.6)];
    expect(shouldDegrade(frames)).toBe(false);
  });
});

describe("fibonacciSphere", () => {
  it("returns the requested number of points", () => {
    expect(fibonacciSphere(260)).toHaveLength(260);
  });

  it("handles degenerate counts without throwing or producing NaN", () => {
    expect(fibonacciSphere(0)).toEqual([]);
    expect(fibonacciSphere(-5)).toEqual([]);
    const one = fibonacciSphere(1);
    expect(one).toHaveLength(1);
    for (const v of Object.values(one[0])) expect(Number.isFinite(v)).toBe(true);
  });

  it("places every point on the unit sphere (radius ≈ 1)", () => {
    for (const p of fibonacciSphere(200)) {
      const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      expect(r).toBeGreaterThan(0.999);
      expect(r).toBeLessThan(1.001);
    }
  });

  it("distributes across both hemispheres rather than clustering", () => {
    const pts = fibonacciSphere(300);
    const upper = pts.filter((p) => p.y > 0).length;
    // Even distribution → close to half above the equator.
    expect(upper).toBeGreaterThan(120);
    expect(upper).toBeLessThan(180);
  });

  it("is deterministic so the mark looks identical on every load", () => {
    expect(fibonacciSphere(50)).toEqual(fibonacciSphere(50));
  });
});

describe("breathe", () => {
  it("stays within a subtle ±8% envelope (never a pumping gimmick)", () => {
    for (let t = 0; t < 60; t += 0.05) {
      const s = breathe(t);
      expect(s).toBeGreaterThan(0.92);
      expect(s).toBeLessThan(1.08);
    }
  });

  it("actually varies over time", () => {
    const samples = [0, 1, 2, 3, 4].map((t) => breathe(t));
    expect(new Set(samples).size).toBeGreaterThan(1);
  });

  it("is finite for any input", () => {
    for (const t of [0, 0.001, 1e6]) expect(Number.isFinite(breathe(t))).toBe(true);
  });
});

/* ===================== v2: density, structure, micro-events ============== */

describe("v2 budgets", () => {
  it("meaningfully increases density over v1 on capable tiers", () => {
    // v1 shipped 420/260/140; v2 should be a real step up, not a nudge.
    expect(PARTICLES_BY_TIER.high).toBeGreaterThanOrEqual(800);
    expect(PARTICLES_BY_TIER.medium).toBeGreaterThanOrEqual(450);
  });

  it("keeps the cheapest tier genuinely cheap", () => {
    expect(PARTICLES_BY_TIER.low).toBeLessThanOrEqual(260);
  });

  it("adds a sparse halo that never rivals the main volume", () => {
    for (const tier of ["high", "medium", "low"] as const) {
      expect(HALO_BY_TIER[tier]).toBeGreaterThan(0);
      expect(HALO_BY_TIER[tier]).toBeLessThan(PARTICLES_BY_TIER[tier] / 3);
    }
  });

  it("halo shrinks with tier and is zero when static", () => {
    expect(haloCount("high")).toBeGreaterThan(haloCount("medium"));
    expect(haloCount("medium")).toBeGreaterThan(haloCount("low"));
    expect(haloCount("static")).toBe(0);
  });

  it("uses multiple depth buckets so depth can drive colour, not just alpha", () => {
    expect(DEPTH_BUCKETS).toBeGreaterThanOrEqual(3);
  });

  it("reacts faster on the first check than in steady state", () => {
    expect(FIRST_CHECK_SAMPLES).toBeLessThan(STEADY_CHECK_SAMPLES);
    // A device struggling from frame 1 degrades within the short window.
    expect(shouldDegrade(Array(FIRST_CHECK_SAMPLES).fill(40), 21, FIRST_CHECK_SAMPLES)).toBe(true);
    // ...but that same sample count must NOT trip the steady-state window.
    expect(shouldDegrade(Array(FIRST_CHECK_SAMPLES).fill(40), 21, STEADY_CHECK_SAMPLES)).toBe(false);
  });
});

describe("bandAngularVelocity — visible bands, no reversal", () => {
  it("always moves forward (a reversed band would read as a glitch)", () => {
    for (let phi = 0; phi <= Math.PI; phi += Math.PI / 60) {
      expect(bandAngularVelocity(phi)).toBeGreaterThan(0);
    }
  });

  it("spins the equator faster than the poles (differential shear)", () => {
    const pole = bandAngularVelocity(0);
    const equator = bandAngularVelocity(Math.PI / 2);
    expect(equator).toBeGreaterThan(pole * 1.5);
  });

  it("stays slow enough to read as majestic, not spinning", () => {
    for (let phi = 0; phi <= Math.PI; phi += Math.PI / 60) {
      // < 0.4 rad/s ⇒ slower than one revolution per ~15s
      expect(bandAngularVelocity(phi)).toBeLessThan(0.4);
    }
  });

  it("varies non-monotonically so banding is not one smooth gradient", () => {
    const samples = Array.from({ length: 40 }, (_, i) =>
      bandAngularVelocity((i / 39) * Math.PI)
    );
    let direction = 0;
    let changes = 0;
    for (let i = 1; i < samples.length; i++) {
      const d = Math.sign(samples[i] - samples[i - 1]);
      if (d !== 0 && d !== direction) {
        if (direction !== 0) changes++;
        direction = d;
      }
    }
    expect(changes).toBeGreaterThan(0);
  });
});

describe("swell — coordinated brightness waves", () => {
  it("stays within 0..1 for any position and time", () => {
    for (let t = 0; t < 40; t += 0.37) {
      for (let phi = 0; phi <= Math.PI; phi += Math.PI / 12) {
        for (let th = 0; th < Math.PI * 2; th += Math.PI / 6) {
          const s = swell(phi, th, t);
          expect(s).toBeGreaterThanOrEqual(0);
          expect(s).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("differs across the surface at one instant (so waves are visible)", () => {
    const at = (phi: number) => swell(phi, 0, 3);
    const vals = [0.2, 1.0, 1.8, 2.6].map(at);
    expect(new Set(vals.map((v) => v.toFixed(3))).size).toBeGreaterThan(1);
  });

  it("travels over time at a fixed point", () => {
    const a = swell(1.2, 0.5, 0);
    const b = swell(1.2, 0.5, 2);
    expect(Math.abs(a - b)).toBeGreaterThan(0.01);
  });
});

describe("nextMicroEventDelay", () => {
  it("always falls in the 6-12s window", () => {
    for (const r of [0, 0.25, 0.5, 0.99, 1]) {
      const d = nextMicroEventDelay(r);
      expect(d).toBeGreaterThanOrEqual(MICRO_EVENT_MIN_GAP);
      expect(d).toBeLessThanOrEqual(MICRO_EVENT_MAX_GAP);
    }
  });

  it("clamps out-of-range randomness instead of drifting out of spec", () => {
    expect(nextMicroEventDelay(-3)).toBe(MICRO_EVENT_MIN_GAP);
    expect(nextMicroEventDelay(9)).toBe(MICRO_EVENT_MAX_GAP);
  });
});

describe("shimmerBoost — rare arc, contained and gentle", () => {
  it("is inert outside an active event", () => {
    expect(shimmerBoost(1.5, 0, 0, 1.5)).toBe(0);
    expect(shimmerBoost(1.5, 0, 1, 1.5)).toBe(0);
    expect(shimmerBoost(1.5, 0, -0.2, 1.5)).toBe(0);
  });

  it("never exceeds 1 anywhere in the sweep", () => {
    for (let p = 0.01; p < 1; p += 0.01) {
      for (let phi = 0; phi <= Math.PI; phi += Math.PI / 24) {
        for (let th = -Math.PI; th <= Math.PI; th += Math.PI / 12) {
          const b = shimmerBoost(phi, th, p, Math.PI / 2);
          expect(b).toBeGreaterThanOrEqual(0);
          expect(b).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("only lights a band near the event latitude", () => {
    const onBand = shimmerBoost(Math.PI / 2, 0, 0.5, Math.PI / 2);
    const farOff = shimmerBoost(0.2, 0, 0.5, Math.PI / 2);
    expect(farOff).toBe(0);
    expect(onBand).toBeGreaterThan(0);
  });

  it("actually lights someone as the head sweeps (arc is reachable)", () => {
    let peak = 0;
    for (let p = 0.02; p < 1; p += 0.02) {
      for (let th = -Math.PI; th <= Math.PI; th += 0.05) {
        peak = Math.max(peak, shimmerBoost(Math.PI / 2, th, p, Math.PI / 2));
      }
    }
    expect(peak).toBeGreaterThan(0.5);
  });

  it("eases in and out rather than popping", () => {
    // At the same longitude offset, mid-event must be brighter than the edges.
    const head = (p: number) => -Math.PI + p * Math.PI * 2;
    const mid = shimmerBoost(Math.PI / 2, head(0.5), 0.5, Math.PI / 2);
    const early = shimmerBoost(Math.PI / 2, head(0.03), 0.03, Math.PI / 2);
    expect(mid).toBeGreaterThan(early);
  });

  it("handles unwrapped longitudes (theta grows without bound over time)", () => {
    const wrapped = shimmerBoost(Math.PI / 2, 0.3, 0.5, Math.PI / 2);
    const same = shimmerBoost(Math.PI / 2, 0.3 + Math.PI * 2 * 5, 0.5, Math.PI / 2);
    expect(same).toBeCloseTo(wrapped, 5);
  });
});

describe("isTrustworthyFrame — stalls must not be read as slowness", () => {
  it("accepts normal frame deltas", () => {
    for (const ms of [8, 16.6, 21, 33, 39]) expect(isTrustworthyFrame(ms)).toBe(true);
  });

  it("rejects stalled frames (throttled tab, app switch, long task)", () => {
    for (const ms of [TRUSTWORTHY_FRAME_MS, 50, 120, 2000]) {
      expect(isTrustworthyFrame(ms)).toBe(false);
    }
  });

  it("rejects zero/negative deltas", () => {
    expect(isTrustworthyFrame(0)).toBe(false);
    expect(isTrustworthyFrame(-5)).toBe(false);
  });

  it("sits above the degrade budget so real slowness is still measurable", () => {
    // Frames between the 21ms budget and the 40ms ceiling MUST still count,
    // otherwise a genuinely struggling device could never trigger a downgrade.
    expect(TRUSTWORTHY_FRAME_MS).toBeGreaterThan(21);
    expect(isTrustworthyFrame(30)).toBe(true);
    expect(shouldDegrade(Array(STEADY_CHECK_SAMPLES).fill(30))).toBe(true);
  });

  it("a clamped-stall run would have degraded — the guard prevents it", () => {
    // Regression: the motion clamp is 50ms, above the 21ms budget. Before the
    // guard, a throttled tab fed 50ms samples in and the animation shed tiers
    // all the way to static for reasons unrelated to render cost.
    const clampedStalls = Array(STEADY_CHECK_SAMPLES).fill(50);
    expect(shouldDegrade(clampedStalls)).toBe(true); // would have degraded...
    expect(clampedStalls.every((ms) => !isTrustworthyFrame(ms))).toBe(true); // ...but none are measurable
  });
});

/* ===================== v3: intensity pass ================================ */

describe("v3 intensity — density and brightness floor", () => {
  it("is denser than v2 on capable tiers", () => {
    expect(PARTICLES_BY_TIER.high).toBeGreaterThan(880); // v2 value
    expect(PARTICLES_BY_TIER.medium).toBeGreaterThan(480);
  });

  it("holds the cheapest tier nearly flat — brightness, not count, on weak devices", () => {
    // The whole point of the pass is to raise the visual floor without raising
    // the frame cost where budget is tight.
    expect(PARTICLES_BY_TIER.low).toBeLessThanOrEqual(260);
  });

  it("lifts the swell floor so troughs are no longer near-black", () => {
    let min = 1;
    for (let t = 0; t < 25; t += 0.17) {
      for (let phi = 0; phi <= Math.PI; phi += 0.19) {
        for (let th = 0; th < Math.PI * 2; th += 0.29) {
          min = Math.min(min, swell(phi, th, t));
        }
      }
    }
    expect(min).toBeGreaterThan(0.2); // v2 bottomed out at 0
    expect(min).toBeLessThan(0.45); // but still has real contrast
  });

  it("keeps swell bounded to 0..1 despite the raised floor", () => {
    for (let t = 0; t < 15; t += 0.23) {
      for (let phi = 0; phi <= Math.PI; phi += 0.21) {
        const v = swell(phi, 1.1, t);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("v3 intensity — flow bands unmistakable", () => {
  it("widens the equator-to-pole shear well beyond v2", () => {
    const pole = bandAngularVelocity(0);
    const equator = bandAngularVelocity(Math.PI / 2);
    // v2 sat around 2.6x; the pass targets a visibly stronger shear.
    expect(equator / pole).toBeGreaterThan(3.5);
  });

  it("still never reverses a band", () => {
    for (let phi = 0; phi <= Math.PI; phi += Math.PI / 120) {
      expect(bandAngularVelocity(phi)).toBeGreaterThan(0);
    }
  });

  it("stays majestic — the fastest band still takes >12s per revolution", () => {
    let max = 0;
    for (let phi = 0; phi <= Math.PI; phi += Math.PI / 240) {
      max = Math.max(max, bandAngularVelocity(phi));
    }
    expect((Math.PI * 2) / max).toBeGreaterThan(12);
  });
});

describe("v3 intensity — shimmer cadence", () => {
  it("fires every 4-8s (was 6-12s)", () => {
    expect(MICRO_EVENT_MIN_GAP).toBe(4);
    expect(MICRO_EVENT_MAX_GAP).toBe(8);
    for (const r of [0, 0.5, 1]) {
      const d = nextMicroEventDelay(r);
      expect(d).toBeGreaterThanOrEqual(4);
      expect(d).toBeLessThanOrEqual(8);
    }
  });
});

describe("v3 intensity — hero bloom points", () => {
  it("promotes a small fraction to bloom points", () => {
    let heroes = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) if (isOrbHero(i / N)) heroes++;
    expect(heroes / N).toBeCloseTo(ORB_HERO_FRACTION, 2);
  });

  it("matches the hero swarm on AREAL density, not percentage", () => {
    // The orb packs its particles into a tiny area, so copying the swarm's ~6%
    // would crowd the form with white and wash out the gold identity.
    expect(ORB_HERO_FRACTION).toBeLessThan(0.03);
    // ...but there must still be enough to read as an accent species.
    const bloomsAtHighTier = PARTICLES_BY_TIER.high * ORB_HERO_FRACTION;
    expect(bloomsAtHighTier).toBeGreaterThan(10);
    expect(bloomsAtHighTier).toBeLessThan(30);
  });

  it("scales bloom count with tier, so weak devices get fewer", () => {
    const at = (t: "high" | "medium" | "low") => PARTICLES_BY_TIER[t] * ORB_HERO_FRACTION;
    expect(at("high")).toBeGreaterThan(at("medium"));
    expect(at("medium")).toBeGreaterThan(at("low"));
  });
});

/* ===================== v4: warm-up, recovery, debug view ================= */

describe("warm-up — load jank must not decide the session", () => {
  it("discards frames until the device has actually settled", () => {
    expect(isWarmedUp(0)).toBe(false);
    expect(isWarmedUp(WARMUP_MS - 1)).toBe(false);
    expect(isWarmedUp(WARMUP_MS)).toBe(true);
  });

  it("covers the jankiest seconds of a page load", () => {
    expect(WARMUP_MS).toBeGreaterThanOrEqual(2000);
  });

  it("re-warms briefly after a rebuild, not for the full load window", () => {
    // A tier change only has to let new buffers settle; making it wait the full
    // load grace would leave a struggling device stuttering for seconds.
    expect(REBUILD_WARMUP_MS).toBeLessThan(WARMUP_MS);
    expect(isWarmedUp(REBUILD_WARMUP_MS, REBUILD_WARMUP_MS)).toBe(true);
    expect(isWarmedUp(REBUILD_WARMUP_MS - 1, REBUILD_WARMUP_MS)).toBe(false);
  });

  it("still lets a genuinely slow device shed a tier promptly after warm-up", () => {
    // Grace is a delay, not an amnesty: the first check window is unchanged.
    expect(shouldDegrade(Array(FIRST_CHECK_SAMPLES).fill(40), 21, FIRST_CHECK_SAMPLES)).toBe(true);
  });
});

describe("recovery — a bad moment is no longer permanent", () => {
  const healthy = Array(RECOVERY_MIN_SAMPLES).fill(16.6);
  const marginal = Array(RECOVERY_MIN_SAMPLES).fill(19);

  it("steps a tier back up after a sustained healthy window", () => {
    expect(shouldRecover(healthy, RECOVERY_WINDOW_MS)).toBe(true);
  });

  it("will not act on a short healthy streak", () => {
    expect(shouldRecover(healthy, RECOVERY_WINDOW_MS - 1)).toBe(false);
    expect(shouldRecover(healthy, 0)).toBe(false);
  });

  it("will not act on too few samples, however long the streak", () => {
    expect(shouldRecover(Array(RECOVERY_MIN_SAMPLES - 1).fill(16.6), 60_000)).toBe(false);
    expect(shouldRecover([], 60_000)).toBe(false);
  });

  it("leaves a hysteresis band so the two decisions can never chatter", () => {
    // Between the recovery budget and the degrade budget, NEITHER fires.
    expect(RECOVERY_BUDGET_MS).toBeLessThan(DEGRADE_BUDGET_MS);
    expect(shouldRecover(marginal, 60_000)).toBe(false);
    expect(shouldDegrade(marginal, DEGRADE_BUDGET_MS, RECOVERY_MIN_SAMPLES)).toBe(false);
  });

  it("demands a longer proof each time a tier is handed back", () => {
    expect(recoveryWindowMs(0)).toBe(RECOVERY_WINDOW_MS);
    expect(recoveryWindowMs(1)).toBe(RECOVERY_WINDOW_MS * 2);
    expect(recoveryWindowMs(2)).toBe(RECOVERY_WINDOW_MS * 4);
    // ...and stops growing, so it can't become unreachable.
    expect(recoveryWindowMs(9)).toBe(recoveryWindowMs(RECOVERY_BACKOFF_MAX));
    expect(recoveryWindowMs(-3)).toBe(RECOVERY_WINDOW_MS);
    // A second step-up on the same streak length that earned the first: no.
    expect(shouldRecover(healthy, RECOVERY_WINDOW_MS, 1)).toBe(false);
    expect(shouldRecover(healthy, RECOVERY_WINDOW_MS * 2, 1)).toBe(true);
  });

  it("steps up one tier at a time and stops at high", () => {
    expect(nextTierUp("low")).toBe("medium");
    expect(nextTierUp("medium")).toBe("high");
    expect(nextTierUp("high")).toBe("high");
  });

  it("never resurrects an animation that gave up entirely", () => {
    // Reaching "static" stops the loop, so no frames are measured and recovery
    // can never be evaluated. The rank check is the belt to that braces.
    expect(tierRank("static")).toBeGreaterThan(tierRank("low"));
    expect(tierRank("high")).toBe(0);
  });

  it("caps recovery at the tier the hardware was assigned", () => {
    // The loop only recovers while rank(current) > rank(assigned).
    const assigned: PerfTier = "medium";
    expect(tierRank("low") > tierRank(assigned)).toBe(true); // may step up
    expect(tierRank("medium") > tierRank(assigned)).toBe(false); // already there
    expect(tierRank("high") > tierRank(assigned)).toBe(false); // never above
  });

  it("round-trips: degrade then recover returns the original tier", () => {
    const start: PerfTier = "high";
    const dropped = nextTierDown(start);
    expect(dropped).toBe("medium");
    expect(nextTierUp(dropped)).toBe(start);
  });
});

describe("?orbDebug — opt-in, and genuinely off by default", () => {
  it("is off for ordinary visitors", () => {
    expect(isOrbDebugEnabled("")).toBe(false);
    expect(isOrbDebugEnabled("?utm_source=instagram")).toBe(false);
    expect(isOrbDebugEnabled("?orb=1")).toBe(false);
    expect(isOrbDebugEnabled("?myOrbDebug=1")).toBe(false);
  });

  it("turns on for the documented forms", () => {
    expect(isOrbDebugEnabled("?orbDebug=1")).toBe(true);
    expect(isOrbDebugEnabled("?orbDebug=true")).toBe(true);
    expect(isOrbDebugEnabled("?orbDebug")).toBe(true);
    expect(isOrbDebugEnabled("?utm_source=ig&orbDebug=1")).toBe(true);
    expect(isOrbDebugEnabled("orbDebug=1")).toBe(true); // no leading ?
  });

  it("respects an explicit off, so a stale link can't strand the panel", () => {
    expect(isOrbDebugEnabled("?orbDebug=0")).toBe(false);
    expect(isOrbDebugEnabled("?orbDebug=false")).toBe(false);
  });
});

describe("rollingFps", () => {
  it("reports the framerate implied by recent deltas", () => {
    expect(rollingFps(Array(30).fill(16.6))).toBe(60);
    expect(rollingFps(Array(30).fill(33.3))).toBe(30);
  });

  it("only looks at the recent window, so recovery shows up quickly", () => {
    const frames = [...Array(60).fill(50), ...Array(30).fill(16.6)];
    expect(rollingFps(frames, 30)).toBe(60);
  });

  it("handles an empty or degenerate history without NaN", () => {
    expect(rollingFps([])).toBe(0);
    expect(rollingFps([0])).toBe(0);
    expect(Number.isFinite(rollingFps([1e-9]))).toBe(true);
  });
});
