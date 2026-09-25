/**
 * /api/scheduled/syncStats — Heartbeat cron callback (project-level cron, §4a).
 *
 * Auth: only Manus cron identities may call this (user.isCron). An
 * unauthenticated or non-cron caller gets a bare 403 — nothing about why.
 * Before this, the auth check ran inside the same try/catch as the sync, so a
 * random anonymous POST was answered with a 500 carrying the server's stack
 * trace and file paths. Auth failures and work failures are now separate.
 *
 * Idempotent: re-running simply recomputes and upserts the same four rows.
 * Graceful failure: a sync error returns 500 with the message (for the
 * platform Investigate flow) and logs the stack server-side; site_stats is
 * never partially written, so the homepage keeps showing the last successfully
 * synced values.
 */
import type { Request, Response } from "express";
import { sdk } from "./_core/sdk";
import { syncStatsFromFub } from "./statsSync";

export async function syncStatsHandler(req: Request, res: Response) {
  let isCron = false;
  try {
    const user = await sdk.authenticateRequest(req);
    isCron = Boolean(user.isCron && user.taskUid);
  } catch {
    isCron = false;
  }
  if (!isCron) {
    res.status(403).json({ error: "cron-only" });
    return;
  }

  try {
    const result = await syncStatsFromFub();
    res.json({ ok: true, updated: result.updated, stats: result.stats ?? null });
  } catch (error) {
    console.error("[syncStats] sync failed:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
      context: { url: req.originalUrl },
      timestamp: new Date().toISOString(),
    });
  }
}
