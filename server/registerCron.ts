/**
 * Registers the app's scheduled jobs on server boot.
 *
 * Currently: the daily Follow Up Boss → homepage stats-strip sync, which POSTs
 * to /api/scheduled/syncStats (handled by scheduledStatsHandler). Without this
 * registration the endpoint exists but never fires, so the stats strip would
 * only ever reflect the last manually-seeded values.
 */
import { createHeartbeatJob, listHeartbeatJobs, updateHeartbeatJob, type HeartbeatJobInfo } from "./_core/heartbeat";

export const STATS_CRON_JOB_NAME = "daily-stats-sync";
/** Daily at 09:00 UTC (early morning US) — 6-field cron: sec min hour dom mon dow. */
export const STATS_CRON_EXPRESSION = "0 0 9 * * *";
export const STATS_CRON_PATH = "/api/scheduled/syncStats";
export const DEALS_CRON_PATH = "/api/scheduled/refreshDeals";

/**
 * No job starts on second :00. The host's shared scheduler drops most fires set for :00 (on Oct 22 the
 * jobs at :00 fired 17-20% of the time, those at :30 about 60%, and the daily jobs, all at :00, not once
 * in 26 tries), so every job runs at its own odd second; the 2-minute photo and catalog calls still start
 * 30 s apart (13 and 43 s past even and odd minutes).
 *
 * Daily jobs: the UTC hours cover the Chicago target in both CDT and CST, then keep firing hourly. The
 * scheduler sometimes drops a fire (Oct 22: no 1 AM fires at all), so every later fire is a retry; the
 * handler runs a job at most once per Chicago day and only at or after its target, so the extra fires
 * answer already_run_today (or not_due_chicago before the target in CST) at the cost of one row read.
 */
export const DEALS_JOB_DEFINITIONS = [
  { name: "builder-deals-health", cron: "23 0 12-15 * * *", path: DEALS_CRON_PATH, payload: { job: "health" }, description: "7:00 AM Central health check, with hourly retry fires until it has run (handler enforces America/Chicago time and once a day)" },
  { name: "builder-deals-incentive-revalidate", cron: "41 15 23,0,1,2 * * *", path: DEALS_CRON_PATH, payload: { job: "incentive" }, description: "6:15 PM Central incentive lapse check, with hourly retry fires until it has run" },
  { name: "builder-deals-catalog-refresh", cron: "13 1-59/2 * * * *", path: DEALS_CRON_PATH, payload: { job: "catalog" }, description: "Every 2 minutes (odd minutes, :13): 20 s of due builder page checks per call, answered within 26 s, 4 AM to 10 PM Central (handler enforces the hours)" },
  { name: "builder-deals-discovery", cron: "37 0 10-13 * * 1", path: DEALS_CRON_PATH, payload: { job: "discovery" }, description: "Monday 5:00 AM Central, with hourly retry fires: find new communities on every builder's site" },
  { name: "builder-deals-discovery-resume", cron: "51 3-59/5 * * * *", path: DEALS_CRON_PATH, payload: { job: "discovery-resume" }, description: "Every 5 minutes (:51 past minutes 3, 8, 13, ...): carry on a discovery run whose server process was retired (one read and nothing else when none is)" },
  { name: "builder-deals-trec-import", cron: "23 15 6-12 * * *", path: DEALS_CRON_PATH, payload: { job: "trec" }, description: "1:15 AM Central TREC import, with hourly retry fires until it has run" },
  { name: "builder-deals-team-sync", cron: "37 30 6-12 * * *", path: DEALS_CRON_PATH, payload: { job: "team" }, description: "1:30 AM Central FUB team mirror, with hourly retry fires until it has run" },
  { name: "builder-deals-known-agent-sync", cron: "53 45 6-12 * * *", path: DEALS_CRON_PATH, payload: { job: "agents" }, description: "1:45 AM Central FUB recruiter mirror, with hourly retry fires until it has run" },
  { name: "builder-deals-photo-queue", cron: "13 */2 * * * *", path: DEALS_CRON_PATH, payload: { job: "photos" }, description: "Every 2 minutes (even minutes, :13): 20 s of due Builder Deals photo processing and expired claims per call, answered within 24 s" },
  // Two more photo jobs at the half minutes: with the main job and the catalog call (which spends its idle budget
  // on photos), a call starts nominally every 30 s. Separate names so each is created, reconciled and fails alone.
  // None starts at :13 of an odd minute, where the catalog call reads builder pages.
  { name: "builder-deals-photo-queue-b", cron: "43 */2 * * * *", path: DEALS_CRON_PATH, payload: { job: "photos" }, description: "Every 2 minutes (even minutes, :43): 20 s of due Builder Deals photo processing per call, answered within 24 s" },
  { name: "builder-deals-photo-queue-c", cron: "43 1-59/2 * * * *", path: DEALS_CRON_PATH, payload: { job: "photos" }, description: "Every 2 minutes (odd minutes, :43, after the catalog call has answered): 20 s of due Builder Deals photo processing per call, answered within 24 s" },
  // October 24, 2026: four more at the quarter minutes, so a photo call starts every 15 s and the onboarding backlog
  // clears in about half the time. Overlapping drains are safe: each claims its rows, a process runs at most two, and
  // the memory guard stops starting photos past PHOTO_RSS_STOP_MB.
  { name: "builder-deals-photo-queue-d", cron: "28 */2 * * * *", path: DEALS_CRON_PATH, payload: { job: "photos" }, description: "Every 2 minutes (even minutes, :28): 20 s of due Builder Deals photo processing per call, answered within 24 s" },
  { name: "builder-deals-photo-queue-e", cron: "58 */2 * * * *", path: DEALS_CRON_PATH, payload: { job: "photos" }, description: "Every 2 minutes (even minutes, :58): 20 s of due Builder Deals photo processing per call, answered within 24 s" },
  { name: "builder-deals-photo-queue-f", cron: "28 1-59/2 * * * *", path: DEALS_CRON_PATH, payload: { job: "photos" }, description: "Every 2 minutes (odd minutes, :28): 20 s of due Builder Deals photo processing per call, answered within 24 s" },
  { name: "builder-deals-photo-queue-g", cron: "58 1-59/2 * * * *", path: DEALS_CRON_PATH, payload: { job: "photos" }, description: "Every 2 minutes (odd minutes, :58): 20 s of due Builder Deals photo processing per call, answered within 24 s" },
  { name: "builder-deals-activity-note", cron: "47 30 6-12 * * *", path: DEALS_CRON_PATH, payload: { job: "activity" }, description: "1:30 AM Central one-per-day FUB activity note, with hourly retry fires until it has run" },
  { name: "builder-deals-fub-retry", cron: "17 0 * * * *", path: DEALS_CRON_PATH, payload: { job: "fub" }, description: "Hourly Builder Deals CRM retry" },
  { name: "builder-deals-alert-digest", cron: "41 5 * * * *", path: DEALS_CRON_PATH, payload: { job: "alerts" }, description: "Hourly Builder Deals durable alert delivery and digest" },
  { name: "builder-deals-weekly-system-ok", cron: "29 5 12-15 * * 1", path: DEALS_CRON_PATH, payload: { job: "weekly" }, description: "Monday 7:05 AM Central System OK report, with hourly retry fires until it has run" },
  { name: "builder-deals-maintenance", cron: "53 30 12-15 * * 1", path: DEALS_CRON_PATH, payload: { job: "maintenance" }, description: "Monday 7:30 AM Central test record and cached render maintenance, with hourly retry fires" },
] as const;

