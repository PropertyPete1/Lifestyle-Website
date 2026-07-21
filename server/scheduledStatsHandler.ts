/**
 * /api/scheduled/syncStats — Heartbeat cron callback (project-level cron, §4a).
 *
 * Auth: only Manus cron identities may call this (user.isCron).
 * Idempotent: re-running simply recomputes and upserts the same four rows.
 * Graceful failure: on any error we return 500 with structured detail for the
 * platform Investigate flow; site_stats is never partially written, so the
 * homepage keeps showing the last successfully synced values.
 */
import type { Request, Response } from "express";
import { sdk } from "./_core/sdk";
import { syncStatsFromFub } from "./statsSync";

export async function syncStatsHandler(req: Request, res: Response) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron || !user.taskUid) {
      res.status(403).json({ error: "cron-only" });
      return;
    }
    const result = await syncStatsFromFub();
    res.json({ ok: true, updated: result.updated, stats: result.stats ?? null });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: { url: req.originalUrl },
      timestamp: new Date().toISOString(),
    });
  }
}
