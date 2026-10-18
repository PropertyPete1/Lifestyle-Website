import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const page = readFileSync(join(root, "client/src/pages/Deals.tsx"), "utf8");
const routes = readFileSync(join(root, "server/dealsRoutes.ts"), "utf8");
const robots = readFileSync(join(root, "client/public/robots.txt"), "utf8");
const og = readFileSync(join(root, "server/ogMeta.ts"), "utf8");
const prohibitedOutbound = ["messages." + "create", "Messaging" + "Service", "TWILIO_" + "PHONE_NUMBER"];

// These values deliberately cover source brands, community names, plan names,
// and street addresses. None can appear in browser-facing code, API DTO names,
// or the generic share-card asset name.
const privateTerms = ["Chesmar", "M/I Homes", "Sienna Lakes", "Vista Gardens", "Rio Grande", "Hanging Basket", "Onion Patch"];

describe("Builder Deals public boundary", () => {
  it("uses a direct browser redirect through the one-time token, not outbound SMS", () => {
    expect(routes).toContain('app.post("/deals/verify"');
    expect(routes).toContain('res.redirect(302, `/deals/v/${completed.token}`)');
    const source = [routes, readFileSync(join(root, "server/dealsRouter.ts"), "utf8")].join("\n");
    for (const term of prohibitedOutbound) expect(source).not.toContain(term);
  });

  it("server-enforces noindex and the protected document/image boundary", () => {
    expect(routes).toContain('app.get("/deals/mine"');
    expect(routes).toContain('app.get("/deals/mine/img/:photoId"');
    expect(routes).toContain("return res.status(401).end()");
    expect(og).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(robots).toContain("Disallow: /deals/v/");
    expect(robots).toContain("Disallow: /deals/mine");
    expect(robots).not.toContain("Disallow: /deals\n");
  });

  it("does not embed private builder/catalog identity in public React code", () => {
    for (const term of privateTerms) expect(page).not.toContain(term);
    expect(page).toContain("Video coming soon");
    expect(page).toContain("sms:${digits}");
  });

  it("does not embed private identity in the public Builder Deals image bytes", () => {
    const cardBytes = readFileSync(join(root, "docs/assets/builder-deals-og-card.png")).toString("latin1").toLowerCase();
    for (const term of privateTerms) expect(cardBytes).not.toContain(term.toLowerCase());
  });
});
