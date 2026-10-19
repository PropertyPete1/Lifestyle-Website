import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { PHONE_VIEWPORT, PHOTOS_ON_REQUEST, Transcript, assertMobileGeometry, blockThirdParties, browserExecutable, configuredBaseUrl, demoOtp, demoPhone, installDemoFixtures, liveCredentials, redactPhoneDigitsForCapture, unlockThroughLiveGate } from "./deals-browser-fixtures.mts";

/**
 * Mobile screenshots for the handover (spec: landing with the gate open, SMS
 * code step, gated page, name prompt, expired page, blocked page) plus the
 * To Be Built card, the area map, one home gallery frame and, when
 * DEALS_E2E_ADMIN_COOKIE is set, one admin tab frame.
 *
 * Every capture is the real 375 x 812 viewport, never a full-page image, so an
 * overflowing layout cannot hide behind a stretched screenshot. Phone digits
 * are masked in the DOM before each capture (the files are committed). Fixture
 * mode draws synthetic data; live mode (DEALS_TEST_OTP + DEALS_E2E_TEST_PHONE)
 * uses the deployment's real gate and catalog.
 */

const base = configuredBaseUrl();
const credentials = liveCredentials();
const out = path.resolve(process.env.DEALS_CAPTURE_OUT_DIR || "docs/preview");
await fs.mkdir(out, { recursive: true });
const transcript = new Transcript(credentials ? "deals-capture live" : "deals-capture fixture");
type Capture = { file: string; viewport: typeof PHONE_VIEWPORT; scrollWidth: number; width: number; height: number; redactions: string[]; note?: string };
/** Upper bound for one protected image render through the live session; the first request also warms the server cache. */
const GALLERY_TIMEOUT_MS = 45_000;
const captures: Capture[] = [];
const skipped: Array<{ file: string; reason: string }> = [];

/** Upper bound for the images in a frame to finish loading before it is taken. */
const SETTLE_TIMEOUT_MS = 20_000;

async function settle(page: Page, label: string) {
  // Images in view must have finished loading; the frame itself is what gets
  // reviewed. Only images the browser will fetch on its own are awaited: a lazy
  // image outside the viewport in either axis (the hidden slides of a carousel
  // sit beside the visible one) never starts loading, so a wait on it would
  // never end. The wait is bounded either way and a timeout is recorded.
  // No named function bindings inside the page callback: tsx (esbuild keepNames)
  // wraps those in a __name() helper that does not exist in the browser.
  const stillLoading = await page.evaluate((timeoutMs: number) => {
    const waiting = Array.from(document.images).filter((image) => {
      if (image.complete) return false;
      if (image.loading !== "lazy") return true;
      const box = image.getBoundingClientRect();
      return box.bottom > 0 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth;
    });
    const loaded = Promise.all(waiting.map((image) => new Promise<void>((resolve) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => resolve(), { once: true });
    }))).then(() => 0);
    const expired = new Promise<number>((resolve) => setTimeout(() => resolve(waiting.filter((image) => !image.complete).length), timeoutMs));
    return Promise.race([loaded, expired]);
  }, SETTLE_TIMEOUT_MS);
  if (stillLoading) transcript.step(`settle ${label}`, "timeout", `${stillLoading} image(s) still loading after ${SETTLE_TIMEOUT_MS} ms`);
  await page.waitForTimeout(250);
}

async function capture(page: Page, filename: string, note?: string) {
  const redactions = await redactPhoneDigitsForCapture(page);
  await settle(page, filename);
  const geometry = await assertMobileGeometry(page, filename);
  const target = path.join(out, filename);
  await page.screenshot({ path: target, fullPage: false, animations: "disabled" });
  const metadata = await sharp(target).metadata();
  if (metadata.width !== PHONE_VIEWPORT.width || metadata.height !== PHONE_VIEWPORT.height) throw new Error(`Invalid viewport capture: ${filename} is ${metadata.width}x${metadata.height}`);
  captures.push({ file: filename, viewport: PHONE_VIEWPORT, scrollWidth: geometry.scrollWidth, width: metadata.width, height: metadata.height, redactions, ...(note ? { note } : {}) });
  transcript.step(`capture ${filename}`, "ok", `${metadata.width}x${metadata.height}${redactions.length ? `, redacted: ${redactions.join(", ")}` : ""}`);
}

async function newContext(browser: Browser, fixtures: boolean): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: PHONE_VIEWPORT, deviceScaleFactor: 1 });
  if (fixtures) await installDemoFixtures(context);
  else await blockThirdParties(context);
  return context;
}

