import { describe, expect, it } from "vitest";
import { dealHomes, dealPhotos } from "../drizzle/schema";
import { builderDealsAdminStats } from "./dealsAdminStats";
import { FakeDealsDb } from "./dealsSync.fakeDb";

describe("Builder Deals admin header counts", () => {
  it("counts every available home and every served photo, not just the capped overview lists", async () => {
    const db = new FakeDealsDb();
    // More homes than the overview's 500-row list.
    for (let i = 0; i < 620; i++) db.seed(dealHomes, { communityId: 1, sourceKey: `home-${i}`, sourceUrl: `https://example.test/${i}`, status: i < 540 ? "available" : i < 600 ? "sold" : "hidden", kind: "quick_move_in", origin: "official" });
    const photo = (i: number, values: Partial<typeof dealPhotos.$inferInsert>) => db.seed(dealPhotos, { homeId: 1, sourceUrl: `https://example.test/p${i}.jpg`, sourceHash: `h${i}`, automaticHidden: false, adminHidden: false, processingState: "pending", processingAttempts: 0, lastProcessingError: null, ...values });
    let i = 0;
    // Old served photos sit behind more than 200 newer queued ones.
    for (let n = 0; n < 30; n++) photo(i++, { processingState: "processed" });
    for (let n = 0; n < 4; n++) photo(i++, { processingState: "processed", automaticHidden: true });
    photo(i++, { processingState: "processed", adminHidden: true });
    for (let n = 0; n < 250; n++) photo(i++, { processingState: "pending", automaticHidden: true });
    for (let n = 0; n < 3; n++) photo(i++, { processingState: "pending", automaticHidden: true, lastProcessingError: "awaiting_region" });
    photo(i++, { processingState: "pending", automaticHidden: true, lastProcessingError: "processing_lease_expired" });
    for (let n = 0; n < 2; n++) photo(i++, { processingState: "processing", automaticHidden: true });
    photo(i++, { processingState: "failed", automaticHidden: true, lastProcessingError: "unapproved_source" });

    expect(await builderDealsAdminStats(db as never)).toEqual({
      homes: { available: 540 },
      photos: { served: 30, queued: 251, processing: 2, failed: 1, awaitingRegion: 3 },
    });
  });
});
