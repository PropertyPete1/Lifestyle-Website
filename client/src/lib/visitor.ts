/**
 * First-party anonymous visitor identity + activity reporting.
 *
 * - The visitor id is a random string stored ONLY in this site's localStorage
 *   (first-party, no cookies, no third-party trackers). It survives browser
 *   restarts, so multi-visit journeys correlate.
 * - Activity events are stored server-side keyed by that anonymous id and are
 *   only ever forwarded to Follow Up Boss if the visitor later submits a lead
 *   form. Never submitting a form = nothing is ever sent anywhere.
 */

const KEY = "ldr_visitor_id";

export function getVisitorId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = `v_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return ""; // storage blocked (private mode etc.) — tracking silently off
  }
}

/** Favorites are mirrored locally so hearts render instantly. */
const FAV_KEY = "ldr_favorites";

export function getLocalFavorites(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function setLocalFavorites(slugs: string[]) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(slugs));
  } catch {
    /* ignore */
  }
}
