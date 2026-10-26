import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { Link } from "wouter";
import { Flame, Play, Send, Sparkles } from "lucide-react";
import { redHotDeal } from "@shared/dealsFeatured";
import { SITE } from "@shared/site";
import { youtubeEmbedUrl, youtubeVideoId } from "@/lib/dealsVideo";

/**
 * A photo that tries again on its own: a first-time render can answer "busy" (503) while the server is working,
 * so the image waits a moment and asks twice more before giving up.
 */
export function RetryImage({ src, onGiveUp, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string; onGiveUp?: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const shown = attempt ? `${src}${src.includes("?") ? "&" : "?"}r=${attempt}` : src;
  return <img {...rest} src={shown} onError={() => { if (attempt < 2) window.setTimeout(() => setAttempt((value) => value + 1), 1500 * (attempt + 1)); else onGiveUp?.(); }} />;
}

export const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function formatPhoneInput(value: string) {
  const hasPlus = value.trim().startsWith("+");
  const digits = value.replace(/\D/g, "").slice(0, hasPlus ? 15 : 10);
  if (hasPlus) return `+${digits}`;
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function formatChicagoDate(value?: string | null) {
  if (!value) return "Update in progress";
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" }).format(new Date(value));
}

export function useInstagramEmbeds() {
  useEffect(() => {
    const selector = "script[data-deals-instagram-embed]";
    let script = document.querySelector<HTMLScriptElement>(selector);
    const process = () => window.setTimeout(() => (window as any).instgrm?.Embeds?.process?.(), 0);
    if (script) {
      script.addEventListener("load", process);
      process();
      return () => script?.removeEventListener("load", process);
    }
    script = document.createElement("script");
    script.dataset.dealsInstagramEmbed = "true";
    script.async = true;
    script.src = "https://www.instagram.com/embed.js";
    script.addEventListener("load", process, { once: true });
    document.body.appendChild(script);
    return () => undefined;
  }, []);
}

/**
 * The community's video: an Instagram reel, or a YouTube Short (youtubeVideoId).
 * On a long list only the first video loads on its own (`autoLoad`); the rest
 * show a "Watch the video tour" cover and load when tapped, so a page of every
 * community never opens dozens of embeds.
 */
export function ReelCard({ reelUrl, label, autoLoad = true, poster }: { reelUrl: string | null; label: string; autoLoad?: boolean; /** Oct 24 (Peter): with no video yet, the community's own best photo stands in (photos showing a builder's name never reach the site). */ poster?: string | null }) {
  const youtubeId = youtubeVideoId(reelUrl);
  const [fallback, setFallback] = useState(!reelUrl);
  const [started, setStarted] = useState(autoLoad);
  const [tapped, setTapped] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!reelUrl || !started || youtubeId) return;
    const process = () => (window as any).instgrm?.Embeds?.process?.();
    process();
    const timer = window.setTimeout(() => {
      // Instagram replaces/removes the blockquote after it mounts an iframe.
      // The wrapper is React-owned and survives that DOM handoff; checking the
      // removed quote would otherwise turn every successful embed into fallback.
      const embedded = wrapperRef.current?.querySelector("iframe, .instagram-media-rendered");
      setFallback((current) => current || !embedded);
    }, 5_000);
    return () => window.clearTimeout(timer);
  }, [reelUrl, started]);
  if (youtubeId && started) {
    return <div data-deals-youtube="true" className="relative mx-auto aspect-[9/16] w-full max-w-[420px] overflow-hidden bg-black"><iframe src={youtubeEmbedUrl(youtubeId, tapped)} title={`Video tour of ${label}`} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen loading="lazy" referrerPolicy="strict-origin-when-cross-origin" className="absolute inset-0 h-full w-full border-0" /></div>;
  }
  if (reelUrl && !started && !fallback) {
    return (
      <button type="button" onClick={() => { setTapped(true); setStarted(true); }} data-deals-reel-cover="true" aria-label={`Watch the video tour of ${label}`} className="deals-chrome mx-auto flex aspect-[4/5] w-full max-w-[540px] flex-col items-center justify-center bg-[radial-gradient(ellipse_at_50%_0%,oklch(0.75_0.09_85_/_0.22),transparent_60%),linear-gradient(150deg,oklch(0.2_0.01_285),oklch(0.09_0.005_285))] px-6 text-center">
        <span className="mb-4 rounded-full border border-gold/50 bg-black/30 p-5 text-gold"><Play className="h-6 w-6 fill-current" /></span>
        <span className="eyebrow text-gold">Watch the video tour</span>
        <span className="mt-3 max-w-[16rem] font-serif text-2xl leading-tight">{label}</span>
      </button>
    );
  }
  if (fallback && !reelUrl && poster) return <PosterCard poster={poster} label={label} />;
  if (fallback) {
    return (
      <a href={reelUrl ?? "#unlock"} target={reelUrl ? "_blank" : undefined} rel="noreferrer" className="deals-chrome mx-auto flex aspect-[4/5] w-full max-w-[540px] flex-col items-center justify-center bg-[radial-gradient(ellipse_at_50%_0%,oklch(0.75_0.09_85_/_0.16),transparent_60%),linear-gradient(150deg,oklch(0.2_0.01_285),oklch(0.09_0.005_285))] px-6 text-center">
        <div className="mb-4 rounded-full border border-gold/40 p-4 text-gold"><Send className="h-5 w-5" /></div>
        <span className="eyebrow text-gold">{reelUrl ? "Watch on Instagram" : "Video coming soon"}</span>
        <span className="mt-3 max-w-[16rem] font-serif text-2xl leading-tight">{label}</span>
      </a>
    );
  }
  return <div ref={wrapperRef} className="relative aspect-[4/5] overflow-hidden bg-secondary"><blockquote className="instagram-media h-full min-w-0 max-w-none bg-transparent" data-instgrm-permalink={reelUrl ?? undefined} data-instgrm-version="14" aria-label={`Instagram reel for ${label}`} /></div>;
}

