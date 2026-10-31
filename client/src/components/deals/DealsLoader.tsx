import { useEffect, useState } from "react";

/**
 * Oct 31, 2026 (Peter: "when clicking new home search it takes a second to load, should we make a cute loading page for a
 * couple seconds?"): yes, but only while the homes are actually on their way. It never adds a wait of its own: the
 * moment the list arrives it is gone (an Instagram visitor who waits for nothing leaves).
 *
 * A gold ring turns around a little house that draws itself, a serif line, and a step line that changes every moment.
 * With reduced motion the ring and the house hold still.
 */
export const DEALS_LOADER_COPY = {
  heading: "Finding this week's best builder deals",
  steps: ["Checking builder incentives…", "Lining up move-in ready homes…", "Mapping every community…"],
} as const;

export const DEALS_LOADER_STEP_MS = 1600;

/**
 * `minHeight` is set inline: index.css gives every `.flex` element `min-height: 0` outside the utility layer, which
 * beats a min-h-* class on the same element.
 */
export function DealsLoader({ heading = DEALS_LOADER_COPY.heading, className = "", minHeight }: { heading?: string; className?: string; minHeight?: string }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setStep((current) => (current + 1) % DEALS_LOADER_COPY.steps.length), DEALS_LOADER_STEP_MS);
    return () => window.clearInterval(id);
  }, []);
  return <div role="status" aria-live="polite" aria-busy="true" data-deals-loader="true" className={`flex min-w-0 flex-col items-center justify-center px-6 py-16 text-center ${className}`} style={minHeight ? { minHeight } : undefined}>
    <style>{"@keyframes ldrDraw{0%{stroke-dashoffset:64}45%,60%{stroke-dashoffset:0}100%{stroke-dashoffset:-64}}@keyframes ldrBar{0%{transform:translateX(-110%)}100%{transform:translateX(320%)}}@keyframes ldrFade{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}@media (prefers-reduced-motion: reduce){[data-deals-loader] *{animation:none!important;stroke-dashoffset:0!important}}"}</style>
    <div className="relative h-24 w-24">
      <svg viewBox="0 0 96 96" className="absolute inset-0 h-full w-full animate-spin text-gold [animation-duration:2.4s]" aria-hidden="true">
        <circle cx="48" cy="48" r="44" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2" />
        <circle cx="48" cy="48" r="44" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="70 207" />
      </svg>
      <svg viewBox="0 0 48 48" className="absolute inset-[24%] text-gold" aria-hidden="true">
        <path d="M7 22 L24 8 L41 22 M12 18.5 V39 H36 V18.5 M20.5 39 V29 H27.5 V39" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" pathLength={64} style={{ strokeDasharray: 64, animation: "ldrDraw 2.4s ease-in-out infinite" }} />
      </svg>
    </div>
    <p className="mt-6 max-w-sm font-serif text-2xl leading-tight text-foreground sm:text-3xl">{heading}</p>
    <p key={step} data-deals-loader-step="true" className="mt-2 text-sm text-muted-foreground" style={{ animation: "ldrFade 300ms ease-out" }}>{DEALS_LOADER_COPY.steps[step]}</p>
    <div className="mt-6 h-[3px] w-48 overflow-hidden rounded-full bg-gold/15" aria-hidden="true"><span className="block h-full w-1/3 rounded-full bg-gold" style={{ animation: "ldrBar 1.4s ease-in-out infinite" }} /></div>
  </div>;
}
