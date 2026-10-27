import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { dealTrecFakeRows, dealTrecImports, dealTrecLicenses } from "../drizzle/schema";
import { getDb } from "./db";

const TREC_CSV = "https://data.texas.gov/api/views/s7ft-44qi/rows.csv?accessType=DOWNLOAD";
/** The response headers must arrive within this window; streaming the ~326k-row body is governed by the read watchdog instead. */
const TREC_HEADERS_TIMEOUT_MS = 120_000;
/** Abort only when the body stops delivering bytes for this long, never for total duration. */
const TREC_READ_INACTIVITY_MS = 60_000;
type TrecInput = Record<string, string>;
export const canonicalTrecName = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
/** Splits a canonical name into comparable tokens: punctuation such as "Smith," or "Jr." is removed before the suffix rule. */
export const trecNameParts = (value: string) => canonicalTrecName(value).replace(/[.,;:"]+/g, " ").replace(/\s+/g, " ").trim().replace(/\b(JR|SR|II|III|IV)$/i, "").split(" ").filter(Boolean);

function parseCsvLine(line: string): string[] {
  const cells: string[] = []; let cell = "", quoted = false;
  for (let i = 0; i < line.length; i++) { const char = line[i], next = line[i + 1]; if (char === '"' && quoted && next === '"') { cell += '"'; i++; } else if (char === '"') quoted = !quoted; else if (char === "," && !quoted) { cells.push(cell); cell = ""; } else cell += char; }
  cells.push(cell); return cells;
}
function field(row: TrecInput, ...names: string[]) { for (const name of names) if (row[name] !== undefined) return row[name]; return ""; }

/** Normalizes the lookup columns before insertion so matching can stay in SQL. */
export function trecLicenseValues(importId: number, row: TrecInput): typeof dealTrecLicenses.$inferInsert | null {
  const fullName = canonicalTrecName(field(row, "full_name", "name"));
  if (!fullName) return null;
  const parts = trecNameParts(fullName);
  return {
    importId,
    fullName,
    firstName: (trecNameParts(field(row, "first_name"))[0] || parts[0] || null)?.slice(0, 100) || null,
    lastName: (trecNameParts(field(row, "last_name")).join(" ") || parts.at(-1) || null)?.slice(0, 100) || null,
    licenseNumber: field(row, "license_number").trim().slice(0, 60) || null,
    licenseType: field(row, "license_type").trim().slice(0, 80) || null,
    status: field(row, "status").trim().slice(0, 80) || null,
    county: canonicalTrecName(field(row, "county")).slice(0, 100) || null,
    sourceUpdated: field(row, "updated", "last_updated").trim().slice(0, 80) || null,
  };
}

/** Makes a complete cache current before atomically deleting every previous cache. */
async function activateAndRetainOnlyImport(importId: number, rowCount: number) {
  const db = await getDb(); if (!db) throw new Error("Database unavailable");
  await db.transaction(async (tx) => {
    const old = await tx.select({ id: dealTrecImports.id }).from(dealTrecImports).where(sql`${dealTrecImports.id} <> ${importId}`);
    await tx.update(dealTrecImports).set({ current: false }).where(eq(dealTrecImports.current, true));
    await tx.update(dealTrecImports).set({ current: true, rowCount, completedAt: new Date() }).where(eq(dealTrecImports.id, importId));
    const oldIds = old.map((row) => row.id);
    if (oldIds.length) {
      await tx.delete(dealTrecLicenses).where(inArray(dealTrecLicenses.importId, oldIds));
      await tx.delete(dealTrecImports).where(inArray(dealTrecImports.id, oldIds));
    }
  });
}

type TrecImportOptions = { headersTimeoutMs?: number; readInactivityMs?: number };

/**
 * Streams the official public CSV into a new import record in small database
 * batches. The abort controller covers the headers and then acts as a per-read
 * inactivity watchdog, so a long but healthy download of hundreds of thousands
 * of rows is never cut off by a total-duration timer.
 */
export async function importTrecLicenses(options: TrecImportOptions = {}) {
  const db = await getDb(); if (!db) throw new Error("Database unavailable");
  const controller = new AbortController();
  let watchdog: ReturnType<typeof setTimeout> | null = setTimeout(() => controller.abort(new Error("TREC CSV headers timed out")), options.headersTimeoutMs ?? TREC_HEADERS_TIMEOUT_MS);
  const clearWatchdog = () => { if (watchdog) { clearTimeout(watchdog); watchdog = null; } };
  let response: Response;
  try { response = await fetch(TREC_CSV, { headers: { Accept: "text/csv" }, signal: controller.signal }); }
  finally { clearWatchdog(); }
  if (!response.ok || !response.body) throw new Error(`TREC CSV ${response.status}`);
  const imported = await db.insert(dealTrecImports).values({ sourceEtag: response.headers.get("etag"), rowCount: 0, current: false });
  const importId = Number((imported as unknown as [{ insertId: number }])[0].insertId);
  const reader = response.body.getReader(); let headers: string[] | null = null, batch: Array<typeof dealTrecLicenses.$inferInsert> = [], count = 0;
  const flush = async () => { if (!batch.length) return; await db.insert(dealTrecLicenses).values(batch); count += batch.length; batch = []; };
  const readChunk = async () => {
    watchdog = setTimeout(() => controller.abort(new Error("TREC CSV download stalled")), options.readInactivityMs ?? TREC_READ_INACTIVITY_MS);
    try { return await reader.read(); } finally { clearWatchdog(); }
  };
  // Oct 27, 2026: the body is spooled to a temp file at network speed, then parsed from disk. Parsing while
  // downloading paused the socket for every database batch, and on a busy morning TREC's server closed the idle
  // connection seven minutes in ("terminated"), twice in a row.
  const dir = await mkdtemp(join(tmpdir(), "trec-"));
  const file = join(dir, "licenses.csv");
  try {
    const out = createWriteStream(file);
    try {
      while (true) {
        const { done, value } = await readChunk();
        if (value?.length && !out.write(value)) await new Promise<void>((resolve) => out.once("drain", resolve));
        if (done) break;
      }
    } finally { await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => error ? reject(error) : resolve())); }
    const lines = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Number.POSITIVE_INFINITY });
    for await (const line of lines) {
      if (!headers) { headers = parseCsvLine(line).map((value) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, "_")); continue; }
      if (!line.trim()) continue;
      const cells = parseCsvLine(line); const row = Object.fromEntries(headers.map((key, index) => [key, cells[index] ?? ""]));
      const values = trecLicenseValues(importId, row); if (!values) continue;
      batch.push(values);
      if (batch.length >= 500) await flush();
    }
    await flush(); await activateAndRetainOnlyImport(importId, count);
    return { ok: true, rows: count, importId };
  } catch (error) { clearWatchdog(); reader.cancel().catch(() => undefined); await db.delete(dealTrecLicenses).where(eq(dealTrecLicenses.importId, importId)); await db.delete(dealTrecImports).where(eq(dealTrecImports.id, importId)); throw error; }
  finally { await rm(dir, { recursive: true, force: true }).catch(() => undefined); }
}

