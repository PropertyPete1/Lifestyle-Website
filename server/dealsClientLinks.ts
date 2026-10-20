import { and, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { dealClientLinks, dealCommunities, dealCommunityViews, dealHomes, dealLeads, dealTeamAllowlist, dealTourRequests } from "../drizzle/schema";
import { normalizeUsPhone } from "../shared/deals";
import { getDb } from "./db";
import { getDealSettings, hashSecret, logDealEvent, randomOpaqueToken } from "./dealsService";

/**
 * LDR agents (every active team row: the nightly FUB user mirror plus manual
 * rows) share Builder Deals with their own clients through client links.
 *
 * A link belongs to ONE client: the mobile number the agent typed, or else the
 * first number that verifies through it. Any other number is refused, so a
 * forwarded link never opens the full list for strangers. The full list lasts
 * only while the link is not turned off and the agent is still on the team.
 * The buyer always verifies their own phone; the token is kept in clear so the
 * agent can copy the link again.
 */
export const CLIENT_LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;
/** The same link counts as opened at most once an hour, so a refetch loop never inflates the count. */
const OPEN_INTERVAL_MS = 60 * 60_000;
/** A code session lasts ten minutes; a link that lapses inside it still completes the verification it started. */
const CODE_SESSION_GRACE_MS = 15 * 60_000;
const BROKERAGE_NAME = "Lifestyle Design Realty";

type LeadRow = typeof dealLeads.$inferSelect;
type TeamRow = typeof dealTeamAllowlist.$inferSelect;
export type ClientLinkRow = typeof dealClientLinks.$inferSelect;
/**
 * `teamId` is the row the link or lead was created under. `active` is true
 * while that row, or any other row of the same FUB user (a changed or second
 * phone), is active; once false, nothing new is assigned or emailed to them.
 */
export type DealsAgent = { teamId: number; name: string; firstName: string | null; email: string | null; phoneE164: string | null; fubUserId: string | null; active: boolean };

/**
 * One agent from every row of the same person (FUB mirrors one row per phone).
 * Current details win: active rows first, then the row the link or lead was
 * made under, then rows carrying a FUB user, newest first. So after FUB changes
 * an agent's mobile, clients are shown the new number, not the retired row's.
 */
function agentFromRows(teamId: number, rows: TeamRow[]): DealsAgent {
  const ordered = [...rows].sort((a, b) =>
    Number(b.active) - Number(a.active)
    || Number(b.id === teamId) - Number(a.id === teamId)
    || Number(Boolean(b.fubUserId?.trim())) - Number(Boolean(a.fubUserId?.trim()))
    || b.id - a.id);
  const pick = (value: (row: TeamRow) => string | null | undefined) => {
    for (const row of ordered) { const found = value(row)?.trim(); if (found) return found; }
    return null;
  };
  const name = pick((row) => row.name);
  return {
    teamId,
    name: name ?? BROKERAGE_NAME,
    firstName: name ? name.split(/\s+/)[0]! : null,
    email: pick((row) => row.email)?.toLowerCase() ?? null,
    phoneE164: pick((row) => row.phoneE164),
    fubUserId: pick((row) => row.fubUserId),
    active: rows.some((row) => row.active),
  };
}

const unique = <T,>(values: T[]) => Array.from(new Set(values));

/**
 * Every team row of the same person as `seed`, active or not:
 * - rows sharing a FUB user id (FUB mirrors one row per phone; a changed phone
 *   leaves the old row behind, deactivated);
 * - hand-added rows (no FUB user) with the same phone or email;
 * - for a hand-added seed row, the FUB user that its phone or email belongs to,
 *   when exactly one FUB user has it, with all of that user's rows.
 * Phones and emails are only matched from the seed rows, so a shared office
 * line on another agent's FUB profile never merges two agents.
 */
async function samePersonRows(seed: TeamRow[]): Promise<TeamRow[]> {
  const db = await getDb();
  const byId = new Map(seed.map((row) => [row.id, row]));
  if (!db || !seed.length) return seed;
  const fubIds = new Set(seed.flatMap((row) => row.fubUserId?.trim() ? [row.fubUserId.trim()] : []));
  const phones = unique(seed.flatMap((row) => row.phoneE164 ? [row.phoneE164] : []));
  const emails = unique(seed.flatMap((row) => row.email?.trim() ? [row.email.trim().toLowerCase()] : []));
  const sameContact = (row: TeamRow, of: TeamRow) =>
    Boolean((row.phoneE164 && row.phoneE164 === of.phoneE164) || (row.email?.trim() && row.email.trim().toLowerCase() === of.email?.trim().toLowerCase()));
  const predicates = [
    fubIds.size ? inArray(dealTeamAllowlist.fubUserId, Array.from(fubIds)) : undefined,
    phones.length ? inArray(dealTeamAllowlist.phoneE164, phones) : undefined,
    emails.length ? inArray(dealTeamAllowlist.email, emails) : undefined,
  ].filter(Boolean) as SQL[];
  const candidates = predicates.length ? await db.select().from(dealTeamAllowlist).where(or(...predicates)) : [];
  for (const manual of seed.filter((row) => !row.fubUserId?.trim())) {
    const owners = unique(candidates.filter((row) => row.fubUserId?.trim() && sameContact(row, manual)).map((row) => row.fubUserId!.trim()));
    if (owners.length === 1) fubIds.add(owners[0]!);
  }
  const extra = Array.from(fubIds).filter((id) => !candidates.some((row) => row.fubUserId?.trim() === id));
  const more = extra.length ? await db.select().from(dealTeamAllowlist).where(inArray(dealTeamAllowlist.fubUserId, extra)) : [];
  for (const row of [...candidates, ...more]) {
    const fubId = row.fubUserId?.trim();
    if (fubId ? fubIds.has(fubId) : seed.some((seedRow) => sameContact(row, seedRow))) byId.set(row.id, row);
  }
  return Array.from(byId.values());
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

export type AgentRowsForLead = { kind: "none" } | { kind: "shared" } | { kind: "one"; rows: TeamRow[]; person: TeamRow[] };

/**
 * The team rows behind a team session, as one person. A number (or email) on
 * more than one agent's profile, such as an office line, is "shared": it still
 * sees the team list, but never one agent's clients or links, because it
 * cannot tell which agent is signing in.
 */
export async function agentRowsForLead(lead: Pick<LeadRow, "phoneE164" | "email">): Promise<AgentRowsForLead> {
  const rows = await teamRowsForLead(lead);
  if (!rows.length) return { kind: "none" };
  const person = await samePersonRows(rows);
  const fubUsers = new Set(person.flatMap((row) => row.fubUserId?.trim() ? [row.fubUserId.trim()] : []));
  if (fubUsers.size > 1) return { kind: "shared" };
  if (!fubUsers.size) {
    const names = new Set(person.flatMap((row) => row.name?.trim() ? [row.name.trim().toLowerCase().replace(/\s+/g, " ")] : []));
    if (names.size > 1) return { kind: "shared" };
  }
  return { kind: "one", rows, person };
}

/** Shown on agent tools when the number signed in is on several agents' profiles. */
export const SHARED_TEAM_NUMBER_MESSAGE = "This number is on more than one agent's profile in Follow Up Boss, so client links are off for it. Sign in with your own cell number to use them.";

/**
 * The agent identity for a team session. A FUB user mirrors to one row per
 * phone, so the row carrying a FUB user id (and a name) wins; the contact
 * details are completed from the other rows of the same person. A shared
 * number has no agent identity.
 */
export async function agentForLead(lead: Pick<LeadRow, "phoneE164" | "email">): Promise<DealsAgent | null> {
  const found = await agentRowsForLead(lead);
  if (found.kind !== "one") return null;
  const { rows } = found;
  const primary = rows.find((row) => row.fubUserId && row.name) ?? rows.find((row) => row.fubUserId) ?? rows.find((row) => row.name) ?? rows[0]!;
  return agentFromRows(primary.id, found.person);
}

/** The agent behind a link or client (by the team row id stored on it). Inactive agents still resolve so history keeps its name. */
export async function agentForTeamId(teamId: number | null | undefined): Promise<DealsAgent | null> {
  if (!teamId) return null;
  const db = await getDb();
  if (!db) return null;
  const row = (await db.select().from(dealTeamAllowlist).where(eq(dealTeamAllowlist.id, teamId)).limit(1))[0];
  if (!row) return null;
  return agentFromRows(row.id, await samePersonRows([row]));
}

/**
 * Admin is removing a team row. Links and clients made under it move to
 * another row of the same person (a hand-added row made redundant by the FUB
 * mirror), so they keep working; with no such row the agent is gone and their
 * links stop, as for an agent who left.
 */
export async function reassignTeamRowBeforeRemoval(teamId: number): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const row = (await db.select().from(dealTeamAllowlist).where(eq(dealTeamAllowlist.id, teamId)).limit(1))[0];
  if (!row) return null;
  const others = (await samePersonRows([row])).filter((other) => other.id !== row.id);
  const target = others.sort((a, b) =>
    Number(b.active) - Number(a.active)
    || Number(Boolean(b.fubUserId?.trim())) - Number(Boolean(a.fubUserId?.trim()))
    || b.id - a.id)[0];
  if (!target) return null;
  await db.update(dealClientLinks).set({ agentTeamId: target.id }).where(eq(dealClientLinks.agentTeamId, row.id));
  await db.update(dealLeads).set({ agentTeamId: target.id }).where(eq(dealLeads.agentTeamId, row.id));
  return target.id;
}

export type CreateClientLinkInput = { agentLead: LeadRow; clientName: string; clientPhone?: string | null; note?: string | null };
export type CreateClientLinkResult =
  | { ok: true; link: ClientLinkRow; path: string }
  | { ok: false; kind: "not_team" | "shared_number" | "invalid_phone" | "invalid_name" | "unavailable" };

/** The relative URL the agent sends; the client lands on the gate with the agent's name on it. */
export function clientLinkPath(token: string) {
  return `/deals?c=${encodeURIComponent(token)}`;
}

export function nationalDigits(e164: string | null | undefined): string | null {
  if (!e164) return null;
  return e164.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
}

export async function createClientLink(input: CreateClientLinkInput): Promise<CreateClientLinkResult> {
  const db = await getDb();
  if (!db) return { ok: false, kind: "unavailable" };
  if (input.agentLead.status !== "team") return { ok: false, kind: "not_team" };
  if ((await agentRowsForLead(input.agentLead)).kind === "shared") return { ok: false, kind: "shared_number" };
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

/** A link is still open: not turned off, and an unused link not past its date (a client's own link never lapses). */
function linkIsOpen(link: ClientLinkRow, now = Date.now(), graceMs = 0) {
  if (link.revokedAt) return false;
  return Boolean(link.leadId) || link.expiresAt.getTime() + graceMs > now;
}

/** A usable link: well-formed token, open, and an agent who is still on the team. */
export async function resolveClientLink(token: string | null | undefined): Promise<ResolvedClientLink | null> {
  const value = token?.trim() ?? "";
  if (!CLIENT_LINK_TOKEN_PATTERN.test(value)) return null;
  const db = await getDb();
  if (!db) return null;
  const link = (await db.select().from(dealClientLinks).where(eq(dealClientLinks.token, value)).limit(1))[0];
  if (!link || !linkIsOpen(link)) return null;
  const agent = await agentForTeamId(link.agentTeamId);
  return agent?.active ? { link, agent } : null;
}

export type LinkPresentation =
  | { state: "live"; agentName: string; clientFirstName: string }
  | { state: "dead"; agentName: string | null };

/**
 * What the gate says for a token. A dead link (turned off, unused past its
 * date, or the agent left) still names the agent when it can, so the visitor
 * is told to ask them for a new link instead of being asked whether they work
 * with an agent.
 */
export async function presentClientLink(token: string | null | undefined): Promise<LinkPresentation | null> {
  const value = token?.trim() ?? "";
  if (!CLIENT_LINK_TOKEN_PATTERN.test(value)) return null;
  const db = await getDb();
  if (!db) return null;
  const link = (await db.select().from(dealClientLinks).where(eq(dealClientLinks.token, value)).limit(1))[0];
  if (!link) return { state: "dead", agentName: null };
  const agent = await agentForTeamId(link.agentTeamId);
  if (!agent?.active || !linkIsOpen(link)) return { state: "dead", agentName: agent?.active ? agent.name : null };
  return { state: "live", agentName: agent.name, clientFirstName: link.clientName.split(/\s+/)[0] ?? "" };
}

export type LinkForPhone =
  | { ok: true; resolved: ResolvedClientLink }
  | { ok: false; kind: "dead" | "other_phone"; agentName: string | null };

/** The link may be used by this phone: the number the agent typed, or the number that first verified through it. */
export async function clientLinkForPhone(token: string | null | undefined, phoneE164: string): Promise<LinkForPhone | null> {
  if (!token) return null;
  const resolved = await resolveClientLink(token);
  if (!resolved) {
    const shown = await presentClientLink(token);
    return shown ? { ok: false, kind: "dead", agentName: shown.agentName } : null;
  }
  const bound = await boundPhone(resolved.link);
  if (bound && bound !== phoneE164) return { ok: false, kind: "other_phone", agentName: resolved.agent.name };
  return { ok: true, resolved };
}

async function boundPhone(link: ClientLinkRow): Promise<string | null> {
  if (link.clientPhoneE164) return link.clientPhoneE164;
  if (!link.leadId) return null;
  const db = await getDb();
  if (!db) return null;
  return (await db.select({ phoneE164: dealLeads.phoneE164 }).from(dealLeads).where(eq(dealLeads.id, link.leadId)).limit(1))[0]?.phoneE164 ?? null;
}

/** Re-checked when the code is approved: a link turned off, or an agent removed, during the code step attaches nothing. */
export async function clientLinkStillValid(linkId: number, phoneE164: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const link = (await db.select().from(dealClientLinks).where(eq(dealClientLinks.id, linkId)).limit(1))[0];
  if (!link || !linkIsOpen(link, Date.now(), CODE_SESSION_GRACE_MS)) return false;
  const agent = await agentForTeamId(link.agentTeamId);
  if (!agent?.active) return false;
  const bound = await boundPhone(link);
  return !bound || bound === phoneE164;
}

/**
 * Whether a buyer's full list is still owed: their link is the one attached to
 * them, not turned off, and their agent is still on the team. Anything else
 * falls back to the scrubbed list (and the gated residue check).
 */
export async function liveAgentForClient(lead: Pick<LeadRow, "id" | "agentTeamId" | "clientLinkId">): Promise<DealsAgent | null> {
  if (!lead.agentTeamId || !lead.clientLinkId) return null;
  const db = await getDb();
  if (!db) return null;
  const link = (await db.select().from(dealClientLinks).where(eq(dealClientLinks.id, lead.clientLinkId)).limit(1))[0];
  if (!link || link.revokedAt || link.leadId !== lead.id) return null;
  const agent = await agentForTeamId(lead.agentTeamId);
  return agent?.active ? agent : null;
}

export type ConnectOffer = "ask" | "connected" | "not_theirs";
/**
 * What a buyer with a live list sees when they open a live client link: their
 * own link again goes straight to the list, a link made for another number is
 * not offered, anything else asks "Connect your list with X?".
 */
export async function connectOfferFor(lead: Pick<LeadRow, "id" | "phoneE164" | "clientLinkId">, token: string): Promise<ConnectOffer | null> {
  const usable = await clientLinkForPhone(token, lead.phoneE164);
  if (!usable) return null;
  if (!usable.ok) return usable.kind === "other_phone" ? "not_theirs" : null;
  return lead.clientLinkId === usable.resolved.link.id && usable.resolved.link.leadId === lead.id ? "connected" : "ask";
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
/**
 * Called inside the verification transaction once the buyer's phone is
 * approved; the first verified phone binds the link. `verifiedAt` marks when
 * the client connected through this link (the agent sees what they did from
 * then on), so renewing access through the same link, or verifying on a second
 * device, keeps it. A client who moved to another link and came back connects
 * again from now.
 */
export async function attachLeadToClientLink(db: DealsWriteDb, linkId: number, leadId: number, previousLinkId: number | null | undefined) {
  const owned = and(eq(dealClientLinks.id, linkId), or(isNull(dealClientLinks.leadId), eq(dealClientLinks.leadId, leadId)));
  if (previousLinkId !== linkId) {
    await db.update(dealClientLinks).set({ leadId, verifiedAt: new Date() }).where(owned);
    return;
  }
  await db.update(dealClientLinks).set({ leadId }).where(owned);
  await db.update(dealClientLinks).set({ verifiedAt: new Date() }).where(and(eq(dealClientLinks.id, linkId), eq(dealClientLinks.leadId, leadId), isNull(dealClientLinks.verifiedAt)));
}

export type AttachLiveSessionResult =
  | { ok: true; attached: true; agent: DealsAgent; linkId: number; expiresAt: Date }
  | { ok: true; attached: false; reason: "team" | "already_attached" }
  | { ok: false; kind: "invalid_link" | "other_phone" | "unavailable" };

/**
 * A buyer who already holds a live list (a reel link verified earlier) opens an
 * agent's client link and confirms "connect me": their phone is verified in this
 * browser, so the attribution is written without a second code. The link must
 * be theirs (typed number or first verifier). The access window grows to the
 * agent-client length. Team members are never attached.
 */
export async function attachLiveSessionToClientLink(input: { lead: LeadRow; token: string; expiryHours: number }): Promise<AttachLiveSessionResult> {
  const db = await getDb();
  if (!db) return { ok: false, kind: "unavailable" };
  if (input.lead.status === "team") return { ok: true, attached: false, reason: "team" };
  const usable = await clientLinkForPhone(input.token, input.lead.phoneE164);
  if (!usable || !usable.ok) return { ok: false, kind: usable && !usable.ok && usable.kind === "other_phone" ? "other_phone" : "invalid_link" };
  const resolved = usable.resolved;
  if (input.lead.clientLinkId === resolved.link.id && resolved.link.leadId === input.lead.id) return { ok: true, attached: false, reason: "already_attached" };
  const fresh = new Date(Date.now() + input.expiryHours * 60 * 60_000);
  const expiresAt = input.lead.expiresAt > fresh ? input.lead.expiresAt : fresh;
  await db.update(dealLeads).set({ agentTeamId: resolved.agent.teamId, clientLinkId: resolved.link.id, expiresAt }).where(eq(dealLeads.id, input.lead.id));
  await attachLeadToClientLink(db, resolved.link.id, input.lead.id, input.lead.clientLinkId);
  await logDealEvent({ leadId: input.lead.id, kind: "client_link_attached", sourceCode: input.lead.sourceCode, deviceHash: input.lead.deviceHash, phone: input.lead.phoneE164, detail: `link:${resolved.link.id};team:${resolved.agent.teamId}` });
  return { ok: true, attached: true, agent: resolved.agent, linkId: resolved.link.id, expiresAt };
}

/** The agent's own links only: every team row of the same person, including rows of a phone FUB later changed. */
async function agentLinkTeamIds(agentLead: LeadRow): Promise<number[]> {
  const found = await agentRowsForLead(agentLead);
  return found.kind === "one" ? found.person.map((row) => row.id) : [];
}

export async function revokeClientLink(agentLead: LeadRow, linkId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const teamIds = await agentLinkTeamIds(agentLead);
  if (!teamIds.length) return false;
  const link = (await db.select().from(dealClientLinks).where(and(eq(dealClientLinks.id, linkId), inArray(dealClientLinks.agentTeamId, teamIds))).limit(1))[0];
  if (!link) return false;
  if (!link.revokedAt) await db.update(dealClientLinks).set({ revokedAt: new Date() }).where(eq(dealClientLinks.id, link.id));
  return true;
}

export type ClientSummary = {
  id: number;
  clientName: string;
  /** The number the agent typed (or the client verified with), formatted; it is their own client, so it is not masked. */
  clientPhone: string | null;
  /** National digits for a "Text it" link, or null when no number is known. */
  clientPhoneDigits: string | null;
  note: string | null;
  path: string;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
  openedAt: string | null;
  openCount: number;
  verifiedAt: string | null;
  /** The client moved to another agent's link: their activity is no longer shown here. */
  movedAway: boolean;
  /** The buyer's own list access: live until this time, then they re-verify through the same link. */
  accessExpiresAt: string | null;
  lastViewedAt: string | null;
  saves: Array<{ card: string; description: string; price: number | null; communityLabel: string; savedAt: string }>;
  requests: Array<{ kind: "tour" | "ask"; description: string; preferredAt: string; createdAt: string }>;
};

export type AgentWorkspace = { agent: DealsAgent; clients: ClientSummary[] };

/**
 * The agent's own clients only. Activity is shown while the client is still
 * attached to this link, and only from the moment they verified through it.
 */
export async function agentWorkspace(agentLead: LeadRow): Promise<AgentWorkspace | null> {
  const db = await getDb();
  if (!db) return null;
  const agent = await agentForLead(agentLead);
  if (!agent) return null;
  const teamIds = await agentLinkTeamIds(agentLead);
  const links = await db.select().from(dealClientLinks).where(inArray(dealClientLinks.agentTeamId, teamIds)).orderBy(desc(dealClientLinks.createdAt), desc(dealClientLinks.id)).limit(200);
  const leadIds = links.flatMap((link) => link.leadId ? [link.leadId] : []);
  const [leads, requests, viewRows] = leadIds.length ? await Promise.all([
    db.select({ id: dealLeads.id, expiresAt: dealLeads.expiresAt, status: dealLeads.status, phoneE164: dealLeads.phoneE164, clientLinkId: dealLeads.clientLinkId }).from(dealLeads).where(inArray(dealLeads.id, leadIds)),
    db.select().from(dealTourRequests).where(and(inArray(dealTourRequests.leadId, leadIds), isNull(dealTourRequests.removedAt))).orderBy(desc(dealTourRequests.createdAt)),
    // Views are already de-duplicated to one row per community per hour, so the latest one is found in memory.
    db.select({ leadId: dealCommunityViews.leadId, viewedAt: dealCommunityViews.viewedAt }).from(dealCommunityViews).where(inArray(dealCommunityViews.leadId, leadIds)).orderBy(desc(dealCommunityViews.viewedAt)).limit(5_000),
  ]) : [[], [], []];
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
    // Only while this link is the client's link, and only what they did after verifying through it.
    const attached = Boolean(lead && lead.clientLinkId === link.id);
    const since = link.verifiedAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const own = attached && lead ? requests.filter((request) => request.leadId === lead.id && request.createdAt.getTime() >= since - 1_000) : [];
    const lastView = attached && lead ? viewRows.find((row) => row.leadId === lead.id && row.viewedAt.getTime() >= since - 1_000)?.viewedAt : undefined;
    const phone = link.clientPhoneE164 ?? (attached ? lead?.phoneE164 ?? null : null);
    return {
      id: link.id,
      clientName: link.clientName,
      clientPhone: phone ? agentDisplayPhone({ phoneE164: phone }) : null,
      clientPhoneDigits: nationalDigits(phone),
      note: link.note,
      path: clientLinkPath(link.token),
      createdAt: link.createdAt.toISOString(),
      expiresAt: link.expiresAt.toISOString(),
      revoked: Boolean(link.revokedAt),
      openedAt: link.openedAt?.toISOString() ?? null,
      openCount: link.openCount,
      verifiedAt: link.verifiedAt?.toISOString() ?? null,
      movedAway: Boolean(lead && !attached),
      accessExpiresAt: attached && lead && lead.status === "verified" && lead.expiresAt > new Date() ? lead.expiresAt.toISOString() : null,
      lastViewedAt: lastView ? new Date(lastView).toISOString() : null,
      saves: own.filter((request) => request.requestType === "save").map((request) => ({ ...describe(request.homeId), savedAt: request.createdAt.toISOString() })),
      requests: own.filter((request): request is typeof request & { requestType: "tour" | "ask" } => request.requestType !== "save").map((request) => ({ kind: request.requestType, description: describe(request.homeId).description, preferredAt: request.preferredAt.toISOString(), createdAt: request.createdAt.toISOString() })),
    };
  });
  return { agent, clients };
}

/**
 * The client-link token for a browser whose session ended (a lapsed list or a
 * code session): the expired page and the gate can then keep the agent's copy
 * and send the visitor back through their own link.
 */
export async function clientLinkTokenForLead(leadId: number | null | undefined): Promise<string | null> {
  if (!leadId) return null;
  const db = await getDb();
  if (!db) return null;
  const lead = (await db.select({ id: dealLeads.id, clientLinkId: dealLeads.clientLinkId, agentTeamId: dealLeads.agentTeamId }).from(dealLeads).where(eq(dealLeads.id, leadId)).limit(1))[0];
  if (!lead?.clientLinkId) return null;
  const link = (await db.select().from(dealClientLinks).where(eq(dealClientLinks.id, lead.clientLinkId)).limit(1))[0];
  return link && link.leadId === lead.id ? link.token : null;
}
