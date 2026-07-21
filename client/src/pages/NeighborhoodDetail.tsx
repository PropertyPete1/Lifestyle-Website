import { useParams, Link } from "wouter";
import PageShell from "@/components/PageShell";
import ListingCard from "@/components/ListingCard";
import LeadForm from "@/components/LeadForm";
import { trpc } from "@/lib/trpc";
import { SITE } from "@shared/site";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight } from "lucide-react";

/** Real nearby towns per core-market corridor — visual reinforcement of coverage breadth. */
const NEARBY_COMMUNITIES: Record<string, string[]> = {
  Austin: ["San Marcos", "Kyle", "Buda", "Round Rock", "Cedar Park"],
  "San Antonio": ["New Braunfels", "Boerne", "Schertz", "Converse"],
  Houston: ["Sugar Land", "Katy", "The Woodlands", "Pearland"],
  DFW: ["Frisco", "Plano", "McKinney", "Arlington"],
  "New Braunfels": ["San Marcos", "Seguin", "Canyon Lake"],
};

export default function NeighborhoodDetail() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug ?? "";
  const { data: hood, isLoading } = trpc.neighborhoods.bySlug.useQuery({ slug });
  const { data: listings } = trpc.listings.all.useQuery();

  if (isLoading) {
    return (
      <PageShell solidNav>
        <div className="mx-auto max-w-[1400px] px-5 lg:px-8 pt-28 pb-20 space-y-6">
          <Skeleton className="h-[40vh] w-full" />
          <Skeleton className="h-10 w-1/2" />
        </div>
      </PageShell>
    );
  }

  if (!hood) {
    return (
      <PageShell solidNav>
        <div className="mx-auto max-w-xl px-5 pt-40 pb-24 text-center">
          <h1 className="font-serif text-3xl">Area Not Found</h1>
          <Link href="/neighborhoods" className="text-cta mt-8 inline-block">All Neighborhoods</Link>
        </div>
      </PageShell>
    );
  }

  const cityMatch = (listings ?? []).filter(
    (l) =>
      l.city.toLowerCase() === hood.name.toLowerCase() ||
      (hood.region && l.city.toLowerCase() === hood.region.toLowerCase())
  );

  return (
    <PageShell>
      {/* Hero */}
      <section className="relative min-h-[65svh] flex items-end">
        <div className="absolute inset-0">
          {hood.heroImage && <img src={hood.heroImage} alt={hood.name} className="h-full w-full object-cover" />}
          <div className="absolute inset-0 bg-black/60" />
          <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent" />
        </div>
        <div className="relative mx-auto w-full max-w-[1400px] px-5 lg:px-8 pb-16 pt-40">
          <p className="eyebrow text-gold">{hood.region ?? "Texas"}</p>
          <h1 className="display-serif text-5xl md:text-7xl mt-3">{hood.name}</h1>
          {["San Antonio", "New Braunfels", "Austin", "DFW", "Houston"].includes(hood.name) && (
            <p className="eyebrow text-foreground/70 mt-3">& Surrounding Areas</p>
          )}
          {hood.tagline && <p className="mt-4 text-muted-foreground max-w-xl">{hood.tagline}</p>}
          {NEARBY_COMMUNITIES[hood.name] && (
            <div className="mt-6">
              <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground mb-2.5">
                Nearby Communities We Serve
              </p>
              <div className="flex flex-wrap gap-2">
                {NEARBY_COMMUNITIES[hood.name].map((town) => (
                  <span
                    key={town}
                    className="border border-gold/35 bg-black/30 backdrop-blur-sm text-foreground/85 px-3.5 py-1.5 text-[11px] uppercase tracking-[0.14em]">
                    {town}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Overview */}
      <section className="mx-auto max-w-[1400px] px-5 lg:px-8 py-16 lg:py-24 grid lg:grid-cols-3 gap-12">
        <div className="lg:col-span-2">
          <h2 className="display-serif text-3xl md:text-4xl reveal">Area Overview</h2>
          <p className="mt-6 text-muted-foreground leading-relaxed whitespace-pre-line reveal">
            {hood.description}
          </p>
          {hood.vibe && (
            <blockquote className="mt-8 border-l-2 border-gold pl-6 font-serif text-xl italic text-foreground/90 reveal">
              {hood.vibe}
            </blockquote>
          )}
          <div className="mt-10 flex flex-wrap gap-8 reveal">
            {hood.medianPrice && (
              <div>
                <div className="font-serif text-3xl text-gold">{hood.medianPrice}</div>
                <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground mt-1">Median Price</div>
              </div>
            )}
          </div>
          <a
            href={SITE.newConstructionUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-10 inline-flex items-center gap-3 bg-gold text-primary-foreground px-8 py-4 uppercase tracking-[0.2em] text-xs font-medium hover:bg-gold/90 transition-colors reveal">
            New Construction in {hood.name} <ArrowRight className="h-4 w-4" />
          </a>
        </div>

        <aside className="bg-card border border-border p-6 lg:p-8 h-fit lg:sticky lg:top-28">
          <LeadForm
            sourceTag={`Website - Contact`}
            heading={`Interested in ${hood.name}?`}
            submitLabel="Connect With Us"
            compact
            qualifying={[
              { key: "timeline", label: "Timeline to purchase", options: ["ASAP", "3-6 months", "Just browsing"] },
              { key: "preApproved", label: "Pre-approved for financing?", options: ["Yes", "No", "Not yet"] },
            ]}
            extraAnswers={{ areaOfInterest: hood.name }}
          />
        </aside>
      </section>

      {/* Listings in this area */}
      {cityMatch.length > 0 && (
        <section className="mx-auto max-w-[1400px] px-5 lg:px-8 pb-20">
          <h2 className="display-serif text-3xl md:text-4xl mb-8">Featured in {hood.name}</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {cityMatch.slice(0, 3).map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        </section>
      )}
    </PageShell>
  );
}
