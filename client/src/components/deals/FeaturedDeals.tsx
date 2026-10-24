import { useRef } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, LockKeyhole, Percent, Trees, Trophy } from "lucide-react";
import { formatRate, type FeaturedDeal, type FeaturedDeals as FeaturedDealsData } from "@shared/dealsFeatured";
import { RED_HOT_COPY, RedHotSavings, RetryImage, money } from "./shared";
import { redHotDeal } from "@shared/dealsFeatured";

export type { FeaturedDealsData };

export const FEATURED_COPY = {
  eyebrow: "Best deals right now",
  heading: "Ranked by estimated monthly payment",
  lowest: "Lowest payment",
  bestRate: "Best builder rate",
  bigLots: "Big lots",
  see: "See this home",
  unlock: "Schedule a tour",
  perMonth: "/mo est.",
  updated: "Updated every time the builders' sites are checked.",
} as const;

/** "at 4.999% (5.737% APR) FHA, 3.5% down" or "at the 7.4% market rate, 5% down" (a buydown names its first-year rate too). */
export function rateLine(deal: Pick<FeaturedDeal, "rate" | "downPercent">): string {
  const down = `${Number(deal.downPercent.toFixed(2))}% down`;
  if (!deal.rate.builderOffer) return `at the ${formatRate(deal.rate.ratePercent)} market rate, ${down}`;
  const firstYear = deal.rate.firstYearRatePercent !== null ? `${formatRate(deal.rate.firstYearRatePercent)} first year, then ` : "";
  // A builder rate is printed only with its APR (Reg Z); one known to have none prints no figure.
  if (deal.rate.aprPercent === null) return `with the builder's financing, ${down}`;
  const apr = typeof deal.rate.aprPercent === "number" ? ` (${formatRate(deal.rate.aprPercent)} APR)` : "";
  return `at ${firstYear}${formatRate(deal.rate.ratePercent)}${apr}${deal.rate.loanType ? ` ${deal.rate.loanType}` : ""}, ${down}`;
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
  return <li className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
    <button type="button" onClick={() => onSelect?.(deal)} className="block w-full min-w-0 text-left" data-deals-featured={deal.reason} aria-label={`${action}: ${deal.label}, ${money.format(deal.estMonthly)} a month estimated`}>
      {deal.photo && <RetryImage src={deal.photo} alt="" loading="lazy" decoding="async" draggable={false} onContextMenu={(event) => event.preventDefault()} data-deals-featured-photo="true" className="block aspect-[4/3] w-full min-w-0 select-none object-cover [-webkit-touch-callout:none]" />}
      <span className="flex w-full min-w-0 items-start gap-4 p-4">
        {rank !== undefined && <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gold/50 font-serif text-lg text-gold">{rank}</span>}
        <span className="min-w-0 flex-1">
          {tags.length > 0 && <span className="mb-2 flex flex-wrap gap-1.5">{tags.map((tag) => <span key={tag} data-deals-featured-tag={tag} className="rounded-full bg-gold px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-widest text-primary-foreground">{tag}</span>)}</span>}
          <span className="block text-3xl font-semibold leading-none text-foreground">{money.format(deal.estMonthly)}<span className="ml-1 text-xs font-normal uppercase tracking-widest text-muted-foreground">{FEATURED_COPY.perMonth}</span></span>
          <span className="mt-2 block break-words text-base leading-snug text-foreground">{deal.label}</span>
          {deal.detail && <span className="mt-1 block break-words text-sm text-foreground/80" data-deals-featured-detail="true">{deal.detail}</span>}
          <span className="mt-1 block text-sm text-muted-foreground">{homeLine(deal)}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{rateLine(deal)}{deal.acres ? ` · ${Number(deal.acres.toFixed(2))} acre lot` : ""}</span>
          <span className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-gold">{locked && <LockKeyhole className="h-3.5 w-3.5" />}{action}{!locked && <ArrowRight className="h-3.5 w-3.5" />}</span>
        </span>
      </span>
    </button>
  </li>;
}

export const FEATURED_ASSUMPTIONS = (termYears: number) => `Estimated monthly mortgage payment on a ${termYears}-year loan: principal and interest, plus mortgage insurance when the loan carries it. Property taxes, home insurance and HOA dues are not included; they vary by home and by your homestead exemption. Builder rates apply to select homes with the builder's lender and qualifying credit. Not a commitment to lend. ${FEATURED_COPY.updated}`;

/** Every featured home once, in order (lowest payments, the best rate, big lots), with the reasons it is featured. */
export function featuredInOrder(featured: FeaturedDealsData): Array<{ deal: FeaturedDeal; tags: string[] }> {
  const out: Array<{ deal: FeaturedDeal; tags: string[] }> = [];
  const add = (deal: FeaturedDeal, tag: string) => {
    const found = out.find((item) => dealKey(item.deal) === dealKey(deal));
    if (found) { if (!found.tags.includes(tag)) found.tags.push(tag); } else out.push({ deal, tags: [tag] });
  };
  featured.lowestPayment.forEach((deal, index) => add(deal, `#${index + 1} ${FEATURED_COPY.lowest}`));
  if (featured.bestRate) add(featured.bestRate, FEATURED_COPY.bestRate);
  featured.bigLots.forEach((deal) => add(deal, FEATURED_COPY.bigLots.replace(/s$/, "")));
  return out;
}

/**
 * The landing page's featured row (October 24, 2026, Peter): one compact, swipeable row across the top of the list, so
 * the search bar and the map are on screen before anyone scrolls. Tapping a home opens the gate.
 */
export function FeaturedStrip({ featured, onSelect }: { featured: FeaturedDealsData | null | undefined; onSelect?: (deal: FeaturedDeal) => void }) {
  const row = useRef<HTMLOListElement>(null);
  if (!featured) return null;
  const items = featuredInOrder(featured);
  if (!items.length) return null;
  const scroll = (direction: 1 | -1) => row.current?.scrollBy({ left: direction * Math.max(240, (row.current?.clientWidth ?? 600) * 0.8), behavior: "smooth" });
  return <section aria-labelledby="deals-featured-heading" data-deals-featured-section="true" data-deals-featured-strip="true" className="min-w-0">
    <div className="flex min-w-0 items-end justify-between gap-3">
      <div className="min-w-0">
        <p className="eyebrow text-gold">{FEATURED_COPY.eyebrow}</p>
        <h2 id="deals-featured-heading" className="mt-1 text-xl leading-tight sm:text-2xl">{FEATURED_COPY.heading}</h2>
      </div>
      <div className="hidden shrink-0 gap-2 sm:flex">
        <button type="button" onClick={() => scroll(-1)} aria-label="Previous featured homes" className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-sm hover:border-gold"><ChevronLeft className="h-5 w-5" /></button>
        <button type="button" onClick={() => scroll(1)} aria-label="More featured homes" className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-sm hover:border-gold"><ChevronRight className="h-5 w-5" /></button>
      </div>
    </div>
    <ol ref={row} className="mt-3 flex min-w-0 snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]">
      {items.map(({ deal, tags }, index) => <li key={`${dealKey(deal)}-${index}`} className="w-[78%] max-w-[270px] shrink-0 snap-start overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md sm:w-[250px]">
        <button type="button" onClick={() => onSelect?.(deal)} className="block h-full w-full min-w-0 text-left" data-deals-featured={deal.reason} aria-label={`${FEATURED_COPY.unlock}: ${deal.label}, ${money.format(deal.estMonthly)} a month estimated`}>
          <span className="relative block aspect-[16/10] w-full overflow-hidden bg-secondary">
            {deal.photo && <RetryImage src={deal.photo} alt="" loading="lazy" decoding="async" draggable={false} onContextMenu={(event) => event.preventDefault()} data-deals-featured-photo="true" className="block h-full w-full select-none object-cover [-webkit-touch-callout:none]" />}
            <span className="pointer-events-none absolute left-2 top-2 flex flex-wrap gap-1">{redHotDeal(deal.price, deal.previousPrice) && <span data-deals-featured-tag="red-hot" className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow">{RED_HOT_COPY.badge}</span>}{tags.map((tag) => <span key={tag} data-deals-featured-tag={tag} className="rounded-full bg-gold px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground shadow">{tag}</span>)}</span>
          </span>
          <span className="block min-w-0 p-3">
            <span className="block text-2xl font-semibold leading-none text-foreground">{money.format(deal.estMonthly)}<span className="ml-1 text-[10px] font-normal uppercase tracking-widest text-muted-foreground">{FEATURED_COPY.perMonth}</span></span>
            <span className="mt-1.5 block truncate text-sm text-foreground">{deal.label}</span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{homeLine(deal)}</span>
            <RedHotSavings price={deal.price} previousPrice={deal.previousPrice} />
            <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{rateLine(deal)}{deal.acres ? ` · ${Number(deal.acres.toFixed(2))} acre lot` : ""}</span>
            <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-widest text-gold"><LockKeyhole className="h-3 w-3" />{FEATURED_COPY.unlock}</span>
          </span>
        </button>
      </li>)}
    </ol>
    <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground" data-deals-featured-assumptions="true">{FEATURED_ASSUMPTIONS(featured.assumptions.termYears)}</p>
  </section>;
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
    <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground" data-deals-featured-assumptions="true">{FEATURED_ASSUMPTIONS(assumptions.termYears)}</p>
  </section>;
}