/** The community's photo in the video's place, with a quiet "video tour coming soon" note; falls back to the plain card if it will not load. */
function PosterCard({ poster, label }: { poster: string; label: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <div className="deals-chrome mx-auto flex aspect-[4/5] w-full max-w-[540px] flex-col items-center justify-center bg-[linear-gradient(150deg,oklch(0.2_0.01_285),oklch(0.09_0.005_285))] px-6 text-center"><span className="eyebrow text-gold">Video coming soon</span><span className="mt-3 max-w-[16rem] font-serif text-2xl leading-tight">{label}</span></div>;
  return <div data-deals-poster="true" className="relative mx-auto aspect-[4/5] w-full max-w-[540px] overflow-hidden bg-secondary">
    <RetryImage src={poster} alt={`Photo of a home in ${label}`} loading="lazy" decoding="async" draggable={false} onGiveUp={() => setFailed(true)} onContextMenu={(event) => event.preventDefault()} className="absolute inset-0 h-full w-full select-none object-cover [-webkit-touch-callout:none]" />
    <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/55 to-transparent" />
    <span className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-black/60 px-3 py-1 text-[11px] font-medium uppercase tracking-widest text-white">Video tour coming soon</span>
  </div>;
}

export type DealsIncentive = {
  text: string;
  teaser?: string | null;
  headlineRate: string | null;
  followOnRate: string | null;
  followOnPeriod: string | null;
  apr: string | null;
  loanType: string | null;
  downPayment: string | null;
  repaymentTerms: string | null;
  contractBy: string | null;
  closeBy: string | null;
  /** A held offer: the text is the neutral "Builder incentive available" line and every figure is null. */
  pending?: boolean;
};

/** Every rate figure, its period and the APR share one size, weight and colour (Reg Z equal prominence). */
export const RATE_CLASS = "text-lg font-medium text-gold";

/**
 * The rate line as rendered: each entry is one element in RATE_CLASS, so the
 * follow-on period is never smaller or fainter than the headline figure. Empty
 * when there is no rate and no APR (a closing-cost-only promotion).
 */
export function incentiveRateLines(incentive: Pick<DealsIncentive, "headlineRate" | "followOnRate" | "followOnPeriod" | "apr">): string[] {
  if (!incentive.headlineRate && !incentive.apr) return [];
  // Reg Z: a rate is printed only beside its APR (the server leaves such a rate out; this keeps the card safe on its own).
  if (!incentive.apr) return [];
  const lines: string[] = [];
  if (incentive.headlineRate) lines.push(`${incentive.followOnPeriod ? "First year" : "Rate"}: ${incentive.headlineRate}`);
  if (incentive.followOnRate) lines.push(`${incentive.followOnPeriod ? `${incentive.followOnPeriod}: ` : ""}${incentive.followOnRate}`);
  if (incentive.apr) lines.push(`APR: ${incentive.apr}`);
  return lines;
}

export function Incentive({ incentive, compact = false }: { incentive: DealsIncentive | null | undefined; compact?: boolean }) {
  if (!incentive) return null;
  // A held offer shows its one neutral line: no figures, no financing fine print.
  if (incentive.pending) return <div data-deals-incentive-pending="true" className="border-l-2 border-gold bg-gold/5 p-4"><p className="text-sm leading-relaxed text-foreground">{incentive.text}</p></div>;
  const deadline = (date: string | null, prefix: string) => date ? `${prefix} ${formatChicagoDate(date)}` : null;
  const rates = incentiveRateLines(incentive);
  return <div className="border-l-2 border-gold bg-gold/5 p-4">
    <p className="text-sm leading-relaxed text-foreground">{compact ? (incentive.teaser ?? incentive.text) : incentive.text}</p>
    {rates.length > 0 && <div data-deals-rates="true" className="mt-3 flex flex-wrap gap-x-5 gap-y-1">{rates.map((line) => <p key={line} className={RATE_CLASS}>{line}</p>)}</div>}
    <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{[incentive.loanType, incentive.downPayment, incentive.repaymentTerms, !compact && deadline(incentive.contractBy, "Contract by"), !compact && deadline(incentive.closeBy, "Close by")].filter(Boolean).join(" · ")} · On select homes with qualifying financing through the builder's lender. Not a commitment to lend.</p>
  </div>;
}

export function DealsFooter() {
  return <footer className="deals-chrome border-t border-border/60 px-5 py-10 text-center text-[11px] leading-relaxed text-muted-foreground"><p>Prices, incentives, and availability change often and are set by the builder. Rates shown are on select homes with qualifying financing through the builder's lender. Not a commitment to lend. Verify all details with us before making decisions.</p><div className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2"><a href={SITE.iabsUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-gold">IABS</a><a href={SITE.cpnUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-gold">Consumer Protection Notice</a><Link href="/privacy" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-gold">Privacy Policy</Link><Link href="/deals/team" data-deals-agent-signin-footer="true" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-gold">Agent sign-in</Link></div><div className="mt-4 flex flex-wrap items-center justify-center gap-2 uppercase tracking-[0.16em] text-foreground/80" title="Equal Housing Opportunity"><span>Lifestyle Design Realty</span><span aria-hidden="true">·</span><svg viewBox="0 0 24 24" className="h-6 w-6 fill-current" aria-label="Equal Housing Opportunity logo"><path d="M12 2L1 10h2v11h18V10h2L12 2zm0 2.5L18.5 9h-13L12 4.5zM5 11h14v8H5v-8zm3 1.5v1.5h8v-1.5H8zm0 3v1.5h8v-1.5H8z" /></svg><span>Equal Housing Opportunity</span></div></footer>;
}

/** Keyword and text line come from admin settings through deals.state; nothing is hard-coded here. */
export type DealsContactState = { commentKeyword?: string | null; textLine?: string | null } | null | undefined;

export function BuyerTextLine({ state, verb = "Text" }: { state: DealsContactState; verb?: "Text" | "text" }) {
  const keyword = state?.commentKeyword || "HOME";
  const line = state?.textLine;
  if (!line) return null;
  const digits = String(line).replace(/\D/g, "");
  return <a href={`sms:${digits}?body=${encodeURIComponent(keyword)}`} className="text-gold underline underline-offset-4">{verb} {keyword} to {line}</a>;
}

/**
 * A reel buyer's 24 hours are up. There is no self-serve way back from here:
 * they comment again or reach out, and the team helps them find their home.
 */
export function ExpiredHelp({ state }: { state: DealsContactState }) {
  const keyword = state?.commentKeyword || "HOME";
  const line = state?.textLine;
  const digits = line ? String(line).replace(/\D/g, "") : "";
  return <div className="mt-4 space-y-4 text-sm leading-relaxed" data-deals-expired-help="true">
    <p className="text-foreground">Comment {keyword} on one of our videos again, or reach out to us so we can help you find your home.</p>
    <div className="flex flex-wrap gap-3">
      <a href="https://www.instagram.com/lifestyledesignrealtytexas/" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center border border-gold/45 px-4 text-xs uppercase tracking-widest text-gold hover:bg-gold/10">@lifestyledesignrealtytexas</a>
      {line && <a href={`tel:${digits}`} className="inline-flex min-h-11 items-center border border-border px-4 text-xs uppercase tracking-widest text-foreground hover:text-gold">Call {line}</a>}
      {line && <a href={`sms:${digits}`} className="inline-flex min-h-11 items-center border border-border px-4 text-xs uppercase tracking-widest text-foreground hover:text-gold">Text {line}</a>}
    </div>
  </div>;
}

export function InstagramHelp({ state }: { state: DealsContactState }) {
  const keyword = state?.commentKeyword || "HOME";
  return <div className="mt-5 space-y-3 text-sm leading-relaxed text-muted-foreground"><p>Comment {keyword} on any of our reels for the latest deals.</p><a href="https://www.instagram.com/lifestyledesignrealtytexas/" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center border border-gold/45 px-4 text-xs uppercase tracking-widest text-gold hover:bg-gold/10">@lifestyledesignrealtytexas</a>{state?.textLine && <p>Or <BuyerTextLine state={state} verb="text" />.</p>}</div>;
}

export const RED_HOT_COPY = { badge: "Red Hot Deal", savings: "Extreme savings", save: (amount: number) => `Save ${money.format(amount)}` } as const;

export const NEW_COPY = { badge: "New this week", count: (count: number) => count === 1 ? "1 new this week" : `${count} new this week` } as const;

/** Oct 26, 2026: the gold "New this week" badge for a home that arrived in the last seven days. */
export function NewBadge({ isNew, className = "" }: { isNew?: boolean | null; className?: string }) {
  if (!isNew) return null;
  return <span data-deals-new="true" className={`inline-flex items-center gap-1 rounded-full border border-gold bg-gold/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-gold ${className}`}><Sparkles className="h-3.5 w-3.5" />{NEW_COPY.badge}</span>;
}

/** The red "Red Hot Deal" badge (a real price drop, see redHotDeal); nothing when the home is not one. */
export function RedHotBadge({ price, previousPrice, className = "" }: { price?: number | null; previousPrice?: number | null; className?: string }) {
  if (!redHotDeal(price, previousPrice)) return null;
  return <span data-deals-red-hot="true" className={`inline-flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white shadow ${className}`}><Flame className="h-3.5 w-3.5" />{RED_HOT_COPY.badge}</span>;
}

/** The price block of a Red Hot Deal: the original price crossed out, the savings in red. Null when the home is not one. */
export function RedHotSavings({ price, previousPrice }: { price?: number | null; previousPrice?: number | null }) {
  const deal = redHotDeal(price, previousPrice);
  if (!deal) return null;
  return <span data-deals-red-hot-savings="true" className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm"><span className="text-muted-foreground line-through">{money.format(deal.was)}</span><span className="font-semibold text-red-600">{RED_HOT_COPY.savings} · {RED_HOT_COPY.save(deal.savings)}</span></span>;
}
