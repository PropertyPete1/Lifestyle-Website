import { and, eq, or } from "drizzle-orm";
import { dealDoNotAutoImport, dealKnownAgents, dealTeamAllowlist } from "../drizzle/schema";
import { getDb } from "./db";
import { getActiveBlock } from "./dealsService";

export type DealEligibility = {
  allowed: boolean;
  team: boolean;
  blockedBy?: "blocklist" | "known_agent" | "brokerage_domain" | "fub_realtor";
  matchOn?: "phone" | "email" | "device";
  flags: string[];
};

const normalizeEmail = (email?: string | null) => email?.trim().toLowerCase() || null;
const emailDomain = (email?: string | null) => normalizeEmail(email)?.split("@").at(-1) || null;

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

  const [block, known] = await Promise.all([
    getActiveBlock({ phone: input.phone, email: email ?? undefined, deviceHash: input.deviceHash }),
    db.select().from(dealKnownAgents).where(and(eq(dealKnownAgents.active, true), or(
      eq(dealKnownAgents.phoneE164, input.phone), ...(email ? [eq(dealKnownAgents.email, email)] : []),
    ))).limit(1),
  ]);
  if (block) return { allowed: false, team: false, blockedBy: "blocklist", matchOn: block.phoneE164 ? "phone" : block.email ? "email" : "device", flags: ["blocked"] };
  if (known[0]) return { allowed: false, team: false, blockedBy: "known_agent", matchOn: known[0].phoneE164 === input.phone ? "phone" : "email", flags: ["known_agent"] };
  const domain = emailDomain(email);
  if (domain && input.brokerageDomains.map((value) => value.toLowerCase()).includes(domain)) {
    return { allowed: false, team: false, blockedBy: "brokerage_domain", matchOn: "email", flags: ["brokerage_domain"] };
  }
  // FUB is authoritative only when reachable. A timeout never blocks a buyer:
  // post-verification reconciliation can revoke access if a match is discovered.
  const fubFlags = await fubRealtorMatch(input.phone, email, input.fubRealtorTags, input.fubRealtorSources);
  if (fubFlags.match) return { allowed: false, team: false, blockedBy: "fub_realtor", matchOn: fubFlags.matchOn, flags: ["fub_realtor"] };
  return { allowed: true, team: false, flags: fubFlags.unavailable ? ["fub_check_deferred"] : [] };
}

async function fubRealtorMatch(phone: string, email: string | null, tags: string[], sources: string[]) {
  const apiKey = process.env.FUB_API_KEY;
  if (!apiKey || (!tags.length && !sources.length)) return { match: false, unavailable: false };
  try {
    const lookup = async (kind: "phone" | "email", value: string) => {
      const query = new URL("https://api.followupboss.com/v1/people"); query.searchParams.set(kind, value);
      const response = await fetch(query, { headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`, "User-Agent": "LifestyleDesignRealty-Website/1.0" }, signal: AbortSignal.timeout(3_000) });
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
  const tokens = new Set((input.instagramHandle ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  if (tokens.size && input.handleKeywords.some((keyword) => tokens.has(keyword.trim().toLowerCase()))) flags.push("Possible Agent - Handle");
  return flags;
}
