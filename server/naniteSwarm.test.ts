import { describe, expect, it } from "vitest";
import {
  nextTierDown,
  selectTier,
  shouldDegrade,
  FIRST_CHECK_SAMPLES,
  STEADY_CHECK_SAMPLES,
} from "../shared/livingLogo";
import {
  classifyNanite,
  clampHorizontal,
  flicker,
  flowAt,
  HORIZONTAL_RATIO_MAX,
  NANITE_BLUE,
  NANITE_GOLD,
  NANITE_WARM_WHITE,
  naniteColor,
  nextSurgeDelay,
  SURGE_FALLOFF_PX,
  SURGE_MAX_BOOST,
  SURGE_MAX_GAP,
  SURGE_MIN_GAP,
  surgeBoost,
  SWARM_BY_TIER,
  swarmCount,
  TEXT_SAFE_ALPHA,
  textSafetyFactor,
  trailLength,
} from "../shared/naniteSwarm";

/**
 * The hero swarm's headline risk is the one the spec calls out explicitly:
 * particles reading as horizontal streaks across the hero. That constraint is
 * enforced in flowAt/clampHorizontal and is exhaustively tested here over the
 * whole field, not spot-checked.
 */

describe("upward bias — the no-horizontal-streaking constraint", () => {
  it("clampHorizontal never lets |vx| exceed the ratio × |vy|", () => {
    for (const vy of [-5, -46, -120, -400]) {
      for (const vx of [-9999, -50, -1, 0, 1, 50, 9999]) {
        const out = clampHorizontal(vx, vy);
        expect(Math.abs(out)).toBeLessThanOrEqual(Math.abs(vy) * HORIZONTAL_RATIO_MAX + 1e-9);
      }
    }
  });

  it("clampHorizontal preserves direction and only ever reduces magnitude", () => {
    expect(clampHorizontal(5, -100)).toBe(5); // within limit → untouched
    expect(clampHorizontal(80, -100)).toBe(40); // clamped down, still positive
    expect(clampHorizontal(-80, -100)).toBe(-40); // clamped down, still negative
    expect(Math.abs(clampHorizontal(80, -100))).toBeLessThan(80);
  });

  it("flowAt ALWAYS moves upward across the whole field and timeline", () => {
    for (let t = 0; t < 30; t += 0.31) {
      for (let x = -100; x <= 1600; x += 97) {
        for (let y = -100; y <= 1200; y += 89) {
          const f = flowAt(x, y, t, 1);
          expect(f.vy, `vy at ${x},${y},t=${t}`).toBeLessThan(0); // negative = up
        }
      }
    }
  });

  it("flowAt never returns a horizontally-dominant velocity", () => {
    let worstRatio = 0;
    for (let t = 0; t < 30; t += 0.23) {
      for (let x = -100; x <= 1600; x += 71) {
        for (let y = -100; y <= 1200; y += 67) {
          for (const speed of [0.45, 1, 1.6]) {
            const f = flowAt(x, y, t, speed);
            const ratio = Math.abs(f.vx) / Math.abs(f.vy);
            worstRatio = Math.max(worstRatio, ratio);
          }
        }
      }
    }
    // The single most horizontal velocity anywhere in the field still obeys the cap.
    expect(worstRatio).toBeLessThanOrEqual(HORIZONTAL_RATIO_MAX + 1e-9);
  });

  it("still produces real horizontal sway (the cap must not flatten motion)", () => {
    let maxAbsVx = 0;
    for (let t = 0; t < 12; t += 0.5) {
      for (let x = 0; x <= 1200; x += 53) {
        maxAbsVx = Math.max(maxAbsVx, Math.abs(flowAt(x, 400, t, 1).vx));
      }
    }
    expect(maxAbsVx).toBeGreaterThan(1); // curves, not a straight vertical rain
  });

  it("scales speed with depth without breaking the ratio", () => {
    const slow = flowAt(300, 300, 4, 0.45);
    const fast = flowAt(300, 300, 4, 1.6);
    expect(Math.abs(fast.vy)).toBeGreaterThan(Math.abs(slow.vy));
    expect(Math.abs(fast.vx) / Math.abs(fast.vy)).toBeLessThanOrEqual(
      HORIZONTAL_RATIO_MAX + 1e-9
    );
  });

  it("is finite everywhere (a NaN would freeze a particle on screen)", () => {
    for (let t = 0; t < 5; t += 0.7) {
      for (const x of [-1e4, 0, 1e4]) {
        for (const y of [-1e4, 0, 1e4]) {
          const f = flowAt(x, y, t, 1);
          expect(Number.isFinite(f.vx)).toBe(true);
          expect(Number.isFinite(f.vy)).toBe(true);
        }
      }
    }
  });
});

