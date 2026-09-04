/**
 * The Express app over real HTTP (server/_core/app.ts + vite.ts serveStatic).
 *
 * These are the properties that only exist at the HTTP layer and that no
 * router-level test can see: how big a body the process will buffer, what
 * content types tRPC accepts (the cross-site form defence), what an anonymous
 * caller learns from the cron endpoint, and what cache headers the bundle
 * ships with.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp, JSON_BODY_LIMIT } from "./_core/app";
import { ASSET_CACHE_CONTROL, HTML_CACHE_CONTROL, serveStatic } from "./_core/vite";

let server: http.Server;
let base = "";
let dist = "";

beforeAll(async () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  dist = mkdtempSync(join(tmpdir(), "ldr-dist-"));
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>t</title><!--og-meta--><div id=root></div>");
  writeFileSync(join(dist, "assets", "index-abc123.js"), "console.log(1)");
  const app = createApp();
  serveStatic(app, dist);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dist, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const track = (body: string, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/trpc/analytics.track?batch=1`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });

describe("request body limit", () => {
  it(`is ${JSON_BODY_LIMIT}, not the template's 50mb`, () => {
    expect(JSON_BODY_LIMIT).toBe("1mb");
  });

  it("refuses a 2 MB JSON body with 413 before any handler runs", async () => {
    const huge = JSON.stringify({ "0": { json: { kind: "view", path: "/", pad: "x".repeat(2 * 1024 * 1024) } } });
    const res = await track(huge);
    expect(res.status).toBe(413);
  });

  it("still accepts a normal analytics ping", async () => {
    const res = await track(JSON.stringify({ "0": { json: { kind: "view", path: "/join" } } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(JSON.stringify(body)).toContain('"ok":true');
  });
});

describe("cross-site form bodies", () => {
  it("are rejected by tRPC with 415 (text/plain, urlencoded), so a cookie session cannot be driven by a <form>", async () => {
    const payload = JSON.stringify({ "0": { json: { kind: "view", path: "/" } } });
    for (const ct of ["text/plain", "application/x-www-form-urlencoded"]) {
      const res = await fetch(`${base}/api/trpc/analytics.track?batch=1`, {
        method: "POST",
        headers: { "content-type": ct, origin: "https://evil.example" },
        body: payload,
      });
      expect(res.status, ct).toBe(415);
    }
  });
});

describe("cron callback exposure", () => {
  it("answers an anonymous POST with 403 and no stack trace", async () => {
    const res = await fetch(`${base}/api/scheduled/syncStats`, { method: "POST" });
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).toBe(JSON.stringify({ error: "cron-only" }));
    expect(text).not.toMatch(/stack|\.ts:|node_modules/);
  });
});

describe("static cache policy", () => {
  it("serves hashed assets as immutable for a year", async () => {
    const res = await fetch(`${base}/assets/index-abc123.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(ASSET_CACHE_CONTROL);
  });

  it("serves index.html and the SPA fallthrough as no-cache", async () => {
    for (const path of ["/", "/team", "/some/deep/route"]) {
      const res = await fetch(`${base}${path}`, { headers: { accept: "text/html" } });
      expect(res.status, path).toBe(200);
      expect(res.headers.get("cache-control"), path).toBe(HTML_CACHE_CONTROL);
      expect(await res.text()).toContain('id=root');
    }
  });
});
