import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { registerDealsRoutes } from "./dealsRoutes";

type LocalDealsServer = { baseUrl: URL; close: () => Promise<void> };

async function startLocalDealsServer(): Promise<LocalDealsServer> {
  const app = express();
  app.use(express.json());
  registerDealsRoutes(app);
  const server = app.listen(0, "127.0.0.1") as Server;
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: new URL(`http://127.0.0.1:${port}`),
    close: async () => { server.close(); await once(server, "close"); },
  };
}

function rootCookieNames(response: Response): string[] {
  return response.headers.getSetCookie()
    .filter((cookie) => /;\s*Path=\//i.test(cookie) && !/;\s*Path=\/deals(?:;|$)/i.test(cookie))
    .map((cookie) => cookie.split("=", 1)[0]);
}

describe("Builder Deals public boundary", () => {
  let server: LocalDealsServer;

  beforeAll(async () => { server = await startLocalDealsServer(); });
  afterAll(async () => { await server.close(); });

  it("redirects an unauthenticated private document before emitting catalog markup", async () => {
    const response = await fetch(new URL("/deals/mine", server.baseUrl), { redirect: "manual" });
    const body = await response.text();

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/deals?gate=1");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("same-origin");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(rootCookieNames(response)).toEqual(expect.arrayContaining(["ldr_deals_device", "ldr_deals_probe"]));
    expect(body).not.toContain("Private buyer list");
  });

  it("returns no bytes for an unauthenticated protected image, including a valid-looking ID", async () => {
    const response = await fetch(new URL("/deals/mine/img/1", server.baseUrl), { redirect: "manual" });

    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
    expect((await response.arrayBuffer()).byteLength).toBe(0);
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("never sets a cookie on the public area map, which browsers and caches may keep", async () => {
    const response = await fetch(new URL("/deals/maps/1.webp", server.baseUrl), { redirect: "manual" });
    expect(response.headers.getSetCookie()).toEqual([]);
    // The private map still goes through the usual cookie and session path.
    const gated = await fetch(new URL("/deals/mine/maps/1.webp", server.baseUrl), { redirect: "manual" });
    expect(rootCookieNames(gated)).toEqual(expect.arrayContaining(["ldr_deals_device", "ldr_deals_probe"]));
    expect(gated.status).toBe(401);
  });

  it("rejects malformed token and verification requests without reaching a private document", async () => {
    const malformedToken = await fetch(new URL("/deals/v/not-a-token", server.baseUrl), { redirect: "manual" });
    expect(malformedToken.status).toBe(302);
    expect(malformedToken.headers.get("location")).toBe("/deals?expired=1");

    const malformedCode = await fetch(new URL("/deals/verify", server.baseUrl), {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "12" }),
    });
    expect(malformedCode.status).toBe(302);
    expect(malformedCode.headers.get("location")).toBe("/deals?codeError=1");
    expect(await malformedCode.text()).not.toContain("Private buyer list");
  });
});
