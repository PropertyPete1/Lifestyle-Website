import { useRef } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, LockKeyhole, Percent, Trees, Trophy } from "lucide-react";
import { formatRate, type FeaturedDeal, type FeaturedDeals as FeaturedDealsData, type PaymentCosts } from "@shared/dealsFeatured";
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
  unlock: "Get the details",
  details: "See details",
  perMonth: "/mo est.",
  updated: "Updated every time the builders' sites are checked.",
} as const;

const thousands = (value: number) => `$${Math.round(value / 1000)}K`;
/** "Best deals · $300K to $400K" when the whole row is drawn from that price range (Peter, Oct 30), else the plain heading. */
export function featuredEyebrow(featured: Pick<FeaturedDealsData, "priceRange">): string {
  return featured.priceRange ? `Best deals · ${thousands(featured.priceRange.min)} to ${thousands(featured.priceRange.max)}` : FEATURED_COPY.eyebrow;
}

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
      {deal.photo && <RetryImage src={deal.photo} alt="" loading="lazy" decoding="async" draggable={false} onContextMenu={(event) => event.preventDefault()} data-deals-featured-photo="true" className="block aspect-[4/3] w-full min-w-0 select-none bg-secondary object-cover [-webkit-touch-callout:none]" />}
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

/** "3%" / "1.25%": a settings percent without trailing zeros. */
const pct = (value: number) => `${Number(value.toFixed(3))}%`;
/**
 * Oct 30, 2026 (Peter: the payments were too low): what every monthly figure on the page includes, in plain words.
 * Insurance and HOA are the admin's estimates (printed here), never a quote. Property tax is left out (Peter, later
 * Oct 30: "just remove the property taxes entirely") and never mentioned (Peter, 10:40 PM: "No mention at all"); the
 * text still says the actual payment will be higher, so the estimate is never presented as the whole payment.
 */
