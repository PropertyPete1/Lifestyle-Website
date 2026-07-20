import { useState } from "react";
import PageShell from "@/components/PageShell";
import LeadForm from "@/components/LeadForm";
import { trpc } from "@/lib/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Phone, Mail } from "lucide-react";
import type { TeamMember } from "../../../drizzle/schema";

export default function Team() {
  const { data: team, isLoading } = trpc.team.list.useQuery();
  const [selected, setSelected] = useState<TeamMember | null>(null);

  return (
    <PageShell solidNav>
      <div className="mx-auto max-w-[1400px] px-5 lg:px-8 pt-28 lg:pt-36 pb-20">
        <p className="eyebrow text-gold">Our People</p>
        {/*
         * TREC sizing rule: agent names below render at text-lg (~1.125rem).
         * The brokerage name in the nav wordmark is text-xl (~1.25rem) — always
         * >= half the size of the largest agent name. Do not enlarge agent
         * names beyond 2x the brokerage wordmark.
         */}
        <h1 className="display-serif text-4xl md:text-6xl mt-3">Meet the Team</h1>
        <p className="mt-4 text-muted-foreground max-w-2xl">
          The professionals behind Lifestyle Design Realty — one brand, one standard of service,
          across five Texas markets.
        </p>

        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 mt-12">
            {[...Array(7)].map((_, i) => (
              <Skeleton key={i} className="aspect-[3/4] w-full" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 lg:gap-8 mt-12">
            {(team ?? []).map((m) => (
              <button
                key={m.id}
                onClick={() => setSelected(m)}
                className="text-left group focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-1.5">
                <div className="relative aspect-[3/4] bg-secondary overflow-hidden flex items-center justify-center">
                  {m.photo ? (
                    <img src={m.photo} alt={m.name} className="h-full w-full object-cover transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-[1.06] group-hover:brightness-[1.08]" />
                  ) : (
                    <span className="font-serif text-6xl text-gold/60 transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-110 group-hover:text-gold">
                      {m.name.charAt(0)}
                    </span>
                  )}
                  {/* Inset gold frame, drawn on hover */}
                  <span aria-hidden className="pointer-events-none absolute inset-3 border border-gold/0 transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:border-gold/60" />
                  {/* Bottom gradient + view-profile cue */}
                  <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/70 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
                  <span className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 translate-y-2 text-[10px] uppercase tracking-[0.25em] text-gold opacity-0 transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:opacity-100 group-hover:translate-y-0">
                    View Profile
                  </span>
                </div>
                <h2 className="relative inline-block font-sans text-base md:text-lg uppercase tracking-[0.12em] mt-4">
                  {m.name}
                  <span aria-hidden className="absolute -bottom-0.5 left-0 h-px w-full origin-left scale-x-0 bg-gold transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-x-100" />
                </h2>
                <p className="text-[11px] uppercase tracking-[0.15em] text-gold mt-1">{m.title}</p>
                {m.license && (
                  <p className="text-[10px] text-muted-foreground mt-1">License #{m.license}</p>
                )}
                <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mt-1.5">
                  Lifestyle Design Realty
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[85dvh] overflow-y-auto bg-card text-card-foreground border-border">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="font-serif text-2xl">
                  {selected.name}
                  <span className="block text-xs uppercase tracking-[0.15em] text-gold mt-2 font-sans">
                    {selected.title} · Lifestyle Design Realty
                  </span>
                </DialogTitle>
              </DialogHeader>
              {selected.bio && (
                <p className="text-sm text-muted-foreground leading-relaxed">{selected.bio}</p>
              )}
              <div className="flex flex-wrap gap-5 text-sm">
                {selected.phone && (
                  <a href={`tel:${selected.phone}`} className="flex items-center gap-2 text-gold hover:underline">
                    <Phone className="h-4 w-4" /> {selected.phone}
                  </a>
                )}
                {selected.email && (
                  <a href={`mailto:${selected.email}`} className="flex items-center gap-2 text-gold hover:underline">
                    <Mail className="h-4 w-4" /> {selected.email}
                  </a>
                )}
              </div>
              <div className="hairline my-2" />
              <LeadForm
                sourceTag={`Website - Contact - Agent ${selected.name}`}
                heading={`Contact ${selected.name.split(" ")[0]}`}
                submitLabel="Send Message"
                showMessage
                compact
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
