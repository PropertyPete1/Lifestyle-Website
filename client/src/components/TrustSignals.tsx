import { Zap } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

/**
 * Small trust elements shown beside conversion points.
 *
 * The closed-deal count is read from the live site_stats rows — the same data
 * the homepage strip uses, refreshed by the daily FUB sync — so this number
 * tracks reality instead of going stale in markup. If stats haven't loaded (or
 * the sync has never run), the count is simply omitted rather than rendering a
 * placeholder or a zero.
 */
export function TrustLine({ className }: { className?: string }) {
  const { data: stats } = trpc.stats.list.useQuery();
  const closed = stats?.find((s) => /closed sales/i.test(s.label))?.value?.trim();

  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground",
        className
      )}>
      <span className="text-gold">4.6★ on Google</span>
      {closed && (
        <>
          <span aria-hidden>·</span>
          <span>{closed} homes closed</span>
        </>
      )}
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
