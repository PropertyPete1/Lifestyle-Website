import { useEffect, useRef, useState } from "react";
import { MapView } from "@/components/Map";

export type AptMapPoint = { id: string; lat: number; lng: number; label: string; /** A renter's point is an area, drawn as a shaded circle with no pin. */ area?: boolean };

/**
 * The map beside the list. Locators get a labelled pin per community (the label is what it pays); renters get a
 * shaded circle for the area only, because the pin is what they come to a locator for. Hovering or tapping a card
 * highlights its point; tapping a point picks its card.
 */
export function AptMap({ points, activeId, onPick, className = "" }: { points: AptMapPoint[]; activeId: string | null; onPick?: (id: string) => void; className?: string }) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const drawn = useRef<Array<{ id: string; remove: () => void; highlight: (on: boolean) => void }>>([]);
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const signature = points.map((point) => `${point.id}:${point.lat.toFixed(4)},${point.lng.toFixed(4)}:${point.label}`).join("|");

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    drawn.current.forEach((entry) => entry.remove());
    drawn.current = [];
    if (!points.length) return;
    const bounds = new google.maps.LatLngBounds();
    for (const point of points) {
      const position = { lat: point.lat, lng: point.lng };
      bounds.extend(position);
      if (point.area) {
        const circle = new google.maps.Circle({ map, center: position, radius: 1_400, strokeColor: "#946f2e", strokeOpacity: 0.9, strokeWeight: 1, fillColor: "#b8892f", fillOpacity: 0.22, clickable: Boolean(onPick) });
        if (onPick) circle.addListener("click", () => onPick(point.id));
        drawn.current.push({ id: point.id, remove: () => circle.setMap(null), highlight: (on) => circle.setOptions({ fillOpacity: on ? 0.5 : 0.22, strokeWeight: on ? 2 : 1 }) });
      } else {
        const chip = document.createElement("div");
        chip.textContent = point.label;
        chip.style.cssText = "padding:3px 8px;border:1px solid #946f2e;background:#fff;color:#1c1b1f;font:600 12px/1.2 system-ui,sans-serif;border-radius:999px;box-shadow:0 1px 4px rgba(0,0,0,.25);cursor:pointer;white-space:nowrap";
        const marker = new google.maps.marker.AdvancedMarkerElement({ map, position, content: chip, title: point.label });
        if (onPick) marker.addListener("click", () => onPick(point.id));
        drawn.current.push({ id: point.id, remove: () => { marker.map = null; }, highlight: (on) => { chip.style.background = on ? "#946f2e" : "#fff"; chip.style.color = on ? "#fff" : "#1c1b1f"; marker.zIndex = on ? 10 : 1; } });
      }
    }
    if (points.length === 1) { map.setCenter(bounds.getCenter()); map.setZoom(13); } else map.fitBounds(bounds, 48);
    return () => { drawn.current.forEach((entry) => entry.remove()); drawn.current = []; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, signature]);

  useEffect(() => { drawn.current.forEach((entry) => entry.highlight(entry.id === activeId)); }, [activeId, signature, ready]);

  if (unavailable) return <div className={`flex items-center justify-center border border-border bg-secondary/40 p-6 text-center text-xs text-muted-foreground ${className}`} data-apt-map="unavailable">The map could not load. The list has everything.</div>;
  return <div className={`overflow-hidden border border-border ${className}`} data-apt-map="ready">
    <MapView className="h-full w-full" initialCenter={{ lat: 29.4252, lng: -98.4946 }} initialZoom={10} onMapReady={(map) => { mapRef.current = map; setReady(true); }} onUnavailable={() => setUnavailable(true)} />
  </div>;
}
