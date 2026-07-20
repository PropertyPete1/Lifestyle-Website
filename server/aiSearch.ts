/**
 * AI natural-language property search.
 * Extracts structured criteria from a plain-English query via the built-in LLM,
 * then filters the listing data (data-source-agnostic: works against
 * placeholder listings now, MLS/IDX-fed listings in Phase 2).
 * Includes a regex fallback so search still works if the LLM is unavailable.
 */
import { invokeLLM } from "./_core/llm";
import type { Listing } from "../drizzle/schema";

export interface SearchCriteria {
  city?: string;
  minPrice?: number;
  maxPrice?: number;
  minBeds?: number;
  minBaths?: number;
  minSqft?: number;
  hasPool?: boolean;
  isNewConstruction?: boolean;
  /** 1 = single-story only; 2 = two-story or more */
  stories?: number;
  /** primary/master bedroom on first floor */
  primaryBedDown?: boolean;
  propertyType?: string;
  keywords?: string[];
}

const CITIES = ["San Antonio", "New Braunfels", "Austin", "DFW", "Houston", "Boerne", "Kyle", "Alamo Ranch"];

/** Parse criteria with the LLM (structured JSON). */
export async function extractCriteria(query: string): Promise<SearchCriteria> {
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "You extract real-estate search criteria from a natural-language query. " +
            `Known market cities: ${CITIES.join(", ")}. ` +
            "Map neighborhood/suburb mentions to the nearest known city when obvious (e.g. Boerne→Boerne, 'near Austin'→Austin). " +
            "Prices like '400k' mean 400000. 'under X' sets maxPrice, 'over X' sets minPrice. " +
            "'single story/one story' → stories=1; 'two story' → stories=2. " +
            "'primary/master bedroom downstairs/on first/main floor' or 'primary down' → primaryBedDown=true. " +
            "Return only fields the user actually implied.",
        },
        { role: "user", content: query },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "search_criteria",
          strict: true,
          schema: {
            type: "object",
            properties: {
              city: { type: ["string", "null"], description: "One of the known cities, or null" },
              minPrice: { type: ["number", "null"] },
              maxPrice: { type: ["number", "null"] },
              minBeds: { type: ["number", "null"] },
              minBaths: { type: ["number", "null"] },
              minSqft: { type: ["number", "null"] },
              hasPool: { type: ["boolean", "null"] },
              isNewConstruction: { type: ["boolean", "null"] },
              stories: { type: ["number", "null"], description: "1 for single-story, 2 for two-story+" },
              primaryBedDown: { type: ["boolean", "null"], description: "primary bedroom on first floor" },
              propertyType: {
                type: ["string", "null"],
                description: "Residential, Multi-Family, Townhome/Condo, or Land — or null",
              },
              keywords: { type: ["array", "null"], items: { type: "string" } },
            },
            required: [
              "city", "minPrice", "maxPrice", "minBeds", "minBaths", "minSqft",
              "hasPool", "isNewConstruction", "stories", "primaryBedDown", "propertyType", "keywords",
            ],
            additionalProperties: false,
          },
        },
      },
    });
    const raw = response.choices[0]?.message?.content;
    const parsed = JSON.parse(typeof raw === "string" ? raw : "{}") as Record<string, unknown>;
    const out: SearchCriteria = {};
    if (typeof parsed.city === "string" && parsed.city) out.city = parsed.city;
    if (typeof parsed.minPrice === "number") out.minPrice = parsed.minPrice;
    if (typeof parsed.maxPrice === "number") out.maxPrice = parsed.maxPrice;
    if (typeof parsed.minBeds === "number") out.minBeds = parsed.minBeds;
    if (typeof parsed.minBaths === "number") out.minBaths = parsed.minBaths;
    if (typeof parsed.minSqft === "number") out.minSqft = parsed.minSqft;
    if (typeof parsed.hasPool === "boolean") out.hasPool = parsed.hasPool;
    if (typeof parsed.isNewConstruction === "boolean") out.isNewConstruction = parsed.isNewConstruction;
    if (typeof parsed.stories === "number") out.stories = parsed.stories;
    if (typeof parsed.primaryBedDown === "boolean") out.primaryBedDown = parsed.primaryBedDown;
    if (typeof parsed.propertyType === "string" && parsed.propertyType) out.propertyType = parsed.propertyType;
    if (Array.isArray(parsed.keywords)) out.keywords = parsed.keywords.filter((k): k is string => typeof k === "string");
    return out;
  } catch {
    return extractCriteriaFallback(query);
  }
}

