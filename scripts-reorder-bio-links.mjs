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

/**
 * The six live buttons, in priority order.
 *
 * Anything NOT in this list is deactivated (never deleted), so retired buttons
 * stay recoverable from admin and a future run can't resurrect them. Currently
 * retired: "Contact Us" (duplicate /contact), "Join Our Team" (the Now Hiring
 * banner at the top of /links already goes to /join) and "Home Valuation"
 * (seller intent is covered by Schedule a Consultation and the capture form).
 */
const DESIRED = [
  ["New Construction Search", "https://a.nhb.app/u/peter-allen"],
  ["Find Your Texas City", "/city-finder"],
  ["Convince Your Partner", "/convince"],
  ["Schedule a Consultation", "/contact"],
  ["Own a Rental? List It With Us", "/lease"],
  ["Explore Our Full Website", "/"],
];

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.query("SELECT id, label, url, sortOrder, active FROM bio_links");

/** Ids this run has claimed for the desired set — see the deactivation pass. */
const claimed = new Set();

for (let i = 0; i < DESIRED.length; i++) {
  const [label, url] = DESIRED[i];
  const sort = i + 1;
  // Prefer an exact label+url match so rows sharing a url (e.g. "Contact Us"
  // and "Schedule a Consultation" both on /contact) resolve to the right one,
  // and skip any row already claimed by an earlier desired entry.
  const existing =
    rows.find((r) => r.url === url && r.label === label && !claimed.has(r.id)) ??
    rows.find((r) => r.url === url && !claimed.has(r.id));
  if (existing) {
    claimed.add(existing.id);
    await conn.execute(
      "UPDATE bio_links SET label=?, sortOrder=?, active=true WHERE id=?",
      [label, sort, existing.id]
    );
    console.log(`updated  #${sort} ${label}`);
  } else {
    const [res] = await conn.execute(
      "INSERT INTO bio_links (label, url, sortOrder, active) VALUES (?,?,?,true)",
      [label, url, sort]
    );
    if (res?.insertId) claimed.add(res.insertId);
    console.log(`inserted #${sort} ${label}`);
  }
}

// Anything not in the desired set is deactivated rather than deleted, so it can
// be restored from admin. This is what retires the duplicate "Contact Us".
//
// Keyed on the ids claimed above, NOT on url: "Contact Us" shares /contact with
// "Schedule a Consultation", so a url-keyed keep-set would spare the duplicate.
const [current] = await conn.query(
  "SELECT id, label, url FROM bio_links WHERE active=true"
);
for (const r of current) {
  if (!claimed.has(r.id)) {
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
