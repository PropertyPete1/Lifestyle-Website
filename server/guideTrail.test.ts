import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GUIDE_DRAW_MS,
  GUIDE_FADE_MS,
  GUIDE_MIN_SPAN_PX,
  GUIDE_TAIL_PX,
  GUIDE_TOTAL_MS,
  easeInOutCubic,
  guideLineX,
  guideOpacity,
  guideProgress,
  guideSegment,
} from "../shared/guideTrail";

/**
 * The /links promise chip and the gold trail it draws to the capture form.
 *
 * Two failure modes are worth locking down. The visual one: the chip used to
 * be a bordered gold rectangle with a ↓ arrow sitting directly above a bordered
 * gold button, so the two read as one control — the whole point of the restyle
 * is that the chip no longer shares the button vocabulary. The functional one:
 * the trail is an overlay across the whole viewport, so it must be drawn in the
 * gutter beside the buttons, must never swallow a tap, and must always clean
 * itself up.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
/** Strip comments so explanatory prose can neither satisfy nor trip a check. */
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const LINKS = strip(read("client/src/pages/Links.tsx"));
const TRAIL = strip(read("client/src/components/GuideTrail.tsx"));
const CSS = read("client/src/index.css");

describe("guide trail timing", () => {
  it("is a guide moment, not a page element — gone inside ~1.5s", () => {
    expect(GUIDE_TOTAL_MS).toBe(GUIDE_DRAW_MS + GUIDE_FADE_MS);
    expect(GUIDE_TOTAL_MS).toBeLessThanOrEqual(1500);
    expect(GUIDE_TOTAL_MS).toBeGreaterThan(500); // still long enough to read
  });

  it("draws at full strength, then fades to nothing", () => {
    expect(guideOpacity(-10)).toBe(0);
    expect(guideOpacity(0)).toBe(1);
    expect(guideOpacity(GUIDE_DRAW_MS)).toBe(1);
    expect(guideOpacity(GUIDE_DRAW_MS + GUIDE_FADE_MS / 2)).toBeCloseTo(0.5, 5);
    expect(guideOpacity(GUIDE_TOTAL_MS)).toBe(0);
    expect(guideOpacity(GUIDE_TOTAL_MS + 5000)).toBe(0);
  });

  it("never brightens again once the fade has started", () => {
    let last = 1;
    for (let t = GUIDE_DRAW_MS; t <= GUIDE_TOTAL_MS; t += 10) {
      const o = guideOpacity(t);
      expect(o).toBeLessThanOrEqual(last + 1e-9);
      last = o;
    }
  });

  it("clamps progress to 0..1 regardless of frame timing", () => {
    expect(guideProgress(-50)).toBe(0);
    expect(guideProgress(0)).toBe(0);
    expect(guideProgress(GUIDE_DRAW_MS / 2)).toBeCloseTo(0.5, 5);
    expect(guideProgress(GUIDE_DRAW_MS)).toBe(1);
    expect(guideProgress(999999)).toBe(1); // a stalled tab resuming mid-run
  });
});

