import { useEffect, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { useStickyCtaTracking } from "@/hooks/usePageTracking";

/**
 * STICKY MOBILE CTA — a slim persistent bar on key pages.
 *
 * Zero CLS by construction: it is `fixed`, so it never participates in layout.
 * To stop it covering the last of the page, it publishes its height into
 * `--sticky-cta-h`, and PageShell adds that as bottom padding — the page grows
 * to make room rather than the bar sitting on top of content.
 *
 * Never covers form fields: it hides itself whenever a text input is focused
 * (which is also when the mobile keyboard is up), and stays hidden while the
 * visitor is inside a form.
 *
 * Mobile only, dismissible, and once dismissed it stays gone for the session.
 */

const DISMISSED_KEY = "ldr_sticky_cta_dismissed";

export default function StickyMobileCta({ label = "Ready? Get Started" }: { label?: string }) {
  const [visible, setVisible] = useState(false);
  const [typing, setTyping] = useState(false);
  const track = useStickyCtaTracking();

  useEffect(() => {
    const coarse =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;
    const isMobile = window.innerWidth < 768 || coarse;
    if (!isMobile) return;
    try {
      if (sessionStorage.getItem(DISMISSED_KEY)) return;
    } catch {
      /* storage blocked — still fine to show */
    }
    setVisible(true);

    // Hide while a field is focused so it can never sit over an input or be
    // trapped above the on-screen keyboard.
    const onFocus = (e: FocusEvent) => {
      const t = e.target;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement
      ) {
        setTyping(true);
      }
    };
    const onBlur = () => setTyping(false);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onBlur);
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onBlur);
    };
  }, []);

  // Publish height so PageShell can reserve space (no overlap, no CLS).
  useEffect(() => {
    const show = visible && !typing;
    document.documentElement.style.setProperty("--sticky-cta-h", show ? "56px" : "0px");
    return () => {
      document.documentElement.style.removeProperty("--sticky-cta-h");
    };
  }, [visible, typing]);

  if (!visible || typing) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[70] md:hidden border-t border-gold/40 bg-[oklch(0.14_0.01_285)]/95 backdrop-blur-sm">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <a
          href="/#get-started"
          onClick={track}
          className="flex flex-1 items-center justify-center gap-2 bg-gold px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.18em] text-primary-foreground">
          {label} <ArrowRight className="h-3.5 w-3.5" />
        </a>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => {
            try {
              sessionStorage.setItem(DISMISSED_KEY, "1");
            } catch {
              /* ignore */
            }
            setVisible(false);
          }}
          className="p-2 text-muted-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
