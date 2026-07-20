import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { MapView } from "@/components/Map";
import { formatPrice } from "@/components/ListingCard";
import type { Listing } from "../../../drizzle/schema";

/**
 * Interactive map of search results. Gold price-pill markers; clicking a
 * marker opens the listing detail page. Fits bounds to visible results.
 */
export default function ListingsMap({ listings }: { listings: Listing[] }) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const [, navigate] = useLocation();

  const renderMarkers = (map: google.maps.Map) => {
    markersRef.current.forEach((m) => (m.map = null));
    markersRef.current = [];
    const bounds = new google.maps.LatLngBounds();
    let count = 0;

    for (const l of listings) {
      const lat = parseFloat(l.lat ?? "");
      const lng = parseFloat(l.lng ?? "");
      if (isNaN(lat) || isNaN(lng)) continue;

      const pill = document.createElement("div");
      pill.style.cssText =
        "background:#0f0f11;color:#c9a961;border:1px solid #c9a961;padding:5px 12px;" +
        "font-size:12px;font-weight:600;letter-spacing:0.05em;border-radius:999px;" +
        "box-shadow:0 2px 10px rgba(0,0,0,.5);cursor:pointer;white-space:nowrap;";
      pill.textContent = formatPrice(l.price);

      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat, lng },
        content: pill,
        title: l.address,
      });
      marker.addListener("click", () => navigate(`/listing/${l.slug}`));
      markersRef.current.push(marker);
      bounds.extend({ lat, lng });
      count++;
    }

    if (count > 1) map.fitBounds(bounds, 60);
    else if (count === 1) {
      map.setCenter(bounds.getCenter());
      map.setZoom(12);
    }
  };

  return (
    <div className="border border-border overflow-hidden">
      <MapView
        className="h-[560px]"
        initialCenter={{ lat: 29.9, lng: -97.9 }}
        initialZoom={7}
        onMapReady={(map) => {
          mapRef.current = map;
          renderMarkers(map);
        }}
      />
      {/* re-render markers when the result set changes */}
      <MarkerSync listings={listings} render={() => mapRef.current && renderMarkers(mapRef.current)} />
    </div>
  );
}

/** Invisible helper: triggers marker refresh when listings change. */
function MarkerSync({ listings, render }: { listings: Listing[]; render: () => void }) {
  useEffect(() => {
    render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listings]);
  return null;
}
