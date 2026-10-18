import { and, eq, inArray, or } from "drizzle-orm";
import { dealAccessTokens, dealDoNotAutoImport, dealKnownAgents, dealLeads, dealTeamAllowlist } from "../drizzle/schema";
import { getDb } from "./db";
import { getActiveBlock, getDealSettings } from "./dealsService";
import { fubHeaders } from "./fub";

export type DealEligibility = {
  allowed: boolean;
  team: boolean;
  blockedBy?: "has_agent" | "blocklist" | "known_agent" | "brokerage_domain" | "fub_realtor";
  matchOn?: "phone" | "email" | "device";
  flags: string[];
};

const normalizeEmail = (email?: string | null) => email?.trim().toLowerCase() || null;
const emailDomain = (email?: string | null) => normalizeEmail(email)?.split("@").at(-1) || null;

export type DealIdentity = { phoneE164?: string | null; email?: string | null; deviceHash?: string | null };
// Both the project database and its Drizzle transaction implement this query
// surface. Keeping it structural permits post-verification cascades to remain
// atomic without leaking transaction internals through every caller.
type DealsDb = any;

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
  const ids = matches.filter((lead: { id: number; status: string }) => lead.status === "verified").map((lead: { id: number; status: string }) => lead.id);
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
  const ids = matches.map((lead: { id: number }) => lead.id);
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
  await db.update(dealLeads).set({ status: "team" }).where(inArray(dealLeads.id, matches.map((lead: { id: number }) => lead.id)));
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
    .filter((lead: { id: number; phoneE164: string; email: string | null }) => !teamIdentityMatch(lead, members, settings.testTeamNumbers))
    .map((lead: { id: number }) => lead.id);
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
  choice?: "buyer" | "has_agent";
  brokerageDomains: string[];
  fubRealtorTags: string[];
  fubRealtorSources: string[];
  fubTimeoutMs?: number;
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

  if (input.choice === "has_agent") return { allowed: false, team: false, blockedBy: "has_agent", flags: ["has_agent"] };
  const block = await getActiveBlock({ phone: input.phone, email: email ?? undefined, deviceHash: input.deviceHash });
  if (block) return { allowed: false, team: false, blockedBy: "blocklist", matchOn: block.phoneE164 ? "phone" : block.email ? "email" : "device", flags: ["blocked"] };
  const [phoneSuppressed, emailSuppressed] = await Promise.all([isDoNotAutoImport(input.phone), email ? isDoNotAutoImport(email) : Promise.resolve(false)]);
  const eligiblePhone = phoneSuppressed ? null : input.phone;
  const eligibleEmail = emailSuppressed ? null : email;
  const predicates = [...(eligiblePhone ? [eq(dealKnownAgents.phoneE164, eligiblePhone)] : []), ...(eligibleEmail ? [eq(dealKnownAgents.email, eligibleEmail)] : [])];
  const known = predicates.length ? await db.select().from(dealKnownAgents).where(and(eq(dealKnownAgents.active, true), or(...predicates))).limit(1) : [];
  if (known[0]) return { allowed: false, team: false, blockedBy: "known_agent", matchOn: known[0].phoneE164 === input.phone ? "phone" : "email", flags: ["known_agent"] };
  // FUB is authoritative only when reachable. A timeout never blocks a buyer:
  // post-verification reconciliation can revoke access if a match is discovered.
  const fubFlags = await fubRealtorMatch(eligiblePhone, eligibleEmail, input.fubRealtorTags, input.fubRealtorSources, input.fubTimeoutMs);
  if (fubFlags.match) {
    queueScreeningContact({ phone: eligiblePhone, email: eligibleEmail, personId: fubFlags.personId, tag: "Agent - FUB Match", matchOn: fubFlags.matchOn });
    return { allowed: false, team: false, blockedBy: "fub_realtor", matchOn: fubFlags.matchOn, flags: ["fub_realtor"] };
  }
  const domain = emailDomain(email);
  if (domain && input.brokerageDomains.map((value) => value.toLowerCase()).includes(domain)) {
    queueScreeningContact({ phone: eligiblePhone, email, tag: "Possible Agent - Email Domain", matchOn: "email" });
    return { allowed: false, team: false, blockedBy: "brokerage_domain", matchOn: "email", flags: ["brokerage_domain"] };
  }
  return { allowed: true, team: false, flags: fubFlags.unavailable ? ["fub_check_deferred"] : [] };
}

function queueScreeningContact(input: { phone: string | null; email: string | null; personId?: string; tag: "Agent - FUB Match" | "Possible Agent - Email Domain"; matchOn?: "phone" | "email" }) {
  void import("./dealsFub").then(({ tagBuilderDealsScreeningContact }) => tagBuilderDealsScreeningContact(input))
    .then((result) => { if (!result.ok) console.error("[deals] screening contact update failed"); })
    .catch(() => console.error("[deals] screening contact update failed"));
}

async function fubRealtorMatch(phone: string | null, email: string | null, tags: string[], sources: string[], timeoutMs = 3_000): Promise<{ match: boolean; unavailable: boolean; matchOn?: "phone" | "email"; personId?: string }> {
  const apiKey = process.env.FUB_API_KEY;
  if ((!phone && !email) || (!tags.length && !sources.length)) return { match: false, unavailable: false };
  if (!apiKey) return { match: false, unavailable: true };
  try {
    type Person = { id?: string | number; tags?: Array<string | { name?: string; value?: string }>; source?: string };
    const signal = AbortSignal.timeout(timeoutMs);
    const lookup = async (kind: "phone" | "email", value: string) => {
      const query = new URL("https://api.followupboss.com/v1/people"); query.searchParams.set(kind, value);
      const response = await fetch(query, { headers: fubHeaders(apiKey), signal });
      if (!response.ok) throw new Error("FUB unavailable");
      const body = await response.json() as { people?: Person[] };
      if (!Array.isArray(body.people)) throw new Error("Invalid FUB response");
      return body.people;
    };
    const normalizedTags = tags.map((value) => value.toLowerCase());
    const normalizedSources = sources.map((value) => value.toLowerCase());
    const match = (values: Person[]) => values.find((person) => (person.tags ?? []).some((tag) => {
      const name = typeof tag === "string" ? tag : tag.name ?? tag.value ?? "";
      return normalizedTags.includes(name.toLowerCase()) || name.toLowerCase().startsWith("recruit");
    }) || (person.source && normalizedSources.includes(person.source.toLowerCase())));
    const byPhone = phone ? match(await lookup("phone", phone)) : null;
    if (byPhone) return { match: true, matchOn: "phone", personId: byPhone.id === undefined ? undefined : String(byPhone.id), unavailable: false };
    const byEmail = email ? match(await lookup("email", email)) : null;
    if (byEmail) return { match: true, matchOn: "email", personId: byEmail.id === undefined ? undefined : String(byEmail.id), unavailable: false };
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
