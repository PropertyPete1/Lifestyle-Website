/**
 * VIBE-MATCHED CITY IMAGERY MANIFEST
 * ==================================
 * Picks the City Finder result image that best fits what the visitor told us
 * they care about, instead of always showing the same city hero.
 *
 * Lives in `shared/` because both the client (result cards) and the server
 * (Open Graph card for /city-finder/:slug) must resolve the identical image.
 *
 *
 * ── HOW TO ADD REAL VIBE IMAGES ─────────────────────────────────────────────
 * Every city currently ships with its existing landing-page hero in each slot,
 * so the feature is live and correct from day one — it just shows the same
 * (already on-brand) photo until better-fitting art exists.
 *
 * To upgrade a slot:
 *   1. Upload the image to storage the same way the existing city heroes were
 *      (they resolve as "/manus-storage/<name>_<hash>.jpg").
 *   2. Add it to `IMG` in `client/src/lib/assets.ts`.
 *   3. Replace that slot's `src` below with the new `IMG.<key>`.
 *
 * Nothing else changes — selection logic, OG cards, and tests pick it up
 * automatically. Slots are intentionally listed one-per-line so a swap is a
 * one-line diff. Only reference paths that really exist: a wrong path renders
 * a broken image on a customer-facing result.
 *
 * Art direction for replacements: dark/moody, gold-hour or night, no visible
 * faces, no readable signage or license plates, landscape 16:9 or wider (the
 * card crops to 16:7 on desktop, 16:9 on mobile).
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The four vibes we tag imagery against. */
export type CityVibe = "skyline" | "outdoors" | "family" | "nightlife";

export interface CityImageSlot {
  vibe: CityVibe;
  src: string;
  /** Alt-text fragment: rendered as "<city> — <label>". */
  label: string;
}

/**
 * Existing city landing-page heroes — the per-city defaults and, for now, the
 * initial value of every vibe slot. Kept as literals rather than importing
 * client `IMG` so this module stays usable from the server bundle.
 */
const CITY_HERO = {
  "San Antonio": "/manus-storage/city-san-antonio_15388e3a.jpg",
  "New Braunfels": "/manus-storage/city-new-braunfels_9ad0d328.jpg",
  Austin: "/manus-storage/city-austin_127412ff.jpg",
  DFW: "/manus-storage/city-dfw_7ef7f575.jpg",
  Houston: "/manus-storage/city-houston_9763b83b.jpg",
} as const;

/** Hill Country / outdoors art that already exists and genuinely fits. */
const HILL_COUNTRY = "/manus-storage/area-boerne_5d6d253c.jpg";

export interface CityImagery {
  /** Shown when no vibe matches, and the OG fallback. */
  default: string;
  slots: CityImageSlot[];
}

export const CITY_IMAGERY: Record<string, CityImagery> = {
  "San Antonio": {
    default: CITY_HERO["San Antonio"],
    slots: [
      { vibe: "skyline", src: CITY_HERO["San Antonio"], label: "downtown skyline" },
      { vibe: "family", src: CITY_HERO["San Antonio"], label: "family neighborhoods" },
      { vibe: "outdoors", src: HILL_COUNTRY, label: "Hill Country edge" },
      { vibe: "nightlife", src: CITY_HERO["San Antonio"], label: "River Walk nights" },
    ],
  },
  "New Braunfels": {
    default: CITY_HERO["New Braunfels"],
    slots: [
      { vibe: "outdoors", src: HILL_COUNTRY, label: "rivers and Hill Country" },
      { vibe: "family", src: CITY_HERO["New Braunfels"], label: "small-town family life" },
      { vibe: "skyline", src: CITY_HERO["New Braunfels"], label: "between two metros" },
    ],
  },
  Austin: {
    default: CITY_HERO.Austin,
    slots: [
      { vibe: "skyline", src: CITY_HERO.Austin, label: "downtown skyline" },
      { vibe: "nightlife", src: CITY_HERO.Austin, label: "music and food scene" },
      { vibe: "outdoors", src: HILL_COUNTRY, label: "lakes and greenbelt" },
      { vibe: "family", src: CITY_HERO.Austin, label: "suburb family life" },
    ],
  },
  DFW: {
    default: CITY_HERO.DFW,
    slots: [
      { vibe: "skyline", src: CITY_HERO.DFW, label: "corporate skyline" },
      { vibe: "family", src: CITY_HERO.DFW, label: "master-planned suburbs" },
      { vibe: "nightlife", src: CITY_HERO.DFW, label: "dining and culture" },
    ],
  },
  Houston: {
    default: CITY_HERO.Houston,
    slots: [
      { vibe: "skyline", src: CITY_HERO.Houston, label: "global-city skyline" },
      { vibe: "family", src: CITY_HERO.Houston, label: "space for a growing family" },
      { vibe: "nightlife", src: CITY_HERO.Houston, label: "food scene" },
      { vibe: "outdoors", src: CITY_HERO.Houston, label: "bayous and green space" },
    ],
  },
};

/**
 * Maps the City Finder `lifestyle` answer onto a vibe. These values come from
 * the quiz's lifestyle question — keep in sync with QUESTIONS in CityFinder.tsx.
 */
const LIFESTYLE_VIBE: Record<string, CityVibe> = {
  schools: "family",
  nightlife: "nightlife",
  land: "outdoors",
  commute: "skyline",
  military: "family",
  "lake-hill": "outdoors",
};

/**
 * Which vibe best describes this visitor. `lifestyle` is the primary signal;
 * a larger household nudges an otherwise-unknown answer toward "family".
 * Returns null when the answers tell us nothing useful.
 */
export function vibeFromAnswers(answers: Record<string, string> | undefined): CityVibe | null {
  if (!answers) return null;
  const fromLifestyle = LIFESTYLE_VIBE[answers.lifestyle];
  if (fromLifestyle) return fromLifestyle;
  if (answers.household === "3-4" || answers.household === "5-plus") return "family";
  return null;
}

export interface SelectedCityImage {
  src: string;
  alt: string;
  /** The vibe actually matched, or null when the per-city default was used. */
  vibe: CityVibe | null;
  label: string | null;
}

/**
 * Best image for a city given the visitor's quiz answers.
 * Falls back to the city default, then to San Antonio's hero for an unknown
 * city, so this never returns an empty src on a customer-facing card.
 */
export function selectCityImage(
  city: string,
  answers: Record<string, string> | undefined
): SelectedCityImage {
  const imagery = CITY_IMAGERY[city];
  if (!imagery) {
    return { src: CITY_HERO["San Antonio"], alt: city, vibe: null, label: null };
  }
  const vibe = vibeFromAnswers(answers);
  const slot = vibe ? imagery.slots.find((s) => s.vibe === vibe) : undefined;
  if (!slot) return { src: imagery.default, alt: city, vibe: null, label: null };
  return { src: slot.src, alt: `${city} — ${slot.label}`, vibe: slot.vibe, label: slot.label };
}
