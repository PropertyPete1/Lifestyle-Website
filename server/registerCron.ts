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

export const DEALS_JOB_DEFINITIONS = [
  { name: "builder-deals-health", cron: "0 0 12,13 * * *", path: DEALS_CRON_PATH, payload: { job: "health" }, description: "7:00 AM Central health-check candidates; handler enforces America/Chicago time" },
  { name: "builder-deals-incentive-revalidate", cron: "0 15 23,0 * * *", path: DEALS_CRON_PATH, payload: { job: "incentive" }, description: "6:15 PM Central incentive lapse-only candidates for DST" },
  { name: "builder-deals-catalog-refresh", cron: "0 0 11,12 * * *", path: DEALS_CRON_PATH, payload: { job: "catalog" }, description: "6:00 AM Central official catalog candidates for DST; handler runs only when 3 days old" },
  { name: "builder-deals-trec-import", cron: "0 15 6,7 * * *", path: DEALS_CRON_PATH, payload: { job: "trec" }, description: "1:15 AM Central TREC import candidates for DST" },
  { name: "builder-deals-team-sync", cron: "0 30 6,7 * * *", path: DEALS_CRON_PATH, payload: { job: "team" }, description: "1:30 AM Central FUB team mirror candidates for DST" },
  { name: "builder-deals-known-agent-sync", cron: "0 45 6,7 * * *", path: DEALS_CRON_PATH, payload: { job: "agents" }, description: "1:45 AM Central FUB recruiter mirror candidates for DST" },
  { name: "builder-deals-photo-queue", cron: "0 */10 * * * *", path: DEALS_CRON_PATH, payload: { job: "photos" }, description: "Every 10 minutes: drain due Builder Deals photo processing and expired leases" },
  { name: "builder-deals-activity-note", cron: "0 30 6,7 * * *", path: DEALS_CRON_PATH, payload: { job: "activity" }, description: "1:30 AM Central candidates for the one-per-day FUB activity note; handler enforces America/Chicago time" },
  { name: "builder-deals-fub-retry", cron: "0 0 * * * *", path: DEALS_CRON_PATH, payload: { job: "fub" }, description: "Hourly Builder Deals CRM retry" },
  { name: "builder-deals-alert-digest", cron: "0 5 * * * *", path: DEALS_CRON_PATH, payload: { job: "alerts" }, description: "Hourly Builder Deals durable alert delivery and digest" },
  { name: "builder-deals-weekly-system-ok", cron: "0 5 12,13 * * 1", path: DEALS_CRON_PATH, payload: { job: "weekly" }, description: "Monday 7:05 AM Central System OK candidates for DST" },
  { name: "builder-deals-maintenance", cron: "0 30 12,13 * * 1", path: DEALS_CRON_PATH, payload: { job: "maintenance" }, description: "Monday 7:30 AM Central candidate: test record and cached render maintenance" },
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
    }
  } catch (err) {
    console.error("[cron] could not register Builder Deals jobs:", err instanceof Error ? err.message : err);
  }
}
