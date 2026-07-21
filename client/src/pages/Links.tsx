import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { SITE } from "@shared/site";
import { Instagram, Facebook, ArrowUpRight } from "lucide-react";

/**
 * /links — link-in-bio page replacing Linktree. Mobile-first, on-brand.
 * Standalone layout (no nav) but keeps TREC links at the bottom.
 */
export default function Links() {
  const { data: links } = trpc.links.list.useQuery();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center px-5 py-12">
      <div className="w-full max-w-md flex flex-col items-center text-center">
        {/* Profile header */}
        <div className="h-20 w-20 rounded-full border border-gold/60 flex items-center justify-center">
          <span className="font-serif text-2xl text-gold">LDR</span>
        </div>
        <h1 className="font-serif text-2xl tracking-[0.12em] mt-5">
          LIFESTYLE DESIGN <span className="text-gold">REALTY</span>
        </h1>
        <p className="eyebrow text-muted-foreground mt-2">Central Texas Real Estate Professionals</p>

        {/* Links */}
        <div className="w-full mt-10 space-y-3">
          {(links ?? []).map((l) => {
            const isInternal = l.url.startsWith("/");
            const cls =
              "group lux-lift flex items-center justify-between w-full border border-border bg-card px-6 py-4 text-xs uppercase tracking-[0.2em] hover:border-gold hover:text-gold transition-colors";
            return isInternal ? (
              <Link key={l.id} href={l.url} className={cls}>
                {l.label}
                <ArrowUpRight className="h-4 w-4 opacity-40 group-hover:opacity-100" />
              </Link>
            ) : (
              <a key={l.id} href={l.url} target="_blank" rel="noreferrer" className={cls}>
                {l.label}
                <ArrowUpRight className="h-4 w-4 opacity-40 group-hover:opacity-100" />
              </a>
            );
          })}
        </div>

        {/* Socials */}
        <div className="flex gap-6 mt-8">
          <a href={SITE.instagram} target="_blank" rel="noreferrer" aria-label="Instagram" className="text-muted-foreground hover:text-gold">
            <Instagram className="h-5 w-5" />
          </a>
          <a href={SITE.facebook} target="_blank" rel="noreferrer" aria-label="Facebook" className="text-muted-foreground hover:text-gold">
            <Facebook className="h-5 w-5" />
          </a>
        </div>

        <a href={SITE.phoneHref} className="mt-6 text-xs tracking-[0.2em] text-gold">{SITE.phone}</a>

        {/* TREC compliance (required on every page) */}
        <div className="mt-12 space-y-2 text-[10px] text-muted-foreground/80 leading-relaxed">
          <a href={SITE.iabsUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 block">
            Texas Real Estate Commission Information About Brokerage Services
          </a>
          <a href={SITE.cpnUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 block">
            Texas Real Estate Commission Consumer Protection Notice
          </a>
          <p>{SITE.disclaimer}</p>
          <p>{SITE.address} · {SITE.phone}</p>
        </div>
      </div>
    </div>
  );
}
