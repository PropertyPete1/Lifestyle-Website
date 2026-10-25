/**
 * Public area labels and headlines for communities the system adds by itself.
 * Only coarse, generic words: a side of San Antonio or Austin or a larger nearby town,
 * and a short feature phrase built from a fixed vocabulary, so a generated
 * label can never carry a builder, community, street or plan name.
 */

export const DOWNTOWN_SAN_ANTONIO = { lat: 29.4241, lng: -98.4936 } as const;
export const DOWNTOWN_AUSTIN = { lat: 30.2672, lng: -97.7431 } as const;
/** Inside this distance a community is "Central San Antonio" (or "Central Austin"). */
const CENTRAL_MILES = 4;
/** Beyond this distance the label names the nearby town (when it is a larger one) instead of a side of San Antonio. */
const METRO_MILES = 22;
const EARTH_MILES = 3958.8;

/**
 * The two markets (October 25, 2026, Peter: Austin, Kyle, San Marcos, Georgetown and their towns, asked for more than
 * once). A point takes the nearer market's labels: a side of that city inside its metro, else a listed town, else "a side
 * of" the city. Austin's metro is smaller, so its suburbs (Pflugerville, Round Rock, Cedar Park, Buda) keep their names.
 */
export const MARKETS = [
  { name: "San Antonio", center: DOWNTOWN_SAN_ANTONIO, metroMiles: METRO_MILES },
  { name: "Austin", center: DOWNTOWN_AUSTIN, metroMiles: 12 },
] as const;
export type MarketName = (typeof MARKETS)[number]["name"];

/** The market whose downtown is nearer the point. */
export function marketOf(point: { lat: number; lng: number }): (typeof MARKETS)[number] {
  return milesBetween(point, DOWNTOWN_AUSTIN) < milesBetween(point, DOWNTOWN_SAN_ANTONIO) ? MARKETS[1] : MARKETS[0];
}

/**
 * Towns a label may name (outside the metro only); a town not listed falls back to the side of San Antonio. October 24,
 * 2026 (Peter): the outskirt towns buyers search by name (Castroville, Mico, Lytle and the rest) are named too; each has
 * several communities, so the name never points at one. October 25: the Austin market's towns, and the far outskirts
 * (Fredericksburg, Kerrville, Gonzales, Luling).
 */
export const MAJOR_TOWNS = ["New Braunfels", "Seguin", "Boerne", "Floresville", "Pleasanton", "Bulverde", "Spring Branch", "Canyon Lake", "Castroville", "Mico", "Hondo", "Lytle", "Devine", "La Vernia", "Marion", "Bandera", "Poteet", "Comfort",
  "Fredericksburg", "Kerrville", "Gonzales", "Luling",
  "Round Rock", "Pflugerville", "Georgetown", "Leander", "Cedar Park", "Hutto", "Manor", "Kyle", "Buda", "San Marcos", "Dripping Springs", "Liberty Hill", "Lockhart", "Bastrop", "Taylor", "Elgin", "Jarrell", "Florence", "Bee Cave", "Lakeway", "Lago Vista", "Wimberley", "Maxwell"] as const;

/** The towns of the Austin market, for grouping area labels (every other town is San Antonio's). */
export const AUSTIN_TOWNS: ReadonlySet<string> = new Set(["Round Rock", "Pflugerville", "Georgetown", "Leander", "Cedar Park", "Hutto", "Manor", "Kyle", "Buda", "San Marcos", "Dripping Springs", "Liberty Hill", "Lockhart", "Bastrop", "Taylor", "Elgin", "Jarrell", "Florence", "Bee Cave", "Lakeway", "Lago Vista", "Wimberley", "Maxwell"]);

/** Which market an area label belongs to: "Austin" for a side of Austin, "Greater Austin" or an Austin-market town; otherwise "San Antonio". */
export function areaMarketName(area: string): "San Antonio" | "Austin" {
  const label = area.trim();
  if (/\bAustin\b/i.test(label) || AUSTIN_TOWNS.has(label)) return "Austin";
  return "San Antonio";
}

/** Each town's centre (approximate). Outside the metro, a community whose builder lists "San Antonio" (Perry's
 * Esperanza, 3 miles from Boerne) takes the name of a town within TOWN_MILES of its ZIP centre (Peter, Oct 24: "where
 * are all the communities in Boerne"). */
