import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { chromium } from "playwright";

const missingSecrets = ["DEALS_TEST_OTP", "DATABASE_URL"].filter((name) => !process.env[name]?.trim());
if (missingSecrets.length) {
  console.warn(`SKIP Builder Deals preview capture: missing required secret${missingSecrets.length === 1 ? "" : "s"} ${missingSecrets.join(", ")}.`);
  process.exit(0);
}
const base = configuredUrl("DEALS_E2E_BASE_URL");
const databaseUrl = process.env.DATABASE_URL!.trim();
const otp = process.env.DEALS_TEST_OTP!.trim();
const out = path.resolve("docs/preview"); await fs.mkdir(out, { recursive: true });
const db = await mysql.createConnection(databaseUrl);
const [rows] = await db.query<any[]>("SELECT value FROM deal_settings WHERE `key`='builder_deals'");
if (!rows[0]?.value) throw new Error("Builder Deals settings are required for preview capture");
const settings = JSON.parse(rows[0].value); const original = rows[0].value;
const phone = settings.testNumbers[0];
if (!phone) throw new Error("A configured Builder Deals test number is required for preview capture");
settings.skipTwilioForTestNumbers = true; settings.testModeFullPipeline = false;
await db.query("UPDATE deal_settings SET value=? WHERE `key`='builder_deals'", [JSON.stringify(settings)]);
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } }); const page = await context.newPage();
  await page.goto(new URL("/deals?src=sl1", base).toString(), { waitUntil: "networkidle" }); await page.locator("#deals-phone").waitFor(); await page.screenshot({ path: path.join(out, "builder-deals-landing-gate-375.png"), fullPage: true });
  await page.locator("#deals-phone").fill(phone); await page.getByRole("button", { name: "No, just me" }).click(); await page.getByRole("button", { name: /continue/i }).click(); await page.locator("#deals-code").waitFor(); await page.screenshot({ path: path.join(out, "builder-deals-code-step-375.png"), fullPage: true });
  await page.locator("#deals-code").fill(otp); await Promise.all([page.waitForURL(/\/deals\/mine/), page.getByRole("button", { name: /unlock my list/i }).click()]); await page.waitForTimeout(750); await page.screenshot({ path: path.join(out, "builder-deals-name-prompt-375.png"), fullPage: true });
  const dismiss = page.getByRole("button", { name: "Dismiss name prompt" }); if (await dismiss.count()) await dismiss.click(); await page.waitForTimeout(300); await page.screenshot({ path: path.join(out, "builder-deals-gated-catalog-375.png"), fullPage: true });
  const gallery = page.locator("img[src^='/deals/mine/img/']").first();
  if (!await gallery.count()) throw new Error("Expected at least one protected Builder Deals gallery image in the gated catalog");
  assert.match(await gallery.getAttribute("src") ?? "", /^\/deals\/mine\/img\/\d+$/, "gallery must use a protected, same-origin image route");
  await gallery.scrollIntoViewIfNeeded(); await gallery.screenshot({ path: path.join(out, "builder-deals-home-gallery-375.png") });
  await context.close();
  const expired = await browser.newContext({ viewport: { width: 375, height: 812 } }); const expiredPage = await expired.newPage(); await expiredPage.goto(new URL("/deals?expired=1", base).toString(), { waitUntil: "networkidle" }); await expiredPage.getByText("This link expired.").waitFor(); await expiredPage.screenshot({ path: path.join(out, "builder-deals-expired-375.png"), fullPage: true }); await expired.close();
  const blocked = await browser.newContext({ viewport: { width: 375, height: 812 } }); const blockedPage = await blocked.newPage(); await blockedPage.goto(new URL("/deals?src=sl1", base).toString(), { waitUntil: "networkidle" }); await blockedPage.locator("#deals-phone").fill(phone); await blockedPage.getByRole("button", { name: "Yes" }).click(); await blockedPage.getByRole("button", { name: /continue/i }).click(); await blockedPage.getByRole("button", { name: /yes, that's right/i }).click(); await blockedPage.getByText("Buyer access only").waitFor(); await blockedPage.screenshot({ path: path.join(out, "builder-deals-blocked-375.png"), fullPage: true }); await blocked.close();
  console.log("Captured landing, code, name prompt, gated catalog, gallery, expired, and blocked states.");
} finally { await browser?.close(); await db.query("UPDATE deal_settings SET value=? WHERE `key`='builder_deals'", [original]); await db.query("DELETE FROM deal_blocklist WHERE reason='Confirmed working with an agent' AND (phone_e164=? OR search_phone=?)", [phone, phone]); await db.end(); }

function configuredUrl(name: string): URL {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required; no external preview URL is hardcoded.`);
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("must use HTTP(S)");
    return url;
  } catch (error) {
    throw new Error(`${name} is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}
