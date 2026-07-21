import { Link } from "wouter";
import { SITE } from "@shared/site";

/**
 * TREC-compliant global footer. Present on EVERY page:
 * - IABS + Consumer Protection Notice labeled links
 * - Equal Housing Opportunity logo
 * - Site-wide disclaimer
 * - Brokerage address & phone
 */
export default function SiteFooter() {
  return (
    <footer className="bg-[oklch(0.11_0.005_285)] border-t border-border/60 text-foreground">
      <div className="mx-auto max-w-[1400px] px-5 lg:px-8 py-14 lg:py-20">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
          {/* Brand */}
          <div className="lg:col-span-1">
            <div className="font-serif text-xl tracking-[0.14em]">
              LIFESTYLE DESIGN <span className="text-gold">REALTY</span>
            </div>
            <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
              Central Texas real estate professionals serving San Antonio, New Braunfels, Austin,
              DFW, Houston, and surrounding areas.
            </p>
            <div className="mt-5 flex gap-4">
              <a href={SITE.instagram} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-gold text-xs uppercase tracking-widest">Instagram</a>
              <a href={SITE.facebook} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-gold text-xs uppercase tracking-widest">Facebook</a>
            </div>
          </div>

          {/* Explore */}
          <div>
            <h3 className="eyebrow text-gold mb-4">Explore</h3>
            <ul className="space-y-2.5 text-sm">
              <li><Link href="/portfolio" className="text-muted-foreground hover:text-gold">Portfolio</Link></li>
              <li><Link href="/search" className="text-muted-foreground hover:text-gold">Home Search</Link></li>
              <li><Link href="/neighborhoods" className="text-muted-foreground hover:text-gold">Neighborhoods</Link></li>
              <li><Link href="/city-finder" className="text-muted-foreground hover:text-gold">Find Your Texas City</Link></li>
              <li><Link href="/valuation" className="text-muted-foreground hover:text-gold">Home Valuation</Link></li>
              <li><Link href="/sell" className="text-muted-foreground hover:text-gold">Sell With Us</Link></li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <h3 className="eyebrow text-gold mb-4">Company</h3>
            <ul className="space-y-2.5 text-sm">
              <li><Link href="/team" className="text-muted-foreground hover:text-gold">Meet the Team</Link></li>
              <li><Link href="/testimonials" className="text-muted-foreground hover:text-gold">Testimonials</Link></li>
              <li><Link href="/contact" className="text-muted-foreground hover:text-gold">Schedule a Consultation</Link></li>
              <li><Link href="/join" className="text-gold hover:text-gold/80">Now Hiring — Join Our Team</Link></li>
              <li><Link href="/links" className="text-muted-foreground hover:text-gold">Links</Link></li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="eyebrow text-gold mb-4">Contact</h3>
            <ul className="space-y-2.5 text-sm text-muted-foreground">
              <li><a href={SITE.phoneHref} className="hover:text-gold">{SITE.phone}</a></li>
              <li><a href={`mailto:${SITE.email}`} className="hover:text-gold break-all">{SITE.email}</a></li>
              <li className="leading-relaxed">1209 S Saint Marys St #232<br />San Antonio, TX 78210</li>
            </ul>
          </div>
        </div>

        <div className="hairline my-10" />

        {/* TREC compliance block */}
        <div className="space-y-4 text-xs text-muted-foreground leading-relaxed">
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:gap-6">
            <a
              href={SITE.iabsUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4 hover:text-gold">
              Texas Real Estate Commission Information About Brokerage Services
            </a>
            <a
              href={SITE.cpnUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4 hover:text-gold">
              Texas Real Estate Commission Consumer Protection Notice
            </a>
          </div>
          <p>{SITE.disclaimer}</p>
          <div className="flex items-center justify-between flex-wrap gap-4 pt-2">
            <p>© {new Date().getFullYear()} Lifestyle Design Realty. All rights reserved.</p>
            {/* Equal Housing Opportunity */}
            <div className="flex items-center gap-2" title="Equal Housing Opportunity">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current" aria-label="Equal Housing Opportunity logo">
                <path d="M12 2L1 10h2v11h18V10h2L12 2zm0 2.5L18.5 9h-13L12 4.5zM5 11h14v8H5v-8zm3 1.5v1.5h8v-1.5H8zm0 3v1.5h8v-1.5H8z" />
              </svg>
              <span className="uppercase tracking-widest text-[10px]">Equal Housing Opportunity</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