const TOWN_CENTERS: Record<(typeof MAJOR_TOWNS)[number], { lat: number; lng: number }> = {
  "New Braunfels": { lat: 29.703, lng: -98.1245 }, Seguin: { lat: 29.5688, lng: -97.9647 }, Boerne: { lat: 29.7947, lng: -98.732 },
  Floresville: { lat: 29.1336, lng: -98.1561 }, Pleasanton: { lat: 28.9672, lng: -98.4786 }, Bulverde: { lat: 29.7438, lng: -98.4531 },
  "Spring Branch": { lat: 29.8808, lng: -98.387 }, "Canyon Lake": { lat: 29.8752, lng: -98.2625 }, Castroville: { lat: 29.3558, lng: -98.8786 },
  Mico: { lat: 29.5466, lng: -98.9083 }, Hondo: { lat: 29.3475, lng: -99.1417 }, Lytle: { lat: 29.2333, lng: -98.7964 },
  Devine: { lat: 29.1394, lng: -98.9031 }, "La Vernia": { lat: 29.3566, lng: -98.1156 }, Marion: { lat: 29.5713, lng: -98.142 },
  Bandera: { lat: 29.7266, lng: -99.0737 }, Poteet: { lat: 29.0408, lng: -98.5681 }, Comfort: { lat: 29.9677, lng: -98.905 },
  Fredericksburg: { lat: 30.2752, lng: -98.8720 }, Kerrville: { lat: 30.0474, lng: -99.1403 }, Gonzales: { lat: 29.5016, lng: -97.4525 },
  Luling: { lat: 29.6805, lng: -97.6475 },
  "Round Rock": { lat: 30.5083, lng: -97.6789 }, Pflugerville: { lat: 30.4394, lng: -97.62 }, Georgetown: { lat: 30.6333, lng: -97.6772 },
  Leander: { lat: 30.5788, lng: -97.8531 }, "Cedar Park": { lat: 30.5052, lng: -97.8203 }, Hutto: { lat: 30.5427, lng: -97.5467 },
  Manor: { lat: 30.3408, lng: -97.5569 }, Kyle: { lat: 29.9891, lng: -97.8772 }, Buda: { lat: 30.0852, lng: -97.8403 },
  "San Marcos": { lat: 29.8833, lng: -97.9414 }, "Dripping Springs": { lat: 30.1902, lng: -98.0867 }, "Liberty Hill": { lat: 30.6649, lng: -97.9225 },
  Lockhart: { lat: 29.8849, lng: -97.67 }, Bastrop: { lat: 30.1105, lng: -97.3153 }, Taylor: { lat: 30.5708, lng: -97.4094 },
  Elgin: { lat: 30.3497, lng: -97.3703 }, Jarrell: { lat: 30.8249, lng: -97.6045 }, Florence: { lat: 30.8413, lng: -97.7939 },
  "Bee Cave": { lat: 30.3085, lng: -97.945 }, Lakeway: { lat: 30.3638, lng: -97.9797 }, "Lago Vista": { lat: 30.4602, lng: -97.9883 },
  Wimberley: { lat: 29.9974, lng: -98.0986 }, Maxwell: { lat: 29.8819, lng: -97.7969 },
};
const TOWN_MILES = 9;

/** The listed town nearest a point, when one is within TOWN_MILES. */
export function nearestTown(point: { lat: number; lng: number }): string | null {
  let best: { town: string; miles: number } | null = null;
  for (const town of MAJOR_TOWNS) {
    const miles = milesBetween(point, TOWN_CENTERS[town]);
    if (miles <= TOWN_MILES && (!best || miles < best.miles)) best = { town, miles };
  }
  return best?.town ?? null;
}

const SECTORS = ["North", "Northeast", "East", "Southeast", "South", "Southwest", "West", "Northwest"] as const;
export type Sector = (typeof SECTORS)[number];

function toRad(value: number) {
  return value * Math.PI / 180;
}

