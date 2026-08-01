import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BORDER_ALPHA_DRAW,
  BORDER_ALPHA_SETTLED,
  borderHeadPaths,
  borderLoop,
  borderRect,
  branchBirthMs,
  CONTENT_REVEAL_FRACTION,
  CONTENT_REVEAL_MAX_MS,
  CONTENT_FADE_MS,
  contentRevealMs,
  CROWN_ALPHA_DRAW,
  CROWN_ALPHA_SETTLED,
  CROWN_PAD,
  crownHeadPaths,
  crownLoop,
  crownRectFromHeadline,
  distanceAtDepth,
  EDGE_INSET,
  entranceDurationMs,
  hasSeenEntrance,
  HEAD_SPEED,
  isUsableRect,
  markEntranceSeen,
  pointAt,
  pointAtLooped,
  polylineLength,
  RACER_SPEED,
  racerDistance,
  SESSION_KEY,
  shouldPlayEntrance,
  sliceUpTo,
  tailPoints,
  type Rect,
} from "../shared/crownBranch";

/**
 * THE CROWN BRANCH — path geometry, the branch trigger, and the session gate.
 *
 * The prototype was approved on how it MOVES, so the properties worth locking
 * down are the ones that make the movement read as one mechanism: every head
 * running at one speed, the two halves of each pair being mirror images (so
 * they arrive together without any timing fudge), and the crown being derived
 * from the measured headline rather than assumed — which is the only reason it
 * can survive a two-line mobile wrap, a late font swap, or the Now Hiring
 * banner changing height under it.
 */

const HERO: Rect = { left: 0, top: 0, right: 1280, bottom: 800 };
const W = 1280;
const H = 800;

/** A desktop headline block, as getBoundingClientRect would report it. */
const HEADLINE: Rect = { left: 40, top: 300, right: 900, bottom: 460 };

describe("one speed for the whole system", () => {
  it("moves every head at the same constant px/ms", () => {
    // The brief's hard requirement: one shared speed constant, not per-path
    // durations. Nothing may lag or rush.
    expect(HEAD_SPEED).toBeGreaterThan(0);
    const border = borderHeadPaths(W, H);
    const crown = crownHeadPaths(crownRectFromHeadline(HEADLINE, HERO));
    // Distance covered in a fixed time is identical on every path.
    for (const path of [border.left, border.right, crown.left, crown.right]) {
      const at100 = HEAD_SPEED * 100;
      const at200 = HEAD_SPEED * 200;
      expect(polylineLength(sliceUpTo(path, at200))).toBeCloseTo(at200, 6);
      expect(polylineLength(sliceUpTo(path, at100))).toBeCloseTo(at100, 6);
    }
  });

  it("is distance-based, so a small viewport does not finish the same as a large one", () => {
    const small = polylineLength(borderHeadPaths(375, 667).left);
    const large = polylineLength(borderHeadPaths(1920, 1080).left);
    expect(large).toBeGreaterThan(small);
    // Same speed → proportionally longer entrance, which is the point.
    expect(large / HEAD_SPEED).toBeGreaterThan(small / HEAD_SPEED);
  });

  it("keeps the settled racers slower than the entrance sprint", () => {
    expect(RACER_SPEED).toBeGreaterThan(0);
    expect(RACER_SPEED).toBeLessThan(HEAD_SPEED / 2);
  });
});

