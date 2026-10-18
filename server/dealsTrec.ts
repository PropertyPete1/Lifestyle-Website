import { desc, eq } from "drizzle-orm";
import { dealTrecVerifications, teamMembers } from "../drizzle/schema";
import { getDb } from "./db";

const TREC_DATASET = "https://data.texas.gov/resource/s7ft-44qi.json";

type TrecRow = { full_name?: string; license_number?: string; license_type?: string; status?: string; updated?: string };

/**
 * Checks only the existing internal team roster against TREC's official public
 * Socrata dataset. No token is required at this small, scheduled query volume.
 */
export async function verifyTeamLicensesWithTrec() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const members = await db.select({ id: teamMembers.id, name: teamMembers.name }).from(teamMembers);
  let verified = 0;
  for (const member of members) {
    const name = member.name.trim().toUpperCase();
    if (!name) continue;
    const url = new URL(TREC_DATASET);
    url.searchParams.set("$select", "full_name,license_number,license_type,status,updated");
    url.searchParams.set("$where", `upper(full_name)='${name.replace(/'/g, "''")}'`);
    url.searchParams.set("$limit", "5");
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
      if (!res.ok) continue;
      const rows = await res.json() as TrecRow[];
      const active = rows.find((row) => /active/i.test(row.status ?? "")) ?? rows[0];
      await db.insert(dealTrecVerifications).values({
        teamMemberId: member.id,
        fullName: member.name,
        licenseNumber: active?.license_number ?? null,
        licenseType: active?.license_type ?? null,
        status: active?.status ?? "Not found in TREC public dataset",
        sourceUpdatedAt: active?.updated ? new Date(active.updated) : null,
      });
      verified += 1;
    } catch {
      // Temporary Socrata outage: preserve the last successful check and let
      // the next scheduled run retry. Never manufacture an inactive status.
      continue;
    }
  }
  return { checked: members.length, stored: verified };
}

export async function latestTeamLicenseChecks() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(dealTrecVerifications).orderBy(desc(dealTrecVerifications.verifiedAt)).limit(100);
}
