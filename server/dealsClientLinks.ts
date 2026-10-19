import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { dealClientLinks, dealCommunities, dealCommunityViews, dealHomes, dealLeads, dealTeamAllowlist, dealTourRequests } from "../drizzle/schema";
import { normalizeUsPhone } from "../shared/deals";
import { getDb } from "./db";
import { getDealSettings, hashSecret, logDealEvent, randomOpaqueToken } from "./dealsService";

/**
 * LDR agents (every active team row: the nightly FUB user mirror plus manual
 * rows) share Builder Deals with their own clients through client links. The
 * link token attributes the buyer who verifies through it to the agent and
 * unlocks the full-detail view; it never bypasses the buyer's own phone
 * verification, which is why it is stored in clear for the agent to copy again.
 */
export const CLIENT_LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;
/** The same link counts as opened at most once an hour, so a refetch loop never inflates the count. */
const OPEN_INTERVAL_MS = 60 * 60_000;

type LeadRow = typeof dealLeads.$inferSelect;
type TeamRow = typeof dealTeamAllowlist.$inferSelect;
export type ClientLinkRow = typeof dealClientLinks.$inferSelect;
/** `active` is false once the nightly FUB mirror or an admin removed the agent; their history keeps its name, but nothing new is assigned or emailed to them. */
export type DealsAgent = { teamId: number; name: string; email: string | null; phoneE164: string | null; fubUserId: string | null; active: boolean };

function agentFromTeamRow(row: TeamRow): DealsAgent {
  return { teamId: row.id, name: row.name?.trim() || "Lifestyle Design Realty", email: row.email?.trim().toLowerCase() || null, phoneE164: row.phoneE164, fubUserId: row.fubUserId?.trim() || null, active: row.active };
}

/** The agent's number as their client may text it; a client is never shown a masked number for their own agent. */
export function agentDisplayPhone(agent: Pick<DealsAgent, "phoneE164">): string | null {
  if (!agent.phoneE164) return null;
  const parsed = normalizeUsPhone(agent.phoneE164, { allowCanada: true });
  return parsed.ok ? parsed.display : agent.phoneE164;
}

/** Every active team row behind a team session, matched on the session lead's phone or email. */
export async function teamRowsForLead(lead: Pick<LeadRow, "phoneE164" | "email">): Promise<TeamRow[]> {
  const db = await getDb();
  if (!db) return [];
  const email = lead.email?.trim().toLowerCase() || null;
  return db.select().from(dealTeamAllowlist).where(and(
    eq(dealTeamAllowlist.active, true),
    or(eq(dealTeamAllowlist.phoneE164, lead.phoneE164), ...(email ? [eq(dealTeamAllowlist.email, email)] : [])),
  )).orderBy(desc(dealTeamAllowlist.id));
}

/**
 * The agent identity for a team session. A FUB user mirrors to one row per
 * phone, so the row carrying a FUB user id (and a name) wins; the contact
 * details are completed from the other rows of the same person.
 */
export async function agentForLead(lead: Pick<LeadRow, "phoneE164" | "email">): Promise<DealsAgent | null> {
  const rows = await teamRowsForLead(lead);
  if (!rows.length) return null;
  const primary = rows.find((row) => row.fubUserId && row.name) ?? rows.find((row) => row.fubUserId) ?? rows.find((row) => row.name) ?? rows[0]!;
  const agent = agentFromTeamRow(primary);
  for (const row of rows) {
    if (!agent.email && row.email) agent.email = row.email.trim().toLowerCase();
    if (!agent.phoneE164 && row.phoneE164) agent.phoneE164 = row.phoneE164;
    if (!agent.fubUserId && row.fubUserId) agent.fubUserId = row.fubUserId.trim();
  }
  return agent;
}

/** The agent behind a client (by the team id stored on the lead); inactive rows still resolve so history keeps its name. */
export async function agentForTeamId(teamId: number | null | undefined): Promise<DealsAgent | null> {
  if (!teamId) return null;
  const db = await getDb();
  if (!db) return null;
  const row = (await db.select().from(dealTeamAllowlist).where(eq(dealTeamAllowlist.id, teamId)).limit(1))[0];
  if (!row) return null;
  const agent = agentFromTeamRow(row);
  // Sibling mirror rows of the same FUB user carry the phone or email this row lacks.
  if (row.fubUserId && (!agent.email || !agent.phoneE164)) {
    const siblings = await db.select().from(dealTeamAllowlist).where(and(eq(dealTeamAllowlist.fubUserId, row.fubUserId), eq(dealTeamAllowlist.active, true)));
    for (const sibling of siblings) {
      if (!agent.email && sibling.email) agent.email = sibling.email.trim().toLowerCase();
      if (!agent.phoneE164 && sibling.phoneE164) agent.phoneE164 = sibling.phoneE164;
    }
  }
  return agent;
}