describe("border paths — mirror images, so the pair arrives together", () => {
  it("both heads start at top centre and end at bottom centre", () => {
    const { left, right } = borderHeadPaths(W, H);
    const r = borderRect(W, H);
    const cx = (r.left + r.right) / 2;
    expect(left[0]).toEqual({ x: cx, y: r.top });
    expect(right[0]).toEqual({ x: cx, y: r.top });
    expect(left[left.length - 1]).toEqual({ x: cx, y: r.bottom });
    expect(right[right.length - 1]).toEqual({ x: cx, y: r.bottom });
  });

  it("are exactly the same length at every viewport", () => {
    for (const [w, h] of [[375, 667], [768, 900], [1280, 800], [1920, 1080]]) {
      const { left, right } = borderHeadPaths(w, h);
      expect(polylineLength(left)).toBeCloseTo(polylineLength(right), 9);
    }
  });

  it("goes left then down, and right then down — never through the middle", () => {
    const { left, right } = borderHeadPaths(W, H);
    const r = borderRect(W, H);
    expect(left[1].x).toBe(r.left);
    expect(right[1].x).toBe(r.right);
    for (const p of [...left, ...right]) {
      expect(p.x).toBeGreaterThanOrEqual(r.left);
      expect(p.x).toBeLessThanOrEqual(r.right);
      expect(p.y).toBeGreaterThanOrEqual(r.top);
      expect(p.y).toBeLessThanOrEqual(r.bottom);
    }
  });

  it("insets from the hero bounds and survives a degenerate hero", () => {
    expect(borderRect(W, H).left).toBe(EDGE_INSET);
    expect(borderRect(W, H).right).toBe(W - EDGE_INSET);
    // A hero narrower than two insets must not invert the frame.
    const tiny = borderRect(10, 8);
    expect(tiny.right).toBeGreaterThanOrEqual(tiny.left);
    expect(tiny.bottom).toBeGreaterThanOrEqual(tiny.top);
  });

  it("closes the racer loop back on itself", () => {
    const loop = borderLoop(W, H);
    expect(loop[0]).toEqual(loop[loop.length - 1]);
    // Perimeter, not the half-path length.
    expect(polylineLength(loop)).toBeCloseTo(2 * (W - 2 * EDGE_INSET) + 2 * (H - 2 * EDGE_INSET), 6);
  });
});

describe("crown rect — derived from the measured headline, never hardcoded", () => {
  it("pads the headline block and converts to hero-local coordinates", () => {
    const hero: Rect = { left: 100, top: 50, right: 1380, bottom: 850 };
    const head: Rect = { left: 140, top: 350, right: 1000, bottom: 510 };
    const crown = crownRectFromHeadline(head, hero);
    expect(crown).toEqual({
      left: 140 - 100 - CROWN_PAD,
      top: 350 - 50 - CROWN_PAD,
      right: 1000 - 100 + CROWN_PAD,
      bottom: 510 - 50 + CROWN_PAD,
    });
  });

  it("encloses the whole block when the headline wraps to two lines on mobile", () => {
    // 375px: the headline wraps, so the measured rect is short and TALL. The
    // crown must enclose the full wrapped block, not just the first line.
    const hero: Rect = { left: 0, top: 0, right: 375, bottom: 667 };
    const oneLine: Rect = { left: 20, top: 200, right: 355, bottom: 250 };
    const twoLines: Rect = { left: 20, top: 200, right: 355, bottom: 330 };
    const a = crownRectFromHeadline(oneLine, hero);
    const b = crownRectFromHeadline(twoLines, hero);
    expect(b.bottom - b.top).toBeGreaterThan(a.bottom - a.top);
    expect(b.bottom).toBe(330 + CROWN_PAD);
    expect(b.top).toBe(200 - CROWN_PAD);
  });

  it("tracks the headline when a late font swap or banner reflow moves it", () => {
    const hero: Rect = { left: 0, top: 0, right: 1280, bottom: 800 };
    const before = crownRectFromHeadline({ left: 40, top: 300, right: 900, bottom: 460 }, hero);
    // Banner grows 26px → hero content shifts down; serif loads → block widens.
    const after = crownRectFromHeadline({ left: 40, top: 326, right: 940, bottom: 492 }, hero);
    expect(after.top - before.top).toBe(26);
    expect(after.right).toBeGreaterThan(before.right);
  });

  it("rejects a rect that is not laid out yet, rather than drawing a sliver", () => {
    expect(isUsableRect(null)).toBe(false);
    expect(isUsableRect({ left: 0, top: 0, right: 0, bottom: 0 })).toBe(false);
    expect(isUsableRect({ left: 10, top: 10, right: 10.5, bottom: 400 })).toBe(false);
    expect(isUsableRect({ left: NaN, top: 0, right: 100, bottom: 100 })).toBe(false);
    expect(isUsableRect({ left: 0, top: 0, right: 100, bottom: 40 })).toBe(true);
  });

  it("gives the crown pair mirror paths from its top centre, like the border", () => {
    const crown = crownRectFromHeadline(HEADLINE, HERO);
    const { left, right } = crownHeadPaths(crown);
    const cx = (crown.left + crown.right) / 2;
    expect(left[0]).toEqual({ x: cx, y: crown.top });
    expect(right[0]).toEqual({ x: cx, y: crown.top });
    expect(polylineLength(left)).toBeCloseTo(polylineLength(right), 9);
    expect(left[left.length - 1]).toEqual({ x: cx, y: crown.bottom });
  });

  it("closes the crown racer loop", () => {
    const crown = crownRectFromHeadline(HEADLINE, HERO);
    const loop = crownLoop(crown);
    expect(loop[0]).toEqual(loop[loop.length - 1]);
    expect(polylineLength(loop)).toBeCloseTo(
      2 * (crown.right - crown.left) + 2 * (crown.bottom - crown.top),
      6
    );
  });
});

