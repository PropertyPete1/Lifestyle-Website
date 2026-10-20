import { eq } from "drizzle-orm";
import { dealCommunities } from "../drizzle/schema";
import { mergeDealScrubConfig, normalizedDealSourceKey, type DealScrubConfig } from "../shared/deals";
import { lotAcres } from "../shared/dealsFeatured";
import { areaLabelFor, publicLabelFor, type HeadlineFacts } from "../shared/dealsArea";
import { getDb } from "./db";
import { hashSecret } from "./dealsService";
import { builderScrubConfig } from "./dealsSync";
import { serializeStoredScrubList } from "./dealsScrub";

type CommunityRow = typeof dealCommunities.$inferSelect;

/**
 * What a builder reader reports for one community on the builder's own market
 * page. Everything here is private: it only ever lands in admin-only columns,
 * and the public label is generated from coarse facts, never from these names.
 */
export type DiscoveredCommunity = {
  builder: string;
  name: string;
  sourceUrl: string;
  city?: string | null;
  zip?: string | null;
  /** Model home or sales center address, as published. */
  address?: string | null;
  salesPhone?: string | null;
  status: "selling" | "coming_soon" | "closeout";
  priceFrom?: number | null;
  lotSizesText?: string | null;
  schoolDistrict?: string | null;
  moveInReadyCount?: number | null;
};

const STREET_SUFFIX = /\s+(?:st|street|rd|road|dr|drive|ln|lane|way|blvd|boulevard|pkwy|parkway|ct|court|cv|cove|trl|trail|loop|path|pass|run|xing|crossing|cir|circle|pl|place|ave|avenue|hwy|highway)\.?$/i;

/** "9010 Arroyo Grove, San Antonio, TX 78263" -> "Arroyo Grove"; a PO box or a bare city yields nothing. */
export function streetFromAddress(address: string | null | undefined): string | null {
  const first = address?.split(",")[0]?.trim() ?? "";
  const match = /^\d+[a-z]?\s+(.+)$/i.exec(first);
  if (!match) return null;
  const street = match[1]!.replace(STREET_SUFFIX, "").trim();
  return street.length >= 3 && !/^p\.?\s*o\.?\s*box/i.test(street) ? street : null;
}

/** The ZIP code a published address ends with, or the one the reader saw on the page. */
function zipOf(community: Pick<DiscoveredCommunity, "zip" | "address">): string | null {
  if (community.zip && /^\d{5}$/.test(community.zip.trim())) return community.zip.trim();
  return /\b(\d{5})(?:-\d{4})?\s*$/.exec(community.address?.trim() ?? "")?.[1] ?? null;
}

/** The private names a new community starts with: the builder's aliases, its own name, and its street. */
export function initialScrubConfig(community: Pick<DiscoveredCommunity, "builder" | "name" | "address">): DealScrubConfig {
  const config = builderScrubConfig(community.builder);
  if (!config.builder.some((term) => term.toLowerCase() === community.builder.toLowerCase())) config.builder.push(community.builder);
  const street = streetFromAddress(community.address);
  return mergeDealScrubConfig(config, { builder: [], lender: [], community: [community.name.trim()], plan: [], street: street ? [street] : [], other: [] });
}

export function headlineFactsFor(community: Pick<DiscoveredCommunity, "priceFrom" | "lotSizesText" | "moveInReadyCount">): HeadlineFacts {
  return { acres: lotAcres(community.lotSizesText, { field: true }), fromPrice: community.priceFrom ?? null, moveInReadyCount: community.moveInReadyCount ?? null };
}

/** A stable, private funnel code for a discovered community (it is never a reel code a buyer can type). */
export function autoReelCode(sourceUrl: string): string {
  return `auto-${hashSecret(`deals-auto:${normalizedDealSourceKey(sourceUrl)}`).slice(0, 10)}`;
}

export type OnboardingResult = { created: number[]; existing: number; skipped: Array<{ name: string; reason: string }> };

/**
 * Add every community a builder reader found that is not in the database yet.
 * A new row is created inactive and awaiting its first sync, so nothing shows
 * to anyone until the first clean pull of its homes, photos and incentive. Its
 * area label and headline come from coarse generic words only.
 */