/**
 * Every registered job, page by page. The service pages its list; reading only the first page would miss
 * jobs past it, so they would be created again or never reconciled to a new schedule.
 */
export async function listAllHeartbeatJobs(userSession = ""): Promise<{ total: number; jobs: HeartbeatJobInfo[] }> {
  const PAGE_SIZE = 100;
  const jobs: HeartbeatJobInfo[] = [];
  let total = 0;
  for (let page = 1; page <= 20; page++) {
    const result = await listHeartbeatJobs(userSession, { page, pageSize: PAGE_SIZE });
    total = Number(result.total ?? 0);
    const fresh = (result.jobs ?? []).filter((job) => !jobs.some((seen) => seen.taskUid === job.taskUid));
    jobs.push(...fresh);
    if (!fresh.length || (result.jobs ?? []).length < PAGE_SIZE || (total > 0 && jobs.length >= total)) break;
  }
  return { total: Math.max(total, jobs.length), jobs };
}

/**
 * Idempotently ensure the daily stats-sync cron exists. Safe to call on every
 * boot: if a job with our name is already registered it is left untouched.
 * Never throws — if the heartbeat service is unavailable (e.g. Forge env not
 * configured), it logs and the server continues; the strip just keeps showing
 * the last successfully synced values.
 */
export async function ensureStatsSyncCron(): Promise<void> {
  try {
    const { jobs } = await listAllHeartbeatJobs("");
    if (jobs.some((j) => j.name === STATS_CRON_JOB_NAME)) {
      console.log(`[cron] "${STATS_CRON_JOB_NAME}" already registered — leaving as is`);
      return;
    }
    const { taskUid } = await createHeartbeatJob(
      {
        name: STATS_CRON_JOB_NAME,
        cron: STATS_CRON_EXPRESSION,
        path: STATS_CRON_PATH,
        method: "POST",
        description: "Daily Follow Up Boss → homepage stats strip sync",
      },
      "" // empty session = project owner identity
    );
    console.log(
      `[cron] registered "${STATS_CRON_JOB_NAME}" (${taskUid}) — ${STATS_CRON_EXPRESSION} UTC`
    );
  } catch (err) {
    console.error(
      `[cron] could not register "${STATS_CRON_JOB_NAME}" ` +
        "(stats strip will keep showing last-synced values):",
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * A job the scheduler stopped advancing: its next run is more than STUCK_JOB_MINUTES in the past. On October 22-23,
 * 2026 the TREC import, alert digest, incentive check and both stats syncs sat with a past next run (one a day old)
 * and never fired again, while the frequent jobs kept running. Re-saving the job with its own schedule re-arms it.
 */
export const STUCK_JOB_MINUTES = 10;
export function heartbeatJobIsStuck(job: Pick<HeartbeatJobInfo, "isEnable" | "nextExecutionAt">, now = new Date()): boolean {
  if (!job.isEnable || !job.nextExecutionAt) return false;
  const next = Date.parse(job.nextExecutionAt);
  return Number.isFinite(next) && next < now.getTime() - STUCK_JOB_MINUTES * 60_000;
}

/** Re-saves every stuck job, Builder Deals or not, with its own schedule, path, payload and description, enabled. */
export async function rearmStuckHeartbeatJobs(jobs: HeartbeatJobInfo[], now = new Date(), skip: ReadonlySet<string> = new Set()): Promise<string[]> {
  const rearmed: string[] = [];
  for (const job of jobs) {
    if (skip.has(job.name) || !heartbeatJobIsStuck(job, now)) continue;
    try {
      let payload: unknown = undefined;
      try { payload = job.callbackPayload ? JSON.parse(job.callbackPayload) : undefined; } catch { payload = job.callbackPayload || undefined; }
      await updateHeartbeatJob(job.taskUid, { cron: job.cronExpression, path: job.callbackPath, method: job.callbackMethod === "PUT" ? "PUT" : "POST", payload, description: job.description, enable: true }, "");
      rearmed.push(job.name);
    } catch (err) {
      console.error(`[cron] could not re-arm ${job.name}:`, err instanceof Error ? err.message : err);
    }
  }
  if (rearmed.length) console.log(`[cron] re-armed stuck jobs: ${rearmed.join(", ")}`);
  return rearmed;
}

/** True when a registered job's schedule, callback path or payload no longer matches its definition. */
export function dealsJobNeedsReconcile(existing: { cronExpression?: string | null; callbackPath?: string | null; callbackPayload?: string | null }, candidate: (typeof DEALS_JOB_DEFINITIONS)[number]): boolean {
  const samePayload = (() => {
    try { return JSON.stringify(JSON.parse(existing.callbackPayload ?? "")) === JSON.stringify(candidate.payload); } catch { return false; }
  })();
  return (existing.cronExpression ?? "").trim() !== candidate.cron || (existing.callbackPath ?? "") !== candidate.path || !samePayload;
}

/** Register all Builder Deals jobs idempotently on production startup. */
export async function ensureDealsCron(): Promise<void> {
  try {
    const { jobs } = await listAllHeartbeatJobs("");
    for (const candidate of DEALS_JOB_DEFINITIONS) {
      // One rejected job must not stop the others from being created or updated.
      try {
      const existing = jobs.find((j) => j.name === candidate.name);
      if (existing) {
        // A job registered by an earlier build may carry an old cron expression,
        // callback path or payload (the catalog job moved from 23:45/00:45 UTC to
        // 11:00/12:00 UTC). Reconcile it in place so the handler's Chicago window
        // can ever be reached; identical definitions are left untouched.
        const stuck = heartbeatJobIsStuck(existing);
        if (dealsJobNeedsReconcile(existing, candidate) || stuck) {
          await updateHeartbeatJob(existing.taskUid, { cron: candidate.cron, path: candidate.path, method: "POST", payload: candidate.payload, description: candidate.description, ...(stuck ? { enable: true } : {}) }, "");
          if (stuck) console.log(`[cron] re-armed stuck job ${candidate.name} (next run was ${existing.nextExecutionAt})`);
        }
        continue;
      }
      await createHeartbeatJob({
        name: candidate.name,
        cron: candidate.cron,
        path: DEALS_CRON_PATH,
        method: "POST",
        payload: candidate.payload,
        description: candidate.description,
      }, "");
      } catch (err) {
        console.error(`[cron] could not register ${candidate.name}:`, err instanceof Error ? err.message : err);
      }
    }
    // Jobs registered elsewhere (the stats syncs) are re-armed the same way, with their own definitions.
    await rearmStuckHeartbeatJobs(jobs, new Date(), new Set(DEALS_JOB_DEFINITIONS.map((job) => job.name)));
  } catch (err) {
    console.error("[cron] could not register Builder Deals jobs:", err instanceof Error ? err.message : err);
  }
}
