import { useState } from "react";
import { AREA_MAP_IMAGE_HEIGHT, AREA_MAP_IMAGE_WIDTH, areaMapRadiusPixels, driveTimeChipLabels, validDealsAreaMap } from "@/lib/dealsAreaMap";

/**
 * AREA MAP (gated page only): the server's static image, centred on the ZIP
 * centroid, with a shaded circle of `radiusMiles` drawn over its centre and no
 * pin. The image URL is same-origin, so the session cookies travel with it and
 * no map provider ever sees the viewer or a coordinate.
 */
export function AreaMap({ chips = [], map }: { chips?: unknown; map?: unknown }) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const valid = validDealsAreaMap(map) && failedImage !== map.imageUrl;
  const radiusPixels = valid ? Math.round(areaMapRadiusPixels(map) * 10) / 10 : 0;
  const driveTimes = driveTimeChipLabels(chips);
  return <section aria-label="Approximate area map" className="mt-6 w-full min-w-0 max-w-full overflow-hidden border border-border bg-secondary/30 p-4 sm:p-5">
    {valid ? <><div className="relative aspect-[2/1] w-full overflow-hidden border border-gold/15 bg-black/15">
      <img src={map.imageUrl} alt="Static street map centred on the ZIP code area, not the community location" loading="lazy" decoding="async" referrerPolicy="same-origin" draggable={false} onError={() => setFailedImage(map.imageUrl)} className="block h-full w-full object-cover" />
      <svg viewBox={`0 0 ${AREA_MAP_IMAGE_WIDTH} ${AREA_MAP_IMAGE_HEIGHT}`} role="img" aria-label={`Shaded approximate ${map.radiusMiles}-mile radius around the ZIP code centroid; no location pin`} className="pointer-events-none absolute inset-0 h-full w-full"><circle cx={AREA_MAP_IMAGE_WIDTH / 2} cy={AREA_MAP_IMAGE_HEIGHT / 2} r={radiusPixels} fill="rgba(211,166,62,0.18)" stroke="#d3a63e" strokeWidth="3" /></svg>
    </div><p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{map.attribution}</p><p className="mt-2 text-xs text-gold">About {map.radiusMiles}-mile radius around the ZIP code centroid. Not the community location.</p></> : <div role="status" className="border border-border/60 px-4 py-6 text-center text-sm leading-relaxed text-muted-foreground">Approximate area map unavailable. Ask us for area details. No exact community location is shown.</div>}
    {driveTimes.length > 0 && <div className="mt-3 flex min-w-0 flex-wrap gap-2">{driveTimes.map((chip) => <span key={chip} className="max-w-full break-words border border-border px-2.5 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">{chip}</span>)}</div>}
    {driveTimes.length > 0 && <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">Drive times are approximate and vary with route and traffic.</p>}
  </section>;
}