/** Regex fallback parser — keeps search functional without the LLM. */
export function extractCriteriaFallback(query: string): SearchCriteria {
  const q = query.toLowerCase();
  const out: SearchCriteria = {};

  for (const c of CITIES) {
    if (q.includes(c.toLowerCase())) { out.city = c; break; }
  }
  const parseMoney = (s: string): number => {
    const n = parseFloat(s.replace(/[$,]/g, ""));
    return /k$/i.test(s.trim()) ? n * 1000 : /m$/i.test(s.trim()) ? n * 1000000 : n < 10 ? n * 1000000 : n < 10000 ? n * 1000 : n;
  };
  const under = q.match(/(?:under|below|less than|max)\s*\$?([\d.,]+\s?[km]?)/i);
  if (under) out.maxPrice = parseMoney(under[1]);
  const over = q.match(/(?:over|above|more than|min)\s*\$?([\d.,]+\s?[km]?)/i);
  if (over) out.minPrice = parseMoney(over[1]);
  const beds = q.match(/(\d+)\s*(?:\+)?\s*(?:bed|br|bedroom)/i);
  if (beds) out.minBeds = parseInt(beds[1]);
  const baths = q.match(/(\d+(?:\.\d+)?)\s*(?:\+)?\s*(?:bath|ba)/i);
  if (baths) out.minBaths = parseFloat(baths[1]);
  if (/pool/.test(q)) out.hasPool = true;
  if (/new\s*(?:construction|build)/.test(q)) out.isNewConstruction = true;
  if (/single[- ]?story|one[- ]?story/.test(q)) out.stories = 1;
  else if (/two[- ]?story|2[- ]?story/.test(q)) out.stories = 2;
  if (/(?:primary|master)\s*(?:bed(?:room)?)?\s*(?:down(?:stairs)?|on\s*(?:the\s*)?(?:first|main|1st)\s*floor)/.test(q)) out.primaryBedDown = true;
  if (/multi[- ]?family|duplex|fourplex/.test(q)) out.propertyType = "Multi-Family";
  else if (/townhome|townhouse|condo/.test(q)) out.propertyType = "Townhome/Condo";
  return out;
}

/** Apply criteria against listings (works on any listing source). */
export function matchListings(listings: Listing[], c: SearchCriteria): Listing[] {
  return listings.filter((l) => {
    if (c.city && l.city.toLowerCase() !== c.city.toLowerCase()) {
      // allow neighborhood cities to match their address/description
      const hay = `${l.address} ${l.description ?? ""}`.toLowerCase();
      if (!hay.includes(c.city.toLowerCase())) return false;
    }
    if (c.minPrice !== undefined && l.price < c.minPrice) return false;
    if (c.maxPrice !== undefined && l.price > c.maxPrice) return false;
    if (c.minBeds !== undefined && l.beds < c.minBeds) return false;
    if (c.minBaths !== undefined && Number(l.baths) < c.minBaths) return false;
    if (c.minSqft !== undefined && l.sqft < c.minSqft) return false;
    if (c.hasPool && !l.hasPool) return false;
    if (c.isNewConstruction && !l.isNewConstruction) return false;
    if (c.stories === 1 && l.stories !== 1) return false;
    if (c.stories !== undefined && c.stories >= 2 && l.stories < 2) return false;
    if (c.primaryBedDown && !l.primaryBedDown) return false;
    if (c.propertyType && l.propertyType !== c.propertyType) return false;
    return true;
  });
}
