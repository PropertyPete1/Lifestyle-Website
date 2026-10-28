import type { Request, Response } from "express";
import { parse as parseCookie } from "cookie";
import { eq } from "drizzle-orm";
import { dealTeamAllowlist } from "../drizzle/schema";
import { getDb } from "./db";
import { setDealCookie } from "./dealsService";
import { agentForLead, agentForTeamId, type DealsAgent } from "./dealsClientLinks";

/**
 * Oct 28, 2026 (Peter: "why not make your own little link like New Home Buddy does, so agents can throw it on their
 * Instagram profiles... it goes into Follow Up Boss added under that agent"): every agent on the team has one public
 * link, /deals/u/<their-name> (New Home Buddy's /u/peter-allen). Anyone can open it and browse every home; whoever
 * signs up through it is that agent's lead: Follow Up Boss puts the contact under the agent, the agent gets the
 * alerts, and the buyer's list names the agent. It is a public link, so the buyer sees the same list as a reel buyer
 * (no addresses); the agent's private client link is still how a client sees every address.
 */
export const AGENT_PAGE_SOURCE = "agent-page";
/** The browser remembers whose link it came through, so the sign-up is the agent's even after browsing around. */
export const AGENT_PAGE_COOKIE = "ldr_deals_agent";
export const AGENT_PAGE_COOKIE_DAYS = 30;
export const AGENT_PAGE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MAX = 80;
const PAGES_TTL_MS = 60_000;

/** "Tiffany Proske" → "tiffany-proske"; accents dropped, anything else becomes a dash. */
export function agentNameSlug(name: string | null | undefined): string {
  return (name ?? "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 60).replace(/-+$/g, "");
}

export function agentPagePath(slug: string) {
  return `/deals/u/${slug}`;
}

export function validAgentPageSlug(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const slug = value.trim().toLowerCase();
  return slug.length > 0 && slug.length <= SLUG_MAX && AGENT_PAGE_SLUG_PATTERN.test(slug) ? slug : null;
}

type TeamRow = typeof dealTeamAllowlist.$inferSelect;
type PageEntry = { slug: string; teamId: number; rowIds: number[]; base: string };

/**
 * One page per person on the active team list: rows of the same Follow Up Boss user (one per phone) share it, and a
 * hand-added row joins the one FUB user of the same name. The slug is the name; when two different people share a name,
 * the later one gets their row number on the end, so neither one's link can ever land on the other.
 */
export function agentPageEntries(rows: readonly TeamRow[]): PageEntry[] {
  const named = rows.filter((row) => row.active && row.name?.trim() && agentNameSlug(row.name));
  // A hand-added row with no FUB user joins the one FUB user of the same name (Peter's manual row and his FUB row are
  // one person, one link); with no such user, or two of them, it stands alone.
  const fubByName = new Map<string, Set<string>>();
  for (const row of named) if (row.fubUserId?.trim()) {
    const slug = agentNameSlug(row.name);
    fubByName.set(slug, new Set([...Array.from(fubByName.get(slug) ?? []), row.fubUserId.trim()]));
  }
  const groups = new Map<string, TeamRow[]>();
  for (const row of named) {
    const sameName = fubByName.get(agentNameSlug(row.name));
    const key = row.fubUserId?.trim() ? `fub:${row.fubUserId.trim()}` : sameName?.size === 1 ? `fub:${Array.from(sameName)[0]}` : `row:${row.id}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const people = Array.from(groups.values()).map((group) => {
    const primary = [...group].sort((a, b) => Number(Boolean(b.fubUserId?.trim())) - Number(Boolean(a.fubUserId?.trim())) || a.id - b.id)[0]!;
    return { base: agentNameSlug(primary.name), teamId: primary.id, rowIds: group.map((row) => row.id) };
  });
  // Same name, different people: the first on the team keeps the plain link (so a link already in someone's bio never
  // changes when a namesake joins); the others get their row number on the end.
  const firstByName = new Map<string, number>();
  for (const person of people) firstByName.set(person.base, Math.min(firstByName.get(person.base) ?? Number.POSITIVE_INFINITY, person.teamId));
  return people.map((person) => ({ slug: firstByName.get(person.base) === person.teamId ? person.base : `${person.base}-${person.teamId}`, teamId: person.teamId, rowIds: person.rowIds, base: person.base }));
}

let cached: { at: number; entries: PageEntry[] } | null = null;
/** Test seam. */
export function resetAgentPageCache() { cached = null; }

async function pages(now = Date.now()): Promise<PageEntry[]> {
  if (cached && now - cached.at < PAGES_TTL_MS) return cached.entries;
  const db = await getDb();
  if (!db) return [];
  const entries = agentPageEntries(await db.select().from(dealTeamAllowlist).where(eq(dealTeamAllowlist.active, true)));
  cached = { at: now, entries };
  return entries;
}

/** The agent behind a page link, while they are on the team. */
export async function agentForPageSlug(value: unknown): Promise<DealsAgent | null> {
  const slug = validAgentPageSlug(value);
  if (!slug) return null;
  const all = await pages();
  // The page's own name, or the name with any of the person's row numbers on the end (always unambiguous).
  const entry = all.find((page) => page.slug === slug) ?? all.find((page) => page.rowIds.some((id) => slug === `${page.base}-${id}`));
  if (!entry) return null;
  const agent = await agentForTeamId(entry.teamId);
  return agent?.active ? agent : null;
}

/** The signed-in agent's own page link (none for a number shared by several agents). */
export async function agentPageForLead(agentLead: Parameters<typeof agentForLead>[0]): Promise<{ slug: string; path: string } | null> {
  const agent = await agentForLead(agentLead);
  if (!agent) return null;
  const all = await pages();
  const entry = all.find((page) => page.teamId === agent.teamId || page.rowIds.includes(agent.teamId));
  if (entry) return { slug: entry.slug, path: agentPagePath(entry.slug) };
  // The agent's primary row may be another row of the same FUB user than the one the page was grouped under.
  const db = await getDb();
  if (!db || !agent.fubUserId) return null;
  const rows = await db.select({ id: dealTeamAllowlist.id }).from(dealTeamAllowlist).where(eq(dealTeamAllowlist.fubUserId, agent.fubUserId));
  const match = all.find((page) => rows.some((row) => page.rowIds.includes(row.id)));
  return match ? { slug: match.slug, path: agentPagePath(match.slug) } : null;
}

/** The page this browser came through: the link's own ?a=, else the remembered one. */
export function agentPageSlugFromRequest(req: Request, explicit?: unknown): string | null {
  return validAgentPageSlug(explicit) ?? validAgentPageSlug(parseCookie(req.headers.cookie || "")[AGENT_PAGE_COOKIE]);
}

export function rememberAgentPage(res: Response, slug: string) {
  setDealCookie(res, AGENT_PAGE_COOKIE, slug, AGENT_PAGE_COOKIE_DAYS * 24 * 60 * 60);
}

/** What the landing and the sheet say for the page: the agent's name. */
export type AgentPagePresentation = { agentName: string; firstName: string };
export function presentAgentPage(agent: DealsAgent | null): AgentPagePresentation | null {
  return agent ? { agentName: agent.name, firstName: agent.firstName ?? agent.name } : null;
}
