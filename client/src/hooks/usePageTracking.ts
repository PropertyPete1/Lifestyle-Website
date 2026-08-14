/**
 * First-party page-view + event tracking. Fires one "view" event per route
 * change, keyed by the same anonymous ldr_visitor_id used elsewhere
 * (localStorage only — no cookies, no IPs, no fingerprinting, no third-party
 * analytics). Fire-and-forget: tracking must never block the visitor.
 *
 * Traffic source is captured ONCE per browser session (sessionStorage):
 * - utm_source / utm_medium / utm_campaign from the entry URL when present
 * - otherwise the referrer's hostname (e.g. "instagram.com")
 * - otherwise "direct"
 * Every event in the session carries that source so the admin "Traffic
 * Sources" breakdown reflects where the visit originated.
 */
import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { getVisitorId } from "@/lib/visitor";

const SRC_KEY = "ldr_traffic_source";

type TrafficSource = { source: string; utmMedium: string; utmCampaign: string };

/** Resolve (and cache for the session) where this visit came from. */
export function getTrafficSource(): TrafficSource {
  const fallback: TrafficSource = { source: "", utmMedium: "", utmCampaign: "" };
  try {
    const cached = sessionStorage.getItem(SRC_KEY);
    if (cached) return JSON.parse(cached) as TrafficSource;

    const params = new URLSearchParams(window.location.search);
    let source = (params.get("utm_source") ?? "").trim().toLowerCase();
    const utmMedium = (params.get("utm_medium") ?? "").trim().toLowerCase();
    const utmCampaign = (params.get("utm_campaign") ?? "").trim();

    if (!source) {
      const ref = document.referrer;
      if (ref) {
        try {
          const host = new URL(ref).hostname.replace(/^www\./, "").toLowerCase();
          // Same-site navigation isn't an external source
          if (host && host !== window.location.hostname.replace(/^www\./, "").toLowerCase()) {
            source = host;
          }
        } catch {
          /* unparseable referrer — ignore */
        }
      }
    }
    if (!source) source = "direct";

    const resolved: TrafficSource = { source, utmMedium, utmCampaign };
    sessionStorage.setItem(SRC_KEY, JSON.stringify(resolved));
    return resolved;
  } catch {
    return fallback; // storage blocked — tracking silently degrades
  }
}

export function usePageTracking() {
  const [location] = useLocation();
  const track = trpc.analytics.track.useMutation();
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    const path = location.split(/[?#]/)[0] || "/";
    if (path.startsWith("/admin")) return; // never track the admin area
    if (lastPath.current === path) return; // dedupe re-renders of same route
    lastPath.current = path;
    const src = getTrafficSource();
    track.mutate(
      { kind: "view", path, visitorId: getVisitorId() || undefined, ...src },
      { onError: () => undefined }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);
}

/** Returns a fire-and-forget logger for Now Hiring banner clicks. */
export function useBannerClickTracking() {
  const track = trpc.analytics.track.useMutation();
  return () =>
    track.mutate(
      { kind: "banner_click", path: "/", visitorId: getVisitorId() || undefined, ...getTrafficSource() },
      { onError: () => undefined }
    );
}

/**
 * Returns a fire-and-forget logger for New Construction Search outbound
 * clicks. `path` records WHERE the CTA was clicked (e.g. "/", "/links",
 * "/san-antonio") so Analytics can compare placements.
 */
export function useNcClickTracking() {
  const track = trpc.analytics.track.useMutation();
  return () => {
    const path = (window.location.pathname.split(/[?#]/)[0] || "/").replace(/(.)\/$/, "$1");
    track.mutate(
      { kind: "nc_click", path, visitorId: getVisitorId() || undefined, ...getTrafficSource() },
      { onError: () => undefined }
    );
  };
}

/**
 * Returns a fire-and-forget logger for LIST FOR LEASE clicks (landlord
 * interest). `path` records WHERE the CTA was clicked, same pattern as
 * the New Construction click tracking.
 */
export function useLeaseClickTracking() {
  const track = trpc.analytics.track.useMutation();
  return () => {
    const path = (window.location.pathname.split(/[?#]/)[0] || "/").replace(/(.)\/$/, "$1");
    track.mutate(
      { kind: "lease_click", path, visitorId: getVisitorId() || undefined, ...getTrafficSource() },
      { onError: () => undefined }
    );
  };
}

/**
 * Returns a fire-and-forget logger for City Finder AI generations — one event
 * per real generation, so the admin Analytics tab can track how often the
 * signature tool actually produces a report (and what it costs in AI calls).
 * Deliberately NOT fired when a cached /city-finder/:slug link is read.
 */
export function useCityFinderGenerateTracking() {
  const track = trpc.analytics.track.useMutation();
  return () =>
    track.mutate(
      {
        kind: "city_finder_generate",
        path: "/city-finder",
        visitorId: getVisitorId() || undefined,
        ...getTrafficSource(),
      },
      { onError: () => undefined }
    );
}

/**
 * Returns a fire-and-forget logger for /links lead-form submissions, so the
 * admin Analytics tab can compare /links capture rate vs. button clicks.
 */
export function useLinksFormTracking() {
  const track = trpc.analytics.track.useMutation();
  return () =>
    track.mutate(
      { kind: "links_form", path: "/links", visitorId: getVisitorId() || undefined, ...getTrafficSource() },
      { onError: () => undefined }
    );
}

/**
 * Exit-intent modal instrumentation. Both events are logged so the modal can be
 * judged on whether it actually earns its place: shows vs clicks is its
 * conversion rate, and if that stays near zero it should be removed.
 */
export function useExitIntentTracking() {
  const track = trpc.analytics.track.useMutation();
  return (kind: "exit_intent_show" | "exit_intent_click") =>
    track.mutate(
      { kind, path: "/", visitorId: getVisitorId() || undefined, ...getTrafficSource() },
      { onError: () => undefined }
    );
}

/** Sticky mobile CTA taps, so its value is measurable the same way. */
export function useStickyCtaTracking() {
  const track = trpc.analytics.track.useMutation();
  return () => {
    const path = (window.location.pathname.split(/[?#]/)[0] || "/").replace(/(.)\/$/, "$1");
    track.mutate(
      { kind: "sticky_cta_click", path, visitorId: getVisitorId() || undefined, ...getTrafficSource() },
      { onError: () => undefined }
    );
  };
}

/**
 * Taps on the /links "30 minutes" promise strip. Logged separately from the
 * form submission itself so the strip can be judged on whether it actually
 * drives people into the capture form.
 */
export function useLinksPromiseTracking() {
  const track = trpc.analytics.track.useMutation();
  return () =>
    track.mutate(
      {
        kind: "links_promise_click",
        path: "/links",
        visitorId: getVisitorId() || undefined,
        ...getTrafficSource(),
      },
      { onError: () => undefined }
    );
}

/**
 * Returns a fire-and-forget logger for the /links "MEET PRIMARY — OUR AI"
 * outbound clicks (→ lifestyledesigntechnologies.com). Same first-party
 * pattern as the NC/lease buttons; the outbound URL additionally carries
 * utm_source=linkpage-primary so the LDT site can attribute the visit.
 */
export function usePrimaryClickTracking() {
  const track = trpc.analytics.track.useMutation();
  return () =>
    track.mutate(
      {
        kind: "primary_click",
        path: "/links",
        visitorId: getVisitorId() || undefined,
        ...getTrafficSource(),
      },
      { onError: () => undefined }
    );
}
