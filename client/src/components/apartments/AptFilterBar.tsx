import { HeartHandshake } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NEEDS, type AptFilters } from "@/lib/apartments";

const FIELD = "h-11 w-full border border-border bg-card px-3 text-sm text-foreground";

/**
 * Search boxes shared by the renter page and the locators' workspace. The second-chance row is first and filled in
 * gold on purpose (Nov 17, 2026, Peter: "that's something that should stand out ... so we can get all the leads").
 */
export function AptFilterBar({ filters, onChange, cities, locator = false }: { filters: AptFilters; onChange: (next: AptFilters) => void; cities: string[]; locator?: boolean }) {
  const set = (patch: Partial<AptFilters>) => onChange({ ...filters, ...patch });
  const anyNeed = NEEDS.some((need) => filters.needs[need.key]) || filters.secondChanceOnly;
  return <div className="space-y-4" data-apt-filters={locator ? "locator" : "renter"}>
    <section aria-labelledby="apt-second-chance" className={`border p-4 sm:p-5 ${anyNeed ? "border-gold bg-gold/10" : "border-gold/50 bg-gold/5"}`} data-apt-second-chance="true">
      <div className="flex items-start gap-3">
        <HeartHandshake className="mt-0.5 h-6 w-6 shrink-0 text-gold" aria-hidden="true" />
        <div className="min-w-0">
          <h2 id="apt-second-chance" className="font-serif text-xl leading-tight">{locator ? "Second-chance clients" : "Need a second chance? We have places for you."}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{locator ? "Turn on what the client needs. Only communities that said yes or case by case are shown." : "Broken lease, eviction, something on your record, or a tight budget. Tap what applies and we only show apartments that work with it."}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {NEEDS.map((need) => {
          const on = Boolean(filters.needs[need.key]);
          return <button key={need.key} type="button" aria-pressed={on} onClick={() => set({ needs: { ...filters.needs, [need.key]: !on } })} className={`min-h-11 border px-4 text-sm font-medium transition-colors ${on ? "border-gold bg-gold text-primary-foreground" : "border-gold/60 bg-card text-foreground hover:bg-gold/10"}`} data-apt-need={need.key}>{need.label}{on ? " ✓" : ""}</button>;
        })}
        <button type="button" aria-pressed={filters.secondChanceOnly} onClick={() => set({ secondChanceOnly: !filters.secondChanceOnly })} className={`min-h-11 border px-4 text-sm font-medium transition-colors ${filters.secondChanceOnly ? "border-gold bg-gold text-primary-foreground" : "border-gold/60 bg-card text-foreground hover:bg-gold/10"}`} data-apt-need="secondChanceOnly">Any second chance{filters.secondChanceOnly ? " ✓" : ""}</button>
      </div>
    </section>

    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <label className="block text-xs uppercase tracking-widest text-muted-foreground">City
        <select className={`${FIELD} mt-1 normal-case tracking-normal`} value={filters.city} onChange={(event) => set({ city: event.target.value })}>
          <option value="">Any city</option>
          {cities.map((city) => <option key={city} value={city}>{city}</option>)}
        </select>
      </label>
      <label className="block text-xs uppercase tracking-widest text-muted-foreground">Bedrooms
        <select className={`${FIELD} mt-1 normal-case tracking-normal`} value={filters.beds} onChange={(event) => set({ beds: event.target.value })}>
          <option value="">Any</option><option value="0">Studio</option><option value="1">1 bedroom</option><option value="2">2 bedrooms</option><option value="3">3 bedrooms</option><option value="4">4 bedrooms</option>
        </select>
      </label>
      <label className="block text-xs uppercase tracking-widest text-muted-foreground">Max rent
        <Input inputMode="numeric" placeholder="$1,500" value={filters.maxRent} onChange={(event) => set({ maxRent: event.target.value.replace(/[^\d$,]/g, "").slice(0, 8) })} className={`${FIELD} mt-1 rounded-none normal-case tracking-normal`} />
      </label>
      <label className="block text-xs uppercase tracking-widest text-muted-foreground">Move in by
        <Input type="date" value={filters.moveBy} onChange={(event) => set({ moveBy: event.target.value })} className={`${FIELD} mt-1 rounded-none normal-case tracking-normal`} />
      </label>
    </div>
    {locator && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[#946f2e]" checked={filters.paysOnly} onChange={(event) => set({ paysOnly: event.target.checked })} />Only communities with a commission on file</label>}
  </div>;
}

/** The badges that tell a renter (or a locator) what a community works with. Second chance comes first and is filled. */
export function AptBadges({ item }: { item: { secondChance: boolean; acceptsBrokenLease: boolean; acceptsEviction: boolean; acceptsFelony: boolean; incomeRestricted: boolean; incomeMultiple: number | null } }) {
  const tags = [item.acceptsBrokenLease && "Broken lease OK", item.acceptsEviction && "Eviction OK", item.acceptsFelony && "Background considered", item.incomeRestricted && "Income-based rent", item.incomeMultiple != null && `Income ${item.incomeMultiple}x rent`].filter((tag): tag is string => Boolean(tag));
  if (!item.secondChance && !tags.length) return null;
  return <div className="flex flex-wrap gap-1.5" data-apt-badges="true">
    {item.secondChance && <span className="bg-gold px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground">Second chance</span>}
    {tags.map((tag) => <span key={tag} className="border border-gold/60 px-2 py-1 text-[11px] text-foreground">{tag}</span>)}
  </div>;
}