describe("tiering + fallback (reused from the Living Logo module)", () => {
  const base = {
    dpr: 2,
    viewportWidth: 375,
    cores: 8,
    memoryGb: 8,
    reducedMotion: false,
    canvasSupported: true,
  };

  it("hits the ~250-300 target at the top tier", () => {
    expect(SWARM_BY_TIER.high).toBeGreaterThanOrEqual(250);
    expect(SWARM_BY_TIER.high).toBeLessThanOrEqual(300);
  });

  it("scales density down per tier and to zero when static", () => {
    expect(SWARM_BY_TIER.high).toBeGreaterThan(SWARM_BY_TIER.medium);
    expect(SWARM_BY_TIER.medium).toBeGreaterThan(SWARM_BY_TIER.low);
    expect(swarmCount("static")).toBe(0);
  });

  it("returns static for reduced-motion so the hero renders as designed", () => {
    expect(selectTier({ ...base, reducedMotion: true })).toBe("static");
    expect(swarmCount(selectTier({ ...base, reducedMotion: true }))).toBe(0);
  });

  it("returns static when no 2D context is available", () => {
    expect(selectTier({ ...base, canvasSupported: false })).toBe("static");
  });

  it("degrades to static from the cheapest tier (gives up rather than stutter)", () => {
    expect(nextTierDown("low")).toBe("static");
  });

  it("reacts on a short first window but ignores brief jank later", () => {
    const slow = Array(FIRST_CHECK_SAMPLES).fill(45);
    expect(shouldDegrade(slow, 21, FIRST_CHECK_SAMPLES)).toBe(true);
    const smoothWithHitch = Array(STEADY_CHECK_SAMPLES).fill(16.6);
    smoothWithHitch[20] = 200;
    expect(shouldDegrade(smoothWithHitch, 21, STEADY_CHECK_SAMPLES)).toBe(false);
  });
});

describe("population classes and palette", () => {
  it("splits into ~6% hero, ~30% comet, remainder points", () => {
    let hero = 0;
    let comet = 0;
    let point = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const k = classifyNanite(i / N);
      if (k === "hero") hero++;
      else if (k === "comet") comet++;
      else point++;
    }
    expect(hero / N).toBeGreaterThan(0.04);
    expect(hero / N).toBeLessThan(0.08); // spec: ~5-7%
    expect(comet / N).toBeGreaterThan(0.25);
    expect(comet / N).toBeLessThan(0.35); // spec: ~30%
    expect(point / N).toBeGreaterThan(0.55); // majority
  });

  it("uses only gold, the rare blue accent, and warm white — no other hues", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const r = i / 500;
      for (const k of ["point", "comet", "hero"] as const) {
        const c = naniteColor(k, r);
        seen.add(`${c.r},${c.g},${c.b}`);
      }
    }
    expect(seen.size).toBe(3);
    expect(seen.has(`${NANITE_GOLD.r},${NANITE_GOLD.g},${NANITE_GOLD.b}`)).toBe(true);
    expect(seen.has(`${NANITE_BLUE.r},${NANITE_BLUE.g},${NANITE_BLUE.b}`)).toBe(true);
    expect(
      seen.has(`${NANITE_WARM_WHITE.r},${NANITE_WARM_WHITE.g},${NANITE_WARM_WHITE.b}`)
    ).toBe(true);
  });

  it("matches the approved warm-white and blue values exactly", () => {
    expect(NANITE_WARM_WHITE).toEqual({ r: 255, g: 246, b: 220 });
    expect(NANITE_BLUE).toEqual({ r: 143, g: 196, b: 233 });
  });

  it("keeps heroes warm white and blue genuinely rare (~7% of non-heroes)", () => {
    expect(naniteColor("hero", 0.001)).toEqual(NANITE_WARM_WHITE);
    expect(naniteColor("hero", 0.999)).toEqual(NANITE_WARM_WHITE);
    let blue = 0;
    const N = 10000;
    for (let i = 0; i < N; i++) if (naniteColor("point", i / N) === NANITE_BLUE) blue++;
    expect(blue / N).toBeGreaterThan(0.05);
    expect(blue / N).toBeLessThan(0.09);
  });

  it("trail lengths match the spec bands and grow with depth", () => {
    expect(trailLength("point", 0)).toBeGreaterThanOrEqual(6);
    expect(trailLength("point", 1)).toBeLessThanOrEqual(16);
    expect(trailLength("comet", 0)).toBeGreaterThanOrEqual(16);
    expect(trailLength("comet", 1)).toBeLessThanOrEqual(34);
    expect(trailLength("hero", 1)).toBeLessThanOrEqual(34);
    for (const k of ["point", "comet", "hero"] as const) {
      expect(trailLength(k, 1)).toBeGreaterThan(trailLength(k, 0));
    }
  });

  it("clamps out-of-range depth instead of producing absurd trails", () => {
    expect(trailLength("point", -5)).toBe(trailLength("point", 0));
    expect(trailLength("point", 9)).toBe(trailLength("point", 1));
  });
});

