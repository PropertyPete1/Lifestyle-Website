import { ArrowRight, LockKeyhole, Percent, Trees, Trophy } from "lucide-react";
import { formatRate, type FeaturedDeal, type FeaturedDeals as FeaturedDealsData } from "@shared/dealsFeatured";
import { money } from "./shared";

export type { FeaturedDealsData };

export const FEATURED_COPY = {
  eyebrow: "Best deals right now",
  heading: "Ranked by estimated monthly payment",
  lowest: "Lowest payment",
  bestRate: "Best builder rate",
  bigLots: "Big lots",
  see: "See this home",
  unlock: "Unlock to see it",
  perMonth: "/mo est.",
  updated: "Updated every time the builders' sites are checked.",
} as const;

/** "at 4.999% FHA, 3.5% down" or "at the 7.4% market rate, 5% down" (a buydown names its first-year rate too). */
export function rateLine(deal: Pick<FeaturedDeal, "rate" | "downPercent">): string {
  const down = `${Number(deal.downPercent.toFixed(2))}% down`;
  if (!deal.rate.builderOffer) return `at the ${formatRate(deal.rate.ratePercent)} market rate, ${down}`;
  const firstYear = deal.rate.firstYearRatePercent !== null ? `${formatRate(deal.rate.firstYearRatePercent)} first year, then ` : "";
  return `at ${firstYear}${formatRate(deal.rate.ratePercent)}${deal.rate.loanType ? ` ${deal.rate.loanType}` : ""}, ${down}`;
}

function homeLine(deal: FeaturedDeal): string {
  return [deal.priceLabel || money.format(deal.price), deal.beds ? `${deal.beds} beds` : null, deal.sqftLabel ?? (deal.sqft ? `${deal.sqft.toLocaleString()} sq ft` : null), deal.kind === "to_be_built" ? "to be built" : null].filter(Boolean).join(" · ");
}

/** The same home can win several ways; it is shown once, with a tag for each extra win. */
export function dealKey(deal: Pick<FeaturedDeal, "key" | "card" | "label" | "price">): string {
  return deal.key ?? deal.card ?? `${deal.label}|${deal.price}`;
}

function DealRow({ deal, rank, locked, onSelect, tags = [] }: { deal: FeaturedDeal; rank?: number; locked: boolean; onSelect?: (deal: FeaturedDeal) => void; tags?: string[] }) {
  const action = locked ? FEATURED_COPY.unlock : FEATURED_COPY.see;
  return <li className="min-w-0 border border-border bg-card">
    <button type="button" onClick={() => onSelect?.(deal)} className="flex w-full min-w-0 items-start gap-4 p-4 text-left transition-colors hover:bg-gold/5" data-deals-featured={deal.reason} aria-label={`${action}: ${deal.label}, ${money.format(deal.estMonthly)} a month estimated`}>
      {rank !== undefined && <span className="flex h-9 w-9 shrink-0 items-center justify-center border border-gold/50 font-serif text-lg text-gold">{rank}</span>}
      <span className="min-w-0 flex-1">
        {tags.length > 0 && <span className="mb-2 flex flex-wrap gap-1.5">{tags.map((tag) => <span key={tag} data-deals-featured-tag={tag} className="bg-gold px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest text-primary-foreground">{tag}</span>)}</span>}
        <span className="block font-serif text-3xl leading-none text-gold">{money.format(deal.estMonthly)}<span className="ml-1 font-sans text-xs uppercase tracking-widest text-muted-foreground">{FEATURED_COPY.perMonth}</span></span>
        <span className="mt-2 block break-words text-base leading-snug text-foreground">{deal.label}</span>
        {deal.detail && <span className="mt-1 block break-words text-sm text-foreground/80" data-deals-featured-detail="true">{deal.detail}</span>}
        <span className="mt-1 block text-sm text-muted-foreground">{homeLine(deal)}</span>
        <span className="mt-1 block text-xs text-muted-foreground">{rateLine(deal)}{deal.acres ? ` · ${Number(deal.acres.toFixed(2))} acre lot` : ""}</span>
        <span className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-xs uppercase tracking-widest text-gold">{locked && <LockKeyhole className="h-3.5 w-3.5" />}{action}{!locked && <ArrowRight className="h-3.5 w-3.5" />}</span>
      </span>
    </button>
  </li>;
}

