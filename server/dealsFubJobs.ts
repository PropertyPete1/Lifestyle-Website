import crypto from "node:crypto";
import { and, asc, eq, gte, inArray, lte, lt, or, sql } from "drizzle-orm";
import { dealCommunities, dealCommunityViews, dealEvents, dealFubJobs, dealFubRecords, dealHomes, dealLeads, dealTourRequests } from "../drizzle/schema";
import { getDb } from "./db";
import {
  appendBuilderDealsActivity,
  appendBuilderDealsRequestNote,
  appendBuilderDealsTourTask,
  createBuilderDealsRequestNote,
  createBuilderDealsTourTask,
  formatChicagoDateTime,
  sendBuilderDealsLeadToFub,
  type FubAgentRef,
  type FubDeliveryResult,
  updateBuilderDealsLeadInFub,
  updateBuilderDealsProfileInFub,
} from "./dealsFub";
import { sendBuilderDealsEmail } from "./dealsEmail";
import { blockVerifiedDealsIdentity, chicagoDay, chicagoDayStart, getDealSettings } from "./dealsService";

export type FubOperation =
  | "first_unlock"
  | "reverify"
  | "profile_update"
  | `activity:${string}`
  | `request_task:${string}`
  | `request_note:${string}`
  | `request_email:${number}`;

type LeadJobMetadata = { reason?: "re-verified on a second device" | "returned for a new link"; occurrenceId?: string; deferredCheck?: boolean };
type RequestJobMetadata = { requestId: number; chicagoDay?: string };
type ActivityJobMetadata = { chicagoDay?: string };
type JobMetadata = LeadJobMetadata | RequestJobMetadata | ActivityJobMetadata;
type LeadRow = typeof dealLeads.$inferSelect;

/** Up to six 30-second FUB calls can run inside one job; a shorter lease could be reclaimed mid-flight. */
export const LEASE_MS = 15 * 60_000;
const BASE_RETRY_MS = 30_000;
const MAX_RETRY_MS = 60 * 60_000;
/** The deferred realtor re-check is a background write and may wait the full background timeout. */
const DEFERRED_CHECK_TIMEOUT_MS = 30_000;
/** After this many failed FUB attempts (about seven minutes of backoff) the unlock alert goes out without FUB details. */
export const UNLOCK_ALERT_MAX_WAIT_ATTEMPTS = 4;

const LEAD_SYNC_OPERATIONS = new Set<string>(["first_unlock", "reverify", "profile_update"]);

