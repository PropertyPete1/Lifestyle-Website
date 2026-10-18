import type { Request, Response } from "express";
import { sdk } from "./_core/sdk";
import { refreshOfficialDeals } from "./dealsSync";
import { verifyTeamLicensesWithTrec } from "./dealsTrec";

function isScheduledDealsWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  if (value("hour") !== "18") return false;
  const localMidnight = Date.UTC(Number(value("year")), Number(value("month")) - 1, Number(value("day")));
  const launchMidnight = Date.UTC(2026, 9, 18);
  return Math.floor((localMidnight - launchMidnight) / 86_400_000) % 3 === 0;
}

/** Manus-cron-only refresh; a public caller cannot trigger builder fetches. */
export async function scheduledDealsHandler(req: Request, res: Response) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
    if (!isScheduledDealsWindow()) return res.json({ ok: true, skipped: "outside-6pm-central-every-third-day-window" });
    const [catalog, trec] = await Promise.all([refreshOfficialDeals(), verifyTeamLicensesWithTrec()]);
    res.json({ ok: true, catalog, trec });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "deals-refresh-failed" });
  }
}
