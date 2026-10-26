/**
 * SCHOOL DISTRICTS (October 26, 2026): one canonical name per district, however a builder wrote it.
 *
 * Builders' pages give the district in every form: "NEISD", "Comal I.S.D.", "East Central Independent School
 * District", "Top-rated Shertz-Cibolo-Universal City ISD" (a marketing word and a typo), and page-scrape residue like
 * "Information Schools Schools Northside ISD". The site shows "Northside ISD" for all of them. A string with no
 * recognisable district in it ("N/A", "Independent School District", "Guadalupe School District") gives null, and the
 * community's ZIP code decides instead (shared/dealsZipDistricts.ts).
 *
 * Names keep the district's own style: "ISD" for an independent school district, "CISD" where the district is
 * consolidated and calls itself that (Hays CISD, San Marcos CISD, Burnet CISD).
 */

/** Every district the site can name, with the ways builders write it. The first spelling is the canonical one. */
const DISTRICTS: ReadonlyArray<readonly string[]> = [
  // San Antonio and Bexar County
  ["Northside ISD", "nisd", "northside"],
  ["North East ISD", "neisd", "north east", "northeast"],
  ["San Antonio ISD", "saisd", "san antonio isd"],
  ["Judson ISD", "judson"],
  ["East Central ISD", "east central", "east central north"],
  ["Southwest ISD", "southwest", "south west"],
  ["Southside ISD", "southside", "south side"],
  ["South San Antonio ISD", "south san antonio", "south san"],
  ["Harlandale ISD", "harlandale"],
  ["Edgewood ISD", "edgewood"],
  ["Alamo Heights ISD", "alamo heights"],
  ["Somerset ISD", "somerset"],
  ["Lackland ISD", "lackland"],
  ["Fort Sam Houston ISD", "fort sam houston"],
  ["Randolph Field ISD", "randolph field"],
  // Comal, Guadalupe, Kendall, Medina, Wilson, Atascosa, Bandera, Kerr, Gillespie, Gonzales, Caldwell
  ["Comal ISD", "comal"],
  ["New Braunfels ISD", "new braunfels", "nbisd"],
  ["Schertz-Cibolo-Universal City ISD", "schertz-cibolo-universal city", "schertz cibolo universal city", "shertz-cibolo-universal city", "schertz-cibolo-university city", "schertz-cibolo-univ city", "schertz-cibolo", "scuc", "scucisd"],
  ["Seguin ISD", "seguin"],
  ["Navarro ISD", "navarro"],
  ["Marion ISD", "marion"],
  ["Boerne ISD", "boerne"],
  ["Comfort ISD", "comfort"],
  ["Medina Valley ISD", "medina valley", "castroville"],
  ["Medina ISD", "medina isd"],
  ["Hondo ISD", "hondo"],
  ["Devine ISD", "devine"],
  ["Lytle ISD", "lytle"],
  ["La Vernia ISD", "la vernia"],
  ["Floresville ISD", "floresville"],
  ["Pleasanton ISD", "pleasanton"],
  ["Poteet ISD", "poteet"],
  ["Jourdanton ISD", "jourdanton"],
  ["Bandera ISD", "bandera"],
  ["Kerrville ISD", "kerrville"],
  ["Fredericksburg ISD", "fredericksburg"],
  ["Gonzales ISD", "gonzales"],
  ["Luling ISD", "luling"],
  ["Lockhart ISD", "lockhart"],
  ["Nixon-Smiley CISD", "nixon-smiley", "nixon smiley"],
  // Austin area: Travis, Williamson, Hays, Bastrop, Burnet, Caldwell
  ["Austin ISD", "austin isd", "aisd"],
  ["Round Rock ISD", "round rock", "rrisd"],
  ["Pflugerville ISD", "pflugerville", "pfisd"],
  ["Leander ISD", "leander", "lisd"],
  ["Georgetown ISD", "georgetown", "gisd"],
  ["Hutto ISD", "hutto"],
  ["Taylor ISD", "taylor"],
  ["Manor ISD", "manor"],
  ["Del Valle ISD", "del valle"],
  ["Elgin ISD", "elgin"],
  ["Bastrop ISD", "bastrop"],
  ["Hays CISD", "hays", "hays consolidated", "hays cisd", "kyle hays"],
  ["Dripping Springs ISD", "dripping springs"],
  ["Lake Travis ISD", "lake travis", "ltisd"],
  ["Eanes ISD", "eanes"],
  ["Lago Vista ISD", "lago vista"],
  ["Liberty Hill ISD", "liberty hill"],
  ["Jarrell ISD", "jarrell"],
  ["Florence ISD", "florence"],
  ["Thrall ISD", "thrall"],
  ["Coupland ISD", "coupland"],
  ["San Marcos CISD", "san marcos", "san marcos consolidated"],
  ["Wimberley ISD", "wimberley"],
  ["Burnet CISD", "burnet", "burnet consolidated"],
  ["Marble Falls ISD", "marble falls"],
  ["Cedar Creek ISD", "cedar creek"],
  ["Smithville ISD", "smithville"],
  ["Prairie Lea ISD", "prairie lea"],
  // Smaller districts across the two markets' outskirts (the ZIP map names them).
  ["Academy ISD", "academy"],
  ["Bartlett ISD", "bartlett"],
  ["Blanco ISD", "blanco"],
  ["Buckholts ISD", "buckholts"],
  ["Cameron ISD", "cameron"],
  ["Center Point ISD", "center point"],
  ["Charlotte ISD", "charlotte"],
  ["D'Hanis ISD", "d hanis"],
  ["Dilley ISD", "dilley"],
  ["Doss CCSD", "doss"],
  ["Flatonia ISD", "flatonia"],
  ["Giddings ISD", "giddings"],
  ["Granger ISD", "granger"],
  ["Harper ISD", "harper"],
  ["Holland ISD", "holland"],
  ["Hunt ISD", "hunt"],
  ["Ingram ISD", "ingram"],
  ["Johnson City ISD", "johnson city"],
  ["Karnes City ISD", "karnes city"],
  ["Kenedy ISD", "kenedy"],
  ["Killeen ISD", "killeen"],
  ["Knippa ISD", "knippa"],
  ["Lampasas ISD", "lampasas"],
  ["Lexington ISD", "lexington"],
  ["Llano ISD", "llano"],
  ["McDade ISD", "mcdade"],
  ["Milano ISD", "milano"],
  ["Natalia ISD", "natalia"],
  ["Nordheim ISD", "nordheim"],
  ["Pearsall ISD", "pearsall"],
  ["Poth ISD", "poth"],
  ["Rockdale ISD", "rockdale"],
  ["Runge ISD", "runge"],
  ["Sabinal ISD", "sabinal"],
  ["Salado ISD", "salado"],
  ["Stockdale ISD", "stockdale"],
  ["Thorndale ISD", "thorndale"],
  ["Utopia ISD", "utopia"],
  ["Waelder ISD", "waelder"],
  ["Yorktown ISD", "yorktown"],
];

