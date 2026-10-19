import { DEAL_SCRUB_CATEGORIES, emptyDealScrubConfig, parseDealScrubConfig, type DealScrubConfig } from "../shared/deals";

/**
 * The stored deal_communities.scrub_list document: the six private-name
 * categories plus `excludedTerms`, the admin's list of false positives (a
 * discovered H1 title, a plan name that is an everyday word) that no scrubber
 * and no residue check may treat as private. Exclusions never touch the
 * builder, lender or community categories: those names must always be scrubbed.
 */
export const EXCLUDED_TERMS_KEY = "excludedTerms";
const EXCLUDABLE_CATEGORIES = ["plan", "street", "other"] as const satisfies ReadonlyArray<(typeof DEAL_SCRUB_CATEGORIES)[number]>;
const MAX_EXCLUDED_TERMS = 200;

export type StoredScrubList = { categories: DealScrubConfig; excludedTerms: string[] };

export function normalizeExcludedTerms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const term = raw.trim().replace(/\s+/g, " ");
    const key = term.toLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length >= MAX_EXCLUDED_TERMS) break;
  }
  return terms;
}

/** Parses the stored JSON (categorized, or a legacy flat array that lands in "other"); exclusions are returned, not yet applied. */
export function parseStoredScrubList(raw: string | null | undefined): StoredScrubList {
  let parsed: unknown = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
  const categories = parseDealScrubConfig(parsed);
  const excludedTerms = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? normalizeExcludedTerms((parsed as Record<string, unknown>)[EXCLUDED_TERMS_KEY]) : [];
  return { categories, excludedTerms };
}

/** Drops excluded terms from the plan, street and other categories; builder, lender and community terms are never excluded. */
export function applyScrubExclusions(config: DealScrubConfig, excludedTerms: readonly string[]): DealScrubConfig {
  const result: DealScrubConfig = { ...emptyDealScrubConfig(), ...parseDealScrubConfig(config) };
  if (!excludedTerms.length) return result;
  const skip = new Set(excludedTerms.map((term) => term.trim().toLowerCase()));
  for (const category of EXCLUDABLE_CATEGORIES) result[category] = result[category].filter((term) => !skip.has(term.trim().toLowerCase()));
  return result;
}

/** Serializes the stored document; the categories are written without their excluded terms so the list stays readable in admin. */
export function serializeStoredScrubList(config: DealScrubConfig, excludedTerms: readonly string[]): string {
  const excluded = normalizeExcludedTerms([...excludedTerms]);
  const document: Record<string, string[]> = { ...applyScrubExclusions(config, excluded) };
  if (excluded.length) document[EXCLUDED_TERMS_KEY] = excluded;
  return JSON.stringify(document);
}

/** The effective categorized list for every scrubber and residue check: stored categories minus the excluded terms. */
export function effectiveScrubConfig(raw: string | null | undefined): DealScrubConfig {
  const stored = parseStoredScrubList(raw);
  return applyScrubExclusions(stored.categories, stored.excludedTerms);
}