export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return EARTH_MILES * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Compass bearing from a downtown (San Antonio's unless given), 0 = north, clockwise. */
export function bearingFromDowntown(point: { lat: number; lng: number }, downtown: { lat: number; lng: number } = DOWNTOWN_SAN_ANTONIO): number {
  const lat1 = toRad(downtown.lat);
  const lat2 = toRad(point.lat);
  const dLng = toRad(point.lng - downtown.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function sectorOf(point: { lat: number; lng: number }, downtown: { lat: number; lng: number } = DOWNTOWN_SAN_ANTONIO): Sector {
  return SECTORS[Math.round(bearingFromDowntown(point, downtown) / 45) % 8]!;
}

function townName(city: string | null | undefined): string | null {
  const wanted = city?.trim().toLowerCase();
  return MAJOR_TOWNS.find((town) => town.toLowerCase() === wanted) ?? null;
}

/**
 * "Southeast San Antonio", "Central San Antonio", "New Braunfels", "North Austin", "Round Rock" or "South of San
 * Antonio", from the ZIP code centroid (never the community) and the city the builder lists. Without a centroid only a
 * larger town's name, else the market the city names, else San Antonio's.
 */
export function areaLabelFor(input: { centroid?: { lat: number; lng: number } | null; city?: string | null }): string {
  const town = townName(input.city);
  if (!input.centroid) return town ?? (/^\s*austin\s*$/i.test(input.city ?? "") ? "Greater Austin" : "Greater San Antonio");
  const market = marketOf(input.centroid);
  const miles = milesBetween(market.center, input.centroid);
  if (miles <= CENTRAL_MILES) return `Central ${market.name}`;
  const sector = sectorOf(input.centroid, market.center);
  // Inside the metro, a side of town is coarse enough; a suburb's own name would point at too few communities.
  if (miles <= market.metroMiles) return `${sector} ${market.name}`;
  return town ?? nearestTown(input.centroid) ?? `${sector} of ${market.name}`;
}

/** True for an area label this module generates (a side of San Antonio or Austin, a listed town, or the market). */
export function isGeneratedArea(area: string): boolean {
  return (MAJOR_TOWNS as readonly string[]).includes(area) || MARKETS.some(({ name }) => area === `Greater ${name}` || area === `Central ${name}`
    || SECTORS.some((sector) => area === `${sector} ${name}` || area === `${sector} of ${name}`));
}

/**
 * A live community's generated area, brought up to date (its ZIP centroid arrived after it was first labeled, or the
 * town list grew): the headline keeps its words, only the area in front of " | " changes. Null when nothing changes, or
 * when the label is not the generated shape (an admin's own label is never touched).
 */
export function refreshedAreaLabel(row: { areaLabel: string; publicLabel: string; centroid: { lat: number; lng: number } | null; city: string | null; fromPrice?: number | null }): { areaLabel: string; publicLabel: string } | null {
  if (!isGeneratedArea(row.areaLabel) || !row.publicLabel.startsWith(`${row.areaLabel} | `)) return null;
  const area = areaLabelFor({ centroid: row.centroid, city: row.city });
  let headline = row.publicLabel.slice(row.areaLabel.length);
  // The headline's price band follows the community's current starting price (Oct 24: "From the $500s" over a $449,999 card).
  const band = row.fromPrice ? priceBand(row.fromPrice) : null;
  if (band) headline = headline.replace(/From the \$\d00s|Over \$1M|Under \$100K/, band);
  const publicLabel = `${area}${headline}`.slice(0, 190);
  if (area === row.areaLabel && publicLabel === row.publicLabel) return null;
  return { areaLabel: area, publicLabel };
}

/** Facts a headline may be built from; every phrase comes from the fixed vocabulary below. */
export type HeadlineFacts = {
  acres?: number | null;
  fromPrice?: number | null;
  moveInReadyCount?: number | null;
  amenities?: readonly string[] | null;
};

const AMENITY_WORDS: Array<[RegExp, string]> = [
  [/\blakes?\b/i, "Lakes"],
  [/\bresort[-\s]?style\b|\bpools?\b/i, "Resort-Style Pool"],
  [/\btrails?\b/i, "Trails"],
  [/\bgolf\b/i, "Golf"],
  [/\bhill\s*country\b|\bviews?\b/i, "Hill Country Views"],
  [/\bpark(s|land)?\b/i, "Parks"],
];

function lotPhrase(acres: number): string {
  if (acres >= 1) return "Acre Lots";
  if (acres >= 0.5) return "Half-Acre Lots";
  return "Large Lots";
}

/** "$2XXs" style price band; never the exact price. */
export function priceBand(price: number): string | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  if (price >= 1_000_000) return "Over $1M";
  if (price < 100_000) return "Under $100K";
  return `From the $${Math.floor(price / 100_000)}00s`;
}

/** Up to two short phrases joined with "and": "Half-Acre Lots and Lakes", "From the $200s and Move-In Ready Homes". */
export function headlineFor(facts: HeadlineFacts): string {
  const phrases: string[] = [];
  if (facts.acres && facts.acres >= 0.25) phrases.push(lotPhrase(facts.acres));
  for (const [pattern, word] of AMENITY_WORDS) {
    if (phrases.length >= 2) break;
    if ((facts.amenities ?? []).some((amenity) => pattern.test(amenity)) && !phrases.includes(word)) phrases.push(word);
  }
  if (phrases.length < 2 && facts.fromPrice) {
    const band = priceBand(facts.fromPrice);
    if (band) phrases.push(band);
  }
  if (phrases.length < 2 && facts.moveInReadyCount && facts.moveInReadyCount > 0) phrases.push("Move-In Ready Homes");
  return phrases.length ? phrases.slice(0, 2).join(" and ") : "New Homes";
}

export function publicLabelFor(area: string, facts: HeadlineFacts): string {
  return `${area} | ${headlineFor(facts)}`;
}
