import { EMPTY_FILTERS, type BrowseFilters, type BrowseSort } from "./dealsBrowse";

/**
 * Oct 28, 2026 (Peter: "New Home Buddy lets you send a bulk list if you don't select any one by one"): with no homes
 * picked, an agent's client link carries the filters on screen (?f=...), and the client's list opens on those homes.
 * The filters ride in the link itself (nothing new is stored): a short, versioned, base64url JSON of what differs from
 * no filters. Saved-only is the agent's own view and is never sent.
 */
export const SHARED_FILTERS_PARAM = "f";
/** Where the landing page keeps a link's filters until the client's list opens (after the code check). */
export const SHARED_FILTERS_STORAGE_KEY = "ldr:deals-shared-filters";
const SHARED_FILTERS_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

type Shareable = Omit<BrowseFilters, "savedOnly">;
const NUMBER_KEYS = ["minPrice", "maxPrice", "minBeds", "minBaths", "minSqft", "maxSqft", "availableBy", "minGarage"] as const;
const FLAG_KEYS = ["moveInReady", "toBeBuilt", "builderRate", "bigLots", "redHot", "newOnly"] as const;
const TEXT_KEYS = ["area", "builder", "schoolDistrict"] as const;
const SORTS: readonly BrowseSort[] = ["recommended", "price_asc", "price_desc", "newest", "largest"];

/** True when anything is narrowing the list (sort alone is not a list worth naming). */
export function sharedFiltersOn(filters: BrowseFilters): boolean {
  return NUMBER_KEYS.some((key) => filters[key] !== null) || FLAG_KEYS.some((key) => filters[key]) || TEXT_KEYS.some((key) => Boolean(filters[key])) || filters.stories !== null;
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string | null {
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    return null;
  }
}

/** The link's query part for these filters ("f=..."), or "" when nothing narrows the list. */
export function encodeSharedFilters(filters: BrowseFilters): string {
  if (!sharedFiltersOn(filters)) return "";
  const diff: Record<string, unknown> = { v: 1 };
  for (const key of NUMBER_KEYS) if (filters[key] !== null) diff[key] = filters[key];
  for (const key of FLAG_KEYS) if (filters[key]) diff[key] = true;
  for (const key of TEXT_KEYS) if (filters[key]) diff[key] = filters[key];
  if (filters.stories !== null) diff.stories = filters.stories;
  if (filters.sort !== "recommended") diff.sort = filters.sort;
  return `${SHARED_FILTERS_PARAM}=${toBase64Url(JSON.stringify(diff))}`;
}

/** The filters a link carries, checked field by field; anything malformed is dropped (never trusted as typed). */
export function decodeSharedFilters(value: string | null | undefined): BrowseFilters | null {
  if (!value || value.length > 2000) return null;
  const json = fromBase64Url(value);
  if (!json) return null;
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return null; }
  if (!raw || typeof raw !== "object" || (raw as { v?: unknown }).v !== 1) return null;
  const input = raw as Record<string, unknown>;
  const next: Shareable & { savedOnly: false } = { ...EMPTY_FILTERS, savedOnly: false };
  for (const key of NUMBER_KEYS) { const number = input[key]; if (typeof number === "number" && Number.isFinite(number) && number >= 0 && number < 100_000_000) next[key] = number; }
  for (const key of FLAG_KEYS) if (input[key] === true) next[key] = true;
  for (const key of TEXT_KEYS) { const text = input[key]; if (typeof text === "string" && text.length <= 120) next[key] = text; }
  if (input.stories === 1 || input.stories === 2) next.stories = input.stories;
  if (typeof input.sort === "string" && SORTS.includes(input.sort as BrowseSort)) next.sort = input.sort as BrowseSort;
  return sharedFiltersOn(next) ? next : null;
}

const money = (value: number) => value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(value % 1_000_000 ? 1 : 0)}M` : `$${Math.round(value / 1000)}K`;

/** A few words a client reads in the text ("New Braunfels, under $400K, 3+ beds"). */
export function sharedFiltersSummary(filters: BrowseFilters): string {
  const parts: string[] = [];
  if (filters.area) parts.push(filters.area);
  if (filters.minPrice !== null && filters.maxPrice !== null) parts.push(`${money(filters.minPrice)} to ${money(filters.maxPrice)}`);
  else if (filters.maxPrice !== null) parts.push(`under ${money(filters.maxPrice)}`);
  else if (filters.minPrice !== null) parts.push(`${money(filters.minPrice)}+`);
  if (filters.minBeds !== null) parts.push(`${filters.minBeds}+ beds`);
  if (filters.minBaths !== null) parts.push(`${filters.minBaths}+ baths`);
  if (filters.minSqft !== null) parts.push(`${filters.minSqft.toLocaleString("en-US")}+ sq ft`);
  if (filters.stories === 1) parts.push("one story");
  if (filters.stories === 2) parts.push("two story");
  if (filters.minGarage !== null) parts.push(`${filters.minGarage}+ car garage`);
  if (filters.moveInReady && !filters.toBeBuilt) parts.push("move-in ready");
  if (filters.toBeBuilt && !filters.moveInReady) parts.push("to be built");
  if (filters.redHot) parts.push("price drops");
  if (filters.newOnly) parts.push("new this week");
  if (filters.bigLots) parts.push("big lots");
  if (filters.builderRate) parts.push("builder rate offers");
  if (filters.schoolDistrict) parts.push(filters.schoolDistrict);
  if (filters.builder) parts.push(filters.builder);
  return parts.slice(0, 5).join(", ");
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const storage = (): Store | null => { try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; } };

/** The landing page keeps a link's filters (?f=) so the list opens on them after the client checks their code. */
export function keepSharedFilters(search: string, store: Store | null = storage(), now = Date.now()): void {
  const value = new URLSearchParams(search).get(SHARED_FILTERS_PARAM);
  if (!value || !decodeSharedFilters(value) || !store) return;
  try { store.setItem(SHARED_FILTERS_STORAGE_KEY, JSON.stringify({ value, at: now })); } catch { /* storage off: the list opens unfiltered */ }
}

/** The client's list takes the kept filters once (then they are the client's to change), if fresh. */
export function takeSharedFilters(store: Store | null = storage(), now = Date.now()): BrowseFilters | null {
  if (!store) return null;
  try {
    const raw = store.getItem(SHARED_FILTERS_STORAGE_KEY);
    if (!raw) return null;
    store.removeItem(SHARED_FILTERS_STORAGE_KEY);
    const kept = JSON.parse(raw) as { value?: string; at?: number };
    if (typeof kept.at !== "number" || now - kept.at > SHARED_FILTERS_MAX_AGE_MS) return null;
    return decodeSharedFilters(kept.value);
  } catch {
    return null;
  }
}
