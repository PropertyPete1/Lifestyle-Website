import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Elegant staged status messages shown while an AI operation runs.
 * Not a generic spinner: a thin gold progress hairline + serif status line
 * that advances through stages (~1.1s each), holding on the last stage
 * until the operation completes.
 */
export default function AIStatusSequence({
  stages,
  className,
  interval = 1100,
}: {
  stages: string[];
  className?: string;
  interval?: number;
}) {
  const [idx, setIdx] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setIdx(0);
    let i = 0;
    const advance = () => {
      if (i < stages.length - 1) {
        i += 1;
        setIdx(i);
        timer.current = setTimeout(advance, interval);
      }
    };
    timer.current = setTimeout(advance, interval);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [stages, interval]);

  return (
    <div className={cn("flex flex-col items-center gap-4 py-2", className)} role="status" aria-live="polite">
      {/* Thin gold sweep hairline */}
      <div className="relative h-px w-40 overflow-hidden bg-gold/20">
        <div className="ai-sweep absolute inset-y-0 w-1/3 bg-gold" />
      </div>
      {/* Status line — crossfade via key change */}
      <p
        key={idx}
        className="ai-status-line font-serif italic text-base md:text-lg text-foreground/80 text-center">
        {stages[idx]}
      </p>
    </div>
  );
}
