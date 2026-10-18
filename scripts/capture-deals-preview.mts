import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { chromium, type Page } from "playwright";
import { assertMobileGeometry, browserExecutable, configuredBaseUrl, demoOtp, demoPhone, installDemoFixtures } from "./deals-browser-fixtures.mts";

const base = configuredBaseUrl();
const out = path.resolve(process.env.DEALS_CAPTURE_OUT_DIR || "docs/preview");
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: browserExecutable(), headless: true, args: ["--no-sandbox"] });
const captures: Array<{ file: string; viewport: number; scrollWidth: number; width: number; height: number; synthetic: true }> = [];
async function capture(page: Page, filename: string) {
  const geometry = await assertMobileGeometry(page, filename);
  await page.screenshot({ path: path.join(out, filename), fullPage: false, animations: "disabled" });
  const metadata = await sharp(path.join(out, filename)).metadata();
  if (metadata.width !== 375 || metadata.height !== 812) throw new Error(`Invalid viewport capture: ${filename}`);
  captures.push({ file: filename, viewport: geometry.viewport, scrollWidth: geometry.scrollWidth, width: metadata.width, height: metadata.height, synthetic: true });
}
try {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  await installDemoFixtures(context);
  const page = await context.newPage();
  await page.goto(new URL("/deals?src=fixture", base).toString());
  await page.locator("#deals-phone").waitFor();
  await capture(page, "builder-deals-landing-gate-375.png");
  await page.locator("#deals-phone").fill(demoPhone);
  await page.getByRole("button", { name: "No, just me", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.locator("#deals-code").waitFor();
  await capture(page, "builder-deals-code-step-375.png");
  await page.locator("#deals-code").fill(demoOtp);
  await Promise.all([page.waitForURL(/\/deals\/mine/), page.getByRole("button", { name: "Unlock my list", exact: true }).click()]);
  await page.getByText("Private buyer list", { exact: true }).waitFor();
  await capture(page, "builder-deals-name-prompt-375.png");
  await page.getByRole("button", { name: "Dismiss name prompt" }).click();
  await capture(page, "builder-deals-gated-catalog-375.png");
  await page.locator("article img").first().scrollIntoViewIfNeeded();
  await capture(page, "builder-deals-home-gallery-375.png");
  await page.getByText("Photos on request — ask us for the latest gallery.", { exact: true }).scrollIntoViewIfNeeded();
  await capture(page, "builder-deals-to-be-built-375.png");
  await page.locator("[aria-label='Approximate area map']").first().scrollIntoViewIfNeeded();
  await capture(page, "builder-deals-area-map-375.png");
  for (const [query, visible, filename] of [["expired=1", "This link expired.", "builder-deals-expired-375.png"], ["blocked=1", "Buyer access only", "builder-deals-blocked-375.png"]]) {
    const fresh = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await installDemoFixtures(fresh);
    const freshPage = await fresh.newPage();
    await freshPage.goto(new URL(`/deals?${query}`, base).toString());
    await freshPage.getByText(visible, { exact: true }).waitFor();
    if (query === "blocked=1") await freshPage.getByText(/Made a mistake\?/).waitFor();
    await capture(freshPage, filename);
    await fresh.close();
  }
  await fs.writeFile(path.join(out, "capture-manifest.json"), JSON.stringify({ mode: "synthetic-ui-only", note: "No real buyer data, real builder photo, live map, runtime OTP, or database mutations. Map/photo fixtures are illustrative, not live processing evidence.", captures }, null, 2) + "\n");
  console.log(`Captured ${captures.length} synthetic states, each exactly 375×812. No full-page captures; no private data or cleanup required.`);
} finally {
  await browser.close();
}
