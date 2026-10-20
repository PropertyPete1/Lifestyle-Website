import { SlidersHorizontal, X } from "lucide-react";
import { BED_MINIMUMS, BROWSE_PAGE, EMPTY_FILTERS, PRICE_CAPS, activeFilterCount, areaChoices, priceCapLabel, type BrowseFilters } from "@/lib/dealsBrowse";

export const BROWSE_COPY = {
  heading: "Find your community",
  area: "Area",
  anyArea: "All areas",
  price: "Max price",
  anyPrice: "Any price",
  beds: "Bedrooms",
  anyBeds: "Any",
  moveInReady: "Quick move-in",
  builderRate: "Builder rate offer",
  bigLots: "Half-acre+ lots",
  saved: "Saved",
  noneSaved: "None of your saved homes match these filters. Clear a filter to see them all.",
  clear: "Clear filters",
  none: "No communities match these filters yet. Try fewer filters, or ask us: new homes are added every day.",
} as const;

const SELECT = "min-h-11 w-full min-w-0 max-w-full border border-input bg-background px-3 text-sm";

function Toggle({ on, label, onChange, name }: { on: boolean; label: string; onChange: (value: boolean) => void; name: string }) {
  return <button type="button" aria-pressed={on} data-deals-filter={name} onClick={() => onChange(!on)} className={`inline-flex min-h-11 items-center border px-3 text-[11px] uppercase tracking-wide transition-colors ${on ? "border-gold bg-gold/10 text-gold" : "border-border text-muted-foreground hover:text-gold"}`}>{label}</button>;
}

/**
 * Filters for a list of every community in the area. The landing page has no
 * bedroom counts (`showBeds` off); the private list filters homes by them.
 */
export function BrowseBar({ filters, onChange, areas, shown, total, unit, showBeds = false, savedCount = 0 }: {
  filters: BrowseFilters;
  onChange: (filters: BrowseFilters) => void;
  areas: ReadonlyArray<{ area: string }>;
  shown: number;
  total: number;
  /** "communities" or "homes", for the count line. */
  unit: string;
  showBeds?: boolean;
  /** Private list only: how many homes the buyer has saved (the "Saved" toggle shows when there are any). */
  savedCount?: number;
}) {
  const choices = areaChoices(areas);
  const active = activeFilterCount(filters);
  const set = (patch: Partial<BrowseFilters>) => onChange({ ...filters, ...patch });
  return <section aria-label={BROWSE_COPY.heading} data-deals-browse="true" className="mt-10 min-w-0 border border-border bg-card/60 p-4 sm:p-5">
    <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-gold"><SlidersHorizontal className="h-4 w-4" />{BROWSE_COPY.heading}</p>
    <div className={`mt-3 grid min-w-0 grid-cols-2 gap-3 ${showBeds ? "sm:grid-cols-3" : ""}`}>
      <label className={`min-w-0 text-[11px] uppercase tracking-widest text-muted-foreground ${showBeds ? "col-span-2 sm:col-span-1" : ""}`}>{BROWSE_COPY.area}
        <select aria-label={BROWSE_COPY.area} value={filters.area} onChange={(event) => set({ area: event.target.value })} className={`mt-1 ${SELECT}`}>
          <option value="">{BROWSE_COPY.anyArea}</option>
          {choices.map((choice) => <option key={choice.area} value={choice.area}>{choice.area} ({choice.count})</option>)}
        </select>
      </label>
      <label className="min-w-0 text-[11px] uppercase tracking-widest text-muted-foreground">{BROWSE_COPY.price}
        <select aria-label={BROWSE_COPY.price} value={filters.maxPrice ?? ""} onChange={(event) => set({ maxPrice: event.target.value ? Number(event.target.value) : null })} className={`mt-1 ${SELECT}`}>
          <option value="">{BROWSE_COPY.anyPrice}</option>
          {PRICE_CAPS.map((cap) => <option key={cap} value={cap}>Under {priceCapLabel(cap)}</option>)}
        </select>
      </label>
      {showBeds && <label className="min-w-0 text-[11px] uppercase tracking-widest text-muted-foreground">{BROWSE_COPY.beds}
        <select aria-label={BROWSE_COPY.beds} value={filters.minBeds ?? ""} onChange={(event) => set({ minBeds: event.target.value ? Number(event.target.value) : null })} className={`mt-1 ${SELECT}`}>
          <option value="">{BROWSE_COPY.anyBeds}</option>
          {BED_MINIMUMS.map((beds) => <option key={beds} value={beds}>{beds}+ beds</option>)}
        </select>
      </label>}
    </div>
    <div className="mt-3 flex min-w-0 flex-wrap gap-2">
      {savedCount > 0 && <Toggle name="saved" on={filters.savedOnly} label={`${BROWSE_COPY.saved} (${savedCount})`} onChange={(value) => set({ savedOnly: value })} />}
      <Toggle name="move-in-ready" on={filters.moveInReady} label={BROWSE_COPY.moveInReady} onChange={(value) => set({ moveInReady: value })} />
      <Toggle name="builder-rate" on={filters.builderRate} label={BROWSE_COPY.builderRate} onChange={(value) => set({ builderRate: value })} />
      <Toggle name="big-lots" on={filters.bigLots} label={BROWSE_COPY.bigLots} onChange={(value) => set({ bigLots: value })} />
      {active > 0 && <button type="button" onClick={() => onChange(EMPTY_FILTERS)} className="inline-flex min-h-11 items-center gap-1 px-2 text-xs uppercase tracking-widest text-muted-foreground hover:text-gold"><X className="h-3.5 w-3.5" />{BROWSE_COPY.clear}</button>}
    </div>
    <p role="status" aria-live="polite" className="mt-3 text-xs text-muted-foreground" data-deals-browse-count="true">{active > 0 ? `${shown} of ${total} ${unit} match` : `${total} ${unit}`}</p>
  </section>;
}

/** "Show 12 more" under a long list. */
export function ShowMore({ remaining, onClick }: { remaining: number; onClick: () => void }) {
  if (remaining <= 0) return null;
  return <button type="button" onClick={onClick} data-deals-show-more="true" className="mx-auto mt-8 flex min-h-11 items-center border border-gold/45 px-6 text-xs uppercase tracking-widest text-gold hover:bg-gold/10">Show {Math.min(remaining, BROWSE_PAGE)} more of {remaining}</button>;
}
