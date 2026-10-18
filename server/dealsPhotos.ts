import crypto from "node:crypto";
import sharp from "sharp";
import { and, eq, gt } from "drizzle-orm";
import { dealCommunities, dealHomes, dealPhotoRenders, dealPhotos, dealLeads } from "../drizzle/schema";
import { getDb } from "./db";
import { storagePut, storageReadPrivate } from "./storage";

const PRIVATE_PREFIX = "builder-deals-private/";
const MAX_BYTES = 18 * 1024 * 1024;
const approvedImageHosts = new Set(["www.mihomes.com", "mihomes.com", "dam.mihomes.com", "www.chesmar.com", "chesmar.com", "images.ctfassets.net", "cdn.sanity.io"]);
const digest = (value: Buffer | string) => crypto.createHash("sha256").update(value).digest("hex");

function safeImageUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || !approvedImageHosts.has(url.hostname.toLowerCase())) throw new Error("Unapproved Builder Deals image host");
  return url;
}
function watermarkSvg(text: string, width: number, height: number) {
  const safe = text.replace(/[<&>]/g, "");
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><g transform="rotate(-28 ${width / 2} ${height / 2})" fill="#ffffff" fill-opacity="0.32" font-family="Arial" font-size="${Math.max(13, Math.round(width / 42))}" font-weight="600">${Array.from({ length: 8 }, (_, i) => `<text x="${-width / 3}" y="${i * Math.max(48, height / 6) + 44}">${safe}</text>`).join("")}</g></svg>`);
}
let ocrWorkerPromise: Promise<any> | null = null;
let ocrWork = Promise.resolve();

async function ocrTerms(bytes: Buffer, terms: string[]) {
  // Tesseract is deliberately best-effort only here; a processing/OCR failure
  // hides the asset rather than risking a branded/lender image being served.
  try {
    const { createWorker } = await import("tesseract.js");
    ocrWorkerPromise ??= createWorker("eng", 1, { logger: () => undefined });
    const text = await new Promise<string>((resolve, reject) => {
      ocrWork = ocrWork.then(async () => {
        try { resolve((await (await ocrWorkerPromise).recognize(bytes)).data.text.toLowerCase()); }
        catch (error) { reject(error); }
      });
    });
    return terms.filter((term) => term.trim().length >= 4 && text.includes(term.toLowerCase()));
  } catch { return ["ocr_processing_failed"]; }
}

export async function closeDealPhotoOcrWorker() {
  if (ocrWorkerPromise) { await (await ocrWorkerPromise).terminate(); ocrWorkerPromise = null; ocrWork = Promise.resolve(); }
}

/** Downloads, strips metadata, OCR-checks and stores one private image master. */
export async function processDealPhoto(photoId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const row = (await db.select({ photo: dealPhotos, home: dealHomes, community: dealCommunities }).from(dealPhotos).innerJoin(dealHomes, eq(dealPhotos.homeId, dealHomes.id)).innerJoin(dealCommunities, eq(dealHomes.communityId, dealCommunities.id)).where(eq(dealPhotos.id, photoId)).limit(1))[0];
  if (!row) throw new Error("Photo unavailable");
  try {
    const url = safeImageUrl(row.photo.sourceUrl);
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error("Image source unavailable");
    const original = Buffer.from(await response.arrayBuffer());
    if (original.byteLength === 0 || original.byteLength > MAX_BYTES) throw new Error("Image size rejected");
    const metadata = await sharp(original).metadata();
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > 50_000_000) throw new Error("Image dimensions rejected");
    let image = sharp(original, { limitInputPixels: 50_000_000 }).rotate();
    if (row.community.watermarkRemovalApproved && row.photo.bottomCrop > 0) {
      image = image.extract({ left: 0, top: 0, width: metadata.width, height: Math.max(1, metadata.height - row.photo.bottomCrop) });
    }
    const cleaned = await image.webp({ quality: 88 }).toBuffer();
    const configuredTerms = Array.from(new Set([row.community.builder, row.community.privateName, row.home.privateAddress ?? "", row.home.privatePlanName ?? "", ...JSON.parse(row.community.scrubList || "[]")].filter(Boolean)));
    const matches = await ocrTerms(cleaned, configuredTerms);
    if (matches.length) {
      await db.update(dealPhotos).set({ automaticHidden: true, processingState: "failed", ocrMatches: JSON.stringify(matches) }).where(eq(dealPhotos.id, photoId));
      return { ok: false as const, hidden: true, matches };
    }
    const sourceHash = row.photo.sourceHash || digest(original);
    const originalStored = await storagePut(`${PRIVATE_PREFIX}originals/${sourceHash}.webp`, cleaned, "image/webp");
    const version = digest(cleaned).slice(0, 32);
    const processedStored = await storagePut(`${PRIVATE_PREFIX}masters/${version}.webp`, cleaned, "image/webp");
    await db.update(dealPhotos).set({ sourceHash, originalStorageKey: originalStored.key, processedStorageKey: processedStored.key, processedVersion: version, automaticHidden: false, ocrMatches: "[]", processingState: "processed" }).where(eq(dealPhotos.id, photoId));
    return { ok: true as const, version };
  } catch (error) {
    console.warn(`[deals-photo] private processing failed for photo ${photoId}: ${error instanceof Error ? error.message : "unknown error"}`);
    await db.update(dealPhotos).set({ automaticHidden: true, processingState: "failed", ocrMatches: JSON.stringify(["processing_failed"]) }).where(eq(dealPhotos.id, photoId));
    return { ok: false as const, hidden: true, matches: ["processing_failed"] };
  }
}

/** Produces only per-lead watermarked image bytes; no object URL leaves the server. */
export async function renderDealPhotoForLead(photoId: number, leadId: number) {
  const db = await getDb();
  if (!db) return null;
  const row = (await db.select({ photo: dealPhotos, home: dealHomes, community: dealCommunities, lead: dealLeads }).from(dealPhotos).innerJoin(dealHomes, eq(dealPhotos.homeId, dealHomes.id)).innerJoin(dealCommunities, eq(dealHomes.communityId, dealCommunities.id)).innerJoin(dealLeads, eq(dealLeads.id, leadId)).where(and(eq(dealPhotos.id, photoId), eq(dealPhotos.processingState, "processed"), eq(dealPhotos.automaticHidden, false), eq(dealPhotos.adminHidden, false), eq(dealHomes.status, "available"), eq(dealCommunities.paused, false), eq(dealCommunities.active, true))).limit(1))[0];
  if (!row?.photo.processedStorageKey || !row.photo.processedVersion) return null;
  const cached = (await db.select().from(dealPhotoRenders).where(and(eq(dealPhotoRenders.photoId, photoId), eq(dealPhotoRenders.leadId, leadId), eq(dealPhotoRenders.version, row.photo.processedVersion), gt(dealPhotoRenders.expiresAt, new Date()))).limit(1))[0];
  if (cached) return storageReadPrivate(cached.storageKey);
  const source = await storageReadPrivate(row.photo.processedStorageKey);
  const meta = await sharp(source.data).metadata();
  const identity = row.lead.instagramHandle ? `@${row.lead.instagramHandle}` : row.lead.name?.trim() || `••••${row.lead.phoneE164.replace(/\D/g, "").slice(-4)}`;
  const rendered = await sharp(source.data).composite([{ input: watermarkSvg(`Prepared for ${identity} | Lifestyle Design Realty`, meta.width || 1000, meta.height || 750), gravity: "center" }]).webp({ quality: 88 }).toBuffer();
  const expiry = new Date(Math.min(row.lead.expiresAt.getTime() + 24 * 60 * 60_000, Date.now() + 48 * 60 * 60_000));
  const stored = await storagePut(`${PRIVATE_PREFIX}renders/${leadId}/${photoId}-${row.photo.processedVersion}.webp`, rendered, "image/webp");
  await db.insert(dealPhotoRenders).values({ photoId, leadId, version: row.photo.processedVersion, storageKey: stored.key, expiresAt: expiry }).onDuplicateKeyUpdate({ set: { storageKey: stored.key, expiresAt: expiry } });
  return { data: rendered, contentType: "image/webp" };
}
