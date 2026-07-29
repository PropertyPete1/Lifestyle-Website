import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { SITE, isLinkVisible } from "@shared/site";
import { Instagram, Facebook, Youtube, Linkedin, ArrowUpRight } from "lucide-react";
import {
  useNcClickTracking,
  useLeaseClickTracking,
  useLinksFormTracking,
} from "@/hooks/usePageTracking";
import NowHiringBanner from "@/components/NowHiringBanner";
import WebsiteInquiryModal from "@/components/WebsiteInquiryModal";
import LeadForm from "@/components/LeadForm";

/** TikTok mark (lucide has no TikTok icon) — stroke-styled to match. */
function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden>
      <path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" />
    </svg>
  );
}

/**
 * /links — link-in-bio page replacing Linktree. Mobile-first, on-brand.
 * Standalone layout (no nav) but keeps TREC links at the bottom.
 * Top: the same Now Hiring banner as the homepage (fixed; content is padded
 * below it via --hiring-banner-h). Bottom: quick lead-capture form, full
 * social row (admin-editable extra slots), and the LDT credit line.
 */
export default function Links() {
  const { data: links } = trpc.links.list.useQuery();
  const { data: socials } = trpc.settings.socials.useQuery();
  const logNcClick = useNcClickTracking();
  const logLeaseClick = useLeaseClickTracking();
  const logFormSubmit = useLinksFormTracking();
  const [inquiryOpen, setInquiryOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center px-5 pb-12 pt-[calc(var(--hiring-banner-h,44px)+2.5rem)]">
      {/* Same recruiting banner as the homepage — /links is almost entirely
          mobile bio traffic, so this is prime recruiting real estate. */}
      <NowHiringBanner />
      <div className="w-full max-w-md flex flex-col items-center text-center">
        {/* Profile header */}
        <div className="h-20 w-20 rounded-full border border-gold/60 flex items-center justify-center">
          <span className="font-serif text-2xl text-gold">LDR</span>
        </div>
        <h1 className="font-serif text-2xl tracking-[0.12em] mt-5">
          LIFESTYLE DESIGN <span className="text-gold">REALTY</span>
        </h1>
        <p className="eyebrow text-muted-foreground mt-2">Central Texas Real Estate Professionals</p>

        {/* Links */}
        <div className="w-full mt-10 space-y-3">
          {/* Bio links are admin-managed data, so a paused route (e.g. the
              seeded "Home Search" → /search) can still be present in the DB.
              Filter here so no customer is sent to a coming-soon dead end. */}
          {(links ?? []).filter((l) => isLinkVisible(l.url)).map((l) => {
            const isInternal = l.url.startsWith("/");
            const cls =
              "group lux-lift flex items-center justify-between w-full border border-border bg-card px-6 py-4 text-xs uppercase tracking-[0.2em] hover:border-gold hover:text-gold transition-colors";
            return isInternal ? (
              <Link key={l.id} href={l.url} className={cls}>
                {l.label}
                <ArrowUpRight className="h-4 w-4 opacity-40 group-hover:opacity-100" />
              </Link>
            ) : (
              <a
                key={l.id}
                href={l.url}
                target="_blank"
                rel="noreferrer"
                className={cls}
                onClick={l.url === SITE.newConstructionUrl ? logNcClick : undefined}>
                {l.label}
                <ArrowUpRight className="h-4 w-4 opacity-40 group-hover:opacity-100" />
              </a>
            );
          })}
          {/* Landlord path for Instagram traffic — tracked like the hero CTA. */}
          <Link
            href="/lease"
            onClick={logLeaseClick}
            className="group lux-lift flex items-center justify-between w-full border border-border bg-card px-6 py-4 text-xs uppercase tracking-[0.2em] hover:border-gold hover:text-gold transition-colors">
            Own a Rental? List It With Us
            <ArrowUpRight className="h-4 w-4 opacity-40 group-hover:opacity-100" />
          </Link>
          {/* Final button: full-site escape hatch */}
          <Link
            href="/"
            className="group lux-lift flex items-center justify-between w-full border border-border bg-card px-6 py-4 text-xs uppercase tracking-[0.2em] hover:border-gold hover:text-gold transition-colors">
            Explore Our Full Website
            <ArrowUpRight className="h-4 w-4 opacity-40 group-hover:opacity-100" />
          </Link>
        </div>

        {/* Direct lead capture — an additive shortcut BELOW the buttons.
            Nothing above is gated on it. */}
        <div className="w-full mt-12 border border-gold/30 bg-card/60 p-6 text-left">
          <p className="font-serif text-xl text-center leading-snug">
            Or skip the browsing — <span className="text-gold">we'll reach out to you</span>
          </p>
          <div className="mt-5">
            <LeadForm
              sourceTag="Website - Links Page"
              submitLabel="Reach Out to Me"
              compact
              qualifying={[
                {
                  key: "interest",
                  label: "I'm interested in...",
                  options: ["Buying", "Selling", "Leasing", "Joining the team"],
                },
              ]}
              onSuccess={logFormSubmit}
            />
          </div>
        </div>

        {/* Socials */}
        <div className="flex gap-6 mt-8">
          <a href={SITE.instagram} target="_blank" rel="noreferrer" aria-label="Instagram" className="text-muted-foreground hover:text-gold">
            <Instagram className="h-5 w-5" />
          </a>
          <a href={SITE.facebook} target="_blank" rel="noreferrer" aria-label="Facebook" className="text-muted-foreground hover:text-gold">
            <Facebook className="h-5 w-5" />
          </a>
          {/* Admin-managed slots — hidden until a URL is provided in
              Admin → Bio Links → Social Profiles */}
          {socials?.social_tiktok && (
            <a href={socials.social_tiktok} target="_blank" rel="noreferrer" aria-label="TikTok" className="text-muted-foreground hover:text-gold">
              <TikTokIcon className="h-5 w-5" />
            </a>
          )}
          {socials?.social_youtube && (
            <a href={socials.social_youtube} target="_blank" rel="noreferrer" aria-label="YouTube" className="text-muted-foreground hover:text-gold">
              <Youtube className="h-5 w-5" />
            </a>
          )}
          {socials?.social_linkedin && (
            <a href={socials.social_linkedin} target="_blank" rel="noreferrer" aria-label="LinkedIn" className="text-muted-foreground hover:text-gold">
              <Linkedin className="h-5 w-5" />
            </a>
          )}
        </div>

        <a href={SITE.phoneHref} className="mt-6 text-xs tracking-[0.2em] text-gold">{SITE.phone}</a>

        {/* TREC compliance (required on every page) */}
        <div className="mt-12 space-y-2 text-[10px] text-muted-foreground/80 leading-relaxed">
          <a href={SITE.iabsUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 block">
            Texas Real Estate Commission Information About Brokerage Services
          </a>
          <a href={SITE.cpnUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 block">
            Texas Real Estate Commission Consumer Protection Notice
          </a>
          <p>{SITE.disclaimer}</p>
          <p>{SITE.address} · {SITE.phone}</p>
        </div>

        {/* Lifestyle Design Technologies credit — same quiet flex as the
            site footer, opening the same website-inquiry modal. */}
        <div className="mt-10 text-[11px] leading-relaxed text-muted-foreground/80">
          <p>
            Website crafted by <span className="text-gold/90">Lifestyle Design Technologies</span> —{" "}
            <button
              type="button"
              onClick={() => setInquiryOpen(true)}
              className="text-gold underline underline-offset-2 decoration-gold/50 hover:decoration-gold transition-colors cursor-pointer">
              Click here
            </button>{" "}
            to inquire about your own custom website.
          </p>
        </div>
        <WebsiteInquiryModal open={inquiryOpen} onOpenChange={setInquiryOpen} />
      </div>
    </div>
  );
}
