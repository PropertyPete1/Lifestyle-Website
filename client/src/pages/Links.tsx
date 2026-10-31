import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { SITE, isLinkVisible } from "@shared/site";
import { BIO_LINKS_SNAPSHOT } from "@shared/bioLinksSnapshot";
import { GUIDE_DRAW_MS } from "@shared/guideTrail";
import { ArrowRight, BarChart3, Briefcase, CalendarDays, Facebook, Globe, House, Instagram, KeyRound, Linkedin, MapPin, Phone, Sparkles, Youtube, Zap, type LucideIcon } from "lucide-react";
import {
  useNcClickTracking,
  useLeaseClickTracking,
  useLinksFormTracking,
  useLinksPromiseTracking,
} from "@/hooks/usePageTracking";
import NowHiringBanner from "@/components/NowHiringBanner";
import LeadForm from "@/components/LeadForm";
import GuideTrail from "@/components/GuideTrail";
import { ResponseBadge } from "@/components/TrustSignals";
import { BRAND_IMG } from "@/lib/assets";

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

/** Each bio link's icon, by where it goes (the links are admin-managed rows, so this keys on the destination). */
function linkIcon(url: string): LucideIcon {
  if (url === SITE.newConstructionUrl || url.startsWith("/deals")) return House;
  if (url.startsWith("/city-finder")) return MapPin;
  if (url === "/") return Globe;
  if (url.startsWith("/lease")) return KeyRound;
  if (url.startsWith("/valuation")) return BarChart3;
  if (url.startsWith("/join")) return Briefcase;
  if (url.startsWith("/contact")) return CalendarDays;
  return Sparkles;
}

/**
 * /links — link-in-bio page replacing Linktree. Mobile-first, standalone layout
 * (no nav) that keeps the TREC links at the bottom.
 *
 * Oct 30, 2026 (Peter's white-skin mockup): warm white and ivory, charcoal text, deep gold. The brand mark is the
 * still LDR monogram in its gold ring (the particle orb is retired here). A shallow photo strip, the links as cards
 * (the first one, New Construction Search → /deals, filled gold), the callback form, the socials with their names,
 * then the legal footer. Top: the same Now Hiring banner as the homepage (fixed; content is padded below it via
 * --hiring-banner-h).
 */
