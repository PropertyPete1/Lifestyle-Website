/**
 * Expanded placeholder listings (~40) so realistic AI searches return 5-10
 * matches. Temporary until IDX/MLS data arrives in Phase 2.
 * Varies: city, price band, beds/baths, sqft, pool, new construction,
 * stories, primaryBedDown, property type, status.
 */
import mysql from "mysql2/promise";
import "dotenv/config";

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const IMG = {
  austinModern: "/manus-storage/listing-austin-modern_741409df.webp",
  hillCountryWhite: "/manus-storage/listing-hillcountry-white_5a9e0c46.jpeg",
  gracelyn: "/manus-storage/listing-gracelyn_38d8aecd.jpg",
  cordillera: "/manus-storage/listing-cordillera_c64c3d56.jpg",
  barnhouse: "/manus-storage/listing-barnhouse_7f3f3269.jpg",
  houstonSunset: "/manus-storage/listing-houston-sunset_55db521d.jpg",
  poolEstate: "/manus-storage/listing-pool-estate_c1433ee3.jpg",
  interiorMoody: "/manus-storage/interior-moody_6ec0d3af.jpg",
};
const HEROES = [IMG.austinModern, IMG.hillCountryWhite, IMG.gracelyn, IMG.cordillera, IMG.barnhouse, IMG.houstonSunset, IMG.poolEstate];

// City base coordinates with jitter for map spread
const GEO = {
  "San Antonio": [29.4816, -98.6544],
  "New Braunfels": [29.703, -98.1245],
  "Austin": [30.2672, -97.7431],
  "DFW": [32.7767, -96.797],
  "Houston": [29.7604, -95.3698],
  "Boerne": [29.7946, -98.7319],
  "Kyle": [29.9893, -97.8772],
};

