import { Link } from "wouter";
import { MapPin } from "lucide-react";
import { formatPrice } from "@/components/ListingCard";
import type { Listing } from "../../../drizzle/schema";

/**
 * "Map" view for search results — a location overview.
 *
 * This site deliberately does not embed a third-party map tile service. Instead
 * the map toggle presents matches grouped by market/city: a clean, instant,
 * at-a-glance breakdown of where the results are, with every listing one tap
 * from its detail page. Interactive MLS maps will arrive later through the IDX
 * vendor's own map widget (Phase 2); this location overview is the intended,
 * permanent experience until then — not a fallback or error state.
 */
export default function ListingsMap({ listings }: { listings: Listing[] }) {
  const byCity = Object.entries(
    listings.reduce<Record<string, Listing[]>>((acc, l) => {
      (acc[l.city] ??= []).push(l);
      return acc;
    }, {})
  ).sort((a, b) => b[1].length - a[1].length);

  if (byCity.length === 0) return null;

  return (
    <div className="glass-card border border-border overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-border/60 px-6 py-4">
        <MapPin className="h-4 w-4 text-gold" />
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          {listings.length} {listings.length === 1 ? "home" : "homes"} across {byCity.length}{" "}
          {byCity.length === 1 ? "market" : "markets"}
        </p>
      </div>

      <div className="grid gap-x-10 gap-y-8 p-6 lg:p-8 sm:grid-cols-2">
        {byCity.map(([city, group]) => (
          <div key={city}>
            <div className="flex items-baseline justify-between border-b border-gold/30 pb-2">
              <p className="eyebrow text-gold">{city}</p>
              <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
                {group.length} {group.length === 1 ? "listing" : "listings"}
              </span>
            </div>
            <ul className="mt-3 divide-y divide-border/50">
              {group.map((l) => (
                <li key={l.id}>
                  <Link
                    href={`/listing/${l.slug}`}
                    className="group flex items-center justify-between gap-4 py-3 transition-colors">
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-foreground/90 group-hover:text-gold transition-colors">
                        {l.address}
                      </span>
                      <span className="mt-0.5 block text-[11px] uppercase tracking-wider text-muted-foreground">
                        {l.beds} bd · {l.baths} ba · {l.sqft.toLocaleString()} sqft
                      </span>
                    </span>
                    <span className="whitespace-nowrap text-sm font-medium text-gold">
                      {formatPrice(l.price)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
