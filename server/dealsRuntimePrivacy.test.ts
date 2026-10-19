import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEALS_PRIVATE_FIELDS, dealScrubTerms, emptyDealScrubConfig, hasPrivateTerm, mergeDealScrubConfig, parseDealScrubConfig, type DealScrubConfig } from "../shared/deals";
import { LAUNCH_DEALS, builderScrubConfig } from "./dealsSync";
import { DEFAULT_LAUNCH_WATERMARK_REGION, closeDealPhotoOcrWorker, findDealPhotoHideMatches, findExactOcrMatches, makeDealPhotoMaster, normalizeDealPhotoOriginal, recognizeDealPhotoWords, type OcrWord } from "./dealsPhotos";

/**
 * F1: the privacy boundary of a RUNNING Builder Deals deployment.
 *
 * With DEALS_E2E_BASE_URL set this file creates a real session through the live
 * gate (test number + DEALS_TEST_OTP), then asserts that the public landing, the
 * gated JSON, the built client bundle and every served photo (decoded with sharp
 * and read with tesseract.js) carry none of the private terms. An unreachable
 * base URL or a missing test credential FAILS the run; only an unset base URL
 * skips it, with the reason printed. The offline fixtures at the bottom always
 * run.
 *
 * Side effects on the target: one verification for the configured test number
 * (no SMS while "Skip Twilio for test numbers" is on, otherwise a real text to
 * that test phone), one lead row for it and its funnel/view events. No admin or
 * FUB writes (test numbers stay out of FUB unless "full pipeline" is on).
 */

const REQUEST_TIMEOUT_MS = 10_000;
const OCR_TRAINED_DATA = path.join(process.cwd(), "server", "ocr", "eng.traineddata");

type Captured = { url: string; status: number; headers: Headers; body: Buffer };

/**
 * Minimal path-aware cookie jar: Node fetch has none, the gate is cookie-bound
 * by design, and the server retires legacy /deals-scoped copies of each cookie
 * next to the root-scoped value it sets.
 */
class CookieJar {
  private readonly values = new Map<string, { name: string; path: string; value: string }>();
  absorb(response: Response) {
    for (const header of response.headers.getSetCookie()) {
      const [pair, ...attributes] = header.split(";").map((part) => part.trim());
      const separator = pair.indexOf("=");
      if (separator < 1) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const path = attributes.find((attribute) => /^path=/i.test(attribute))?.slice(5) || "/";
      const maxAge = attributes.find((attribute) => /^max-age=/i.test(attribute))?.slice(8);
      const expires = attributes.find((attribute) => /^expires=/i.test(attribute))?.slice(8);
      const expired = (maxAge !== undefined && Number(maxAge) <= 0) || (expires !== undefined && new Date(expires).getTime() < Date.now());
      const key = `${name}@${path}`;
      if (expired || value === "") this.values.delete(key);
      else this.values.set(key, { name, path, value });
    }
  }
  header(requestPath: string): string {
    return Array.from(this.values.values())
      .filter((cookie) => requestPath === cookie.path || requestPath.startsWith(cookie.path.endsWith("/") ? cookie.path : `${cookie.path}/`))
      .map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  }
  has(name: string) { return Array.from(this.values.values()).some((cookie) => cookie.name === name); }
}

function configuredBaseUrl(): URL | undefined {
  const value = process.env.DEALS_E2E_BASE_URL?.trim();
  if (!value) {
    console.warn("[deals runtime privacy] SKIP: DEALS_E2E_BASE_URL is not set; the live privacy boundary was not checked. Set it (plus DEALS_TEST_OTP and DEALS_E2E_TEST_PHONE) to run against a deployment.");
    return undefined;
  }
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`[deals runtime privacy] DEALS_E2E_BASE_URL is not a valid URL: ${JSON.stringify(value)}`); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("[deals runtime privacy] DEALS_E2E_BASE_URL must use http(s)");
  if (parsed.username || parsed.password) throw new Error("[deals runtime privacy] DEALS_E2E_BASE_URL must not carry credentials");
  return parsed;
}

const baseUrl = configuredBaseUrl();
const endpoint = (pathname: string) => {
  if (!baseUrl) throw new Error("No Deals runtime base URL");
  return new URL(pathname, baseUrl);
};