/**
 * Adds a synthetic, no-license test fixture. It is reachable only through the
 * protected administrator action with explicit consent and is usable on the
 * deployed preview as well, because the handover flag test runs there. The
 * TEST-prefixed name keeps it unmistakable in every admin view.
 */
export async function addTrecFakeRow(fullName: string) {
  const normalized = canonicalTrecName(fullName);
  if (!/^TEST\s+[A-Z][A-Z' -]*\s+[A-Z][A-Z' -]*$/.test(normalized) || normalized.length > 190 || trecNameParts(normalized).length < 3) {
    throw new Error("Use an explicit TEST first-and-last-name fixture, for example TEST JANE BUYER.");
  }
  const db = await getDb(); if (!db) throw new Error("Database unavailable");
  await db.insert(dealTrecFakeRows).values({ fullName: normalized }).onDuplicateKeyUpdate({ set: { fullName: normalized } });
  return { ok: true as const, fullName: normalized };
}

/** Matches active Texas Sales Agent/Broker rows with the first name narrowed in SQL. */
export async function lookupTrecName(fullName: string, counties: string[] = []) {
  const db = await getDb(); if (!db) return [] as Array<typeof dealTrecLicenses.$inferSelect & { isFake?: true }>;
  const parts = trecNameParts(fullName); if (parts.length < 2) return [];
  const first = parts[0], last = parts.at(-1)!, normalizedName = canonicalTrecName(fullName);
  const current = (await db.select({ id: dealTrecImports.id }).from(dealTrecImports).where(eq(dealTrecImports.current, true)).orderBy(desc(dealTrecImports.completedAt)).limit(1))[0];
  const normalizedCounties = Array.from(new Set(counties.map(canonicalTrecName).filter(Boolean)));
  const output: Array<typeof dealTrecLicenses.$inferSelect & { isFake?: true }> = current ? await db.select().from(dealTrecLicenses).where(and(
    eq(dealTrecLicenses.importId, current.id),
    // Legacy imports can use the full-name fallback until their next refresh;
    // new imports use the composite (import, last, first) index exclusively.
    or(and(eq(dealTrecLicenses.lastName, last), eq(dealTrecLicenses.firstName, first)), eq(dealTrecLicenses.fullName, normalizedName)),
    ...(normalizedCounties.length ? [inArray(dealTrecLicenses.county, normalizedCounties)] : []),
    sql`LOWER(COALESCE(${dealTrecLicenses.licenseType}, '')) REGEXP 'sales[[:space:]]*agent|broker'`,
    sql`LOWER(COALESCE(${dealTrecLicenses.status}, '')) REGEXP '(^|[^a-z])active([^a-z]|$)'`,
  )).limit(100) : [];
  // The fake row is matched on the punctuation-free token form as well, so the
  // same name typed as "Test Jane Buyer." still exercises the flag.
  const fakeNames = Array.from(new Set([normalizedName, parts.join(" ")]));
  const fake = (await db.select().from(dealTrecFakeRows).where(inArray(dealTrecFakeRows.fullName, fakeNames)).limit(1))[0];
  // A test fixture is deliberately recognizable and has no official identifier.
  if (fake) output.push({ id: -fake.id, importId: 0, fullName: normalizedName, firstName: first, lastName: last, licenseNumber: null, licenseType: "Test Sales Agent", status: "Active (test)", county: "Test", sourceUpdated: null, isFake: true });
  return output;
}

