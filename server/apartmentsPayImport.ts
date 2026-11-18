import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Request, RequestHandler } from "express";
import { z } from "zod";
import { aptApiKeys, aptProperties } from "../drizzle/schema";
import { getDb } from "./db";

/**
 * PAY UPDATES FROM OUTSIDE (Nov 17, 2026). One keyed web address that takes "what a community pays locators" from
 * whatever keeps it current (an agent's tool, a flyer reader, the owner's own assistant) and updates the pay every
 * locator sees. It never adds a community, never touches anything but pay, and never guesses: a line it cannot
 * match to exactly one community on file is handed back, not applied.
 *
 *   POST /api/apartments/pay      Authorization: Bearer ldrapt_...      Content-Type: application/json
 *   { "updates": [ { "name": "...", "address": "...", "sendPercent": 50, "escortPercent": 100, "flatFee": null,
 *                    "bonusAmount": 250, "bonusNote": "...", "bonusExpiresOn": "2026-12-31", "confirmedOn": "2026-11-18" } ] }
 */
export const APT_PAY_PATH = "/api/apartments/pay";
export const APT_KEY_PREFIX = "ldrapt_";
const MAX_CALLS_PER_HOUR = 30;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const percent = z.number().int().min(0).max(300).nullable().optional();
const dollars = z.number().int().min(0).max(100_000).nullable().optional();
export const payUpdateSchema = z.strictObject({
  name: z.string().trim().min(2).max(190),
  address: z.string().trim().max(255).nullable().optional(),
  sendPercent: percent,
  escortPercent: percent,
  flatFee: dollars,
  bonusAmount: dollars,
  bonusNote: z.string().trim().max(255).nullable().optional(),
  bonusExpiresOn: day.nullable().optional(),
  /** The day this pay was seen to be current. Required: it is what tells locators how fresh the figure is. */
  confirmedOn: day,
});
export type PayUpdate = z.infer<typeof payUpdateSchema>;
const envelope = z.strictObject({ updates: z.array(z.unknown()).min(1).max(1000) });

const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");
async function requireDb() { const db = await getDb(); if (!db) throw new Error("Database unavailable"); return db; }

