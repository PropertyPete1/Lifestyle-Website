import { describe, expect, it } from "vitest";
import { probeCommunityGone, type HtmlFetcher } from "./dealsAdapters";

const SOURCE = "https://www.lennar.com/new-homes/texas/san-antonio/san-antonio/greensfield";
const HOST = "www.lennar.com";
const replies = (...list: Array<{ status: number; location?: string }>): HtmlFetcher => {
  const queue = [...list];
  return (async () => {
    const next = queue.shift() ?? { status: 200 };
    return new Response(next.status >= 300 && next.status < 400 ? null : "x", { status: next.status, headers: next.location ? { location: next.location } : {} });
  }) as unknown as HtmlFetcher;
};

describe("probeCommunityGone (Nov 6: Lennar closes out a community by redirecting it to the metro page)", () => {
  it("says gone on a 404/410 and on a redirect up to a shallower page that no longer names the community", async () => {
    expect(await probeCommunityGone(SOURCE, replies({ status: 404 }), HOST)).toBe("gone");
    expect(await probeCommunityGone(SOURCE, replies({ status: 410 }), HOST)).toBe("gone");
    expect(await probeCommunityGone(SOURCE, replies({ status: 307, location: "/texas/san-antonio" }, { status: 200 }), HOST)).toBe("gone");
  });

  it("never says gone for a live page, a sideways or same-depth redirect, a redirect still naming it, off-host, or a client error", async () => {
    expect(await probeCommunityGone(SOURCE, replies({ status: 200 }), HOST)).toBe("present");
    expect(await probeCommunityGone(SOURCE, replies({ status: 301, location: "/new-homes/texas/san-antonio/san-antonio/greensfield-north" }, { status: 200 }), HOST)).toBe("unknown");
    expect(await probeCommunityGone(SOURCE, replies({ status: 301, location: "/new-homes/texas/san-antonio/greensfield" }, { status: 200 }), HOST)).toBe("unknown");
    expect(await probeCommunityGone(SOURCE, replies({ status: 302, location: "https://evil.example/texas" }), HOST)).toBe("unknown");
    expect(await probeCommunityGone(SOURCE, replies({ status: 403 }), HOST)).toBe("unknown");
    expect(await probeCommunityGone(SOURCE, replies({ status: 307, location: "/texas/san-antonio" }, { status: 403 }), HOST)).toBe("unknown");
  });

  it("retries a server error once, then gives up as unknown", async () => {
    expect(await probeCommunityGone(SOURCE, replies({ status: 503 }, { status: 404 }), HOST)).toBe("gone");
    expect(await probeCommunityGone(SOURCE, replies({ status: 503 }, { status: 503 }), HOST)).toBe("unknown");
  });
});
