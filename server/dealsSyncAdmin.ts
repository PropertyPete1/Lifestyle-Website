import { and, desc, eq, gte, sql } from "drizzle-orm";
import { dealCommunities, dealHomes, dealIncentives, dealJobRuns } from "../drizzle/schema";
import { getDb } from "./db";
import { hasBuilderReader, mentionsRate, officialHostFor, publicTextResidue, type DealHoldReason } from "./dealsAdapters";
import { chicagoDay, chicagoEndOfDay, getDealSettings } from "./dealsService";
import { normalizeExcludedTerms, parseStoredScrubList, serializeStoredScrubList } from "./dealsScrub";
import { activeCatalogHold, builderScrubConfig, communityRefreshDue, leaseBuilder, refreshOfficialDeals, storedExcludedScrubTerms, storedScrubConfig, summarizeHolds } from "./dealsSync";
import { communityAreaMap, refreshCommunityGeography } from "./dealsMap";
import { DEAL_SCRUB_CATEGORIES, hasPrivateTerm, mergeDealScrubConfig, normalizeRateFigure, normalizedText, scrubPrivateNames, type DealScrubConfig, type DealScrubConfigInput } from "../shared/deals";

/**
 * Plain functions for the admin router to wire. They throw DealsAdminError with
 * a tRPC-style code so the router can map them one-to-one onto TRPCError.
 */
export class DealsAdminError extends Error {
  constructor(readonly code: "BAD_REQUEST" | "NOT_FOUND" | "CONFLICT" | "PRECONDITION_FAILED" | "INTERNAL_SERVER_ERROR", message: string) {
    super(message);
    this.name = "DealsAdminError";
  }
}

type CommunityRow = typeof dealCommunities.$inferSelect;
type IncentiveRow = typeof dealIncentives.$inferSelect;

async function requireDb() {
  const db = await getDb();
  if (!db) throw new DealsAdminError("INTERNAL_SERVER_ERROR", "Database unavailable.");
  return db;
}

async function requireCommunity(id: number): Promise<CommunityRow> {
  const db = await requireDb();
  const community = (await db.select().from(dealCommunities).where(eq(dealCommunities.id, id)).limit(1))[0];
  if (!community) throw new DealsAdminError("NOT_FOUND", "Community not found.");
  return community;
}

export type StoredScrubListInput = {
  builder: string;
  privateName: string;
  scrubList?: DealScrubConfigInput | null;
  existing?: string | null;
  /** True: the submitted plan and street lists replace the stored (discovered) ones. Default false keeps the union, so an edit never shortens the list. */
  replaceDiscovered?: boolean;
  /** False positives the scrubber and residue checks must ignore; omitted keeps the stored list, a list (even empty) replaces it. */
  excludedTerms?: readonly string[] | null;
};

/**
 * Stored scrub_list value for a saved community: categorized, with the builder
 * and community names always present and the excluded-term list kept beside
 * the categories. Exclusions never apply to builder, lender or community names.
 */
export function storedScrubListForCommunity(input: StoredScrubListInput): string {
  const stored = parseStoredScrubList(input.existing ?? null);
  const kept: DealScrubConfig = input.replaceDiscovered ? { ...stored.categories, plan: [], street: [] } : stored.categories;
  const known = builderScrubConfig(input.builder);
  known.community.push(input.privateName);
  const merged = mergeDealScrubConfig(known, kept, input.scrubList ?? null);
  const config: DealScrubConfig = { ...merged };
  for (const category of DEAL_SCRUB_CATEGORIES) config[category] = config[category].filter((term) => term !== "Manual");
  const excludedTerms = input.excludedTerms === undefined || input.excludedTerms === null ? stored.excludedTerms : normalizeExcludedTerms([...input.excludedTerms]);
  return serializeStoredScrubList(config, excludedTerms);
}

/**
 * Admin wording for the catalog-level hold reasons the sync can record (the
 * incentive-level reasons are handled by heldIncentiveMissingFields). Listed
 * here so a new reason in the adapter union is described for the operator too.
 */
