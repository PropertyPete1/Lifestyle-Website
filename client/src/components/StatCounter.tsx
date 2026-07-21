import { useEffect, useRef, useState } from "react";

/** Animated counter that counts up when scrolled into view. */
export default function StatCounter({
  value,
  label,
  compact = false,
}: {
  value: string;
  label: string;
  /** Slimmer, understated treatment for the below-the-fold data strip. */
  compact?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [display, setDisplay] = useState(value);
  const started = useRef(false);

  useEffect(() => {
    // Extract leading numeric portion for animation; keep prefix/suffix as-is.
    const match = value.match(/^([^0-9]*)([\d,.]+)(.*)$/);
    if (!match) {
      setDisplay(value);
      return;
    }
    const [, prefix, numStr, suffix] = match;
    const target = parseFloat(numStr.replace(/,/g, ""));
    const decimals = numStr.includes(".") ? (numStr.split(".")[1]?.length ?? 0) : 0;

    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) return;

    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !started.current) {
          started.current = true;
          const dur = 1400;
          const t0 = performance.now();
          const tick = (t: number) => {
            const p = Math.min(1, (t - t0) / dur);
            const eased = 1 - Math.pow(1 - p, 3);
            const current = target * eased;
            setDisplay(
              `${prefix}${current.toLocaleString("en-US", {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals,
              })}${suffix}`
            );
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          io.disconnect();
        }
      },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [value]);

  return (
    <div ref={ref} className="text-center">
      <div className={compact ? "font-serif text-2xl md:text-3xl text-gold" : "font-serif text-3xl md:text-5xl text-gold"}>{display}</div>
      <div className={compact ? "mt-1.5 text-[10px] uppercase tracking-[0.22em] text-muted-foreground" : "mt-2 text-[11px] uppercase tracking-[0.25em] text-muted-foreground"}>{label}</div>
    </div>
  );
}
