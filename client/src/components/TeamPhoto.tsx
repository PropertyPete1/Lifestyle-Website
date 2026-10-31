import { useEffect, useState } from "react";

/** "Nicki Pauley" -> "NP"; one name -> its first letter. */
export function teamInitials(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).map((word) => word.charAt(0)).slice(0, 2).join("").toUpperCase();
}

/**
 * A team member's photo, or a branded card until their headshot arrives.
 * Oct 26, 2026: a headshot stored as a Google Drive link that Drive refuses showed as an empty box on the home page.
 * Oct 31, 2026 (Peter: "I don't have a photo yet so don't just leave it blank"): no lone gold letter on an empty
 * panel; the card shows the member's initials in a gold ring with the brokerage name, framed like the photos.
 * The parent box is `relative` and gives the size (the card fills it).
 */
export default function TeamPhoto({ photo, name, className }: { photo: string | null | undefined; name: string; className: string; fallbackClassName?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [photo]);
  if (photo && !failed) return <img src={photo} alt={name} className={className} onError={() => setFailed(true)} />;
  return <span data-team-photo-fallback="true" role="img" aria-label={name} className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-card to-secondary">
    <span aria-hidden="true" className="pointer-events-none absolute inset-3 border border-gold/25" />
    <span aria-hidden="true" className="flex h-20 w-20 items-center justify-center rounded-full border border-gold/70 bg-card font-serif text-3xl tracking-[0.06em] text-gold shadow-[0_10px_30px_-18px_rgb(131_99_36/0.6)] transition-transform duration-500 group-hover:scale-105 sm:h-24 sm:w-24 sm:text-4xl">{teamInitials(name)}</span>
    <span aria-hidden="true" className="mt-4 px-3 text-center text-[8.5px] uppercase leading-relaxed tracking-[0.3em] text-gold/80 sm:text-[9.5px]">Lifestyle Design Realty</span>
  </span>;
}