export type CreateClientLinkInput = { agentLead: LeadRow; clientName: string; clientPhone?: string | null; note?: string | null };
export type CreateClientLinkResult =
  | { ok: true; link: ClientLinkRow; path: string }
  | { ok: false; kind: "not_team" | "invalid_phone" | "invalid_name" | "unavailable" };

/** The relative URL the agent sends; the client lands on the gate with the agent's name on it. */
export function clientLinkPath(token: string) {
  return `/deals?c=${encodeURIComponent(token)}`;
}

export async function createClientLink(input: CreateClientLinkInput): Promise<CreateClientLinkResult> {
  const db = await getDb();
  if (!db) return { ok: false, kind: "unavailable" };
  if (input.agentLead.status !== "team") return { ok: false, kind: "not_team" };
  const agent = await agentForLead(input.agentLead);
  if (!agent) return { ok: false, kind: "not_team" };
  const clientName = input.clientName.replace(/\s+/g, " ").trim().slice(0, 190);
  if (clientName.length < 2) return { ok: false, kind: "invalid_name" };
  const settings = await getDealSettings();
  let clientPhoneE164: string | null = null;
  if (input.clientPhone?.trim()) {
    const parsed = normalizeUsPhone(input.clientPhone, { allowCanada: settings.allowCanada });
    if (!parsed.ok) return { ok: false, kind: "invalid_phone" };
    clientPhoneE164 = parsed.e164;
  }
  const token = randomOpaqueToken(24);
  const expiresAt = new Date(Date.now() + settings.clientLinkDays * 24 * 60 * 60_000);
  const values = { token, agentTeamId: agent.teamId, agentLeadId: input.agentLead.id, clientName, clientPhoneE164, note: input.note?.trim().slice(0, 500) || null, expiresAt };
  const inserted = await db.insert(dealClientLinks).values(values);
  const id = Number((inserted as unknown as [{ insertId?: number }])[0]?.insertId ?? 0);
  const link = (await db.select().from(dealClientLinks).where(eq(dealClientLinks.id, id)).limit(1))[0]
    ?? { id, leadId: null, verifiedAt: null, openedAt: null, openCount: 0, revokedAt: null, createdAt: new Date(), updatedAt: new Date(), ...values };
  await logDealEvent({ leadId: input.agentLead.id, kind: "client_link_created", sourceCode: "agent", deviceHash: input.agentLead.deviceHash, detail: `link:${id};team:${agent.teamId}` });
  return { ok: true, link, path: clientLinkPath(token) };
}

export type ResolvedClientLink = { link: ClientLinkRow; agent: DealsAgent };

/** A usable link: well-formed token, not revoked, not past its date, and an agent who is still on the team. */
export async function resolveClientLink(token: string | null | undefined): Promise<ResolvedClientLink | null> {
  const value = token?.trim() ?? "";
  if (!CLIENT_LINK_TOKEN_PATTERN.test(value)) return null;
  const db = await getDb();
  if (!db) return null;
  const link = (await db.select().from(dealClientLinks).where(and(eq(dealClientLinks.token, value), isNull(dealClientLinks.revokedAt), gt(dealClientLinks.expiresAt, new Date()))).limit(1))[0];
  if (!link) return null;
  const team = (await db.select().from(dealTeamAllowlist).where(and(eq(dealTeamAllowlist.id, link.agentTeamId), eq(dealTeamAllowlist.active, true))).limit(1))[0];
  if (!team) return null;
  const agent = await agentForTeamId(team.id);
  return agent ? { link, agent } : null;
}

export async function recordClientLinkOpen(linkId: number) {
  const db = await getDb();
  if (!db) return;
  const cutoff = new Date(Date.now() - OPEN_INTERVAL_MS);
  const link = (await db.select({ openCount: dealClientLinks.openCount }).from(dealClientLinks)
    .where(and(eq(dealClientLinks.id, linkId), or(isNull(dealClientLinks.openedAt), sql`${dealClientLinks.openedAt} < ${cutoff}`))).limit(1))[0];
  if (!link) return;
  await db.update(dealClientLinks).set({ openedAt: new Date(), openCount: link.openCount + 1 }).where(eq(dealClientLinks.id, linkId));
}

