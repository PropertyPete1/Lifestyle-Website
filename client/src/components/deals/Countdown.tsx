import { useEffect, useRef, useState } from "react";
import { countdownExpired, countdownLabel } from "@/lib/dealsMine";

/**
 * HH:MM:SS until the personal link expires. The one-second clock lives here, so
 * only this element re-renders every tick rather than the whole catalog, and
 * `onExpire` fires once when the clock reaches 00:00:00 so the page can refetch
 * instead of sitting on stale listings.
 *
 * `now` pins the clock for server rendering and tests; in the browser it is
 * left out and the component keeps its own time.
 */
export function Countdown({ expiresAt, now, onExpire, className }: { expiresAt: string; now?: number; onExpire?: () => void; className?: string }) {
  const [tick, setTick] = useState(() => Date.now());
  const current = now ?? tick;
  const expired = countdownExpired(expiresAt, current);
  // The expiry callback fires once per link; a refetched later expiry re-arms it.
  const firedFor = useRef<string | null>(null);
  useEffect(() => {
    if (now !== undefined) return;
    const id = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [now]);
  useEffect(() => {
    if (!expired || firedFor.current === expiresAt) return;
    firedFor.current = expiresAt;
    onExpire?.();
  }, [expired, expiresAt, onExpire]);
  return <time dateTime={expiresAt} className={className}>{countdownLabel(expiresAt, current)}</time>;
}
