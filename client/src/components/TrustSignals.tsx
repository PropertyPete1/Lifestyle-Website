import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Small trust elements shown beside conversion points.
 *
 * The closed-deal count is Peter's stated brokerage total ("100+", Nov 3, 2026), not the FUB-synced site_stats
 * figure, which only counts deals closed since FUB was set up.
 */
export function TrustLine({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground",
        className
      )}>
      {/* Nov 3, 2026 (Peter): no Google star rating anywhere on the site, and the closed count is the brokerage's
          real total, "100+" — FUB only knows the deals closed since it was set up (81), so the live stat undercounts. */}
      <span className="text-gold">100+ homes closed</span>
      <span aria-hidden>·</span>
      <span>Veteran-owned</span>
    </p>
  );
}

/**
 * Compact restatement of the approved 30-minute response promise, for placing
 * beside a primary CTA. Wording matches the form confirmations exactly so the
 * site makes one consistent promise.
 */
export function ResponseBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border border-gold/35 bg-gold/5 px-3 py-1.5",
        "text-[10px] uppercase tracking-[0.16em] text-gold/90",
        className
      )}>
      <Zap className="h-3 w-3 shrink-0" aria-hidden />
      We reply within ~30 minutes
    </span>
  );
}
