import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { SITE, isLinkVisible } from "@shared/site";
import { BIO_LINKS_SNAPSHOT } from "@shared/bioLinksSnapshot";
import { GUIDE_DRAW_MS } from "@shared/guideTrail";
import { Instagram, Facebook, Youtube, Linkedin, ArrowUpRight } from "lucide-react";
import {
  useNcClickTracking,
  useLeaseClickTracking,
  useLinksFormTracking,
  useLinksPromiseTracking,
  usePrimaryClickTracking,
} from "@/hooks/usePageTracking";
import NowHiringBanner from "@/components/NowHiringBanner";
import WebsiteInquiryModal from "@/components/WebsiteInquiryModal";
import LeadForm from "@/components/LeadForm";
import GuideTrail from "@/components/GuideTrail";
import { ResponseBadge, TrustLine } from "@/components/TrustSignals";
import { Zap } from "lucide-react";
import VeteranBadge from "@/components/VeteranBadge";
import LivingLogo from "@/components/LivingLogo";

/** Matches the .form-flash keyframe duration in index.css, plus a little slack. */
const FLASH_MS = 1800;

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
  const logPrimaryClick = usePrimaryClickTracking();
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const logPromiseClick = useLinksPromiseTracking();
  const promiseRef = useRef<HTMLButtonElement>(null);
  const captureRef = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState(false);
  const [trailRun, setTrailRun] = useState(0);
  const flashTimers = useRef<number[]>([]);

  // A second tap mid-animation must not let the first tap's "turn it off" timer
  // cut the new pulse short.
  const clearFlashTimers = () => {
    for (const id of flashTimers.current) window.clearTimeout(id);
    flashTimers.current = [];
  };
  useEffect(() => clearFlashTimers, []);

  /**
   * Promise chip → capture form. Smooth-scrolls (instantly for reduced-motion
   * users), draws the gold guide trail down the gutter alongside the scroll,
   * and lands it in the form's glow pulse so the tap reads as one connected
   * movement rather than a teleport.
   */
  const jumpToCapture = () => {
    logPromiseClick();
    const el = captureRef.current;
    if (!el) return;
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    // Reduced motion: no trail, and the highlight lands immediately with the
    // instant scroll. Otherwise the pulse waits for the trail's head to arrive.
    if (!reduced) setTrailRun((n) => n + 1);
    const delay = reduced ? 0 : GUIDE_DRAW_MS;
    // Toggle off → on in a separate task so a re-tap restarts the animation
    // instead of no-oping. Deliberately setTimeout and not requestAnimationFrame:
    // rAF is throttled in background/hidden contexts, which made the highlight
    // silently never apply while the scroll still happened.
    clearFlashTimers();
    setFlash(false);
    flashTimers.current.push(
      window.setTimeout(() => setFlash(true), delay),
      window.setTimeout(() => setFlash(false), delay + FLASH_MS),
    );
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center px-5 pb-12 pt-[calc(var(--hiring-banner-h,44px)+2.5rem)]">
      {/* Same recruiting banner as the homepage — /links is almost entirely
          mobile bio traffic, so this is prime recruiting real estate. */}
      <NowHiringBanner />
      <div className="w-full max-w-md flex flex-col items-center text-center">
        {/* Profile header — the animated brand mark. The box is a fixed size so
            the space is reserved before the canvas initialises (no layout
            shift), and the LDR mark inside it doubles as the static fallback. */}
        <LivingLogo size={168} />
        <h1 className="font-serif text-2xl tracking-[0.12em] mt-1">
          LIFESTYLE DESIGN <span className="text-gold">REALTY</span>
        </h1>
        <p className="eyebrow text-muted-foreground mt-2">Central Texas Real Estate Professionals</p>

        {/* Compact trust signals — same treatments as the main site header.
            One scannable line: veteran badge + Google rating. */}
        <div className="mt-3 flex items-center justify-center gap-2.5 whitespace-nowrap">
          <VeteranBadge compact className="tracking-[0.14em]" />
          <span className="h-3 w-px bg-border shrink-0" aria-hidden />
          <span className="inline-flex items-center gap-1 text-[8px] font-sans font-medium uppercase tracking-[0.14em] leading-none text-gold/90">
            <span aria-hidden>4.6★</span>
            <span className="text-muted-foreground">·</span>
            <span>22 Google Reviews</span>
          </span>
        </div>

        {/* 30-minute promise — the highest-intent path on the page, so it sits
            in the header where it is visible without scrolling rather than
            buried under every button.
            Shape carries the meaning here: every LINK below is a hard-cornered
            bordered rectangle, so the promise is a soft-filled pill with no
            border. Two gold rectangles stacked read as one control with a
            secondary row; a chip does not. The "tap here" affordance is the
            underline, not an arrow pointing at the button under it. */}
        <button
          ref={promiseRef}
          type="button"
          onClick={jumpToCapture}
          className="group mt-4 w-full rounded-full bg-gold/[0.09] px-6 py-3 text-center transition-colors hover:bg-gold/[0.15] active:scale-[0.995]">
          <span className="text-[10.5px] leading-relaxed tracking-[0.06em] text-foreground/90">
            <Zap
              className="mr-1.5 inline-block h-3.5 w-3.5 align-[-0.15em] text-gold"
              aria-hidden
            />
            Skip the browsing — tell us what you need and we'll reach out{" "}
            <span className="text-gold">within 30 minutes</span>.{" "}
            <span className="text-gold underline decoration-gold/60 underline-offset-2 transition-colors group-hover:decoration-gold">
              Tap here
            </span>
          </span>
        </button>

        {/* The trail this tap draws — fixed, pointer-events-none, zero layout. */}
        <GuideTrail runId={trailRun} fromRef={promiseRef} toRef={captureRef} />

        {/* Links — mt-9 (not mt-6) so the promise chip reads as its own thing
            with air under it, rather than as the first row of the button stack. */}
        <div className="w-full mt-9 space-y-3">
          {/* Bio links are admin-managed data, so a paused route (e.g. the
              seeded "Home Search" → /search) can still be present in the DB.
              Filter here so no customer is sent to a coming-soon dead end. */}
          {/* Bio links are admin-managed data, so a paused route (e.g. the
              seeded "Home Search" → /search) can still be present in the DB.
              Filter here so no customer is sent to a coming-soon dead end.
              EVERY button on this page is now a bio_links row (Own a Rental and
              Explore Our Full Website used to be hardcoded below), so admin
              ordering governs all of them and the priority order is data, not
              markup. */}
          {(() => {
            // First paint used to show only the hardcoded MEET PRIMARY row
            // while the DB rows waited on a network round-trip — an ugly
            // staggered pop-in on slow mobile, where all the bio traffic is.
            // Until (or if ever) the fetch lands, render the build-time
            // snapshot instead: same rows, same order, so the swap to live
            // data is a no-op unless an admin actually edited the links.
            const visible = (links ?? BIO_LINKS_SNAPSHOT).filter((l) => isLinkVisible(l.url));
            // MEET PRIMARY — the one hardcoded row in an otherwise data-driven
            // stack. It pairs with the PRIMARY orb above (green accent instead
            // of gold) and slots directly below New Construction Search; if the
            // admin ever hides that row, it falls to the end of the stack.
            // utm_source carries the "linkpage-primary" tag to the LDT site,
            // and the click is logged first-party like every other button.
            const primaryRow = (
              <a
                key="ldt-primary"
                href="https://lifestyledesigntechnologies.com/?utm_source=linkpage-primary"
                target="_blank"
                rel="noopener"
                onClick={logPrimaryClick}
                className="group lux-lift flex items-center justify-between w-full px-6 py-4 text-xs uppercase tracking-[0.2em] transition-colors border border-[#4ADE80]/60 bg-[#4ADE80]/[0.07] text-foreground hover:bg-[#4ADE80]/[0.12] hover:border-[#4ADE80]">
                <span className="flex flex-col items-start gap-1 text-left">
                  <span>Meet Primary — Our AI</span>
                  <span className="text-[8.5px] tracking-[0.18em] text-[#4ADE80]/80">
                    24/7 AI Operations
                  </span>
                </span>
                <ArrowUpRight className="h-4 w-4 text-[#4ADE80] opacity-70 group-hover:opacity-100" />
              </a>
            );
            const rows = visible.map((l, i) => {
            const isInternal = l.url.startsWith("/");
            // Visual hierarchy: the top button carries a gold border so the eye
            // lands on the money path first. Everything else stays neutral so
            // the emphasis actually means something.
            const primary = i === 0;
            const cls = cn(
              "group lux-lift flex items-center justify-between w-full px-6 py-4 text-xs uppercase tracking-[0.2em] transition-colors",
              primary
                ? "border border-gold/70 bg-gold/10 text-foreground hover:bg-gold/15 hover:border-gold"
                : "border border-border bg-card hover:border-gold hover:text-gold"
            );
            const arrow = (
              <ArrowUpRight
                className={cn(
                  "h-4 w-4 group-hover:opacity-100",
                  primary ? "text-gold opacity-80" : "opacity-40"
                )}
              />
            );
            // Outbound clicks keep their existing first-party tracking.
            const onClick =
              l.url === SITE.newConstructionUrl
                ? logNcClick
                : l.url === "/lease"
                  ? logLeaseClick
                  : undefined;
            return isInternal ? (
              <Link key={l.id} href={l.url} onClick={onClick} className={cls}>
                {l.label}
                {arrow}
              </Link>
            ) : (
              <a
                key={l.id}
                href={l.url}
                target="_blank"
                rel="noreferrer"
                className={cls}
                onClick={onClick}>
                {l.label}
                {arrow}
              </a>
            );
            });
            const ncIdx = visible.findIndex((l) => l.url === SITE.newConstructionUrl);
            rows.splice(ncIdx >= 0 ? ncIdx + 1 : rows.length, 0, primaryRow);
            return rows;
          })()}
        </div>

        {/* Direct lead capture — an additive shortcut BELOW the buttons.
            Nothing above is gated on it. */}
        <div
          ref={captureRef}
          className={cn(
            "w-full mt-12 border border-gold/30 bg-card/60 p-6 text-left",
            flash && "form-flash"
          )}>
          <p className="font-serif text-xl text-center leading-snug">
            Or skip the browsing — <span className="text-gold">we'll reach out to you</span>
          </p>
          <div className="mt-4 flex flex-col items-center gap-2.5">
            <ResponseBadge />
            <TrustLine className="justify-center" />
          </div>
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