export const CATALOG_HOLD_REASON_HELP: Partial<Record<DealHoldReason, string>> = {
  invalid_source_url: "The saved source URL is not the builder's official community page.",
  unsupported_official_host: "A page redirected off the builder's official host.",
  community_fetch_failed: "The official community page could not be fetched.",
  source_access_refused: "The builder's site refused our reader (HTTP 401/403): the builder blocks automated reads, and the reader does not work around it. A one-off challenge page can clear on its own; if it keeps happening, switch this community to Manual.",
  sitemap_fetch_failed: "The builder's sitemap could not be fetched.",
  detail_fetch_failed: "A plan or home page could not be fetched.",
  missing_community_guid: "The community id could not be read from the official page.",
  inventory_fetch_failed: "The builder's inventory feed could not be fetched.",
  invalid_inventory_response: "The builder's inventory feed returned an unexpected payload.",
  incomplete_inventory: "The inventory is larger than the safety cap, so it was not truncated.",
  expected_community_container_not_found: "The community page layout changed (expected container missing).",
  expected_detail_container_not_found: "A plan or home page layout changed (stat block or gallery missing).",
  unlabelled_home_status: "A home card's status could not be read, so nothing was published or marked sold this run.",
  refresh_failed: "The reader hit an unexpected error on this community's pages; nothing was published or marked sold.",
  private_text_remaining: "A private name, link, web address, e-mail, phone number or NMLS id survived scrubbing; edit the text (or add the name to the names to hide, or exclude a false positive).",
  adjustable_rate: "The offer is an adjustable-rate loan (ARM): the headline rate is a starting rate. Read the terms, then accept or edit the wording.",
  ambiguous_rate: "The offer names more than one rate (for example \"as low as 3.99%\" and \"4.99% fixed\", or a buydown whose figures were read out of order). Check the headline rate (and, for a buydown, the follow-on rate) against the wording before accepting.",
  apr_check: "The APR read does not fit the rate (it is below or equal to the rate, or equal to the down payment): read the builder's figures and type the APR (and the down payment) before accepting.",
  supplied_import_missing: "This builder takes its data from the owner's browser agent (Supplied imports, below), and no import has arrived for this community yet. The agent must post this community's page exactly as saved here.",
  supplied_import_stale: "The browser agent's latest import for this community is more than 36 hours old, so it was not published. Check the agent's daily run.",
  supplied_import_incomplete: "The browser agent's import was partial (page not read whole, or a home count that differs from the page's own), so nothing was published or marked sold. The next complete import clears it.",
  supplied_import_out_of_bounds: "The browser agent's import had a price (50,000 to 5,000,000), beds or baths (1 to 10) or square feet (400 to 15,000) outside the sanity bounds, so nothing from this community was published.",
  supplied_import_invalid_home: "The browser agent's import had a home link off the builder's site, an address without a house number and street, or unreadable move-in wording, so nothing from this community was published.",
  supplied_import_duplicate_home: "The browser agent's import listed the same home twice (same link or address), so nothing from this community was published.",
};

/** One line per stored reason (the sync joins several with ", "); unknown reasons fall back to the raw code. */
export function describeCatalogHold(reason: string): string[] {
  return reason.split(",").map((part) => part.trim()).filter(Boolean).map((part) => CATALOG_HOLD_REASON_HELP[part as DealHoldReason] ?? part.replace(/_/g, " "));
}

const REFRESH_JOB_PREFIX = "deals-refresh-community-";

/**
 * "Refresh now": records a deal_job_runs row for today and runs the single
 * community refresh in the background. A second click while it runs is refused.
 */
