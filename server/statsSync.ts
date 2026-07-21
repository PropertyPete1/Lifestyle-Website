/**
 * Daily FUB → site stats sync.
 *
 * Pulls closed/won deals from the Follow Up Boss Deals API, computes the four
 * homepage track-record figures, and writes them into the site_stats table.
 *
 * Graceful degradation: any failure (network, auth, empty data) leaves the
 * existing site_stats rows untouched — the site keeps showing the last
 * successfully synced values. We never write zeros or partial data.
 *
 * Sanity floor: deals under $50k are excluded from price-range/average math
 * (they are typically referral fees or data-entry artifacts, e.g. $1,465),
 * but still count toward closed-sale count/total when >= $1k.
 */
import { fubHeaders } from "./fub";
import * as db from "./db";

const FUB_BASE = "https://api.followupboss.com/v1";
const PRICE_FLOOR = 50_000; // below this: not a home sale price

type FubDeal = { id: number; stageId: number; price: number };

async function fubGet(path: string, apiKey: string): Promise<any> {
  const res = await fetch(`${FUB_BASE}${path}`, { headers: fubHeaders(apiKey) });
  if (!res.ok) throw new Error(`FUB ${path} → ${res.status}`);
  return res.json();
}

/** Fetch ids of stages flagged closedStage=true across all pipelines. */
export async function fetchClosedStageIds(apiKey: string): Promise<Set<number>> {
  const data = await fubGet("/pipelines", apiKey);
  const ids = new Set<number>();
  for (const pl of data.pipelines ?? []) {
    for (const st of pl.stages ?? []) {
      if (st.closedStage) ids.add(st.id);
    }
  }
  return ids;
}

/** Page through all deals (bounded) and return them. */
export async function fetchAllDeals(apiKey: string, maxPages = 20): Promise<FubDeal[]> {
  const all: FubDeal[] = [];
  let next: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({ limit: "100" });
    if (next) qs.set("next", next);
    const data = await fubGet(`/deals?${qs}`, apiKey);
    all.push(...(data.deals ?? []));
    next = data._metadata?.next ?? null;
    if (!next) break;
  }
  return all;
}

export interface ComputedStats {
  closedSales: number;
  totalValue: number;
  minPrice: number;
  maxPrice: number;
  avgPrice: number;
}

/** Compute track-record stats from closed deals. Returns null if data is too thin to trust. */
export function computeStats(deals: FubDeal[], closedStageIds: Set<number>): ComputedStats | null {
  const closed = deals.filter((d) => closedStageIds.has(d.stageId) && d.price >= 1000);
  if (closed.length < 5) return null; // too thin — do not overwrite good data
  const homePrices = closed.map((d) => d.price).filter((p) => p >= PRICE_FLOOR);
  if (homePrices.length < 5) return null;
  const totalValue = closed.reduce((a, d) => a + d.price, 0);
  return {
    closedSales: closed.length,
    totalValue,
    minPrice: Math.min(...homePrices),
    maxPrice: Math.max(...homePrices),
    avgPrice: Math.round(homePrices.reduce((a, b) => a + b, 0) / homePrices.length),
  };
}

/* ---------- display formatting (matches existing strip style) ---------- */
export function fmtShort(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    const rounded = Math.round(m * 10) / 10; // one decimal, e.g. 16.5
    return `$${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded}M`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return `$${k >= 100 ? Math.round(k) : Math.round(k * 10) / 10}K`;
  }
  return `$${n}`;
}

export function statsToRows(s: ComputedStats): { label: string; value: string; sortOrder: number }[] {
  return [
    { label: "Closed Sales", value: String(s.closedSales), sortOrder: 1 },
    { label: "Total Value", value: fmtShort(s.totalValue), sortOrder: 2 },
    { label: "Price Range", value: `${fmtShort(s.minPrice)}–${fmtShort(s.maxPrice)}`, sortOrder: 3 },
    { label: "Average Price", value: fmtShort(s.avgPrice), sortOrder: 4 },
  ];
}

/**
 * Full sync: fetch → compute → upsert site_stats by label.
 * Throws on failure (caller decides how to surface); never writes partial data.
 */
export async function syncStatsFromFub(): Promise<{ updated: boolean; stats?: ComputedStats }> {
  const apiKey = process.env.FUB_API_KEY;
  if (!apiKey) throw new Error("FUB_API_KEY not configured");

  const [closedStageIds, deals] = await Promise.all([
    fetchClosedStageIds(apiKey),
    fetchAllDeals(apiKey),
  ]);
  const computed = computeStats(deals, closedStageIds);
  if (!computed) return { updated: false }; // thin data — keep last-known values

  const rows = statsToRows(computed);
  const existing = await db.getSiteStats();
  for (const row of rows) {
    const match = existing.find((e) => e.label.toLowerCase() === row.label.toLowerCase());
    if (match) {
      await db.updateSiteStat(match.id, { value: row.value, sortOrder: row.sortOrder });
    } else {
      await db.createSiteStat(row);
    }
  }
  return { updated: true, stats: computed };
}
