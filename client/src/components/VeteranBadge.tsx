import { cn } from "@/lib/utils";

/**
 * Small, understated "Veteran-Owned & Operated" trust badge with a custom
 * gold-toned American flag SVG (stylized waving flag — stripes + star field)
 * matching the site's gold/charcoal luxury design language. Not a focal point.
 */
export function FlagIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn("h-[11px] w-auto", className)}>
      {/* Waving stripes */}
      <path
        d="M1 2.2C4 0.9 7 0.9 10 2.2C13 3.5 16 3.5 19 2.2"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
      <path
        d="M1 6.2C4 4.9 7 4.9 10 6.2C13 7.5 16 7.5 19 6.2"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.75"
      />
      <path
        d="M1 10.2C4 8.9 7 8.9 10 10.2C13 11.5 16 11.5 19 10.2"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.5"
      />
      {/* Star field — single refined five-point star */}
      <path
        d="M3.6 0.2L4.25 1.52L5.7 1.73L4.65 2.75L4.9 4.2L3.6 3.51L2.3 4.2L2.55 2.75L1.5 1.73L2.95 1.52L3.6 0.2Z"
        fill="currentColor"
      />
    </svg>
  );
}

export default function VeteranBadge({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-gold/90",
        compact ? "text-[8px]" : "text-[9px]",
        "font-sans font-medium uppercase tracking-[0.22em] leading-none whitespace-nowrap",
        className
      )}>
      <FlagIcon className={compact ? "h-[9px]" : "h-[11px]"} />
      Veteran-Owned &amp; Operated
    </span>
  );
}