// [address, city, zip, price, beds, baths, sqft, status, pool, newBuild, stories, primaryDown, type, agent, blurb]
const L = [
  // ---- San Antonio (9) ----
  ["77 Alamo Ranch Estates", "San Antonio", "78253", 429000, 4, "3", 2650, "Sold", 1, 1, 2, 1, "Residential", "Irma", "SOLD over asking in 6 days. New-construction beauty in Alamo Ranch with open-concept layout and community pool, park, and trails."],
  ["2314 Cielo Vista Way", "San Antonio", "78228", 315000, 3, "2", 1780, "Active", 0, 0, 1, 1, "Residential", "Irma", "Single-story charmer minutes from downtown — updated kitchen, mature oaks, and an oversized backyard."],
  ["8842 Westover Bluff", "San Antonio", "78251", 389000, 4, "2.5", 2380, "Active", 0, 1, 2, 1, "Residential", "Peter Allen", "Brand-new build near SeaWorld with primary suite down, game room up, and builder warranty."],
  ["1521 Stone Oak Terrace", "San Antonio", "78258", 545000, 4, "3.5", 3050, "Active", 1, 0, 2, 1, "Residential", "Peter Allen", "Stone Oak stunner with sparkling pool, first-floor primary retreat, and exemplary NEISD schools."],
  ["419 King William Loft", "San Antonio", "78204", 465000, 2, "2", 1420, "Active", 0, 0, 2, 0, "Townhome/Condo", "Laila", "Lock-and-leave condo in the historic King William district — walk to the River Walk and Southtown dining."],
  ["9917 Ranch Creek Villa", "San Antonio", "78254", 359000, 3, "2.5", 2100, "Active", 0, 1, 2, 0, "Townhome/Condo", "Stefanie", "New-construction townhome with private yard, quartz island kitchen, and HOA-maintained front landscaping."],
  ["4406 Medical Center Duplex", "San Antonio", "78229", 549000, 6, "4", 3200, "Active", 0, 0, 2, 1, "Multi-Family", "Peter Allen", "Cash-flowing duplex near the Medical Center — two 3/2 units, long-term tenants, 7.1% cap rate."],
  ["12208 Silver Mesa Trail", "San Antonio", "78245", 279000, 3, "2", 1560, "Pending", 0, 0, 1, 1, "Residential", "Abby", "Value play on the far west side — single-story, solar panels, and a quick commute to Lackland AFB."],
  ["25610 Copper Canyon Estate", "San Antonio", "78255", 899000, 5, "4.5", 4200, "Active", 1, 0, 2, 1, "Residential", "Peter Allen", "Gated hill-country estate on .8 acre — pool with swim-up bar, casita, and 4-car garage."],
  // ---- New Braunfels (6) ----
  ["842 Gruene Crossing", "New Braunfels", "78130", 585000, 4, "3", 2760, "Active", 0, 1, 2, 1, "Residential", "Stefanie", "Steps from historic Gruene — farmhouse character with modern efficiency, white oak floors, chef's kitchen."],
  ["1108 Comal River Cottage", "New Braunfels", "78130", 415000, 3, "2", 1690, "Active", 0, 0, 1, 1, "Residential", "Stefanie", "Single-story cottage three blocks from the Comal — vaulted ceilings, tube-to-the-river summers."],
  ["3355 Veramendi Vista", "New Braunfels", "78132", 489000, 4, "3", 2540, "Active", 0, 1, 1, 1, "Residential", "Abby", "Single-story new build in Veramendi — 4 beds, flex office, and community river park access."],
  ["560 Hill Country Haven", "New Braunfels", "78132", 725000, 4, "3.5", 3300, "Active", 1, 0, 2, 1, "Residential", "Peter Allen", "Hill-country modern with negative-edge pool, outdoor kitchen, and canyon sunset views."],
  ["218 Marketplatz Townhome", "New Braunfels", "78130", 329000, 2, "2.5", 1480, "Active", 0, 1, 2, 0, "Townhome/Condo", "Laila", "New townhome walkable to the Plaza — roof deck, two suites, low-maintenance living."],
  ["1740 Guadalupe Fourplex", "New Braunfels", "78130", 985000, 8, "8", 4800, "Active", 0, 0, 2, 1, "Multi-Family", "Peter Allen", "Rare fourplex near Schlitterbahn — four 2/2 units, strong seasonal rental history."],
  // ---- Austin (7) ----
  ["317 Eastside Modern", "Austin", "78702", 949000, 3, "2.5", 2140, "Active", 1, 0, 2, 0, "Residential", "Steven Van Orden", "Architect-designed East Austin modern with rooftop deck and skyline views — walk to coffee and the trail."],
  ["7509 Brodie Springs Ranch", "Austin", "78745", 649000, 4, "3", 2480, "Active", 0, 0, 1, 1, "Residential", "Steven Van Orden", "Rare single-story 4-bed in South Austin — remodeled kitchen, primary suite overlooking the greenbelt."],
  ["11803 Domain Heights", "Austin", "78758", 439000, 2, "2", 1250, "Active", 0, 1, 1, 1, "Townhome/Condo", "Laila", "New-construction condo steps from the Domain — floor-to-ceiling glass, concierge, pool deck."],
  ["4212 Zilker Bungalow", "Austin", "78704", 1150000, 3, "2", 1880, "Pending", 0, 0, 1, 1, "Residential", "Steven Van Orden", "78704 bungalow four blocks from Zilker Park — chef's kitchen, studio ADU, alley access."],
  ["15221 Lake Travis Vista", "Austin", "78734", 1690000, 5, "4.5", 4600, "Active", 1, 0, 2, 1, "Residential", "Peter Allen", "Lake Travis estate with infinity pool, boat slip, and panoramic water views from every level."],
  ["9010 Mueller Row", "Austin", "78723", 559000, 3, "2.5", 1820, "Active", 0, 1, 2, 0, "Townhome/Condo", "Steven Van Orden", "New Mueller-district row home — energy-star build, park views, two-car garage."],
  ["6816 Riverside Duplex", "Austin", "78741", 749000, 6, "4", 2900, "Active", 0, 0, 2, 1, "Multi-Family", "Peter Allen", "East Riverside duplex minutes to Oracle and the airport — two 3/2 units, house-hack ready."],
  // ---- Kyle (3) ----
  ["228 Plum Pointe", "Kyle", "78640", 339000, 4, "2.5", 2180, "Active", 0, 1, 2, 1, "Residential", "Abby", "New build in a master-planned Kyle community — 4 beds, primary down, resort amenity center."],
  ["145 Sunset Meadow", "Kyle", "78640", 289000, 3, "2", 1610, "Active", 0, 1, 1, 1, "Residential", "Abby", "Single-story new construction under $300K — smart-home package and full sod/irrigation."],
  ["512 Bluebonnet Bend", "Kyle", "78640", 425000, 5, "3", 2850, "Active", 1, 0, 2, 1, "Residential", "Stefanie", "Five-bed with a brand-new pool — game room, media room, and a three-car tandem garage."],
  // ---- Boerne (3) ----
  ["1204 Hilltop Vista", "Boerne", "78006", 1249000, 4, "3.5", 3820, "Active", 1, 0, 2, 1, "Residential", "Peter Allen", "Perched on 1.4 acres with panoramic Hill Country views — vanishing-edge pool and light-flooded great room."],
  ["309 Main Street Cottage", "Boerne", "78006", 575000, 3, "2", 1740, "Active", 0, 0, 1, 1, "Residential", "Tiffany", "Single-story storybook cottage two blocks from Boerne's Hill Country Mile — wraparound porch."],
  ["86 Cordillera Summit", "Boerne", "78006", 1495000, 5, "5", 4900, "Active", 1, 0, 2, 1, "Residential", "Peter Allen", "Cordillera Ranch showpiece — pool, outdoor living hall, and a 1,000-bottle wine room."],
  // ---- DFW (6) ----
  ["9210 Legacy Ranch Dr", "DFW", "75035", 675000, 5, "4", 3480, "Pending", 0, 1, 2, 1, "Residential", "Abby", "Master-planned living in Frisco's most sought-after corridor — game room, media room, walkable schools."],
  ["4417 Bishop Arts Row", "DFW", "75208", 465000, 3, "2.5", 1950, "Active", 0, 1, 2, 0, "Townhome/Condo", "Laila", "New row home in Bishop Arts — rooftop terrace with skyline views, walk to 40+ restaurants."],
  ["7203 Prosper Creek", "DFW", "75078", 585000, 4, "3", 2800, "Active", 0, 1, 1, 1, "Residential", "Abby", "Single-story new build in Prosper ISD — 4 beds, study, and an oversized covered patio."],
  ["1105 Southlake Estate", "DFW", "76092", 1425000, 5, "5.5", 5100, "Active", 1, 0, 2, 1, "Residential", "Peter Allen", "Southlake luxury — pool/spa, sport court, Carroll ISD, and a five-car showroom garage."],
  ["2919 Lower Greenville Duplex", "DFW", "75206", 698000, 4, "4", 2600, "Active", 0, 0, 2, 1, "Multi-Family", "Peter Allen", "Lower Greenville duplex — two 2/2 units, M-Streets charm, strong rent comps."],
  ["6512 McKinney Meadow", "DFW", "75070", 398000, 3, "2", 1850, "Active", 0, 0, 1, 1, "Residential", "Tiffany", "Single-story McKinney home under $400K — open plan, new roof, community pool and trails."],
  // ---- Houston (6) ----
  ["4518 Heights Bungalow", "Houston", "77008", 515000, 3, "2", 1980, "Active", 0, 0, 1, 1, "Residential", "Laila", "Reimagined Heights bungalow — designer finishes, quartz kitchen, rare two-car garage on a tree-lined street."],
  ["2205 Midtown Skyline Condo", "Houston", "77002", 359000, 2, "2", 1180, "Active", 0, 0, 1, 1, "Townhome/Condo", "Laila", "Midtown high-rise with skyline views — pool deck, gym, and 24-hour concierge."],
  ["17419 Katy Lakeview", "Houston", "77494", 489000, 4, "3", 2720, "Active", 1, 1, 2, 1, "Residential", "Tiffany", "New construction on a Katy lake lot — pool-ready backyard, primary down, Katy ISD."],
  ["9814 Woodlands Pine Manor", "Houston", "77381", 765000, 5, "4", 3900, "Active", 1, 0, 2, 1, "Residential", "Peter Allen", "Woodlands executive home under the pines — pool, summer kitchen, cul-de-sac lot."],
  ["1123 EaDo Triplex", "Houston", "77003", 825000, 6, "6", 3600, "Active", 0, 1, 2, 0, "Multi-Family", "Peter Allen", "New-build EaDo triplex — three 2/2 units with private rooftops, blocks from the ballpark."],
  ["3308 Museum District Flat", "Houston", "77004", 289000, 2, "2", 1090, "Sold", 0, 0, 1, 1, "Townhome/Condo", "Laila", "SOLD — Museum District flat with garage parking and a five-minute walk to Hermann Park."],
];

