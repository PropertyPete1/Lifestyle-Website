/**
 * Oct 31, 2026 (Peter: the "master bed downstairs" filter New Home Buddy has). Whether a home's primary bedroom is on the
 * main floor: every single-story home has it there; otherwise what the builder says (true down, false up), or null
 * when the builder does not say. The server and the page both read it this way.
 */
export function homePrimaryDown(home: { stories?: number | null; primaryDown?: boolean | null }): boolean | null {
  if (home.stories === 1) return true;
  return typeof home.primaryDown === "boolean" ? home.primaryDown : null;
}
