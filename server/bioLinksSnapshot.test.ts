import { describe, expect, it } from "vitest";
import { BIO_LINKS_SNAPSHOT } from "../shared/bioLinksSnapshot";
import { SITE, isLinkVisible } from "../shared/site";

/**
 * Guards the /links first-paint snapshot (react-query placeholderData).
 * The snapshot only removes the pop-in if it renders EXACTLY like the live
 * data will: same ordering, nothing the visibility filter would strip, and
 * the New Construction row present so the hardcoded MEET PRIMARY row slots
 * into its final position immediately. Any row that paints and then moves
 * or vanishes when the fetch lands recreates the layout shift this exists
 * to kill.
 */
describe("BIO_LINKS_SNAPSHOT", () => {
  it("is non-empty and every row is active", () => {
    expect(BIO_LINKS_SNAPSHOT.length).toBeGreaterThan(0);
    for (const row of BIO_LINKS_SNAPSHOT) expect(row.active).toBe(true);
  });

  it("is ordered like getBioLinks (sortOrder, then id)", () => {
    const sorted = [...BIO_LINKS_SNAPSHOT].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.id - b.id
    );
    expect(BIO_LINKS_SNAPSHOT).toEqual(sorted);
  });

  it("has unique ids (React keys) and non-empty labels/urls", () => {
    const ids = new Set(BIO_LINKS_SNAPSHOT.map((r) => r.id));
    expect(ids.size).toBe(BIO_LINKS_SNAPSHOT.length);
    for (const row of BIO_LINKS_SNAPSHOT) {
      expect(row.label.trim()).not.toBe("");
      expect(row.url.trim()).not.toBe("");
    }
  });

  it("contains no row the pre-IDX visibility filter would strip", () => {
    for (const row of BIO_LINKS_SNAPSHOT) {
      expect(isLinkVisible(row.url), `${row.label} (${row.url})`).toBe(true);
    }
  });

  it("anchors MEET PRIMARY: the New Construction row is present", () => {
    // If the admin ever removes/renames New Construction Search, regenerate
    // the snapshot (command in shared/bioLinksSnapshot.ts) and update this.
    expect(BIO_LINKS_SNAPSHOT.some((r) => r.url === SITE.newConstructionUrl)).toBe(true);
  });
});
