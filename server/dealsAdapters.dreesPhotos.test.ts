import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { PrivatePlanOrHome } from "./dealsAdapters";
import { DREES_DETAIL_PAGES_PER_RUN, DREES_PHOTO_HOST, dreesGallery, fillDreesGalleries, parseDreesDetailGallery, parseDreesHomes, parseDreesPlans, resetDreesCaches } from "./dealsAdapters.drees";

/**
 * October 24, 2026: 141 Drees homes buyers could see showed no photo, because the
 * reader set every gallery to [] although the qmi and plan answers carry the
 * builder's photos in `images` (served from its own asset host).
 */
const json = (name: string) => gunzipSync(readFileSync(new URL(`./fixtures/deals/live-2026-10-20/${name}.json.gz`, import.meta.url))).toString("utf8");
const COMMUNITY = "https://www.dreeshomes.com/new-homes-san-antonio/san-antonio/comm-haby-hills/";

describe("Drees photos", () => {
  it("keeps every photo the live homes carry, in order, from the asset host", () => {
    const homes = parseDreesHomes(json("drees-qmi-326325"), COMMUNITY, new Date("2026-10-20T15:00:00Z"))!.homes;
    const counts = homes.map((home) => home.gallery?.length ?? 0);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(11);
    const lewis = homes.find((home) => home.privateName === "346 Haby Hollow")!;
    expect(lewis.gallery!.length).toBe(5);
    expect(lewis.gallery![0].sourceUrl).toBe("https://assetcloud.dreeshomes.com/transform/fade35d2-8b15-4ea2-9e72-6db5e069487c/HH50-0036-05_Lewis_C_Front-Elevation-03");
    for (const image of homes.flatMap((home) => home.gallery ?? [])) expect(new URL(image.sourceUrl).hostname).toBe(DREES_PHOTO_HOST);
  });

  it("keeps the live plans' photos (a photo whose label mentions its floor plan stays a photo)", () => {
    const plans = parseDreesPlans(json("drees-plan-326325"), COMMUNITY)!.plans;
    expect(plans.filter((plan) => plan.gallery?.length).length).toBe(4);
    const canyon = plans.find((plan) => plan.privateName === "Canyon")!;
    expect(canyon.gallery!.length).toBe(1);
  });

  it("never drops an image: drawings go after the photos, other hosts and svgs are not the builder's photos", () => {
    const image = (path: string, extra: Record<string, unknown> = {}) => ({ imagePath: `https://${DREES_PHOTO_HOST}/transform/${path}`, altText: "exterior", caption: null, mimeType: "image/jpg", ...extra });
    const gallery = dreesGallery([
      image("plan-1", { caption: "Floor plan, first floor", altText: "Floor plan" }),
      image("front"),
      image("level", { floorPlanLevel: "1" }),
      image("kitchen"),
      image("front"),
      { imagePath: "https://example.com/x.jpg" },
      image("drawing.svg"),
    ]);
    expect(gallery.map((item) => new URL(item.sourceUrl).pathname)).toEqual(["/transform/front", "/transform/kitchen", "/transform/plan-1", "/transform/level"]);
  });

  /**
   * October 24, 2026: 108 Drees listings still had no photo. The plan list answers `images: null` for 83 of 85
   * San Antonio plans; the plan's own page carries them (the Dakota at Legacy at Lake Dunlap: 24 images, two
   * floor-plan drawings in a separate block) in the detail block's props, entity-encoded as the site serves them.
   */
  const PLAN_PAGE = "https://www.dreeshomes.com/new-homes-san-antonio/new-braunfels/legacy-at-lake-dunlap/legacy-at-lake-dunlap/dakota-floorplan/";
  const encode = (value: unknown) => JSON.stringify(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
  const detailPage = (url: string, images: unknown[]) => `<html><body><floating-contact-us-block v-bind="${encode({ primaryImage: { imagePath: "/globalassets/contactus.svg" } })}"></floating-contact-us-block>
<neighborhood-details-base-product-block v-bind="${encode({ showImageCaption: true, details: { url, entityName: "Dakota", pageType: "Plan", images } })}"></neighborhood-details-base-product-block>
<floor-plan-block v-bind="${encode({ floorPlanImages: { main: [{ imagePath: `https://${DREES_PHOTO_HOST}/asset/dc42/Dakota_0FLR1.svg` }] } })}"></floor-plan-block></body></html>`;
  const photo = (id: string, caption: string) => ({ altText: "custom Drees home with brick exterior", caption, imageName: id, floorPlanLevel: null, svgPath: null, imagePath: `https://${DREES_PHOTO_HOST}/transform/${id}`, mimeType: "image/jpg" });
  const DAKOTA = [photo("b3b847fd/WFR-0010-E_Dakota-B_Exterior-01", "The Dakota B"), photo("06d0322b/WFR-0010-E_Dakota-B_Kitchen-01", "The Dakota Kitchen"), photo("abc07f53/Dakota_A", "Dakota A")];

  it("reads a listing's gallery from its own page's detail block, never another listing's block or the floor-plan drawings", () => {
    const gallery = parseDreesDetailGallery(detailPage("/new-homes-san-antonio/new-braunfels/legacy-at-lake-dunlap/legacy-at-lake-dunlap/dakota-floorplan/", DAKOTA), PLAN_PAGE)!;
    expect(gallery.map((image) => image.sourceUrl)).toEqual(DAKOTA.map((image) => image.imagePath));
    expect(parseDreesDetailGallery(detailPage("/new-homes-san-antonio/new-braunfels/legacy-at-lake-dunlap/legacy-at-lake-dunlap/canyon-floorplan/", DAKOTA), PLAN_PAGE)).toBeNull();
    expect(parseDreesDetailGallery("<html><body>No detail block</body></html>", PLAN_PAGE)).toBeNull();
    expect(parseDreesDetailGallery('<neighborhood-details-base-product-block v-bind="{not json"></neighborhood-details-base-product-block>', PLAN_PAGE)).toBeNull();
  });

  it("fills only the listings the list left without photos, from their pages, once per half day; a failed page is left for the next run", async () => {
    resetDreesCaches();
    const listing = (url: string, gallery: PrivatePlanOrHome["gallery"] = []): PrivatePlanOrHome => ({ sourceUrl: url, privateName: "Dakota", status: null, readyNow: false, gallery });
    const OTHER = PLAN_PAGE.replace("dakota", "canyon");
    const FAILING = PLAN_PAGE.replace("dakota", "lewis");
    const fetcher = vi.fn(async (input: string) => {
      if (input === PLAN_PAGE) return new Response(detailPage(new URL(PLAN_PAGE).pathname, DAKOTA), { status: 200, headers: { "content-type": "text/html" } });
      return new Response("Not found", { status: 404, headers: { "content-type": "text/html" } });
    });
    const kept = [{ sourceUrl: `https://${DREES_PHOTO_HOST}/transform/own`, caption: "Representative image", width: null, height: null, srcSet: null }];
    const items = [listing(PLAN_PAGE), listing(OTHER, kept), listing(FAILING), { ...listing(PLAN_PAGE.replace("dakota", "model")), status: "Model" }, listing("https://www.dreeshomes.com/new-homes-san-antonio/x/unreadable-3")];
    await fillDreesGalleries(items, fetcher as never, 1_000);
    expect(items[0].gallery!.length).toBe(3);
    expect(items[1].gallery).toBe(kept);
    expect(items[2].gallery).toEqual([]);
    expect(fetcher.mock.calls.map((call) => call[0]).sort()).toEqual([FAILING, PLAN_PAGE].sort());
    // A later run reuses the page it read and retries the one that failed.
    fetcher.mockClear();
    const again = [listing(PLAN_PAGE), listing(FAILING)];
    await fillDreesGalleries(again, fetcher as never, 2_000);
    expect(again[0].gallery!.length).toBe(3);
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([FAILING]);
  });

  it("reads at most a set number of pages per run", async () => {
    resetDreesCaches();
    const fetcher = vi.fn(async () => new Response("Not found", { status: 404, headers: { "content-type": "text/html" } }));
    const items = Array.from({ length: DREES_DETAIL_PAGES_PER_RUN + 15 }, (_, index): PrivatePlanOrHome => ({ sourceUrl: PLAN_PAGE.replace("dakota", `plan-${index}`), privateName: "Plan", status: null, readyNow: false, gallery: [] }));
    await fillDreesGalleries(items, fetcher as never, 1_000);
    expect(fetcher.mock.calls.length).toBe(DREES_DETAIL_PAGES_PER_RUN);
  });
});