// The verification transaction and the project database share this write surface.
type DealsWriteDb = any;
/** Called inside the verification transaction once the buyer's phone is approved. */
export async function attachLeadToClientLink(db: DealsWriteDb, linkId: number, leadId: number) {
  await db.update(dealClientLinks).set({ leadId, verifiedAt: new Date() }).where(eq(dealClientLinks.id, linkId));
}

export type AttachLiveSessionResult =
  | { ok: true; attached: true; agent: DealsAgent; linkId: number; expiresAt: Date }
  | { ok: true; attached: false; reason: "team" | "already_attached" }
  | { ok: false; kind: "invalid_link" | "unavailable" };

/**
 * A buyer who already holds a live list (a reel link verified earlier today)
 * opens an agent's client link: their phone is already verified in this
 * browser, so the attribution is written without a second code. The latest
 * link wins, as it does at verification, and the access window grows to the
 * agent-client length. Team members are never attached.
 */
export async function attachLiveSessionToClientLink(input: { lead: LeadRow; token: string; expiryHours: number }): Promise<AttachLiveSessionResult> {
  const db = await getDb();
  if (!db) return { ok: false, kind: "unavailable" };
  if (input.lead.status === "team") return { ok: true, attached: false, reason: "team" };
  const resolved = await resolveClientLink(input.token);
  if (!resolved) return { ok: false, kind: "invalid_link" };
  if (input.lead.clientLinkId === resolved.link.id && input.lead.agentTeamId === resolved.agent.teamId) return { ok: true, attached: false, reason: "already_attached" };
  const fresh = new Date(Date.now() + input.expiryHours * 60 * 60_000);
  const expiresAt = input.lead.expiresAt > fresh ? input.lead.expiresAt : fresh;
  await db.update(dealLeads).set({ agentTeamId: resolved.agent.teamId, clientLinkId: resolved.link.id, expiresAt }).where(eq(dealLeads.id, input.lead.id));
  await attachLeadToClientLink(db, resolved.link.id, input.lead.id);
  await logDealEvent({ leadId: input.lead.id, kind: "client_link_attached", sourceCode: input.lead.sourceCode, deviceHash: input.lead.deviceHash, phone: input.lead.phoneE164, detail: `link:${resolved.link.id};team:${resolved.agent.teamId}` });
  return { ok: true, attached: true, agent: resolved.agent, linkId: resolved.link.id, expiresAt };
}

export async function revokeClientLink(agentLead: LeadRow, linkId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const teamIds = (await teamRowsForLead(agentLead)).map((row) => row.id);
  if (!teamIds.length) return false;
  const link = (await db.select().from(dealClientLinks).where(and(eq(dealClientLinks.id, linkId), inArray(dealClientLinks.agentTeamId, teamIds))).limit(1))[0];
  if (!link) return false;
  if (!link.revokedAt) await db.update(dealClientLinks).set({ revokedAt: new Date() }).where(eq(dealClientLinks.id, link.id));
  return true;
}

export type ClientSummary = {
  id: number;
  clientName: string;
  /** The number the agent typed, formatted; it is their own client, so it is not masked for them. */
  clientPhone: string | null;
  /** National digits for a "Text it" link, or null when the agent typed no number. */
  clientPhoneDigits: string | null;
  note: string | null;
  path: string;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
  openedAt: string | null;
  openCount: number;
  verifiedAt: string | null;
  /** The buyer's own list access: live until this time, then they re-verify through the same link. */
  accessExpiresAt: string | null;
  lastViewedAt: string | null;
  saves: Array<{ card: string; description: string; price: number | null; communityLabel: string; savedAt: string }>;
  requests: Array<{ kind: "tour" | "ask"; description: string; preferredAt: string; createdAt: string }>;
};

export type AgentWorkspace = { agent: DealsAgent; clients: ClientSummary[] };

