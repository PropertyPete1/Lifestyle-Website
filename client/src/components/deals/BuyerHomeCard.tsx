import { useId, useState, type ReactNode } from "react";
import { ArrowDown, Bath, BedDouble, ChevronDown, Flame, Heart, Home, LockKeyhole } from "lucide-react";
import { formatRate, homePaymentEstimate, type HomePaymentEstimate, type PaymentAssumptions } from "@shared/dealsFeatured";
import { redHotDeal } from "@shared/dealsFeatured";
import { NewBadge, RetryImage, money } from "./shared";

/**
 * Oct 30, 2026 (Peter picked design "F / Warm Ivory"): the public homes list. One card per
 * home: its photo, the area (never a builder, community or street), the price, the specs, the estimated monthly total
 * at the builder's rate with its breakdown, and "Schedule a tour".
 */
export const BUYER_CARD_COPY = {
  perMonth: "/mo est.",
  breakdown: "Payment breakdown",
  hideBreakdown: "Hide breakdown",
  tour: "Schedule a tour",
  /** Oct 30, 2026 (ChatGPT's review, Peter: yes): the public card asks for the details, an easier yes than a tour. */
  details: "Get this home's details",
  toBeBuilt: "To be built",
  moveIn: (date: string) => `Move-in ${date}`,
  noPhoto: "Photo coming soon",
  priceOnRequest: "Price on request",
  noRate: "No builder rate posted",
  total: "Est. monthly payment",
  principalAndInterest: "Principal & interest",
  mortgageInsurance: "Mortgage insurance",
  homeInsurance: "Home insurance (est.)",
  hoa: "HOA dues (est.)",
  /** Oct 30, 2026 (Peter: "Don't tell them we are excluding property taxes... No mention at all"): no tax wording; the
   * number is still never presented as the whole payment. */
  estimateNote: "Estimate only. Your actual payment will be higher.",
} as const;

const beds = (value: string | number) => `${value} bed${String(value) === "1" ? "" : "s"}`;
const baths = (value: string | number) => `${value} bath${String(value) === "1" ? "" : "s"}`;

/** "5.99% (6.21% APR) Conventional, 30-yr, 5% down": the terms the estimate was figured on (Reg Z: the APR rides with the rate). */
export function estimateTerms(estimate: Pick<HomePaymentEstimate, "ratePercent" | "firstYearRatePercent" | "aprPercent" | "loanType" | "termYears" | "downPercent">): string {
  const firstYear = estimate.firstYearRatePercent !== null ? `${formatRate(estimate.firstYearRatePercent)} first year, then ` : "";
  return `${firstYear}${formatRate(estimate.ratePercent)} (${formatRate(estimate.aprPercent)} APR)${estimate.loanType ? ` ${estimate.loanType}` : ""}, ${estimate.termYears}-yr, ${Number(estimate.downPercent.toFixed(2))}% down`;
}

/** The estimate, part by part, with what each part assumes. Every figure here comes from homePaymentEstimate. */
export function PaymentBreakdown({ estimate, price, id }: { estimate: HomePaymentEstimate; price: number; id?: string }) {
  const { parts, costs } = estimate;
  const pct = (value: number) => `${Number(value.toFixed(3))}%`;
  const rows: Array<[string, number, string | null]> = [
    [BUYER_CARD_COPY.principalAndInterest, parts.principalAndInterest, `${money.format(parts.loanAmount)} loan at ${formatRate(estimate.ratePercent)}`],
    ...(parts.mortgageInsurance > 0 ? [[BUYER_CARD_COPY.mortgageInsurance, parts.mortgageInsurance, `${pct(costs.mortgageInsuranceRatePercent)} of the loan a year`] as [string, number, string]] : []),
    [BUYER_CARD_COPY.homeInsurance, parts.homeInsurance, `${pct(costs.insuranceRatePercent)} of the price a year`],
    [BUYER_CARD_COPY.hoa, parts.hoa, "typical for the area"],
  ];
  return <div id={id} data-deals-payment-breakdown="true" className="mt-4 rounded-xl border border-border bg-background px-4 py-3 text-sm">
    <dl className="divide-y divide-border">
      {rows.map(([label, amount, note]) => <div key={label} className="flex min-w-0 items-baseline justify-between gap-3 py-2">
        <dt className="min-w-0"><span className="text-foreground">{label}</span>{note && <span className="block text-xs text-muted-foreground">{note}</span>}</dt>
        <dd className="shrink-0 tabular-nums text-foreground">{money.format(amount)}</dd>
      </div>)}
      <div className="flex items-baseline justify-between gap-3 pt-3 font-semibold"><dt>{BUYER_CARD_COPY.total}</dt><dd className="tabular-nums">{money.format(parts.total)}</dd></div>
    </dl>
    {/* Oct 30, 2026 (Peter: "just remove the property taxes entirely", then "no mention at all"): no tax row or tax wording. */}
    <p data-deals-estimate-note="true" className="mt-3 text-sm text-foreground">{BUYER_CARD_COPY.estimateNote}</p>
    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Figured on the {money.format(price)} price at the builder&apos;s rate: {estimateTerms(estimate)} ({money.format(parts.downAmount)} down).{estimate.firstYearRatePercent !== null ? " The first-year rate is temporary; the payment shown uses the rate after it." : ""} Insurance and HOA are estimates, not quotes, and vary by home. Builder rates apply to select homes with the builder&apos;s lender and qualifying credit. Not a commitment to lend.</p>
  </div>;
}

