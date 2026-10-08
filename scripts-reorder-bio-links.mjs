/**
 * Safe production bootstrap for retired /links buttons.
 *
 * This script intentionally does NOT seed, sort, reactivate, or deactivate an
 * existing bio_links row. Admin controls the active set and order; this is only
 * a one-time-safe way to add a previously hardcoded CTA as a recoverable,
 * deactivated row when it does not already exist.
 *
 *   node scripts-reorder-bio-links.mjs      (needs DATABASE_URL)
 *
 * Safe to run repeatedly. A later Admin toggle always wins because an existing
 * row is preserved exactly as it is.
 */
import mysql from "mysql2/promise";
import "dotenv/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Formerly hardcoded beneath New Construction Search on /links. Sort order 1
 * preserves that former placement if an admin explicitly re-enables it; it
 * does not affect the live stack while inactive.
 */
export const RETIRED_BIO_LINKS = [
  {
    label: "Meet Primary — Our AI",
    url: "https://lifestyledesigntechnologies.com/?utm_source=linkpage-primary",
    sortOrder: 1,
  },
];

/**
 * Insert missing recoverable rows as inactive. Existing rows are deliberately
 * untouched — including their active flag and sort order — so this utility can
 * never resurrect a row an admin retired or override later admin changes.
 */
export async function bootstrapRetiredBioLinks(conn, log = console.log) {
  const [rows] = await conn.query(
    "SELECT id, label, url, sortOrder, active FROM bio_links"
  );
  const inserted = [];
  const preserved = [];

  for (const retired of RETIRED_BIO_LINKS) {
    const existing = rows.find(
      (row) => row.label === retired.label && row.url === retired.url
    );
    if (existing) {
      preserved.push(existing);
      log(`preserved ${retired.label} (active=${Boolean(existing.active)})`);
      continue;
    }

    await conn.execute(
      "INSERT INTO bio_links (label, url, sortOrder, active) VALUES (?,?,?,false)",
      [retired.label, retired.url, retired.sortOrder]
    );
    inserted.push(retired);
    log(`inserted inactive ${retired.label}`);
  }

  return { inserted, preserved };
}

export async function main({
  createConnection = mysql.createConnection,
  databaseUrl = process.env.DATABASE_URL,
  log = console.log,
} = {}) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const conn = await createConnection(databaseUrl);
  try {
    const result = await bootstrapRetiredBioLinks(conn, log);
    const [activeRows] = await conn.query(
      "SELECT label, url, sortOrder FROM bio_links WHERE active=true ORDER BY sortOrder, id"
    );
    log("\nActive /links buttons preserved from admin:");
    for (const row of activeRows) log(`  ${row.sortOrder}. ${row.label} -> ${row.url}`);
    return result;
  } finally {
    await conn.end();
  }
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
