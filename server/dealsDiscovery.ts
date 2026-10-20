import { inArray } from "drizzle-orm";
import { dealCommunities } from "../drizzle/schema";
import { DOWNTOWN_SAN_ANTONIO, milesBetween } from "../shared/dealsArea";
import { getDb } from "./db";
import { sendBuilderDealsEmail } from "./dealsEmail";
import { getDealSettings } from "./dealsService";
import { asUrl, decodeHtmlEntities, getDocument, hasBuilderReader, parseSitemapUrls, sameOfficialHost, type BuilderId, type HtmlFetcher } from "./dealsAdapters";
import { onboardDiscoveredCommunities, type DiscoveredCommunity, type OnboardingResult } from "./dealsOnboarding";

/**
 * FINDING EVERY COMMUNITY: each builder with a reader lists its San Antonio
 * area communities in its own sitemap, and every community page carries a
 * schema.org business record (name, sales address, phone). Discovery reads
 * those, keeps the ones within the area, and hands them to onboarding, which
 * adds new ones hidden until their first clean data pull. It never removes a
 * community: a builder's sitemap missing one is not proof it closed.
 */

/** Communities farther than this from downtown are outside the area we cover (San Marcos is). */
export const DISCOVERY_RADIUS_MILES = 45;
/** Community pages read per builder per run, one at a time. */
const MAX_COMMUNITY_PAGES = 120;
/** Sitemap documents read per builder per run. */
const MAX_SITEMAP_DOCUMENTS = 32;

export type DiscoveryReader = {
  builder: Exclude<BuilderId, "Manual">;
  host: string;
  sitemap: string;
  /** Path of a community page in the builder's San Antonio market. */
  communityPath: RegExp;
};

export const DISCOVERY_READERS: readonly DiscoveryReader[] = [
  { builder: "Chesmar", host: "www.chesmar.com", sitemap: "https://www.chesmar.com/sitemap.xml", communityPath: /^\/texas\/san-antonio-new-homes\/[a-z0-9-]+\/[^/]+\/?$/i },
  {
    builder: "M/I Homes", host: "www.mihomes.com", sitemap: "https://www.mihomes.com/Sitemap/sitemap.xml",
    communityPath: /^\/new-homes\/texas\/greater-san-antonio\/(?!communities\/|plans-ready-to-build\/|quick-move-in-homes\/|model-homes-to-tour\/)[a-z0-9-]+\/[a-z0-9-]+\/?$/i,
  },
];

/** Every URL in a sitemap or sitemap index on the builder's own host; null when it cannot be read whole. */
export async function officialSitemapUrls(index: string, host: string, fetcher: HtmlFetcher): Promise<string[] | null> {
  const pending = [index];
  const seen = new Set<string>();
  const urls: string[] = [];
  while (pending.length) {
    if (seen.size >= MAX_SITEMAP_DOCUMENTS) return null;
    const url = pending.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const page = await getDocument(url, fetcher, "application/xml,text/xml", host);
    if (!page.ok) return null;
    if (/^\s*(?:<\?xml\b[^>]*>\s*)?<sitemapindex\b/i.test(page.text)) {
      const locations = Array.from(page.text.matchAll(/<loc\b[^>]*>\s*([\s\S]*?)\s*<\/loc>/gi), (match) => decodeHtmlEntities(match[1]!).trim());
      if (!locations.length) return null;
      for (const raw of locations) {
        const next = asUrl(raw);
        if (!next || !sameOfficialHost(next, host)) return null;
        if (!seen.has(next.toString())) pending.push(next.toString());
      }
    } else {
      const parsed = parseSitemapUrls(page.text);
      if (!parsed) return null;
      urls.push(...parsed);
    }
  }
  return Array.from(new Set(urls));
}

type JsonObject = Record<string, unknown>;
const BUSINESS_TYPES = /^(?:LocalBusiness|HomeAndConstructionBusiness|GeneralContractor|RealEstateAgent|Place|Residence|ApartmentComplex|SingleFamilyResidence|Accommodation)$/;

