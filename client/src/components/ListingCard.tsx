import { Link } from "wouter";
import type { Listing } from "../../../drizzle/schema";
import { BedDouble, Bath, Ruler } from "lucide-react";
import { cn } from "@/lib/utils";

export function formatPrice(price: number) {
  return price.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

const statusStyles: Record<string, string> = {
  Active: "bg-gold text-primary-foreground",
  Pending: "bg-secondary text-foreground border border-gold/50",
  Sold: "bg-foreground/15 text-foreground",
};

/**
 * Data-source-agnostic listing card: works for CMS (Phase 1) and IDX (Phase 2)
 * data. IDX attribution/disclaimer slots render only when populated.
 */
export default function ListingCard({ listing, large = false }: { listing: Listing; large?: boolean }) {
  return (
    <Link href={`/listing/${listing.slug}`}>
      <article className={cn("group cursor-pointer", large ? "" : "")}>
        <div className="relative overflow-hidden aspect-[4/3] bg-secondary">
          {listing.heroImage && (
            <img
              src={listing.heroImage}
              alt={listing.address}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
            />
          )}
          <span
            className={cn(
              "absolute top-4 left-4 px-3 py-1 text-[10px] uppercase tracking-[0.2em] font-medium",
              statusStyles[listing.status] ?? statusStyles.Active
            )}>
            {listing.status}
          </span>
        </div>
        <div className="pt-4 space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-serif text-2xl">{formatPrice(listing.price)}</span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-gold">{listing.city}</span>
          </div>
          <p className="text-sm text-muted-foreground">{listing.address}</p>
          <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1">
            <span className="flex items-center gap-1.5"><BedDouble className="h-3.5 w-3.5" />{listing.beds} Beds</span>
            <span className="flex items-center gap-1.5"><Bath className="h-3.5 w-3.5" />{listing.baths} Baths</span>
            <span className="flex items-center gap-1.5"><Ruler className="h-3.5 w-3.5" />{listing.sqft.toLocaleString()} SqFt</span>
          </div>
          {listing.agentName && (
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground pt-1">
              {/* TREC: agent name never exceeds 2x brokerage name size — both small here */}
              Listed by {listing.agentName} · Lifestyle Design Realty
            </p>
          )}
          {listing.brokerAttribution && (
            <p className="text-[10px] text-muted-foreground/70">{listing.brokerAttribution}</p>
          )}
        </div>
      </article>
    </Link>
  );
}
