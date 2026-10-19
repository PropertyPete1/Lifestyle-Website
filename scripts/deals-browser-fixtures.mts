import assert from "node:assert/strict";
import type { BrowserContext, Page } from "playwright";

/**
 * Shared helpers for the Builder Deals browser scripts.
 *
 * Two modes exist. FIXTURE mode intercepts every API, document and image route
 * with synthetic data, so a run can never create a real session or touch a
 * database; it proves the React client only. LIVE mode (DEALS_E2E_BASE_URL plus
 * DEALS_TEST_OTP and DEALS_E2E_TEST_PHONE) drives the deployed gate with the
 * admin test number and real cookies, so the server's cookie/token logic is
 * what gets exercised.
 */

export function configuredBaseUrl(): URL {
  const value = process.env.DEALS_E2E_BASE_URL?.trim();
  assert(value, "DEALS_E2E_BASE_URL is required; no external preview URL is hardcoded.");
  const url = new URL(value);
  assert(["http:", "https:"].includes(url.protocol), "DEALS_E2E_BASE_URL must use HTTP(S)");
  assert(!url.username && !url.password, "Base URL must not contain credentials.");
  return url;
}

/** PLAYWRIGHT_CHROMIUM_PATH (or the older names) selects a browser binary; unset means Playwright's own Chromium. */
export const browserExecutable = () => process.env.PLAYWRIGHT_CHROMIUM_PATH || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.CHROMIUM_PATH || undefined;
export const PHONE_VIEWPORT = { width: 375, height: 812 } as const;

export type LiveCredentials = { otp: string; phone: string };
/** Live mode needs the test code and a number on the admin test-numbers list; neither is ever hardcoded. */
export function liveCredentials(): LiveCredentials | null {
  const otp = process.env.DEALS_TEST_OTP?.trim();
  const phone = process.env.DEALS_E2E_TEST_PHONE?.trim();
  if (!otp || !phone) return null;
  assert(/^\d{6}$/.test(otp), "DEALS_TEST_OTP must be six digits");
  return { otp, phone };
}

