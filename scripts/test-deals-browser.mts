import assert from "node:assert/strict";
import { chromium } from "playwright";
import { assertMobileGeometry, browserExecutable, configuredBaseUrl, demoOtp, demoPhone, installDemoFixtures } from "./deals-browser-fixtures.mts";

const base = configuredBaseUrl();
const browser = await chromium.launch({ executablePath: browserExecutable(), headless: true, args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const state = await installDemoFixtures(context);
  const page = await context.newPage();
  await page.goto(new URL("/deals?src=fixture", base).toString(), { waitUntil: "domcontentloaded" });
  await page.locator("#deals-phone").waitFor({ state: "visible" });
  await assertMobileGeometry(page, "landing gate");
  await page.locator("#deals-phone").fill(demoPhone);
  await page.getByRole("button", { name: "No, just me", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.locator("#deals-code").waitFor({ state: "visible" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#deals-code").waitFor({ state: "visible" });
  assert.equal(state.startRequests, 1, "pending reload must not send a second start request");
  console.log("PASS UI: pending reload resumes code step; exactly one start request.");
  await page.locator("#deals-code").fill(demoOtp);
  // The browser test deliberately does not reach a runtime Verify endpoint.
  // It asserts the actual form/UI path, then uses the synthetic exchange route
  // supplied by this fixture so a test run can never create a real session.
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
  console.log("PASS UI: fixture OTP form → exchange → personal list, 375px viewport and no oversized cards.");
  await page.goto(new URL("/deals", base).toString(), { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/deals\/mine/);
  await page.getByText("Private buyer list", { exact: true }).waitFor();
  assert.equal(await page.locator("#deals-phone").count(), 0);
  console.log("PASS UI: active session bypasses gate.");
  const second = await browser.newContext({ viewport: { width: 375, height: 812 } });
  await installDemoFixtures(second, { sameDevice: false });
  const otherPage = await second.newPage();
  await otherPage.goto(new URL(`/deals/v/${state.exchangeToken}`, base).toString());
  await otherPage.locator("#deals-phone").waitFor({ state: "visible" });
  assert.equal(await otherPage.getByText("Private buyer list", { exact: true }).count(), 0);
  console.log("PASS UI: other-device exchange rejection returns gate, not personal list.");
  await page.getByRole("button", { name: "Dismiss name prompt" }).click();
  const carousel = page.getByRole("region", { name: "" }).filter({ has: page.getByRole("button", { name: "Next home photo" }) }).first();
  const next = page.getByRole("button", { name: "Next home photo" }).first();
  await next.scrollIntoViewIfNeeded();
  assert((await next.boundingBox())!.x >= 0, "next carousel control must not be clipped off-screen");
  await next.click();
  await assertMobileGeometry(page, "gallery after navigation");
  await page.getByText("Photos on request — ask us for the latest gallery.", { exact: true }).waitFor();
  await page.getByText(/Approximate area map unavailable/).waitFor();
  assert.equal(await page.locator("[aria-label='Approximate area map'] circle").count(), 1, "missing-coordinate map must not render a fake circle");
  console.log("PASS UI: gallery controls stay in card; missing map fails closed; To Be Built photo-request copy.");
  const team = await browser.newContext({ viewport: { width: 375, height: 812 } });
  await installDemoFixtures(team, { authenticated: true, team: true });
  const teamPage = await team.newPage();
  await teamPage.goto(new URL("/deals/mine", base).toString());
  await teamPage.getByText("Private buyer list · Team preview", { exact: true }).waitFor();
  assert.equal(await teamPage.getByRole("button", { name: /Tour this home|Ask about this one/ }).count(), 0);
  await assertMobileGeometry(teamPage, "team preview");
  console.log("PASS UI: team preview has no buyer request controls.");
  console.log("6 browser UI checks passed. SYNTHETIC API fixtures only; not proof of runtime OTP/session security. No database/settings/CRM writes.");
} finally {
  await browser.close();
}
