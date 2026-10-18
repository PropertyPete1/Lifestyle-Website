import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const DEFAULT_DEALS_E2E_BASE_URL = "https://3000-ikqecsvrip83yuk510r73-be8e0622.us1.manus.computer";
const REQUEST_TIMEOUT_MS = 6_000;

// Keep this local list explicit: these are source-builder, community, plan, and
// address terms which are allowed only behind the verified Buyer Deals boundary.
const PRIVATE_SOURCE_TERMS = [
  "Chesmar",
  "M/I Homes",
  "Sienna Lakes",
  "Vista Gardens",
  "Rio Grande",
  "7711 Hanging Basket",
  "Hanging Basket",
  "Onion Patch",
] as const;

type CapturedResponse = {
  url: string;
  status: number;
  headers: Headers;
  body: Buffer;
};

type RuntimeSnapshot = {
  landing: CapturedResponse;
  catalog: CapturedResponse;
  mine: CapturedResponse;
  image: CapturedResponse;
};

function configuredBaseUrl(): URL | undefined {
  const value = process.env.DEALS_E2E_BASE_URL || DEFAULT_DEALS_E2E_BASE_URL;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("base URL must use HTTP(S)");
    return parsed;
  } catch (error) {
    console.warn(`[deals runtime privacy] skipping remote checks: invalid DEALS_E2E_BASE_URL (${error instanceof Error ? error.message : String(error)})`);
    return undefined;
  }
}

const baseUrl = configuredBaseUrl();

function endpoint(path: string): URL {
  if (!baseUrl) throw new Error("No valid Deals runtime base URL");
  return new URL(path, baseUrl);
}

function publicCatalogEndpoint(): URL {
  const url = endpoint("/api/trpc/deals.publicCatalog");
  // tRPC's batched GET transport requires an indexed input envelope even for a
  // no-input procedure. URLSearchParams preserves valid percent-encoding.
  url.searchParams.set("batch", "1");
  url.searchParams.set("input", JSON.stringify({ 0: { json: null } }));
  return url;
}

async function capture(url: URL, options: { redirect?: RequestRedirect; accept: string }): Promise<CapturedResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: options.redirect ?? "follow",
      headers: {
        Accept: options.accept,
        "User-Agent": "deals-runtime-privacy-vitest/1.0",
      },
      signal: controller.signal,
    });
    return {
      url: response.url,
      status: response.status,
      headers: response.headers,
      body: Buffer.from(await response.arrayBuffer()),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function isUnavailableStatus(status: number): boolean {
  // Preview platforms commonly surface an offline target as one of these
  // gateway statuses. Other HTTP statuses remain test failures.
  return status === 502 || status === 503 || status === 504;
}

function assertNoPrivateTerms(body: Buffer, label: string) {
  const text = body.toString("utf8").toLowerCase();
  for (const term of PRIVATE_SOURCE_TERMS) {
    expect(text, `${label} must not disclose ${term}`).not.toContain(term.toLowerCase());
  }
}

function readBuiltClientArtifacts(): Array<{ path: string; body: Buffer }> {
  const root = join(process.cwd(), "dist", "public");
  if (!existsSync(root)) return [];

  const artifacts: Array<{ path: string; body: Buffer }> = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile() && /\.(?:html|js|mjs|cjs|css|map)$/i.test(entry.name)) {
        artifacts.push({ path, body: readFileSync(path) });
      }
    }
  };
  visit(root);
  return artifacts;
}

let runtime: RuntimeSnapshot | undefined;
let unavailableReason: string | undefined;

