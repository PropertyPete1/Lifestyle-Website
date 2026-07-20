import { Link } from "wouter";
import PageShell from "@/components/PageShell";
import { trpc } from "@/lib/trpc";
import { Skeleton } from "@/components/ui/skeleton";

export default function Neighborhoods() {
  const { data: hoods, isLoading } = trpc.neighborhoods.list.useQuery();

  return (
    <PageShell solidNav>
      <div className="mx-auto max-w-[1400px] px-5 lg:px-8 pt-28 lg:pt-36 pb-20">
        <p className="eyebrow text-gold">Explore</p>
        <h1 className="display-serif text-4xl md:text-6xl mt-3">Neighborhoods</h1>
        <p className="mt-4 text-muted-foreground max-w-2xl">
          From Hill Country escapes to fast-growing suburbs, explore the Central Texas communities
          we know street by street.
        </p>

        {isLoading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-12">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="aspect-[4/3] w-full" />
            ))}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-12">
            {(hoods ?? []).map((n, i) => (
              <Link key={n.id} href={`/${n.slug}`}>
                <div className="group relative aspect-[4/3] overflow-hidden reveal" style={{ transitionDelay: `${(i % 3) * 60}ms` }}>
                  {n.heroImage && (
                    <img src={n.heroImage} alt={n.name} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                  )}
                  <div className="absolute inset-0 bg-black/50 group-hover:bg-black/35 transition-colors" />
                  <div className="absolute inset-x-0 bottom-0 p-6">
                    <h2 className="font-serif text-2xl text-white">{n.name}</h2>
                    {n.tagline && <p className="text-xs text-white/75 mt-1">{n.tagline}</p>}
                    <span className="text-[10px] uppercase tracking-[0.2em] text-gold mt-2 inline-block opacity-0 group-hover:opacity-100 transition-opacity">
                      Learn More →
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