export type BuyerCardHome = {
  card: string;
  kind: string;
  beds?: string | number | null;
  baths?: string | number | null;
  sqft?: number | null;
  price?: number | null;
  previousPrice?: number | null;
  moveInDate?: string | null;
  isNew?: boolean;
  photos?: string[];
};

export type BuyerCardIncentive = Parameters<typeof homePaymentEstimate>[1];

export function BuyerHomeCard({ home, area, incentive, assumptions, photoPending = false, onOpen, onTour, gallery, featured = false, saved, onSave, title, subtitle, photoBadge, corner, status: statusOverride, openLabel, tourLabel }: {
  home: BuyerCardHome;
  /** The public area label ("East San Antonio"); never a community or builder name. */
  area: string;
  incentive: BuyerCardIncentive;
  assumptions: PaymentAssumptions | null | undefined;
  photoPending?: boolean;
  onOpen?: () => void;
  /** Public cards: the primary action's words ("Get this home's details"); it is then a filled gold button. */
  tourLabel?: string;
  /** "Schedule a tour" under the card; none on the team's own list. */
  onTour?: () => void;
  /** In a community's sheet: the home's photo gallery in place of the one tappable photo. */
  gallery?: ReactNode;
  /** The home a featured card opened (gold ring). */
  featured?: boolean;
  /** Oct 30, 2026 (Peter: like New Home Buddy, a visitor saves homes without signing up): the heart. */
  saved?: boolean;
  onSave?: () => void;
  /**
   * Oct 30, 2026 (Peter: the team view and the buyer's private list get the same design): the card's own heading (a
   * street address or plan on the full list; the area by default), the line under it (community and builder, or the
   * city), a badge on the photo (the builder's name, team only), and a button in the photo's corner (Pick) instead of
   * the heart.
   */
  title?: string;
  subtitle?: string | null;
  photoBadge?: ReactNode;
  corner?: ReactNode;
  /** The status after the price ("Move-in ready", "Ready Dec 2026", "Build new"); worked out from the home by default. */
  status?: string | null;
  /** The photo button's label for screen readers. */
  openLabel?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const breakdownId = useId();
  const photo = !failed ? home.photos?.[0] : undefined;
  const estimate = homePaymentEstimate(home.price, incentive, assumptions);
  const drop = home.previousPrice && home.price && home.previousPrice > home.price ? home.previousPrice - home.price : 0;
  const hot = redHotDeal(home.price ?? null, home.previousPrice ?? null);
  const price = home.price ? money.format(home.price) : BUYER_CARD_COPY.priceOnRequest;
  const specs = [
    home.beds ? { icon: BedDouble, text: beds(home.beds) } : null,
    home.baths ? { icon: Bath, text: baths(home.baths) } : null,
    home.sqft ? { icon: Home, text: `${home.sqft.toLocaleString("en-US")} sq ft` } : null,
  ].filter((item): item is { icon: typeof Bath; text: string } => Boolean(item));
  const status = statusOverride !== undefined ? statusOverride : home.kind === "to_be_built" ? BUYER_CARD_COPY.toBeBuilt : home.moveInDate ? BUYER_CARD_COPY.moveIn(home.moveInDate) : null;
  const heading = title ?? area;
  const startingFrom = home.kind === "to_be_built" && home.price ? "Starting from " : "";
  return <article data-deals-buyer-card="true" data-deals-featured-home={featured ? "true" : undefined} className={`@container relative min-w-0 rounded-2xl border bg-card p-3 shadow-[0_1px_2px_rgb(0_0_0/0.04)] sm:p-4 ${featured ? "border-gold ring-2 ring-gold/50" : "border-border"}`}>
    {gallery ? <div className="overflow-hidden rounded-xl [&>*]:mt-0">{gallery}</div> : <button type="button" onClick={onOpen} className="block w-full min-w-0 overflow-hidden rounded-xl text-left" aria-label={openLabel ?? `Home in ${area}, ${price}. See photos and details`}>
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-secondary">
        {photo ? <RetryImage src={photo} alt="" loading="lazy" decoding="async" draggable={false} onGiveUp={() => setFailed(true)} onContextMenu={(event) => event.preventDefault()} className="block h-full w-full select-none object-cover [-webkit-touch-callout:none]" />
          : photoPending ? <div className="h-full w-full animate-pulse bg-foreground/[0.06]" aria-hidden="true" />
          : <div className="flex h-full w-full items-center justify-center text-xs uppercase tracking-widest text-muted-foreground">{BUYER_CARD_COPY.noPhoto}</div>}
        <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5">
          {drop > 0 && <span data-deals-tile-drop={hot ? "red-hot" : "drop"} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white shadow ${hot ? "bg-red-600" : "bg-emerald-700"}`}>{hot ? <Flame className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{money.format(drop)} off</span>}
          <NewBadge isNew={home.isNew} className="bg-white/95" />
        </div>
        {photoBadge}
      </div>
    </button>}
    {corner ? <div className="absolute right-5 top-5 z-10 sm:right-6 sm:top-6">{corner}</div> : onSave && <button type="button" aria-pressed={Boolean(saved)} aria-label={saved ? "Saved. Tap to unsave" : "Save this home"} onClick={onSave} data-deals-save={saved ? "saved" : "unsaved"} className="absolute right-5 top-5 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/95 shadow sm:right-6 sm:top-6"><Heart className={`h-5 w-5 ${saved ? "fill-red-600 text-red-600" : "text-foreground"}`} /></button>}
    <div className="px-1 pt-4 sm:px-2">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] items-start gap-2 @[21rem]:grid-cols-[minmax(0,1fr)_auto] @[21rem]:gap-3">
        <div className="min-w-0">
          <h3 className="line-clamp-2 break-words font-serif text-[1.5rem] font-semibold leading-[1.1] text-foreground sm:text-[1.65rem]">{heading}</h3>
          {subtitle && <p className="mt-0.5 truncate text-sm text-foreground/80" title={subtitle}>{subtitle}</p>}
          <p className="mt-0.5 text-sm text-muted-foreground"><span className={estimate ? "" : "sr-only"}>{startingFrom}{price}</span>{status && <span>{estimate ? " · " : ""}{status}</span>}</p>
        </div>
        {estimate
          ? <div className="@[21rem]:border-l @[21rem]:border-gold/40 @[21rem]:pl-3 @[21rem]:text-right sm:@[21rem]:pl-4">
              <p className="whitespace-nowrap font-serif text-[2rem] font-semibold leading-none text-foreground lining-nums">{money.format(estimate.parts.total)}<span className="ml-1 font-sans text-xs font-normal text-muted-foreground">{BUYER_CARD_COPY.perMonth}</span></p>
              <button type="button" aria-expanded={open} aria-controls={breakdownId} onClick={() => setOpen((value) => !value)} data-deals-breakdown-toggle="true" className="mt-1 inline-flex min-h-11 items-center gap-1 text-xs font-medium text-gold underline-offset-4 hover:underline">{open ? BUYER_CARD_COPY.hideBreakdown : BUYER_CARD_COPY.breakdown}<ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} /></button>
            </div>
          : <div className="@[21rem]:text-right">{startingFrom && <p className="text-xs text-muted-foreground">Starting from</p>}<p className="whitespace-nowrap font-serif text-[1.75rem] font-semibold leading-none text-foreground lining-nums">{price}</p></div>}
      </div>
      {specs.length > 0 && <ul className="mt-2 flex min-w-0 flex-wrap items-center gap-y-1 text-sm text-foreground/80" aria-label="Home size">
        {specs.map(({ icon: Icon, text }, index) => <li key={text} className={`inline-flex items-center gap-1.5 ${index ? "ml-3 border-l border-border pl-3" : ""}`}><Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{text}</li>)}
      </ul>}
      {estimate && open && home.price ? <PaymentBreakdown estimate={estimate} price={home.price} id={breakdownId} /> : null}
      {onTour && <button type="button" onClick={onTour} data-deals-card-tour="true" className={tourLabel ? "mt-4 flex min-h-12 w-full items-center justify-center rounded-xl bg-gold px-4 font-serif text-xl font-semibold text-primary-foreground transition-colors hover:bg-gold/90" : "mt-4 flex min-h-12 w-full items-center justify-center rounded-xl border border-gold bg-card px-4 font-serif text-xl font-semibold text-foreground transition-colors hover:bg-gold hover:text-primary-foreground"}>{tourLabel ?? BUYER_CARD_COPY.tour}</button>}
    </div>
  </article>;
}

export const LOCKED_COPY = {
  title: "Address, builder and community",
  body: "One of our agents reaches out and sends you these, so you're represented from your very first visit.",
} as const;

/**
 * Oct 30, 2026 (Peter: "never give them any builder information till one of our agents reaches out and sends them a
 * link manually through the agent portal"): what the sheet keeps back, said plainly, with the tour button under it.
 * The bars are a drawn placeholder, never the real (or a scrambled) address.
 */
export function LockedDetails() {
  return <div data-deals-locked="true" className="mt-6 rounded-xl border border-dashed border-gold/60 bg-gold/5 p-4">
    <p className="flex items-center gap-2 font-serif text-xl font-semibold"><LockKeyhole className="h-4 w-4 text-gold" aria-hidden="true" />{LOCKED_COPY.title}</p>
    <div aria-hidden="true" className="mt-3 space-y-2"><span className="block h-3 w-3/4 rounded-full bg-foreground/10" /><span className="block h-3 w-1/2 rounded-full bg-foreground/10" /></div>
    <p className="mt-3 text-sm text-muted-foreground">{LOCKED_COPY.body}</p>
  </div>;
}