/** Aliases that are only a district when written as the whole district name ("medina isd", never "medina" alone, which is Medina Valley's county). */
const EXACT_ONLY = new Set(["medina isd", "austin isd", "san antonio isd"]);

const canonicalByAlias = new Map<string, string>();
for (const [canonical, ...aliases] of DISTRICTS) {
  canonicalByAlias.set(canonical.toLowerCase(), canonical);
  for (const alias of aliases) canonicalByAlias.set(alias, canonical);
}

/** The canonical names, for a picker. */
export const KNOWN_DISTRICTS: readonly string[] = DISTRICTS.map((entry) => entry[0]!);

/** Lower-case, "I.S.D." -> "isd", "Independent School District" / "School District" -> "isd", punctuation to spaces. */
function simplify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\bi\.?\s*s\.?\s*d\.?/g, " isd ")
    .replace(/\bc\.?\s*i\.?\s*s\.?\s*d\.?/g, " cisd ")
    .replace(/\bconsolidated independent school district\b/g, " cisd ")
    .replace(/\bindependent school district\b/g, " isd ")
    .replace(/\bschool district\b/g, " isd ")
    .replace(/\bindependent\b/g, " isd ")
    .replace(/[^a-z0-9&\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The canonical district in a builder's text, or null when it names none. Where a text names two ("Comal I.S.D. &
 * New Braunfels I.S.D.") the first named wins: the community lists one district on the site.
 */
export function normalizeDistrict(text: string | null | undefined): string | null {
  if (!text) return null;
  const simplified = simplify(text);
  if (!simplified || /^(n ?a|none|tbd|isd)$/.test(simplified)) return null;
  // Longest alias first, so "medina valley" beats "medina" and "schertz-cibolo-universal city" beats "schertz-cibolo".
  const aliases = Array.from(canonicalByAlias.keys()).sort((a, b) => b.length - a.length);
  // A name written right before "ISD" is the district ("Lake Georgetown Liberty Hill ISD" is Liberty Hill's); among
  // names without it, the first named wins ("Comal I.S.D. & New Braunfels I.S.D." lists Comal first).
  let best: { canonical: string; at: number; named: boolean } | null = null;
  for (const alias of aliases) {
    const pattern = EXACT_ONLY.has(alias) ? new RegExp(`(?:^|\\s)${escape(alias)}(?:\\s|$)`, "g") : new RegExp(`(?:^|[\\s\\-])${escape(alias)}(?=$|[\\s\\-]|isd|cisd)`, "g");
    for (const match of Array.from(simplified.matchAll(pattern))) {
      const at = match.index!;
      const after = simplified.slice(at + match[0].length).trimStart();
      const named = /^c?isd\b/.test(after) || EXACT_ONLY.has(alias);
      const candidate = { canonical: canonicalByAlias.get(alias)!, at, named };
      if (!best || (candidate.named && !best.named) || (candidate.named === best.named && at < best.at)) best = candidate;
    }
  }
  return best?.canonical ?? null;
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when the text is already exactly a canonical district name. */
export function isCanonicalDistrict(text: string | null | undefined): boolean {
  return Boolean(text) && KNOWN_DISTRICTS.includes(text!);
}

/**
 * The district the site shows for a community: the builder's own text when it names a known district, otherwise the
 * district of its ZIP code (shared/dealsZipDistricts.ts), otherwise null. Never the builder's raw text.
 */
export function resolveDistrict(builderText: string | null | undefined, zip: string | null | undefined, zipMap: Readonly<Record<string, string>>): { district: string | null; source: "builder" | "zip" | null } {
  const fromBuilder = normalizeDistrict(builderText);
  if (fromBuilder) return { district: fromBuilder, source: "builder" };
  const fromZip = zip ? zipMap[zip] ?? null : null;
  return fromZip ? { district: fromZip, source: "zip" } : { district: null, source: null };
}

/** The ZIP code in a sales-office address: the last five digits, or the ones after "TX" however the builder wrote it. */
export function zipInAddress(address: string | null | undefined): string | null {
  const text = (address ?? "").trim();
  const match = /\b(\d{5})(?:-\d{4})?\s*$/.exec(text);
  if (match) return match[1]!;
  const afterState = Array.from(text.matchAll(/\bTX(?![A-Za-z])[\s,]*?(\d{5})(?:-\d{4})?(?!\d)/gi)).at(-1);
  return afterState ? afterState[1]! : null;
}
