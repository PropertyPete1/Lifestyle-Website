/**
 * One-time Builder Deals seed: creates the two launch community rows from the
 * private LAUNCH_DEALS seed data (existing rows are left untouched), geocodes
 * their ZIP centroids, then runs a read-only official refresh for every active
 * community row. Re-running is safe.
 *
 *   DATABASE_URL=... pnpm tsx scripts/seed-deals.mts
 */
import "dotenv/config";
import { seedLaunchDeals } from "../server/dealsSync";
import { listCommunityDiagnostics } from "../server/dealsSyncAdmin";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to seed Builder Deals.");
  process.exit(2);
}

const summary = await seedLaunchDeals();
console.log(`[seed-deals] communities seeded: ${summary.communities}; homes stored: ${summary.homes}; held incentives: ${summary.heldIncentives}`);
for (const community of await listCommunityDiagnostics()) {
  const hold = community.catalogHold ? `catalog hold ${community.catalogHold.reason}` : community.incentiveHold ? `incentive hold ${community.incentiveHold.reason}` : "no hold";
  console.log(`[seed-deals] #${community.id} ${community.builder} ${community.privateName}: QMI ${community.homes.quickMoveIn}, plans ${community.homes.toBeBuilt}, sold ${community.homes.sold}; ${hold}; map ${community.areaMap ? "ready" : "unavailable"}; last success ${community.lastSuccessfulSyncAt ?? "never"}`);
}
process.exit(0);