describe("the branch — born exactly when the border heads pass the headline", () => {
  it("fires at the depth where the head's y reaches the crown's top", () => {
    const { left } = borderHeadPaths(W, H);
    const crown = crownRectFromHeadline(HEADLINE, HERO);
    const d = distanceAtDepth(left, crown.top);
    // Top run, then straight down the side to that y.
    const topRun = W / 2 - EDGE_INSET;
    expect(d).toBeCloseTo(topRun + (crown.top - EDGE_INSET), 6);
    // And the head really is at that depth after travelling d.
    expect(pointAt(left, d).y).toBeCloseTo(crown.top, 6);
  });

  it("is symmetric — both border heads reach the headline at the same instant", () => {
    const { left, right } = borderHeadPaths(W, H);
    const crown = crownRectFromHeadline(HEADLINE, HERO);
    expect(distanceAtDepth(left, crown.top)).toBeCloseTo(distanceAtDepth(right, crown.top), 9);
  });

  it("moves with the headline instead of running on a fixed delay", () => {
    const { left } = borderHeadPaths(W, H);
    const high = crownRectFromHeadline({ ...HEADLINE, top: 200, bottom: 360 }, HERO);
    const low = crownRectFromHeadline({ ...HEADLINE, top: 500, bottom: 660 }, HERO);
    expect(branchBirthMs(left, low.top)).toBeGreaterThan(branchBirthMs(left, high.top));
  });

  it("fires immediately if the headline sits at or above the frame's top edge", () => {
    const { left } = borderHeadPaths(W, H);
    expect(distanceAtDepth(left, EDGE_INSET)).toBe(0);
    expect(distanceAtDepth(left, -50)).toBe(0);
  });

  it("never returns more than the path length for an unreachable depth", () => {
    const { left } = borderHeadPaths(W, H);
    const len = polylineLength(left);
    expect(distanceAtDepth(left, H * 5)).toBeLessThanOrEqual(len + 1e-9);
  });

  it("converts to a birth time with the one shared speed", () => {
    const { left } = borderHeadPaths(W, H);
    const crown = crownRectFromHeadline(HEADLINE, HERO);
    expect(branchBirthMs(left, crown.top)).toBeCloseTo(
      distanceAtDepth(left, crown.top) / HEAD_SPEED,
      6
    );
  });
});

