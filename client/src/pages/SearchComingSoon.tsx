import PageShell from "@/components/PageShell";
import { useNcClickTracking } from "@/hooks/usePageTracking";
import { SITE } from "@shared/site";
import { Link } from "wouter";
import { ArrowRight, ExternalLink, Hammer } from "lucide-react";

/**
 * Pre-IDX stand-in for every placeholder-powered search/browse/listing
 * route (/search, /portfolio, /neighborhoods, /listing/:slug). Shown while
 * FEATURES.SHOW_PROPERTY_SEARCH is off so customers never see fake homes.
 * The real Search/Portfolio/Neighborhoods code is untouched — flipping the
 * flag restores it instantly when IDX connects.
 */
export default function SearchComingSoon() {
  const logNcClick = useNcClickTracking();
  return (
    <PageShell solidNav>
      <div className="ambient-section mx-auto max-w-3xl px-5 lg:px-8 pt-32 lg:pt-44 pb-28 text-center">
        <p className="eyebrow text-gold">Home Search</p>
        <h1 className="display-serif hero-glow text-4xl md:text-6xl mt-4 leading-tight">
          Live MLS Search
          <br />
          Coming Soon
        </h1>
        <p className="mt-6 text-muted-foreground max-w-xl mx-auto leading-relaxed">
          We're connecting live MLS listings so every home you see here is real,
          current, and accurate. In the meantime, search thousands of new
          construction homes across Texas right now — with builder incentives
          negotiated by professionals who represent you, not the builder.
        </p>
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href={SITE.newConstructionUrl}
            target="_blank"
            rel="noreferrer"
            onClick={logNcClick}
            className="inline-flex items-center gap-3 bg-gold text-primary-foreground px-9 py-4 uppercase tracking-[0.2em] text-xs font-medium hover:bg-gold/90 transition-colors">
            <Hammer className="h-4 w-4" /> Search New Construction Now
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <Link
            href="/get-started"
            className="inline-flex items-center gap-3 border border-gold text-gold px-9 py-4 uppercase tracking-[0.2em] text-xs font-medium hover:bg-gold hover:text-primary-foreground transition-colors">
            Get Matched With an Agent <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <p className="mt-12 text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Want a heads-up when live search launches?{" "}
          <Link href="/get-started" className="text-gold hover:underline underline-offset-4">
            Leave your details
          </Link>
        </p>
      </div>
    </PageShell>
  );
}
