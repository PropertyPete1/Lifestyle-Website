import { useState } from "react";
import { SlidersHorizontal, X, Flame, ChevronDown } from "lucide-react";
import { AVAILABLE_BY, BATH_MINIMUMS, BED_MINIMUMS, BROWSE_PAGE, EMPTY_FILTERS, GARAGE_MINIMUMS, PRICE_CAPS, PRICE_FLOORS, SQFT_MAXIMUMS, SQFT_MINIMUMS, activeFilterCount, areaGroups, districtChoices, MARKET_AREA_PREFIX, moreFilterCount, priceCapLabel, type BrowseFilters } from "@/lib/dealsBrowse";

export const BROWSE_COPY = {
  heading: "Find your community",
  area: "Area",
  anyArea: "All areas",
  marketGroup: (market: string) => `${market} area`,
  wholeMarket: (market: string) => `All of the ${market} area`,
  minPrice: "Min price",
  noMin: "No min",
  price: "Max price",
  anyPrice: "No max",
  beds: "Bedrooms",
  anyBeds: "Any",
  baths: "Bathrooms",
  sqft: "Min sq ft",
  maxSqft: "Max sq ft",
  availableBy: "Move in by",
  readyNow: "Ready now",
  withinMonths: (months: number) => `Within ${months} month${months === 1 ? "" : "s"}`,
  garage: "Garage",
  stories: "Stories",
  anyStories: "Any",
  oneStory: "1 story",
  twoStory: "2 story+",
  homeType: "Home type",
  schoolDistrict: "School district",
  anyDistrict: "Any district",
  builder: "Builder (team only)",
  anyBuilder: "All builders",
  more: "More filters",
  done: "Done",
  moveInReady: "Quick move-in",
  toBeBuilt: "To be built",
  builderRate: "Builder rate offer",
  bigLots: "Half-acre+ lots",
  redHot: "Red Hot Deals",
  saved: "Saved",
  noneSaved: "None of your saved homes match these filters. Clear a filter to see them all.",
  clear: "Clear filters",
  none: "No communities match these filters yet. Try fewer filters, or ask us: new homes are added every day.",
} as const;

const SELECT = "min-h-11 w-full min-w-0 max-w-full rounded-lg border border-input bg-background px-3 text-sm normal-case tracking-normal text-foreground";
const LABEL = "min-w-0 text-[11px] uppercase tracking-widest text-muted-foreground";

