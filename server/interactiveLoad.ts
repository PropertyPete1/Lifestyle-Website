/**
 * Oct 28, 2026 (Peter: "make sure everything looks efficient"): the photo backlog is worked through in the same
 * process that answers people, and on this host one photo's OCR holds a CPU for seconds. A person waiting on a page
 * or a photo comes first: requests from people mark the process busy, and the photo drain does not start another photo
 * until the process has been quiet for INTERACTIVE_QUIET_MS (each drain still does at least one, so the queue moves).
 * Kept in its own module so the web routes can mark it without loading the image libraries.
 */
export const INTERACTIVE_QUIET_MS = 3_000;

let lastInteractiveAt = 0;

/** A person's request reached this process (a page, a photo, the list); scheduled calls never mark it. */
export function noteInteractiveRequest(now = Date.now()): void {
  lastInteractiveAt = now;
}

/** True while someone was served in the last INTERACTIVE_QUIET_MS. */
export function interactiveBusy(now = Date.now()): boolean {
  return now - lastInteractiveAt < INTERACTIVE_QUIET_MS;
}

/** Test seam. */
export function resetInteractiveLoad(): void {
  lastInteractiveAt = 0;
}
