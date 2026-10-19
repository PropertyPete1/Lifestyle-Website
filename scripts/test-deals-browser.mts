import assert from "node:assert/strict";
import { chromium, type Browser } from "playwright";
import { PHONE_VIEWPORT, PHOTOS_ON_REQUEST, Transcript, assertMobileGeometry, blockThirdParties, browserExecutable, configuredBaseUrl, demoOtp, demoPhone, installDemoFixtures, liveCredentials, unlockThroughLiveGate } from "./deals-browser-fixtures.mts";

/**
 * Browser verification of the Builder Deals visitor funnel at a real 375 px viewport.
 *
 * Exit codes: 0 pass, 1 failure, 2 SKIP (no DEALS_E2E_BASE_URL). With only the
 * base URL set the run uses synthetic fixtures (client behaviour only). With
 * DEALS_TEST_OTP and DEALS_E2E_TEST_PHONE also set it runs LIVE against the
 * deployment: real cookies, real one-time token, real session.
 */

if (!process.env.DEALS_E2E_BASE_URL?.trim()) {
  console.error("SKIP: DEALS_E2E_BASE_URL is not configured for the browser run (exit 2).");
  process.exit(2);
}

const base = configuredBaseUrl();
const credentials = liveCredentials();
const transcript = new Transcript(credentials ? "deals-browser live" : "deals-browser fixture");

