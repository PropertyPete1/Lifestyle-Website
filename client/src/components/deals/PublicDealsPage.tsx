import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { Heart, Menu, SlidersHorizontal, X } from "lucide-react";
import type { PaymentAssumptions } from "@shared/dealsFeatured";
import { SITE } from "@shared/site";
import { BROWSE_SORTS, EMPTY_FILTERS, PAYMENT_SORT, activeFilterCount, homePasses, landingMatches, newThisWeekKnown, sortLandingCommunities, storiesKnown, type BrowseFilters, type LandingHomeFacts } from "@/lib/dealsBrowse";
import { BrowseBar, BROWSE_COPY } from "./BrowseBar";
import { BUYER_CARD_COPY, BuyerHomeCard, LockedDetails } from "./BuyerHomeCard";
import { ComingSoonSection, type ComingSoonItem } from "./ComingSoon";
import { FeaturedStrip, featuredForSearch, type FeaturedDealsData } from "./FeaturedDeals";
import { HOME_LIST_COPY, ProtectedGallery } from "./GatedCatalog";
import { LandingBrowse, type LandingCommunity, type UseCommunityHomes } from "./LandingBrowse";
import { PublicHomeList, byPayment, publicHomeEntries, publicSaveId, type PublicHomeEntry } from "./PublicHomeList";
import { DealsFooter, formatChicagoDate } from "./shared";

/**
 * Oct 30, 2026 (Peter picked design "F / Warm Ivory"): the public /deals page. A compact light header, "New
 * construction deals", Homes / Map and Filters, then one big card per home with its monthly total at the builder's
 * rate and its own "Schedule a tour". Presentational: the page (Deals.tsx) passes the data and what a tour does, so
 * the QA harness renders the same component.
 */
export const PUBLIC_PAGE_COPY = {
  heading: "New construction deals",
  intro: "This week's best new-build deals in San Antonio. Hand-picked by Property Pete.",
  homes: "Homes",
  map: "Map",
  filters: "Filters",
  filtersTitle: "Filters",
  sort: "Sort by",
  show: "Show",
  showResults: (count: number, unit: string) => `Show ${count.toLocaleString("en-US")} ${unit}`,
  clearAll: "Clear all",
  close: "Close filters",
  menu: "Menu",
  mainSite: "Lifestyle Design Realty home",
  agentSignIn: "Agent sign-in",
} as const;

