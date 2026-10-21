/**
 * Test-only generator of a realistic day of Builder Deals digest entries: one
 * entry per community check, the shape refreshDueCommunitiesBatch records. The
 * numbers follow the live catalog (300+ communities, a few homes added, sold or
 * repriced in most of them, offers re-read daily). Deterministic. Not a test file.
 */
import type { CommunityChangeSummary, HoldNotice } from "./dealsSync";

const BUILDERS = ["Lennar", "D.R. Horton", "Perry Homes", "M/I Homes", "Chesmar", "David Weekley Homes", "Pulte Homes", "Centex", "KB Home", "Highland Homes", "Toll Brothers", "Taylor Morrison"];
const STREETS = ["Blue Sage Trail", "Cypress Bend Way", "Mesquite Ridge Drive", "Willow Creek Lane", "Pecan Grove Court", "Bluebonnet Hill Road", "Limestone Pass", "Cedar Elm Circle", "Rio Frio Path", "Hill Country View"];

function prng(seed: number) {
  let state = seed >>> 0;
  return () => { state = (state * 1_664_525 + 1_013_904_223) >>> 0; return state / 2 ** 32; };
}

export type RealisticDay = { summaries: CommunityChangeSummary[][]; holds: HoldNotice[][] };

/** `communities` checks; about 70% find something; `holds` catalog holds and as many incentive holds. */
export function realisticDigestDay(options: { communities?: number; catalogHolds?: number; incentiveHolds?: number; seed?: number } = {}): RealisticDay {
  const random = prng(options.seed ?? 7);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
  const address = () => `${10_000 + Math.floor(random() * 19_000)} ${pick(STREETS)}`;
  const count = options.communities ?? 320;
  const summaries: CommunityChangeSummary[][] = [];
  const holds: HoldNotice[][] = [];
  for (let index = 0; index < count; index++) {
    const communityId = 30_000 + index;
    const builder = pick(BUILDERS);
    const privateName = `${pick(["Sienna", "Vista", "Mission", "Kallison", "Potranco", "Esperanza", "Riverstone", "Saddle Creek"])} ${pick(["Lakes", "Gardens", "Ranch", "Crossing", "Heights", "Park", "Meadows"])} ${index}`;
    const summary: CommunityChangeSummary = { communityId, privateName, builder, added: [], sold: [], reappeared: [], priceChanges: [], incentive: [] };
    if (random() < 0.7) {
      for (let n = Math.floor(random() * 7); n > 0; n--) summary.added.push(address());
      for (let n = Math.floor(random() * 4); n > 0; n--) summary.sold.push(address());
      if (random() < 0.05) summary.reappeared.push(address());
      for (let n = Math.floor(random() * 5); n > 0; n--) { const from = 300_000 + Math.floor(random() * 400) * 1_000; summary.priceChanges.push({ name: address(), from, to: from - Math.floor(random() * 30) * 1_000 + 5_000 }); }
      if (random() < 0.25) summary.incentive.push(`New incentive published: "${"Save up to $25,000 on select quick move-in homes plus a 4.99% (5.62% APR) 30-year fixed FHA rate with 3.5% down when you contract by November 30, 2026 and close by December 31.".slice(0, 160)}"`);
    }
    summaries.push(summary.added.length + summary.sold.length + summary.reappeared.length + summary.priceChanges.length + summary.incentive.length ? [summary] : []);
    holds.push([]);
  }
  for (let index = 0; index < (options.catalogHolds ?? 14); index++) {
    const at = Math.floor(random() * count);
    const base = summaries[at]![0] ?? { communityId: 30_000 + at, privateName: `Held Community ${at}`, builder: pick(BUILDERS) };
    holds[at]!.push({ communityId: base.communityId, privateName: base.privateName, builder: base.builder, kind: "catalog", reason: pick(["community_fetch_failed", "source_access_refused", "detail_fetch_failed", "expected_detail_container_not_found"]), detail: random() < 0.5 ? "The builder's site refused our reader (HTTP 401/403): the builder is blocking automated reads, and the reader will not work around that. A one-off challenge page can clear on its own; if it keeps happening, switch this community to Manual in Admin, Builder Deals." : undefined });
  }
  for (let index = 0; index < (options.incentiveHolds ?? 14); index++) {
    const at = Math.floor(random() * count);
    const base = summaries[at]![0] ?? { communityId: 30_000 + at, privateName: `Held Community ${at}`, builder: pick(BUILDERS) };
    holds[at]!.push({ communityId: base.communityId, privateName: base.privateName, builder: base.builder, kind: "incentive", reason: "missing_apr, missing_down_payment (text 1a2b3c4d)", detail: `Buyers see "Builder incentive available — ask us for details" for this community until it is reviewed; Accept this update in Admin is optional and publishes the full offer. Held text: "${"Enjoy a 3.99% first-year rate on select homes when you finance with our affiliated lender; years 2-30 at 4.99%. Limited time only, see a sales counselor for details. ".repeat(3).slice(0, 400)}"` });
  }
  return { summaries, holds };
}
