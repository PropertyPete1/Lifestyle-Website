import { and, eq, inArray, or } from "drizzle-orm";
import { dealAccessTokens, dealDoNotAutoImport, dealKnownAgents, dealLeads, dealTeamAllowlist } from "../drizzle/schema";
import { getDb } from "./db";
import { getActiveBlock, getDealSettings } from "./dealsService";
import { fubHeaders } from "./fub";

export type DealEligibility = {
  allowed: boolean;
  team: boolean;
  blockedBy?: "blocklist" | "known_agent" | "brokerage_domain" | "fub_realtor";
  matchOn?: "phone" | "email" | "device";
  flags: string[];
};

const normalizeEmail = (email?: string | null) => email?.trim().toLowerCase() || null;
const emailDomain = (email?: string | null) => normalizeEmail(email)?.split("@").at(-1) || null;

export type DealIdentity = { phoneE164?: string | null; email?: string | null; deviceHash?: string | null };
type DealsDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

function identityPredicates(identity: DealIdentity) {
  return [
    identity.phoneE164 ? eq(dealLeads.phoneE164, identity.phoneE164) : undefined,
    identity.email ? eq(dealLeads.email, normalizeEmail(identity.email)!) : undefined,
    identity.deviceHash ? eq(dealLeads.deviceHash, identity.deviceHash) : undefined,
  ].filter(Boolean) as any[];
}

function teamIdentityMatch(
  lead: { phoneE164: string; email: string | null },
  members: Array<{ phoneE164: string | null; email: string | null }>,
  testTeamNumbers: readonly string[],
) {
  return testTeamNumbers.includes(lead.phoneE164) || members.some((member) =>
    member.phoneE164 === lead.phoneE164 || Boolean(lead.email && member.email === lead.email),
  );
}

/**
 * Revokes current buyer access for an identity that is newly classified as an
 * agent. Team previews are deliberately excluded: team has precedence at the
 * gate and an automatic known-agent import may never invalidate staff access.
 */
export async function revokeNonTeamMatchingDealLinks(db: DealsDb, identity: DealIdentity): Promise<number> {
  const predicates = identityPredicates(identity);
  if (!predicates.length) return 0;
  const matches = await db.select({ id: dealLeads.id, status: dealLeads.status })
    .from(dealLeads)
    .where(or(...predicates));
  const ids = matches.filter((lead) => lead.status === "verified").map((lead) => lead.id);
  if (!ids.length) return 0;
  const now = new Date();
  await db.update(dealLeads).set({ status: "blocked", revokedAt: now }).where(inArray(dealLeads.id, ids));
  await db.update(dealAccessTokens).set({ revokedAt: now }).where(inArray(dealAccessTokens.leadId, ids));
  return ids.length;
}

/** Explicit administrator blocks override every prior status, including team previews. */
export async function revokeAllMatchingDealLinks(db: DealsDb, identity: DealIdentity): Promise<number> {
  const predicates = identityPredicates(identity);
  if (!predicates.length) return 0;
  const matches = await db.select({ id: dealLeads.id }).from(dealLeads).where(or(...predicates));
  const ids = matches.map((lead) => lead.id);
  if (!ids.length) return 0;
  const now = new Date();
  await db.update(dealLeads).set({ status: "blocked", revokedAt: now }).where(inArray(dealLeads.id, ids));
  await db.update(dealAccessTokens).set({ revokedAt: now }).where(inArray(dealAccessTokens.leadId, ids));
  return ids.length;
}

/** Marks matching existing leads as team previews without restoring any revoked access token. */
export async function makeMatchingLeadsTeam(db: DealsDb, identity: DealIdentity): Promise<number> {
  const predicates = identityPredicates(identity);
  if (!predicates.length) return 0;
  const matches = await db.select({ id: dealLeads.id }).from(dealLeads).where(or(...predicates));
  if (!matches.length) return 0;
  await db.update(dealLeads).set({ status: "team" }).where(inArray(dealLeads.id, matches.map((lead) => lead.id)));
  return matches.length;
}

/**
 * A reverse team cascade never reactivates a prior link. When the last active
 * team identity disappears, the lead is expired and every existing token is
 * revoked; a future preview requires fresh verification.
 */
export async function revokeOrphanedTeamPreviewLinks(db: DealsDb): Promise<number> {
  const settings = await getDealSettings();
  const [teamLeads, members] = await Promise.all([
    db.select({ id: dealLeads.id, phoneE164: dealLeads.phoneE164, email: dealLeads.email }).from(dealLeads).where(eq(dealLeads.status, "team")),
    db.select({ phoneE164: dealTeamAllowlist.phoneE164, email: dealTeamAllowlist.email }).from(dealTeamAllowlist).where(eq(dealTeamAllowlist.active, true)),
  ]);
  const ids = teamLeads
    .filter((lead) => !teamIdentityMatch(lead, members, settings.testTeamNumbers))
    .map((lead) => lead.id);
  if (!ids.length) return 0;
  const now = new Date();
  await db.update(dealLeads).set({ status: "expired", revokedAt: now }).where(inArray(dealLeads.id, ids));
  await db.update(dealAccessTokens).set({ revokedAt: now }).where(inArray(dealAccessTokens.leadId, ids));
  return ids.length;
}