/** Light and compact (design F): the name on the left, a small menu on the right. */
export function DealsHeader({ agentSignIn = true }: { agentSignIn?: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  return <header data-deals-header="true" className="relative z-40 border-b border-border/70 bg-background/95 px-4 backdrop-blur sm:px-6">
    <div className="mx-auto flex min-h-16 max-w-[1600px] items-center justify-between gap-4">
      <Link href="/" className="group inline-flex flex-col font-serif text-[1.45rem] font-semibold leading-none text-foreground sm:text-2xl">Lifestyle Design Realty<span aria-hidden="true" className="mt-1.5 h-px w-2/3 bg-gold/70" /></Link>
      <button type="button" aria-expanded={open} aria-controls="deals-menu" aria-label={PUBLIC_PAGE_COPY.menu} onClick={() => setOpen((value) => !value)} className="flex h-11 w-11 items-center justify-center rounded-full text-gold hover:bg-gold/10">{open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}</button>
    </div>
    {open && <nav id="deals-menu" aria-label={PUBLIC_PAGE_COPY.menu} className="absolute right-4 top-full z-50 mt-1 w-64 overflow-hidden rounded-xl border border-border bg-card py-1 shadow-lg sm:right-6">
      <Link href="/" className="flex min-h-11 items-center px-4 text-sm text-foreground hover:bg-secondary">{PUBLIC_PAGE_COPY.mainSite}</Link>
      {agentSignIn && <Link href="/deals/team" data-deals-agent-signin="true" className="flex min-h-11 items-center px-4 text-sm text-foreground hover:bg-secondary">{PUBLIC_PAGE_COPY.agentSignIn}</Link>}
      {/* Oct 30, 2026: TREC's notices one tap from the top too (the long list pushes the footer far down). */}
      <a href={SITE.iabsUrl} target="_blank" rel="noreferrer" className="flex min-h-11 items-center border-t border-border px-4 text-xs text-muted-foreground hover:bg-secondary">Information About Brokerage Services</a>
      <a href={SITE.cpnUrl} target="_blank" rel="noreferrer" className="flex min-h-11 items-center px-4 text-xs text-muted-foreground hover:bg-secondary">Consumer Protection Notice</a>
    </nav>}
  </header>;
}

const SAVES_KEY = "deals-saved-homes";
const FILTERS_KEY = "deals-public-filters";
const SAVES_MAX = 200;
/**
 * Oct 30, 2026 (Peter: like New Home Buddy, a visitor saves homes without signing up): the hearts, in this browser
 * only. Storage can be missing or throw (private mode, blocked site data); the hearts then last for the visit.
 */
function useLocalSaves() {
  const [saved, setSaved] = useState<ReadonlySet<string>>(() => {
    try { const parsed: unknown = JSON.parse(window.localStorage.getItem(SAVES_KEY) ?? "[]"); return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string").slice(0, SAVES_MAX) : []); }
    catch { return new Set(); }
  });
  const toggle = (id: string) => setSaved((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else if (next.size < SAVES_MAX) next.add(id);
    try { window.localStorage.setItem(SAVES_KEY, JSON.stringify(Array.from(next))); } catch { /* kept for this visit only */ }
    return next;
  });
  return { saved, toggle };
}

/** Every filter at once: a sheet from the bottom on a phone, from the side on a wide screen. */
function FiltersSheet({ open, onClose, children, count, unit, onClear }: { open: boolean; onClose: () => void; children: ReactNode; count: number; unit: string; onClear: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!open) return;
    heading.current?.focus();
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", close); document.body.style.overflow = overflow; };
  }, [open, onClose]);
  if (!open) return null;
  return <div className="fixed inset-0 z-[90] flex items-end bg-black/45 lg:items-stretch lg:justify-end" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-labelledby="deals-filters-title" data-deals-filters-sheet="true" onClick={(event) => event.stopPropagation()} className="flex max-h-[88dvh] w-full flex-col rounded-t-2xl bg-background shadow-2xl lg:max-h-none lg:w-[28rem] lg:rounded-none">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h2 id="deals-filters-title" ref={heading} tabIndex={-1} className="font-serif text-2xl font-semibold outline-none">{PUBLIC_PAGE_COPY.filtersTitle}</h2>
        <button type="button" onClick={onClose} aria-label={PUBLIC_PAGE_COPY.close} className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      <div className="flex items-center gap-3 border-t border-border px-5 py-3">
        <button type="button" onClick={onClear} className="min-h-12 px-2 text-sm font-medium text-muted-foreground underline-offset-4 hover:underline">{PUBLIC_PAGE_COPY.clearAll}</button>
        <button type="button" onClick={onClose} data-deals-filters-show="true" className="ml-auto min-h-12 flex-1 rounded-xl bg-gold px-5 text-base font-semibold text-primary-foreground">{PUBLIC_PAGE_COPY.showResults(count, unit)}</button>
      </div>
    </section>
  </div>;
}

export type PublicDealsCommunity = LandingCommunity & { homeFacts?: LandingHomeFacts[] | null; updatedAt?: string | null };

export type PublicDealsPageProps = {
  communities: readonly PublicDealsCommunity[];
  useHomes: UseCommunityHomes;
  featured?: FeaturedDealsData;
  comingSoon?: readonly ComingSoonItem[];
  /** "Shared by Tiffany" / "Tiffany's new home search": above the heading when an agent's link brought them. */
  eyebrow?: string | null;
  intro?: string;
  /** A shared community link (?k=): its sheet opens on arrival. */
  openKey?: string | null;
  /** "Schedule a tour" (a card's, the featured row's or Coming Soon's): the sign-up for a tour. */
  onTour: (entry?: PublicHomeEntry) => void;
};