async function fixtureRun(browser: Browser) {
  const context = await browser.newContext({ viewport: PHONE_VIEWPORT });
  const state = await installDemoFixtures(context);
  const page = await context.newPage();
  const landing = await page.goto(new URL("/deals?src=fixture", base).toString(), { waitUntil: "domcontentloaded" });
  transcript.step("GET /deals (fixture)", landing?.status() ?? "no response");
  await page.locator("#deals-phone").waitFor({ state: "visible" });
  await assertMobileGeometry(page, "landing gate");
  await page.locator("#deals-phone").fill(demoPhone);
  await page.getByRole("button", { name: "No, just me", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.locator("#deals-code").waitFor({ state: "visible" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#deals-code").waitFor({ state: "visible" });
  assert.equal(state.startRequests, 1, "pending reload must not send a second start request");
  transcript.step("pending reload resumes at the code step", "PASS", "exactly one deals.start");
  await page.locator("#deals-code").fill(demoOtp);
  // The fixture never reaches a runtime Verify endpoint. It asserts the actual
  // form/UI path, then uses the synthetic exchange route so a test run can never
  // create a real session.
  await page.locator("form[action='/deals/verify']").evaluate((form, token) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      window.location.assign(`/deals/v/${token}`);
    }, { once: true });
  }, state.exchangeToken);
  state.authenticated = true;
  await Promise.all([page.waitForURL(/\/deals\/mine/), page.getByRole("button", { name: "Unlock my list", exact: true }).click()]);
  await page.getByText("Private buyer list", { exact: true }).waitFor();
  assert.equal(state.verifyRequests, 0, "fixture must not submit to a runtime verification endpoint");
  await assertMobileGeometry(page, "name prompt and gated catalog");
  transcript.step("fixture OTP form -> exchange -> personal list", "PASS", "375 px viewport, no oversized cards");
  await page.goto(new URL("/deals", base).toString(), { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/deals\/mine/);
  await page.getByText("Private buyer list", { exact: true }).waitFor();
  assert.equal(await page.locator("#deals-phone").count(), 0);
  transcript.step("active session bypasses the gate", "PASS");
  const second = await browser.newContext({ viewport: PHONE_VIEWPORT });
  await installDemoFixtures(second, { sameDevice: false });
  const otherPage = await second.newPage();
  await otherPage.goto(new URL(`/deals/v/${state.exchangeToken}`, base).toString());
  await otherPage.locator("#deals-phone").waitFor({ state: "visible" });
  assert.equal(await otherPage.getByText("Private buyer list", { exact: true }).count(), 0);
  transcript.step("other-device exchange shows the gate, not the list", "PASS");
  await second.close();
  await page.getByRole("button", { name: "Dismiss name prompt" }).click();
  const next = page.getByRole("button", { name: "Next home photo" }).first();
  await next.scrollIntoViewIfNeeded();
  assert((await next.boundingBox())!.x >= 0, "next carousel control must not be clipped off-screen");
  await next.click();
  await assertMobileGeometry(page, "gallery after navigation");
  await page.getByText(PHOTOS_ON_REQUEST, { exact: true }).waitFor();
  await page.getByText(/Approximate area map unavailable/).waitFor();
  assert.equal(await page.locator("[aria-label='Approximate area map'] circle").count(), 1, "missing-coordinate map must not render a fake circle");
  assert.equal(await page.locator("[aria-label='Approximate area map'] img").count(), 1, "the provided map renders one static image");
  transcript.step("gallery controls, To Be Built copy, area map fallback", "PASS");
  const team = await browser.newContext({ viewport: PHONE_VIEWPORT });
  await installDemoFixtures(team, { authenticated: true, team: true });
  const teamPage = await team.newPage();
  await teamPage.goto(new URL("/deals/mine", base).toString());
  await teamPage.getByText("Private buyer list · Team preview", { exact: true }).waitFor();
  assert.equal(await teamPage.getByRole("button", { name: /Tour this home|Ask about this one/ }).count(), 0);
  await assertMobileGeometry(teamPage, "team preview");
  transcript.step("team preview has no buyer request controls", "PASS");
  await team.close();
  await context.close();
  console.log("6 browser UI checks passed. SYNTHETIC API fixtures only; not proof of runtime OTP/session security. No database/settings/CRM writes.");
}

async function liveRun(browser: Browser, otp: string, phone: string) {
  const context = await browser.newContext({ viewport: PHONE_VIEWPORT });
  await blockThirdParties(context);
  const page = await context.newPage();
  const unlock = await unlockThroughLiveGate(page, base, { otp, phone }, transcript);
  await assertMobileGeometry(page, "gated catalog");
  assert.equal(unlock.startRequests, 1, "exactly one deals.start across the landing, the code step and the reload");
  const photos = page.locator("img[src^='/deals/mine/img/']");
  const photoCount = await photos.count();
  if (photoCount) {
    const src = await photos.first().getAttribute("src");
    const image = await page.request.get(new URL(src!, base).toString());
    transcript.step("GET first listing photo with the session", image.status(), image.headers()["content-type"] ?? "");
    assert.equal(image.status(), 200);
    assert.match(image.headers()["content-type"] ?? "", /^image\//);
  } else {
    transcript.step("listing photos", "none", "the catalog served no photos to this session");
  }
  assert.equal(await page.locator("#deals-phone").count(), 0);
  const revisit = await page.goto(new URL("/deals", base).toString(), { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/deals\/mine$/);
  await page.getByText("Private buyer list", { exact: true }).waitFor();
  assert.equal(await page.locator("#deals-phone").count(), 0);
  transcript.step("GET /deals with an active session", revisit?.status() ?? "no response", "redirected to /deals/mine, gate skipped");

  // Other device: a fresh browser context opens the very same one-time link.
  const other = await browser.newContext({ viewport: PHONE_VIEWPORT });
  await blockThirdParties(other);
  const otherPage = await other.newPage();
  const direct = await otherPage.goto(new URL(`/deals/v/${unlock.token}`, base).toString(), { waitUntil: "domcontentloaded" });
  await otherPage.locator("[role='dialog']").waitFor({ state: "visible" });
  const directGate = await otherPage.locator("#deals-phone").count();
  const directCookieCopy = await otherPage.getByText(/blocking cookies/).count();
  assert.equal(await otherPage.getByText("Private buyer list", { exact: true }).count(), 0, "a forwarded link must never show the list");
  assert(directGate === 1 || directCookieCopy === 1, "a fresh device sees the gate (or the cookie probe message), never the list");
  transcript.step("other device opens /deals/v/{token} cold", direct?.status() ?? "no response", directGate ? "gate shown" : "cookie-probe message shown (no probe cookie yet)");
  // The same device after it has loaded the landing once (probe cookie present): the gate, never the list.
  await otherPage.goto(new URL("/deals", base).toString(), { waitUntil: "domcontentloaded" });
  await otherPage.locator("#deals-phone").waitFor({ state: "visible" });
  const warm = await otherPage.goto(new URL(`/deals/v/${unlock.token}`, base).toString(), { waitUntil: "domcontentloaded" });
  await otherPage.locator("#deals-phone").waitFor({ state: "visible" });
  assert.equal(await otherPage.getByText("Private buyer list", { exact: true }).count(), 0);
  assert.doesNotMatch(otherPage.url(), /\/deals\/mine/);
  transcript.step("other device opens /deals/v/{token} with the probe cookie", warm?.status() ?? "no response", `gate shown at ${new URL(otherPage.url()).pathname}`);
  await other.close();

  // The original device still holds its session; the consumed link just returns it to the list.
  const again = await page.goto(new URL(`/deals/v/${unlock.token}`, base).toString(), { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/deals\/mine$/);
  await page.getByText("Private buyer list", { exact: true }).waitFor();
  transcript.step("same device reopens the consumed link", again?.status() ?? "no response", "redirected to /deals/mine without a gate or a new code");
  await context.close();
  console.log("Live browser checks passed against the configured deployment: landing, start, code step, reload (one start call), verify, token exchange, /deals/mine with real cookies, other-device rejection, active-session gate skip.");
}

const browser = await chromium.launch({ executablePath: browserExecutable(), headless: true, args: ["--no-sandbox"] });
try {
  if (credentials) await liveRun(browser, credentials.otp, credentials.phone);
  else {
    console.log("Fixture mode: set DEALS_TEST_OTP and DEALS_E2E_TEST_PHONE as well to run against the live gate.");
    await fixtureRun(browser);
  }
  transcript.print();
} catch (error) {
  transcript.print();
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
