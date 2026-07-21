import { useEffect, useMemo, useState } from "react";
import { useSearch } from "wouter";
import PageShell from "@/components/PageShell";
import ListingCard from "@/components/ListingCard";
import AISearchBar from "@/components/AISearchBar";
import ListingsMap from "@/components/ListingsMap";
import AIStatusSequence from "@/components/AIStatusSequence";
import { useActivity } from "@/hooks/useActivity";
import { trpc } from "@/lib/trpc";
import { SITE } from "@shared/site";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { LayoutGrid, Map as MapIcon, Sparkles, X } from "lucide-react";

const CITY_FILTERS = ["All Cities", ...SITE.cities];
const TYPE_FILTERS = [
  { key: "all", label: "All Properties" },
  { key: "pools", label: "Homes with Pools" },
  { key: "new-construction", label: "New Construction" },
  { key: "multi-family", label: "Multi-Family" },
  { key: "townhomes-condos", label: "Townhomes / Condos" },
];

function SearchInner({ portfolio }: { portfolio: boolean }) {
  const searchString = useSearch();
  const urlQuery = useMemo(
    () => new URLSearchParams(searchString).get("q") ?? "",
    [searchString]
  );

  const { data: listings, isLoading } = trpc.listings.all.useQuery();
  const ai = trpc.listings.aiSearch.useQuery(
    { query: urlQuery },
    { enabled: urlQuery.length >= 2 }
  );

  // Anonymous activity: log each AI search once per query (with parsed criteria)
  const logActivity = useActivity();
  const [loggedQuery, setLoggedQuery] = useState("");
  useEffect(() => {
    if (!urlQuery || !ai.data || urlQuery === loggedQuery) return;
    setLoggedQuery(urlQuery);
    const c = ai.data.criteria as Record<string, unknown> | undefined;
    const bits: string[] = [];
    if (c) {
      if (c.city) bits.push(String(c.city));
      if (c.minBeds) bits.push(`${c.minBeds}+ beds`);
      if (c.maxPrice) bits.push(`under $${Math.round(Number(c.maxPrice) / 1000)}K`);
      if (c.hasPool) bits.push("pool");
      if (c.isNewConstruction) bits.push("new construction");
      if (c.primaryBedDown) bits.push("primary bed down");
    }
    logActivity("ai_search", {
      query: urlQuery,
      criteria: bits.join(", "),
      resultCount: ai.data.results?.length ?? 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQuery, ai.data]);

  const [city, setCity] = useState("All Cities");
  // Support /search?city=Austin deep links (e.g. from City Finder results)
  useEffect(() => {
    const cityParam = new URLSearchParams(searchString).get("city");
    if (cityParam && CITY_FILTERS.includes(cityParam)) setCity(cityParam);
  }, [searchString]);
  const [type, setType] = useState("all");
  const [view, setView] = useState<"list" | "map">("list");

  // reset filters when a fresh AI query arrives
  useEffect(() => {
    if (urlQuery) {
      setCity("All Cities");
      setType("all");
    }
  }, [urlQuery]);

  const aiActive = urlQuery.length >= 2;
  const base = aiActive ? (ai.data?.results ?? []) : (listings ?? []);
  const aiLoading = aiActive && ai.isLoading;

  const filtered = useMemo(() => {
    let items = base;
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
  }, [base, city, type, portfolio]);

  const criteriaChips = useMemo(() => {
    const c = ai.data?.criteria;
    if (!c) return [];
    const chips: string[] = [];
    if (c.city) chips.push(c.city);
    if (c.maxPrice) chips.push(`Under $${Math.round(c.maxPrice / 1000)}K`);
    if (c.minPrice) chips.push(`Over $${Math.round(c.minPrice / 1000)}K`);
    if (c.minBeds) chips.push(`${c.minBeds}+ Beds`);
    if (c.minBaths) chips.push(`${c.minBaths}+ Baths`);
    if (c.minSqft) chips.push(`${c.minSqft.toLocaleString()}+ SqFt`);
    if (c.hasPool) chips.push("Pool");
    if (c.isNewConstruction) chips.push("New Construction");
    if (c.propertyType) chips.push(c.propertyType);
    return chips;
  }, [ai.data]);

  const showLoading = isLoading || aiLoading;

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
            : "Describe what you're looking for in plain English, or filter by city and property type."}
        </p>

        {/* AI natural-language search */}
        {!portfolio && (
          <div className="mt-10 max-w-3xl">
            <AISearchBar />
            {aiActive && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-gold">
                  <Sparkles className="h-3.5 w-3.5" /> AI matched:
                </span>
                {aiLoading ? (
                  <span className="text-xs text-muted-foreground animate-pulse">Analyzing your criteria…</span>
                ) : criteriaChips.length > 0 ? (
                  criteriaChips.map((chip) => (
                    <span key={chip} className="px-3 py-1 text-[11px] uppercase tracking-[0.15em] border border-gold/50 text-gold">
                      {chip}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">Showing best matches for "{urlQuery}"</span>
                )}
                <a
                  href={portfolio ? "/portfolio" : "/search"}
                  className="flex items-center gap-1 text-[11px] uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground">
                  <X className="h-3 w-3" /> Clear
                </a>
              </div>
            )}
          </div>
        )}

        {/* Filters + view toggle */}
        <div className="mt-8 space-y-4">
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
          <div className="flex flex-wrap items-center justify-between gap-4">
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
            {/* List / Map view toggle */}
            <div className="flex border border-border">
              <button
                onClick={() => setView("list")}
                aria-label="List view"
                className={cn(
                  "flex items-center gap-2 px-4 py-2 text-[11px] uppercase tracking-[0.18em] transition-colors",
                  view === "list" ? "bg-gold text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}>
                <LayoutGrid className="h-3.5 w-3.5" /> List
              </button>
              <button
                onClick={() => setView("map")}
                aria-label="Map view"
                className={cn(
                  "flex items-center gap-2 px-4 py-2 text-[11px] uppercase tracking-[0.18em] transition-colors",
                  view === "map" ? "bg-gold text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}>
                <MapIcon className="h-3.5 w-3.5" /> Map
              </button>
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="mt-12">
          {/* AI search endpoint: clear results headline so the flow never ends silently */}
          {aiActive && !showLoading && (
            <h2 className="font-serif text-2xl md:text-3xl mb-8">
              {filtered.length > 0
                ? `${filtered.length} home${filtered.length === 1 ? " matches" : "s match"} your search`
                : "Here's what we found for you"}
            </h2>
          )}
          {showLoading ? (
            <>
              {aiLoading && (
                <AIStatusSequence
                  className="mb-10"
                  stages={["Analyzing your criteria…", "Matching listings…", "Ranking your results…"]}
                />
              )}
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="space-y-3">
                    <Skeleton className="aspect-[4/3] w-full" />
                    <Skeleton className="h-6 w-1/2" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                ))}
              </div>
            </>
          ) : filtered.length > 0 ? (
            view === "map" ? (
              <ListingsMap listings={filtered} />
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8 lg:gap-10">
                {filtered.map((l) => (
                  <ListingCard key={l.id} listing={l} />
                ))}
              </div>
            )
          ) : (
            <div className="py-20 text-center">
              <p className="font-serif text-2xl">No matching properties right now</p>
              <p className="mt-3 text-sm text-muted-foreground max-w-md mx-auto">
                Our inventory changes weekly. Try a different filter, or explore new construction
                across Texas through our builder network.
              </p>
              <a href={SITE.newConstructionUrl} target="_blank" rel="noreferrer" className="text-cta mt-6 inline-block">
                Find New Builds Across Texas
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