async function capture(url: URL, options: { method?: string; headers?: Record<string, string>; body?: string; redirect?: RequestRedirect; jar?: CookieJar } = {}): Promise<Captured> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { "User-Agent": "deals-runtime-privacy-vitest/2.0", ...options.headers };
    const cookie = options.jar?.header(url.pathname);
    if (cookie) headers.Cookie = cookie;
    let response: Response;
    try {
      response = await fetch(url, { method: options.method ?? "GET", headers, body: options.body, redirect: options.redirect ?? "manual", signal: controller.signal });
    } catch (error) {
      throw new Error(`[deals runtime privacy] ${url.origin} is unreachable (${url.pathname}): ${error instanceof Error ? error.message : String(error)}`);
    }
    options.jar?.absorb(response);
    return { url: response.url || url.toString(), status: response.status, headers: response.headers, body: Buffer.from(await response.arrayBuffer()) };
  } finally {
    clearTimeout(timeout);
  }
}

/** tRPC over HTTP with the superjson envelope the client uses. */
async function trpcQuery(procedure: string, jar?: CookieJar): Promise<Captured> {
  const url = endpoint(`/api/trpc/${procedure}`);
  url.searchParams.set("batch", "1");
  url.searchParams.set("input", JSON.stringify({ 0: { json: null } }));
  return capture(url, { headers: { Accept: "application/json" }, jar });
}

async function trpcMutation(procedure: string, input: unknown, jar: CookieJar): Promise<Captured> {
  const url = endpoint(`/api/trpc/${procedure}`);
  url.searchParams.set("batch", "1");
  return capture(url, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ 0: { json: input } }), jar });
}

function unwrapTrpc<T>(captured: Captured, label: string): T {
  let payload: unknown;
  try { payload = JSON.parse(captured.body.toString("utf8")); } catch { throw new Error(`${label}: response is not JSON (status ${captured.status})`); }
  const first = Array.isArray(payload) ? payload[0] as { result?: { data?: { json?: T } }; error?: { json?: { message?: string } } } : undefined;
  if (!first?.result) throw new Error(`${label}: tRPC error ${first?.error?.json?.message ?? captured.body.toString("utf8").slice(0, 200)} (status ${captured.status})`);
  return first.result.data?.json as T;
}

/** Private terms: every categorised launch scrub config, the builder aliases, the private names and addresses, plus env DEALS_PRIVATE_TERMS. */
export function runtimePrivateTermConfig(extra = process.env.DEALS_PRIVATE_TERMS ?? ""): DealScrubConfig {
  const envTerms = extra.split(",").map((term) => term.trim()).filter(Boolean);
  return mergeDealScrubConfig(
    ...LAUNCH_DEALS.map((deal) => deal.scrubConfig),
    ...LAUNCH_DEALS.map((deal) => builderScrubConfig(deal.builder)),
    ...LAUNCH_DEALS.map((deal) => ({ community: [deal.privateName], street: [deal.privateAddress.split(",")[0].trim()] })),
    { other: envTerms },
  );
}

/**
 * Text surfaces are checked with the server's own residue rule. Terms shorter
 * than four alphanumerics ("M/I", "HMC") are only meaningful next to "Homes" or
 * "Financial" (those phrases stay in the list); alone they match noise in a
 * minified bundle, exactly as the scrubber ignores them.
 */
export function textPrivateTermConfig(config: DealScrubConfig): DealScrubConfig {
  const result = parseDealScrubConfig(config);
  for (const category of Object.keys(result) as Array<keyof DealScrubConfig>) result[category] = result[category].filter((term) => term.replace(/[^a-z0-9]/gi, "").length >= 4);
  return result;
}

/** OCR terms follow the pipeline: short builder names only as "<name> Homes". */
export function ocrPrivateTerms(config: DealScrubConfig): string[] {
  return dealScrubTerms(config).flatMap((term) => term.replace(/[^a-z0-9]/gi, "").length >= 4 ? [term] : [`${term} Homes`, `Homes ${term}`]);
}

