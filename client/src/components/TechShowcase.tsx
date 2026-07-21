import { Link } from "wouter";
import { ArrowRight } from "lucide-react";

/**
 * Compact visual showcase of real platform capabilities. Show, don't tell:
 * each card animates its icon subtly and links to the live feature.
 * No "high-tech"/"cutting-edge" claims anywhere — the interaction IS the proof.
 */
const CAPABILITIES = [
  {
    title: "AI-Matched Property Search",
    line: "Describe the home in plain English — watch it become criteria.",
    href: "/search",
    cta: "Try a search",
    icon: (
      <svg viewBox="0 0 48 48" fill="none" className="h-12 w-12 text-gold" aria-hidden>
        {/* Magnifier that "scans" — pulsing rings */}
        <circle cx="21" cy="21" r="10" stroke="currentColor" strokeWidth="1.5" />
        <line x1="29" y1="29" x2="38" y2="38" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="21" cy="21" r="15" stroke="currentColor" strokeWidth="0.75" opacity="0.35" className="tech-ping" />
        <circle cx="21" cy="21" r="4" fill="currentColor" opacity="0.25" className="tech-pulse" />
      </svg>
    ),
  },
  {
    title: "Personalized City Matching",
    line: "Six questions. Five markets. Your ranked Texas city report.",
    href: "/city-finder",
    cta: "Find your city",
    icon: (
      <svg viewBox="0 0 48 48" fill="none" className="h-12 w-12 text-gold" aria-hidden>
        {/* Map pin dropping with radiating base */}
        <path
          d="M24 8c-6 0-10.5 4.6-10.5 10.3C13.5 25.5 24 37 24 37s10.5-11.5 10.5-18.7C34.5 12.6 30 8 24 8Z"
          stroke="currentColor"
          strokeWidth="1.5"
          className="tech-float"
        />
        <circle cx="24" cy="18" r="3.5" fill="currentColor" opacity="0.4" className="tech-pulse" />
        <ellipse cx="24" cy="40" rx="8" ry="1.6" fill="currentColor" opacity="0.25" className="tech-ping" />
      </svg>
    ),
  },
  {
    title: "Instant Market Insights",
    line: "Live valuations and neighborhood data, the moment you ask.",
    href: "/valuation",
    cta: "Value my home",
    icon: (
      <svg viewBox="0 0 48 48" fill="none" className="h-12 w-12 text-gold" aria-hidden>
        {/* Rising chart bars that grow */}
        <line x1="8" y1="40" x2="40" y2="40" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
        <rect x="12" y="26" width="5" height="14" fill="currentColor" opacity="0.35" className="tech-bar tech-bar-1" />
        <rect x="21.5" y="19" width="5" height="21" fill="currentColor" opacity="0.55" className="tech-bar tech-bar-2" />
        <rect x="31" y="11" width="5" height="29" fill="currentColor" opacity="0.8" className="tech-bar tech-bar-3" />
        <path d="M12 22L23 14L31 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" className="tech-draw" />
        <circle cx="31" cy="8" r="2" fill="currentColor" className="tech-pulse" />
      </svg>
    ),
  },
];

export default function TechShowcase() {
  return (
    <section className="border-b border-border/60 bg-[oklch(0.165_0.005_285)]">
      <div className="mx-auto max-w-[1400px] px-5 lg:px-8 py-20 lg:py-24">
        <div className="text-center mb-14 reveal">
          <p className="eyebrow text-gold">Built Into This Site</p>
          <h2 className="display-serif text-3xl md:text-5xl mt-3">Tools That Work While You Browse</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
          {CAPABILITIES.map((c, i) => (
            <Link
              key={c.title}
              href={c.href}
              className="lux-lift group border border-border bg-card p-8 lg:p-10 flex flex-col items-start reveal"
              style={{ transitionDelay: `${i * 80}ms` }}>
              <div className="tech-icon">{c.icon}</div>
              <h3 className="font-serif text-2xl mt-6">{c.title}</h3>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{c.line}</p>
              <span className="mt-6 inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-gold opacity-70 group-hover:opacity-100 transition-opacity">
                {c.cta} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
