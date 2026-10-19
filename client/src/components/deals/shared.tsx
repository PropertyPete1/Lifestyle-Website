import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Send } from "lucide-react";

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

export function Incentive({ incentive, compact = false }: { incentive: DealsIncentive | null | undefined; compact?: boolean }) {
  if (!incentive) return null;
  const deadline = (date: string | null, prefix: string) => date ? `${prefix} ${formatChicagoDate(date)}` : null;
  return <div className="border-l-2 border-gold bg-gold/5 p-4">
    <p className="text-sm leading-relaxed text-foreground">{compact ? (incentive.teaser ?? incentive.text) : incentive.text}</p>
    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
      <div><p className="text-lg font-medium text-gold">{incentive.headlineRate}</p><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{incentive.followOnPeriod ? "First year" : "Rate"}</p></div>
      {incentive.followOnRate && <div><p className="text-lg font-medium text-gold">{incentive.followOnRate}</p><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{incentive.followOnPeriod}</p></div>}
      <div><p className="text-lg font-medium text-gold">{incentive.apr}</p><p className="text-[10px] uppercase tracking-wider text-muted-foreground">APR</p></div>
    </div>
    <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{[incentive.loanType, incentive.downPayment, incentive.repaymentTerms, !compact && deadline(incentive.contractBy, "Contract by"), !compact && deadline(incentive.closeBy, "Close by")].filter(Boolean).join(" · ")} · On select homes with qualifying financing through the builder's lender. Not a commitment to lend.</p>
  </div>;
}

export function DealsFooter() {
  return <footer className="border-t border-border/60 px-5 py-10 text-center text-[11px] leading-relaxed text-muted-foreground"><p>Prices, incentives, and availability change often and are set by the builder. Rates shown are on select homes with qualifying financing through the builder's lender. Not a commitment to lend. Verify all details with us before making decisions.</p><div className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2"><a href="https://drive.google.com/file/d/1DTDRFjzJJS_iD8aaNu8l4Wr3YmmR9zHe/view" target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-gold">IABS</a><a href="https://www.trec.texas.gov/forms/consumer-protection-notice" target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-gold">Consumer Protection Notice</a><Link href="/privacy" className="underline underline-offset-4 hover:text-gold">Privacy Policy</Link></div><p className="mt-5 uppercase tracking-[0.16em] text-foreground/80">Lifestyle Design Realty · Equal Housing Opportunity</p></footer>;
}

/** Keyword and text line come from admin settings through deals.state; nothing is hard-coded here. */
export type DealsContactState = { commentKeyword?: string | null; textLine?: string | null } | null | undefined;

export function BuyerTextLine({ state }: { state: DealsContactState }) {
  const keyword = state?.commentKeyword || "HOME";
  const line = state?.textLine;
  if (!line) return null;
  const digits = String(line).replace(/\D/g, "");
  return <a href={`sms:${digits}?body=${encodeURIComponent(keyword)}`} className="text-gold underline underline-offset-4">Text {keyword} to {line}</a>;
}

export function InstagramHelp({ state }: { state: DealsContactState }) {
  const keyword = state?.commentKeyword || "HOME";
  return <div className="mt-5 space-y-3 text-sm leading-relaxed text-muted-foreground"><p>Comment {keyword} on any of our reels for the latest deals.</p><a href="https://www.instagram.com/lifestyledesignrealtytexas/" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center border border-gold/45 px-4 text-xs uppercase tracking-widest text-gold hover:bg-gold/10">@lifestyledesignrealtytexas</a>{state?.textLine && <p>Or <BuyerTextLine state={state} />.</p>}</div>;
}