function Toggle({ on, label, onChange, name }: { on: boolean; label: string; onChange: (value: boolean) => void; name: string }) {
  return <button type="button" aria-pressed={on} data-deals-filter={name} onClick={() => onChange(!on)} className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm transition-colors ${on ? "border-gold bg-gold/10 text-gold" : "border-border text-muted-foreground hover:text-gold"}`}>{label}</button>;
}

function NumberSelect({ label, value, options, any, format, onChange }: { label: string; value: number | null; options: readonly number[]; any: string; format: (value: number) => string; onChange: (value: number | null) => void }) {
  return <label className={LABEL}>{label}
    <select aria-label={label} value={value ?? ""} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)} className={`mt-1 ${SELECT}`}>
      <option value="">{any}</option>
      {options.map((option) => <option key={option} value={option}>{format(option)}</option>)}
    </select>
  </label>;
}

/**
 * Filters for a list of every community in the area, like New Home Buddy's: area, price range and bedrooms up front,
 * baths, size, garage, stories and home type under "More filters". The landing page filters on each community's
 * public home figures; the private list filters the homes themselves.
 */
export function BrowseBar({ filters, onChange, areas, shown, total, unit, savedCount = 0, showStories = true, builders = [] }: {
  filters: BrowseFilters;
  onChange: (filters: BrowseFilters) => void;
  areas: ReadonlyArray<{ area: string; schoolDistrict?: string | null }>;
  shown: number;
  total: number;
  /** "communities" or "homes", for the count line. */
  unit: string;
  /** Kept for older callers: bedrooms show on every list now. */
  showBeds?: boolean;
  /** Private list only: how many homes the buyer has saved (the "Saved" toggle shows when there are any). */
  savedCount?: number;
  /** Off until some home on the list has its stories from the builder (a stories filter would match nothing). */
  showStories?: boolean;
  /** Team lists only (Peter and his agents): the builder picker. Never passed on a buyer's list or the landing page. */
  builders?: ReadonlyArray<{ builder: string; count: number }>;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const groups = areaGroups(areas);
  const districts = districtChoices(areas);
  const active = activeFilterCount(filters);
  const more = moreFilterCount(filters);
  const set = (patch: Partial<BrowseFilters>) => onChange({ ...filters, ...patch });
  // A minimum above the maximum would match nothing: picking one moves the other out of the way.
  const setMin = (minPrice: number | null) => set({ minPrice, ...(minPrice !== null && filters.maxPrice !== null && filters.maxPrice <= minPrice ? { maxPrice: null } : {}) });
  const setMax = (maxPrice: number | null) => set({ maxPrice, ...(maxPrice !== null && filters.minPrice !== null && filters.minPrice >= maxPrice ? { minPrice: null } : {}) });
  return <section aria-label={BROWSE_COPY.heading} data-deals-browse="true" className="mt-6 min-w-0 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5 lg:py-4">
    <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-gold"><SlidersHorizontal className="h-4 w-4" />{BROWSE_COPY.heading}</p>
    {/* On a wide screen the selects and the toggles share one row, so the map and the list start higher (Peter: see the map before scrolling). */}
    <div className="min-w-0 xl:flex xl:items-end xl:gap-4">
    <div className="mt-3 grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4 xl:w-[44rem] xl:shrink-0 xl:grid-cols-[1.4fr_1fr_1fr_0.8fr]">
      <label className={`${LABEL} col-span-2 sm:col-span-1`}>{BROWSE_COPY.area}
        <select aria-label={BROWSE_COPY.area} value={filters.area} onChange={(event) => set({ area: event.target.value })} className={`mt-1 ${SELECT}`}>
          <option value="">{BROWSE_COPY.anyArea}</option>
          {groups.length === 1
            ? groups[0]!.choices.map((choice) => <option key={choice.area} value={choice.area}>{choice.area} ({choice.count})</option>)
            : groups.map((group) => <optgroup key={group.market} label={BROWSE_COPY.marketGroup(group.market)}>
              <option value={`${MARKET_AREA_PREFIX}${group.market}`}>{BROWSE_COPY.wholeMarket(group.market)} ({group.total})</option>
              {group.choices.map((choice) => <option key={choice.area} value={choice.area}>{choice.area} ({choice.count})</option>)}
            </optgroup>)}
        </select>
      </label>
      <NumberSelect label={BROWSE_COPY.minPrice} value={filters.minPrice} options={PRICE_FLOORS} any={BROWSE_COPY.noMin} format={(value) => `${priceCapLabel(value)}+`} onChange={setMin} />
      <NumberSelect label={BROWSE_COPY.price} value={filters.maxPrice} options={PRICE_CAPS} any={BROWSE_COPY.anyPrice} format={(value) => `Under ${priceCapLabel(value)}`} onChange={setMax} />
      <NumberSelect label={BROWSE_COPY.beds} value={filters.minBeds} options={BED_MINIMUMS} any={BROWSE_COPY.anyBeds} format={(value) => `${value}+ beds`} onChange={(minBeds) => set({ minBeds })} />
      {builders.length > 0 && <label className={`${LABEL} col-span-2 sm:col-span-4 xl:col-span-4`} data-deals-builder-filter="true">{BROWSE_COPY.builder}
        <select aria-label={BROWSE_COPY.builder} value={filters.builder} onChange={(event) => set({ builder: event.target.value })} className={`mt-1 ${SELECT}`}>
          <option value="">{BROWSE_COPY.anyBuilder}</option>
          {builders.map((choice) => <option key={choice.builder} value={choice.builder}>{choice.builder} ({choice.count})</option>)}
        </select>
      </label>}
    </div>
    <div className="mt-3 flex min-w-0 flex-wrap gap-2 xl:mt-0">
      {savedCount > 0 && <Toggle name="saved" on={filters.savedOnly} label={`${BROWSE_COPY.saved} (${savedCount})`} onChange={(value) => set({ savedOnly: value })} />}
      <button type="button" aria-pressed={filters.redHot} data-deals-filter="red-hot" onClick={() => set({ redHot: !filters.redHot })} className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors ${filters.redHot ? "border-red-600 bg-red-600 text-white" : "border-red-600/60 text-red-600 hover:bg-red-50"}`}><Flame className="h-4 w-4" />{BROWSE_COPY.redHot}</button>
      <Toggle name="move-in-ready" on={filters.moveInReady} label={BROWSE_COPY.moveInReady} onChange={(value) => set({ moveInReady: value })} />
      <button type="button" aria-expanded={moreOpen} data-deals-filter="more" onClick={() => setMoreOpen((value) => !value)} className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm transition-colors ${more > 0 || moreOpen ? "border-gold text-gold" : "border-border text-foreground hover:text-gold"}`}>
        <SlidersHorizontal className="h-4 w-4" />{BROWSE_COPY.more}{more > 0 && <span className="rounded-full bg-gold px-1.5 text-[11px] font-semibold text-primary-foreground">{more}</span>}<ChevronDown className={`h-4 w-4 transition-transform ${moreOpen ? "rotate-180" : ""}`} />
      </button>
      {active > 0 && <button type="button" onClick={() => onChange(EMPTY_FILTERS)} className="inline-flex min-h-11 items-center gap-1 px-2 text-xs uppercase tracking-widest text-muted-foreground hover:text-gold"><X className="h-3.5 w-3.5" />{BROWSE_COPY.clear}</button>}
    </div>
    </div>
    {moreOpen && <div data-deals-more-filters="true" className="mt-4 min-w-0 border-t border-border pt-4">
      <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <NumberSelect label={BROWSE_COPY.baths} value={filters.minBaths} options={BATH_MINIMUMS} any={BROWSE_COPY.anyBeds} format={(value) => `${value}+ baths`} onChange={(minBaths) => set({ minBaths })} />
        <NumberSelect label={BROWSE_COPY.sqft} value={filters.minSqft} options={SQFT_MINIMUMS} any={BROWSE_COPY.anyBeds} format={(value) => `${value.toLocaleString("en-US")}+ sq ft`} onChange={(minSqft) => set({ minSqft, ...(minSqft !== null && filters.maxSqft !== null && filters.maxSqft <= minSqft ? { maxSqft: null } : {}) })} />
        <NumberSelect label={BROWSE_COPY.maxSqft} value={filters.maxSqft} options={SQFT_MAXIMUMS} any={BROWSE_COPY.anyBeds} format={(value) => `Up to ${value.toLocaleString("en-US")}`} onChange={(maxSqft) => set({ maxSqft, ...(maxSqft !== null && filters.minSqft !== null && filters.minSqft >= maxSqft ? { minSqft: null } : {}) })} />
        <NumberSelect label={BROWSE_COPY.availableBy} value={filters.availableBy} options={AVAILABLE_BY} any={BROWSE_COPY.anyBeds} format={(value) => value === 0 ? BROWSE_COPY.readyNow : BROWSE_COPY.withinMonths(value)} onChange={(availableBy) => set({ availableBy })} />
        <NumberSelect label={BROWSE_COPY.garage} value={filters.minGarage} options={GARAGE_MINIMUMS} any={BROWSE_COPY.anyBeds} format={(value) => `${value}+ car`} onChange={(minGarage) => set({ minGarage })} />
        {(showStories || filters.stories !== null) && <div className={LABEL} role="group" aria-label={BROWSE_COPY.stories}>{BROWSE_COPY.stories}
          <div className="mt-1 grid min-h-11 grid-cols-3 overflow-hidden rounded-lg border border-input text-xs normal-case tracking-normal sm:text-sm">
            {([[null, BROWSE_COPY.anyStories], [1, BROWSE_COPY.oneStory], [2, BROWSE_COPY.twoStory]] as const).map(([value, label]) => <button key={label} type="button" aria-pressed={filters.stories === value} data-deals-filter={`stories-${value ?? "any"}`} onClick={() => set({ stories: value })} className={`min-w-0 px-1 ${filters.stories === value ? "bg-gold text-primary-foreground" : "bg-background text-foreground hover:text-gold"}`}>{label}</button>)}
          </div>
        </div>}
      </div>
      {districts.length > 1 && <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={LABEL} data-deals-district-filter="true">{BROWSE_COPY.schoolDistrict}
          <select aria-label={BROWSE_COPY.schoolDistrict} value={filters.schoolDistrict} onChange={(event) => set({ schoolDistrict: event.target.value })} className={`mt-1 ${SELECT}`}>
            <option value="">{BROWSE_COPY.anyDistrict}</option>
            {districts.map((choice) => <option key={choice.district} value={choice.district}>{choice.district} ({choice.count})</option>)}
          </select>
        </label>
      </div>}
      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
        <span className="mr-1 text-[11px] uppercase tracking-widest text-muted-foreground">{BROWSE_COPY.homeType}</span>
        <Toggle name="move-in-ready-more" on={filters.moveInReady} label={BROWSE_COPY.moveInReady} onChange={(value) => set({ moveInReady: value })} />
        <Toggle name="to-be-built" on={filters.toBeBuilt} label={BROWSE_COPY.toBeBuilt} onChange={(value) => set({ toBeBuilt: value })} />
        <Toggle name="builder-rate" on={filters.builderRate} label={BROWSE_COPY.builderRate} onChange={(value) => set({ builderRate: value })} />
        <Toggle name="big-lots" on={filters.bigLots} label={BROWSE_COPY.bigLots} onChange={(value) => set({ bigLots: value })} />
        <button type="button" onClick={() => setMoreOpen(false)} className="ml-auto inline-flex min-h-11 items-center rounded-full bg-gold px-5 text-sm font-semibold text-primary-foreground">{BROWSE_COPY.done}</button>
      </div>
    </div>}
    <p role="status" aria-live="polite" className="mt-3 text-xs text-muted-foreground" data-deals-browse-count="true">{active > 0 ? `${shown} of ${total} ${unit} match` : `${total} ${unit}`}</p>
  </section>;
}

/** "Show 12 more" under a long list. */
export function ShowMore({ remaining, onClick }: { remaining: number; onClick: () => void }) {
  if (remaining <= 0) return null;
  return <button type="button" onClick={onClick} data-deals-show-more="true" className="mx-auto mt-8 flex min-h-11 items-center border border-gold/45 px-6 text-xs uppercase tracking-widest text-gold hover:bg-gold/10">Show {Math.min(remaining, BROWSE_PAGE)} more of {remaining}</button>;
}