/**
 * The featured strip on the landing page (locked: tapping opens the gate) and
 * at the top of the private list (tapping jumps to the home's card).
 */
export function FeaturedDeals({ featured, locked = false, onSelect }: { featured: FeaturedDealsData | null | undefined; locked?: boolean; onSelect?: (deal: FeaturedDeal) => void }) {
  if (!featured || (!featured.lowestPayment.length && !featured.bestRate && !featured.bigLots.length)) return null;
  const { assumptions } = featured;
  // A home already in the top three carries its other wins as tags instead of appearing again.
  const shown = new Set(featured.lowestPayment.map(dealKey));
  const tagsFor = (deal: FeaturedDeal) => [
    ...(featured.bestRate && dealKey(featured.bestRate) === dealKey(deal) ? [FEATURED_COPY.bestRate] : []),
    ...(featured.bigLots.some((lot) => dealKey(lot) === dealKey(deal)) ? [FEATURED_COPY.bigLots.replace(/s$/, "")] : []),
  ];
  const bestRate = featured.bestRate && !shown.has(dealKey(featured.bestRate)) ? featured.bestRate : null;
  const bigLots = featured.bigLots.filter((deal) => !shown.has(dealKey(deal)) && !(bestRate && dealKey(bestRate) === dealKey(deal)));
  return <section aria-labelledby="deals-featured-heading" data-deals-featured-section="true" className="mt-10 min-w-0">
    <p className="eyebrow text-gold">{FEATURED_COPY.eyebrow}</p>
    <h2 id="deals-featured-heading" className="mt-2 text-3xl leading-tight sm:text-4xl">{FEATURED_COPY.heading}</h2>
    {featured.lowestPayment.length > 0 && <>
      <p className="mt-6 flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground"><Trophy className="h-4 w-4 text-gold" />{FEATURED_COPY.lowest}</p>
      <ol className="mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-3">{featured.lowestPayment.map((deal, index) => <DealRow key={`${deal.card ?? deal.label}-${index}`} deal={deal} rank={index + 1} locked={locked} onSelect={onSelect} tags={tagsFor(deal)} />)}</ol>
    </>}
    <div className="mt-6 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-2">
      {bestRate && <div className="min-w-0">
        <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground"><Percent className="h-4 w-4 text-gold" />{FEATURED_COPY.bestRate}</p>
        <ul className="mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3"><DealRow deal={bestRate} locked={locked} onSelect={onSelect} tags={tagsFor(bestRate).filter((tag) => tag !== FEATURED_COPY.bestRate)} /></ul>
      </div>}
      {bigLots.length > 0 && <div className="min-w-0">
        <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground"><Trees className="h-4 w-4 text-gold" />{FEATURED_COPY.bigLots}</p>
        <ul className="mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">{bigLots.map((deal, index) => <DealRow key={`${deal.card ?? deal.label}-lot-${index}`} deal={deal} locked={locked} onSelect={onSelect} />)}</ul>
      </div>}
    </div>
    <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground" data-deals-featured-assumptions="true">Estimated principal and interest on a {assumptions.termYears}-year loan. Builder rates apply to select homes with the builder's lender and qualifying credit; homes without a builder rate use the {formatRate(assumptions.marketRatePercent)} market rate and {Number(assumptions.defaultDownPercent.toFixed(2))}% down. Taxes, insurance and HOA are extra. Not a commitment to lend. {FEATURED_COPY.updated}</p>
  </section>;
}
