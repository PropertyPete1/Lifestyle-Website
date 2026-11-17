/**
 * Apartment locating, client side (rules live in shared/apartments.ts). Small helpers the three screens share:
 * the renter page, the locators' workspace and a client's options link.
 */
export type Letter = { to: string | null; subject: string; body: string };

export const aptMoney = (value: number | null | undefined) => value == null ? "" : `$${Math.round(value).toLocaleString("en-US")}`;
export const bedsLabel = (beds: number) => beds === 0 ? "Studio" : `${beds} bed`;
export const rentRange = (min: number | null, max: number | null) => min == null ? "Call for rent" : max != null && max > min ? `${aptMoney(min)} to ${aptMoney(max)}` : aptMoney(min);

/** A Gmail draft in the locator's own Lifestyle account (never a personal one by mistake), as on Builder Deals. */
export function gmailLetterHref(letter: Letter, agentEmail?: string | null): string {
  const account = agentEmail && /@lifestyledesignrealty\.com$/i.test(agentEmail.trim()) ? encodeURIComponent(agentEmail.trim().toLowerCase()) : "0";
  return `https://mail.google.com/mail/u/${account}/?view=cm&fs=1&tf=1${letter.to ? `&to=${encodeURIComponent(letter.to)}` : ""}&su=${encodeURIComponent(letter.subject)}&body=${encodeURIComponent(letter.body)}`;
}

/** On a phone the Gmail app's own link (Nov 17, 2026: agents have the app; the browser draft is the fallback). */
export function letterAppHref(letter: Letter, userAgent: string, touchPoints = 0): string | null {
  const iphone = /iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && touchPoints > 1);
  const android = /Android/i.test(userAgent);
  if (!iphone && !android) return null;
  const parts = `${letter.to ? `to=${encodeURIComponent(letter.to)}&` : ""}subject=${encodeURIComponent(letter.subject)}&body=${encodeURIComponent(letter.body)}`;
  return iphone ? `googlegmail://co?${parts}` : `mailto:${letter.to ? encodeURIComponent(letter.to) : ""}?subject=${encodeURIComponent(letter.subject)}&body=${encodeURIComponent(letter.body)}`;
}

export function openLetter(letter: Letter, agentEmail?: string | null) {
  const web = gmailLetterHref(letter, agentEmail);
  const app = letterAppHref(letter, navigator.userAgent, navigator.maxTouchPoints);
  if (!app) { window.open(web, "_blank", "noopener"); return; }
  window.location.href = app;
  if (app.startsWith("googlegmail:")) window.setTimeout(() => { if (document.visibilityState === "visible") window.location.href = web; }, 1500);
}

/** A text message with the body filled in (the client's number when we have it). */
export function smsHref(body: string, phone?: string | null, userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent): string {
  const digits = (phone ?? "").replace(/[^\d+]/g, "");
  return `sms:${digits}${/iPhone|iPad|iPod|Macintosh/i.test(userAgent) ? "&" : "?"}body=${encodeURIComponent(body)}`;
}

/** "Dec 1" (with the year only when it is not this year) from YYYY-MM-DD; the text unchanged when it is not a date. */
export function shortDay(day: string | null | undefined, now = new Date()): string {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return day ?? "";
  const date = new Date(`${day}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", ...(date.getUTCFullYear() === now.getFullYear() ? {} : { year: "numeric" }) }).format(date);
}

export const mapsHref = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

/** The second-chance choices a renter (or a locator, for a client) can turn on. The order is the order on screen. */
export const NEEDS = [
  { key: "needsBrokenLeaseOk", label: "Broken lease" },
  { key: "needsEvictionOk", label: "Eviction" },
  { key: "needsFelonyOk", label: "Background" },
  { key: "needsIncomeRestricted", label: "Income-based rent" },
] as const;
export type NeedKey = (typeof NEEDS)[number]["key"];

export type AptFilters = { city: string; beds: string; maxRent: string; moveBy: string; needs: Partial<Record<NeedKey, boolean>>; secondChanceOnly: boolean; paysOnly: boolean };
export const EMPTY_APT_FILTERS: AptFilters = { city: "", beds: "", maxRent: "", moveBy: "", needs: {}, secondChanceOnly: false, paysOnly: false };

/** The search the API takes, from what is on screen. Blank boxes are left out. */
export function searchInput(filters: AptFilters) {
  const rent = Number(filters.maxRent.replace(/[^\d]/g, ""));
  return {
    ...(filters.city ? { city: filters.city } : {}),
    ...(filters.beds !== "" ? { beds: Number(filters.beds) } : {}),
    ...(rent > 0 ? { maxRent: Math.min(rent, 1_000_000) } : {}),
    ...(/^\d{4}-\d{2}-\d{2}$/.test(filters.moveBy) ? { moveBy: filters.moveBy } : {}),
    ...Object.fromEntries(NEEDS.filter((need) => filters.needs[need.key]).map((need) => [need.key, true])),
    ...(filters.secondChanceOnly ? { secondChanceOnly: true } : {}),
    ...(filters.paysOnly ? { paysOnly: true } : {}),
  };
}

/** What the renter asked for, in words, for the lead note the locator reads. */
export function needsSummary(filters: AptFilters): string {
  const parts = [
    filters.city && `in ${filters.city}`,
    filters.beds !== "" && bedsLabel(Number(filters.beds)),
    filters.maxRent && `up to $${filters.maxRent.replace(/[^\d]/g, "")}`,
    filters.moveBy && `moving by ${filters.moveBy}`,
    ...NEEDS.filter((need) => filters.needs[need.key]).map((need) => `needs: ${need.label.toLowerCase()}`),
    filters.secondChanceOnly && "second chance",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "No filters chosen";
}