describe("entrance timing", () => {
  const { left } = borderHeadPaths(W, H);
  const borderLen = polylineLength(left);
  const crown = crownRectFromHeadline(HEADLINE, HERO);
  const crownLen = polylineLength(crownHeadPaths(crown).left);
  const branch = branchBirthMs(left, crown.top);

  it("runs until the LATER of the two pairs lands", () => {
    const total = entranceDurationMs(borderLen, branch, crownLen);
    expect(total).toBeGreaterThanOrEqual(borderLen / HEAD_SPEED);
    expect(total).toBeGreaterThanOrEqual(branch + crownLen / HEAD_SPEED);
  });

  it("completes the whole entrance in the 1.1-1.3s target window on desktop", () => {
    // Decisive and quick, not the 3.3s the original 0.62 speed actually took at
    // this size. Distance-based timing makes the long desktop path the binding
    // case, so this is the one worth pinning.
    const total = entranceDurationMs(borderLen, branch, crownLen);
    expect(total).toBeGreaterThan(1000);
    expect(total).toBeLessThan(1400);
  });

  it("finishes shorter mobile paths sooner while still reading as a drawn line", () => {
    const mobileHeads = borderHeadPaths(375, 812);
    const mLen = polylineLength(mobileHeads.left);
    const mCrown = crownRectFromHeadline(
      { left: 20, top: 222, right: 355, bottom: 499 },
      { left: 0, top: 0, right: 375, bottom: 812 }
    );
    const mCrownLen = polylineLength(crownHeadPaths(mCrown).left);
    const mBranch = branchBirthMs(mobileHeads.left, mCrown.top);
    const total = entranceDurationMs(mLen, mBranch, mCrownLen);
    // Quicker than desktop because the path is shorter — the point of keeping
    // this distance-based — but never an instant flash.
    expect(total).toBeLessThan(entranceDurationMs(borderLen, branch, crownLen));
    expect(total).toBeGreaterThan(300);
    // The head still takes a perceptible beat to travel down to the crown.
    expect(mBranch).toBeGreaterThan(120);
  });

  it("reveals the hero content almost immediately, never gating on the lines", () => {
    expect(CONTENT_REVEAL_FRACTION).toBe(0.4);
    // Content first: on every real viewport the ceiling governs, so the fade
    // begins by ~200ms no matter how long the path is.
    expect(CONTENT_REVEAL_MAX_MS).toBeLessThanOrEqual(250);
    expect(contentRevealMs(borderLen)).toBeLessThanOrEqual(CONTENT_REVEAL_MAX_MS);
    expect(contentRevealMs(borderLen)).toBeGreaterThan(0);
    // Reveal plus the fade itself completes inside ~0.6s.
    expect(CONTENT_REVEAL_MAX_MS + CONTENT_FADE_MS).toBeLessThanOrEqual(650);
    // And still well before the entrance ends, so the lines draw around content
    // that is already on screen.
    expect(contentRevealMs(borderLen)).toBeLessThan(entranceDurationMs(borderLen, branch, crownLen));
  });

  it("takes the distance milestone when it lands earlier than the ceiling", () => {
    // A very short path reveals on distance rather than waiting for the ceiling.
    expect(contentRevealMs(100)).toBeCloseTo((100 * CONTENT_REVEAL_FRACTION) / HEAD_SPEED, 6);
    expect(contentRevealMs(100)).toBeLessThan(CONTENT_REVEAL_MAX_MS);
  });

  it("cannot divide by zero if a speed of 0 is ever passed", () => {
    expect(entranceDurationMs(borderLen, branch, crownLen, 0)).toBe(0);
    expect(contentRevealMs(borderLen, 0)).toBe(0);
    expect(branchBirthMs(left, crown.top, 0)).toBe(0);
  });
});

