import { useState } from "react";
import { ChevronLeft, ChevronRight, Quote } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function TestimonialCarousel() {
  const { data: items } = trpc.testimonials.list.useQuery();
  const [idx, setIdx] = useState(0);

  if (!items || items.length === 0) {
    return <p className="text-center text-sm text-muted-foreground">Testimonials coming soon.</p>;
  }

  const t = items[idx % items.length];
  const prev = () => setIdx((i) => (i - 1 + items.length) % items.length);
  const next = () => setIdx((i) => (i + 1) % items.length);

  return (
    <div className="relative max-w-3xl mx-auto text-center px-8 sm:px-14">
      <Quote className="h-8 w-8 text-gold/70 mx-auto mb-6" />
      <blockquote key={t.id} className="font-serif text-xl md:text-2xl leading-relaxed italic min-h-32">
        {t.quote.length > 420 ? `${t.quote.slice(0, 420)}…` : t.quote}
      </blockquote>
      <p className="mt-6 text-[11px] uppercase tracking-[0.25em] text-gold">— {t.author}</p>
      {items.length > 1 && (
        <>
          <button
            aria-label="Previous testimonial"
            onClick={prev}
            className="absolute left-0 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-gold transition-colors">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            aria-label="Next testimonial"
            onClick={next}
            className="absolute right-0 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-gold transition-colors">
            <ChevronRight className="h-6 w-6" />
          </button>
          <div className="flex justify-center gap-2 mt-8">
            {items.map((_, i) => (
              <button
                key={i}
                aria-label={`Go to testimonial ${i + 1}`}
                onClick={() => setIdx(i)}
                className={`h-1.5 transition-all ${i === idx ? "w-6 bg-gold" : "w-1.5 bg-muted-foreground/40"}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
