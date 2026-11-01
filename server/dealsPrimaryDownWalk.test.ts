import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { primaryDownFromFloorWalk } from "./dealsAdapters";
import { parsePerryDetail, perryDescription } from "./dealsAdapters.perry";

/**
 * Nov 1, 2026 (Peter: the "primary bedroom downstairs" filter showed only 90 two-story homes). Perry walks every plan floor
 * by floor; these are Perry's own write-ups as perryhomes.com served them on Nov 1 (176 two-story designs: 170 read
 * downstairs, 2 upstairs by their own words, the rest stay unknown).
 */
const page = (dir: string, file: string) => gunzipSync(readFileSync(new URL(`./fixtures/deals/${dir}/${file}.gz`, import.meta.url))).toString("utf8");

describe("primaryDownFromFloorWalk: a write-up that walks the house floor by floor", () => {
  it("a primary described before the upstairs is downstairs", () => {
    expect(primaryDownFromFloorWalk("The front porch leads to a two-story entryway with a grand staircase. French doors enclose the private home office that overlooks the front yard. The family room highlights extended ceilings and a wall of windows. The secluded primary bedroom highlights a wall of windows. Double doors lead to the primary bath with dual vanities, a garden tub, a glass-enclosed shower, and a walk-in closet. A guest suite with a private bath completes downstairs. Upstairs hosts a game room, two secondary bedrooms, and a full bath with a dual vanity. A mud room and half bath are off the two-car garage.")).toBe(true); // 2796W
    expect(primaryDownFromFloorWalk("Home office with double doors frame the entry. Two-story family room with 19-foot ceiling and a wall of windows. Primary suite with three large windows. Primary bathroom features a French door entry, dual vanities, garden tub, separate glass enclosed shower and two walk-in closets. Guest suite with a full bathroom and a walk-in closet on first level. Second floor hosts a large game room, media room, an additional guest suite and secondary bedrooms with a Hollywood bathroom. Covered backyard patio. Three-car garage.")).toBe(true); // 3553W
    expect(primaryDownFromFloorWalk("Island kitchen with built-in seating space and a corner walk-in pantry. Private primary suite with wall of windows. Additional bedroom with a walk-in closet on first floor. Circular staircase leads to second level with Secondary bedrooms, Hollywood bathroom, game room and a media room. Covered backyard patio.")).toBe(true); // 3399P
    expect(primaryDownFromFloorWalk("The primary suite features a wall of windows and includes a luxurious bathroom with a freestanding tub. Up the curved stairs, a game room overlooks the two-story family room below and connects to a media room. This level also includes two secondary bedrooms.")).toBe(true); // 4874A
  });

  it("a staircase that only leads to the second floor does not take the walk upstairs", () => {
    expect(primaryDownFromFloorWalk("The main hallway leads to a private guest suite. The formal dining room is perfectly positioned adjacent to the curved staircase leading to the second floor. The centerpiece of the home is the two-story family room. Retreat to the primary bedroom, where three windows overlook the backyard. Upstairs, a game room and media room join three secondary bedrooms.")).toBe(true); // 4994W
  });

  it("a primary described upstairs, or named on the second floor, is upstairs", () => {
    expect(primaryDownFromFloorWalk("A spacious two-story entry leads past the staircase and half bath to the main living areas. The second-level primary suite includes a large bedroom with a view of the backyard below. Two secondary bedrooms and a full bath complete upstairs.")).toBe(false); // 1918W
    expect(primaryDownFromFloorWalk("Welcoming entry extends past the half bathroom to a spacious family room. Second floor Primary suite with a large window that overlooks the front view. Secondary bedrooms with walk-in closets complete the second level.")).toBe(false); // 2379O
    expect(primaryDownFromFloorWalk("The family room opens to the kitchen. Upstairs features a game room. The primary suite offers a walk-in closet and two secondary bedrooms share a bath.")).toBe(false);
  });

  it("stays out of it with no upstairs part, a primary on both floors, both floors in one sentence, or an option", () => {
    expect(primaryDownFromFloorWalk("Primary suite with 11-foot ceiling. Additional bedroom on first floor. Secondary bedrooms with walk-in closets and a game room complete this spacious design.")).toBeNull(); // 2934W: no upstairs named
    expect(primaryDownFromFloorWalk("The primary suite has a wall of windows. Upstairs features a game room and a second primary suite with its own bath.")).toBeNull();
    expect(primaryDownFromFloorWalk("The game room is upstairs and the primary suite is off the first-floor hallway with the study.")).toBeNull();
    expect(primaryDownFromFloorWalk("The kitchen opens to the family room. Upstairs features a game room and an optional primary suite.")).toBeNull();
    expect(primaryDownFromFloorWalk("A single-story home with a primary suite at the rear.")).toBeNull();
    expect(primaryDownFromFloorWalk(null)).toBeNull();
  });

  it("a utility room's door to the primary bath does not move the primary bedroom upstairs", () => {
    expect(primaryDownFromFloorWalk("Private primary suite with a curved wall of windows. Guest suite with a full bathroom and walk-in closet downstairs. Second floor features additional guest suites with full bathrooms, a game room and a media room. Utility room offers dual access to the primary bathroom. Covered backyard patio.")).toBe(true); // 4428S
  });
});

describe("Perry plan pages", () => {
  const PLAN = "https://www.perryhomes.com/new-homes/texas/san-antonio/alsatian-oaks/alsatian-oaks-50/2561h";

  it("reads the plan's own write-up and places its primary downstairs (2561H, Oct 20 page)", () => {
    const html = page("live-2026-10-20", "perry-plan-2561h.html");
    expect(perryDescription(html)).toMatch(/^A two-story entry leads past a secondary bedroom.*Upstairs features a game room, two secondary bedrooms, and a full bath\. This home features a two-car garage\.$/);
    expect(parsePerryDetail(html, PLAN)).toMatchObject({ kind: "plan", privatePlanName: "Design 2561H", stories: 2, primaryDown: true });
  });

  it("a page with no write-up leaves the primary unknown", () => {
    expect(perryDescription("<html><body><p>No description</p></body></html>")).toBeNull();
  });
});