describe("easeInOutCubic", () => {
  it("starts at 0, ends at 1, and stays inside the range", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(-2)).toBe(0);
    expect(easeInOutCubic(4)).toBe(1);
    for (let t = 0; t <= 1; t += 0.01) {
      const v = easeInOutCubic(t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("only ever moves forward (a backtracking head reads as a glitch)", () => {
    let last = -1;
    for (let t = 0; t <= 1; t += 0.01) {
      const v = easeInOutCubic(t);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });
});

describe("guideLineX — the line runs beside the buttons, never across them", () => {
  it("never crosses into the content column at any viewport", () => {
    const cases: Array<[number, number]> = [
      [20, 375], // mobile: page px-5 gutter
      [20, 414],
      [20, 640],
      [288, 1024], // desktop: max-w-md column centred
      [496, 1440],
      [0, 320], // pathological: no gutter at all
      [2, 320],
    ];
    for (const [contentLeft, vw] of cases) {
      const x = guideLineX(contentLeft, vw);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(contentLeft);
    }
  });

  it("centres itself in the tight mobile gutter", () => {
    // 375px: content starts at 20px, so the line sits at 10px — clear of the
    // buttons with room for its own 2px stroke.
    expect(guideLineX(20, 375)).toBe(10);
  });

  it("hugs the column rather than the screen edge when the gutter is wide", () => {
    expect(guideLineX(288, 1024)).toBe(276);
  });

  it("degrades safely if the column somehow reports off-screen", () => {
    expect(guideLineX(-40, 375)).toBe(0);
    expect(guideLineX(9999, 375)).toBeLessThanOrEqual(375);
  });
});

describe("guideSegment — the head lands on the form", () => {
  const VH = 667; // 375x667, the smallest common phone

  it("runs to the bottom edge while the form is still off-screen", () => {
    const seg = guideSegment(400, 1400, VH, 1);
    expect(seg.visible).toBe(true);
    expect(seg.top).toBe(400);
    expect(seg.head).toBe(VH); // clipped, not drawn past the viewport
  });

  it("ends exactly on the form's top edge once the scroll has settled", () => {
    // Chip has scrolled off the top; form is centred in view.
    const seg = guideSegment(-120, 300, VH, 1);
    expect(seg.top).toBe(0);
    expect(seg.head).toBe(300);
  });

  it("starts at the chip and travels down as progress grows", () => {
    const at = (eased: number) => guideSegment(400, 620, VH, eased).head;
    expect(at(0)).toBe(400);
    expect(at(0.5)).toBe(510);
    expect(at(1)).toBe(620);
    expect(at(-1)).toBe(400); // clamped
    expect(at(2)).toBe(620);
  });

  it("keeps the bright tail behind the head and never above the start", () => {
    const early = guideSegment(400, 620, VH, 0.02);
    expect(early.tailTop).toBeGreaterThanOrEqual(early.top);
    const late = guideSegment(400, 620, VH, 1);
    expect(late.head - late.tailTop).toBeLessThanOrEqual(GUIDE_TAIL_PX + 1e-9);
    expect(late.tailTop).toBeLessThan(late.head);
  });

  it("draws nothing when the form is not meaningfully below the chip", () => {
    expect(guideSegment(400, 300, VH, 1).visible).toBe(false); // form above
    expect(guideSegment(400, 400 + GUIDE_MIN_SPAN_PX - 1, VH, 1).visible).toBe(false);
    expect(guideSegment(400, 400 + GUIDE_MIN_SPAN_PX, VH, 1).visible).toBe(true);
  });
});

describe("promise chip — stops sharing the buttons' visual vocabulary", () => {
  it("is a pill with a soft gold fill and no border", () => {
    const chip = LINKS.slice(LINKS.indexOf("onClick={jumpToCapture}"));
    const cls = chip.slice(chip.indexOf("className="), chip.indexOf(">"));
    expect(cls).toContain("rounded-full");
    expect(cls).toMatch(/bg-gold\//);
    // The buttons below are `border border-gold/70` rectangles; the chip must
    // not be one of those.
    expect(cls).not.toMatch(/\bborder\b/);
  });

  it("drops the ↓ arrow that pointed at the button underneath", () => {
    expect(LINKS).not.toContain("ArrowDown");
  });

  it("ends the copy with an underlined gold 'Tap here'", () => {
    expect(LINKS).toContain("Tap here");
    const tap = LINKS.slice(LINKS.indexOf("Tap here") - 400, LINKS.indexOf("Tap here"));
    expect(tap).toContain("underline");
    expect(tap).toContain("text-gold");
  });

  it("keeps the promise itself, word for word", () => {
    expect(LINKS).toContain("Skip the browsing — tell us what you need and we'll reach out");
    expect(LINKS).toContain("within 30 minutes");
  });

  it("keeps the links_promise_click tracking on the tap", () => {
    expect(LINKS).toContain("useLinksPromiseTracking");
    expect(LINKS).toMatch(/jumpToCapture\s*=\s*\(\)\s*=>\s*\{\s*logPromiseClick\(\)/);
  });

  it("puts real air between the chip and the first button", () => {
    // mt-6 grouped the chip with the stack; mt-9 separates them.
    expect(LINKS).toContain('className="w-full mt-9 space-y-3"');
  });

  it("stays above the fold — no new markup between the header and the chip", () => {
    // The chip must remain the last thing in the profile header block.
    expect(LINKS.indexOf("VeteranBadge")).toBeLessThan(LINKS.indexOf("jumpToCapture"));
    expect(LINKS.indexOf("jumpToCapture")).toBeLessThan(LINKS.indexOf("isLinkVisible(l.url)"));
  });
});

describe("guide trail overlay — decorative, never in the way", () => {
  it("cannot intercept a button tap", () => {
    expect(TRAIL).toContain("pointer-events-none");
    expect(TRAIL).toContain('aria-hidden="true"');
  });

  it("is fixed and out of flow, so it contributes no layout shift", () => {
    expect(TRAIL).toMatch(/fixed inset-0/);
    expect(TRAIL).not.toContain("position: relative");
  });

  it("sits under the banner and any modal", () => {
    // Banner is z-[60], dialogs are z-50.
    expect(TRAIL).toContain("z-40");
  });

  it("positions itself from the shared geometry, not ad-hoc numbers", () => {
    expect(TRAIL).toContain("guideLineX");
    expect(TRAIL).toContain("guideSegment");
  });

  it("always tears down its frame loop and its backstop timer", () => {
    expect(TRAIL).toContain("cancelAnimationFrame");
    expect(TRAIL).toContain("clearTimeout");
    // A hidden tab throttles rAF to a standstill; without the wall-clock
    // backstop the overlay could stay lit indefinitely.
    expect(TRAIL).toMatch(/setTimeout\(stop/);
  });

  it("re-measures every frame so the line tracks the smooth scroll", () => {
    expect(TRAIL).toContain("getBoundingClientRect");
    expect(TRAIL).toContain("requestAnimationFrame(frame)");
  });
});

describe("reduced motion", () => {
  it("never plays the trail", () => {
    expect(LINKS).toContain("prefers-reduced-motion: reduce");
    expect(LINKS).toMatch(/if\s*\(!reduced\)\s*setTrailRun/);
  });

  it("scrolls instantly and highlights the form immediately", () => {
    expect(LINKS).toContain('behavior: reduced ? "auto" : "smooth"');
    expect(LINKS).toMatch(/const delay = reduced \? 0 : GUIDE_DRAW_MS/);
  });

  it("gets a static form highlight instead of the pulse", () => {
    const reduced = CSS.slice(CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain(".form-flash");
    expect(reduced).not.toContain("animation:");
  });

  it("times the pulse to the trail's arrival for everyone else", () => {
    expect(LINKS).toContain("GUIDE_DRAW_MS");
    expect(LINKS).toMatch(/setTimeout\(\(\) => setFlash\(true\), delay\)/);
  });
});
