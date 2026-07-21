/**
 * Seeds the placeholder listing dataset (Phase 1) into the DB.
 * The listing data lives in shared/placeholderListings.mjs — the single source
 * of truth shared with the AI-search coverage test — so realistic searches
 * return 5-10 matches. Temporary until IDX/MLS data arrives in Phase 2.
 *
 * Run after a data change:  node seed-listings.mjs   (needs DATABASE_URL)
 */
import mysql from "mysql2/promise";
import "dotenv/config";
import { PLACEHOLDER_LISTINGS } from "./shared/placeholderListings.mjs";

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

// Listing data + geo/hero are applied below from PLACEHOLDER_LISTINGS.

function jitter(base, i) {
  return (base + (((i * 7919) % 100) - 50) * 0.0012).toFixed(4);
}

async function run() {
  await conn.query(`DELETE FROM listings`);
  for (let i = 0; i < PLACEHOLDER_LISTINGS.length; i++) {
    const [address, city, zip, price, beds, baths, sqft, status, pool, nc, stories, pbd, type, agent, blurb] = PLACEHOLDER_LISTINGS[i];
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
