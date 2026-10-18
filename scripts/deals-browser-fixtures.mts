import assert from "node:assert/strict";
import type { BrowserContext, Page } from "playwright";

export function configuredBaseUrl(): URL {
  const value = process.env.DEALS_E2E_BASE_URL?.trim();
  assert(value, "DEALS_E2E_BASE_URL is required; no external preview URL is hardcoded.");
  const url = new URL(value);
  assert(["http:", "https:"].includes(url.protocol), "DEALS_E2E_BASE_URL must use HTTP(S)");
  assert(!url.username && !url.password, "Base URL must not contain credentials.");
  return url;
}

export const browserExecutable = () => process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.CHROMIUM_PATH || undefined;
export const demoPhone = "+12105550123"; // NANP fictional 555-01xx range, never sent.
export const demoOtp = "654321"; // Browser fixture only, not the runtime's secret.
const expiresAt = () => new Date(Date.now() + 24 * 60 * 60_000).toISOString();
const mapSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#1d2628"/><path d="M0 90L800 280M40 400L670 0M0 280L800 170M320 0L400 400" stroke="#77827b" stroke-width="8"/><path d="M0 190L800 230M140 0L650 400" stroke="#d3a63e" stroke-width="3"/><text x="20" y="40" fill="#eee" font-size="22">ILLUSTRATIVE MAP FIXTURE — NOT GEOGRAPHIC EVIDENCE</text></svg>`;
const photoSvg = (frame: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="1600" height="1200" fill="${frame === 1 ? "#354d57" : "#41523d"}"/><path d="M300 560L800 230L1300 560V1000H300Z" fill="#d7ccbb"/><rect x="680" y="670" width="240" height="330" fill="#7e6e55"/><text x="80" y="100" fill="white" font-size="44">SYNTHETIC HOME IMAGE ${frame}</text>${Array.from({ length: 7 }, (_, row) => Array.from({ length: 3 }, (_, col) => `<text x="${col * 550 - 100}" y="${row * 185 + 100}" fill="white" fill-opacity=".26" font-size="30">Prepared for Demo Buyer | Lifestyle Design Realty</text>`).join("")).join("")}</svg>`;

export function demoCommunities() {
  const common = { updatedAt: "2026-10-18T12:00:00Z", reelUrl: null, lotSizes: "Illustrative lot sizes", schoolDistrict: "Illustrative school district", amenities: ["Illustrative walking trails", "Illustrative neighborhood park"], driveTimes: ["18 min to illustrative destination"] };
  return [
    { ...common, label: "North-side demo community", area: "Illustrative San Antonio area", fromPrice: 499000, homesAvailable: 2, areaMap: { lat: 29.42, lng: -98.49, radiusMiles: 4, zoom: 11, imageUrl: "/deals/mine/maps/demo.png", attribution: "Illustrative fixture artwork — not a map provider" }, incentive: null,
      homes: [1, 2].map((frame) => ({ card: String(frame).repeat(20), kind: "quick_move_in", price: 499000 + frame * 1000, previousPrice: 519000, beds: 4, baths: 3, sqft: 2500, photos: ["/deals/mine/img/1", "/deals/mine/img/2"] })) },
    { ...common, label: "South-side demo community", area: "Illustrative San Antonio area", fromPrice: 399000, homesAvailable: 0, areaMap: null, incentive: null, homes: [{ card: "3".repeat(20), kind: "to_be_built", price: 399000, beds: 3, baths: 2, sqft: 2000, photos: [] }] },
  ];
}

/** Intercepts every API/image/document access that could expose or mutate real Deals data.
 * These are client interaction tests, not proof that production authentication works.
 */
export async function installDemoFixtures(context: BrowserContext, options: { authenticated?: boolean; sameDevice?: boolean; team?: boolean } = {}) {
  const state = { authenticated: Boolean(options.authenticated), pending: false, startRequests: 0, exchangeToken: "fixture-only-exchange-token-never-runtime", verifyRequests: 0 };
  const sameDevice = options.sameDevice ?? true;
  const lead = () => ({ display: "Demo Buyer", name: null, timeline: null, expiresAt: expiresAt(), teamPreview: Boolean(options.team) });
  await context.route("**/api/trpc/**", async (route) => {
    const names = new URL(route.request().url()).pathname.split("/").at(-1)!.split(",");
    const responses = names.map((name) => {
      let data: unknown = null;
      switch (name) {
        case "deals.state": data = { session: state.authenticated ? lead() : null, pending: state.pending ? { displayPhone: "(210) •••-0123", expiresAt: expiresAt() } : null, consentText: "Synthetic fixture only. No verification text will be sent.", commentKeyword: "HOME", textLine: "(210) 555-0199", blockedMessage: "This page is for buyers who aren't working with an agent yet. Made a mistake? Text HOME to (210) 555-0199.", googleEnabled: false }; break;
        case "deals.publicCatalog": data = demoCommunities(); break;
        case "deals.start": {
          state.startRequests += 1;
          const body = route.request().postData() ?? "";
          if (body.includes("has_agent")) data = { ok: false, kind: "blocked", message: "This page is for buyers who aren't working with an agent yet. Made a mistake? Text HOME to (210) 555-0199." };
          else { state.pending = true; data = { ok: true, displayPhone: "(210) •••-0123" }; }
          break;
        }
        case "deals.mine":
          if (!state.authenticated) return { error: { json: { message: "Fixture session required", code: -32001, data: { code: "UNAUTHORIZED", httpStatus: 401 } } } };
          data = { lead: lead(), communities: demoCommunities() }; break;
        case "deals.changeNumber": state.pending = false; data = { ok: true }; break;
        case "deals.gateFocused": case "deals.updateProfile": case "deals.requestHome": data = { ok: true }; break;
        default: throw new Error(`Unimplemented synthetic API: ${name}`);
      }
      return { result: { data: { json: data } } };
    });
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(responses) });
  });
  // Vite and the deployed proxy may add a query string during a document-form
  // navigation, so match the path explicitly rather than relying on an exact
  // glob. This remains a local synthetic fixture: no runtime verification
  // endpoint is ever reached.
  await context.route(/\/deals\/verify(?:\?.*)?$/, async (route) => {
    state.verifyRequests += 1;
    assert.equal(new URLSearchParams(route.request().postData() ?? "").get("code"), demoOtp);
    state.pending = false;
    await route.fulfill({ status: 302, headers: { location: `/deals/v/${state.exchangeToken}` } });
  });
  await context.route("**/deals/v/**", async (route) => {
    if (sameDevice) state.authenticated = true;
    await route.fulfill({ status: 302, headers: { location: sameDevice ? "/deals/mine" : "/deals?gate=1" } });
  });
  await context.route("**/deals/mine", async (route) => {
    // The frontend-only Vite host can safely serve the SPA shell. Never pass an
    // authenticated document request to a runtime with a real Deals database.
    const shell = await route.fetch({ url: new URL("/", route.request().url()).toString() });
    await route.fulfill({ response: shell });
  });
  await context.route("**/deals/mine/img/**", (route) => route.fulfill({ contentType: "image/svg+xml", body: photoSvg(route.request().url().endsWith("/2") ? 2 : 1) }));
  await context.route("**/deals/mine/maps/**", (route) => route.fulfill({ contentType: "image/svg+xml", body: mapSvg }));
  // Avoid third-party tracking or accidental private reel activity in artifacts.
  await context.route(/https:\/\/(?:[^/]*\.)?(?:instagram\.com|cdninstagram\.com|umami\.is)\//, (route) => route.abort());
  return state;
}

export async function assertMobileGeometry(page: Page, label: string) {
  const geometry = await page.evaluate(() => {
    const viewport = window.innerWidth;
    const relevant = [...document.querySelectorAll("article, [aria-roledescription='carousel'], [aria-roledescription='slide'], article img, input, select, [role='dialog'], [aria-label='Approximate area map']")];
    const tooWide = relevant.map((element) => ({ tag: element.tagName, role: element.getAttribute("aria-roledescription"), width: element.getBoundingClientRect().width })).filter((element) => element.width > viewport + 1);
    return { viewport, scrollWidth: document.documentElement.scrollWidth, tooWide };
  });
  assert.equal(geometry.viewport, 375, `${label}: real browser viewport must be 375 CSS px`);
  assert(geometry.scrollWidth <= 375, `${label}: document scrollWidth ${geometry.scrollWidth} exceeds viewport`);
  assert.deepEqual(geometry.tooWide, [], `${label}: constrained card/gallery/input widths`);
  return geometry;
}