describe("surge wave", () => {
  it("schedules every 6-12s and clamps bad randomness", () => {
    for (const r of [0, 0.5, 1]) {
      const d = nextSurgeDelay(r);
      expect(d).toBeGreaterThanOrEqual(SURGE_MIN_GAP);
      expect(d).toBeLessThanOrEqual(SURGE_MAX_GAP);
    }
    expect(nextSurgeDelay(-2)).toBe(SURGE_MIN_GAP);
    expect(nextSurgeDelay(4)).toBe(SURGE_MAX_GAP);
  });

  it("peaks at the wave centre and falls to zero at the falloff distance", () => {
    expect(surgeBoost(500, 500)).toBeCloseTo(SURGE_MAX_BOOST, 5);
    expect(surgeBoost(500 + SURGE_FALLOFF_PX, 500)).toBe(0);
    expect(surgeBoost(500 - SURGE_FALLOFF_PX, 500)).toBe(0);
    expect(surgeBoost(500 + SURGE_FALLOFF_PX * 3, 500)).toBe(0);
  });

  it("never exceeds the approved +0.8 boost", () => {
    for (let d = -400; d <= 400; d += 7) {
      const b = surgeBoost(500 + d, 500);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(SURGE_MAX_BOOST + 1e-9);
    }
  });

  it("is symmetric above and below the wave", () => {
    expect(surgeBoost(560, 500)).toBeCloseTo(surgeBoost(440, 500), 10);
  });
});

describe("flicker", () => {
  it("stays within ±20%", () => {
    for (let t = 0; t < 20; t += 0.13) {
      for (const ph of [0, 1.7, 3.3, 6.1]) {
        const f = flicker(t, ph);
        expect(f).toBeGreaterThanOrEqual(0.8 - 1e-9);
        expect(f).toBeLessThanOrEqual(1.2 + 1e-9);
      }
    }
  });

  it("de-syncs particles via their own phase", () => {
    expect(flicker(1, 0)).not.toBeCloseTo(flicker(1, Math.PI), 3);
  });
});

describe("text safety", () => {
  const headline = { x: 40, y: 200, w: 600, h: 160 };
  const ctas = { x: 40, y: 420, w: 700, h: 90 };

  it("dims hard inside a protected rect", () => {
    expect(textSafetyFactor(300, 260, [headline, ctas])).toBe(TEXT_SAFE_ALPHA);
    expect(textSafetyFactor(300, 460, [headline, ctas])).toBe(TEXT_SAFE_ALPHA);
  });

  it("leaves everything outside at full brightness", () => {
    expect(textSafetyFactor(1200, 100, [headline, ctas])).toBe(1);
    expect(textSafetyFactor(300, 700, [headline, ctas])).toBe(1);
    expect(textSafetyFactor(300, 190, [headline, ctas])).toBe(1); // just above
  });

  it("dims to roughly a fifth — legibility is not negotiable", () => {
    expect(TEXT_SAFE_ALPHA).toBeLessThanOrEqual(0.25);
    expect(TEXT_SAFE_ALPHA).toBeGreaterThan(0);
  });

  it("is full brightness when no zones were measured yet", () => {
    expect(textSafetyFactor(300, 260, [])).toBe(1);
  });

  it("treats rect edges as inside (no 1px bright seam along the text)", () => {
    expect(textSafetyFactor(40, 200, [headline])).toBe(TEXT_SAFE_ALPHA);
    expect(textSafetyFactor(640, 360, [headline])).toBe(TEXT_SAFE_ALPHA);
  });
});