/** Terms of `config` that the server's own residue rule finds in `text`, one category at a time so plan words keep their special handling. */
export function offendingPrivateTerms(text: string, config: DealScrubConfig): string[] {
  const parsed = parseDealScrubConfig(config);
  return (Object.keys(parsed) as Array<keyof DealScrubConfig>).flatMap((category) => parsed[category].filter((term) => hasPrivateTerm(text, { ...emptyDealScrubConfig(), [category]: [term] })));
}

function assertNoPrivateText(body: Buffer | string, config: DealScrubConfig, label: string) {
  const text = Buffer.isBuffer(body) ? body.toString("utf8") : body;
  expect(offendingPrivateTerms(text, config), `${label} must not disclose private terms`).toEqual([]);
}

/** Same-origin scripts a document loads: <script src> and module preloads. Template placeholders are not URLs. */
export function scriptUrlsFromHtml(html: string, documentUrl: string): string[] {
  const urls = new Set<string>();
  const add = (raw: string) => {
    if (raw.includes("%")) return;
    try {
      const url = new URL(raw, documentUrl);
      if (url.origin === new URL(documentUrl).origin) urls.add(url.toString());
    } catch { /* not a URL */ }
  };
  for (const match of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) add(match[1]);
  for (const match of html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/g)) add(match[1]);
  return Array.from(urls);
}

/** Third-party script sources in a document; Instagram's embed is the only one a /deals page may load. */
export function foreignScriptSources(html: string, documentUrl: string): string[] {
  const origin = new URL(documentUrl).origin;
  return Array.from(html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)).map((match) => match[1]).filter((src) => {
    if (src.includes("%")) return true;
    try { return new URL(src, documentUrl).origin !== origin; } catch { return true; }
  }).filter((src) => !/^https:\/\/www\.instagram\.com\//.test(src));
}