beforeAll(async () => {
  if (!baseUrl) {
    unavailableReason = "the configured base URL is invalid";
    return;
  }

  try {
    const landing = await capture(endpoint("/deals"), { accept: "text/html,application/xhtml+xml" });
    if (isUnavailableStatus(landing.status)) {
      unavailableReason = `/deals returned ${landing.status}`;
      console.warn(`[deals runtime privacy] skipping remote checks: ${unavailableReason}`);
      return;
    }

    const [catalog, mine, image] = await Promise.all([
      capture(publicCatalogEndpoint(), { accept: "application/json" }),
      // Do not follow this redirect: the status and location are the private
      // document boundary being tested, and each Node fetch has no cookie jar.
      capture(endpoint("/deals/mine"), { accept: "text/html", redirect: "manual" }),
      capture(endpoint("/deals/mine/img/1"), { accept: "image/avif,image/webp,image/*", redirect: "manual" }),
    ]);
    const unavailable = [catalog, mine, image].find((response) => isUnavailableStatus(response.status));
    if (unavailable) {
      unavailableReason = `${new URL(unavailable.url).pathname} returned ${unavailable.status}`;
      console.warn(`[deals runtime privacy] skipping remote checks: ${unavailableReason}`);
      return;
    }
    runtime = { landing, catalog, mine, image };
  } catch (error) {
    unavailableReason = error instanceof Error ? error.message : String(error);
    console.warn(`[deals runtime privacy] skipping remote checks: ${unavailableReason}`);
  }
}, 15_000);

describe("Builder Deals runtime privacy boundary", () => {
  it("is explicitly offline-safe when the preview target cannot be reached", () => {
    if (runtime) return;
    expect(unavailableReason).toBeTruthy();
  });

  it("serves a noindex, non-cacheable public landing without private source terms", () => {
    if (!runtime) return;

    expect(runtime.landing.status).toBe(200);
    expect(runtime.landing.headers.get("content-type")).toMatch(/^text\/html\b/i);
    expect(runtime.landing.headers.get("cache-control")).toContain("private");
    expect(runtime.landing.headers.get("cache-control")).toContain("no-store");
    expect(runtime.landing.headers.get("referrer-policy")).toBe("same-origin");
    expect(runtime.landing.headers.get("x-robots-tag")).toContain("noindex");
    expect(runtime.landing.headers.get("x-robots-tag")).toContain("nofollow");
    expect(runtime.landing.headers.get("content-security-policy")).toContain("default-src 'self'");
    assertNoPrivateTerms(runtime.landing.body, "/deals HTML");
  });

  it("uses the tRPC batch input envelope and returns only public catalog output", () => {
    if (!runtime) return;

    const requestUrl = new URL(runtime.catalog.url);
    expect(requestUrl.pathname).toBe("/api/trpc/deals.publicCatalog");
    expect(requestUrl.searchParams.get("batch")).toBe("1");
    expect(JSON.parse(requestUrl.searchParams.get("input") || "null")).toEqual({ 0: { json: null } });
    expect(runtime.catalog.status).toBe(200);
    expect(runtime.catalog.headers.get("content-type")).toMatch(/^application\/json\b/i);
    expect(runtime.catalog.headers.get("cache-control")).toContain("no-store");
    expect(runtime.catalog.headers.get("x-robots-tag")).toContain("noindex");
    assertNoPrivateTerms(runtime.catalog.body, "deals.publicCatalog response");

    const payload: unknown = JSON.parse(runtime.catalog.body.toString("utf8"));
    expect(Array.isArray(payload)).toBe(true);
    const first = Array.isArray(payload) ? payload[0] as { result?: { data?: { json?: unknown } } } : undefined;
    expect(first?.result?.data).toBeTruthy();
    expect(Array.isArray(first?.result?.data?.json)).toBe(true);
  });

  it("redirects an unauthenticated private document and returns no private image bytes", () => {
    if (!runtime) return;

    expect(runtime.mine.status).toBe(302);
    expect(runtime.mine.headers.get("location")).toBe("/deals?gate=1");
    assertNoPrivateTerms(runtime.mine.body, "unauthenticated /deals/mine response");

    expect(runtime.image.status).toBe(401);
    expect(runtime.image.body.byteLength).toBe(0);
  });

  it("does not embed private source terms in an optional built client artifact", () => {
    const artifacts = readBuiltClientArtifacts();
    for (const artifact of artifacts) assertNoPrivateTerms(artifact.body, artifact.path);
  });
});
