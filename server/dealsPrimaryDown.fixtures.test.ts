import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { chesmarAboutText, primaryDownFrom, storiesFromText } from "./dealsAdapters";
import { parseTollCommunity } from "./dealsAdapters.toll";
import { parseKbCommunity } from "./dealsAdapters.kbhome";
import { parseAshtonCommunity } from "./dealsAdapters.ashton";
import { parseDreesPlans } from "./dealsAdapters.drees";
import { lennarCache, lennarPlanLayout, lennarRows, parseLennarNextData } from "./dealsAdapters.lennar";
import { weekleyPrimaryDown } from "./dealsAdapters.weekley";

/**
 * Oct 31, 2026 (Peter: the "master bed downstairs" filter New Home Buddy has). Where each builder says a plan's primary
 * bedroom is, read from the pages the official sites served (fixtures/deals/live-*), and only from text about that plan.
 */
const NOW = new Date("2026-10-21T04:00:00Z");
const page = (dir: string, file: string) => gunzipSync(readFileSync(new URL(`./fixtures/deals/${dir}/${file}.gz`, import.meta.url))).toString("utf8");
const layout = (rows: ReadonlyArray<{ privatePlanName?: string | null; privateName: string | null; stories?: number | null; primaryDown?: boolean | null }> | undefined) => (rows ?? []).map((row) => [row.privatePlanName ?? row.privateName, row.stories ?? null, row.primaryDown ?? null]);

describe("the builders' own word on the primary bedroom's floor", () => {
  it("Toll Brothers: each plan's and home's masterBedroomLocation (\"1st Floor\"), two-story plans included", () => {
    const bluff = parseTollCommunity(page("live-2026-10-20b", "toll-enchanted-bluff.html"), "https://www.tollbrothers.com/luxury-homes-for-sale/Texas/Toll-Brothers-at-Enchanted-Bluff", NOW);
    expect(layout(bluff?.plans)).toEqual([["Talia", 1, true], ["Udella", 1, true], ["Viren", 1, true], ["Winry", 1, true], ["Yovanni", 2, true]]);
    const mayfair = parseTollCommunity(page("live-2026-10-20b", "toll-mayfair.html"), "https://www.tollbrothers.com/luxury-homes-for-sale/Texas/Toll-Brothers-at-Mayfair", NOW);
    expect(layout(mayfair?.homes)).toEqual([["Aubriella", 2, true], ["Maren", 1, true], ["Ophelia", 2, true]]);
  });

  it("KB Home: the home's own description (\"Upstairs, the primary suite\"); a plan with no description stays unknown", () => {
    const kb = parseKbCommunity(page("live-2026-10-20b", "kb-medina-crossing.html"), "https://www.kbhome.com/new-homes-san-antonio/medina-crossing-villa-collection", NOW);
    expect(layout(kb?.homes)).toEqual([["Plan 1676 Modeled", 2, false], ["Plan 1676 Modeled", 2, false]]);
    expect(kb?.plans.every((plan) => plan.primaryDown === null)).toBe(true);
  });

  it("Ashton Woods: each plan card's highlights (\"Downstairs primary suite\", \"Upstairs primary suite\")", () => {
    const ashton = parseAshtonCommunity(page("live-2026-10-20", "ashton-arcadia-ridge.html"), "https://www.ashtonwoods.com/san-antonio/arcadia-ridge", NOW);
    expect(layout(ashton?.plans)).toEqual([["Sycamore", 1, true], ["Sage", 1, null], ["Willow", 2, true], ["Yaupon", 2, true], ["Laurel", 2, false], ["Iris", 2, true]]);
  });

  it("Drees: each plan's own feature lines (\"main-level owner's suite\", \"first-floor primary suite\")", () => {
    const drees = parseDreesPlans(page("live-2026-10-20", "drees-plan-326325.json"), "https://www.dreeshomes.com/new-homes-san-antonio/san-antonio/comm-haby-hills/");
    const down = (drees?.plans ?? []).filter((plan) => plan.primaryDown === true).map((plan) => plan.privatePlanName);
    expect(down).toEqual(["Dakota", "Tegan"]);
    expect((drees?.plans ?? []).some((plan) => plan.primaryDown === false)).toBe(false);
  });

  it("Lennar: the floors from the plan's drawings and the owner's suite's floor from its walkthrough write-up", () => {
    const cache = lennarCache(parseLennarNextData(page("live-2026-10-22", "lennar-sunshine-trails.html")))!;
    const plans = lennarRows(cache, "PlanType").map((plan) => [plan.name, lennarPlanLayout(cache, plan)]);
    expect(plans).toEqual([
      ["Baja", { stories: 2, primaryDown: false }], ["Pima", { stories: 2, primaryDown: false }], ["Cibola", { stories: 2, primaryDown: false }],
      ["Gerson", { stories: null, primaryDown: null }], ["Hoffman", { stories: null, primaryDown: null }],
      ["Tilley", { stories: 2, primaryDown: null }], ["Mayer", { stories: 2, primaryDown: null }],
    ]);
  });

  it("Chesmar: the page's own \"About the <plan>\" write-up, for the floor and for single-story", () => {
    const about = (file: string) => chesmarAboutText(page("live-2026-10-20b", `${file}.html`));
    expect(primaryDownFrom(about("chesmar-plan-shenandoah"))).toBe(true);
    expect(storiesFromText(about("chesmar-plan-hampton"))).toBe(1);
    expect(storiesFromText(about("chesmar-home-lauren-42210000-0039"))).toBe(1);
    // "The primary suite features a spa-like bath": no floor named.
    expect(primaryDownFrom(about("chesmar-plan-brandy"))).toBeNull();
    expect(primaryDownFrom(about("chesmar-plan-cayman"))).toBeNull();
  });

  it("David Weekley: only an upstairs flag counts (every two-story plan on the saved pages says false)", () => {
    expect(weekleyPrimaryDown({ MasterBedroomUpstairs: true })).toBe(false);
    expect(weekleyPrimaryDown({ MasterBedroomUpstairs: false })).toBeNull();
    expect(weekleyPrimaryDown({ MasterBedroomUpstairs: false, MasterBedroomUpstairsOverride: true })).toBe(false);
    expect(weekleyPrimaryDown({})).toBeNull();
  });

  it("reads floors from a write-up only when it is about the house, not a room", () => {
    expect(storiesFromText("This single-story home offers an open layout")).toBe(1);
    expect(storiesFromText("A two-story design with a game room")).toBe(2);
    expect(storiesFromText("The two-story family room is filled with light")).toBeNull();
    expect(storiesFromText("A dramatic two-story foyer and a single-story ceiling")).toBeNull();
    expect(storiesFromText(null)).toBeNull();
  });
});