function chunkUrlsFromScript(script: string, scriptUrl: string): string[] {
  const urls = new Set<string>();
  for (const match of script.matchAll(/["'`]((?:\.{1,2}\/|\/)[^"'`\s%]+\.(?:m?js))["'`]/g)) {
    try {
      const url = new URL(match[1], scriptUrl);
      if (url.origin === new URL(scriptUrl).origin) urls.add(url.toString());
    } catch { /* not a URL */ }
  }
  return Array.from(urls).slice(0, 25);
}

type GatedJson = { lead: { display: string; expiresAt: string; teamPreview: boolean }; communities: Array<{ label: string; areaMap: unknown; homes: Array<{ card: string; photos: string[] }> }> };

type LiveRun = {
  jar: CookieJar;
  landing: Captured;
  publicCatalog: Captured;
  anonymousMine: Captured;
  anonymousImage: Captured;
  start: { ok: boolean; kind?: string; message?: string; displayPhone?: string };
  verify: Captured;
  exchange: Captured;
  mineDocument: Captured;
  mineJson: Captured;
  gated: GatedJson;
  scripts: Array<{ url: string; body: Buffer }>;
  images: Array<{ url: string; status: number; contentType: string | null; width: number; height: number; hasMetadata: boolean; words: OcrWord[] }>;
  maps: Captured[];
};

const privateTerms = runtimePrivateTermConfig();
const textTerms = textPrivateTermConfig(privateTerms);
let live: LiveRun;

const configuredRuntime = baseUrl ? describe : describe.skip;

configuredRuntime("Builder Deals runtime privacy boundary (live deployment)", () => {
  beforeAll(async () => {
    const otp = process.env.DEALS_TEST_OTP?.trim();
    const testPhone = process.env.DEALS_E2E_TEST_PHONE?.trim();
    const missing = [!otp && "DEALS_TEST_OTP (the six-digit test code accepted for test numbers)", !testPhone && "DEALS_E2E_TEST_PHONE (a number on the admin test-numbers list)"].filter(Boolean);
    if (missing.length) throw new Error(`[deals runtime privacy] DEALS_E2E_BASE_URL is set but the live gate cannot be exercised without ${missing.join(" and ")}.`);

    const jar = new CookieJar();
    const landing = await capture(endpoint("/deals?src=e2e"), { headers: { Accept: "text/html,application/xhtml+xml" }, jar });
    if (landing.status !== 200) throw new Error(`[deals runtime privacy] GET /deals returned ${landing.status}; is DEALS_E2E_BASE_URL the deployed site?`);
    const [publicCatalog, anonymousMine, anonymousImage] = await Promise.all([
      trpcQuery("deals.publicCatalog"),
      capture(endpoint("/deals/mine"), { headers: { Accept: "text/html" } }),
      capture(endpoint("/deals/mine/img/1"), { headers: { Accept: "image/avif,image/webp,image/*" } }),
    ]);

    const start = unwrapTrpc<LiveRun["start"]>(await trpcMutation("deals.start", { phone: testPhone, choice: "buyer", src: "e2e" }, jar), "deals.start");
    if (!start.ok) throw new Error(`[deals runtime privacy] deals.start refused the test number: ${start.kind ?? "unknown"} ${start.message ?? ""}`.trim());
    const verify = await capture(endpoint("/deals/verify"), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/html" }, body: new URLSearchParams({ code: otp as string }).toString(), jar });
    const exchangePath = verify.headers.get("location") ?? "";
    if (verify.status !== 302 || !/^\/deals\/v\/[A-Za-z0-9_-]{32,}$/.test(exchangePath)) throw new Error(`[deals runtime privacy] /deals/verify did not issue a one-time link (status ${verify.status}, location ${exchangePath || "none"}); check DEALS_TEST_OTP and the test-numbers list.`);
    const exchange = await capture(endpoint(exchangePath), { headers: { Accept: "text/html" }, jar });
    if (exchange.status !== 302 || exchange.headers.get("location") !== "/deals/mine") throw new Error(`[deals runtime privacy] token exchange returned ${exchange.status} -> ${exchange.headers.get("location") ?? "none"}`);
    const mineDocument = await capture(endpoint("/deals/mine"), { headers: { Accept: "text/html" }, jar });
    const mineJson = await trpcQuery("deals.mine", jar);
    const gated = unwrapTrpc<GatedJson>(mineJson, "deals.mine");

    const scripts: LiveRun["scripts"] = [];
    const seen = new Set<string>();
    const queue = scriptUrlsFromHtml(landing.body.toString("utf8"), landing.url);
    while (queue.length) {
      const url = queue.shift() as string;
      if (seen.has(url)) continue;
      seen.add(url);
      const script = await capture(new URL(url), { headers: { Accept: "*/*" } });
      if (script.status !== 200) throw new Error(`[deals runtime privacy] bundle asset ${url} returned ${script.status}`);
      scripts.push({ url, body: script.body });
      // One level of code-split chunks referenced from the entry scripts.
      if (seen.size <= 1) queue.push(...chunkUrlsFromScript(script.body.toString("utf8"), url));
    }

    const photoUrls = Array.from(new Set(gated.communities.flatMap((community) => community.homes.flatMap((home) => home.photos ?? []))));
    const images: LiveRun["images"] = [];
    for (const [index, photoUrl] of photoUrls.entries()) {
      const response = await capture(endpoint(photoUrl), { headers: { Accept: "image/avif,image/webp,image/*" }, jar });
      let width = 0; let height = 0; let hasMetadata = false; let words: OcrWord[] = [];
      if (response.status === 200) {
        const image = sharp(response.body, { limitInputPixels: 30_000_000 });
        const metadata = await image.metadata();
        width = metadata.width ?? 0;
        height = metadata.height ?? 0;
        hasMetadata = Boolean(metadata.exif || metadata.icc || metadata.iptc || metadata.xmp);
        words = await recognizeDealPhotoWords(await image.png().toBuffer());
      }
      images.push({ url: photoUrl, status: response.status, contentType: response.headers.get("content-type"), width, height, hasMetadata, words });
      console.info(`[deals runtime privacy] image ${index + 1}/${photoUrls.length} ${photoUrl}: ${response.status} ${width}x${height} ${words.length} OCR words`);
    }
    const mapUrls = gated.communities.map((community) => (community.areaMap as { imageUrl?: string } | null)?.imageUrl).filter((value): value is string => typeof value === "string");
    const maps: Captured[] = [];
    for (const mapUrl of mapUrls) maps.push(await capture(endpoint(mapUrl), { headers: { Accept: "image/*" }, jar }));

    live = { jar, landing, publicCatalog, anonymousMine, anonymousImage, start, verify, exchange, mineDocument, mineJson, gated, scripts, images, maps };
  }, 15 * 60_000);

  afterAll(async () => { await closeDealPhotoOcrWorker(); });

  it("serves a noindex, non-cacheable public landing without private terms", () => {
    expect(live.landing.status).toBe(200);
    expect(live.landing.headers.get("content-type")).toMatch(/^text\/html\b/i);
    expect(live.landing.headers.get("cache-control")).toContain("private");
    expect(live.landing.headers.get("cache-control")).toContain("no-store");
    expect(live.landing.headers.get("referrer-policy")).toBe("same-origin");
    expect(live.landing.headers.get("x-robots-tag")).toContain("noindex");
    expect(live.landing.headers.get("content-security-policy")).toContain("default-src 'self'");
    assertNoPrivateText(live.landing.body, textTerms, "/deals HTML");
  });

  it("returns only public catalog output from the public procedure", () => {
    expect(live.publicCatalog.status).toBe(200);
    expect(live.publicCatalog.headers.get("cache-control")).toContain("no-store");
    const catalog = unwrapTrpc<unknown[]>(live.publicCatalog, "deals.publicCatalog");
    expect(Array.isArray(catalog)).toBe(true);
    assertNoPrivateText(live.publicCatalog.body, textTerms, "deals.publicCatalog response");
    for (const field of DEALS_PRIVATE_FIELDS) expect(live.publicCatalog.body.toString("utf8"), `public catalog must not carry ${field}`).not.toContain(`"${field}"`);
    for (const entry of catalog as Array<Record<string, unknown>>) expect(entry).not.toHaveProperty("homes");
  });

  it("refuses the private document and the image route without a session", () => {
    expect(live.anonymousMine.status).toBe(302);
    expect(live.anonymousMine.headers.get("location")).toBe("/deals?gate=1");
    expect(live.anonymousImage.status).toBe(401);
    expect(live.anonymousImage.body.byteLength).toBe(0);
  });

  it("creates a session through the live gate: start, code, one-time exchange, cookie-bound personal page", () => {
    expect(live.start.ok).toBe(true);
    // The code step shows the number the visitor typed, formatted; never the E.164 value.
    expect(live.start.displayPhone ?? "").toMatch(/^\(\d{3}\) \d{3}-\d{4}$/);
    expect(live.verify.status).toBe(302);
    expect(live.verify.body.byteLength).toBe(0);
    expect(live.exchange.status).toBe(302);
    expect(live.exchange.headers.get("cache-control")).toContain("no-store");
    expect(live.jar.has("ldr_deals_session")).toBe(true);
    expect(live.jar.has("ldr_deals_pending")).toBe(false);
    expect(live.mineDocument.status).toBe(200);
    expect(live.mineDocument.headers.get("cache-control")).toContain("no-store");
    expect(live.mineDocument.headers.get("referrer-policy")).toBe("same-origin");
    const html = live.mineDocument.body.toString("utf8");
    expect(html).not.toMatch(/\/deals\/v\/[A-Za-z0-9_-]{32,}/);
    expect(html).not.toMatch(/<meta[^>]+property="og:image"/i);
    expect(foreignScriptSources(html, live.mineDocument.url), "only Instagram's embed script may load on the gated page").toEqual([]);
    expect(foreignScriptSources(live.landing.body.toString("utf8"), live.landing.url), "no third-party tag on the landing document").toEqual([]);
    assertNoPrivateText(html, textTerms, "/deals/mine document");
  });

  it("serves the gated JSON with hand-built fields only and no private terms", () => {
    expect(live.mineJson.status).toBe(200);
    expect(live.mineJson.headers.get("cache-control")).toContain("no-store");
    const raw = live.mineJson.body.toString("utf8");
    assertNoPrivateText(raw, textTerms, "deals.mine response");
    for (const field of DEALS_PRIVATE_FIELDS) expect(raw, `gated JSON must not carry ${field}`).not.toContain(`"${field}"`);
    expect(raw).not.toMatch(/https?:\/\/[^"]*(?:amazonaws|cloudfront|chesmar|mihomes)/i);
    expect(live.gated.communities.length).toBeGreaterThan(0);
    for (const community of live.gated.communities) {
      expect(community.homes.length, `${community.label} must never look empty`).toBeGreaterThan(0);
      for (const home of community.homes) {
        expect(home.card).toMatch(/^[a-f0-9]{20}$/);
        for (const photo of home.photos ?? []) expect(photo).toMatch(/^\/deals\/mine\/img\/\d+$/);
      }
      if (community.areaMap !== null) {
        expect(Object.keys(community.areaMap as object).sort()).toEqual(["attribution", "imageUrl", "lat", "lng", "radiusMiles", "zoom"]);
        expect((community.areaMap as { imageUrl: string }).imageUrl).toMatch(/^\/deals\/mine\/maps\/\d+\.png$/);
      }
    }
  });

  it("ships a client bundle (index HTML plus every referenced script) without private terms", () => {
    expect(live.scripts.length).toBeGreaterThan(0);
    for (const script of live.scripts) assertNoPrivateText(script.body, textTerms, script.url);
  });

  it("serves every listing photo as a decodable, metadata-free image whose pixels carry no private term", () => {
    if (!live.images.length) console.warn("[deals runtime privacy] WARNING: the gated catalog served zero photos, so no image bytes were inspected.");
    const ocrTerms = ocrPrivateTerms(privateTerms);
    for (const image of live.images) {
      expect(image.status, `${image.url} must be served to the session`).toBe(200);
      expect(image.contentType ?? "").toMatch(/^image\/(?:webp|jpeg|png)/);
      expect(image.width).toBeGreaterThan(0);
      expect(image.width).toBeLessThanOrEqual(1600);
      expect(image.hasMetadata, `${image.url} must carry no EXIF/ICC/IPTC/XMP`).toBe(false);
      const matches = findExactOcrMatches(image.words, ocrTerms);
      expect(matches.map((match) => match.term), `${image.url} pixels disclose a private term`).toEqual([]);
    }
  });

  it("serves the area map image to the session only, as a PNG served no-store", async () => {
    for (const map of live.maps) {
      expect(map.status).toBe(200);
      expect(map.headers.get("content-type")).toMatch(/^image\/png/);
      expect(map.headers.get("cache-control")).toContain("no-store");
      const metadata = await sharp(map.body).metadata();
      expect(metadata.width).toBe(800);
      expect(metadata.height).toBe(400);
    }
    const mapUrls = live.gated.communities.map((community) => (community.areaMap as { imageUrl?: string } | null)?.imageUrl).filter((value): value is string => typeof value === "string");
    for (const mapUrl of mapUrls) {
      // Without the session cookie the same URL yields nothing.
      const anonymous = await capture(endpoint(mapUrl), { headers: { Accept: "image/*" } });
      expect(anonymous.status).toBe(401);
      expect(anonymous.body.byteLength).toBe(0);
    }
  }, 60_000);
});

describe("Builder Deals photo hide rules (offline fixtures)", () => {
  const W = 1600;
  const H = 1200;
  const house = `<rect width="${W}" height="${H}" fill="#cfd9e3"/><rect x="250" y="420" width="1100" height="560" fill="#b89b7a"/><path d="M200 440L800 140L1400 440Z" fill="#6b4f3a"/>`;

  afterAll(async () => { await closeDealPhotoOcrWorker(); });

  it("builds the private term list from every categorised launch scrub config plus DEALS_PRIVATE_TERMS", () => {
    const config = runtimePrivateTermConfig("Secret Creek, Example Lender");
    const terms = dealScrubTerms(config);
    for (const deal of LAUNCH_DEALS) {
      for (const term of dealScrubTerms(deal.scrubConfig)) expect(terms).toContain(term);
      expect(terms).toContain(deal.privateName);
      expect(terms).toContain(deal.privateAddress.split(",")[0].trim());
    }
    expect(config.other).toEqual(["Secret Creek", "Example Lender"]);
    expect(dealScrubTerms(textPrivateTermConfig(config))).not.toContain("M/I");
    expect(dealScrubTerms(textPrivateTermConfig(config))).toContain("M/I Homes");
    expect(ocrPrivateTerms({ builder: ["M/I"], lender: [], community: [], plan: [], street: [], other: [] })).toEqual(["M/I Homes", "Homes M/I"]);
    assertNoPrivateText("Southeast San Antonio | Half-Acre Lots and Lakes, from $499,990, East Central ISD", textTerms, "public label");
    expect(() => assertNoPrivateText("Sienna Lakes by Chesmar Homes", textTerms, "fixture")).toThrow();
  });

  it.skipIf(!fs.existsSync(OCR_TRAINED_DATA))("logo-only fixture: a builder wordmark drawn as a logo is caught by the pipeline's hide rules", async () => {
    // A wordmark the way builders print it: graphic roofline plus letter-spaced
    // capitals in the bottom band. OCR on the full frame feeds the real matcher.
    const wordmark = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${house}
      <rect x="0" y="${H - 170}" width="${W}" height="170" fill="#ffffff"/>
      <path d="M90 ${H - 60}L170 ${H - 140}L250 ${H - 60}Z" fill="#c8102e"/>
      <text x="300" y="${H - 58}" font-family="Arial" font-size="92" font-weight="800" letter-spacing="6" fill="#1b365d">CHESMAR HOMES</text>
    </svg>`;
    const normalized = await normalizeDealPhotoOriginal(await sharp(Buffer.from(wordmark)).jpeg({ quality: 92 }).toBuffer());
    const words = await recognizeDealPhotoWords(normalized);
    const matches = findDealPhotoHideMatches(words, dealScrubTerms(privateTerms));
    expect(matches.length, `OCR words: ${words.map((word) => word.text).join(" ")}`).toBeGreaterThan(0);
    expect(matches.map((match) => match.term.toLowerCase())).toEqual(expect.arrayContaining([expect.stringMatching(/chesmar/)]));
  }, 90_000);

  it.skipIf(!fs.existsSync(OCR_TRAINED_DATA))("logo-only fixture: a short builder mark next to Homes on a mid-frame sign is hidden, a plain home is not", async () => {
    const sign = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${house}
      <rect x="520" y="620" width="560" height="200" fill="#ffffff" stroke="#1b365d" stroke-width="8"/>
      <text x="560" y="760" font-family="Arial" font-size="110" font-weight="800" fill="#1b365d">M/I HOMES</text>
    </svg>`;
    const plain = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${house}</svg>`;
    const [signWords, plainWords] = await Promise.all([
      normalizeDealPhotoOriginal(await sharp(Buffer.from(sign)).jpeg({ quality: 92 }).toBuffer()).then(recognizeDealPhotoWords),
      normalizeDealPhotoOriginal(await sharp(Buffer.from(plain)).jpeg({ quality: 92 }).toBuffer()).then(recognizeDealPhotoWords),
    ]);
    const terms = dealScrubTerms(privateTerms);
    expect(findDealPhotoHideMatches(signWords, terms).length, `OCR words: ${signWords.map((word) => word.text).join(" ")}`).toBeGreaterThan(0);
    expect(findDealPhotoHideMatches(plainWords, terms)).toEqual([]);
  }, 90_000);

  it("graphic-only logo: a text-free mark in the builder's saved region is removed by the region step before any photo is served", async () => {
    const logoColour = { r: 200, g: 16, b: 46 };
    const graphic = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${house}
      <circle cx="${W - 160}" cy="${H - 70}" r="60" fill="rgb(${logoColour.r},${logoColour.g},${logoColour.b})"/>
    </svg>`;
    const normalized = await normalizeDealPhotoOriginal(await sharp(Buffer.from(graphic)).png().toBuffer());
    const originalHeight = (await sharp(normalized).metadata()).height ?? 0;
    const countLogoPixels = async (bytes: Buffer) => {
      const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let count = 0;
      for (let offset = 0; offset < data.length; offset += info.channels) {
        if (Math.abs(data[offset] - logoColour.r) < 24 && Math.abs(data[offset + 1] - logoColour.g) < 24 && Math.abs(data[offset + 2] - logoColour.b) < 24) count += 1;
      }
      return count;
    };
    expect(await countLogoPixels(normalized)).toBeGreaterThan(5_000);
    const master = await makeDealPhotoMaster(normalized, { region: DEFAULT_LAUNCH_WATERMARK_REGION });
    expect(master.regionAction).not.toBe("none");
    expect(master.height).toBeLessThan(originalHeight);
    expect(await countLogoPixels(master.data)).toBe(0);
  }, 60_000);
});