describe("progressive reveal", () => {
  const path = borderHeadPaths(W, H).left;

  it("draws a trail that ends exactly at the head", () => {
    for (const d of [0, 1, 250, 1200, polylineLength(path) * 0.77]) {
      const trail = sliceUpTo(path, d);
      const head = pointAt(path, d);
      const end = trail[trail.length - 1];
      expect(end.x).toBeCloseTo(head.x, 6);
      expect(end.y).toBeCloseTo(head.y, 6);
    }
  });

  it("grows monotonically and stops at the full path", () => {
    let prev = -1;
    for (let d = 0; d <= polylineLength(path) * 1.2; d += 37) {
      const len = polylineLength(sliceUpTo(path, d));
      expect(len).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(len).toBeLessThanOrEqual(polylineLength(path) + 1e-9);
      prev = len;
    }
  });

  it("clamps rather than extrapolating past either end", () => {
    expect(pointAt(path, -100)).toEqual(path[0]);
    expect(pointAt(path, 1e9)).toEqual(path[path.length - 1]);
    expect(pointAt([], 5)).toEqual({ x: 0, y: 0 });
    expect(sliceUpTo([], 5)).toEqual([]);
  });
});

describe("settled racers", () => {
  const loop = borderLoop(W, H);
  const len = polylineLength(loop);

  it("never stops — position wraps forever", () => {
    expect(racerDistance(0, len)).toBeCloseTo(0, 6);
    const oneLap = len / RACER_SPEED;
    expect(racerDistance(oneLap, len)).toBeCloseTo(0, 4);
    expect(racerDistance(oneLap * 37.5, len)).toBeCloseTo(len / 2, 3);
    for (const t of [1, 1e4, 1e7, 1e9]) {
      const d = racerDistance(t, len);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(len);
    }
  });

  it("offsets the second racer half a lap away", () => {
    const a = racerDistance(1234, len, 0);
    const b = racerDistance(1234, len, 0.5);
    expect(Math.abs(b - a)).toBeCloseTo(len / 2, 6);
  });

  it("keeps its tail across the loop seam", () => {
    // A racer just past the start point must still trail back over the join,
    // not lose its tail for a frame.
    const tail = tailPoints(loop, 5);
    expect(tail).toHaveLength(14);
    for (const p of tail) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    // The far end of the tail has wrapped back around to near the end of the loop.
    const far = tail[tail.length - 1];
    const nearEnd = pointAtLooped(loop, len - 85);
    expect(far.x).toBeCloseTo(nearEnd.x, 6);
    expect(far.y).toBeCloseTo(nearEnd.y, 6);
  });

  it("survives a degenerate loop without NaN", () => {
    expect(racerDistance(500, 0)).toBe(0);
    expect(pointAtLooped([], 10)).toEqual({ x: 0, y: 0 });
  });

  it("gives the name a passing light every lap", () => {
    const crown = crownLoop(crownRectFromHeadline(HEADLINE, HERO));
    const clen = polylineLength(crown);
    const lap = clen / RACER_SPEED;
    // A full lap returns to the start — the orbit is endless, not a one-shot.
    expect(racerDistance(lap, clen, 0)).toBeCloseTo(0, 3);
    expect(lap).toBeLessThan(60_000); // and a lap is on a human timescale
  });
});

describe("alphas — drawing reads brighter than settled, crown above border", () => {
  it("draws hot and settles faint", () => {
    expect(BORDER_ALPHA_DRAW).toBeGreaterThan(BORDER_ALPHA_SETTLED);
    expect(CROWN_ALPHA_DRAW).toBeGreaterThan(CROWN_ALPHA_SETTLED);
  });

  it("keeps the crown brighter than the border in both states", () => {
    expect(CROWN_ALPHA_DRAW).toBeGreaterThan(BORDER_ALPHA_DRAW);
    expect(CROWN_ALPHA_SETTLED).toBeGreaterThan(BORDER_ALPHA_SETTLED);
  });

  it("stays faint enough to sit behind the headline", () => {
    expect(BORDER_ALPHA_SETTLED).toBeLessThan(0.2);
    expect(CROWN_ALPHA_SETTLED).toBeLessThan(0.4);
  });
});

