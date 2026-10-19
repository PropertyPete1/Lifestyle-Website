/**
 * Pure rules for the personal list page (/deals/mine), kept free of React and
 * tRPC so the decisions the page makes can be asserted without a browser.
 */

/** The tRPC error shape the page needs: only the code matters for routing. */
export type DealsClientError = { message?: string; data?: { code?: string } | null } | null | undefined;

/**
 * Only an UNAUTHORIZED mine result means "no live session": that visitor goes
 * back to the landing page and its gate. Any other failure (a server error, a
 * request timeout) keeps the visitor on the page with a retry, because the
 * landing page would see the still-live session and send them straight back
 * to /deals/mine in a loop.
 */
export function isUnauthorizedDealsError(error: DealsClientError): boolean {
  return error?.data?.code === "UNAUTHORIZED";
}

export const MINE_COPY = {
  loadFailed: "We couldn't load your list.",
  loadFailedHint: "Check your connection and try again.",
  retry: "Try again",
  retrying: "Trying again…",
  profileSaved: "Saved. We'll text you from here.",
  profileUnauthorized: "Your access expired. Reload the page to get a new link.",
  profileInvalid: "Use at least 2 characters for your name.",
  profileFailed: "We couldn't save that. Please try again.",
  requestSent: "Request sent. We'll confirm the details by text.",
  homeSaved: "Saved. We'll keep an eye on this one with you.",
  saveFailed: "We couldn't save that home. Please try again.",
} as const;

/** Readable copy for a failed updateProfile; raw validation output never reaches the visitor. */
export function profileErrorCopy(error: DealsClientError): string | null {
  if (!error) return null;
  if (isUnauthorizedDealsError(error)) return MINE_COPY.profileUnauthorized;
  if (error.data?.code === "BAD_REQUEST") return MINE_COPY.profileInvalid;
  return MINE_COPY.profileFailed;
}

export const PROFILE_TIMELINES = ["0-3 months", "3-6 months", "6-12 months", "12+ months"] as const;
export type ProfileTimeline = (typeof PROFILE_TIMELINES)[number];
export type ProfileInput = { name?: string; timeline?: ProfileTimeline };

export const PROFILE_NAME_MIN = 2;
export const PROFILE_NAME_MAX = 190;

/**
 * What Save sends, or null while there is nothing valid to save: a name needs
 * at least two characters (the server's rule), a timeline must be one of the
 * offered values, and a one-character name is never sent alongside a timeline.
 */
export function profileInput(name: string, timeline: string): ProfileInput | null {
  const trimmed = name.trim().slice(0, PROFILE_NAME_MAX);
  const validName = trimmed.length >= PROFILE_NAME_MIN;
  const validTimeline = (PROFILE_TIMELINES as readonly string[]).includes(timeline);
  if (trimmed.length > 0 && !validName) return null;
  if (!validName && !validTimeline) return null;
  return { name: validName ? trimmed : undefined, timeline: validTimeline ? (timeline as ProfileTimeline) : undefined };
}

/** Whole seconds left on a personal link, never negative. */
export function countdownSeconds(expiresAt: string, now: number): number {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
}

export function countdownLabel(expiresAt: string, now: number): string {
  const seconds = countdownSeconds(expiresAt, now);
  // A week-long agent-client window reads in days, not "167:59:59".
  if (seconds > 48 * 3600) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    return `${days}d ${hours}h`;
  }
  return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The moment the countdown shows 00:00:00: the list is stale and must be refetched. */
export function countdownExpired(expiresAt: string, now: number): boolean {
  return countdownSeconds(expiresAt, now) === 0;
}
