import { useMemo, useState } from "react";
import PageShell from "@/components/PageShell";
import ListingCard from "@/components/ListingCard";
import { trpc } from "@/lib/trpc";
import { SITE } from "@shared/site";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

const CITY_FILTERS = ["All Cities", ...SITE.cities];
const TYPE_FILTERS = [
  { key: "all", label: "All Properties" },
  { key: "pools", label: "Homes with Pools" },
  { key: "new-construction", label: "New Construction" },
  { key: "multi-family", label: "Multi-Family" },
  { key: "townhomes-condos", label: "Townhomes / Condos" },
];

function SearchInner({ portfolio }: { portfolio: boolean }) {
  const { data: listings, isLoading } = trpc.listings.all.useQuery();
  const [city, setCity] = useState("All Cities");
  const [type, setType] = useState("all");

  const filtered = useMemo(() => {
    let items = listings ?? [];
    if (portfolio) items = items.filter((l) => l.featured);
    if (city !== "All Cities") items = items.filter((l) => l.city === city);
    switch (type) {
      case "pools":
        items = items.filter((l) => l.hasPool);
        break;
      case "new-construction":
        items = items.filter((l) => l.isNewConstruction);
        break;
      case "multi-family":
        items = items.filter((l) => l.propertyType === "Multi-Family");
        break;
      case "townhomes-condos":
        items = items.filter((l) => l.propertyType === "Townhome/Condo");
        break;
    }
    return items;
  }, [listings, city, type, portfolio]);

  return (
    <PageShell solidNav>
      <div className="mx-auto max-w-[1400px] px-5 lg:px-8 pt-28 lg:pt-36 pb-20">
        <p className="eyebrow text-gold">{portfolio ? "Our Work" : "Home Search"}</p>
        <h1 className="display-serif text-4xl md:text-6xl mt-3">
          {portfolio ? "Portfolio" : "Search Properties"}
        </h1>
        <p className="mt-4 text-muted-foreground max-w-2xl">
          {portfolio
            ? "Homes we actively market across Central Texas — active, pending, and recently sold."
            : "Filter by city and property type to browse available homes across our five Texas markets."}
        </p>

        {/* Filters */}
        <div className="mt-10 space-y-4">
          <div className="flex flex-wrap gap-2">
            {CITY_FILTERS.map((c) => (
              <button
                key={c}
                onClick={() => setCity(c)}
                className={cn(
                  "px-4 py-2 text-[11px] uppercase tracking-[0.18em] border transition-colors",
                  city === c
                    ? "border-gold text-gold"
                    : "border-border text-muted-foreground hover:border-gold/60 hover:text-foreground"
                )}>
                {c}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {TYPE_FILTERS.map((t) => (
              <button
                key={t.key}
                onClick={() => setType(t.key)}
                className={cn(
                  "px-4 py-2 text-[11px] uppercase tracking-[0.18em] border transition-colors",
                  type === t.key
                    ? "border-gold text-gold"
                    : "border-border text-muted-foreground hover:border-gold/60 hover:text-foreground"
                )}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Results */}
        <div className="mt-12">
          {isLoading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="space-y-3">
                  <Skeleton className="aspect-[4/3] w-full" />
                  <Skeleton className="h-6 w-1/2" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ))}
            </div>
          ) : filtered.length > 0 ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8 lg:gap-10">
              {filtered.map((l) => (
                <ListingCard key={l.id} listing={l} />
              ))}
            </div>
          ) : (
            <div className="py-20 text-center">
              <p className="font-serif text-2xl">No matching properties right now</p>
              <p className="mt-3 text-sm text-muted-foreground max-w-md mx-auto">
                Our inventory changes weekly. Try a different filter, or explore new construction
                across Texas through our builder network.
              </p>
              <a href={SITE.newHomeBuddyUrl} target="_blank" rel="noreferrer" className="text-cta mt-6 inline-block">
                Search New Builds Across Texas
              </a>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}

/** Route-friendly wrappers (wouter passes RouteComponentProps). */
export default function Search() {
  return <SearchInner portfolio={false} />;
}

export function Portfolio() {
  return <SearchInner portfolio />;
}
