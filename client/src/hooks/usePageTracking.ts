/**
 * First-party page-view tracking. Fires one "view" event per route change,
 * keyed by the same anonymous ldr_visitor_id used elsewhere (localStorage
 * only — no cookies, no IPs, no fingerprinting, no third-party analytics).
 * Fire-and-forget: tracking must never block or break the visitor experience.
 */
import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { getVisitorId } from "@/lib/visitor";

export function usePageTracking() {
  const [location] = useLocation();
  const track = trpc.analytics.track.useMutation();
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    const path = location.split(/[?#]/)[0] || "/";
    if (path.startsWith("/admin")) return; // never track the admin area
    if (lastPath.current === path) return; // dedupe re-renders of same route
    lastPath.current = path;
    track.mutate(
      { kind: "view", path, visitorId: getVisitorId() || undefined },
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
      { kind: "banner_click", path: "/", visitorId: getVisitorId() || undefined },
      { onError: () => undefined }
    );
}