describe("session gate — the entrance plays once", () => {
  const fakeStore = () => {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      size: () => map.size,
    };
  };

  it("plays for a first-time visitor and not for a returning one", () => {
    const store = fakeStore();
    expect(shouldPlayEntrance(store, false)).toBe(true);
    markEntranceSeen(store);
    expect(hasSeenEntrance(store)).toBe(true);
    expect(shouldPlayEntrance(store, false)).toBe(false);
  });

  it("never plays under reduced motion, flag or no flag", () => {
    const store = fakeStore();
    expect(shouldPlayEntrance(store, true)).toBe(false);
    markEntranceSeen(store);
    expect(shouldPlayEntrance(store, true)).toBe(false);
  });

  it("uses a session-scoped key, so a new session animates again", () => {
    expect(SESSION_KEY).toBe("ldr_crown_seen");
  });

  it("survives storage being unavailable rather than throwing", () => {
    // Safari private mode throws on access; the hero must still render.
    const hostile = {
      getItem() {
        throw new Error("SecurityError");
      },
      setItem() {
        throw new Error("SecurityError");
      },
    };
    expect(() => hasSeenEntrance(hostile)).not.toThrow();
    expect(() => markEntranceSeen(hostile)).not.toThrow();
    expect(hasSeenEntrance(hostile)).toBe(false);
    expect(shouldPlayEntrance(hostile, false)).toBe(true);
    expect(hasSeenEntrance(null)).toBe(false);
    expect(() => markEntranceSeen(null)).not.toThrow();
  });
});

/* ===================== component + page wiring =========================== */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const CROWN = strip(read("client/src/components/CrownBranch.tsx"));
const HOME = strip(read("client/src/pages/Home.tsx"));

describe("the nanite swarm is unmounted, not deleted", () => {
  it("no longer renders on the homepage", () => {
    expect(HOME).not.toContain("NaniteSwarm");
  });

  it("keeps the component and its shared module in the codebase", () => {
    // shared/livingLogo.ts is imported by the /links orb, and shared/naniteSwarm
    // is still covered by its own suite. Removing the files would take those
    // with them.
    expect(() => read("client/src/components/NaniteSwarm.tsx")).not.toThrow();
    expect(() => read("shared/naniteSwarm.ts")).not.toThrow();
  });

  it("leaves the /links orb completely untouched", () => {
    const links = strip(read("client/src/pages/Links.tsx"));
    expect(links).toContain("LivingLogo");
    expect(links).not.toContain("CrownBranch");
  });
});

