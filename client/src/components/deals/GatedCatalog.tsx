import { useState } from "react";
import { Link } from "wouter";
import { Clock3, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { identityPatternStyle } from "@/lib/dealsIdentityPattern";
import { AreaMap } from "./AreaMap";
import { DealsFooter, Incentive, ReelCard, formatChicagoDate, money, type DealsIncentive } from "./shared";

/** Hand-built server objects only: no builder, community, plan, street, lot or listing identifiers exist on these shapes. */
export type GatedHome = {
  card: string;
  kind: "quick_move_in" | "to_be_built" | string;
  beds?: string | number | null;
  baths?: string | number | null;
  sqft?: number | null;
  price?: number | null;
  previousPrice?: number | null;
  moveInDate?: string | null;
  lotSize?: string | null;
  photos?: string[];
};

export type GatedCommunity = {
  label: string;
  area: string;
  schoolDistrict?: string | null;
  lotSizes?: string | null;
  amenities?: string[];
  driveTimes?: unknown;
  areaMap?: unknown;
  fromPrice?: number | null;
  reelUrl: string | null;
  updatedAt?: string | null;
  incentive?: DealsIncentive | null;
  homes: GatedHome[];
};

export type GatedLead = { display: string; expiresAt: string; name: string | null; timeline: string | null; teamPreview: boolean };
export type HomeRequest = { card: string; requestType: "tour" | "ask" };
export type ProfileInput = { name?: string; timeline?: "0-3 months" | "3-6 months" | "6-12 months" | "12+ months" };

export const PHOTOS_ON_REQUEST = "Photos on request";
const TIMELINES = ["0-3 months", "3-6 months", "6-12 months", "12+ months"] as const;

export function countdownLabel(expiresAt: string, now: number) {
  const seconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
  return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Listing photos are per-lead renders behind the session cookie; the markup never carries a storage URL. */
export function ProtectedGallery({ photos }: { photos?: string[] }) {
  if (!photos?.length) return <div className="mt-4 flex aspect-[4/3] w-full min-w-0 max-w-full items-center justify-center border border-border bg-secondary px-4 text-center text-xs text-muted-foreground">{PHOTOS_ON_REQUEST}</div>;
  return <Carousel className="mt-4 w-full min-w-0 max-w-full overflow-hidden" opts={{ loop: photos.length > 1 }}><CarouselContent className="ml-0 min-w-0">{photos.map((src, index) => <CarouselItem key={src} className="min-w-0 basis-full pl-0"><img src={src} alt={`Home photo ${index + 1}`} loading="lazy" decoding="async" draggable={false} onContextMenu={(event) => event.preventDefault()} className="block aspect-[4/3] w-full min-w-0 max-w-full select-none object-cover [-webkit-touch-callout:none]" /></CarouselItem>)}</CarouselContent>{photos.length > 1 && <><CarouselPrevious aria-label="Previous home photo" className="left-2 z-10 bg-background/90" /><CarouselNext aria-label="Next home photo" className="right-2 z-10 bg-background/90" /></>}</Carousel>;
}

function NamePrompt({ onSave, saving, onDismiss }: { onSave?: (input: ProfileInput) => void; saving?: boolean; onDismiss: () => void }) {
  const [name, setName] = useState("");
  const [timeline, setTimeline] = useState("");
  return <section aria-label="Add your name" className="mt-8 border border-gold/30 bg-gold/5 p-5"><button type="button" onClick={onDismiss} className="float-right text-muted-foreground hover:text-gold" aria-label="Dismiss name prompt"><X className="h-4 w-4" /></button><h2 className="text-2xl">Add your name so we know who to text.</h2><div className="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3"><Input placeholder="Your name" aria-label="Your name" value={name} onChange={(event) => setName(event.target.value)} /><select aria-label="When are you looking to buy?" value={timeline} onChange={(event) => setTimeline(event.target.value)} className="h-10 w-full min-w-0 max-w-full border border-input bg-transparent px-3 text-sm"><option value="">When are you looking?</option>{TIMELINES.map((option) => <option key={option}>{option}</option>)}</select><Button type="button" disabled={saving} onClick={() => onSave?.({ name: name.trim() || undefined, timeline: (TIMELINES as readonly string[]).includes(timeline) ? timeline as ProfileInput["timeline"] : undefined })} className="bg-gold text-primary-foreground">{saving ? "Saving…" : "Save"}</Button></div></section>;
}

function HomeCard({ home, teamPreview, onRequest }: { home: GatedHome; teamPreview: boolean; onRequest?: (request: HomeRequest) => void }) {
  const toBeBuilt = home.kind === "to_be_built";
  const dropped = Boolean(home.previousPrice && home.price && home.price < home.previousPrice);
  return <article className="min-w-0 max-w-full overflow-hidden border border-border bg-card p-5">
    <div className="flex items-start justify-between gap-4"><p className="eyebrow text-gold">{toBeBuilt ? "To Be Built" : "Available now"}</p>{dropped && <span className="bg-gold px-2 py-1 text-[10px] uppercase tracking-widest text-primary-foreground">Price drop</span>}</div>
    <ProtectedGallery photos={home.photos} />
    <h3 className="mt-3 text-3xl">{home.price ? money.format(home.price) : "Ask for current pricing"}</h3>
    {dropped && home.previousPrice && <p className="mt-1 text-sm text-muted-foreground line-through">{money.format(home.previousPrice)}</p>}
    <p className="mt-4 text-sm text-muted-foreground">{[home.beds && `${home.beds} beds`, home.baths && `${home.baths} baths`, home.sqft && `${home.sqft.toLocaleString()} sq ft`].filter(Boolean).join(" · ")}</p>
    {home.moveInDate && <p className="mt-2 text-sm text-muted-foreground">Est. move-in: {home.moveInDate}</p>}
    {home.lotSize && <p className="mt-1 text-sm text-muted-foreground">Lot: {home.lotSize}</p>}
    {teamPreview ? <p className="mt-6 border border-gold/35 px-4 py-3 text-center text-xs uppercase tracking-widest text-gold">Team preview</p> : <Button type="button" onClick={() => onRequest?.({ card: home.card, requestType: toBeBuilt ? "ask" : "tour" })} className="mt-6 w-full bg-gold text-primary-foreground">{toBeBuilt ? "Ask about this one" : "Tour this home with us"}</Button>}
  </article>;
}

/**
 * The personal list after unlock. Pure presentation: data arrives from the
 * session-cookie query, and the page background repeats the lead's identity as
 * a faint pattern (the same text burned into every photo).
 */
export function GatedCatalog({ lead, communities, now, onRequest, onSaveProfile, savingProfile }: { lead: GatedLead; communities: GatedCommunity[]; now: number; onRequest?: (request: HomeRequest) => void; onSaveProfile?: (input: ProfileInput) => void; savingProfile?: boolean }) {
  const [promptDismissed, setPromptDismissed] = useState(false);
  const timer = countdownLabel(lead.expiresAt, now);
  const updatedAt = communities.map((community) => community.updatedAt).filter((value): value is string => Boolean(value)).sort().at(-1);
  return <main data-deals-gated="true" style={identityPatternStyle(lead.display)} className="min-h-screen max-w-full overflow-x-clip bg-background">
    <header className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border/60 px-5 py-5"><Link href="/" className="font-serif text-sm tracking-[0.14em]">LIFESTYLE DESIGN <span className="text-gold">REALTY</span></Link><span className="text-xs text-gold"><Clock3 className="mr-1 inline h-3.5 w-3.5" /> {timer}</span></header>
    <section className="px-5 py-10 sm:px-8"><div className="mx-auto max-w-5xl">
      <div className="border-b border-border pb-7"><p className="eyebrow text-gold">Private buyer list{lead.teamPreview ? " · Team preview" : ""}</p><h1 className="mt-2 break-words text-4xl sm:text-5xl">Prepared for {lead.display}</h1><p className="mt-3 text-sm text-muted-foreground">Updated {formatChicagoDate(updatedAt)}. Your access expires in {timer}.</p></div>
      {!promptDismissed && !lead.name && <NamePrompt onSave={onSaveProfile} saving={savingProfile} onDismiss={() => setPromptDismissed(true)} />}
      <div className="mt-10 space-y-12">{communities.map((community) => <section key={community.label} className="border-t border-border pt-8">
        <p className="eyebrow text-gold">{community.area}{community.schoolDistrict ? ` · ${community.schoolDistrict}` : ""}</p>
        <h2 className="mt-2 text-4xl">{community.label}</h2>
        <AreaMap chips={community.driveTimes} map={community.areaMap} />
        {community.lotSizes && <p className="mt-2 text-sm text-muted-foreground">{community.lotSizes}</p>}
        <div className="mt-5"><ReelCard reelUrl={community.reelUrl} label={community.label} /></div>
        <div className="mt-5"><Incentive incentive={community.incentive} /></div>
        {community.amenities && community.amenities.length > 0 && <div className="mt-5 flex flex-wrap gap-2">{community.amenities.map((item) => <span key={item} className="border border-border px-3 py-1.5 text-xs text-muted-foreground">{item}</span>)}</div>}
        <div className="mt-7 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2">{community.homes.map((home) => <HomeCard key={home.card} home={home} teamPreview={lead.teamPreview} onRequest={onRequest} />)}</div>
      </section>)}</div>
    </div></section>
    <DealsFooter />
  </main>;
}
