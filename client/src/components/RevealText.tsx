import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Progressive word-by-word reveal for AI-generated narrative text.
 *
 * The text is already fully delivered (results are cached server-side), so this
 * is purely a perceived-effort effect: the letter looks like it's being written
 * rather than appearing as a finished block.
 *
 * Never makes a repeat visitor wait:
 * - `instant` (shared links, reloads, cached reads) renders the full text
 *   immediately — no fake typing.
 * - `prefers-reduced-motion: reduce` also renders instantly.
 *
 * Reveals in word chunks rather than per character: smoother, far fewer
 * re-renders, and no layout thrash since the final text is laid out from the
 * start (hidden words occupy their space via opacity, so nothing reflows).
 */
export default function RevealText({
  text,
  instant = false,
  className,
  /** ms between chunks */
  speed = 42,
  /** words revealed per tick — higher for long copy so it never drags */
  chunkSize,
  /** ms to wait before starting (lets a preceding element land first) */
  startDelay = 0,
  onDone,
}: {
  text: string;
  instant?: boolean;
  className?: string;
  speed?: number;
  chunkSize?: number;
  startDelay?: number;
  onDone?: () => void;
}) {
  const words = text.split(/(\s+)/); // keep whitespace so spacing is preserved
  const wordCount = words.filter((w) => w.trim()).length;
  // Long paragraphs reveal in bigger chunks so total time stays ~2-4s.
  const step = chunkSize ?? (wordCount > 60 ? 3 : wordCount > 30 ? 2 : 1);

  const reduced =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const skip = instant || reduced;
  const [shown, setShown] = useState(skip ? words.length : 0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    if (skip) {
      setShown(words.length);
      if (!doneRef.current) {
        doneRef.current = true;
        onDone?.();
      }
      return;
    }
    setShown(0);
    doneRef.current = false;
    let i = 0;
    const tick = () => {
      i += step * 2; // *2 because split() interleaves whitespace tokens
      if (i >= words.length) {
        setShown(words.length);
        if (!doneRef.current) {
          doneRef.current = true;
          onDone?.();
        }
        return;
      }
      setShown(i);
      timer.current = setTimeout(tick, speed);
    };
    timer.current = setTimeout(tick, startDelay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, skip, speed, step, startDelay]);

  // Screen readers get the whole string at once; the animation is decorative.
  if (skip) return <p className={className}>{text}</p>;

  return (
    <p className={className} aria-label={text}>
      <span aria-hidden>
        {words.map((w, idx) => (
          <span
            key={idx}
            className={cn(
              "transition-opacity duration-300",
              idx < shown ? "opacity-100" : "opacity-0"
            )}>
            {w}
          </span>
        ))}
      </span>
    </p>
  );
}
