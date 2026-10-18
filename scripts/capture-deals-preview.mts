import fs from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";
import { chromium } from "playwright";

const base = process.env.DEALS_E2E_BASE_URL || "https://3000-ikqecsvrip83yuk510r73-be8e0622.us1.manus.computer";
const out = path.resolve("docs/preview"); await fs.mkdir(out, { recursive: true });
const db = await mysql.createConnection(process.env.DATABASE_URL!);
const [rows] = await db.query<any[]>("SELECT value FROM deal_settings WHERE `key`='builder_deals'");
const settings = JSON.parse(rows[0].value); const original = rows[0].value;
settings.skipTwilioForTestNumbers = true; settings.testModeFullPipeline = false;
await db.query("UPDATE deal_settings SET value=? WHERE `key`='builder_deals'", [JSON.stringify(settings)]);
const phone = settings.testNumbers[0]; const otp = process.env.DEALS_TEST_OTP?.trim();
if (!phone || !otp) throw new Error("Configured preview test phone and OTP required");
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } }); const page = await context.newPage();
  await page.goto(`${base}/deals?src=sl1`, { waitUntil: "networkidle" }); await page.screenshot({ path: path.join(out, "builder-deals-landing-gate-375.png"), fullPage: true });
  await page.locator("#deals-phone").fill(phone); await page.getByRole("button", { name: "No, just me" }).click(); await page.getByRole("button", { name: /continue/i }).click(); await page.locator("#deals-code").waitFor(); await page.screenshot({ path: path.join(out, "builder-deals-code-step-375.png"), fullPage: true });
  await page.locator("#deals-code").fill(otp); await Promise.all([page.waitForURL(/\/deals\/mine/), page.getByRole("button", { name: /unlock my list/i }).click()]); await page.waitForTimeout(750); await page.screenshot({ path: path.join(out, "builder-deals-name-prompt-375.png"), fullPage: true });
  const dismiss = page.getByRole("button", { name: "Dismiss name prompt" }); if (await dismiss.count()) await dismiss.click(); await page.waitForTimeout(300); await page.screenshot({ path: path.join(out, "builder-deals-gated-catalog-375.png"), fullPage: true });
  const gallery = page.locator("img[src^='/deals/mine/img/']").first(); if (await gallery.count()) { await gallery.scrollIntoViewIfNeeded(); await gallery.screenshot({ path: path.join(out, "builder-deals-home-gallery-375.png") }); }
  await context.close();
  const expired = await browser.newContext({ viewport: { width: 375, height: 812 } }); const expiredPage = await expired.newPage(); await expiredPage.goto(`${base}/deals?expired=1`, { waitUntil: "networkidle" }); await expiredPage.screenshot({ path: path.join(out, "builder-deals-expired-375.png"), fullPage: true }); await expired.close();
  const blocked = await browser.newContext({ viewport: { width: 375, height: 812 } }); const blockedPage = await blocked.newPage(); await blockedPage.goto(`${base}/deals?src=sl1`, { waitUntil: "networkidle" }); await blockedPage.locator("#deals-phone").fill(phone); await blockedPage.getByRole("button", { name: "Yes" }).click(); await blockedPage.getByRole("button", { name: /continue/i }).click(); await blockedPage.getByRole("button", { name: /yes, that's right/i }).click(); await blockedPage.waitForTimeout(400); await blockedPage.screenshot({ path: path.join(out, "builder-deals-blocked-375.png"), fullPage: true }); await blocked.close();
  console.log("Captured landing, code, name prompt, gated catalog, gallery, expired, and blocked states.");
} finally { await browser.close(); await db.query("UPDATE deal_settings SET value=? WHERE `key`='builder_deals'", [original]); await db.query("DELETE FROM deal_blocklist WHERE reason='Confirmed working with an agent' AND phone_e164=?", [phone]); await db.end(); }
