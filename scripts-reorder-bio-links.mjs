/**
 * IDEMPOTENT production update for the /links buttons.
 *
 * Deliberately NOT part of seed-db.mjs: that script does DELETE FROM bio_links
 * and would wipe any ordering Peter has set in admin. This one only upserts the
 * intended set by URL, fixes sortOrder, and deactivates the duplicate.
 *
 *   node scripts-reorder-bio-links.mjs      (needs DATABASE_URL)
 *
 * Safe to run repeatedly.
 */
import mysql from "mysql2/promise";
import "dotenv/config";

const DESIRED = [
  ["New Construction Search", "https://a.nhb.app/u/peter-allen"],
  ["Find Your Texas City", "/city-finder"],
  ["Convince Your Partner", "/convince"],
  ["Schedule a Consultation", "/contact"],
  ["Own a Rental? List It With Us", "/lease"],
  ["Join Our Team", "/join"],
  ["Home Valuation", "/valuation"],
  ["Explore Our Full Website", "/"],
];

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.query("SELECT id, label, url, sortOrder, active FROM bio_links");

for (let i = 0; i < DESIRED.length; i++) {
  const [label, url] = DESIRED[i];
  const sort = i + 1;
  const existing = rows.find((r) => r.url === url);
  if (existing) {
    await conn.execute(
      "UPDATE bio_links SET label=?, sortOrder=?, active=true WHERE id=?",
      [label, sort, existing.id]
    );
    console.log(`updated  #${sort} ${label}`);
  } else {
    await conn.execute(
      "INSERT INTO bio_links (label, url, sortOrder, active) VALUES (?,?,?,true)",
      [label, url, sort]
    );
    console.log(`inserted #${sort} ${label}`);
  }
}

// Anything not in the desired set is deactivated rather than deleted, so it can
// be restored from admin. This is what retires the duplicate "Contact Us".
const keep = new Set(DESIRED.map(([, u]) => u));
for (const r of rows) {
  if (!keep.has(r.url) && r.active) {
    await conn.execute("UPDATE bio_links SET active=false WHERE id=?", [r.id]);
    console.log(`deactivated  ${r.label} -> ${r.url}`);
  }
}

const [after] = await conn.query(
  "SELECT label, url, sortOrder FROM bio_links WHERE active=true ORDER BY sortOrder"
);
console.log("\nActive /links buttons now:");
for (const r of after) console.log(`  ${r.sortOrder}. ${r.label} -> ${r.url}`);
await conn.end();
process.exit(0);