describe("hero wiring", () => {
  it("measures the crown from the real headline element", () => {
    expect(HOME).toContain("headlineRef");
    expect(HOME).toMatch(/<h1\s+ref=\{headlineRef\}/);
    expect(CROWN).toContain("headlineRef.current?.getBoundingClientRect()");
    expect(CROWN).toContain("crownRectFromHeadline");
  });

  it("re-measures on resize, orientation change, font load and on a cadence", () => {
    expect(CROWN).toMatch(/addEventListener\("resize", onResize\)/);
    expect(CROWN).toMatch(/addEventListener\("orientationchange", onResize\)/);
    expect(CROWN).toContain("document.fonts?.ready");
    expect(CROWN).toMatch(/now - measuredAt > REMEASURE_MS/);
  });

  it("hardcodes no crown coordinates", () => {
    // The only geometry constants allowed in the component are the edge inset,
    // line width, head radii and the DPR cap — all viewport-independent.
    expect(CROWN).not.toMatch(/crown\s*=\s*\{\s*left:\s*\d/);
  });

  it("fades the hero content in fast, so the page is never gated on the lines", () => {
    expect(HOME).toContain("onReveal");
    // The markup duration must match CONTENT_FADE_MS, and reveal + fade has to
    // land inside ~0.6s.
    expect(HOME).toContain(`duration-[${CONTENT_FADE_MS}ms]`);
    expect(CONTENT_REVEAL_MAX_MS + CONTENT_FADE_MS).toBeLessThanOrEqual(650);
    expect(HOME).toMatch(/heroRevealed \? "opacity-100" : "opacity-0"/);
  });

  it("can never leave the hero content invisible", () => {
    // Default is visible; it only starts hidden when an entrance is definitely
    // going to play, and a backstop timer un-hides it regardless.
    expect(HOME).toMatch(/useState\(\(\) => !willPlayCrownEntrance\(\)\)/);
    const backstop = HOME.match(/setTimeout\(\(\) => setHeroRevealed\(true\), (\d+)\)/);
    expect(backstop).not.toBeNull();
    const ms = Number(backstop![1]);
    // Comfortably past the intended reveal, but no longer the old 2.5s wait —
    // if rAF never runs, the visitor still sees the hero quickly.
    expect(ms).toBeGreaterThan(CONTENT_REVEAL_MAX_MS * 2);
    expect(ms).toBeLessThanOrEqual(1500);
    // Every exit from the loop reveals, including the degrade path.
    expect(CROWN.match(/revealRef\.current\?\.\(\)/g)?.length).toBeGreaterThanOrEqual(4);
  });
});

describe("crown branch — decorative, cheap, and never blank", () => {
  it("contributes no layout and cannot eat a CTA tap", () => {
    expect(CROWN).toContain("pointer-events-none absolute inset-0");
    expect(CROWN).toContain("aria-hidden");
  });

  it("caps DPR at 2 like the other canvases", () => {
    expect(CROWN).toContain("const MAX_DPR = 2");
    expect(CROWN).toMatch(/Math\.min\(window\.devicePixelRatio \|\| 1, MAX_DPR\)/);
  });

  it("reuses the shared stall guard rather than reimplementing it", () => {
    expect(CROWN).toContain("isTrustworthyFrame");
    expect(CROWN).toContain("isWarmedUp");
    expect(CROWN).toContain("shouldDegrade");
    expect(CROWN).toMatch(/frameTimes\.length = 0/);
  });

  it("falls back to static lines, never to a blank layer", () => {
    // Sustained slowness: stop moving, leave the settled geometry drawn.
    expect(CROWN).toMatch(/staticOnly = true;[\s\S]{0,120}drawSettledLines\(\)/);
    // No 2D context at all: CSS lines instead of an empty canvas.
    expect(CROWN).toContain("cssFallback");
    expect(CROWN).toMatch(/if \(!ctx\)/);
  });

  it("renders the settled state instantly under reduced motion — no loop", () => {
    expect(CROWN).toMatch(/if \(reducedMotion\) \{[\s\S]{0,400}drawStatic\(\)/);
    expect(CROWN).toMatch(/prefers-reduced-motion: reduce/);
    // Racers are gated on it too, in case the static branch is ever removed.
    expect(CROWN).toMatch(/drawSettled\(elapsed - settledFrom, !reducedMotion && !staticOnly\)/);
  });

  it("stops the loop when hidden or scrolled away, and cleans up", () => {
    expect(CROWN).toContain("visibilitychange");
    expect(CROWN).toContain("IntersectionObserver");
    expect(CROWN).toContain("io.disconnect()");
    expect(CROWN).toContain("cancelAnimationFrame");
  });

  it("does not add a ResizeObserver — that surface stays at one file", () => {
    // Locked by bannerResizeObserver.test.ts; this is the reason the component
    // uses resize events plus a cheap re-measure cadence instead.
    expect(CROWN).not.toContain("new ResizeObserver");
  });

  it("marks the session flag once the entrance has actually played", () => {
    expect(CROWN).toContain("markEntranceSeen(store)");
    expect(CROWN).toContain("shouldPlayEntrance");
  });
});