function jsonLdObjects(html: string): JsonObject[] {
  const objects: JsonObject[] = [];
  for (const match of Array.from(html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))) {
    try {
      const parsed: unknown = JSON.parse(match[1]!.trim());
      const queue: unknown[] = [parsed];
      while (queue.length) {
        const item = queue.shift();
        if (Array.isArray(item)) queue.push(...item);
        else if (item && typeof item === "object") {
          const object = item as JsonObject;
          objects.push(object);
          if (Array.isArray(object["@graph"])) queue.push(...(object["@graph"] as unknown[]));
        }
      }
    } catch { /* a broken block is skipped, never guessed at */ }
  }
  return objects;
}

const text = (value: unknown) => typeof value === "string" ? decodeHtmlEntities(value).replace(/\s+/g, " ").trim() : "";

/** "$289,990 - $512,990" or "From $289,990" -> 289990. */
export function priceFromRange(value: unknown): number | null {
  const match = /\$\s*([\d,]{5,})/.exec(text(value));
  const price = match ? Number(match[1]!.replace(/,/g, "")) : NaN;
  return Number.isFinite(price) && price >= 50_000 && price <= 20_000_000 ? price : null;
}

export type CommunityRecord = { name: string; street: string | null; city: string | null; zip: string | null; phone: string | null; priceFrom: number | null; geo: { lat: number; lng: number } | null };

/**
 * The community's own schema.org record: the business object that has a
 * postal address and a name (the builder's Organization record has neither
 * an address nor the community's name). Coordinates are only used to check the
 * distance from downtown here; they are never stored.
 */
export function communityRecordFromHtml(html: string): CommunityRecord | null {
  for (const object of jsonLdObjects(html)) {
    const type = Array.isArray(object["@type"]) ? (object["@type"] as unknown[]).map(String) : [String(object["@type"] ?? "")];
    if (!type.some((value) => BUSINESS_TYPES.test(value)) || type.includes("Organization")) continue;
    const address = (Array.isArray(object.address) ? object.address[0] : object.address) as JsonObject | undefined;
    const name = text(object.name);
    if (!address || typeof address !== "object" || !name) continue;
    const zip = /\b(\d{5})(?:-\d{4})?\b/.exec(text(address.postalCode))?.[1] ?? null;
    const region = text(address.addressRegion);
    if (region && !/^(?:TX|Texas)$/i.test(region)) continue;
    const geoObject = object.geo as JsonObject | undefined;
    const lat = Number(geoObject?.latitude);
    const lng = Number(geoObject?.longitude);
    const phone = text(object.telephone).replace(/[^\d+]/g, "") || null;
    return {
      name,
      street: text(address.streetAddress) || null,
      city: text(address.addressLocality) || null,
      zip,
      phone,
      priceFrom: priceFromRange(object.priceRange),
      geo: Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0) ? { lat, lng } : null,
    };
  }
  return null;
}

export type BuilderDiscovery = {
  builder: string;
  ok: boolean;
  reason?: "sitemap_unreadable";
  communities: DiscoveredCommunity[];
  /** Community pages skipped: no record, outside the area, or unreadable. */
  skipped: Array<{ url: string; reason: "no_community_record" | "outside_area" | "page_unreadable" }>;
};

/** One builder's San Antonio area communities, read from its own site, one page at a time. */
export async function discoverBuilderCommunities(reader: DiscoveryReader, fetcher: HtmlFetcher = fetch): Promise<BuilderDiscovery> {
  const result: BuilderDiscovery = { builder: reader.builder, ok: false, communities: [], skipped: [] };
  const urls = await officialSitemapUrls(reader.sitemap, reader.host, fetcher);
  if (!urls) return { ...result, reason: "sitemap_unreadable" };
  const pages = Array.from(new Set(urls.flatMap((raw) => {
    const url = asUrl(raw);
    return url && sameOfficialHost(url, reader.host) && reader.communityPath.test(url.pathname) ? [url.toString()] : [];
  }))).slice(0, MAX_COMMUNITY_PAGES);
  for (const url of pages) {
    const page = await getDocument(url, fetcher, "text/html,application/xhtml+xml", reader.host);
    if (!page.ok) { result.skipped.push({ url, reason: "page_unreadable" }); continue; }
    const record = communityRecordFromHtml(page.text);
    if (!record) { result.skipped.push({ url, reason: "no_community_record" }); continue; }
    if (record.geo && milesBetween(DOWNTOWN_SAN_ANTONIO, record.geo) > DISCOVERY_RADIUS_MILES) { result.skipped.push({ url, reason: "outside_area" }); continue; }
    const address = [record.street, record.city, record.zip ? `TX ${record.zip}` : "TX"].filter(Boolean).join(", ");
    result.communities.push({
      builder: reader.builder,
      name: record.name,
      sourceUrl: url,
      city: record.city,
      zip: record.zip,
      address,
      salesPhone: record.phone,
      // Close-outs are added too: their last homes are often the best deals. The first sync decides what shows.
      status: "selling",
      priceFrom: record.priceFrom,
    });
  }
  return { ...result, ok: true };
}

