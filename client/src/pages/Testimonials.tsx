import PageShell from "@/components/PageShell";
import TestimonialCarousel from "@/components/TestimonialCarousel";
import { trpc } from "@/lib/trpc";
import { Quote } from "lucide-react";

export default function Testimonials() {
  const { data: items } = trpc.testimonials.list.useQuery();

  return (
    <PageShell solidNav>
      <div className="mx-auto max-w-[1400px] px-5 lg:px-8 pt-28 lg:pt-36 pb-20">
        <p className="eyebrow text-gold">Client Experiences</p>
        <h1 className="display-serif text-4xl md:text-6xl mt-3">Testimonials</h1>
        <p className="mt-4 text-muted-foreground max-w-2xl">
          What our clients say about working with Lifestyle Design Realty.
        </p>

        <div className="mt-16 mb-20">
          <TestimonialCarousel />
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {(items ?? []).map((t, i) => (
            <figure key={t.id} className="bg-card border border-border p-8 reveal" style={{ transitionDelay: `${(i % 2) * 60}ms` }}>
              <Quote className="h-5 w-5 text-gold/70 mb-4" />
              <blockquote className="text-sm text-muted-foreground leading-relaxed">
                {t.quote}
              </blockquote>
              <figcaption className="mt-5 text-[11px] uppercase tracking-[0.2em] text-gold">
                — {t.author}
                {t.source ? <span className="text-muted-foreground"> · {t.source}</span> : null}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
