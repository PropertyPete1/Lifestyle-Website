/**
 * Registers the app's scheduled jobs on server boot.
 *
 * Currently: the daily Follow Up Boss → homepage stats-strip sync, which POSTs
 * to /api/scheduled/syncStats (handled by scheduledStatsHandler). Without this
 * registration the endpoint exists but never fires, so the stats strip would
 * only ever reflect the last manually-seeded values.
 */
import { createHeartbeatJob, listHeartbeatJobs } from "./_core/heartbeat";

export const STATS_CRON_JOB_NAME = "daily-stats-sync";
/** Daily at 09:00 UTC (early morning US) — 6-field cron: sec min hour dom mon dow. */
export const STATS_CRON_EXPRESSION = "0 0 9 * * *";
export const STATS_CRON_PATH = "/api/scheduled/syncStats";

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
