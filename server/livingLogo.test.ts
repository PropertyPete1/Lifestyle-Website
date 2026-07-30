import { describe, expect, it } from "vitest";
import {
  breathe,
  fibonacciSphere,
  nextTierDown,
  particleCount,
  PARTICLES_BY_TIER,
  selectTier,
  shouldDegrade,
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
