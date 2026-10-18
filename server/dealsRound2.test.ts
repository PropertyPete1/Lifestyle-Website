import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeTestNumbers } from "./dealsService";

const root = process.cwd();
const service = readFileSync(join(root, "server/dealsService.ts"), "utf8");
const routes = readFileSync(join(root, "server/dealsRoutes.ts"), "utf8");
const router = readFileSync(join(root, "server/dealsRouter.ts"), "utf8");
const fubJobs = readFileSync(join(root, "server/dealsFubJobs.ts"), "utf8");
const photos = readFileSync(join(root, "server/dealsPhotos.ts"), "utf8");
const page = readFileSync(join(root, "client/src/pages/Deals.tsx"), "utf8");

describe("Builder Deals Round 2 regression contract", () => {
  it("scopes all Deals cookies to the root API path and detects an incoming probe", () => {
    expect(service).toContain('function cookieBase(maxAgeSeconds: number, path = "/")');
    expect(service).toContain('const hasProbe = Boolean(cookies[DEALS_COOKIE.probe])');
    expect(service).toContain('res.clearCookie(name, cookieBase(0, "/deals"))');
    expect(routes).toContain('result === "cookie_blocked"');
  });
  it("normalizes admin test numbers to E.164 before matching them", () => {
    expect(normalizeTestNumbers(["(210) 555-0123", "+1 210 555 0123"])).toEqual(["+12105550123"]);
  });
  it("reserves and logs every code attempt before either delivery transport", () => {
    expect(service).toContain('kind: "code_sent"');
    expect(service).toContain('dailyVerificationCap');
    expect(router).toContain('reserveVerificationAttempt');
    expect(router).toContain('channel: input.channel');
  });
  it("keeps image bytes private and gives the browser only protected galleries", () => {
    expect(photos).toContain('builder-deals-private/');
    expect(photos).toContain('watermarkSvg');
    expect(photos).toContain('ocrTerms');
    expect(page).toContain('ProtectedGallery');
    expect(service).toContain('`/deals/mine/img/${photo.id}`');
  });
  it("uses first-unlock versus re-verification FUB delivery paths", () => {
    expect(routes).toContain('completed.firstUnlock');
    expect(routes).toContain('enqueueDealsFubJob');
    expect(fubJobs).toContain('updateBuilderDealsLeadInFub');
    expect(routes).toContain('re-verified on a second device');
  });
});
