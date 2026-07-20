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
              <button key={m.id} onClick={() => setSelected(m)} className="text-left group">
                <div className="aspect-[3/4] bg-secondary overflow-hidden flex items-center justify-center">
                  {m.photo ? (
                    <img src={m.photo} alt={m.name} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                  ) : (
                    <span className="font-serif text-6xl text-gold/60">{m.name.charAt(0)}</span>
                  )}
                </div>
                <h2 className="font-sans text-base md:text-lg uppercase tracking-[0.12em] mt-4">{m.name}</h2>
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