/** The agent's own clients only: links created under any of the agent's active team rows. */
export async function agentWorkspace(agentLead: LeadRow): Promise<AgentWorkspace | null> {
  const db = await getDb();
  if (!db) return null;
  const agent = await agentForLead(agentLead);
  if (!agent) return null;
  const teamIds = (await teamRowsForLead(agentLead)).map((row) => row.id);
  const links = await db.select().from(dealClientLinks).where(inArray(dealClientLinks.agentTeamId, teamIds)).orderBy(desc(dealClientLinks.createdAt), desc(dealClientLinks.id)).limit(200);
  const leadIds = links.flatMap((link) => link.leadId ? [link.leadId] : []);
  const [leads, requests, viewRows] = leadIds.length ? await Promise.all([
    db.select({ id: dealLeads.id, expiresAt: dealLeads.expiresAt, status: dealLeads.status }).from(dealLeads).where(inArray(dealLeads.id, leadIds)),
    db.select().from(dealTourRequests).where(and(inArray(dealTourRequests.leadId, leadIds), isNull(dealTourRequests.removedAt))).orderBy(desc(dealTourRequests.createdAt)),
    // Views are already de-duplicated to one row per community per hour, so the latest one is found in memory.
    db.select({ leadId: dealCommunityViews.leadId, viewedAt: dealCommunityViews.viewedAt }).from(dealCommunityViews).where(inArray(dealCommunityViews.leadId, leadIds)).orderBy(desc(dealCommunityViews.viewedAt)).limit(5_000),
  ]) : [[], [], []];
  const views: Array<{ leadId: number; viewedAt: Date }> = [];
  for (const row of viewRows) if (!views.some((view) => view.leadId === row.leadId)) views.push(row);
  const homeIds = Array.from(new Set(requests.map((request) => request.homeId)));
  const homes = homeIds.length ? await db.select().from(dealHomes).where(inArray(dealHomes.id, homeIds)) : [];
  const communityIds = Array.from(new Set(homes.map((home) => home.communityId)));
  const communities = communityIds.length ? await db.select({ id: dealCommunities.id, publicLabel: dealCommunities.publicLabel, privateName: dealCommunities.privateName }).from(dealCommunities).where(inArray(dealCommunities.id, communityIds)) : [];
  const describe = (homeId: number) => {
    const home = homes.find((row) => row.id === homeId);
    const community = home ? communities.find((row) => row.id === home.communityId) : undefined;
    return {
      card: home ? hashSecret(`deals-card:${home.sourceKey}`).slice(0, 20) : "",
      description: home ? [home.privateAddress, home.privatePlanName ? `(${home.privatePlanName})` : null].filter(Boolean).join(" ") || "Home" : "Home no longer listed",
      price: home?.price ?? null,
      communityLabel: community ? `${community.privateName} (${community.publicLabel})` : "",
    };
  };
  const clients: ClientSummary[] = links.map((link) => {
    const lead = link.leadId ? leads.find((row) => row.id === link.leadId) : undefined;
    const own = link.leadId ? requests.filter((request) => request.leadId === link.leadId) : [];
    const lastView = link.leadId ? views.find((row) => row.leadId === link.leadId)?.viewedAt : undefined;
    return {
      id: link.id,
      clientName: link.clientName,
      clientPhone: link.clientPhoneE164 ? agentDisplayPhone({ phoneE164: link.clientPhoneE164 }) : null,
      clientPhoneDigits: link.clientPhoneE164 ? link.clientPhoneE164.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "") : null,
      note: link.note,
      path: clientLinkPath(link.token),
      createdAt: link.createdAt.toISOString(),
      expiresAt: link.expiresAt.toISOString(),
      revoked: Boolean(link.revokedAt),
      openedAt: link.openedAt?.toISOString() ?? null,
      openCount: link.openCount,
      verifiedAt: link.verifiedAt?.toISOString() ?? null,
      accessExpiresAt: lead && lead.status === "verified" && lead.expiresAt > new Date() ? lead.expiresAt.toISOString() : null,
      lastViewedAt: lastView ? new Date(lastView).toISOString() : null,
      saves: own.filter((request) => request.requestType === "save").map((request) => ({ ...describe(request.homeId), savedAt: request.createdAt.toISOString() })),
      requests: own.filter((request): request is typeof request & { requestType: "tour" | "ask" } => request.requestType !== "save").map((request) => ({ kind: request.requestType, description: describe(request.homeId).description, preferredAt: request.preferredAt.toISOString(), createdAt: request.createdAt.toISOString() })),
    };
  });
  return { agent, clients };
}
