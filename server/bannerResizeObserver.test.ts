import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for "ResizeObserver loop completed with undelivered
 * notifications." on the homepage (38 uncaught errors in one session).
 *
 * NowHiringBanner measures itself into --hiring-banner-h, and SiteNav / the
 * homepage hero / the /links header all lay out against that var. Writing the
 * var straight from the observer callback re-triggered the observer inside the
 * same delivery cycle, which is exactly the condition browsers report.
 *
 * These assertions pin the three guards that broke the cycle. They are written
 * against the source text (not a DOM render) because jsdom does not implement
 * ResizeObserver delivery cycles, so a render test could not distinguish a
 * looping implementation from a fixed one.
 */

const SRC = readFileSync(
  join(process.cwd(), "client/src/components/NowHiringBanner.tsx"),
  "utf8",
);

/** Strip comments so explanatory prose can neither satisfy nor trip a check. */
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("NowHiringBanner resize measurement", () => {
  it("does not read offsetHeight inside the observer callback", () => {
    // offsetHeight forces a synchronous layout during resize delivery, which is
    // what re-armed the loop. The entry's reported box size is used instead.
    expect(code).not.toContain("offsetHeight");
  });

  it("reads the size from the ResizeObserverEntry", () => {
    expect(code).toMatch(/borderBoxSize|contentRect/);
  });

  it("defers the CSS-var write out of the resize delivery cycle", () => {
    expect(code).toContain("requestAnimationFrame");
    expect(code).toContain("cancelAnimationFrame");
  });

  it("rounds to whole pixels so subpixel jitter cannot re-arm the loop", () => {
    expect(code).toContain("Math.round");
  });

  it("skips writes when the measured height has not changed", () => {
    // A settled banner must write nothing at all; the early return is the guard.
    expect(code).toMatch(/if\s*\(\s*next\s*===\s*last\s*\)\s*return/);
  });

  it("still cleans up the observer, the pending frame, and the CSS var", () => {
    expect(code).toContain("ro.disconnect()");
    expect(code).toContain('removeProperty("--hiring-banner-h")');
  });

  it("is the only place in client code that constructs a ResizeObserver", () => {
    // If another component starts writing layout from an observer callback, this
    // whole class of bug comes back. Keep the surface area at one file.
    const root = join(process.cwd(), "client/src");
    const hits: string[] = [];

    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          // Vendored shadcn/Radix primitives manage their own observers safely.
          if (full.endsWith("components/ui")) continue;
          walk(full);
        } else if (/\.tsx?$/.test(name)) {
          const body = readFileSync(full, "utf8")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/\/\/.*$/gm, "");
          if (body.includes("new ResizeObserver")) {
            hits.push(full.slice(root.length + 1));
          }
        }
      }
    };
    walk(root);

    expect(hits).toEqual(["components/NowHiringBanner.tsx"]);
  });
});
