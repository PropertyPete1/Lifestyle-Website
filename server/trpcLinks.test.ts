import { createTRPCClient } from "@trpc/client";
import { describe, expect, it } from "vitest";
import type { AppRouter } from "./routers";
import { UNBATCHED_PATHS, trpcLinks } from "../client/src/lib/trpcLinks";

/**
 * Oct 28, 2026: calls asked for together share one HTTP request that answers when its slowest call is done, so the
 * big lists (the unlocked list, the public list, the agent's clients) go on their own and paint as soon as they land.
 */
describe("the browser's API links", () => {
  it("sends the big lists alone and batches everything else", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      const path = url.replace(/^\/api\/trpc\//, "").split("?")[0]!;
      const body = url.includes("batch=1")
        ? path.split(",").map(() => ({ result: { data: { json: null } } }))
        : { result: { data: { json: { path } } } };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const client = createTRPCClient<AppRouter>({ links: trpcLinks(fetchImpl) });
    const [mine] = await Promise.all([
      client.deals.mine.query(),
      client.deals.team.workspace.query(),
      client.deals.comingSoon.query(),
      client.deals.featured.query(),
    ]);
    expect(mine).toEqual({ path: "deals.mine" });
    expect(urls.filter((url) => url.startsWith("/api/trpc/deals.mine?") || url === "/api/trpc/deals.mine")).toHaveLength(1);
    expect(urls.some((url) => url.startsWith("/api/trpc/deals.team.workspace") && !url.includes("batch=1"))).toBe(true);
    const batched = urls.filter((url) => url.includes("batch=1"));
    expect(batched).toHaveLength(1);
    expect(batched[0]).toContain("deals.comingSoon,deals.featured");
    expect(urls).toHaveLength(3);
    expect(Array.from(UNBATCHED_PATHS)).toEqual(["deals.mine", "deals.publicCatalog", "deals.team.workspace"]);
  });
});