export async function refreshCommunityInBackground(communityId: number): Promise<{ queued: boolean; jobName: string; reason?: string }> {
  const db = await requireDb();
  const community = await requireCommunity(communityId);
  if (community.builder === "Manual" || community.manualMode) throw new DealsAdminError("PRECONDITION_FAILED", "This community is in manual mode, no auto-update.");
  if (!community.active && !community.awaitingFirstSync) throw new DealsAdminError("PRECONDITION_FAILED", "This community is archived.");
  if (community.paused) throw new DealsAdminError("PRECONDITION_FAILED", "This community is paused. Resume it first.");
  if (!hasBuilderReader(community.builder)) throw new DealsAdminError("PRECONDITION_FAILED", `There is no reader for ${community.builder} pages yet, so this community cannot be refreshed automatically.`);
  const jobName = `${REFRESH_JOB_PREFIX}${communityId}`;
  const day = chicagoDay();
  const existing = (await db.select().from(dealJobRuns).where(and(eq(dealJobRuns.jobName, jobName), eq(dealJobRuns.chicagoDay, day))).limit(1))[0];
  if (existing) {
    if (existing.status === "running" && existing.startedAt.getTime() > Date.now() - 30 * 60_000) return { queued: false, jobName, reason: "already_running" };
    const claimed = await db.update(dealJobRuns).set({ status: "running", startedAt: new Date(), completedAt: null, detail: null }).where(and(eq(dealJobRuns.id, existing.id), sql`(${dealJobRuns.status} <> 'running' OR ${dealJobRuns.startedAt} <= ${new Date(Date.now() - 30 * 60_000)})`));
    if (!Number((claimed as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0)) return { queued: false, jobName, reason: "already_running" };
  } else {
    try { await db.insert(dealJobRuns).values({ jobName, chicagoDay: day, status: "running" }); } catch { return { queued: false, jobName, reason: "already_running" }; }
  }
  const finish = async (status: "ok" | "failed", detail: string) => {
    const connection = await getDb();
    if (!connection) return;
    await connection.update(dealJobRuns).set({ status, detail: detail.slice(0, 10_000), completedAt: new Date() }).where(and(eq(dealJobRuns.jobName, jobName), eq(dealJobRuns.chicagoDay, day))).catch(() => undefined);
  };
  setImmediate(() => {
    // One request stream per builder: wait for the builder's lease (a running batch lane) before reading its pages.
    const run = async () => {
      for (let attempt = 0; ; attempt++) {
        const lease = await leaseBuilder(community.builder);
        if (lease) {
          try { return await refreshOfficialDeals({ communityId, heartbeat: lease.heartbeat }); } finally { await lease.release(); }
        }
        if (attempt >= 20) throw new Error("builder busy: another check of this builder's pages is still running");
        await new Promise((resolve) => setTimeout(resolve, 15_000));
      }
    };
    run()
      .then((results) => finish(results.some((result) => result.ok) ? "ok" : "failed", JSON.stringify(results)))
      .catch((error) => finish("failed", error instanceof Error ? error.message : "refresh failed"));
  });
  return { queued: true, jobName };
}

export type AdminIncentiveInput = {
  id?: number;
  communityId: number;
  publicText: string;
  manual: boolean;
  contractBy?: string | null;
  closeBy?: string | null;
  headlineRate?: string | null;
  followOnRate?: string | null;
  followOnPeriod?: string | null;
  apr?: string | null;
  loanType?: string | null;
  downPayment?: string | null;
  repaymentTerms?: string | null;
};

function adminDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (!Number.isInteger(year) || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new DealsAdminError("BAD_REQUEST", "Enter a valid calendar date.");
  return chicagoEndOfDay(year, month, day);
}

function earliest(a: Date | null, b: Date | null): Date | null {
  if (a && b) return a < b ? a : b;
  return a ?? b;
}

/** Fields the wording itself requires before publication (mirrors the adapter's hold rules). */
export function incentiveRequiredFields(input: { publicText: string; headlineRate?: string | null; apr?: string | null; followOnRate?: string | null; followOnPeriod?: string | null; loanType?: string | null; downPayment?: string | null; repaymentTerms?: string | null; contractBy?: Date | null; closeBy?: Date | null; noContractDeadline?: boolean }): string[] {
  const missing: string[] = [];
  const text = input.publicText;
  const rateMentioned = Boolean(input.headlineRate?.trim()) || /\d+(?:\.\d+)?%\s*(?:\(|\/)?\s*(?:\d+(?:\.\d+)?%\s*)?(?:APR|rate|fixed|financing)|(?:rate|APR).*\d+(?:\.\d+)?%/i.test(text) || mentionsRate(text);
  if (rateMentioned && !input.apr?.trim()) missing.push("apr");
  if (rateMentioned && /buy[- ]?down|first[- ]year|year\s*1\b|introductory|temporarily/i.test(text)) {
    if (!input.followOnRate?.trim()) missing.push("followOnRate");
    if (!input.followOnPeriod?.trim()) missing.push("followOnPeriod");
  }
  if (rateMentioned && /\d+[- ]year|\d+\s*yr\b|payments?|down\s+payment/i.test(text)) {
    if (!input.loanType?.trim()) missing.push("loanType");
    if (!input.repaymentTerms?.trim()) missing.push("repaymentTerms");
    if (!input.downPayment?.trim()) missing.push("downPayment");
  }
  if (/\b(?:contracts?|purchase\s+agreements?|contract\s+sales?|sign(?:ed|ing)?)\b[^.]{0,100}\b(?:by|through|until|between|from|written)\b/i.test(text) && !input.contractBy && !input.noContractDeadline) missing.push("contractBy");
  if (/\bclos(?:e|ing)\b[^.]{0,35}\b(?:by|before|than|through)\b/i.test(text) && !input.closeBy) missing.push("closeBy");
  return missing;
}

/**
 * Admin incentive save: scrubs with the community's categorized list, refuses
 * private residue, requires every field the wording needs, and publishes
 * immediately. Saving counts as re-confirmation; dates entered here are sticky.
 */
export async function saveIncentiveForCommunity(input: AdminIncentiveInput): Promise<{ ok: true; id: number }> {
  const db = await requireDb();
  const community = await requireCommunity(input.communityId);
  const { id, contractBy: rawContractBy, closeBy: rawCloseBy, communityId, manual, ...fields } = input;
  const existing = id ? (await db.select({ id: dealIncentives.id, normalizedText: dealIncentives.normalizedText, manual: dealIncentives.manual }).from(dealIncentives).where(and(eq(dealIncentives.id, id), eq(dealIncentives.communityId, communityId))).limit(1))[0] : undefined;
  if (id && !existing) throw new DealsAdminError("NOT_FOUND", "Incentive not found.");
  // On a community the sync keeps current, a new non-manual record would be replaced by the builder's own promo on the next
  // refresh (or taken down when the page shows none): wording the builder's page does not show needs the manual override.
  const synced = community.builder !== "Manual" && !community.manualMode && hasBuilderReader(community.builder);
  if (!existing && !manual && synced) throw new DealsAdminError("BAD_REQUEST", "Turn on Manual override to publish wording the builder's page does not show; otherwise the next refresh replaces it.");
  const categories = storedScrubConfig(community);
  const publicText = scrubPrivateNames(fields.publicText.trim(), categories);
  if (hasPrivateTerm(publicText, categories)) throw new DealsAdminError("BAD_REQUEST", "Private names remain in incentive text.");
  const residue = publicTextResidue(publicText);
  if (residue) throw new DealsAdminError("BAD_REQUEST", `Remove the ${residue} from the incentive text before publishing.`);
  // Every typed field is shown to buyers too, so each one gets the same check.
  for (const [field, label] of [["loanType", "loan type"], ["downPayment", "down payment"], ["repaymentTerms", "repayment terms"], ["followOnPeriod", "follow-on period"]] as const) {
    const value = fields[field]?.trim();
    if (value && hasPrivateTerm(value, categories)) throw new DealsAdminError("BAD_REQUEST", `Private names remain in the ${label}. Keep it to the program and figures (for example "FHA" or "3.5% down").`);
  }
  const contractBy = adminDate(rawContractBy);
  const closeBy = adminDate(rawCloseBy);
  const required = incentiveRequiredFields({ ...fields, publicText, contractBy, closeBy });
  if (required.length) throw new DealsAdminError("BAD_REQUEST", `Required before publication: ${required.join(", ")}`);
  const now = new Date();
  const values = {
    // A scraped record keeps the builder's text as its identity, so the next sync of that text re-confirms this saved record
    // (with the admin's wording and values) instead of holding a fresh copy. A manual record is its own wording.
    // A saved record keeps its identity (the builder's text for a scraped one), whether or not the manual override is turned on or off.
    communityId, publicText, normalizedText: existing ? existing.normalizedText : normalizedText(publicText), manual,
    headlineRate: normalizeRateFigure(fields.headlineRate), followOnRate: normalizeRateFigure(fields.followOnRate), followOnPeriod: fields.followOnPeriod ?? null, apr: normalizeRateFigure(fields.apr),
    loanType: fields.loanType ?? null, downPayment: fields.downPayment ?? null, repaymentTerms: fields.repaymentTerms ?? null,
    contractBy, closeBy, contractByManual: contractBy !== null, closeByManual: closeBy !== null, expiresAt: earliest(contractBy, closeBy),
    confirmedAt: now, active: true, held: false, holdReason: null, acceptedAt: now,
  };
  let savedId = id ?? 0;
  await db.transaction(async (tx) => {
    await tx.update(dealIncentives).set({ active: false }).where(eq(dealIncentives.communityId, communityId));
    if (id) await tx.update(dealIncentives).set(values).where(eq(dealIncentives.id, id));
    else savedId = Number((await tx.insert(dealIncentives).values(values) as unknown as [{ insertId: number }])[0].insertId);
    await tx.update(dealCommunities).set({ catalogUpdatedAt: now, incentiveHoldReason: null, incentiveHoldSeenAt: null, holdReason: summarizeHolds(community.catalogHoldReason, null) }).where(eq(dealCommunities.id, communityId));
  });
  return { ok: true, id: savedId };
}

export type AcceptIncentiveHoldInput = {
  id: number;
  contractBy?: string | null;
  closeBy?: string | null;
  /** The "no contract deadline in the text" tick for a contract/sign wording with no captured date. */
  noContractDeadline?: boolean;
  headlineRate?: string | null;
  followOnRate?: string | null;
  followOnPeriod?: string | null;
  apr?: string | null;
  loanType?: string | null;
  downPayment?: string | null;
  repaymentTerms?: string | null;
  publicText?: string | null;
};

export function parseIncentiveHoldReasons(holdReason: string | null | undefined): string[] {
  if (!holdReason) return [];
  try {
    const parsed: unknown = JSON.parse(holdReason);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [holdReason];
  } catch {
    return [holdReason];
  }
}

/** Which admin fields a held incentive still needs before Accept is allowed. */
export function heldIncentiveMissingFields(row: IncentiveRow, patch: Omit<AcceptIncentiveHoldInput, "id"> = {}, categories?: DealScrubConfig): string[] {
  const merged = {
    publicText: patch.publicText?.trim() || row.publicText,
    headlineRate: patch.headlineRate ?? row.headlineRate, apr: patch.apr ?? row.apr,
    followOnRate: patch.followOnRate ?? row.followOnRate, followOnPeriod: patch.followOnPeriod ?? row.followOnPeriod,
    loanType: patch.loanType ?? row.loanType, downPayment: patch.downPayment ?? row.downPayment, repaymentTerms: patch.repaymentTerms ?? row.repaymentTerms,
    contractBy: patch.contractBy ? adminDate(patch.contractBy) : row.contractBy, closeBy: patch.closeBy ? adminDate(patch.closeBy) : row.closeBy,
    noContractDeadline: Boolean(patch.noContractDeadline),
  };
  const missing = new Set(incentiveRequiredFields(merged));
  for (const reason of parseIncentiveHoldReasons(row.holdReason)) {
    if (reason === "missing_contract_deadline" && !merged.contractBy && !merged.noContractDeadline) missing.add("contractBy");
    if (reason === "missing_closing_deadline" && !merged.closeBy) missing.add("closeBy");
    if (reason === "missing_follow_on_rate" && !merged.followOnRate?.trim()) missing.add("followOnRate");
    if (reason === "missing_follow_on_period" && !merged.followOnPeriod?.trim()) missing.add("followOnPeriod");
    if (reason === "missing_down_payment" && !merged.downPayment?.trim()) missing.add("downPayment");
    if (reason === "missing_repayment_term" && !merged.repaymentTerms?.trim()) missing.add("repaymentTerms");
    if (reason === "missing_loan_type" && !merged.loanType?.trim()) missing.add("loanType");
    if (reason === "missing_apr" && !merged.apr?.trim()) missing.add("apr");
    if (reason === "missing_promotional_rate" && !merged.headlineRate?.trim()) missing.add("headlineRate");
    // Two rate figures: the admin names the headline rate the APR belongs to before it shows.
    if (reason === "ambiguous_rate" && !patch.headlineRate?.trim()) missing.add("headlineRate");
    // A misread APR: the admin types the APR, and the down payment when there is one, before it shows.
    if (reason === "apr_check" && !patch.apr?.trim()) missing.add("apr");
    if (reason === "apr_check" && merged.downPayment?.trim() && !patch.downPayment?.trim()) missing.add("downPayment");
    if (reason === "missing_promotional_period" && !merged.followOnPeriod?.trim()) missing.add("followOnPeriod");
  }
  if ((categories && hasPrivateTerm(merged.publicText, categories)) || publicTextResidue(merged.publicText)) missing.add("publicText");
  return Array.from(missing);
}

/**
 * "Accept this update": publishes a held incentive once every field its hold
 * reasons require is filled. Values entered here are sticky for this text.
 */
export async function acceptIncentiveHold(input: AcceptIncentiveHoldInput): Promise<{ ok: true }> {
  const db = await requireDb();
  const incentive = (await db.select().from(dealIncentives).where(eq(dealIncentives.id, input.id)).limit(1))[0];
  if (!incentive || !incentive.held) throw new DealsAdminError("NOT_FOUND", "No held incentive to accept.");
  const community = await requireCommunity(incentive.communityId);
  const categories = storedScrubConfig(community);
  const { id, noContractDeadline, ...patch } = input;
  const publicText = patch.publicText?.trim() ? scrubPrivateNames(patch.publicText.trim(), categories) : incentive.publicText;
  const missing = heldIncentiveMissingFields(incentive, { ...patch, publicText, noContractDeadline }, categories);
  if (missing.length) throw new DealsAdminError("BAD_REQUEST", `Edit and complete this incentive before accepting: ${missing.join(", ")}`);
  if (hasPrivateTerm(publicText, categories)) throw new DealsAdminError("BAD_REQUEST", "Private names remain in incentive text.");
  const residue = publicTextResidue(publicText);
  if (residue) throw new DealsAdminError("BAD_REQUEST", `Remove the ${residue} from the incentive text before accepting.`);
  // The typed fields are shown to buyers too: the same check as a save, on what will be stored.
  for (const [field, label] of [["loanType", "loan type"], ["downPayment", "down payment"], ["repaymentTerms", "repayment terms"], ["followOnPeriod", "follow-on period"]] as const) {
    const value = (patch[field] ?? incentive[field])?.trim();
    if (value && hasPrivateTerm(value, categories)) throw new DealsAdminError("BAD_REQUEST", `Private names remain in the ${label}. Keep it to the program and figures (for example "FHA" or "3.5% down").`);
  }
  const contractBy = patch.contractBy ? adminDate(patch.contractBy) : incentive.contractBy;
  const closeBy = patch.closeBy ? adminDate(patch.closeBy) : incentive.closeBy;
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(dealIncentives).set({ active: false }).where(eq(dealIncentives.communityId, incentive.communityId));
    await tx.update(dealIncentives).set({
      // The scrape's identity (normalizedText) stays the builder's text, so the next sync of the same text re-confirms this
      // accepted record with the admin's wording and values instead of holding a fresh copy.
      publicText, acceptedAt: now,
      headlineRate: normalizeRateFigure(patch.headlineRate ?? incentive.headlineRate), apr: normalizeRateFigure(patch.apr ?? incentive.apr),
      followOnRate: normalizeRateFigure(patch.followOnRate ?? incentive.followOnRate), followOnPeriod: patch.followOnPeriod ?? incentive.followOnPeriod,
      loanType: patch.loanType ?? incentive.loanType, downPayment: patch.downPayment ?? incentive.downPayment, repaymentTerms: patch.repaymentTerms ?? incentive.repaymentTerms,
      contractBy, closeBy, contractByManual: incentive.contractByManual || Boolean(patch.contractBy), closeByManual: incentive.closeByManual || Boolean(patch.closeBy),
      expiresAt: earliest(contractBy, closeBy), active: true, held: false, holdReason: null, confirmedAt: now,
    }).where(eq(dealIncentives.id, incentive.id));
    await tx.update(dealCommunities).set({ catalogUpdatedAt: now, incentiveHoldReason: null, incentiveHoldSeenAt: null, holdReason: summarizeHolds(community.catalogHoldReason, null) }).where(eq(dealCommunities.id, incentive.communityId));
  });
  return { ok: true };
}

