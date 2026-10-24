/**
 * The landing page's photos (no lead yet): every image a visitor can load is named by an opaque key the latest
 * landing-page read handed out. Two readers register keys: Best Deals (each featured home's cover) and the
 * community list (each community's cover). The public image route serves a key only while the latest read of its
 * reader still names it, so the rest of the catalog never opens to visitors and a photo that leaves the page stops
 * serving at the next read.
 */
export type PublicPhotoScope = "featured" | "covers";

const keysByScope = new Map<PublicPhotoScope, Map<string, number>>();
const refreshers = new Map<PublicPhotoScope, () => Promise<unknown>>();
let refreshedAt = 0;
let inFlight: Promise<unknown> | null = null;
/** An unknown key re-reads the landing page at most this often, so made-up keys cannot make every request re-read the catalog. */
export const PUBLIC_PHOTO_REREAD_MS = 60_000;

/** A landing-page read replaces its scope's keys whole (an empty read empties them). */
export function setPublicPhotos(scope: PublicPhotoScope, keys: Map<string, number>): void {
  keysByScope.set(scope, keys);
  refreshedAt = Date.now();
}

/** How a scope's keys are read again when a key is not known yet (the landing-page read itself). */
export function registerPublicPhotoReader(scope: PublicPhotoScope, read: () => Promise<unknown>): void {
  refreshers.set(scope, read);
}

function lookup(key: string): number | null {
  for (const keys of Array.from(keysByScope.values())) {
    const id = keys.get(key);
    if (id) return id;
  }
  return null;
}

/** The photo the landing page may show for a key; null when no current landing read names it. */
export async function publicPhotoIdForKey(key: string): Promise<number | null> {
  if (!/^[a-f0-9]{12}$/.test(key)) return null;
  const known = lookup(key);
  if (known) return known;
  if (Date.now() - refreshedAt > PUBLIC_PHOTO_REREAD_MS) {
    // Stamped before the slow reads, so a burst of unknown keys starts one re-read, not one each.
    refreshedAt = Date.now();
    inFlight ??= Promise.all(Array.from(refreshers.values()).map((read) => read().catch(() => null))).finally(() => { inFlight = null; });
  }
  if (inFlight) await inFlight;
  return lookup(key);
}

/** The public image URL for a key. */
export const publicPhotoUrl = (key: string) => `/deals/pub/img/${key}`;

/** Test seam only (the readers stay registered: they register once, when their modules load). */
export function resetPublicPhotos(): void {
  keysByScope.clear();
  refreshedAt = 0;
  inFlight = null;
}
