import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ArrowRight, X } from "lucide-react";
import { useExitIntentTracking } from "@/hooks/usePageTracking";

/**
 * EXIT-INTENT NUDGE — desktop only, once per session, one CTA.
 *
 * Rules, deliberately conservative so this never becomes the thing people
 * remember about the site:
 * - Desktop pointers only. Mobile has no real exit intent and the usual
 *   proxies (scroll-up, back gesture) fire while someone is just reading, so
 *   this is hard-disabled below the tablet breakpoint AND on coarse pointers.
 * - Once per SESSION (sessionStorage), and never again once dismissed.
 * - Suppressed entirely if the visitor already converted or is mid-form, so it
 *   can't interrupt someone who is already doing the thing it asks for.
 * - NEVER on the link-in-bio routes (see EXCLUDED_PATHS). /links is the landing
 *   page for Instagram traffic and is deliberately a no-brainer: one screen of
 *   tap targets, including a prominent "Find Your Texas City" button. A modal
 *   asking the same question interrupts that traffic before they have even read
 *   the page, so the nudge is scoped out of it entirely.
 * - prefers-reduced-motion gets no entrance animation.
 * - Esc closes, the backdrop closes, focus moves to the dialog.
 *
 * Shows and clicks are logged as first-party analytics events so its
 * conversion rate is measurable — if it doesn't earn its keep, delete it.
 */

const SEEN_KEY = "ldr_exit_intent_seen";

/**
 * Routes where the nudge must never appear. Matched against the pathname with
 * an exact / prefix test so `/links` and `/links/anything` are both covered.
 */
export const EXIT_INTENT_EXCLUDED_PATHS = ["/links"] as const;

export function isExitIntentExcluded(pathname: string): boolean {
  const path = (pathname || "/").replace(/\/+$/, "") || "/";
  return EXIT_INTENT_EXCLUDED_PATHS.some(
    (excluded) => path === excluded || path.startsWith(`${excluded}/`),
  );
}

export default function ExitIntentModal() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const track = useExitIntentTracking();
  const shownRef = useRef(false);
  const [location] = useLocation();
  const excluded = isExitIntentExcluded(location);

  // Close immediately if a route change lands on an excluded page while open.
  useEffect(() => {
    if (excluded) setOpen(false);
  }, [excluded]);

  useEffect(() => {
    if (excluded) return; // never arm the listener on excluded routes
    // --- eligibility -------------------------------------------------------
    const coarse =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;
    if (coarse || window.innerWidth < 1024) return; // never on mobile/tablet

    try {
      if (sessionStorage.getItem(SEEN_KEY)) return; // once per session
    } catch {
      return; // storage blocked → don't risk repeat nags
    }

    const onLeave = (e: MouseEvent) => {
      if (shownRef.current) return;
      // Only a genuine exit toward the browser chrome, not a stray move.
      if (e.clientY > 8 || e.relatedTarget) return;

      // Don't interrupt someone already filling a form or reading a result.
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement
      ) {
        return;
      }
      // If a confirmation is on screen, they already converted.
      // Explicit marker only rendered by post-submit success states. A previous
      // version scanned document.body.innerText for the confirmation sentence,
      // but that exact wording is also a STATIC selling point beside the Get
      // Started form, so the modal was permanently suppressed on the homepage.
      if (document.querySelector("[data-lead-converted]")) return;

      shownRef.current = true;
      try {
        sessionStorage.setItem(SEEN_KEY, "1");
      } catch {
        /* ignore */
      }
      setOpen(true);
      track("exit_intent_show");
    };

    document.addEventListener("mouseout", onLeave);
    return () => document.removeEventListener("mouseout", onLeave);
  }, [track, excluded]);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open || excluded) return null;

  const reduced =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-5"
      onClick={() => setOpen(false)}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="exit-intent-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={[
          "relative w-full max-w-md border border-gold/40 bg-card p-8 text-center outline-none",
          reduced ? "" : "animate-in fade-in zoom-in-95 duration-200",
        ].join(" ")}>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="absolute right-3 top-3 p-2 text-muted-foreground hover:text-gold">
          <X className="h-4 w-4" />
        </button>

        <p className="eyebrow text-gold">Before you go</p>
        <h2 id="exit-intent-title" className="mt-3 font-serif text-2xl leading-snug">
          Want us to find your perfect Texas home?
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">Takes 30 seconds.</p>

        <a
          href="/#get-started"
          onClick={() => {
            track("exit_intent_click");
            setOpen(false);
          }}
          className="glow-gold mt-7 inline-flex items-center gap-3 bg-gold px-8 py-4 text-xs font-medium uppercase tracking-[0.2em] text-primary-foreground transition-colors hover:bg-gold/90">
          Get Started <ArrowRight className="h-4 w-4" />
        </a>

        <button
          type="button"
          onClick={() => setOpen(false)}
          className="mt-5 block w-full text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground">
          No thanks
        </button>
      </div>
    </div>
  );
}
