import { readFile } from "node:fs/promises";
import path from "node:path";
import { onboardDiscoveredCommunities, type DiscoveredCommunity, type OnboardingResult } from "./dealsOnboarding";

/**
 * The research list (research/sa-communities.csv): every builder community in
 * the San Antonio area, read from the builders' own sites. Importing it adds
 * each one as a hidden community that goes live once its builder has a reader
 * and its first clean pull succeeds. Running it again adds only what is new.
 */
export const RESEARCH_COMMUNITIES_CSV = path.resolve(process.cwd(), "research", "sa-communities.csv");

/** Builder names as the research spells them, mapped to the names the readers use. */
const BUILDER_ALIASES: Record<string, string> = { "chesmar homes": "Chesmar", "m/i homes": "M/I Homes", "mi homes": "M/I Homes", "dr horton": "D.R. Horton", "d r horton": "D.R. Horton", "d. r. horton": "D.R. Horton", "drhorton": "D.R. Horton", "d.r. horton homes": "D.R. Horton", "pulte homes": "Pulte", "pultegroup": "Pulte", "centex homes": "Centex", "del webb homes": "Del Webb", "first america": "First America Homes", "coventry": "Coventry Homes", "davidson": "Davidson Homes", "highland": "Highland Homes", "century": "Century Communities", "kb homes": "KB Home", "kb": "KB Home", "kbhome": "KB Home", "toll": "Toll Brothers", "toll brothers inc": "Toll Brothers", "david weekley": "David Weekley Homes", "weekley": "David Weekley Homes", "weekley homes": "David Weekley Homes", "ashton woods homes": "Ashton Woods", "ashton": "Ashton Woods", "lgi": "LGI Homes", "lgi homes inc": "LGI Homes", "sitterle": "Sitterle Homes", "scott felder": "Scott Felder Homes", "scottfelder": "Scott Felder Homes", "scott felder homes inc": "Scott Felder Homes", "drb": "DRB Homes", "drb group": "DRB Homes", "drb homes": "DRB Homes", "dan ryan builders": "DRB Homes", "starlight": "Starlight Homes", "starlight homes llc": "Starlight Homes", "legend": "Legend Homes", "legend homes": "Legend Homes", "legend home": "Legend Homes" };

export function builderNameFor(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim();
  return BUILDER_ALIASES[name.toLowerCase()] ?? name;
}

/** RFC 4180 style: quoted fields may hold commas, quotes ("") and newlines. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char === "\"") {
        if (text[index + 1] === "\"") { field += "\""; index += 1; } else quoted = false;
      } else field += char;
    } else if (char === "\"") quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else field += char;
  }
  if (field || row.length) { row.push(field); if (row.some((value) => value.trim())) rows.push(row); }
  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((key) => key.trim().replace(/^﻿/, ""));
  return body.map((values) => Object.fromEntries(keys.map((key, index) => [key, (values[index] ?? "").trim()])));
}

function money(value: string): number | null {
  const match = /\$?\s*([\d,]{5,})/.exec(value);
  const price = match ? Number(match[1]!.replace(/,/g, "")) : NaN;
  return Number.isFinite(price) && price >= 50_000 ? price : null;
}

function statusOf(value: string): DiscoveredCommunity["status"] {
  const text = value.toLowerCase();
  if (/close/.test(text)) return "closeout";
  if (/coming/.test(text)) return "coming_soon";
  return "selling";
}

/** One research row as a discovered community; null when it is unusable (no name or URL). */
export function discoveredFromResearchRow(row: Record<string, string>): DiscoveredCommunity | null {
  const name = row.community_name?.trim();
  const sourceUrl = row.official_community_url?.trim();
  if (!name || !sourceUrl) return null;
  const address = (row.model_home_or_sales_address ?? "").replace(/\s*\n\s*/g, ", ").replace(/\s+/g, " ").trim();
  const zip = /^\d{5}$/.test(row.zip ?? "") ? row.zip : /\b(\d{5})(?:-\d{4})?\s*$/.exec(address)?.[1] ?? null;
  const count = Number.parseInt(row.move_in_ready_count ?? "", 10);
  return {
    builder: builderNameFor(row.builder ?? ""),
    name,
    sourceUrl,
    city: row.city?.trim() || null,
    zip,
    address: address || null,
    salesPhone: row.sales_phone?.trim() || null,
    status: statusOf(row.status ?? ""),
    priceFrom: money(row.price_from ?? ""),
    lotSizesText: row.lot_sizes_text?.trim() || null,
    schoolDistrict: row.school_district?.trim() || null,
    moveInReadyCount: Number.isFinite(count) ? count : null,
  };
}

export type ResearchImportResult = OnboardingResult & { rows: number; unusable: number; builders: number };

export async function importResearchCommunities(csvPath = RESEARCH_COMMUNITIES_CSV): Promise<ResearchImportResult> {
  const rows = parseCsv(await readFile(csvPath, "utf8"));
  const usable = rows.map(discoveredFromResearchRow).filter((community): community is DiscoveredCommunity => community !== null && community.builder.trim().length > 0);
  // The same community page listed twice is one community.
  const seen = new Set<string>();
  const discovered = usable.filter((community) => { const key = community.sourceUrl.replace(/\/+$/, "").toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
  const result = await onboardDiscoveredCommunities(discovered);
  // Builders counted on the rows actually offered: close-outs are skipped by onboarding, so a builder with only those is not one.
  const offered = discovered.filter((community) => community.status !== "closeout");
  return { ...result, rows: rows.length, unusable: rows.length - usable.length, builders: new Set(offered.map((community) => community.builder)).size };
}
