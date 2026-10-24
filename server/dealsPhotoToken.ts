import crypto from "node:crypto";
import { clientIpKey } from "../shared/deals";

/**
 * Public photo URLs (October 24, 2026: visitors see every home's photos before signing up). A photo is named by an
 * opaque token: its row id sealed with the server's secret, so the page never carries a database id and a made-up
 * token opens nothing. What a token may show is still decided by the render (processed, unhidden, available home,
 * live community), so a photo an admin hides or a home that sells stops showing whatever URL a visitor kept.
 */
const MAGIC = Buffer.from("ldrphoto");
/** Without a cookie secret (a misconfigured deployment) tokens are keyed per process: still opaque, just not stable across restarts. */
const FALLBACK_KEY = crypto.randomBytes(16);
const key = () => process.env.JWT_SECRET ? crypto.createHash("sha256").update(`deals-photo-token:${process.env.JWT_SECRET}`).digest().subarray(0, 16) : FALLBACK_KEY;

export function photoToken(photoId: number): string {
  const block = Buffer.alloc(16);
  MAGIC.copy(block, 0);
  block.writeBigUInt64BE(BigInt(photoId), 8);
  const cipher = crypto.createCipheriv("aes-128-ecb", key(), null);
  cipher.setAutoPadding(false);
  // Hex, not base64url: the public privacy check splits words on "-" and "_", so a base64 token could spell a short
  // builder name by chance and drop a community; one unbroken hex word never matches a name.
  return Buffer.concat([cipher.update(block), cipher.final()]).toString("hex");
}

/** The photo id inside a token; null for anything that is not one of ours. */
export function photoIdFromToken(token: string): number | null {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  const sealed = Buffer.from(token, "hex");
  if (sealed.length !== 16) return null;
  const decipher = crypto.createDecipheriv("aes-128-ecb", key(), null);
  decipher.setAutoPadding(false);
  const block = Buffer.concat([decipher.update(sealed), decipher.final()]);
  if (!block.subarray(0, 8).equals(MAGIC)) return null;
  const id = Number(block.readBigUInt64BE(8));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export const publicPhotoUrl = (photoId: number) => `/deals/pub/img/${photoToken(photoId)}`;

/** A visitor may load this many public photos a minute (a gallery is a few dozen; a scraper is thousands). */
const PUBLIC_PHOTOS_PER_MINUTE = 300;
const TRACKED_VISITORS = 5_000;
const hits = new Map<string, { count: number; resetAt: number }>();
export function publicPhotoAllowed(ip: string, now = Date.now()): boolean {
  const visitor = clientIpKey(ip);
  const entry = hits.get(visitor);
  if (!entry || entry.resetAt <= now) {
    if (hits.size >= TRACKED_VISITORS) hits.delete(hits.keys().next().value as string);
    hits.set(visitor, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= PUBLIC_PHOTOS_PER_MINUTE;
}

/** Test seam only. */
export function resetPublicPhotoLimits() {
  hits.clear();
}