function retryAt(attempts: number) {
  return new Date(Date.now() + Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** Math.min(attempts, 6)));
}
function parseMetadata(value: string): JobMetadata {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as JobMetadata : {};
  } catch { return {}; }
}
function requestIdFromOperation(operation: string): number | null {
  const value = Number(operation.split(":")[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
/** Both stored flag shapes: a bare array or `{ flags: [...] }`. */
export function parseLeadFlags(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    const flags = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray((parsed as { flags?: unknown }).flags) ? (parsed as { flags: unknown[] }).flags : [];
    return flags.filter((flag): flag is string => typeof flag === "string");
  } catch { return []; }
}
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** UTC bounds of one America/Chicago calendar day, correct across both DST offsets. */
export function chicagoDayRange(day: string) {
  const start = chicagoDayStart(new Date(`${day}T12:00:00.000Z`));
  const end = chicagoDayStart(new Date(start.getTime() + 36 * 60 * 60_000));
  return { start, end };
}
/** The Chicago day that ended at the most recent Chicago midnight. */
export function previousChicagoDay(now = new Date()) {
  return chicagoDay(new Date(chicagoDayStart(now).getTime() - 1));
}

/**
 * The unique (lead, operation) key is an outbox idempotency key. On repeat we
 * intentionally update the payload/retry time so a reverify preserves its most
 * recent reason. A currently-held lease retains its state/token, so enqueue
 * cannot cause a concurrent worker to execute the row twice.
 */
export async function enqueueDealsFubJob(
  leadId: number,
  operation: FubOperation,
  metadata: JobMetadata | "re-verified on a second device" | "returned for a new link" = {},
) {
  const db = await getDb();
  if (!db) return;
  const now = new Date();
  const payload = {
    ...(typeof metadata === "string" ? { reason: metadata } : metadata),
    ...(operation === "reverify" ? { occurrenceId: new Date().toISOString() } : {}),
  };
  await db.insert(dealFubJobs).values({ leadId, operation, payload: JSON.stringify(payload), status: "pending", nextAttemptAt: now })
    .onDuplicateKeyUpdate({ set: {
      payload: JSON.stringify(payload),
      // A worker that has already won the compare-and-swap keeps its lease. It
      // re-reads payload after claiming, so it still uses this fresh metadata.
      status: sql`IF(${dealFubJobs.status} = 'leased', 'leased', 'pending')`,
      nextAttemptAt: now,
      lastError: sql`IF(${dealFubJobs.status} = 'leased', ${dealFubJobs.lastError}, NULL)`,
      completedAt: sql`IF(${dealFubJobs.status} = 'leased', ${dealFubJobs.completedAt}, NULL)`,
      leaseToken: sql`IF(${dealFubJobs.status} = 'leased', ${dealFubJobs.leaseToken}, NULL)`,
      leasedAt: sql`IF(${dealFubJobs.status} = 'leased', ${dealFubJobs.leasedAt}, NULL)`,
    } });
}

export async function enqueueDealsRequestJobs(leadId: number, requestId: number, chicagoDay: string) {
  const metadata: RequestJobMetadata = { requestId, chicagoDay };
  await Promise.all([
    // One durable lead/day row and lease serializes concurrent visitors before
    // either the FUB task or the FUB note can be created.
    enqueueDealsFubJob(leadId, `request_task:${chicagoDay}`, metadata),
    enqueueDealsFubJob(leadId, `request_note:${chicagoDay}`, metadata),
    enqueueDealsFubJob(leadId, `request_email:${requestId}`, metadata),
  ]);
}

/** The name prompt / timeline answer: one union PUT per lead, re-run whenever the profile changes again. */
export async function enqueueDealsProfileUpdate(leadId: number) {
  await enqueueDealsFubJob(leadId, "profile_update", { occurrenceId: new Date().toISOString() });
}

/**
 * The router's updateProfile side effects: the FUB profile_update job and the
 * single permitted follow-up flag alert. Team sessions and test numbers outside
 * full-pipeline mode write nothing and alert nobody.
 */
export async function handleDealsProfileUpdate(input: { lead: LeadRow; newFlags: readonly string[] }) {
  const settings = await getDealSettings();
  const isTest = settings.testNumbers.includes(input.lead.phoneE164);
  if (input.lead.status === "team" || input.lead.status === "blocked" || (isTest && !settings.testModeFullPipeline)) return { queued: false as const, alerted: false as const };
  await enqueueDealsProfileUpdate(input.lead.id);
  let alerted = false;
  if (input.newFlags.length) {
    const { queueProfileFlagAlert } = await import("./dealsAlerts");
    alerted = (await queueProfileFlagAlert(input.lead, input.newFlags)).queued;
  }
  void runPendingDealsFubJobs(1).catch((error) => console.error("[deals] profile outbox run failed", error));
  return { queued: true as const, alerted };
}

/**
 * Batches one Chicago day of community views and tour requests into one
 * `activity:{day}` outbox row per lead. Scheduled nightly after the day closes;
 * the job itself writes the single FUB activity note.
 */
export async function enqueueDealsActivityJobs(day = previousChicagoDay()) {
  if (!DAY_PATTERN.test(day)) throw new Error("Invalid Chicago day");
  const db = await getDb();
  if (!db) return { ok: false as const, chicagoDay: day, queued: 0, skipped: 0, reason: "database_unavailable" as const };
  const { start, end } = chicagoDayRange(day);
  const settings = await getDealSettings();
  const [viewRows, requestRows] = await Promise.all([
    db.select({ leadId: dealCommunityViews.leadId, viewedAt: dealCommunityViews.viewedAt }).from(dealCommunityViews).where(and(gte(dealCommunityViews.viewedAt, start), lt(dealCommunityViews.viewedAt, end))),
    db.select({ leadId: dealTourRequests.leadId }).from(dealTourRequests).where(eq(dealTourRequests.chicagoDay, day)),
  ]);
  const leadIds = Array.from(new Set([...viewRows.filter((row) => chicagoDay(row.viewedAt) === day).map((row) => row.leadId), ...requestRows.map((row) => row.leadId)]));
  if (!leadIds.length) return { ok: true as const, chicagoDay: day, queued: 0, skipped: 0 };
  const leads = await db.select({ id: dealLeads.id, status: dealLeads.status, phoneE164: dealLeads.phoneE164 }).from(dealLeads).where(inArray(dealLeads.id, leadIds));
  let queued = 0;
  let skipped = 0;
  for (const lead of leads) {
    const isTest = settings.testNumbers.includes(lead.phoneE164);
    // Team previews and blocked leads create no FUB writes; test numbers only in full-pipeline mode.
    if (lead.status === "team" || lead.status === "blocked" || (isTest && !settings.testModeFullPipeline)) { skipped += 1; continue; }
    await enqueueDealsFubJob(lead.id, `activity:${day}`, { chicagoDay: day });
    queued += 1;
  }
  return { ok: true as const, chicagoDay: day, queued, skipped };
}

/**
 * Scheduled-handler entry point (1:30 AM Chicago): queue the previous Chicago
 * day's activity rows, then drain the outbox so the notes land right away. A
 * row that FUB rejects stays in the outbox for the hourly retry.
 */
export async function enqueueDailyActivityNote(day?: string) {
  const queued = await enqueueDealsActivityJobs(day);
  if (!queued.ok) return queued;
  const run = queued.queued > 0 ? await runPendingDealsFubJobs(Math.max(25, queued.queued)) : null;
  return { ...queued, run };
}

async function recordFubDelivery(leadId: number, result: Extract<FubDeliveryResult, { ok: true }>) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  for (const record of result.records) {
    await db.insert(dealFubRecords).values({ leadId, ...record })
      .onDuplicateKeyUpdate({ set: {
        leadId,
        // A later lookup of an object we originally created must not turn it
        // into an externally owned object and make cleanup leak it forever.
        createdByUs: sql`IF(${dealFubRecords.createdByUs}, true, VALUES(created_by_us))`,
      } });
  }
}

/** Atomically claims one due or abandoned job and verifies its opaque lease token. */
async function leaseDueJob(job: typeof dealFubJobs.$inferSelect) {
  const db = await getDb();
  if (!db) return null;
  const now = new Date();
  const token = crypto.randomUUID();
  const due = or(
    and(eq(dealFubJobs.status, "pending"), lte(dealFubJobs.nextAttemptAt, now)),
    and(eq(dealFubJobs.status, "failed"), lte(dealFubJobs.nextAttemptAt, now)),
    and(eq(dealFubJobs.status, "leased"), lt(dealFubJobs.leasedAt, new Date(now.getTime() - LEASE_MS))),
  );
  // The WHERE is the compare-and-swap. Competing workers may see the same
  // candidate but only one moves it to leased; token re-read proves ownership.
  await db.update(dealFubJobs).set({ status: "leased", leaseToken: token, leasedAt: now, lastError: null })
    .where(and(eq(dealFubJobs.id, job.id), due));
  const claimed = (await db.select().from(dealFubJobs)
    .where(and(eq(dealFubJobs.id, job.id), eq(dealFubJobs.status, "leased"), eq(dealFubJobs.leaseToken, token))).limit(1))[0];
  return claimed ?? null;
}

/** Toggle (c): a test number writes to FUB and emails the team only with the full pipeline on; what it then creates is marked TEST. */
export async function requestTestMode(phoneE164: string): Promise<{ quiet: boolean; isTest: boolean }> {
  const settings = await getDealSettings();
  const isTest = settings.testNumbers.includes(phoneE164);
  return { isTest, quiet: isTest && !settings.testModeFullPipeline };
}

async function loadRequestJob(job: typeof dealFubJobs.$inferSelect) {
  const db = await getDb();
  if (!db) return null;
  const metadata = parseMetadata(job.payload) as RequestJobMetadata;
  const requestId = metadata.requestId ?? requestIdFromOperation(job.operation);
  if (!requestId) return null;
  const request = (await db.select().from(dealTourRequests).where(eq(dealTourRequests.id, requestId)).limit(1))[0];
  if (!request || request.leadId !== job.leadId) return null;
  const lead = (await db.select().from(dealLeads).where(eq(dealLeads.id, job.leadId)).limit(1))[0];
  const home = (await db.select().from(dealHomes).where(eq(dealHomes.id, request.homeId)).limit(1))[0];
  if (!lead || !home || lead.status === "blocked" || lead.status === "team") return null;
  // A quiet test lead (full pipeline off) creates no FUB task, no note and no email; the row is skipped, not failed.
  const testMode = await requestTestMode(lead.phoneE164);
  if (testMode.quiet) return null;
  return { request, lead: { ...lead, isTest: testMode.isTest, agent: await leadAgent(lead) }, home, privateDescription: requestDescription(home) };
}

/** The agent who sent this buyer, for FUB ownership and the notification copy; null for reel leads. */
async function leadAgent(lead: Pick<LeadRow, "agentTeamId">): Promise<FubAgentRef | null> {
  if (!lead.agentTeamId) return null;
  const { agentForTeamId } = await import("./dealsClientLinks");
  const agent = await agentForTeamId(lead.agentTeamId);
  return agent ? { name: agent.name, fubUserId: agent.fubUserId, email: agent.email } : null;
}

function requestDescription(home: Pick<typeof dealHomes.$inferSelect, "privateAddress" | "privatePlanName" | "price">) {
  return `${home.privateAddress ?? "Requested home"}${home.privatePlanName ? ` (${home.privatePlanName})` : ""}${home.price ? `, $${home.price.toLocaleString("en-US")}` : ""}`;
}

type LoadedRequestJob = NonNullable<Awaited<ReturnType<typeof loadRequestJob>>>;
async function loadDayRequestJobs(loaded: LoadedRequestJob) {
  const db = await getDb();
  if (!db) return null;
  const requests = await db.select().from(dealTourRequests)
    .where(and(eq(dealTourRequests.leadId, loaded.lead.id), eq(dealTourRequests.chicagoDay, loaded.request.chicagoDay)))
    .orderBy(asc(dealTourRequests.createdAt), asc(dealTourRequests.id));
  const homes = await Promise.all(requests.map(async (request) =>
    (await db.select().from(dealHomes).where(eq(dealHomes.id, request.homeId)).limit(1))[0],
  ));
  if (homes.some((home) => !home)) return null;
  return requests.map((request, index) => {
    const home = homes[index]!;
    return { request, privateDescription: requestDescription(home) };
  });
}
function combinedDelivery(results: Array<Extract<FubDeliveryResult, { ok: true }>>, taskId?: string): Extract<FubDeliveryResult, { ok: true }> {
  const records = Array.from(new Map(results.flatMap((result) => result.records).map((record) => [`${record.kind}:${record.fubId}`, record])).values());
  const latest = results.at(-1);
  return { ok: true, personId: latest?.personId, taskId, records, warning: results.find((result) => result.warning)?.warning };
}

async function executeRequestTask(job: typeof dealFubJobs.$inferSelect): Promise<FubDeliveryResult> {
  const db = await getDb();
  const loaded = await loadRequestJob(job);
  if (!db) return { ok: false, error: "Database unavailable" };
  if (!loaded) return { ok: true, records: [] };
  const dayRequests = await loadDayRequestJobs(loaded);
  if (!dayRequests?.length) return { ok: false, error: "Builder Deals request home unavailable" };
  const results: Array<Extract<FubDeliveryResult, { ok: true }>> = [];
  let taskId = dayRequests.find(({ request }) => request.fubTaskId)?.request.fubTaskId;
  let createdRequestId: number | null = null;
  if (!taskId) {
    const first = dayRequests[0]!;
    const created = await createBuilderDealsTourTask({ lead: loaded.lead, request: first.request, privateDescription: first.privateDescription });
    if (!created.ok) return created;
    if (!created.taskId) return { ok: false, error: "FUB task did not return an id" };
    taskId = created.taskId;
    createdRequestId = first.request.id;
    results.push(created);
    await db.update(dealTourRequests).set({ fubTaskId: taskId }).where(and(eq(dealTourRequests.leadId, loaded.lead.id), eq(dealTourRequests.chicagoDay, loaded.request.chicagoDay)));
  }
  for (const entry of dayRequests) {
    if (entry.request.id === createdRequestId) continue;
    const appended = await appendBuilderDealsTourTask({ lead: loaded.lead, request: entry.request, taskId, privateDescription: entry.privateDescription });
    if (!appended.ok) return appended;
    results.push(appended);
  }
  await db.update(dealTourRequests).set({ fubTaskId: taskId }).where(and(eq(dealTourRequests.leadId, loaded.lead.id), eq(dealTourRequests.chicagoDay, loaded.request.chicagoDay)));
  return combinedDelivery(results, taskId);
}

async function executeRequestNote(job: typeof dealFubJobs.$inferSelect): Promise<FubDeliveryResult> {
  const db = await getDb();
  const loaded = await loadRequestJob(job);
  if (!db) return { ok: false, error: "Database unavailable" };
  if (!loaded) return { ok: true, records: [] };
  const dayRequests = await loadDayRequestJobs(loaded);
  if (!dayRequests?.length) return { ok: false, error: "Builder Deals request home unavailable" };
  const pending = dayRequests.filter(({ request }) => !request.fubNoteSentAt);
  if (!pending.length) return { ok: true, records: [] };
  const results: Array<Extract<FubDeliveryResult, { ok: true }>> = [];
  let noteId = dayRequests.find(({ request }) => request.fubNoteId)?.request.fubNoteId;
  let createdRequestId: number | null = null;
  if (!noteId) {
    const first = pending[0]!;
    const created = await createBuilderDealsRequestNote({ lead: loaded.lead, request: first.request, privateDescription: first.privateDescription });
    if (!created.ok) return created;
    noteId = created.records.find((record) => record.kind === "note")?.fubId;
    if (!noteId) return { ok: false, error: "FUB note did not return an id" };
    createdRequestId = first.request.id;
    results.push(created);
    await db.update(dealTourRequests).set({ fubNoteId: noteId }).where(and(eq(dealTourRequests.leadId, loaded.lead.id), eq(dealTourRequests.chicagoDay, loaded.request.chicagoDay)));
    await db.update(dealTourRequests).set({ fubNoteSentAt: new Date(), fubNoteId: noteId }).where(eq(dealTourRequests.id, createdRequestId));
  }
  for (const entry of pending) {
    if (entry.request.id === createdRequestId) continue;
    const appended = await appendBuilderDealsRequestNote({ lead: loaded.lead, request: entry.request, noteId, privateDescription: entry.privateDescription });
    if (!appended.ok) return appended;
    results.push(appended);
    await db.update(dealTourRequests).set({ fubNoteSentAt: new Date(), fubNoteId: noteId }).where(eq(dealTourRequests.id, entry.request.id));
  }
  return combinedDelivery(results);
}

async function executeRequestEmail(job: typeof dealFubJobs.$inferSelect): Promise<FubDeliveryResult> {
  const db = await getDb();
  const loaded = await loadRequestJob(job);
  if (!db) return { ok: false, error: "Database unavailable" };
  if (!loaded || loaded.request.emailSentAt) return { ok: true, records: [] };
  const settings = await getDealSettings();
  const testTag = loaded.lead.isTest ? "TEST: " : "";
  const agent = loaded.lead.agent;
  const who = agent ? `${agent.name}'s client ${loaded.lead.name?.trim() || `lead ${loaded.lead.id}`}` : `Builder Deals lead ${loaded.lead.id}`;
  const subjects = { tour: "Builder Deals tour request", ask: "Builder Deals question", save: "Builder Deals: a buyer saved a home" } as const;
  const sent = await sendBuilderDealsEmail({
    category: loaded.request.requestType === "save" ? "home_saved" : "tour_request",
    // The buyer's own agent is told alongside the owners; a reel lead has no agent to add.
    recipients: Array.from(new Set([...settings.alertRecipients, ...(agent?.email ? [agent.email] : [])])),
    subject: `${testTag}${agent ? `${agent.name}'s client: ` : ""}${subjects[loaded.request.requestType]}`,
    content: [
      loaded.lead.isTest ? "TEST RECORD (full-pipeline test mode): eligible for Builder Deals cleanup." : null,
      loaded.request.requestType === "save" ? `${who} saved ${loaded.privateDescription}.` : `${who} requested ${loaded.privateDescription}.`,
      loaded.request.requestType === "save" ? `Saved at: ${formatChicagoDateTime(loaded.request.preferredAt)}` : `Preferred: ${formatChicagoDateTime(loaded.request.preferredAt)}`,
      agent ? `Sent through ${agent.name}'s client link; the FUB contact and task are assigned to ${agent.name}.` : null,
      "Review the protected request in Admin, Builder Deals.",
    ].filter(Boolean).join("\n"),
  });
  if (!sent.ok) return { ok: false, error: sent.error ?? "Builder Deals email was not accepted" };
  await db.update(dealTourRequests).set({ emailSentAt: new Date() }).where(eq(dealTourRequests.id, loaded.request.id));
  return { ok: true, records: [] };
}

type DeferredCheckOutcome = "clear" | "blocked" | "team" | "unavailable";
/**
 * FUB was down when this lead verified, so the realtor match never ran. Re-run
 * the full classification with the background timeout before any FUB write: a
 * match writes the verified-phone blocklist rows and kills the live link.
 */
async function runDeferredRealtorCheck(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, lead: LeadRow, settings: Awaited<ReturnType<typeof getDealSettings>>): Promise<DeferredCheckOutcome> {
  const { classifyDealsAccess } = await import("./dealsEligibility");
  const eligibility = await classifyDealsAccess({
    phone: lead.phoneE164, email: lead.email, deviceHash: lead.deviceHash,
    isTest: settings.testNumbers.includes(lead.phoneE164), testSkipChecks: settings.testNumbersSkipChecks, testTeamNumbers: settings.testTeamNumbers,
    brokerageDomains: settings.brokerageDomains, fubRealtorTags: settings.fubRealtorTags, fubRealtorSources: settings.fubRealtorSources,
    fubTimeoutMs: DEFERRED_CHECK_TIMEOUT_MS,
  });
  if (eligibility.flags.includes("database_unavailable") || eligibility.flags.includes("fub_check_deferred")) return "unavailable";
  if (!eligibility.allowed) {
    const reason = eligibility.blockedBy ?? "post_verification";
    await blockVerifiedDealsIdentity({ phone: lead.phoneE164, email: lead.email, deviceHash: lead.deviceHash, reason }, db);
    await db.update(dealLeads).set({ status: "blocked", revokedAt: new Date() }).where(eq(dealLeads.id, lead.id));
    await db.insert(dealEvents).values({ leadId: lead.id, kind: "blocked", sourceCode: lead.sourceCode, deviceHash: lead.deviceHash, phoneE164: lead.phoneE164, detail: `${reason}:deferred_check` });
    return "blocked";
  }
  return eligibility.team ? "team" : "clear";
}

async function executeLeadJob(job: typeof dealFubJobs.$inferSelect): Promise<FubDeliveryResult> {
  const db = await getDb();
  if (!db) return { ok: false, error: "Database unavailable" };
  const lead = (await db.select().from(dealLeads).where(eq(dealLeads.id, job.leadId)).limit(1))[0];
  if (!lead || lead.status === "blocked" || lead.status === "team") return { ok: true, records: [] };
  let flags = parseLeadFlags(lead.flags);
  const settings = await getDealSettings();
  const metadata = parseMetadata(job.payload) as LeadJobMetadata;
  if (metadata.deferredCheck || flags.includes("fub_check_deferred")) {
    const outcome = await runDeferredRealtorCheck(db, lead, settings);
    if (outcome === "unavailable") return { ok: false, error: "FUB check deferred: FUB is still unavailable" };
    if (outcome === "blocked" || outcome === "team") return { ok: true, records: [] };
    flags = flags.filter((flag) => flag !== "fub_check_deferred");
    await db.update(dealLeads).set({ flags: JSON.stringify(flags) }).where(eq(dealLeads.id, lead.id));
  }
  // The test marker follows test-number membership, not an optional screening
  // flag. The value is captured only in the job runner and never browser-side.
  const payload = { id: lead.id, phone: lead.phoneE164, email: lead.email, name: lead.name, instagramHandle: lead.instagramHandle, sourceCode: lead.sourceCode, consentText: lead.consentText, consentAt: lead.consentAt, consentIp: lead.consentIp, flags, timeline: lead.timeline, isTest: settings.testNumbers.includes(lead.phoneE164), fubPersonId: lead.fubPersonId, agent: await leadAgent(lead) };
  if (job.operation === "first_unlock") return sendBuilderDealsLeadToFub(payload);
  if (job.operation === "profile_update") return updateBuilderDealsProfileInFub(payload);
  return updateBuilderDealsLeadInFub(payload, metadata.reason ?? "returned for a new link", metadata.occurrenceId);
}

async function executeActivityJob(job: typeof dealFubJobs.$inferSelect): Promise<FubDeliveryResult> {
  const db = await getDb();
  if (!db) return { ok: false, error: "Database unavailable" };
  const metadata = parseMetadata(job.payload) as ActivityJobMetadata;
  const day = metadata.chicagoDay ?? job.operation.split(":")[1] ?? "";
  if (!DAY_PATTERN.test(day)) return { ok: false, error: "Builder Deals activity day is invalid", terminal: true };
  const lead = (await db.select().from(dealLeads).where(eq(dealLeads.id, job.leadId)).limit(1))[0];
  if (!lead || lead.status === "blocked" || lead.status === "team") return { ok: true, records: [] };
  const { start, end } = chicagoDayRange(day);
  const [viewRows, requests] = await Promise.all([
    db.select().from(dealCommunityViews).where(and(eq(dealCommunityViews.leadId, lead.id), gte(dealCommunityViews.viewedAt, start), lt(dealCommunityViews.viewedAt, end))).orderBy(asc(dealCommunityViews.viewedAt)),
    db.select().from(dealTourRequests).where(and(eq(dealTourRequests.leadId, lead.id), eq(dealTourRequests.chicagoDay, day))),
  ]);
  const views = viewRows.filter((row) => chicagoDay(row.viewedAt) === day);
  if (!views.length && !requests.length) return { ok: true, records: [] };
  const saves = requests.filter((request) => request.requestType === "save");
  const asks = requests.filter((request) => request.requestType !== "save");
  const communityIds = Array.from(new Set(views.map((view) => view.communityId)));
  const communities = communityIds.length ? await db.select({ id: dealCommunities.id, privateName: dealCommunities.privateName, publicLabel: dealCommunities.publicLabel }).from(dealCommunities).where(inArray(dealCommunities.id, communityIds)) : [];
  const lines = [`Builder Deals activity for ${day} (America/Chicago).`];
  if (views.length) {
    lines.push(`Viewed the list ${views.length} time${views.length === 1 ? "" : "s"} across ${communityIds.length} communit${communityIds.length === 1 ? "y" : "ies"}:`);
    for (const communityId of communityIds) {
      const community = communities.find((row) => row.id === communityId);
      const own = views.filter((view) => view.communityId === communityId);
      const first = own[0]!.viewedAt;
      const last = own[own.length - 1]!.viewedAt;
      lines.push(`- ${community ? `${community.privateName} (shown as ${community.publicLabel})` : `community ${communityId}`}: ${own.length} visit${own.length === 1 ? "" : "s"}, ${formatChicagoDateTime(first)}${own.length > 1 ? ` to ${formatChicagoDateTime(last)}` : ""}`);
    }
  }
  if (asks.length) lines.push(`Tour and question requests: ${asks.length} (homes and preferred times are in the day's Builder Deals request note and task).`);
  if (saves.length) lines.push(`Homes saved: ${saves.length} (listed in the day's Builder Deals request note).`);
  return appendBuilderDealsActivity({ id: lead.id, fubPersonId: lead.fubPersonId, phoneE164: lead.phoneE164, email: lead.email }, day, lines.join("\n"));
}

/**
 * FUB was down when this lead verified, so the realtor match is still pending
 * on its first_unlock row. Until that row syncs, no other operation for the
 * lead (profile update, request task/note/email, activity note) may write to
 * FUB: backoff ordering must never put a task ahead of the realtor check.
 */
export async function waitingForDeferredCheck(job: Pick<typeof dealFubJobs.$inferSelect, "leadId" | "operation">): Promise<boolean> {
  if (job.operation === "first_unlock") return false;
  const db = await getDb();
  if (!db) return false;
  const first = (await db.select().from(dealFubJobs).where(and(eq(dealFubJobs.leadId, job.leadId), eq(dealFubJobs.operation, "first_unlock"))).limit(1))[0];
  if (!first || first.status === "synced") return false;
  return Boolean((parseMetadata(first.payload) as LeadJobMetadata).deferredCheck);
}

async function executeLeasedJob(job: typeof dealFubJobs.$inferSelect): Promise<FubDeliveryResult> {
  if (await waitingForDeferredCheck(job)) return { ok: false, error: "waiting for deferred realtor check" };
  if (LEAD_SYNC_OPERATIONS.has(job.operation)) return executeLeadJob(job);
  if (job.operation.startsWith("activity:")) return executeActivityJob(job);
  if (job.operation.startsWith("request_task:")) return executeRequestTask(job);
  if (job.operation.startsWith("request_note:")) return executeRequestNote(job);
  if (job.operation.startsWith("request_email:")) return executeRequestEmail(job);
  return { ok: false, error: "Unknown Builder Deals FUB job operation", terminal: true };
}

/**
 * The single unlock alert is queued only once the first_unlock job has resolved
 * (delivered, terminally failed, or stalled past the wait limit), so it can carry
 * the FUB person link, the prior assignment and the opt-out marker. Team and
 * blocked leads never alert. Returns true when a new alert row was queued.
 */
async function queueUnlockAlertIfDue(job: typeof dealFubJobs.$inferSelect, result: FubDeliveryResult, attempts: number): Promise<boolean> {
  const delivered = result.ok && result.records.length > 0;
  const stalled = !result.ok && (Boolean(result.terminal) || attempts >= UNLOCK_ALERT_MAX_WAIT_ATTEMPTS);
  if (!delivered && !stalled) return false;
  const db = await getDb();
  if (!db) return false;
  const lead = (await db.select().from(dealLeads).where(eq(dealLeads.id, job.leadId)).limit(1))[0];
  if (!lead || lead.status === "blocked" || lead.status === "team") return false;
  const { queueFirstUnlockAlert } = await import("./dealsAlerts");
  const queued = await queueFirstUnlockAlert(lead, {
    flags: parseLeadFlags(lead.flags).filter((flag) => flag.startsWith("Possible Agent - ")),
    fubPersonId: result.ok ? result.personId ?? lead.fubPersonId : lead.fubPersonId,
    alreadyAssignedTo: result.ok ? result.screening?.alreadyAssignedTo ?? null : null,
    previouslyOptedOut: result.ok ? Boolean(result.screening?.previouslyOptedOut) : false,
    fubIssue: result.ok ? null : result.error,
  });
  return queued.queued;
}

async function notifyTerminalFubFailure(job: typeof dealFubJobs.$inferSelect, error: string) {
  try {
    const settings = await getDealSettings();
    await sendBuilderDealsEmail({
      category: "fub_failure",
      recipients: settings.alertRecipients,
      subject: "Builder Deals FUB write needs attention",
      content: [
        `A Builder Deals FUB write for lead ${job.leadId} (${job.operation}) failed permanently and will not retry on its own.`,
        `Reason: ${error}`,
        "Fix the cause in Follow Up Boss, then use Retry on the job in Admin, Builder Deals.",
      ].join("\n"),
    });
  } catch (notifyError) {
    console.error("[deals fub] terminal failure alert failed", notifyError);
  }
}

/**
 * Re-reads every record after a database compare-and-swap lease. Failed rows
 * are selected again after nextAttemptAt, and stale leases can be recovered
 * after a process crash. No worker completes a row unless its token still owns
 * it, so concurrent web requests and cron runs cannot double-send it.
 */
export async function runPendingDealsFubJobs(limit = 25) {
  const db = await getDb();
  if (!db) return { sent: 0, failed: 0, skipped: 0, leased: 0 };
  const now = new Date();
  const due = or(
    and(eq(dealFubJobs.status, "pending"), lte(dealFubJobs.nextAttemptAt, now)),
    and(eq(dealFubJobs.status, "failed"), lte(dealFubJobs.nextAttemptAt, now)),
    and(eq(dealFubJobs.status, "leased"), lt(dealFubJobs.leasedAt, new Date(now.getTime() - LEASE_MS))),
  );
  const candidates = await db.select().from(dealFubJobs).where(due).orderBy(asc(dealFubJobs.nextAttemptAt), asc(dealFubJobs.id)).limit(limit);
  let sent = 0; let failed = 0; let skipped = 0; let leased = 0;
  for (const candidate of candidates) {
    const job = await leaseDueJob(candidate);
    if (!job) continue;
    // leaseDueJob always writes a token. Keep it as a non-null local value so
    // every subsequent mutation compares against the exact winning lease.
    const leaseToken = job.leaseToken;
    if (!leaseToken) continue;
    leased += 1;
    // Only the unlock/reverify rows own the lead's fubStatus badge; a profile
    // update waiting on an unsynced contact must not flip it to failed.
    const leadSync = job.operation === "first_unlock" || job.operation === "reverify";
    try {
      // An enqueue can update the only per-operation outbox row while this
      // worker holds it. Re-read after claiming so the newest reason wins.
      const current = (await db.select().from(dealFubJobs).where(and(eq(dealFubJobs.id, job.id), eq(dealFubJobs.status, "leased"), eq(dealFubJobs.leaseToken, leaseToken))).limit(1))[0];
      if (!current) continue;
      if (current.payload !== job.payload) {
        await db.update(dealFubJobs).set({ status: "pending", nextAttemptAt: new Date(), leaseToken: null, leasedAt: null }).where(and(eq(dealFubJobs.id, job.id), eq(dealFubJobs.leaseToken, leaseToken)));
        continue;
      }
      const result = await executeLeasedJob(current);
      const afterDelivery = (await db.select({ payload: dealFubJobs.payload }).from(dealFubJobs).where(and(eq(dealFubJobs.id, job.id), eq(dealFubJobs.status, "leased"), eq(dealFubJobs.leaseToken, leaseToken))).limit(1))[0];
      if (afterDelivery && afterDelivery.payload !== current.payload) {
        await db.update(dealFubJobs).set({ status: "pending", nextAttemptAt: new Date(), leaseToken: null, leasedAt: null }).where(and(eq(dealFubJobs.id, job.id), eq(dealFubJobs.leaseToken, leaseToken)));
        continue;
      }
      const attempts = job.attempts + 1;
      // The alert row is durable and keyed per lead, so it is queued before the
      // job row completes: a crash here re-runs a marker-protected job, never
      // a second alert.
      const alertQueued = job.operation === "first_unlock" ? await queueUnlockAlertIfDue(job, result, attempts) : false;
      if (result.ok) {
        await recordFubDelivery(job.leadId, result);
        await db.update(dealFubJobs).set({ status: "synced", completedAt: new Date(), attempts, leaseToken: null, leasedAt: null, lastError: result.warning ?? null })
          .where(and(eq(dealFubJobs.id, job.id), eq(dealFubJobs.status, "leased"), eq(dealFubJobs.leaseToken, leaseToken)));
        if (leadSync && result.records.length > 0) {
          await db.update(dealLeads).set({ fubStatus: "synced", fubPersonId: result.personId ?? undefined }).where(eq(dealLeads.id, job.leadId));
        } else if (job.operation === "profile_update" && result.personId) {
          await db.update(dealLeads).set({ fubPersonId: result.personId }).where(eq(dealLeads.id, job.leadId));
        }
        if (result.records.length === 0) skipped += 1; else sent += 1;
      } else {
        const terminal = Boolean(result.terminal);
        // A terminal failure keeps its row visible for the admin Retry button but
        // is never picked up automatically (a NULL nextAttemptAt is never due).
        await db.update(dealFubJobs).set({ status: "failed", attempts, lastError: result.error, nextAttemptAt: terminal ? null : retryAt(attempts), leaseToken: null, leasedAt: null })
          .where(and(eq(dealFubJobs.id, job.id), eq(dealFubJobs.status, "leased"), eq(dealFubJobs.leaseToken, leaseToken)));
        if (leadSync) await db.update(dealLeads).set({ fubStatus: "failed" }).where(eq(dealLeads.id, job.leadId));
        // The unlock alert already carries a first_unlock failure; every other
        // terminal failure gets its own owner alert.
        if (terminal && !alertQueued) await notifyTerminalFubFailure(job, result.error);
        failed += 1;
      }
    } catch (error) {
      const attempts = job.attempts + 1;
      await db.update(dealFubJobs).set({ status: "failed", attempts, lastError: error instanceof Error ? error.message.slice(0, 10_000) : "FUB job failed", nextAttemptAt: retryAt(attempts), leaseToken: null, leasedAt: null })
        .where(and(eq(dealFubJobs.id, job.id), eq(dealFubJobs.status, "leased"), eq(dealFubJobs.leaseToken, leaseToken)));
      failed += 1;
    }
  }
  return { sent, failed, skipped, leased };
}

export async function retryDealsFubJob(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(dealFubJobs).set({ status: "pending", nextAttemptAt: new Date(), lastError: null, leaseToken: null, leasedAt: null }).where(eq(dealFubJobs.id, id));
}
