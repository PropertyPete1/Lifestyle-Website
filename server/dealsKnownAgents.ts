import { and, eq, inArray, or } from "drizzle-orm";
import { dealAccessTokens, dealDoNotAutoImport, dealKnownAgents, dealLeads } from "../drizzle/schema";
import { getDb } from "./db";
import { normalizeUsPhone } from "../shared/deals";
import { fubHeaders } from "./fub";

export type KnownAgentRow = { name?: string; phone?: string; email?: string };
const lower = (value?: string | null) => value?.trim().toLowerCase() || null;
const phone = (value?: string | null) => {
  if (!value) return null;
  const parsed = normalizeUsPhone(value);
  return parsed.ok ? parsed.e164 : null;
};

/** Small RFC4180-compatible row parser for the three supported columns. */
export function parseKnownAgentsCsv(csv: string): KnownAgentRow[] {
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < csv.length; i++) { const ch = csv[i], next = csv[i + 1]; if (ch === '"' && quoted && next === '"') { cell += '"'; i++; } else if (ch === '"') quoted = !quoted; else if (ch === "," && !quoted) { row.push(cell.trim()); cell = ""; } else if ((ch === "\n" || ch === "\r") && !quoted) { if (ch === "\r" && next === "\n") i++; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; } else cell += ch; }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift()!.map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  return rows.map((values) => ({ name: values[headers.findIndex((h) => h === "name" || h === "fullname")]?.trim() || undefined, phone: values[headers.findIndex((h) => h.includes("phone"))]?.trim() || undefined, email: values[headers.findIndex((h) => h.includes("email"))]?.trim() || undefined })).filter((item) => item.name || item.phone || item.email);
}

async function prohibited(value: string | null, kind: "phone" | "email") {
  if (!value) return false; const db = await getDb(); if (!db) return true;
  return Boolean((await db.select({ id: dealDoNotAutoImport.id }).from(dealDoNotAutoImport).where(and(eq(dealDoNotAutoImport.value, value), eq(dealDoNotAutoImport.kind, kind))).limit(1))[0]);
}

/** Existing matching active links are revoked immediately; no manual import can leave a loophole. */
async function killMatchingLinks(phoneE164: string | null, email: string | null) {
  const db = await getDb(); if (!db) return 0;
  const predicates = [phoneE164 ? eq(dealLeads.phoneE164, phoneE164) : undefined, email ? eq(dealLeads.email, email) : undefined].filter(Boolean) as any[];
  if (!predicates.length) return 0;
  const leads = await db.select({ id: dealLeads.id }).from(dealLeads).where(or(...predicates));
  if (!leads.length) return 0;
  const ids = leads.map((lead) => lead.id);
  await db.update(dealLeads).set({ status: "blocked", revokedAt: new Date() }).where(inArray(dealLeads.id, ids));
  await db.update(dealAccessTokens).set({ revokedAt: new Date() }).where(inArray(dealAccessTokens.leadId, ids));
  return ids.length;
}

export async function importKnownAgents(rows: KnownAgentRow[], source: "csv" | "fub_recruit" | "manual" = "csv") {
  const db = await getDb(); if (!db) throw new Error("Database unavailable");
  let imported = 0, skipped = 0, linksKilled = 0;
  for (const row of rows) {
    const phoneE164 = phone(row.phone), email = lower(row.email);
    if (!row.name && !phoneE164 && !email) { skipped++; continue; }
    if (await prohibited(phoneE164, "phone") || await prohibited(email, "email")) { skipped++; continue; }
    const identityPredicates = [phoneE164 ? eq(dealKnownAgents.phoneE164, phoneE164) : undefined, email ? eq(dealKnownAgents.email, email) : undefined].filter(Boolean) as any[];
    const exists = identityPredicates.length ? (await db.select({ id: dealKnownAgents.id }).from(dealKnownAgents).where(or(...identityPredicates)).limit(1))[0] : undefined;
    if (exists) await db.update(dealKnownAgents).set({ name: row.name?.trim() || null, phoneE164, email, source, active: true }).where(eq(dealKnownAgents.id, exists.id));
    else await db.insert(dealKnownAgents).values({ name: row.name?.trim() || null, phoneE164, email, source });
    linksKilled += await killMatchingLinks(phoneE164, email); imported++;
  }
  return { imported, skipped, linksKilled };
}

/** Nightly import candidate: only recruit-tagged contacts, with note-phone extraction. */
export async function syncKnownAgentsFromFub(recruitTag = "Recruit") {
  const apiKey = process.env.FUB_API_KEY; if (!apiKey) return { imported: 0, skipped: 0, linksKilled: 0, unavailable: true };
  const url = new URL("https://api.followupboss.com/v1/people"); url.searchParams.set("tag", recruitTag); url.searchParams.set("limit", "100");
  const response = await fetch(url, { headers: fubHeaders(apiKey), signal: AbortSignal.timeout(30_000) }); if (!response.ok) throw new Error(`FUB recruit sync ${response.status}`);
  const payload = await response.json() as { people?: Array<{ firstName?: string; lastName?: string; phones?: Array<{ value?: string }>; emails?: Array<{ value?: string }>; notes?: string; id?: number | string }> };
  const candidates = (payload.people ?? []).flatMap((person) => {
    const numbers = [...(person.phones ?? []).map((x) => x.value), ...((person.notes ?? "").match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/g) ?? [])];
    return (numbers.length ? numbers : [undefined]).map((number) => ({ name: [person.firstName, person.lastName].filter(Boolean).join(" ") || undefined, phone: number, email: person.emails?.[0]?.value }));
  });
  return importKnownAgents(candidates, "fub_recruit");
}
