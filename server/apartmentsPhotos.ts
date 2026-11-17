import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, asc, eq, isNull } from "drizzle-orm";
import sharp from "sharp";
import { aptPhotos } from "../drizzle/schema";
import { getDb } from "./db";
import { storagePut } from "./storage";

/**
 * APARTMENT PHOTOS (Nov 17, 2026, Peter: "every single photo ... when I send a list to clients, all of the photos
 * get sent to the client ... we just sell them on it"). A photo is found on the community's own site, copied once
 * into our storage as a web-sized image, and shown from there: the copy loads fast, never breaks when the community
 * reshuffles its site, and is the only link a renter gets (a link to the community's site would name it).
 *
 * The whole photo is kept: it is resized to fit, never cropped (the Builder Deals rule of Nov 4, 2026).
 */
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_EDGE = 1800;
const TIMEOUT_MS = 20_000;

export class AptPhotoError extends Error {
  constructor(public reason: "bad_link" | "private_address" | "gone" | "unavailable" | "not_an_image" | "too_large") { super(reason); }
}

const PRIVATE_V4 = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^(22[4-9]|2[3-5]\d)\./];
/** True for an address on this machine or a private network: never fetched, whatever a link says. */
export function isPrivateAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return PRIVATE_V4.some((pattern) => pattern.test(address));
  if (kind === 6) {
    const lower = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    return mapped ? isPrivateAddress(mapped[1]!) : lower === "::" || lower === "::1" || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
  }
  return true;
}

/** A photo link we are willing to fetch: https, a real host name, no sign-in part, no port. */
export function safeAptPhotoUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new AptPhotoError("bad_link"); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port || isIP(host.replace(/^\[|\]$/g, "")) || !host.includes(".") || /(^|\.)(localhost|local|internal|lan|home|corp)$/.test(host)) throw new AptPhotoError("bad_link");
  return url;
}

type Resolver = (host: string) => Promise<string[]>;
const resolveHost: Resolver = async (host) => (await lookup(host, { all: true })).map((entry) => entry.address);

/** Downloads a photo with a size cap, a time limit and every hop (redirects too) checked against private addresses. */
export async function downloadAptPhoto(raw: string, fetcher: typeof fetch = fetch, resolver: Resolver = resolveHost): Promise<Buffer> {
  let url = safeAptPhotoUrl(raw);
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  for (let hop = 0; hop <= 3; hop++) {
    const addresses = await resolver(url.hostname).catch(() => [] as string[]);
    if (!addresses.length) throw new AptPhotoError("unavailable");
    if (addresses.some(isPrivateAddress)) throw new AptPhotoError("private_address");
    const response = await fetcher(url, { redirect: "manual", signal, headers: { accept: "image/avif,image/webp,image/*;q=0.8" } }).catch(() => { throw new AptPhotoError("unavailable"); });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location || hop === 3) throw new AptPhotoError("unavailable");
      url = safeAptPhotoUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new AptPhotoError(response.status === 404 || response.status === 410 ? "gone" : "unavailable"); }
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("image/")) { await response.body.cancel(); throw new AptPhotoError("not_an_image"); }
    if (Number(response.headers.get("content-length")) > MAX_BYTES) { await response.body.cancel(); throw new AptPhotoError("too_large"); }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let length = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (length > MAX_BYTES) throw new AptPhotoError("too_large");
        chunks.push(Buffer.from(next.value));
      }
    } finally { await reader.cancel().catch(() => undefined); }
    return Buffer.concat(chunks, length);
  }
  throw new AptPhotoError("unavailable");
}

/** The stored form: turned upright, resized to fit (never cropped, never enlarged), re-encoded so nothing but the picture remains. */
export async function webSizedPhoto(original: Buffer): Promise<Buffer> {
  try {
    return await sharp(original, { failOn: "none", limitInputPixels: 80_000_000 }).rotate().resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  } catch { throw new AptPhotoError("not_an_image"); }
}

type Deps = { download?: (url: string) => Promise<Buffer>; store?: (key: string, bytes: Buffer) => Promise<string>; now?: () => number };

/**
 * Copies photos that have no stored copy yet, oldest first, until `limit` or the time budget runs out. A photo that
 * cannot be copied is marked with the reason and not tried again (a dead link stays dead); the rest carry on.
 */
export async function cacheApartmentPhotos(options: { limit?: number; budgetMs?: number; propertyId?: number } & Deps = {}): Promise<{ stored: number; failed: number; remaining: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const download = options.download ?? ((url: string) => downloadAptPhoto(url));
  const store = options.store ?? (async (key: string, bytes: Buffer) => (await storagePut(key, bytes, "image/webp", { unique: false })).url);
  const now = options.now ?? Date.now;
  const started = now();
  const pending = (await db.select().from(aptPhotos).where(and(isNull(aptPhotos.storedUrl), isNull(aptPhotos.failedReason), ...(options.propertyId ? [eq(aptPhotos.propertyId, options.propertyId)] : []))).orderBy(asc(aptPhotos.id)));
  let stored = 0;
  let failed = 0;
  let done = 0;
  for (const photo of pending.slice(0, options.limit ?? 40)) {
    if (now() - started > (options.budgetMs ?? 25_000)) break;
    done += 1;
    try {
      const bytes = await webSizedPhoto(await download(photo.sourceUrl));
      // The key is the picture's own fingerprint: no community name, and the same picture is never stored twice.
      const url = await store(`apartments/${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}.webp`, bytes);
      await db.update(aptPhotos).set({ storedUrl: url }).where(eq(aptPhotos.id, photo.id));
      stored += 1;
    } catch (error) {
      await db.update(aptPhotos).set({ failedReason: error instanceof AptPhotoError ? error.reason : "unavailable" }).where(eq(aptPhotos.id, photo.id));
      failed += 1;
    }
  }
  return { stored, failed, remaining: pending.length - done };
}