async function captureGatedStates(page: Page) {
  await page.getByText("Add your name so we know who to text.").waitFor();
  await capture(page, "builder-deals-name-prompt-375.png");
  await page.getByRole("button", { name: "Dismiss name prompt" }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, "builder-deals-gated-catalog-375.png");
  const gallery = page.locator("img[src^='/deals/mine/img/']").first();
  if (await gallery.count()) {
    // Live mode requests the first protected image through the session before
    // the frame: its status, time and size are evidence, and a slow or failing
    // render is reported instead of waited on without limit. (Fixture mode
    // serves that route from the page's route handlers, which a direct request
    // would bypass, so it only watches the element.)
    const src = (await gallery.getAttribute("src")) ?? "";
    const started = Date.now();
    const probe = credentials ? await page.request.get(new URL(src, base).toString(), { timeout: GALLERY_TIMEOUT_MS }).then(
      async (response) => ({ ok: response.ok(), status: response.status(), type: response.headers()["content-type"] ?? "", bytes: (await response.body()).length, error: "" }),
      (error: unknown) => ({ ok: false, status: 0, type: "", bytes: 0, error: error instanceof Error ? error.message : String(error) }),
    ) : null;
    const elapsed = Date.now() - started;
    if (probe) transcript.step("GET first protected gallery image", probe.status || "no response", `${elapsed} ms${probe.type ? `, ${probe.type}` : ""}${probe.bytes ? `, ${probe.bytes} bytes` : ""}${probe.error ? `, ${probe.error}` : ""}`);
    await gallery.scrollIntoViewIfNeeded();
    const state = await gallery.evaluate((image: HTMLImageElement, timeoutMs: number) => image.complete && image.naturalWidth > 0 ? "loaded" : new Promise<string>((resolve) => {
      image.addEventListener("load", () => resolve("loaded"), { once: true });
      image.addEventListener("error", () => resolve("error"), { once: true });
      setTimeout(() => resolve("timeout"), timeoutMs);
    }), GALLERY_TIMEOUT_MS);
    await page.evaluate(() => window.scrollBy(0, -72));
    if (state === "loaded") {
      await capture(page, "builder-deals-home-gallery-375.png", `one gallery frame with the per-lead watermark burned into the image bytes${probe ? ` (first image ${probe.status} in ${elapsed} ms)` : ""}`);
    } else {
      const reason = `the first protected image did not render in the page (${state}${probe ? `; direct request ${probe.status || "failed"} after ${elapsed} ms` : ""})`;
      skipped.push({ file: "builder-deals-home-gallery-375.png", reason });
      transcript.step("capture builder-deals-home-gallery-375.png", "skipped", reason);
      // A listed photo that the protected route cannot serve is a defect, not a skip.
      if (probe && !probe.ok) process.exitCode = 1;
    }
  } else {
    skipped.push({ file: "builder-deals-home-gallery-375.png", reason: "the catalog served no processed photos to this session" });
    transcript.step("capture builder-deals-home-gallery-375.png", "skipped", "no photos served");
  }
  const toBeBuilt = page.getByText("To Be Built", { exact: true }).first();
  if (await toBeBuilt.count()) {
    await toBeBuilt.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -40));
    await capture(page, "builder-deals-to-be-built-375.png", `To Be Built card; a photo-less card reads "${PHOTOS_ON_REQUEST}"`);
  } else {
    skipped.push({ file: "builder-deals-to-be-built-375.png", reason: "every active community currently has quick move-in homes, so no To Be Built card is shown" });
    transcript.step("capture builder-deals-to-be-built-375.png", "skipped", "no To Be Built card in this catalog");
  }
  const map = page.locator("[aria-label='Approximate area map']").first();
  await map.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -24));
  await capture(page, "builder-deals-area-map-375.png", "static ZIP-centroid map with the shaded circle and drive-time chips, or the fail-closed fallback");
}

async function fixtureCaptures(browser: Browser) {
  const context = await newContext(browser, true);
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
  await captureGatedStates(page);
  await context.close();
}

async function liveCaptures(browser: Browser, otp: string, phone: string) {
  const context = await newContext(browser, false);
  const page = await context.newPage();
  // The real gate is walked once; the landing and code-step frames are taken on the way.
  await unlockThroughLiveGate(page, base, { otp, phone }, transcript, {
    reloadAtCodeStep: false,
    onLanding: (current) => capture(current, "builder-deals-landing-gate-375.png"),
    onCodeStep: (current) => capture(current, "builder-deals-code-step-375.png", "the typed number is masked in the committed frame"),
  });
  await captureGatedStates(page);
  await context.close();
}