export const FEATURED_ASSUMPTIONS = (termYears: number, costs?: PaymentCosts) => `Estimated monthly payment on a ${termYears}-year loan at the builder's rate: principal and interest, mortgage insurance when the loan carries it, and estimated home insurance${costs ? ` (${pct(costs.insuranceRatePercent)} of the price a year)` : ""} and HOA dues${costs ? ` (${money.format(costs.hoaMonthly)} a month)` : ""}. Your actual payment will be higher. Insurance and HOA are estimates, not quotes. Builder rates apply to select homes with the builder's lender and qualifying credit. Not a commitment to lend. ${FEATURED_COPY.updated}`;

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
export function FeaturedStrip({ featured, onSelect, onHover, opens = false, compact = false }: {
  featured: FeaturedDealsData | null | undefined;
  onSelect?: (deal: FeaturedDeal) => void;
  /** Lights the home's area on the map while the pointer is on it (null when it leaves). */
  onHover?: (deal: FeaturedDeal | null) => void;
  /** Tapping opens the home's details (its community's sheet) rather than the gate. */
  opens?: boolean;
  /**
   * Oct 30, 2026 (design F, homes near the top): small side-by-side cards, about a third of the height. The photo is
   * landscape (3:2), close to the photos' own shape: a square cut the sides off a wide home (Peter, the big-lot card).
   */
  compact?: boolean;
}) {
  const row = useRef<HTMLOListElement>(null);
  if (!featured) return null;
  const items = featuredInOrder(featured);
  if (!items.length) return null;
  if (compact) return <section aria-labelledby="deals-featured-heading" data-deals-featured-section="true" data-deals-featured-strip="compact" className="min-w-0">
    <h2 id="deals-featured-heading" className="eyebrow text-gold">{featuredEyebrow(featured)}</h2>
    <ol ref={row} className="-mx-4 mt-3 flex min-w-0 snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:px-0">
      {items.map(({ deal, tags }, index) => <li key={`${dealKey(deal)}-${index}`} className="w-[88%] max-w-[330px] shrink-0 snap-start">
        <button type="button" onClick={() => onSelect?.(deal)} onMouseEnter={() => onHover?.(deal)} onMouseLeave={() => onHover?.(null)} onFocus={() => onHover?.(deal)} onBlur={() => onHover?.(null)} data-deals-featured={deal.reason} aria-label={`${opens ? FEATURED_COPY.details : FEATURED_COPY.unlock}: ${deal.area}, ${money.format(deal.estMonthly)} a month estimated`} className="flex h-full w-full min-w-0 items-stretch gap-3 rounded-2xl border border-border bg-card p-2 text-left shadow-[0_1px_2px_rgb(0_0_0/0.04)] hover:border-gold/60">
          <span className="relative block aspect-[3/2] w-28 shrink-0 self-center overflow-hidden rounded-xl bg-secondary" data-deals-featured-thumb="true">{deal.photo && <RetryImage src={deal.photo} alt="" loading="lazy" decoding="async" draggable={false} onContextMenu={(event) => event.preventDefault()} data-deals-featured-photo="true" className="block h-full w-full select-none object-cover [-webkit-touch-callout:none]" />}</span>
          <span className="flex min-w-0 flex-1 flex-col justify-center py-1 pr-1">
            <span className="truncate text-[10px] font-semibold uppercase tracking-widest text-gold">{redHotDeal(deal.price, deal.previousPrice) ? RED_HOT_COPY.badge : tags[0] ?? FEATURED_COPY.lowest}</span>
            <span className="mt-0.5 block font-serif text-2xl font-semibold leading-none text-foreground lining-nums">{money.format(deal.estMonthly)}<span className="ml-1 font-sans text-[11px] font-normal text-muted-foreground">/mo est.</span></span>
            <span className="mt-1 block truncate text-sm text-foreground">{deal.area}</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{rateLine(deal)}</span>
          </span>
        </button>
      </li>)}
    </ol>
    <details className="mt-1 text-[11px] leading-relaxed text-muted-foreground" data-deals-featured-assumptions="true"><summary className="inline-flex min-h-11 cursor-pointer items-center underline-offset-4 hover:underline">How monthly payments are estimated</summary><p className="pb-2">{FEATURED_ASSUMPTIONS(featured.assumptions.termYears, featured.assumptions.costs)}</p></details>
  </section>;
  const scroll = (direction: 1 | -1) => row.current?.scrollBy({ left: direction * Math.max(240, (row.current?.clientWidth ?? 600) * 0.8), behavior: "smooth" });
  return <section aria-labelledby="deals-featured-heading" data-deals-featured-section="true" data-deals-featured-strip="true" className="min-w-0">
    <div className="flex min-w-0 items-end justify-between gap-3">
      <div className="min-w-0">
        <p className="eyebrow text-gold">{featuredEyebrow(featured)}</p>
        <h2 id="deals-featured-heading" className="mt-1 text-xl leading-tight sm:text-2xl">{FEATURED_COPY.heading}</h2>
      </div>
      <div className="hidden shrink-0 gap-2 sm:flex">
        <button type="button" onClick={() => scroll(-1)} aria-label="Previous featured homes" className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-sm hover:border-gold"><ChevronLeft className="h-5 w-5" /></button>
        <button type="button" onClick={() => scroll(1)} aria-label="More featured homes" className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-sm hover:border-gold"><ChevronRight className="h-5 w-5" /></button>
      </div>
    </div>
    <ol ref={row} className="mt-3 flex min-w-0 snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]">
      {items.map(({ deal, tags }, index) => <li key={`${dealKey(deal)}-${index}`} className="w-[78%] max-w-[270px] shrink-0 snap-start overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md sm:w-[250px]">
        <button type="button" onClick={() => onSelect?.(deal)} onMouseEnter={() => onHover?.(deal)} onMouseLeave={() => onHover?.(null)} onFocus={() => onHover?.(deal)} onBlur={() => onHover?.(null)} className="block h-full w-full min-w-0 text-left" data-deals-featured={deal.reason} aria-label={`${opens ? FEATURED_COPY.details : FEATURED_COPY.unlock}: ${deal.label}, ${money.format(deal.estMonthly)} a month estimated`}>
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
            <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-widest text-gold">{opens ? <>{FEATURED_COPY.details}<ArrowRight className="h-3 w-3" /></> : <><LockKeyhole className="h-3 w-3" />{FEATURED_COPY.unlock}</>}</span>
          </span>
        </button>
      </li>)}
    </ol>
    <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground" data-deals-featured-assumptions="true">{FEATURED_ASSUMPTIONS(featured.assumptions.termYears, featured.assumptions.costs)}</p>
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
    <p className="eyebrow text-gold">{featuredEyebrow(featured)}</p>
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
    <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground" data-deals-featured-assumptions="true">{FEATURED_ASSUMPTIONS(assumptions.termYears, assumptions.costs)}</p>
  </section>;
}
