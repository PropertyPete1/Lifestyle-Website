import { AlertTriangle, Phone } from "lucide-react";
import { SUPPORT_PHONE } from "@shared/formErrors";
import { SITE } from "@shared/site";

/**
 * Persistent, on-brand submit-failure banner.
 *
 * Replaces toast-only error reporting on lead forms. A toast auto-dismisses and
 * can be missed entirely on mobile — which meant a visitor whose submission
 * failed saw the button return to normal and had no idea their details never
 * sent. This stays on screen until they retry, and always offers the phone as a
 * second path so a broken form never costs the lead.
 */
export default function FormError({
  message,
  onRetry,
  retrying = false,
}: {
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="border border-destructive/50 bg-destructive/10 px-4 py-3 text-left">
      <p className="flex items-start gap-2 text-sm text-foreground/90">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
        <span>{message}</span>
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="text-[11px] uppercase tracking-[0.18em] text-gold underline underline-offset-4 hover:text-gold/80 disabled:opacity-50">
            {retrying ? "Trying again…" : "Try again"}
          </button>
        )}
        <a
          href={SITE.phoneHref}
          className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-gold">
          <Phone className="h-3 w-3" aria-hidden /> {SUPPORT_PHONE}
        </a>
      </div>
    </div>
  );
}