/** Builds admin display metadata with SQL DISTINCT instead of an arbitrary row scan. */
export async function trecImportSummary() {
  const db = await getDb(); if (!db) return null;
  const current = (await db.select().from(dealTrecImports).where(eq(dealTrecImports.current, true)).orderBy(desc(dealTrecImports.completedAt)).limit(1))[0];
  const fakeRows = await db.select({ id: dealTrecFakeRows.id }).from(dealTrecFakeRows);
  if (!current) return { import: null, licenseTypes: [] as string[], statuses: [] as string[], fakeRowCount: fakeRows.length };
  const [typeRows, statusRows] = await Promise.all([
    db.selectDistinct({ value: dealTrecLicenses.licenseType }).from(dealTrecLicenses).where(and(eq(dealTrecLicenses.importId, current.id), sql`${dealTrecLicenses.licenseType} IS NOT NULL AND ${dealTrecLicenses.licenseType} <> ''`)).orderBy(asc(dealTrecLicenses.licenseType)),
    db.selectDistinct({ value: dealTrecLicenses.status }).from(dealTrecLicenses).where(and(eq(dealTrecLicenses.importId, current.id), sql`${dealTrecLicenses.status} IS NOT NULL AND ${dealTrecLicenses.status} <> ''`)).orderBy(asc(dealTrecLicenses.status)),
  ]);
  return { import: current, licenseTypes: typeRows.flatMap((row) => row.value ? [row.value] : []), statuses: statusRows.flatMap((row) => row.value ? [row.value] : []), fakeRowCount: fakeRows.length };
}
