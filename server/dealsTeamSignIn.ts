import { and, eq } from "drizzle-orm";
import { dealAccessTokens, dealLeads, dealTeamAllowlist } from "../drizzle/schema";
import { DEALS_COOKIE, DEALS_CONSENT_TEXT } from "../shared/deals";
import type { Request, Response } from "express";
import { getDb } from "./db";
import { sdk } from "./_core/sdk";
import { TEAM_ACCESS_HOURS, clearAgentBlocksForBrowser, ensureDealsCookies, hashSecret, logDealEvent, randomOpaqueToken, setDealCookie } from "./dealsService";

export type TeamSiteSignIn = "ok" | "no_login" | "not_team" | "no_phone" | "turned_off" | "cookie_blocked" | "unavailable";

/**
 * Oct 27, 2026 (Peter: "agents with email as lifestyle get in and stay logged in"): an agent signed in to the site
 * with their Lifestyle e-mail (the site's own login) gets a Builder Deals team session without a text, when that
 * e-mail is on the active team list. The session lasts TEAM_ACCESS_HOURS, like a code sign-in, on this browser.
 */
export async function teamSessionFromSiteLogin(req: Request, res: Response, options: { authenticate?: (req: Request) => Promise<{ email?: string | null; name?: string | null } | null> } = {}): Promise<TeamSiteSignIn> {
  let user: { email?: string | null; name?: string | null } | null = null;
  try { user = await (options.authenticate ?? ((request: Request) => sdk.authenticateRequest(request)))(req); } catch { user = null; }
  const email = user?.email?.trim().toLowerCase();
  if (!email) return "no_login";
  const db = await getDb();
  if (!db) return "unavailable";
  const rows = await db.select().from(dealTeamAllowlist).where(eq(dealTeamAllowlist.active, true));
  const row = rows.find((candidate) => candidate.email?.trim().toLowerCase() === email);
  if (!row) return "not_team";
  if (!row.phoneE164) return "no_phone";
  const cookieState = ensureDealsCookies(req, res);
  if (!cookieState.hasProbe) return "cookie_blocked";
  const now = new Date();
  const fresh = new Date(now.getTime() + TEAM_ACCESS_HOURS * 60 * 60_000);
  const ip = req.ip || req.socket?.remoteAddress || "0.0.0.0";
  let lead = (await db.select().from(dealLeads).where(eq(dealLeads.phoneE164, row.phoneE164)).limit(1))[0];
  if (lead?.revokedAt) return "turned_off";
  if (lead) {
    const expiresAt = lead.expiresAt > fresh ? lead.expiresAt : fresh;
    await db.update(dealLeads).set({ status: "team", expiresAt, deviceHash: cookieState.deviceHash, email: lead.email ?? email, name: lead.name ?? row.name }).where(eq(dealLeads.id, lead.id));
    lead = { ...lead, status: "team", expiresAt };
  } else {
    const inserted = await db.insert(dealLeads).values({ phoneE164: row.phoneE164, email, name: row.name, sourceCode: "team", consentText: DEALS_CONSENT_TEXT, consentAt: now, consentIp: ip, deviceHash: cookieState.deviceHash, expiresAt: fresh, status: "team", flags: JSON.stringify(["team", "site_login"]) });
    const id = Number((inserted as unknown as [{ insertId?: number }])[0]?.insertId ?? 0);
    lead = (await db.select().from(dealLeads).where(eq(dealLeads.id, id)).limit(1))[0]!;
  }
  const session = randomOpaqueToken(32);
  await db.insert(dealAccessTokens).values({ leadId: lead.id, tokenHash: hashSecret(session), deviceHash: cookieState.deviceHash, expiresAt: lead.expiresAt, kind: "session" });
  // A team cookie lasts as long as the session (no lapsed-cookie grace: nothing to send a team member back to).
  setDealCookie(res, DEALS_COOKIE.session, session, Math.max(60, Math.floor((lead.expiresAt.getTime() - now.getTime()) / 1000)));
  // A team member is never an agent kept off the list: this browser's agent block (their own answer or the screening) goes.
  await clearAgentBlocksForBrowser(cookieState.deviceHash).catch(() => undefined);
  await logDealEvent({ leadId: lead.id, kind: "team_site_login", sourceCode: "team", deviceHash: cookieState.deviceHash, ip, phone: row.phoneE164, detail: `team:${row.id}` });
  return "ok";
}

/** True when the team list holds an active row with this e-mail (the gate shows the site sign-in only then). */
export async function teamEmailKnown(email: string | null | undefined): Promise<boolean> {
  const wanted = email?.trim().toLowerCase();
  if (!wanted) return false;
  const db = await getDb();
  if (!db) return false;
  return (await db.select({ email: dealTeamAllowlist.email }).from(dealTeamAllowlist).where(and(eq(dealTeamAllowlist.active, true)))).some((row) => row.email?.trim().toLowerCase() === wanted);
}