async function outcomePages(browser: Browser) {
  for (const [query, visible, filename] of [["expired=1", "This link expired.", "builder-deals-expired-375.png"], ["gate=1&blocked=1", "Buyer access only", "builder-deals-blocked-375.png"]] as const) {
    const fresh = await newContext(browser, !credentials);
    const page = await fresh.newPage();
    await page.goto(new URL(`/deals?${query}`, base).toString());
    await page.getByText(visible, { exact: true }).waitFor();
    if (query.includes("blocked")) await page.getByText(/Made a mistake\?/).waitFor();
    await capture(page, filename);
    await fresh.close();
  }
}

async function adminCapture(browser: Browser) {
  const cookie = process.env.DEALS_E2E_ADMIN_COOKIE?.trim();
  if (!cookie) {
    skipped.push({ file: "builder-deals-admin-tab-375.png", reason: "DEALS_E2E_ADMIN_COOKIE not set" });
    transcript.step("capture builder-deals-admin-tab-375.png", "skipped", "DEALS_E2E_ADMIN_COOKIE not set");
    return;
  }
  const separator = cookie.indexOf("=");
  if (separator < 1) throw new Error("DEALS_E2E_ADMIN_COOKIE must be name=value");
  const context = await browser.newContext({ viewport: PHONE_VIEWPORT, deviceScaleFactor: 1 });
  await blockThirdParties(context);
  await context.addCookies([{ name: cookie.slice(0, separator), value: cookie.slice(separator + 1), url: base.origin, httpOnly: true, secure: base.protocol === "https:", sameSite: "Lax" }]);
  const page = await context.newPage();
  await page.goto(new URL("/admin/deals", base).toString(), { waitUntil: "domcontentloaded" });
  await page.getByText(/Builder Deals/i).first().waitFor({ timeout: 30_000 });
  await capture(page, "builder-deals-admin-tab-375.png", "admin Builder Deals tab at phone width, signed in with the provided cookie");
  await context.close();
}

function gitCommit(): string | null {
  try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); } catch { return null; }
}

/** The whole run must finish in this time; a stall writes the partial evidence and fails instead of waiting. */
const WATCHDOG_MS = 8 * 60_000;
const watchdog = setTimeout(() => {
  transcript.print();
  const partial = { mode: "incomplete", capturedAt: new Date().toISOString(), commit: gitCommit(), note: `capture watchdog fired after ${WATCHDOG_MS} ms; frames below were taken before the stall`, captures, skipped };
  try { writeFileSync(path.join(out, "capture-manifest.partial.json"), `${JSON.stringify(partial, null, 2)}\n`); } catch { /* the transcript above is the record */ }
  console.error(`FAIL: capture watchdog fired after ${WATCHDOG_MS} ms (last step: ${transcript.entries.at(-1)?.step ?? "none"})`);
  process.exit(1);
}, WATCHDOG_MS);
const browser = await chromium.launch({ executablePath: browserExecutable(), headless: true, args: ["--no-sandbox"] });
try {
  if (credentials) await liveCaptures(browser, credentials.otp, credentials.phone);
  else await fixtureCaptures(browser);
  await outcomePages(browser);
  await adminCapture(browser);
  const manifest = {
    mode: credentials ? "live-deployment" : "synthetic-ui-only",
    capturedAt: new Date().toISOString(),
    commit: gitCommit(),
    target: credentials ? base.origin : "fixture routes on the configured frontend host",
    viewport: PHONE_VIEWPORT,
    fullPage: false,
    note: credentials
      ? "Real gate, real session cookies and the deployment's catalog; the tester's phone digits are masked in the DOM before each frame. No admin, FUB or settings writes."
      : "No real buyer data, real builder photo, live map, runtime OTP, or database mutations. Map/photo fixtures are illustrative, not live processing evidence.",
    captures,
    skipped,
  };
  await fs.writeFile(path.join(out, "capture-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  transcript.print();
  console.log(`Captured ${captures.length} frames at exactly ${PHONE_VIEWPORT.width}x${PHONE_VIEWPORT.height} into ${out}${skipped.length ? `; skipped: ${skipped.map((entry) => entry.file).join(", ")}` : ""}.`);
} catch (error) {
  transcript.print();
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  await browser.close();
}