export default function Links() {
  const { data: links } = trpc.links.list.useQuery();
  const { data: socials } = trpc.settings.socials.useQuery();
  const logNcClick = useNcClickTracking();
  const logLeaseClick = useLeaseClickTracking();
  const logFormSubmit = useLinksFormTracking();
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
   * movement rather than a teleport. It never submits anything.
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

  const socialCls = "inline-flex min-h-11 items-center gap-2.5 px-1 text-[15px] text-foreground transition-colors hover:text-gold";

  return (
    <div className="flex min-h-screen flex-col items-center bg-background px-4 pb-12 pt-[calc(var(--hiring-banner-h,44px)+1.5rem)] text-foreground sm:px-6">
      {/* Same recruiting banner as the homepage — /links is almost entirely
          mobile bio traffic, so this is prime recruiting real estate. */}
      <NowHiringBanner />
      <div className="flex w-full max-w-[620px] flex-col items-center text-center">
        {/* The brand: the LDR monogram in its gold ring, the name, the line, the veteran mark. */}
        <div data-links-mark className="flex h-[96px] w-[96px] items-center justify-center rounded-full border-[1.5px] border-gold sm:h-[108px] sm:w-[108px]">
          <span className="font-serif text-[30px] font-medium leading-none tracking-[-0.02em] text-gold sm:text-[34px]">LDR</span>
        </div>
        <h1 className="mt-3 font-serif text-[2.35rem] font-medium leading-[1.05] tracking-[-0.01em] text-foreground sm:text-5xl">
          Lifestyle Design Realty
        </h1>
        <p className="mt-2 text-[9px] font-medium uppercase tracking-[0.2em] text-foreground/85 min-[400px]:text-[10px] min-[400px]:tracking-[0.24em] sm:text-[11px] sm:tracking-[0.3em]">Central Texas Real Estate Professionals</p>
        <p className="mt-3 rounded-[6px] border border-gold/70 px-4 py-1.5 text-[10px] font-medium uppercase tracking-[0.22em] text-gold sm:text-[11px]">
          Veteran-Owned &amp; Operated
        </p>
        {/* Oct 30, 2026, 9:18 PM (Peter): no Google star rating on the link page. */}

        {/* 30-minute promise — the highest-intent path on the page, kept where it
            is seen without scrolling. A soft-filled pill (the links below are
            bordered cards), so it reads as its own thing; the "tap here" is the
            underline. */}
        <button
          ref={promiseRef}
          type="button"
          onClick={jumpToCapture}
          className="group mt-4 w-full rounded-full bg-gold/[0.08] px-6 py-3 text-center transition-colors hover:bg-gold/[0.14] active:scale-[0.995]">
          <span className="text-[12px] leading-relaxed tracking-[0.02em] text-foreground/90">
            <Zap className="mr-1.5 inline-block h-3.5 w-3.5 align-[-0.15em] text-gold" aria-hidden />
            Skip the browsing — tell us what you need and we'll reach out{" "}
            <span className="text-gold">within 30 minutes</span>.{" "}
            <span className="text-gold underline decoration-gold/60 underline-offset-2 transition-colors group-hover:decoration-gold">
              Tap here
            </span>
          </span>
        </button>

        {/* The trail this tap draws — fixed, pointer-events-none, zero layout. */}
        <GuideTrail runId={trailRun} fromRef={promiseRef} toRef={captureRef} />

        {/* A shallow photo strip (illustrative, from Peter's approved mockup). */}
        <img src={BRAND_IMG.linksFront} alt="Limestone Hill Country home with a covered front porch" fetchPriority="high" decoding="async" className="mt-5 aspect-[3.3/1] w-full rounded-[10px] object-cover" />

        {/* Links */}
        <div className="w-full mt-4 space-y-3">
          {/* Bio links are admin-managed data, so a paused route (e.g. the
              seeded "Home Search" → /search) can still be present in the DB.
              Filter here so no customer is sent to a coming-soon dead end. */}
          {(() => {
            // Render the build-time snapshot until the active DB rows arrive.
            // Every visible CTA is a bio_links row: admin ordering governs the
            // entire stack, and inactive rows never render on this public page.
            const visible = (links ?? BIO_LINKS_SNAPSHOT).filter((l) => isLinkVisible(l.url));
            return visible.map((l, i) => {
              const isInternal = l.url.startsWith("/");
              // The first link is the money path: filled deep gold with white text. The rest are white cards.
              const primary = i === 0;
              const Icon = linkIcon(l.url);
              const cls = cn(
                "group flex min-h-[60px] w-full items-center gap-4 rounded-[10px] px-5 py-3 text-left transition-colors sm:min-h-[66px] sm:px-6",
                primary
                  ? "bg-gold text-white shadow-[0_10px_24px_-14px_rgb(131_99_36/0.8)] hover:bg-gold/90"
                  : "border border-border bg-card text-foreground hover:border-gold/70"
              );
              const body = (
                <>
                  <Icon className={cn("h-6 w-6 shrink-0", primary ? "text-white" : "text-foreground/80")} strokeWidth={1.5} aria-hidden />
                  <span className="min-w-0 flex-1 font-serif text-[1.35rem] leading-tight sm:text-[1.5rem]">{l.label}</span>
                  <ArrowRight className={cn("h-5 w-5 shrink-0 transition-transform group-hover:translate-x-0.5", primary ? "text-white" : "text-gold")} aria-hidden />
                </>
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
                  {body}
                </Link>
              ) : (
                <a
                  key={l.id}
                  href={l.url}
                  target="_blank"
                  rel="noreferrer"
                  className={cls}
                  onClick={onClick}>
                  {body}
                </a>
              );
            });
          })()}
        </div>

        {/* Oct 30, 2026 (ChatGPT's review, Peter: yes): sellers and landlords get their own two doors. */}
        <div data-links-owner-shortcuts className="mt-4 w-full rounded-[10px] border border-border bg-secondary/50 px-4 py-3.5">
          <p className="font-serif text-[1.15rem] text-foreground">Selling or renting out a property?</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Link href="/valuation" className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[8px] border border-gold/60 bg-card px-2 text-center font-serif text-[1rem] leading-tight text-foreground hover:border-gold hover:text-gold">
              Review My Home&rsquo;s Value
            </Link>
            <Link href="/lease" onClick={logLeaseClick} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[8px] border border-gold/60 bg-card px-2 text-center font-serif text-[1rem] leading-tight text-foreground hover:border-gold hover:text-gold">
              Plan My Rental Listing
            </Link>
          </div>
        </div>

        {/* Direct lead capture — an additive shortcut BELOW the buttons.
            Nothing above is gated on it. */}
        <div
          ref={captureRef}
          className={cn(
            "mt-5 w-full rounded-[12px] border border-border bg-card p-5 text-left sm:p-7",
            flash && "form-flash"
          )}>
          <p className="text-center font-serif text-[1.6rem] font-medium leading-snug sm:text-[1.9rem]">
            Or skip the browsing — we'll reach out to you
          </p>
          <div className="mt-3 flex flex-col items-center gap-2.5">
            <ResponseBadge />
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

        {/* Socials, with their names (Instagram, Facebook, the phone), plus the admin-managed slots once set. */}
        <div data-links-socials className="mt-6 flex w-full flex-wrap items-center justify-center gap-x-4 gap-y-1 sm:gap-x-6">
          <a href={SITE.instagram} target="_blank" rel="noreferrer" className={socialCls}>
            <Instagram className="h-6 w-6" strokeWidth={1.6} aria-hidden /> Instagram
          </a>
          <span className="hidden h-6 w-px bg-border sm:block" aria-hidden />
          <a href={SITE.facebook} target="_blank" rel="noreferrer" className={socialCls}>
            <Facebook className="h-6 w-6" strokeWidth={1.6} aria-hidden /> Facebook
          </a>
          <span className="hidden h-6 w-px bg-border sm:block" aria-hidden />
          <a href={SITE.phoneHref} className={socialCls}>
            <Phone className="h-5 w-5 text-gold" strokeWidth={1.8} aria-hidden /> {SITE.phone}
          </a>
          {/* Admin-managed slots — hidden until a URL is provided in
              Admin → Bio Links → Social Profiles */}
          {socials?.social_tiktok && (
            <a href={socials.social_tiktok} target="_blank" rel="noreferrer" className={socialCls}>
              <TikTokIcon className="h-5 w-5" /> TikTok
            </a>
          )}
          {socials?.social_youtube && (
            <a href={socials.social_youtube} target="_blank" rel="noreferrer" className={socialCls}>
              <Youtube className="h-6 w-6" strokeWidth={1.6} aria-hidden /> YouTube
            </a>
          )}
          {socials?.social_linkedin && (
            <a href={socials.social_linkedin} target="_blank" rel="noreferrer" className={socialCls}>
              <Linkedin className="h-5 w-5" strokeWidth={1.6} aria-hidden /> LinkedIn
            </a>
          )}
        </div>

        {/* TREC compliance (required on every page) */}
        <div className="mt-6 w-full space-y-2 border-t border-border pt-5 text-[11px] leading-relaxed text-muted-foreground">
          <a href={SITE.iabsUrl} target="_blank" rel="noreferrer" className="block underline underline-offset-2 hover:text-gold">
            Texas Real Estate Commission Information About Brokerage Services
          </a>
          <a href={SITE.cpnUrl} target="_blank" rel="noreferrer" className="block underline underline-offset-2 hover:text-gold">
            Texas Real Estate Commission Consumer Protection Notice
          </a>
          <p className="flex justify-center gap-3">
            <Link href="/privacy" className="underline underline-offset-2 hover:text-gold">Privacy Policy</Link>
            <span aria-hidden>|</span>
            <Link href="/terms" className="underline underline-offset-2 hover:text-gold">Terms</Link>
          </p>
          <p>{SITE.disclaimer}</p>
          <p>{SITE.address} · {SITE.phone}</p>
        </div>

        {/* Oct 30, 2026 (ChatGPT's review, Peter: yes): the custom-website credit stays in the site footer, not in
            this buyer funnel. */}
      </div>
    </div>
  );
}