export const demoPhone = "+12105550123"; // NANP fictional 555-01xx range, never sent.
export const demoOtp = "654321"; // Browser fixture only, not the runtime's secret.
const expiresAt = () => new Date(Date.now() + 24 * 60 * 60_000).toISOString();
const mapSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#1d2628"/><path d="M0 90L800 280M40 400L670 0M0 280L800 170M320 0L400 400" stroke="#77827b" stroke-width="8"/><path d="M0 190L800 230M140 0L650 400" stroke="#d3a63e" stroke-width="3"/><text x="20" y="40" fill="#eee" font-size="22">ILLUSTRATIVE MAP FIXTURE, NOT GEOGRAPHIC EVIDENCE</text></svg>`;
const photoSvg = (frame: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="1600" height="1200" fill="${frame === 1 ? "#354d57" : "#41523d"}"/><path d="M300 560L800 230L1300 560V1000H300Z" fill="#d7ccbb"/><rect x="680" y="670" width="240" height="330" fill="#7e6e55"/><text x="80" y="100" fill="white" font-size="44">SYNTHETIC HOME IMAGE ${frame}</text>${Array.from({ length: 7 }, (_, row) => Array.from({ length: 3 }, (_, col) => `<text x="${col * 550 - 100}" y="${row * 185 + 100}" fill="white" fill-opacity=".26" font-size="30">Prepared for Demo Buyer | Lifestyle Design Realty</text>`).join("")).join("")}</svg>`;

export const PHOTOS_ON_REQUEST = "Photos on request";

export function demoCommunities() {
  const common = { updatedAt: "2026-10-18T12:00:00Z", reelUrl: null, lotSizes: "Illustrative lot sizes", schoolDistrict: "Illustrative school district", amenities: ["Illustrative walking trails", "Illustrative neighborhood park"], driveTimes: ["about 20 min to illustrative destination"] };
  return [
    { ...common, label: "North-side demo community", area: "Illustrative San Antonio area", fromPrice: 499000, homesAvailable: 2, areaMap: { lat: 29.42, lng: -98.49, radiusMiles: 2, zoom: 11, imageUrl: "/deals/mine/maps/demo.png", attribution: "Illustrative fixture artwork, not a map provider" }, incentive: null,
      homes: [1, 2].map((frame) => ({ card: String(frame).repeat(20), kind: "quick_move_in", price: 499000 + frame * 1000, previousPrice: 519000, beds: 4, baths: 3, sqft: 2500, photos: ["/deals/mine/img/1", "/deals/mine/img/2"] })) },
    { ...common, label: "South-side demo community", area: "Illustrative San Antonio area", fromPrice: 399000, homesAvailable: 0, areaMap: null, driveTimes: [], incentive: null, homes: [{ card: "3".repeat(20), kind: "to_be_built", price: 399000, beds: 3, baths: 2, sqft: 2000, photos: [] }] },
  ];
}

/** Third-party hosts never load during a scripted run, in either mode. */
export async function blockThirdParties(context: BrowserContext) {
  await context.route(/https:\/\/(?:[^/]*\.)?(?:instagram\.com|cdninstagram\.com|umami\.is|googleapis\.com|gstatic\.com)\//, (route) => route.abort());
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
        case "deals.resend": data = { ok: true }; break;
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
  await blockThirdParties(context);
  return state;
}

export async function assertMobileGeometry(page: Page, label: string) {
  const geometry = await page.evaluate(() => {
    const viewport = window.innerWidth;
    const relevant = [...document.querySelectorAll("article, [aria-roledescription='carousel'], [aria-roledescription='slide'], article img, input, select, [role='dialog'], [aria-label='Approximate area map']")];
    const tooWide = relevant.map((element) => ({ tag: element.tagName, role: element.getAttribute("aria-roledescription"), width: element.getBoundingClientRect().width })).filter((element) => element.width > viewport + 1);
    return { viewport, scrollWidth: document.documentElement.scrollWidth, tooWide };
  });
  assert.equal(geometry.viewport, PHONE_VIEWPORT.width, `${label}: real browser viewport must be ${PHONE_VIEWPORT.width} CSS px`);
  assert(geometry.scrollWidth <= PHONE_VIEWPORT.width, `${label}: document scrollWidth ${geometry.scrollWidth} exceeds viewport`);
  assert.deepEqual(geometry.tooWide, [], `${label}: constrained card/gallery/input widths`);
  return geometry;
}

export type TranscriptEntry = { step: string; status: number | string; detail: string };

/** Every step is printed as it happens so a failing run still leaves a readable record. */
export class Transcript {
  readonly entries: TranscriptEntry[] = [];
  constructor(private readonly prefix: string) {}
  step(step: string, status: number | string, detail = "") {
    this.entries.push({ step, status, detail });
    console.log(`[${this.prefix}] ${step} -> ${status}${detail ? ` ${detail}` : ""}`);
  }
  print() {
    console.log(`[${this.prefix}] transcript (${this.entries.length} steps):`);
    for (const [index, entry] of this.entries.entries()) console.log(`  ${String(index + 1).padStart(2, " ")}. ${entry.step}: ${entry.status}${entry.detail ? ` (${entry.detail})` : ""}`);
  }
}

/** tRPC batches procedures into one URL: "/api/trpc/deals.gateFocused,deals.start?batch=1". */
export function trpcProcedures(url: string): string[] {
  try { return new URL(url).pathname.split("/").at(-1)?.split(",") ?? []; } catch { return []; }
}
const isStartCall = (url: string, method: string) => method === "POST" && trpcProcedures(url).includes("deals.start");

/** Counts deals.start calls so a reload at the code step can be shown not to burn a second code. */
export function countStartRequests(page: Page) {
  const counter = { count: 0 };
  page.on("request", (request) => { if (isStartCall(request.url(), request.method())) counter.count += 1; });
  return counter;
}

export type LiveUnlock = { token: string; verifyStatus: number; exchangeStatus: number; exchangeLocation: string | null; startRequests: number; displayedPhoneLine: string };

/**
 * LIVE mode: landing -> start -> code step -> reload (same code still works) ->
 * verify -> one-time exchange -> /deals/mine, all with the browser's real cookies.
 * The token only ever appears in the one exchange request; it is returned so the
 * other-device check can reuse the exact link, and it is never printed.
 */
export type LiveUnlockOptions = {
  reloadAtCodeStep?: boolean;
  /** Called with the gate open on the landing, before anything is typed. */
  onLanding?: (page: Page) => Promise<void>;
  /** Called at the code step (after the optional reload), before the code is entered. */
  onCodeStep?: (page: Page) => Promise<void>;
};

export async function unlockThroughLiveGate(page: Page, base: URL, credentials: LiveCredentials, transcript: Transcript, options: LiveUnlockOptions = {}): Promise<LiveUnlock> {
  const starts = countStartRequests(page);
  const landing = await page.goto(new URL("/deals?src=e2e", base).toString(), { waitUntil: "domcontentloaded" });
  transcript.step("GET /deals landing", landing?.status() ?? "no response");
  await page.locator("#deals-phone").waitFor({ state: "visible" });
  await assertMobileGeometry(page, "landing gate");
  if (options.onLanding) await options.onLanding(page);
  await page.locator("#deals-phone").fill(credentials.phone);
  await page.getByRole("button", { name: "No, just me", exact: true }).click();
  const startResponse = page.waitForResponse((response) => isStartCall(response.url(), response.request().method()));
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const start = await startResponse;
  const startBody = await start.json().catch(() => null) as Array<{ result?: { data?: { json?: { ok?: boolean; kind?: string; message?: string } } } }> | null;
  const startJson = startBody?.[trpcProcedures(start.url()).indexOf("deals.start")]?.result?.data?.json;
  transcript.step("POST deals.start", start.status(), startJson?.ok ? "ok" : `${startJson?.kind ?? "error"} ${startJson?.message ?? ""}`.trim());
  assert(startJson?.ok, `deals.start refused the test number: ${startJson?.kind ?? "unknown"} ${startJson?.message ?? ""}`);
  await page.locator("#deals-code").waitFor({ state: "visible" });
  const displayedPhoneLine = (await page.getByText(/We sent a code to/).textContent()) ?? "";
  transcript.step("code step shown", "ok", displayedPhoneLine.replace(/\d/g, "•"));
  if (options.reloadAtCodeStep !== false) {
    const reload = await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#deals-code").waitFor({ state: "visible" });
    transcript.step("reload at code step", reload?.status() ?? "no response", `resumed at code step; deals.start calls so far: ${starts.count}`);
    assert.equal(starts.count, 1, "a reload at the code step must not send a second deals.start");
  }
  if (options.onCodeStep) await options.onCodeStep(page);
  await page.locator("#deals-code").fill(credentials.otp);
  const verifyResponse = page.waitForResponse((response) => /\/deals\/verify(?:\?.*)?$/.test(response.url()) && response.request().method() === "POST");
  const exchangeResponse = page.waitForResponse((response) => /\/deals\/v\/[A-Za-z0-9_-]{32,}$/.test(response.url()));
  const mineResponse = page.waitForResponse((response) => response.request().resourceType() === "document" && new URL(response.url()).pathname === "/deals/mine");
  await page.getByRole("button", { name: "Unlock my list", exact: true }).click();
  const verify = await verifyResponse;
  const location = verify.headers()["location"] ?? "";
  const token = /^\/deals\/v\/([A-Za-z0-9_-]{32,})$/.exec(location)?.[1] ?? "";
  transcript.step("POST /deals/verify", verify.status(), token ? "302 to the one-time exchange link" : `location ${location || "none"}`);
  assert(verify.status() === 302 && token, `/deals/verify did not issue a one-time link (status ${verify.status()}, location ${location || "none"}); check DEALS_TEST_OTP and the test-numbers list`);
  const exchange = await exchangeResponse;
  const exchangeLocation = exchange.headers()["location"] ?? null;
  transcript.step("GET /deals/v/{token} exchange", exchange.status(), `location ${exchangeLocation ?? "none"}`);
  assert.equal(exchange.status(), 302, "the exchange must redirect");
  assert.equal(exchangeLocation, "/deals/mine", "the exchange must land on /deals/mine");
  const mine = await mineResponse;
  await page.waitForURL(/\/deals\/mine$/);
  await page.getByText("Private buyer list", { exact: true }).waitFor();
  transcript.step("GET /deals/mine", mine.status(), `cache-control ${mine.headers()["cache-control"] ?? "none"}; personal list rendered with the session cookie`);
  assert.equal(mine.status(), 200);
  return { token, verifyStatus: verify.status(), exchangeStatus: exchange.status(), exchangeLocation, startRequests: starts.count, displayedPhoneLine };
}

/**
 * Screenshots are committed to the repository, so the tester's own number is
 * masked in the DOM first: the code-step line keeps its shape with bullets and
 * the "Prepared for ••••1234" identity loses its digits. Nothing is sent back.
 */
export async function redactPhoneDigitsForCapture(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const redactions: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    // React renders "We sent a code to " and the number as separate text nodes,
    // so the sentence is checked on the parent element and the digits on the node.
    for (const node of nodes) {
      const value = node.nodeValue ?? "";
      const sentence = node.parentElement?.textContent ?? "";
      if (/\(\d{3}\) \d{3}-\d{4}/.test(value) && /We sent a code to|We call /.test(sentence)) {
        node.nodeValue = value.replace(/\((\d{3})\) \d{3}-(\d{4})/g, "($1) •••-$2");
        redactions.push("code-step phone masked");
      } else if (/••••\d{4}/.test(value) && /Prepared for/.test(sentence)) {
        node.nodeValue = value.replace(/••••\d{4}/g, "••••••••");
        redactions.push("identity last-4 masked");
      }
    }
    // The faint identity pattern carries the same text as an encoded SVG data URI.
    const gated = document.querySelector<HTMLElement>("main[data-deals-gated]");
    if (gated && /(?:%E2%80%A2){4}\d{4}/.test(gated.style.backgroundImage)) {
      gated.style.backgroundImage = gated.style.backgroundImage.replace(/(?:%E2%80%A2){4}\d{4}/g, "%E2%80%A2".repeat(8));
      redactions.push("identity pattern digits masked");
    }
    return Array.from(new Set(redactions));
  });
}