export async function onboardDiscoveredCommunities(discovered: readonly DiscoveredCommunity[]): Promise<OnboardingResult> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result: OnboardingResult = { created: [], existing: 0, skipped: [] };
  const rows = await db.select({ id: dealCommunities.id, sourceUrl: dealCommunities.sourceUrl }).from(dealCommunities);
  const known = new Set(rows.map((row) => normalizedDealSourceKey(row.sourceUrl)));
  const factsById = new Map<number, HeadlineFacts>();
  for (const community of discovered) {
    const name = community.name?.trim();
    let url: URL | null = null;
    try { url = new URL(community.sourceUrl); } catch { url = null; }
    if (!name || !url || url.protocol !== "https:") { result.skipped.push({ name: name || "(unnamed)", reason: "invalid_name_or_url" }); continue; }
    if (community.status === "closeout") { result.skipped.push({ name, reason: "closeout" }); continue; }
    const key = normalizedDealSourceKey(community.sourceUrl);
    if (known.has(key)) { result.existing += 1; continue; }
    const zip = zipOf(community);
    const area = areaLabelFor({ city: community.city });
    const inserted = await db.insert(dealCommunities).values({
      builder: community.builder.trim(),
      privateName: name.slice(0, 190),
      sourceUrl: community.sourceUrl,
      privateAddress: (community.address?.trim() || [community.city?.trim(), zip ? `TX ${zip}` : "TX"].filter(Boolean).join(", ")).slice(0, 255),
      salesPhone: community.salesPhone?.trim().slice(0, 40) || null,
      publicLabel: publicLabelFor(area, headlineFactsFor(community)).slice(0, 190),
      areaLabel: area,
      schoolDistrict: community.schoolDistrict?.trim().slice(0, 160) || null,
      lotSizes: community.lotSizesText?.trim().slice(0, 160) || null,
      amenities: "[]",
      fromPrice: community.priceFrom && community.priceFrom > 0 ? Math.round(community.priceFrom) : null,
      reelCode: autoReelCode(community.sourceUrl),
      scrubList: serializeStoredScrubList(initialScrubConfig({ builder: community.builder, name, address: community.address ?? null }), []),
      active: false,
      paused: false,
      awaitingFirstSync: true,
    });
    const id = Number((inserted as unknown as [{ insertId: number }])[0]?.insertId ?? 0);
    known.add(key);
    if (id) { result.created.push(id); factsById.set(id, headlineFactsFor(community)); }
  }
  // The area becomes a side of town once the ZIP code centroid is known.
  const { refreshCommunityGeography } = await import("./dealsMap");
  for (const id of result.created) {
    await refreshCommunityGeography(id).catch(() => null);
    await relabelFromCentroid(id, factsById.get(id)).catch(() => null);
  }
  return result;
}

/** Recompute an auto community's area and headline from its centroid and current facts (only while it awaits its first sync). */
/** The label the system would generate for this row as it stands. */
export function generatedLabelFor(row: Pick<CommunityRow, "areaLabel" | "lotSizes" | "fromPrice" | "amenities">): string {
  return publicLabelFor(row.areaLabel, { acres: lotAcres(row.lotSizes, { field: true }), fromPrice: row.fromPrice, amenities: JSON.parse(row.amenities ?? "[]") as string[] }).slice(0, 190);
}

export async function relabelFromCentroid(communityId: number, facts?: HeadlineFacts, options: { labelUntouched?: boolean } = {}): Promise<CommunityRow | null> {
  const db = await getDb();
  if (!db) return null;
  const row = (await db.select().from(dealCommunities).where(eq(dealCommunities.id, communityId)).limit(1))[0];
  if (!row || !row.awaitingFirstSync) return row ?? null;
  // A label an admin rewrote is theirs: only a label the system generated is regenerated.
  const rowFacts: HeadlineFacts = { acres: lotAcres(row.lotSizes, { field: true }), fromPrice: row.fromPrice, amenities: JSON.parse(row.amenities ?? "[]") as string[] };
  if (!(options.labelUntouched ?? row.publicLabel === generatedLabelFor(row))) return row;
  const lat = Number.parseFloat(row.zipCentroidLat ?? "");
  const lng = Number.parseFloat(row.zipCentroidLng ?? "");
  const centroid = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  const city = row.privateAddress.split(",").map((part) => part.trim()).at(-2) ?? null;
  const area = areaLabelFor({ centroid, city });
  const headlineFacts: HeadlineFacts = facts ?? rowFacts;
  const publicLabel = publicLabelFor(area, headlineFacts).slice(0, 190);
  await db.update(dealCommunities).set({ areaLabel: area, publicLabel }).where(eq(dealCommunities.id, communityId));
  return { ...row, areaLabel: area, publicLabel };
}