/** Checks are intentionally ordered: test/team, block, known agent, FUB, domain. */
export async function classifyDealsAccess(input: {
  phone: string;
  email?: string | null;
  deviceHash: string;
  isTest: boolean;
  testSkipChecks: boolean;
  testTeamNumbers?: string[];
  brokerageDomains: string[];
  fubRealtorTags: string[];
  fubRealtorSources: string[];
}): Promise<DealEligibility> {
  const db = await getDb();
  if (!db) return { allowed: false, team: false, blockedBy: "blocklist", flags: ["database_unavailable"] };
  const email = normalizeEmail(input.email);
  // Test-number policy is deliberately evaluated first. A number can be both
  // a staff phone and a test number; its test switches must still control it.
  if (input.isTest && input.testSkipChecks) {
    const testTeam = Boolean(input.testTeamNumbers?.includes(input.phone));
    return { allowed: true, team: testTeam, flags: testTeam ? ["TEST", "team"] : ["TEST"] };
  }
  const [team] = await db.select().from(dealTeamAllowlist).where(and(
    eq(dealTeamAllowlist.active, true),
    or(eq(dealTeamAllowlist.phoneE164, input.phone), ...(email ? [eq(dealTeamAllowlist.email, email)] : [])),
  )).limit(1);
  if (team) return { allowed: true, team: true, flags: ["team"] };

  const [phoneSuppressed, emailSuppressed] = await Promise.all([isDoNotAutoImport(input.phone), email ? isDoNotAutoImport(email) : Promise.resolve(false)]);
  const skipAutoImport = phoneSuppressed || emailSuppressed;
  const [block, known] = await Promise.all([
    getActiveBlock({ phone: input.phone, email: email ?? undefined, deviceHash: input.deviceHash }),
    skipAutoImport ? Promise.resolve([]) : db.select().from(dealKnownAgents).where(and(eq(dealKnownAgents.active, true), or(
      eq(dealKnownAgents.phoneE164, input.phone), ...(email ? [eq(dealKnownAgents.email, email)] : []),
    ))).limit(1),
  ]);
  if (block) return { allowed: false, team: false, blockedBy: "blocklist", matchOn: block.phoneE164 ? "phone" : block.email ? "email" : "device", flags: ["blocked"] };
  if (known[0]) return { allowed: false, team: false, blockedBy: "known_agent", matchOn: known[0].phoneE164 === input.phone ? "phone" : "email", flags: ["known_agent"] };
  // FUB is authoritative only when reachable. A timeout never blocks a buyer:
  // post-verification reconciliation can revoke access if a match is discovered.
  const fubFlags = skipAutoImport ? { match: false, matchOn: "phone" as const, unavailable: false } : await fubRealtorMatch(input.phone, email, input.fubRealtorTags, input.fubRealtorSources);
  if (fubFlags.match) return { allowed: false, team: false, blockedBy: "fub_realtor", matchOn: fubFlags.matchOn, flags: ["fub_realtor"] };
  const domain = emailDomain(email);
  if (domain && input.brokerageDomains.map((value) => value.toLowerCase()).includes(domain)) {
    return { allowed: false, team: false, blockedBy: "brokerage_domain", matchOn: "email", flags: ["brokerage_domain"] };
  }
  return { allowed: true, team: false, flags: fubFlags.unavailable ? ["fub_check_deferred"] : [] };
}

async function fubRealtorMatch(phone: string, email: string | null, tags: string[], sources: string[]) {
  const apiKey = process.env.FUB_API_KEY;
  if (!apiKey || (!tags.length && !sources.length)) return { match: false, unavailable: false };
  try {
    const lookup = async (kind: "phone" | "email", value: string) => {
      const query = new URL("https://api.followupboss.com/v1/people"); query.searchParams.set(kind, value);
      const response = await fetch(query, { headers: fubHeaders(apiKey), signal: AbortSignal.timeout(3_000) });
      if (!response.ok) throw new Error("FUB unavailable"); return (await response.json().catch(() => ({})) as { people?: Array<{ tags?: string[]; source?: string }> }).people ?? [];
    };
    const normalizedTags = tags.map((value) => value.toLowerCase());
    const normalizedSources = sources.map((value) => value.toLowerCase());
    const match = (values: Array<{ tags?: string[]; source?: string }>) => values.some((person) => (person.tags ?? []).some((tag) => normalizedTags.includes(tag.toLowerCase()) || tag.toLowerCase().startsWith("recruit")) || (person.source && normalizedSources.includes(person.source.toLowerCase())));
    if (match(await lookup("phone", phone))) return { match: true, matchOn: "phone" as const, unavailable: false };
    if (email && match(await lookup("email", email))) return { match: true, matchOn: "email" as const, unavailable: false };
    return { match: false, unavailable: false };
  } catch { return { match: false, unavailable: true }; }
}

export async function isDoNotAutoImport(value: string) {
  const db = await getDb();
  if (!db) return false;
  return Boolean((await db.select({ id: dealDoNotAutoImport.id }).from(dealDoNotAutoImport).where(eq(dealDoNotAutoImport.value, value.toLowerCase())).limit(1))[0]);
}

/** Profile-time checks are flags, not a silent revocation; staff can review them. */
export async function profileRealtorFlags(input: { name?: string | null; instagramHandle?: string | null; handleKeywords: string[]; trecCounties: string[] }) {
  const flags: string[] = [];
  if (input.name?.trim()) {
    const { lookupTrecName } = await import("./dealsTrec");
    if ((await lookupTrecName(input.name, input.trecCounties)).length) flags.push("Possible Agent - TREC Name Match");
  }
  const tokens = new Set([input.instagramHandle ?? "", input.name ?? ""].join(" ").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  if (tokens.size && input.handleKeywords.some((keyword) => tokens.has(keyword.trim().toLowerCase()))) flags.push("Possible Agent - Handle");
  return flags;
}
