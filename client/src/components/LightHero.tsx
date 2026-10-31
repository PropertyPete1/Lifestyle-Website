import type { ReactNode } from "react";

/**
 * Oct 31, 2026 (Peter: "can you fix the black part, I found another spot with it"): the white-skin page hero that
 * replaced the old dark photo band (black overlay + a fade into the dark background) on /valuation, /sell and the
 * city pages, the same shape as the /join hero: the words beside a bright photo, stacked on a phone. No dark theme
 * and no overlay, so nothing on these pages turns black.
 */
export function LightHero({ eyebrow, title, intro, image, alt, children, titleClassName = "text-[2.35rem] sm:text-5xl lg:text-[3.6rem]" }: {
  eyebrow: string;
  title: ReactNode;
  intro?: ReactNode;
  image?: string | null;
  alt: string;
  children?: ReactNode;
  titleClassName?: string;
}) {
  return (
    <section data-light-hero="true" className="pt-[calc(68px+2.25rem)] lg:pt-[calc(80px+3rem)]">
      <div className={`mx-auto grid max-w-[1400px] items-center gap-8 px-5 pb-12 lg:gap-14 lg:px-8 lg:pb-16 ${image ? "lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]" : ""}`}>
        <div className="min-w-0">
          <p className="eyebrow text-gold">{eyebrow}</p>
          <h1 className={`mt-3 font-serif font-medium leading-[1.08] text-foreground ${titleClassName}`}>{title}</h1>
          {intro && <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">{intro}</p>}
          {children}
        </div>
        {image && <div className="relative aspect-[16/9] min-w-0 overflow-hidden lg:aspect-[5/4]">
          <img src={image} alt={alt} fetchPriority="high" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
        </div>}
      </div>
    </section>
  );
}

export default LightHero;