function jitter(base, i) {
  return (base + (((i * 7919) % 100) - 50) * 0.0012).toFixed(4);
}

async function run() {
  await conn.query(`DELETE FROM listings`);
  for (let i = 0; i < L.length; i++) {
    const [address, city, zip, price, beds, baths, sqft, status, pool, nc, stories, pbd, type, agent, blurb] = L[i];
    const slug = address.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + city.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const [baseLat, baseLng] = GEO[city];
    const hero = HEROES[i % HEROES.length];
    await conn.execute(
      `INSERT INTO listings (slug, address, city, state, zip, price, beds, baths, sqft, status, description, heroImage, photos, agentName, featured, hasPool, isNewConstruction, stories, primaryBedDown, propertyType, lat, lng, source)
       VALUES (?,?,?,'TX',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'cms')`,
      [slug, address, city, zip, price, beds, baths, sqft, status, blurb, hero,
       JSON.stringify([hero, IMG.interiorMoody, HEROES[(i + 3) % HEROES.length]]),
       agent, 1, pool, nc, stories, pbd, type, jitter(baseLat, i), jitter(baseLng, i + 13)]
    );
  }
  const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM listings`);
  console.log(`Seeded ${rows[0].n} listings`);
  await conn.end();
  process.exit(0);
}

run().catch((e) => { console.error(e); process.exit(1); });
