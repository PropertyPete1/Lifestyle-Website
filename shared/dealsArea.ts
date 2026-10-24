/**
 * Public area labels and headlines for communities the system adds by itself.
 * Only coarse, generic words: a side of San Antonio or a larger nearby town,
 * and a short feature phrase built from a fixed vocabulary, so a generated
 * label can never carry a builder, community, street or plan name.
 */

export const DOWNTOWN_SAN_ANTONIO = { lat: 29.4241, lng: -98.4936 } as const;
/** Inside this distance a community is "Central San Antonio". */
const CENTRAL_MILES = 4;
/** Beyond this distance the label names the nearby town (when it is a larger one) instead of a side of San Antonio. */
const METRO_MILES = 22;
const EARTH_MILES = 3958.8;

/**
 * Towns a label may name (outside the metro only); a town not listed falls back to the side of San Antonio. October 24,
 * 2026 (Peter): the outskirt towns buyers search by name (Castroville, Mico, Lytle and the rest) are named too; each has
 * several communities, so the name never points at one.
 */
export const MAJOR_TOWNS = ["New Braunfels", "Seguin", "Boerne", "Floresville", "Pleasanton", "Bulverde", "Spring Branch", "Canyon Lake", "Castroville", "Mico", "Hondo", "Lytle", "Devine", "La Vernia", "Marion", "Bandera", "Poteet", "Comfort"] as const;

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

/** Compass bearing from downtown, 0 = north, clockwise. */
export function bearingFromDowntown(point: { lat: number; lng: number }): number {
  const lat1 = toRad(DOWNTOWN_SAN_ANTONIO.lat);
  const lat2 = toRad(point.lat);
  const dLng = toRad(point.lng - DOWNTOWN_SAN_ANTONIO.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function sectorOf(point: { lat: number; lng: number }): Sector {
  return SECTORS[Math.round(bearingFromDowntown(point) / 45) % 8]!;
}

function townName(city: string | null | undefined): string | null {
  const wanted = city?.trim().toLowerCase();
  return MAJOR_TOWNS.find((town) => town.toLowerCase() === wanted) ?? null;
}

/**
 * "Southeast San Antonio", "Central San Antonio", "New Braunfels" or "South of
 * San Antonio", from the ZIP code centroid (never the community) and the city
 * the builder lists. Without a centroid only a larger town's name, else the metro.
 */
export function areaLabelFor(input: { centroid?: { lat: number; lng: number } | null; city?: string | null }): string {
  const town = townName(input.city);
  if (!input.centroid) return town ?? "Greater San Antonio";
  const miles = milesBetween(DOWNTOWN_SAN_ANTONIO, input.centroid);
  if (miles <= CENTRAL_MILES) return "Central San Antonio";
  const sector = sectorOf(input.centroid);
  // Inside the metro, a side of town is coarse enough; a suburb's own name would point at too few communities.
  if (miles <= METRO_MILES) return `${sector} San Antonio`;
  return town ?? nearestTown(input.centroid) ?? `${sector} of San Antonio`;
}

/** True for an area label this module generates (a side of San Antonio, a listed town, or the metro). */
export function isGeneratedArea(area: string): boolean {
  return area === "Greater San Antonio" || area === "Central San Antonio" || (MAJOR_TOWNS as readonly string[]).includes(area)
    || SECTORS.some((sector) => area === `${sector} San Antonio` || area === `${sector} of San Antonio`);
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