export function PublicDealsPage({ communities: all, useHomes, featured, comingSoon, eyebrow, intro = PUBLIC_PAGE_COPY.intro, openKey, onTour }: PublicDealsPageProps) {
  // Oct 30, 2026 (ChatGPT's test: back from the Privacy Policy, the saved-only view was gone): the filters last for the visit.
  const [filters, setFiltersState] = useState<BrowseFilters>(() => { try { const kept = JSON.parse(window.sessionStorage.getItem(FILTERS_KEY) ?? "null") as Partial<BrowseFilters> | null; return kept && typeof kept === "object" ? { ...EMPTY_FILTERS, ...kept } : EMPTY_FILTERS; } catch { return EMPTY_FILTERS; } });
  const setFilters = (next: BrowseFilters | ((current: BrowseFilters) => BrowseFilters)) => setFiltersState((current) => {
    const value = typeof next === "function" ? next(current) : next;
    try { window.sessionStorage.setItem(FILTERS_KEY, JSON.stringify(value)); } catch { /* kept for this page only */ }
    return value;
  });
  const [listView, setListView] = useState<"homes" | "communities">("homes");
  const [mapOpen, setMapOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [areaKeys, setAreaKeys] = useState<ReadonlySet<string> | null>(null);
  const matching = useMemo(() => sortLandingCommunities(all.filter((community) => landingMatches(community as never, filters)) as never[], filters.sort) as unknown as PublicDealsCommunity[], [all, filters]);
  const { saved, toggle: toggleSave } = useLocalSaves();
  const savedOnly = filters.savedOnly && saved.size > 0;
  const assumptions: PaymentAssumptions | null = useMemo(() => featured?.assumptions ? { defaultDownPercent: featured.assumptions.defaultDownPercent, termYears: featured.assumptions.termYears, costs: featured.assumptions.costs } : null, [featured]);
  const homeEntries = useMemo(() => { const entries = publicHomeEntries(matching as never, filters); return byPayment(savedOnly ? entries.filter((entry) => saved.has(publicSaveId(entry))) : entries, filters, assumptions); }, [matching, filters, savedOnly, saved, assumptions]);
  const paymentCap = filters.maxPayment ?? null;
  // Oct 30, 2026 (ChatGPT: "2 saved shows two cards, while the map keeps the wider inventory"): showing saved homes, the
  // map shows only their communities too.
  const mapCommunities = useMemo(() => { if (!savedOnly && paymentCap === null) return matching; const keys = new Set(homeEntries.map((entry) => entry.key)); return matching.filter((community) => community.key && keys.has(community.key)); }, [matching, savedOnly, paymentCap, homeEntries]);
  const shownHomes = areaKeys ? homeEntries.filter((entry) => areaKeys.has(entry.key)).length : homeEntries.length;
  const shownCommunities = areaKeys ? areaKeys.size : matching.length;
  const totalHomes = all.reduce((sum, community) => sum + (community.homeFacts?.length ?? 0), 0);
  const active = activeFilterCount(filters);
  const updatedAt = all.map((community) => community.updatedAt).filter((value): value is string => Boolean(value)).sort().at(-1);
  const unit = listView === "homes" ? "homes" : "communities";
  // The featured row follows the search: a deal fits when its community is in the results (and in the map area, when one
  // is chosen) and the home itself passes the filters.
  const strip = useMemo(() => {
    if (!featured) return null;
    const inResults = new Set(matching.map((community) => community.key).filter((key): key is string => Boolean(key)));
    const fits = (deal: { landingKey?: string; price: number; previousPrice?: number | null; beds?: string | number | null; sqft?: number | null; kind: string; acres: number | null; estMonthly: number }) =>
      Boolean(deal.landingKey && inResults.has(deal.landingKey) && (!areaKeys || areaKeys.has(deal.landingKey)))
      && homePasses({ kind: deal.kind, price: deal.price, previousPrice: deal.previousPrice ?? null, beds: deal.beds ?? null, sqft: deal.sqft ?? null }, filters, deal.acres)
      && (paymentCap === null || deal.estMonthly <= paymentCap);
    return featuredForSearch(featured, active > 0 || areaKeys !== null, fits);
  }, [featured, matching, areaKeys, filters, active, paymentCap]);
  const resultCount = listView === "homes" ? shownHomes : shownCommunities;
  const segment = (on: boolean) => `min-h-11 rounded-full px-6 text-base transition-colors ${on ? "bg-gold font-semibold text-primary-foreground shadow-sm" : "text-foreground hover:text-gold"}`;
  return <main className="deals-light min-h-screen max-w-full overflow-x-clip bg-background [overflow-anchor:none]" data-deals-public-page="true">
    <DealsHeader />
    <section className="px-4 pb-16 pt-6 sm:px-6">
      <div className="mx-auto max-w-[1600px]">
        {eyebrow && <p className="eyebrow text-gold" data-deals-landing-agent="true">{eyebrow}</p>}
        <h1 className={`${eyebrow ? "mt-2" : ""} font-serif text-[2.3rem] font-semibold leading-[1.05] tracking-tight text-foreground sm:text-5xl`}>{PUBLIC_PAGE_COPY.heading}</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{intro}{updatedAt ? ` Updated ${formatChicagoDate(updatedAt)}.` : ""}</p>
        {all.length > 0 && <div className="mt-5 flex min-w-0 items-center justify-between gap-3" data-deals-controls="true">
          <div role="group" aria-label="Show homes or the map" className="inline-flex rounded-full border border-border bg-card p-1 lg:hidden">
            <button type="button" aria-pressed={!mapOpen} data-deals-view="homes" onClick={() => setMapOpen(false)} className={segment(!mapOpen)}>{PUBLIC_PAGE_COPY.homes}</button>
            <button type="button" aria-pressed={mapOpen} data-deals-view="map" onClick={() => setMapOpen(true)} className={segment(mapOpen)}>{PUBLIC_PAGE_COPY.map}</button>
          </div>
          <p className="hidden text-sm font-medium text-foreground lg:block" data-deals-result-count="true">{listView === "homes" ? HOME_LIST_COPY.count(shownHomes) : `${shownCommunities} communities`}</p>
          <button type="button" onClick={() => setFiltersOpen(true)} aria-haspopup="dialog" data-deals-open-filters="true" className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-gold/70 bg-card px-5 text-base text-foreground hover:bg-gold/10"><SlidersHorizontal className="h-4 w-4 text-gold" aria-hidden="true" />{PUBLIC_PAGE_COPY.filters}{active > 0 && <span className="rounded-full bg-gold px-2 text-xs font-semibold text-primary-foreground">{active}</span>}</button>
        </div>}
        {all.length > 0 && <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 text-sm text-muted-foreground lg:mt-1 lg:justify-end">
          <p className="lg:hidden" data-deals-result-count="true">{listView === "homes" ? HOME_LIST_COPY.count(shownHomes) : `${shownCommunities} communities`}</p>
          {saved.size > 0 && listView === "homes" && <button type="button" aria-pressed={filters.savedOnly} data-deals-saved-only="true" onClick={() => setFilters((current) => ({ ...current, savedOnly: !current.savedOnly }))} className={`inline-flex min-h-11 items-center gap-1.5 font-medium ${filters.savedOnly ? "text-red-600" : "text-foreground"}`}><Heart className={`h-4 w-4 ${filters.savedOnly ? "fill-red-600" : ""}`} aria-hidden="true" />{filters.savedOnly ? `Showing ${saved.size} saved` : `${saved.size} saved`}</button>}
          {active > 0 && <button type="button" onClick={() => setFilters({ ...EMPTY_FILTERS, sort: filters.sort })} className="min-h-11 font-medium text-gold underline underline-offset-4">{BROWSE_COPY.clear}</button>}
        </div>}
        {all.length > 0 && matching.length === 0 && <p role="status" className="mt-8 text-sm text-muted-foreground">{BROWSE_COPY.none}</p>}
        <LandingBrowse mapSide="left" phoneMap="external" phoneMapOpen={mapOpen} onPhoneMapOpenChange={setMapOpen} searchArea
          onAreaChange={(keys) => setAreaKeys(keys ? new Set(keys) : null)}
          areaStatus={listView === "homes" ? (keys) => { const inArea = new Set(keys); return `Showing ${HOME_LIST_COPY.count(homeEntries.filter((entry) => inArea.has(entry.key)).length)} in this part of town`; } : undefined}
          renderList={listView === "homes" ? (context) => <PublicHomeList entries={homeEntries} context={context} useHomes={useHomes} assumptions={assumptions} onTour={(entry) => onTour(entry)} saved={saved} onToggleSave={toggleSave} /> : undefined}
          communities={mapCommunities} filters={filters} useHomes={useHomes} onUnlock={() => onTour()} lookup={all} openKey={openKey}
          sheet={{ locked: <LockedDetails />,
            // Oct 30, 2026 (ChatGPT's test: a home opened onto its community, not its photos): the opened home leads the sheet.
            focusHero: (home, community) => <div className="mx-auto max-w-3xl p-4 pt-14 sm:p-6 sm:pt-14"><BuyerHomeCard home={home} area={community.area} incentive={community.incentive ?? null} assumptions={assumptions} tourLabel={BUYER_CARD_COPY.details} gallery={<ProtectedGallery photos={home.photos} />} onTour={() => onTour()} /></div>,
            renderHome: (home, isFeatured, community) => <BuyerHomeCard home={home} area={community.area} incentive={community.incentive ?? null} assumptions={assumptions} tourLabel={BUYER_CARD_COPY.details} featured={isFeatured} gallery={<ProtectedGallery photos={home.photos} />} onTour={() => onTour()} /> }}
          top={filters.savedOnly ? undefined : (actions) => <FeaturedStrip compact featured={strip?.featured} eyebrow={strip?.eyebrow} opens onHover={(deal) => actions.hover(deal?.landingKey ?? null)} onSelect={(deal) => { if (!deal.landingKey || !actions.openHome(deal.landingKey, { price: deal.price, sqft: deal.sqft, kind: deal.kind })) onTour(); }} />}
          below={filters.savedOnly ? undefined : <ComingSoonSection items={comingSoon} action={{ kind: "text", phone: null, name: null }} />} />
      </div>
    </section>
    <DealsFooter />
    <FiltersSheet open={filtersOpen} onClose={() => setFiltersOpen(false)} count={resultCount} unit={unit} onClear={() => setFilters(EMPTY_FILTERS)}>
      <div className="grid min-w-0 grid-cols-2 gap-3">
        <label className="min-w-0 text-[11px] uppercase tracking-widest text-muted-foreground">{PUBLIC_PAGE_COPY.show}
          <select aria-label={PUBLIC_PAGE_COPY.show} value={listView} onChange={(event) => setListView(event.target.value as "homes" | "communities")} className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm normal-case tracking-normal text-foreground">
            <option value="homes">{HOME_LIST_COPY.homes}</option>
            <option value="communities">{HOME_LIST_COPY.communities}</option>
          </select>
        </label>
        <label className="min-w-0 text-[11px] uppercase tracking-widest text-muted-foreground" data-deals-sort="true">{PUBLIC_PAGE_COPY.sort}
          <select aria-label={PUBLIC_PAGE_COPY.sort} value={filters.sort} onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value as BrowseFilters["sort"] }))} className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm normal-case tracking-normal text-foreground">{(assumptions ? [...BROWSE_SORTS, PAYMENT_SORT] : BROWSE_SORTS).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        </label>
      </div>
      <div className="mt-4 border-t border-border pt-4">
        <BrowseBar sheet payments={Boolean(assumptions)} filters={filters} onChange={setFilters} areas={all} shown={homeEntries.length} total={totalHomes} unit="homes" savedCount={saved.size} showStories={storiesKnown(all)} showNew={newThisWeekKnown(all)} />
      </div>
    </FiltersSheet>
  </main>;
}
