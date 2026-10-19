/**
 * Read-only Builder Deals source diagnostic. Runs the real official adapter
 * for every active official community exactly as the nightly refresh does,
 * but writes nothing: it prints each HTTP request's path, status and time,
 * then per plan/home how many gallery photos the adapter parsed, and the
 * hold reasons. Use it when the admin diagnostics show a catalog hold or a
 * community whose cards have no photos.
 *
 *   DATABASE_URL=... pnpm tsx scripts/diagnose-deals-source.mts [community id]
 *
 * Output never includes photo URLs, secrets or lead data; request lines show
 * the path on the official host only.
 */
import "dotenv/config";
import { asc, eq } from "drizzle-orm";
import { dealCommunities } from "../drizzle/schema";
import { getDb } from "../server/db";
import { loadOfficialDeals, type HtmlFetcher } from "../server/dealsAdapters";
import { communitySourceConfig } from "../server/dealsSync";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to read the community rows.");
  process.exit(2);
}

const onlyId = process.argv[2] ? Number(process.argv[2]) : null;
const db = await getDb();
if (!db) {
  console.error("Database unavailable.");
  process.exit(2);
}
const rows = await db.select().from(dealCommunities).where(eq(dealCommunities.active, true)).orderBy(asc(dealCommunities.id));
let exitCode = 0;

for (const community of rows) {
  if (onlyId !== null && community.id !== onlyId) continue;
  const config = communitySourceConfig(community);
  if (!config) {
    console.log(`[diagnose] #${community.id} ${community.builder}: manual or unconfigured, skipped`);
    continue;
  }
  console.log(`[diagnose] #${community.id} ${community.builder}: start`);
  let requests = 0;
  const fetcher: HtmlFetcher = async (input, init) => {
    const started = Date.now();
    const path = (() => { try { return new URL(input).pathname; } catch { return "(invalid url)"; } })();
    try {
      const response = await fetch(input, init);
      requests += 1;
      const length = response.headers.get("content-length") ?? "?";
      console.log(`[diagnose]   GET ${path} -> ${response.status} in ${Date.now() - started} ms (${response.headers.get("content-type") ?? "no type"}, ${length} bytes)`);
      return response;
    } catch (error) {
      requests += 1;
      console.log(`[diagnose]   GET ${path} -> failed in ${Date.now() - started} ms: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      throw error;
    }
  };
  const started = Date.now();
  const result = await loadOfficialDeals(config, { fetcher });
  console.log(`[diagnose] #${community.id} result: ok=${result.ok} catalogOk=${result.catalogOk} holds=[${result.holdReasons.join(", ")}] incentiveHolds=[${result.incentiveHoldReasons.join(", ")}] requests=${requests} in ${Date.now() - started} ms`);
  for (const plan of result.private.plans) {
    console.log(`[diagnose]   plan ${new URL(plan.sourceUrl).pathname}: price=${plan.price ?? "null"} beds=${plan.bedrooms ?? "null"} baths=${plan.bathrooms ?? "null"} sqft=${plan.squareFeet ?? "null"} status=${plan.status ?? "null"} photos=${plan.gallery?.length ?? 0}`);
  }
  for (const home of result.private.homes) {
    console.log(`[diagnose]   home ${new URL(home.sourceUrl).pathname}: price=${home.price ?? "null"} beds=${home.bedrooms ?? "null"} baths=${home.bathrooms ?? "null"} sqft=${home.squareFeet ?? "null"} status=${home.status ?? "null"} photos=${home.gallery?.length ?? 0}`);
  }
  console.log(`[diagnose]   incentive: ${result.private.incentive ? `${result.private.incentive.text.length} chars, headline ${result.private.incentive.facts.promotionalRatePercent ?? "null"}, apr ${result.private.incentive.facts.aprPercent ?? "null"}` : "none"}`);
  if (!result.ok || !result.catalogOk) exitCode = 1;
}
process.exit(exitCode);
