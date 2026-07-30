import { describe, expect, it } from "vitest";
import {
  bandAngularVelocity,
  breathe,
  DEPTH_BUCKETS,
  fibonacciSphere,
  isTrustworthyFrame,
  TRUSTWORTHY_FRAME_MS,
  FIRST_CHECK_SAMPLES,
  haloCount,
  HALO_BY_TIER,
  MICRO_EVENT_MAX_GAP,
  MICRO_EVENT_MIN_GAP,
  nextMicroEventDelay,
  nextTierDown,
  particleCount,
  PARTICLES_BY_TIER,
  selectTier,
  shimmerBoost,
  shouldDegrade,
  STEADY_CHECK_SAMPLES,
  swell,
  type DeviceHints,
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

describe("selectTier — device hints", () => {
  it("gives a high-end desktop the top tier", () => {
    expect(
      selectTier({ ...base, dpr: 1, viewportWidth: 1440, cores: 12, memoryGb: 16 })
    ).toBe("high");
  });

  it("gives a low-core phone the cheapest animated tier", () => {
    expect(selectTier({ ...base, cores: 4, memoryGb: 4 })).toBe("low");
  });

  it("treats very low memory as low-end regardless of core count", () => {
    expect(selectTier({ ...base, cores: 8, memoryGb: 2 })).toBe("low");
  });

  it("lands mid-range hardware on medium", () => {
    expect(selectTier({ ...base, cores: 6, memoryGb: 6 })).toBe("medium");
  });

  it("assumes mid-range (not best-case) when hints are unavailable", () => {
    const t = selectTier({
      dpr: 2,
      viewportWidth: 375,
      reducedMotion: false,
      canvasSupported: true,
    });
    // cores/memory default to 4 → low. Never "high" on an unknown device.
    expect(t).not.toBe("high");
    expect(t).not.toBe("static");
  });

  it("steps down a tier on 3x-DPR screens (fill cost is quadratic in dpr)", () => {
    const at2x = selectTier({ ...base, dpr: 2, cores: 12, memoryGb: 16 });
    const at3x = selectTier({ ...base, dpr: 3, cores: 12, memoryGb: 16 });
    expect(at2x).toBe("high");
    expect(at3x).toBe("medium");
  });

  it("never lets a DPR penalty alone disable the animation", () => {
    // low + 3x DPR must stay animated; static is reserved for opt-outs and
    // measured slowness.
    expect(selectTier({ ...base, dpr: 3, cores: 4, memoryGb: 4 })).toBe("low");
  });

  it("gives a capable desktop headroom a phone would not get", () => {
    const phone = selectTier({ ...base, viewportWidth: 375, cores: 8, memoryGb: 6 });
    const desktop = selectTier({ ...base, dpr: 1, viewportWidth: 1440, cores: 8, memoryGb: 6 });
    expect(phone).toBe("medium");
    expect(desktop).toBe("high");
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
