import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ getDb: vi.fn() }));

import { dealCommunities } from "../drizzle/schema";
import { getDb } from "./db";
import { createFakeDealsDb } from "./dealsFubFakeDb.test-support";
import { COMING_SOON_HOLD, comingSoonCommunities } from "./dealsService";

afterEach(() => vi.mocked(getDb).mockReset());

const row = (over: Record<string, unknown> = {}) => ({
  id: 30120, builder: "D.R. Horton", privateName: "McQueeney Oaks", sourceUrl: "https://www.drhorton.com/texas/new-braunfels/new-braunfels/mcqueeney-oaks",
  privateAddress: "1 Fixture Way, McQueeney, TX 78123", publicLabel: "New Braunfels | Move-In Ready Homes", areaLabel: "New Braunfels", fromPrice: 308_500,
  scrubList: JSON.stringify(["McQueeney Oaks"]), catalogHoldReason: COMING_SOON_HOLD, active: false, awaitingFirstSync: true, paused: false, manualMode: false, reelCode: "auto-x", ...over,
});

describe("Coming Soon section", () => {
  it("lists a coming-soon community by area and price band only: never the builder, its name, address or label", async () => {
    vi.mocked(getDb).mockResolvedValue(createFakeDealsDb([[dealCommunities, [row(), row({ id: 30121, areaLabel: "Boerne", fromPrice: null })]]]) as never);
    const list = await comingSoonCommunities();
    expect(list.map(({ area, fromPriceLabel }) => [area, fromPriceLabel])).toEqual([["New Braunfels", "From the $300s"], ["Boerne", null]]);
    expect(list[0]!.key).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(JSON.stringify(list)).not.toMatch(/Horton|McQueeney|Fixture Way|Move-In Ready|30120|drhorton/i);
  });

  it("leaves out a row whose area would name the community", async () => {
    vi.mocked(getDb).mockResolvedValue(createFakeDealsDb([[dealCommunities, [row({ areaLabel: "McQueeney Oaks" })]]]) as never);
    expect(await comingSoonCommunities()).toEqual([]);
  });

  it("asks only for not-yet-live, unpaused, automatic communities held as coming soon", async () => {
    const db = createFakeDealsDb([[dealCommunities, []]]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    await comingSoonCommunities();
    const { QueryBuilder } = await import("drizzle-orm/mysql-core");
    const query = new QueryBuilder().select().from(dealCommunities).where(db.selects[0]!.where as never).toSQL();
    expect(query.params).toEqual([COMING_SOON_HOLD, false, true, false, false]);
    expect(query.sql).toMatch(/`catalog_hold_reason` = \? and .*`active` = \? and .*`awaiting_first_sync` = \? and .*`paused` = \? and .*`manual_mode` = \?/);
  });
});
