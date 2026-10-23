/**
 * Registers the app's scheduled jobs on server boot.
 *
 * Currently: the daily Follow Up Boss → homepage stats-strip sync, which POSTs
 * to /api/scheduled/syncStats (handled by scheduledStatsHandler). Without this
 * registration the endpoint exists but never fires, so the stats strip would
 * only ever reflect the last manually-seeded values.
 */
import { createHeartbeatJob, listHeartbeatJobs, updateHeartbeatJob } from "./_core/heartbeat";

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
  { name: "builder-deals-activity-note", cron: "47 30 6-12 * * *", path: DEALS_CRON_PATH, payload: { job: "activity" }, description: "1:30 AM Central one-per-day FUB activity note, with hourly retry fires until it has run" },
  { name: "builder-deals-fub-retry", cron: "17 0 * * * *", path: DEALS_CRON_PATH, payload: { job: "fub" }, description: "Hourly Builder Deals CRM retry" },
  { name: "builder-deals-alert-digest", cron: "41 5 * * * *", path: DEALS_CRON_PATH, payload: { job: "alerts" }, description: "Hourly Builder Deals durable alert delivery and digest" },
  { name: "builder-deals-weekly-system-ok", cron: "29 5 12-15 * * 1", path: DEALS_CRON_PATH, payload: { job: "weekly" }, description: "Monday 7:05 AM Central System OK report, with hourly retry fires until it has run" },
  { name: "builder-deals-maintenance", cron: "53 30 12-15 * * 1", path: DEALS_CRON_PATH, payload: { job: "maintenance" }, description: "Monday 7:30 AM Central test record and cached render maintenance, with hourly retry fires" },
] as const;

/**
 * Idempotently ensure the daily stats-sync cron exists. Safe to call on every
 * boot: if a job with our name is already registered it is left untouched.
 * Never throws — if the heartbeat service is unavailable (e.g. Forge env not
 * configured), it logs and the server continues; the strip just keeps showing
 * the last successfully synced values.
 */
export async function ensureStatsSyncCron(): Promise<void> {
  try {
    const { jobs } = await listHeartbeatJobs("");
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
    const { jobs } = await listHeartbeatJobs("");
    for (const candidate of DEALS_JOB_DEFINITIONS) {
      // One rejected job must not stop the others from being created or updated.
      try {
      const existing = jobs.find((j) => j.name === candidate.name);
      if (existing) {
        // A job registered by an earlier build may carry an old cron expression,
        // callback path or payload (the catalog job moved from 23:45/00:45 UTC to
        // 11:00/12:00 UTC). Reconcile it in place so the handler's Chicago window
        // can ever be reached; identical definitions are left untouched.
        if (dealsJobNeedsReconcile(existing, candidate)) {
          await updateHeartbeatJob(existing.taskUid, { cron: candidate.cron, path: candidate.path, method: "POST", payload: candidate.payload, description: candidate.description }, "");
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
  } catch (err) {
    console.error("[cron] could not register Builder Deals jobs:", err instanceof Error ? err.message : err);
  }
}
