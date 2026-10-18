import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { chromium } from "playwright";

const base = process.env.DEALS_E2E_BASE_URL || "https://3000-ikqecsvrip83yuk510r73-be8e0622.us1.manus.computer";
const otp = process.env.DEALS_TEST_OTP;
if (!otp) throw new Error("DEALS_TEST_OTP must be configured for this protected regression test");
const db = await mysql.createConnection(process.env.DATABASE_URL!);
const [rows] = await db.query<any[]>("SELECT value FROM deal_settings WHERE `key`='builder_deals'");
const settings = JSON.parse(rows[0]?.value || "{}");
if (!settings.testNumbers?.[0]) throw new Error("A normalized test number is required for this preview-only browser test");
const originalSettings = JSON.stringify(settings);
// The saved admin setting remains intact. Only this isolated browser test gets
// a local test-code transport because preview runtime credentials are absent.
settings.skipTwilioForTestNumbers = true;
await db.query("UPDATE deal_settings SET value=? WHERE `key`='builder_deals'", [JSON.stringify(settings)]);
await db.end();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
const page = await context.newPage();
let startRequests = 0;
page.on("response", (response) => {
  if (response.url().includes("deals.start")) {
    startRequests += 1;
    const names = (response.headers()["set-cookie"] || "").split(/, (?=[A-Za-z_]+=)/).map((value) => value.split("=")[0]).filter(Boolean);
    console.log(`start-set-cookie:${names.join(",") || "none"}`);
  }
});
try {
  await page.goto(`${base}/deals?src=e2e`, { waitUntil: "networkidle" });
  await expectVisible(page, "#deals-phone");
  await page.locator("#deals-phone").fill(settings.testNumbers[0]);
  await page.getByRole("button", { name: "No, just me" }).click();
  const startResponse = page.waitForResponse((response) => response.url().includes("deals.start"));
  await page.getByRole("button", { name: /continue/i }).click();
  const startBody = await (await startResponse).text();
  console.log(`start-response:${startBody.includes('"ok":true') ? "ok" : "not-ok"}`);
  await expectVisible(page, "#deals-code");
  assert((await context.cookies(base)).some((cookie) => cookie.name === "ldr_deals_pending" && cookie.path === "/"), "pending cookie must be sent to the verification form");
  await page.reload({ waitUntil: "networkidle" });
  await expectVisible(page, "#deals-code");
  assert.equal(startRequests, 1, "reloading a pending code step must not send another verification code");
  console.log("PASS Pending verification reload resumes at code step without a second send.");
  await page.locator("#deals-code").fill(otp);
  await page.waitForTimeout(250);
  assert.equal(await page.locator("#deals-code").inputValue(), otp.trim(), "the controlled verification input must retain the test code");
  await Promise.all([page.waitForURL(/\/deals\/mine/), page.getByRole("button", { name: /unlock my list/i }).click()]);
  await expectVisible(page, "text=Private buyer list");
  const cookies = await context.cookies(base);
  assert(cookies.some((cookie) => cookie.name === "ldr_deals_session" && cookie.path === "/"), "session cookie must be available to /api/trpc");
  console.log("PASS Browser funnel: landing → gate → test OTP → token exchange → gated list; root session cookie present.");
} finally {
  await browser.close();
  const restore = await mysql.createConnection(process.env.DATABASE_URL!);
  await restore.query("UPDATE deal_settings SET value=? WHERE `key`='builder_deals'", [originalSettings]);
  await restore.end();
}

async function expectVisible(page: import("playwright").Page, selector: string) {
  await page.locator(selector).first().waitFor({ state: "visible", timeout: 15_000 });
}