/** Dismissing a held incentive keeps it off until the scraped text changes; the same text never re-emails. */
export async function dismissIncentiveHold(id: number): Promise<{ ok: true }> {
  const db = await requireDb();
  const incentive = (await db.select().from(dealIncentives).where(eq(dealIncentives.id, id)).limit(1))[0];
  if (!incentive) throw new DealsAdminError("NOT_FOUND", "Incentive not found.");
  const community = await requireCommunity(incentive.communityId);
  await db.update(dealIncentives).set({ active: false, held: false, holdReason: "dismissed" }).where(eq(dealIncentives.id, id));
  await db.update(dealCommunities).set({ incentiveHoldReason: null, incentiveHoldSeenAt: null, holdReason: summarizeHolds(community.catalogHoldReason, null) }).where(eq(dealCommunities.id, incentive.communityId));
  return { ok: true };
}

/** "Dismiss hold" for a load-failure/missing-container hold: keeps the last good data, no repeat email until the parse result changes. */
export async function dismissCatalogHold(communityId: number): Promise<{ ok: true; dismissed: string | null }> {
  const db = await requireDb();
  const community = await requireCommunity(communityId);
  const reason = activeCatalogHold(community);
  if (!reason) return { ok: true, dismissed: null };
  await db.update(dealCommunities).set({ catalogHoldReason: `dismissed:${reason}`, holdReason: summarizeHolds(null, community.incentiveHoldReason) }).where(eq(dealCommunities.id, communityId));
  return { ok: true, dismissed: reason };
}

