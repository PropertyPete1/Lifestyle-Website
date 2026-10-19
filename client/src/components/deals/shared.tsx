import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Send } from "lucide-react";
import { SITE } from "@shared/site";

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

export function ReelCard({ reelUrl, label }: { reelUrl: string | null; label: string }) {
  const [fallback, setFallback] = useState(!reelUrl);
  const wrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!reelUrl) return;
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
  }, [reelUrl]);
  if (fallback) {
    return (
      <a href={reelUrl ?? "#unlock"} target={reelUrl ? "_blank" : undefined} rel="noreferrer" className="flex aspect-[4/5] w-full flex-col items-center justify-center bg-[radial-gradient(ellipse_at_50%_0%,oklch(0.75_0.09_85_/_0.16),transparent_60%),linear-gradient(150deg,oklch(0.2_0.01_285),oklch(0.09_0.005_285))] px-6 text-center">
        <div className="mb-4 rounded-full border border-gold/40 p-4 text-gold"><Send className="h-5 w-5" /></div>
        <span className="eyebrow text-gold">{reelUrl ? "Watch on Instagram" : "Video coming soon"}</span>
        <span className="mt-3 max-w-[16rem] font-serif text-2xl leading-tight">{label}</span>
      </a>
    );
  }
  return <div ref={wrapperRef} className="relative aspect-[4/5] overflow-hidden bg-secondary"><blockquote className="instagram-media h-full min-w-0 max-w-none bg-transparent" data-instgrm-permalink={reelUrl ?? undefined} data-instgrm-version="14" aria-label={`Instagram reel for ${label}`} /></div>;
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
  const lines: string[] = [];
  if (incentive.headlineRate) lines.push(`${incentive.followOnPeriod ? "First year" : "Rate"}: ${incentive.headlineRate}`);
  if (incentive.followOnRate) lines.push(`${incentive.followOnPeriod ? `${incentive.followOnPeriod}: ` : ""}${incentive.followOnRate}`);
  if (incentive.apr) lines.push(`APR: ${incentive.apr}`);
  return lines;
}

export function Incentive({ incentive, compact = false }: { incentive: DealsIncentive | null | undefined; compact?: boolean }) {
  if (!incentive) return null;
  const deadline = (date: string | null, prefix: string) => date ? `${prefix} ${formatChicagoDate(date)}` : null;
  const rates = incentiveRateLines(incentive);
  return <div className="border-l-2 border-gold bg-gold/5 p-4">
    <p className="text-sm leading-relaxed text-foreground">{compact ? (incentive.teaser ?? incentive.text) : incentive.text}</p>
    {rates.length > 0 && <div data-deals-rates="true" className="mt-3 flex flex-wrap gap-x-5 gap-y-1">{rates.map((line) => <p key={line} className={RATE_CLASS}>{line}</p>)}</div>}
    <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{[incentive.loanType, incentive.downPayment, incentive.repaymentTerms, !compact && deadline(incentive.contractBy, "Contract by"), !compact && deadline(incentive.closeBy, "Close by")].filter(Boolean).join(" · ")} · On select homes with qualifying financing through the builder's lender. Not a commitment to lend.</p>
  </div>;
}

export function DealsFooter() {
  return <footer className="border-t border-border/60 px-5 py-10 text-center text-[11px] leading-relaxed text-muted-foreground"><p>Prices, incentives, and availability change often and are set by the builder. Rates shown are on select homes with qualifying financing through the builder's lender. Not a commitment to lend. Verify all details with us before making decisions.</p><div className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2"><a href={SITE.iabsUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-gold">IABS</a><a href={SITE.cpnUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-gold">Consumer Protection Notice</a><Link href="/privacy" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-gold">Privacy Policy</Link></div><div className="mt-4 flex flex-wrap items-center justify-center gap-2 uppercase tracking-[0.16em] text-foreground/80" title="Equal Housing Opportunity"><span>Lifestyle Design Realty</span><span aria-hidden="true">·</span><svg viewBox="0 0 24 24" className="h-6 w-6 fill-current" aria-label="Equal Housing Opportunity logo"><path d="M12 2L1 10h2v11h18V10h2L12 2zm0 2.5L18.5 9h-13L12 4.5zM5 11h14v8H5v-8zm3 1.5v1.5h8v-1.5H8zm0 3v1.5h8v-1.5H8z" /></svg><span>Equal Housing Opportunity</span></div></footer>;
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

export function InstagramHelp({ state }: { state: DealsContactState }) {
  const keyword = state?.commentKeyword || "HOME";
  return <div className="mt-5 space-y-3 text-sm leading-relaxed text-muted-foreground"><p>Comment {keyword} on any of our reels for the latest deals.</p><a href="https://www.instagram.com/lifestyledesignrealtytexas/" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center border border-gold/45 px-4 text-xs uppercase tracking-widest text-gold hover:bg-gold/10">@lifestyledesignrealtytexas</a>{state?.textLine && <p>Or <BuyerTextLine state={state} verb="text" />.</p>}</div>;
}
