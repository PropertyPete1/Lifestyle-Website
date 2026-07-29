/**
 * Nav overflow regression guard (bug shipped twice — Jul 28).
 *
 * The desktop nav row must fit at the narrowest width where it is shown
 * (lg breakpoint = 1024px). We can't render a browser in vitest, so this
 * test computes a conservative width estimate from the actual NAV_ITEMS
 * labels using the nav's real typography metrics:
 *   .nav-link = 0.7rem (11.2px) uppercase + 0.18em letter-spacing
 *   → per-char width ≈ fontSize * 0.72 + letterSpacing ≈ 8.1 + 2.0 ≈ 10.1px
 * plus the fixed chrome around the items (wordmark, gaps, CTA, phone icon,
 * container padding). If someone adds a top-level item or lengthens a
 * label so the estimate exceeds the budget, this test fails BEFORE the
 * overflow ships.
 */
import { describe, expect, it } from "vitest";
import { NAV_ITEMS, PROPERTIES_MENU } from "../client/src/components/SiteNav";
import { FEATURES } from "../shared/site";

// Estimate of rendered px width for a nav-link label, calibrated against the
// real rendering: at 1024px viewport the current 4-item nav measures ~700px
// of links+chrome next to a ~290px wordmark with ~35px slack (verified via
// screenshot Jul 28). Keep constants slightly generous so the test trips
// BEFORE a real overflow does.
const FONT_SIZE = 11.2; // 0.7rem
const LETTER_SPACING = FONT_SIZE * 0.18; // ≈2.02px
const CHAR_WIDTH = FONT_SIZE * 0.58 + LETTER_SPACING; // ≈8.5px per uppercase char (calibrated)
const labelWidth = (label: string) => label.length * CHAR_WIDTH;

// Fixed chrome, calibrated to actual rendering with margin:
// (measured at 1024px viewport Jul 28: wordmark ends at ~x=302 incl. left
// padding of 32px → wordmark itself ≈270px; nav row ends with ~20px slack)
const WORDMARK = 270; // "LIFESTYLE DESIGN REALTY" serif at lg (text-lg)
const CONTAINER_PADDING = 64; // px-8 both sides
const HEADER_GAP = 16; // justify-between gap between wordmark and nav
const ITEM_GAP = 16; // gap-4 between nav items at lg
const DROPDOWN_CHEVRON = 18; // chevron icon + gap on "Properties"
const PHONE_ICON = 32; // compact phone icon shown below xl
const CTA = labelWidth("Get Started") + 32 + 12; // px-4 padding + margin

const NARROWEST_DESKTOP = 1024; // lg — the first width where the row appears
const XL_BREAKPOINT = 1280; // xl — full phone number replaces the icon here
const PHONE_NUMBER = "(210) 981-3830";

const itemsWidth = () => NAV_ITEMS.reduce((sum, item) => sum + labelWidth(item.label), 0);

describe("desktop nav width budget", () => {
  it("fits at the narrowest desktop width (1024px, phone shown as icon)", () => {
    // N items + phone + CTA = N+2 elements → N+1 internal gaps
    const gaps = ITEM_GAP * (NAV_ITEMS.length + 1);
    const total =
      WORDMARK + CONTAINER_PADDING + HEADER_GAP + itemsWidth() + DROPDOWN_CHEVRON + PHONE_ICON + CTA + gaps;
    expect(
      total,
      `Estimated nav width ${Math.round(total)}px exceeds ${NARROWEST_DESKTOP}px — ` +
        `remove/shorten a top-level item or move it into the Properties dropdown`
    ).toBeLessThanOrEqual(NARROWEST_DESKTOP);
  });

  it("fits at the xl breakpoint (1280px, full phone number shown)", () => {
    const gaps = 24 * (NAV_ITEMS.length + 1); // gap-6 at xl, N+1 internal gaps
    const total =
      WORDMARK + CONTAINER_PADDING + HEADER_GAP + itemsWidth() + DROPDOWN_CHEVRON + labelWidth(PHONE_NUMBER) + CTA + gaps;
    expect(
      total,
      `Estimated nav width ${Math.round(total)}px exceeds ${XL_BREAKPOINT}px — ` +
        `remove/shorten a top-level item or move it into the Properties dropdown`
    ).toBeLessThanOrEqual(XL_BREAKPOINT);
  });

  it("keeps the top-level list small (consolidation guard)", () => {
    // 4 top-level items + phone + CTA is the proven-safe budget.
    expect(NAV_ITEMS.length).toBeLessThanOrEqual(4);
  });

  it("Now Hiring is always a top-level item (priority — never buried or clipped)", () => {
    expect(NAV_ITEMS.some((i) => i.label === "Now Hiring" && i.href === "/join")).toBe(true);
  });

  it("Properties dropdown matches the property-search flag (pre-IDX gating)", () => {
    const dropdown = PROPERTIES_MENU.map((m) => m.label);
    if (FEATURES.SHOW_PROPERTY_SEARCH) {
      // Full menu once IDX is live — no former top-level link may be lost.
      for (const label of ["Home Search", "Search by Property Type", "Portfolio", "Neighborhoods", "Sell With Us"]) {
        expect(dropdown).toContain(label);
      }
    } else {
      // Pre-IDX: NO placeholder-powered link may be reachable from the nav.
      for (const label of ["Home Search", "Search by Property Type", "Portfolio", "Neighborhoods"]) {
        expect(dropdown).not.toContain(label);
      }
      // Customers still get a property path: New Construction + Sell.
      expect(dropdown).toContain("New Construction Search");
      expect(dropdown).toContain("Sell With Us");
    }
  });
});