const SOURCE_TEST_LIMIT_BYTES = 64 * 1024;

/**
 * Operator diagnostic for the preconfigured official URL only: Manual
 * communities are refused, the host must be the adapter's exact www host, at
 * most 64 KB of the body is read (the readers themselves read the whole page,
 * up to their 8 MB bound), and a redirect is followed only on the same host,
 * as the readers follow it (at most five hops); one to another host is
 * reported, never followed. It sends the readers' own User-Agent, so a site
 * that refuses the reader (HTTP 403) refuses this test too.
 */
export async function testCommunitySource(communityId: number, fetcher: typeof fetch = fetch): Promise<{ host: string; status: number; bytes: number; truncated: boolean; redirected: boolean; redirectSameHost: boolean | null; error?: string }> {
  const community = await requireCommunity(communityId);
  const host = officialHostFor(community.builder);
  if (!host) throw new DealsAdminError("BAD_REQUEST", "Manual communities have no official source to test.");
  let url: URL;
  try { url = new URL(community.sourceUrl); } catch { throw new DealsAdminError("BAD_REQUEST", "The saved source URL is not a valid URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hostname.toLowerCase() !== host) {
    throw new DealsAdminError("BAD_REQUEST", `Use the builder's exact official host (https://${host}/...).`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    let redirected = false;
    let redirectSameHost: boolean | null = null;
    let target = url;
    let response: Response;
    for (let hop = 0; ; hop++) {
      response = await fetcher(target.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "LifestyleDesignRealtyDeals/1.0 (read-only official-page parser)" },
      });
      if (response.status < 300 || response.status >= 400) break;
      redirected = true;
      const location = response.headers.get("location");
      let next: URL | null = null;
      try { next = location ? new URL(location, target) : null; } catch { next = null; }
      const sameHost = next !== null && next.protocol === "https:" && !next.port && !next.username && !next.password && next.hostname.toLowerCase() === host;
      redirectSameHost = location ? sameHost : null;
      // Off the official host (or past five hops): reported, never followed.
      if (!sameHost || hop >= 5) { await response.body?.cancel().catch(() => undefined); break; }
      await response.body?.cancel().catch(() => undefined);
      target = next!;
    }
    let bytes = 0;
    let truncated = false;
    const reader = response.status >= 300 && response.status < 400 ? undefined : response.body?.getReader();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value?.byteLength ?? 0;
        if (bytes >= SOURCE_TEST_LIMIT_BYTES) { truncated = true; await reader.cancel().catch(() => undefined); break; }
      }
    }
    return { host, status: response.status, bytes: Math.min(bytes, SOURCE_TEST_LIMIT_BYTES), truncated, redirected, redirectSameHost };
  } catch (error) {
    return { host, status: 0, bytes: 0, truncated: false, redirected: false, redirectSameHost: null, error: error instanceof Error ? error.name : "fetch_failed" };
  } finally {
    clearTimeout(timer);
  }
}

