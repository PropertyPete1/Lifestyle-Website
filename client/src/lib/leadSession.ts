/**
 * Session-level lead-capture flag.
 * Set whenever any lead form on the site is successfully submitted, so
 * downstream optional captures (e.g. the New Construction handoff screen)
 * can skip re-asking a visitor who is already in the pipeline.
 */
const KEY = "ldr_lead_captured";

export function markLeadCaptured() {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    /* private-mode storage failures are non-fatal */
  }
}

export function isLeadCaptured(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
