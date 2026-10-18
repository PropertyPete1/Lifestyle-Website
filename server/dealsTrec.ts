import { and, desc, eq, or } from "drizzle-orm";
import { dealTrecFakeRows, dealTrecImports, dealTrecLicenses } from "../drizzle/schema";
import { getDb } from "./db";

const TREC_CSV = "https://data.texas.gov/api/views/s7ft-44qi/rows.csv?accessType=DOWNLOAD";
type TrecInput = Record<string, string>;
const canonical = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
const nameParts = (value: string) => canonical(value).replace(/\b(JR|SR|II|III|IV)\.?$/i, "").split(" ").filter(Boolean);

function parseCsvLine(line: string): string[] {
  const cells: string[] = []; let cell = "", quoted = false;
  for (let i = 0; i < line.length; i++) { const char = line[i], next = line[i + 1]; if (char === '"' && quoted && next === '"') { cell += '"'; i++; } else if (char === '"') quoted = !quoted; else if (char === "," && !quoted) { cells.push(cell); cell = ""; } else cell += char; }
  cells.push(cell); return cells;
}
function field(row: TrecInput, ...names: string[]) { for (const name of names) if (row[name] !== undefined) return row[name]; return ""; }

/** Streams the official public CSV into a new import record in small database batches. */
export async function importTrecLicenses() {
  const db = await getDb(); if (!db) throw new Error("Database unavailable");
  const response = await fetch(TREC_CSV, { headers: { Accept: "text/csv" }, signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new Error(`TREC CSV ${response.status}`);
  const imported = await db.insert(dealTrecImports).values({ sourceEtag: response.headers.get("etag"), rowCount: 0, current: false });
  const importId = Number((imported as unknown as [{ insertId: number }])[0].insertId);
  const reader = response.body.getReader(), decoder = new TextDecoder(); let remainder = "", headers: string[] | null = null, batch: Array<typeof dealTrecLicenses.$inferInsert> = [], count = 0;
  const flush = async () => { if (!batch.length) return; await db.insert(dealTrecLicenses).values(batch); count += batch.length; batch = []; };
  try {
    while (true) {
      const { done, value } = await reader.read(); remainder += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = remainder.split(/\r?\n/); remainder = lines.pop() ?? "";
      for (const line of lines) {
        if (!headers) { headers = parseCsvLine(line).map((value) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, "_")); continue; }
        if (!line.trim()) continue;
        const cells = parseCsvLine(line); const row = Object.fromEntries(headers.map((key, index) => [key, cells[index] ?? ""]));
        const fullName = canonical(field(row, "full_name", "name")); if (!fullName) continue;
        batch.push({ importId, fullName, firstName: field(row, "first_name").slice(0, 100) || null, lastName: field(row, "last_name").slice(0, 100) || null, licenseNumber: field(row, "license_number").slice(0, 60) || null, licenseType: field(row, "license_type").slice(0, 80) || null, status: field(row, "status").slice(0, 80) || null, county: field(row, "county").slice(0, 100) || null, sourceUpdated: field(row, "updated", "last_updated").slice(0, 80) || null });
        if (batch.length >= 500) await flush();
      }
      if (done) break;
    }
    if (remainder.trim() && headers) { const cells = parseCsvLine(remainder); const row = Object.fromEntries(headers.map((key, index) => [key, cells[index] ?? ""])); const fullName = canonical(field(row, "full_name", "name")); if (fullName) { batch.push({ importId, fullName, firstName: field(row, "first_name").slice(0, 100) || null, lastName: field(row, "last_name").slice(0, 100) || null, licenseNumber: field(row, "license_number").slice(0, 60) || null, licenseType: field(row, "license_type").slice(0, 80) || null, status: field(row, "status").slice(0, 80) || null, county: field(row, "county").slice(0, 100) || null, sourceUpdated: field(row, "updated", "last_updated").slice(0, 80) || null }); } }
    await flush(); await db.update(dealTrecImports).set({ current: false }).where(eq(dealTrecImports.current, true)); await db.update(dealTrecImports).set({ current: true, rowCount: count, completedAt: new Date() }).where(eq(dealTrecImports.id, importId));
    return { ok: true, rows: count, importId };
  } catch (error) { await db.delete(dealTrecLicenses).where(eq(dealTrecLicenses.importId, importId)); throw error; }
}

/** Matches active Texas Sales Agent/Broker rows only, tolerating middle names and suffixes. */
export async function lookupTrecName(fullName: string, counties: string[] = []) {
  const db = await getDb(); if (!db) return [] as Array<{ fullName: string; licenseType: string | null; status: string | null; county: string | null; licenseNumber: string | null; sourceUpdated: string | null }>;
  const parts = nameParts(fullName); if (parts.length < 2) return [];
  const first = parts[0], last = parts.at(-1)!; const current = (await db.select({ id: dealTrecImports.id }).from(dealTrecImports).where(eq(dealTrecImports.current, true)).orderBy(desc(dealTrecImports.completedAt)).limit(1))[0];
  const validCounty = (county: string | null) => !counties.length || counties.map(canonical).includes(canonical(county));
  const isActiveAgent = (row: { licenseType: string | null; status: string | null }) => /sales\s*agent|broker/i.test(row.licenseType ?? "") && /active/i.test(row.status ?? "") && !/inactive/i.test(row.status ?? "");
  const output = current ? (await db.select().from(dealTrecLicenses).where(and(eq(dealTrecLicenses.importId, current.id), or(eq(dealTrecLicenses.lastName, last), eq(dealTrecLicenses.fullName, canonical(fullName))))).limit(100)).filter((row) => (canonical(row.firstName) === first || nameParts(row.fullName)[0] === first) && validCounty(row.county) && isActiveAgent(row)) : [];
  const fakes = await db.select().from(dealTrecFakeRows).where(eq(dealTrecFakeRows.fullName, canonical(fullName))).limit(1);
  if (fakes.length && validCounty("Bexar")) output.push({ id: -fakes[0].id, importId: 0, fullName: canonical(fullName), firstName: first, lastName: last, licenseNumber: null, licenseType: "Sales Agent", status: "Active", county: "Bexar", sourceUpdated: null });
  return output;
}

export async function trecImportSummary() { const db = await getDb(); if (!db) return null; const current = (await db.select().from(dealTrecImports).where(eq(dealTrecImports.current, true)).orderBy(desc(dealTrecImports.completedAt)).limit(1))[0]; if (!current) return null; const rows = await db.select({ licenseType: dealTrecLicenses.licenseType, status: dealTrecLicenses.status }).from(dealTrecLicenses).where(eq(dealTrecLicenses.importId, current.id)).limit(10_000); return { ...current, licenseTypes: Array.from(new Set(rows.map((row) => row.licenseType).filter(Boolean))), statuses: Array.from(new Set(rows.map((row) => row.status).filter(Boolean))) }; }