export type DiscoveryRun = { builders: Array<{ builder: string; ok: boolean; reason?: string; found: number; skipped: number; created: number; existing: number }>; created: number };

/**
 * Discovery for every builder with a reader, then onboarding. A builder whose
 * sitemap cannot be read is reported and adds nothing; the others carry on.
 */
export async function discoverAndOnboardAll(fetcher: HtmlFetcher = fetch, readers: readonly DiscoveryReader[] = DISCOVERY_READERS, createdIds: number[] = []): Promise<DiscoveryRun> {
  const run: DiscoveryRun = { builders: [], created: 0 };
  for (const reader of readers) {
    if (!hasBuilderReader(reader.builder)) continue;
    let found: BuilderDiscovery;
    try {
      found = await discoverBuilderCommunities(reader, fetcher);
    } catch (error) {
      console.error(`[deals-discovery] ${reader.builder} failed`, error instanceof Error ? error.message : error);
      run.builders.push({ builder: reader.builder, ok: false, reason: "discovery_failed", found: 0, skipped: 0, created: 0, existing: 0 });
      continue;
    }
    let onboarded: OnboardingResult = { created: [], existing: 0, skipped: [] };
    if (found.ok && found.communities.length) onboarded = await onboardDiscoveredCommunities(found.communities);
    run.builders.push({ builder: reader.builder, ok: found.ok, reason: found.reason, found: found.communities.length, skipped: found.skipped.length + onboarded.skipped.length, created: onboarded.created.length, existing: onboarded.existing });
    run.created += onboarded.created.length;
    createdIds.push(...onboarded.created);
  }
  return run;
}

let discoveryRunning = false;

/** Tells the sync recipients what was found; only when something new was added. Never fails the run. */
export async function emailDiscoveryRun(run: DiscoveryRun, createdIds: readonly number[]): Promise<void> {
  if (!createdIds.length && run.builders.every((builder) => builder.ok)) return;
  try {
    const db = await getDb();
    const rows = db && createdIds.length ? await db.select({ builder: dealCommunities.builder, privateName: dealCommunities.privateName }).from(dealCommunities).where(inArray(dealCommunities.id, [...createdIds])) : [];
    const lines = [
      createdIds.length ? `${createdIds.length} new communit${createdIds.length === 1 ? "y was" : "ies were"} found on the builders' sites. Each one stays hidden until its first clean update, then goes live by itself.` : "No new communities this time.",
      "",
      ...rows.map((row) => `  ${row.privateName} (${row.builder})`),
      ...(rows.length ? [""] : []),
      ...run.builders.filter((builder) => !builder.ok).map((builder) => `  Could not read ${builder.builder}'s site list this time (${builder.reason ?? "unknown"}). Nothing was changed for that builder.`),
      "",
      "Review in Admin, Builder Deals: /admin/deals",
    ];
    const { syncEmailRecipients } = await getDealSettings();
    await sendBuilderDealsEmail({ category: "deals_discovery", recipients: syncEmailRecipients, subject: createdIds.length ? `Builder Deals: ${createdIds.length} new communit${createdIds.length === 1 ? "y" : "ies"} found` : "Builder Deals: a builder's site list could not be read", content: lines.join("\n") });
  } catch (error) {
    console.error("[deals-discovery] email failed", error instanceof Error ? error.message : error);
  }
}

/** The weekly job and the Admin button: discover, onboard, email. One run at a time per server. */
export async function runCommunityDiscovery(fetcher: HtmlFetcher = fetch): Promise<DiscoveryRun | { skipped: "already_running" }> {
  if (discoveryRunning) return { skipped: "already_running" };
  discoveryRunning = true;
  try {
    const createdIds: number[] = [];
    const run = await discoverAndOnboardAll(fetcher, DISCOVERY_READERS, createdIds);
    await emailDiscoveryRun(run, createdIds);
    return run;
  } finally {
    discoveryRunning = false;
  }
}