/** A new key (replacing the old one at once). The plain key is returned to show once and is never stored. */
export async function generateAptPayKey(now = new Date()): Promise<{ key: string; createdAt: Date }> {
  const db = await requireDb();
  const key = `${APT_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  await db.delete(aptApiKeys).where(eq(aptApiKeys.purpose, "pay"));
  await db.insert(aptApiKeys).values({ purpose: "pay", keyHash: hashKey(key), createdAt: now });
  return { key, createdAt: now };
}

export async function revokeAptPayKey(): Promise<void> {
  await (await requireDb()).delete(aptApiKeys).where(eq(aptApiKeys.purpose, "pay"));
}

export async function aptPayKeyStatus(): Promise<{ exists: boolean; createdAt: Date | null; lastUsedAt: Date | null }> {
  const row = (await (await requireDb()).select().from(aptApiKeys).where(eq(aptApiKeys.purpose, "pay")).limit(1))[0];
  return { exists: Boolean(row), createdAt: row?.createdAt ?? null, lastUsedAt: row?.lastUsedAt ?? null };
}

async function keyIsValid(key: string | null, now: Date): Promise<boolean> {
  if (!key || !key.startsWith(APT_KEY_PREFIX) || key.length > 200) return false;
  const db = await requireDb();
  const row = (await db.select().from(aptApiKeys).where(eq(aptApiKeys.purpose, "pay")).limit(1))[0];
  if (!row) return false;
  const given = Buffer.from(hashKey(key), "hex");
  const stored = Buffer.from(row.keyHash, "hex");
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) return false;
  await db.update(aptApiKeys).set({ lastUsedAt: now }).where(eq(aptApiKeys.id, row.id));
  return true;
}

/** A community's name as it is compared: lower case, no punctuation, without the filler every complex name carries. */
export function payNameKey(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/).filter((word) => word && !["the", "apartments", "apartment", "apts", "apartment homes", "homes", "luxury", "at", "on", "of"].includes(word)).join(" ");
}
const streetNumber = (address: string | null | undefined) => /^\s*(\d{2,6})\b/.exec(address ?? "")?.[1] ?? null;
const zipOf = (address: string | null | undefined) => /\b(\d{5})(?:-\d{4})?\s*$/.exec(address ?? "")?.[1] ?? null;

type Row = typeof aptProperties.$inferSelect;
export type PayOutcome = { index: number; name: string; status: "updated" | "unchanged" | "skipped" | "unmatched" | "invalid"; reason?: string; propertyId?: number };

/**
 * The one community a line means, or why there is not exactly one. The name must match; when an address is given
 * its street number (and ZIP, when both have one) must agree too, so two complexes with the same name are never
 * confused and a right name at the wrong address is not applied.
 */
export function matchPayUpdate(update: Pick<PayUpdate, "name" | "address">, rows: readonly Row[]): { row: Row } | { reason: string } {
  const key = payNameKey(update.name);
  if (!key) return { reason: "name_too_generic" };
  let found = rows.filter((row) => payNameKey(row.name) === key);
  if (!found.length) return { reason: "no_community_with_this_name" };
  const number = streetNumber(update.address);
  const zip = zipOf(update.address);
  if (number) found = found.filter((row) => !streetNumber(row.address) || streetNumber(row.address) === number);
  if (zip) found = found.filter((row) => !(row.zip ?? zipOf(row.address)) || (row.zip ?? zipOf(row.address)) === zip);
  if (!found.length) return { reason: "name_matches_but_address_does_not" };
  if (found.length > 1) return { reason: "more_than_one_community_matches_send_the_address" };
  return { row: found[0]! };
}

const FIGURES = ["sendPercent", "escortPercent", "flatFee", "bonusAmount", "bonusNote", "bonusExpiresOn"] as const;

/**
 * Applies pay updates. Each line stands alone. A figure left out keeps its stored value; a line older than what is
 * stored is skipped (a stale reading never overwrites a newer one); the same line sent twice changes nothing.
 */
export async function applyPayUpdates(raw: readonly unknown[], today: string): Promise<{ outcomes: PayOutcome[] }> {
  const db = await requireDb();
  const rows = await db.select().from(aptProperties);
  const outcomes: PayOutcome[] = [];
  const touched = new Set<number>();
  for (let index = 0; index < raw.length; index++) {
    const parsed = payUpdateSchema.safeParse(raw[index]);
    const name = typeof (raw[index] as { name?: unknown } | null)?.name === "string" ? String((raw[index] as { name: string }).name).slice(0, 190) : "";
    if (!parsed.success) { outcomes.push({ index, name, status: "invalid", reason: parsed.error.issues.slice(0, 4).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") }); continue; }
    const update = parsed.data;
    if (update.confirmedOn > today) { outcomes.push({ index, name, status: "invalid", reason: "confirmedOn is in the future" }); continue; }
    if (FIGURES.every((field) => update[field] === undefined)) { outcomes.push({ index, name, status: "invalid", reason: "no pay figure in this line" }); continue; }
    const match = matchPayUpdate(update, rows.filter((row) => row.active));
    if ("reason" in match) { outcomes.push({ index, name, status: "unmatched", reason: match.reason }); continue; }
    const row = match.row;
    if (touched.has(row.id)) { outcomes.push({ index, name, status: "skipped", reason: "this community is already in this call", propertyId: row.id }); continue; }
    touched.add(row.id);
    if (row.commissionVerifiedOn && row.commissionVerifiedOn > update.confirmedOn) { outcomes.push({ index, name, status: "skipped", reason: `stored pay was confirmed ${row.commissionVerifiedOn}, after this line`, propertyId: row.id }); continue; }
    const fields = Object.fromEntries(FIGURES.filter((field) => update[field] !== undefined).map((field) => [field, update[field] ?? null]));
    const same = row.commissionVerifiedOn === update.confirmedOn && Object.entries(fields).every(([field, value]) => (row as Record<string, unknown>)[field] === value);
    if (same) { outcomes.push({ index, name, status: "unchanged", propertyId: row.id }); continue; }
    await db.update(aptProperties).set({ ...fields, commissionVerifiedOn: update.confirmedOn, commissionNote: `Pay update received ${today} (confirmed ${update.confirmedOn})` }).where(eq(aptProperties.id, row.id));
    outcomes.push({ index, name, status: "updated", propertyId: row.id });
  }
  return { outcomes };
}

const calls: number[] = [];
export function resetAptPayRateLimit() { calls.length = 0; }
const bearer = (req: Request) => /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? ""))?.[1] ?? null;
const chicagoDay = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/** The route. 401 without the key, 429 past 30 calls an hour, 400 for a body that is not the shape above. */
export function createAptPayHandler(options: { now?: () => Date } = {}): RequestHandler {
  return async (req, res) => {
    const now = options.now?.() ?? new Date();
    try {
      if (!(await keyIsValid(bearer(req), now))) return res.status(401).json({ ok: false, error: "unauthorized" });
      while (calls.length && now.getTime() - calls[0]! > 3_600_000) calls.shift();
      if (calls.length >= MAX_CALLS_PER_HOUR) return res.status(429).json({ ok: false, error: "too_many_calls" });
      calls.push(now.getTime());
      const body = envelope.safeParse(req.body);
      if (!body.success) return res.status(400).json({ ok: false, error: "invalid_payload", issues: body.error.issues.slice(0, 10).map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
      const { outcomes } = await applyPayUpdates(body.data.updates, chicagoDay(now));
      const count = (status: PayOutcome["status"]) => outcomes.filter((outcome) => outcome.status === status).length;
      // Ids and counts only in the log: never a name, a figure or the key.
      console.info(`[apartments-pay] ${outcomes.length} lines: ${count("updated")} updated, ${count("unchanged")} unchanged, ${count("skipped")} skipped, ${count("unmatched")} unmatched, ${count("invalid")} invalid`);
      return res.status(200).json({ ok: count("unmatched") + count("invalid") === 0, updated: count("updated"), unchanged: count("unchanged"), skipped: count("skipped"), notApplied: outcomes.filter((outcome) => outcome.status !== "updated" && outcome.status !== "unchanged").map(({ index, name, status, reason }) => ({ index, name, status, reason })) });
    } catch {
      return res.status(500).json({ ok: false, error: "server_error" });
    }
  };
}
export const aptPayHandler = createAptPayHandler();
