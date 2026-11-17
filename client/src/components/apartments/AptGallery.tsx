import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Images, X } from "lucide-react";

export type GalleryPhoto = { url: string; caption: string | null };

const ARROW = "absolute top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center bg-black/55 text-white hover:bg-black/75";

/** One photo, whole (never cropped), over a soft blur of itself so the frame has no empty bars (Nov 4, 2026 rule). */
function WholePhoto({ photo, alt, eager = false, onBroken }: { photo: GalleryPhoto; alt: string; eager?: boolean; onBroken: () => void }) {
  return <>
    <img src={photo.url} alt="" aria-hidden="true" loading="lazy" decoding="async" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full scale-110 select-none object-cover opacity-60 blur-xl" />
    <img src={photo.url} alt={alt} loading={eager ? "eager" : "lazy"} decoding="async" draggable={false} onError={onBroken} className="relative block h-full w-full select-none object-contain" data-apt-photo="whole" />
  </>;
}

/**
 * A community's photos (Nov 17, 2026, Peter: "every single photo ... we just sell them on it"). The frame shows one
 * whole photo with arrows and a count; swiping works on a phone; a tap opens every photo full screen. `strip` adds
 * the row of thumbnails used on the client's list, so all the photos are in sight without opening anything.
 */
export function AptGallery({ photos, label, strip = false, className = "" }: { photos: GalleryPhoto[]; label: string; strip?: boolean; className?: string }) {
  const [broken, setBroken] = useState<string[]>([]);
  const shown = photos.filter((photo) => !broken.includes(photo.url));
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const touch = useRef<number | null>(null);
  const count = shown.length;
  const at = count ? Math.min(index, count - 1) : 0;
  const step = useCallback((by: number) => setIndex((value) => count ? (Math.min(value, count - 1) + by + count) % count : 0), [count]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); if (event.key === "ArrowRight") step(1); if (event.key === "ArrowLeft") step(-1); };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; };
  }, [open, step]);
  if (!count) return null;
  const photo = shown[at]!;
  const alt = `${label}: ${photo.caption ?? `photo ${at + 1} of ${count}`}`;
  const swipe = { onTouchStart: (event: React.TouchEvent) => { touch.current = event.touches[0]?.clientX ?? null; }, onTouchEnd: (event: React.TouchEvent) => { const start = touch.current; touch.current = null; const end = event.changedTouches[0]?.clientX; if (start != null && end != null && Math.abs(end - start) > 40) step(end < start ? 1 : -1); } };
  const drop = (url: string) => setBroken((list) => list.includes(url) ? list : [...list, url]);

  return <div className={className} data-apt-gallery={count}>
    <div className="relative aspect-[4/3] w-full overflow-hidden bg-secondary" {...swipe}>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Open all ${count} photos of ${label}`} className="absolute inset-0 block h-full w-full"><WholePhoto photo={photo} alt={alt} eager={at === 0} onBroken={() => drop(photo.url)} /></button>
      {count > 1 && <>
        <button type="button" aria-label="Previous photo" onClick={() => step(-1)} className={`${ARROW} left-0`}><ChevronLeft className="h-5 w-5" /></button>
        <button type="button" aria-label="Next photo" onClick={() => step(1)} className={`${ARROW} right-0`}><ChevronRight className="h-5 w-5" /></button>
      </>}
      <span className="pointer-events-none absolute bottom-2 right-2 z-10 inline-flex items-center gap-1.5 bg-black/65 px-2 py-1 text-[11px] text-white"><Images className="h-3.5 w-3.5" />{at + 1} / {count}</span>
      {photo.caption && <span className="pointer-events-none absolute bottom-2 left-2 z-10 max-w-[65%] truncate bg-black/65 px-2 py-1 text-[11px] text-white">{photo.caption}</span>}
    </div>
    {strip && count > 1 && <ul className="mt-2 flex gap-2 overflow-x-auto pb-1" aria-label={`All photos of ${label}`} data-apt-strip="true">{shown.map((entry, position) => <li key={entry.url} className="shrink-0"><button type="button" onClick={() => setIndex(position)} aria-label={`Photo ${position + 1}`} aria-current={position === at} className={`relative block h-16 w-24 overflow-hidden border-2 bg-secondary ${position === at ? "border-gold" : "border-transparent"}`}><img src={entry.url} alt="" loading="lazy" decoding="async" onError={() => drop(entry.url)} className="h-full w-full object-contain" /></button></li>)}</ul>}

    {open && <div role="dialog" aria-modal="true" aria-label={`Photos of ${label}`} className="fixed inset-0 z-[100] flex flex-col bg-black" data-apt-lightbox="true" {...swipe}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-white"><span className="min-w-0 truncate">{label} · {at + 1} of {count}{photo.caption ? ` · ${photo.caption}` : ""}</span><button type="button" onClick={() => setOpen(false)} aria-label="Close photos" className="flex h-11 w-11 shrink-0 items-center justify-center border border-white/40"><X className="h-5 w-5" /></button></div>
      <div className="relative min-h-0 flex-1">
        <img src={photo.url} alt={alt} className="absolute inset-0 h-full w-full select-none object-contain" draggable={false} />
        {count > 1 && <><button type="button" aria-label="Previous photo" onClick={() => step(-1)} className={`${ARROW} left-0 h-14 w-12`}><ChevronLeft className="h-6 w-6" /></button><button type="button" aria-label="Next photo" onClick={() => step(1)} className={`${ARROW} right-0 h-14 w-12`}><ChevronRight className="h-6 w-6" /></button></>}
      </div>
      {count > 1 && <ul className="flex gap-2 overflow-x-auto px-4 py-3">{shown.map((entry, position) => <li key={entry.url} className="shrink-0"><button type="button" onClick={() => setIndex(position)} aria-label={`Photo ${position + 1}`} className={`block h-14 w-20 overflow-hidden border-2 ${position === at ? "border-white" : "border-transparent opacity-70"}`}><img src={entry.url} alt="" loading="lazy" className="h-full w-full object-cover" /></button></li>)}</ul>}
    </div>}
  </div>;
}