/** Admin-only operational view of every community: holds, sync times, inventory counts and the incentive state. */
export async function listCommunityDiagnostics(now = new Date()) {
  const db = await requireDb();
  // Three reads for the whole list, not three per community: the list grows to every community in the area.
  const [communities, allHomes, allIncentives, recentRuns, settings] = await Promise.all([
    db.select().from(dealCommunities).orderBy(dealCommunities.id),
    db.select({ communityId: dealHomes.communityId, kind: dealHomes.kind, status: dealHomes.status, origin: dealHomes.origin }).from(dealHomes),
    db.select().from(dealIncentives).orderBy(desc(dealIncentives.confirmedAt), desc(dealIncentives.id)),
    db.select().from(dealJobRuns).where(gte(dealJobRuns.startedAt, new Date(now.getTime() - 14 * 86_400_000))).orderBy(desc(dealJobRuns.startedAt)),
    getDealSettings().catch(() => null),
  ]);
  const group = <T extends { communityId: number }>(rows: readonly T[]) => {
    const byCommunity = new Map<number, T[]>();
    for (const row of rows) byCommunity.set(row.communityId, [...(byCommunity.get(row.communityId) ?? []), row]);
    return byCommunity;
  };
  const homesBy = group(allHomes);
  const incentivesBy = group(allIncentives);
  const refreshEvery = settings?.catalogRefreshDays ?? 1;
  const result = [];
  for (const community of communities) {
    const homes = homesBy.get(community.id) ?? [];
    const incentives = incentivesBy.get(community.id) ?? [];
    const runs = recentRuns.filter((run) => run.jobName === `${REFRESH_JOB_PREFIX}${community.id}`).slice(0, 1);
    const active = incentives.find((row) => row.active) ?? null;
    const held = incentives.filter((row) => row.held);
    const categories = storedScrubConfig(community);
    const catalogHold = activeCatalogHold(community);
    result.push({
      id: community.id,
      builder: community.builder,
      privateName: community.privateName,
      reelCode: community.reelCode,
      active: community.active,
      paused: community.paused,
      manualMode: community.manualMode || community.builder === "Manual",
      lastAttemptAt: community.lastAttemptAt?.toISOString() ?? null,
      lastSuccessfulSyncAt: community.lastSuccessfulSyncAt?.toISOString() ?? null,
      awaitingFirstSync: community.awaitingFirstSync,
      readerAvailable: hasBuilderReader(community.builder),
      refreshDue: community.builder !== "Manual" && !community.manualMode && hasBuilderReader(community.builder) && communityRefreshDue(community.lastSuccessfulSyncAt, now, refreshEvery),
      catalogHold: catalogHold ? { reason: catalogHold, help: describeCatalogHold(catalogHold), since: community.catalogHoldSeenAt?.toISOString() ?? null, ageHours: community.catalogHoldSeenAt ? Math.round((now.getTime() - community.catalogHoldSeenAt.getTime()) / 36e5) : null } : null,
      dismissedCatalogHold: community.catalogHoldReason?.startsWith("dismissed:") ? community.catalogHoldReason.slice("dismissed:".length) : null,
      incentiveHold: community.incentiveHoldReason ? { reason: community.incentiveHoldReason, since: community.incentiveHoldSeenAt?.toISOString() ?? null, ageHours: community.incentiveHoldSeenAt ? Math.round((now.getTime() - community.incentiveHoldSeenAt.getTime()) / 36e5) : null } : null,
      homes: {
        quickMoveIn: homes.filter((home) => home.kind === "quick_move_in" && home.status === "available").length,
        toBeBuilt: homes.filter((home) => home.kind === "to_be_built" && home.status === "available").length,
        sold: homes.filter((home) => home.status === "sold").length,
        hidden: homes.filter((home) => home.status === "hidden").length,
        manual: homes.filter((home) => home.origin === "manual").length,
      },
      incentive: active ? { id: active.id, publicText: active.publicText, manual: active.manual, confirmedAt: active.confirmedAt.toISOString(), expiresAt: active.expiresAt?.toISOString() ?? null, contractBy: active.contractBy?.toISOString() ?? null, closeBy: active.closeBy?.toISOString() ?? null, contractByManual: active.contractByManual, closeByManual: active.closeByManual } : null,
      heldIncentives: held.map((row) => ({ id: row.id, publicText: row.publicText, reasons: parseIncentiveHoldReasons(row.holdReason), missingFields: heldIncentiveMissingFields(row, {}, categories), confirmedAt: row.confirmedAt.toISOString() })),
      scrubConfig: categories,
      excludedTerms: storedExcludedScrubTerms(community),
      areaMap: communityAreaMap(community),
      driveTimeChips: (() => { try { const parsed: unknown = JSON.parse(community.driveTimeChips ?? "[]"); return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []; } catch { return []; } })(),
      lastRefreshRun: runs[0] ? { status: runs[0].status, startedAt: runs[0].startedAt.toISOString(), completedAt: runs[0].completedAt?.toISOString() ?? null, detail: runs[0].detail } : null,
    });
  }
  return result;
}

export { refreshCommunityGeography };
