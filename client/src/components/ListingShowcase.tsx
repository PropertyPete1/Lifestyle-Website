import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ChevronLeft, ChevronRight, BedDouble, Bath, Ruler } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatPrice } from "@/components/ListingCard";

/**
 * Compact auto-rotating single-listing showcase.
 * One large photo at a time, auto-advancing every 7s, with manual arrows
 * and swipe support. Shows photo + price + beds/baths/sqft + city + View Details.
 * Data-source-agnostic: renders whatever `listings.featured` returns
 * (placeholder now, MLS/IDX-fed in Phase 2).
 */
export default function ListingShowcase() {
  const { data: listings } = trpc.listings.featured.useQuery();
  const items = (listings ?? []).slice(0, 6);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchX = useRef<number | null>(null);

  const go = useCallback(
    (dir: 1 | -1) => {
      if (items.length === 0) return;
      setIdx((i) => (i + dir + items.length) % items.length);
    },
    [items.length]
  );

  useEffect(() => {
    if (paused || items.length < 2) return;
    const t = setInterval(() => go(1), 7000);
    return () => clearInterval(t);
  }, [paused, items.length, go]);

  if (items.length === 0) return null;
  const l = items[Math.min(idx, items.length - 1)];

  return (
    <div
      className="relative overflow-hidden group"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={(e) => {
        touchX.current = e.touches[0].clientX;
        setPaused(true);
      }}
      onTouchEnd={(e) => {
        if (touchX.current !== null) {
          const dx = e.changedTouches[0].clientX - touchX.current;
          if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
        }
        touchX.current = null;
        setPaused(false);
      }}>
      <div className="relative aspect-[16/9] md:aspect-[21/9]">
        {items.map((item, i) => (
          <img
            key={item.id}
            src={item.heroImage ?? ""}
            alt={item.address}
            className="absolute inset-0 h-full w-full object-cover transition-opacity duration-700"
            style={{ opacity: i === idx ? 1 : 0 }}
          />
        ))}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />

        {/* Info strip */}
        <div className="absolute inset-x-0 bottom-0 p-5 md:p-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-gold">{l.city}, {l.state}</p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <span className="font-serif text-2xl md:text-3xl text-white">{formatPrice(l.price)}</span>
              <span className="hidden sm:flex items-center gap-4 text-[11px] uppercase tracking-[0.15em] text-white/85">
                <span className="flex items-center gap-1.5"><BedDouble className="h-3.5 w-3.5" />{l.beds} Bd</span>
                <span className="flex items-center gap-1.5"><Bath className="h-3.5 w-3.5" />{l.baths} Ba</span>
                <span className="flex items-center gap-1.5"><Ruler className="h-3.5 w-3.5" />{l.sqft.toLocaleString()} SqFt</span>
              </span>
            </div>
          </div>
          <Link href={`/listing/${l.slug}`} className="text-cta text-white shrink-0">
            View Details
          </Link>
        </div>

        {/* Arrows */}
        {items.length > 1 && (
          <>
            <button
              aria-label="Previous listing"
              onClick={() => go(-1)}
              className="absolute left-3 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/70 p-2 text-white transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              aria-label="Next listing"
              onClick={() => go(1)}
              className="absolute right-3 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/70 p-2 text-white transition-colors">
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}

        {/* Dots */}
        {items.length > 1 && (
          <div className="absolute top-4 right-4 flex gap-1.5">
            {items.map((_, i) => (
              <button
                key={i}
                aria-label={`Go to listing ${i + 1}`}
                onClick={() => setIdx(i)}
                className={`h-1 transition-all duration-300 ${i === idx ? "w-6 bg-gold" : "w-3 bg-white/40 hover:bg-white/70"}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
