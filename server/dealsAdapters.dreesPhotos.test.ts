import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DREES_PHOTO_HOST, dreesGallery, parseDreesHomes, parseDreesPlans } from "./dealsAdapters.drees";

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
});
