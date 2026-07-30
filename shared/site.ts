/** Shared site-wide constants — single source of truth for exact strings. */

/**
 * FEATURE FLAGS — flip these to re-enable paused features.
 *
 * SHOW_PLACEHOLDER_LISTINGS: while we wait for IDX/MLS data (~1 month), the
 * homepage featured-listings showcase and city-page listing grids are hidden.
 * The listing components, data model, admin CMS, and AI search backend remain
 * fully intact — set this to `true` to restore all listing displays instantly.
 */
export const FEATURES = {
  SHOW_PLACEHOLDER_LISTINGS: false,
  /** Master gate for ALL placeholder-powered search/browse/listing
      experiences (/search, /portfolio, /neighborhoods, /listing/:slug,
      nav+footer links to them). Until IDX connects, customers can only
      reach New Construction Search. Flip to true with IDX. */
  SHOW_PROPERTY_SEARCH: false,
  /** Newsletter promises "new listings in your inbox" — hidden pre-IDX.
      Re-enable alongside SHOW_PLACEHOLDER_LISTINGS when IDX connects. */
  SHOW_NEWSLETTER: false,
} as const;

/** Routes powered by placeholder listing data, gated by SHOW_PROPERTY_SEARCH. */
const PROPERTY_SEARCH_ROUTES = ["/search", "/portfolio", "/neighborhoods", "/listing"] as const;

/**
 * True when a URL points at a placeholder-powered search/browse/listing route.
 * Matches the route itself and anything below it ("/listing/abc", "/search?q=")
 * but never a merely similar path ("/searchable", "/portfolios").
 * External URLs (http/mailto/tel) are never property-search routes.
 */
export function isPropertySearchRoute(url: string): boolean {
  if (!url.startsWith("/")) return false;
  const path = url.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return PROPERTY_SEARCH_ROUTES.some((r) => path === r || path.startsWith(`${r}/`));
}

/**
 * Whether a customer-facing link may be shown. Admin-managed content (e.g. the
 * /links bio buttons stored in the DB) can still point at paused routes, so
 * every such surface must filter through this rather than trusting the data.
 */
export function isLinkVisible(url: string): boolean {
  return FEATURES.SHOW_PROPERTY_SEARCH || !isPropertySearchRoute(url);
}

export const SITE = {
  name: "Lifestyle Design Realty",
  eyebrow: "EXPERTISE. KNOWLEDGE. EXPERIENCE.",
  headline: "LIFESTYLE DESIGN REALTY",
  subheadline: "CENTRAL TEXAS REAL ESTATE PROFESSIONALS",
  phone: "(210) 981-3830",
  phoneHref: "tel:+12109813830",
  email: "team@lifestyledesignrealty.com",
  address: "1212 Chicon St Unit 101, Austin TX 78702",
  /** New Construction Search — external builder-network tool (vendor name never shown in UI) */
  newConstructionUrl: "https://a.nhb.app/u/peter-allen",
  iabsUrl: "https://drive.google.com/file/d/1DTDRFjzJJS_iD8aaNu8l4Wr3YmmR9zHe/view",
  cpnUrl: "https://www.trec.texas.gov/forms/consumer-protection-notice",
  disclaimer:
    "All information is deemed reliable but not guaranteed and should be independently reviewed and verified.",
  tcpaConsent:
    "I agree to be contacted by Lifestyle Design Realty via call, email, and text for real estate services. To opt out, you can reply 'stop' at any time or reply 'help' for assistance. You can also click the unsubscribe link in the emails. Message and data rates may apply. Message frequency may vary.",
  /** Web-design inquiries are a separate pipeline (Lifestyle Design Technologies, not the brokerage). */
  tcpaConsentWebDesign:
    "I agree to be contacted by Lifestyle Design Technologies via call, email, and text about website design services. To opt out, you can reply 'stop' at any time or reply 'help' for assistance. You can also click the unsubscribe link in the emails. Message and data rates may apply. Message frequency may vary.",
  instagram: "https://www.instagram.com/lifestyledesignrealtytexas",
  facebook: "https://www.facebook.com/p/Lifestyle-Design-Realty-Texas-61578742983077/",
  cities: ["San Antonio", "New Braunfels", "Austin", "DFW", "Houston"] as const,
} as const;

/**
 * ADMIN ALLOWLIST — the ONLY accounts permitted to hold the admin role.
 * Both sign in with Google via Manus OAuth (no separate password).
 * Any other account is auto-demoted to "user" on every sign-in and
 * rejected by adminProcedure even if the DB role were tampered with.
 */
export const ADMIN_EMAILS = [
  "peter@lifestyledesignrealty.com",
  "steven@lifestyledesignrealty.com",
  "stefanie@lifestyledesignrealty.com",
] as const;

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return (ADMIN_EMAILS as readonly string[]).includes(email.trim().toLowerCase());
}

export type IntentLevel = "Hot" | "Warm" | "Cold" | "Unknown";
