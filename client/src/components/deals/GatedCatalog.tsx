import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { Clock3, ExternalLink, Heart, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { identityPatternStyle } from "@/lib/dealsIdentityPattern";
import { PROFILE_NAME_MAX, PROFILE_TIMELINES, profileInput, type ProfileInput } from "@/lib/dealsMine";
import { AreaMap } from "./AreaMap";
import { Countdown } from "./Countdown";
import { DealsFooter, Incentive, ReelCard, formatChicagoDate, money, type DealsIncentive } from "./shared";

export { countdownLabel } from "@/lib/dealsMine";
export type { ProfileInput } from "@/lib/dealsMine";

/**
 * Hand-built server objects only: no builder, community, plan, street, lot or
 * listing identifiers exist on these shapes for a reel buyer. `details` is
 * present only on the full list the server builds for the team and for buyers
 * an LDR agent sent through a client link.
 */
export type GatedHomeDetails = { address?: string | null; planName?: string | null; builderPage?: string | null };
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
  details?: GatedHomeDetails | null;
};

export type GatedCommunityDetails = { builderName?: string | null; communityName?: string | null; address?: string | null; salesLine?: string | null; builderPage?: string | null };
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
  details?: GatedCommunityDetails | null;
};

export type GatedLead = { display: string; expiresAt: string; name: string | null; timeline: string | null; teamPreview: boolean; agentClient?: boolean };
/** The agent who shared the list with this buyer, as the page may name them. */
export type GatedAgent = { name: string; firstName?: string | null; phone: string | null } | null;
export type HomeRequest = { card: string; requestType: "tour" | "ask" };

export const PHOTOS_ON_REQUEST = "Photos on request";
/** Close controls keep a 44 px tap target on a phone. */
const CLOSE_BUTTON = "float-right -mr-2 -mt-2 flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-gold";

/** Listing photos are per-lead renders behind the session cookie; the markup never carries a storage URL. */
export function ProtectedGallery({ photos }: { photos?: string[] }) {
  if (!photos?.length) return <div className="mt-4 flex aspect-[4/3] w-full min-w-0 max-w-full items-center justify-center border border-border bg-secondary px-4 text-center text-xs text-muted-foreground">{PHOTOS_ON_REQUEST}</div>;
  return <Carousel className="mt-4 w-full min-w-0 max-w-full overflow-hidden" opts={{ loop: photos.length > 1 }}><CarouselContent className="ml-0 min-w-0">{photos.map((src, index) => <CarouselItem key={src} className="min-w-0 basis-full pl-0"><img src={src} alt={`Home photo ${index + 1}`} loading="lazy" decoding="async" draggable={false} onContextMenu={(event) => event.preventDefault()} className="block aspect-[4/3] w-full min-w-0 max-w-full select-none object-cover [-webkit-touch-callout:none]" /></CarouselItem>)}</CarouselContent>{photos.length > 1 && <><CarouselPrevious aria-label="Previous home photo" className="left-2 z-10 bg-background/90" /><CarouselNext aria-label="Next home photo" className="right-2 z-10 bg-background/90" /></>}</Carousel>;
}

function NamePrompt({ onSave, saving, error, onDismiss }: { onSave?: (input: ProfileInput) => void; saving?: boolean; error?: string | null; onDismiss: () => void }) {
  const [name, setName] = useState("");
  const [timeline, setTimeline] = useState("");
  // Save stays disabled until there is something the server will accept (a 2+ character
  // name or a timeline), so an empty tap never reaches the CRM.
  const input = profileInput(name, timeline);
  return <section aria-label="Add your name" className="mt-8 border border-gold/30 bg-gold/5 p-5"><button type="button" onClick={onDismiss} className={CLOSE_BUTTON} aria-label="Dismiss name prompt"><X className="h-4 w-4" /></button><h2 className="text-2xl">Add your name so we know who to text.</h2><div className="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3"><Input placeholder="Your name" aria-label="Your name" maxLength={PROFILE_NAME_MAX} value={name} onChange={(event) => setName(event.target.value)} className="min-h-11" /><select aria-label="When are you looking to buy?" value={timeline} onChange={(event) => setTimeline(event.target.value)} className="min-h-11 w-full min-w-0 max-w-full border border-input bg-transparent px-3 text-sm"><option value="">When are you looking?</option>{PROFILE_TIMELINES.map((option) => <option key={option}>{option}</option>)}</select><Button type="button" disabled={saving || !input} onClick={() => { if (input) onSave?.(input); }} className="min-h-11 bg-gold text-primary-foreground">{saving ? "Saving…" : "Save"}</Button></div>{error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}</section>;
}

/** The heart on every card. Saving tells the team (and the buyer's agent) once per home; tapping again just unsaves. */
export function SaveButton({ saved, saving, onToggle }: { saved: boolean; saving?: boolean; onToggle?: () => void }) {
  return <button type="button" aria-pressed={saved} aria-label={saved ? "Saved. Tap to unsave" : "Save this home"} disabled={saving} onClick={onToggle} data-deals-save={saved ? "saved" : "unsaved"} className={`flex min-h-11 items-center gap-2 border px-3 text-xs uppercase tracking-widest transition-colors ${saved ? "border-gold bg-gold/10 text-gold" : "border-border text-muted-foreground hover:text-gold"}`}><Heart className={`h-4 w-4 ${saved ? "fill-current" : ""}`} />{saved ? "Saved" : "Save"}</button>;
}

function HomeCard({ home, teamPreview, saved, saving, onRequest, onSave }: { home: GatedHome; teamPreview: boolean; saved: boolean; saving?: boolean; onRequest?: (request: HomeRequest) => void; onSave?: (card: string, saved: boolean) => void }) {
  const toBeBuilt = home.kind === "to_be_built";
  const dropped = Boolean(home.previousPrice && home.price && home.price < home.previousPrice);
  const details = home.details ?? null;
  return <article className="min-w-0 max-w-full overflow-hidden border border-border bg-card p-5">
    <div className="flex items-start justify-between gap-4"><p className="eyebrow text-gold">{toBeBuilt ? "To Be Built" : "Available now"}</p>{dropped && <span className="bg-gold px-2 py-1 text-[10px] uppercase tracking-widest text-primary-foreground">Price drop</span>}</div>
    <ProtectedGallery photos={home.photos} />
    <h3 className="mt-3 text-3xl">{home.price ? money.format(home.price) : "Ask for current pricing"}</h3>
    {dropped && home.previousPrice && <p className="mt-1 text-sm text-muted-foreground line-through">{money.format(home.previousPrice)}</p>}
    {details && (details.address || details.planName) && <p className="mt-3 text-sm text-foreground" data-deals-home-details="true">{[details.planName, details.address].filter(Boolean).join(" · ")}</p>}
    <p className="mt-4 text-sm text-muted-foreground">{[home.beds && `${home.beds} beds`, home.baths && `${home.baths} baths`, home.sqft && `${home.sqft.toLocaleString()} sq ft`].filter(Boolean).join(" · ")}</p>
    {home.moveInDate && <p className="mt-2 text-sm text-muted-foreground">Est. move-in: {home.moveInDate}</p>}
    {home.lotSize && <p className="mt-1 text-sm text-muted-foreground">Lot: {home.lotSize}</p>}
    {details?.builderPage && <a href={details.builderPage} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-1 text-xs uppercase tracking-widest text-gold underline-offset-4 hover:underline">Builder page <ExternalLink className="h-3.5 w-3.5" /></a>}
    {/* Wraps on a narrow phone instead of clipping the request button. */}
    <div className="mt-6 flex flex-wrap items-stretch gap-3">
      {onSave && <SaveButton saved={saved} saving={saving} onToggle={() => onSave(home.card, !saved)} />}
      {teamPreview ? <p className="flex min-w-[10rem] flex-1 items-center justify-center border border-gold/35 px-4 py-3 text-center text-xs uppercase tracking-widest text-gold">Team view</p> : <Button type="button" onClick={() => onRequest?.({ card: home.card, requestType: toBeBuilt ? "ask" : "tour" })} className="h-auto min-h-11 min-w-[10rem] flex-1 whitespace-normal bg-gold text-primary-foreground">{toBeBuilt ? "Ask about this one" : "Tour this home with us"}</Button>}
    </div>
  </article>;
}

/** The community's private identity for the full list; a reel buyer's payload has no such block. */
function CommunityDetails({ details }: { details?: GatedCommunityDetails | null }) {
  if (!details || (!details.builderName && !details.communityName && !details.address)) return null;
  return <div className="mt-3 border border-gold/30 bg-gold/5 p-4 text-sm" data-deals-community-details="true">
    <p className="text-foreground">{[details.builderName, details.communityName].filter(Boolean).join(" · ")}</p>
    {details.address && <p className="mt-1 text-muted-foreground">{details.address}</p>}
    {details.salesLine && <p className="mt-1 text-muted-foreground">Sales office: {details.salesLine}</p>}
    {details.builderPage && <a href={details.builderPage} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-11 items-center gap-1 text-xs uppercase tracking-widest text-gold underline-offset-4 hover:underline">Builder community page <ExternalLink className="h-3.5 w-3.5" /></a>}
  </div>;
}

export type GatedCatalogProps = {
  lead: GatedLead;
  communities: GatedCommunity[];
  /** Fixed clock for server rendering and tests; omitted in the browser so the countdown ticks on its own. */
  now?: number;
  /** Opaque card handles the buyer has saved. */
  saved?: string[];
  savingCard?: string | null;
  onSave?: (card: string, saved: boolean) => void;
  /** The agent who shared this list (agent-client sessions only). */
  agent?: GatedAgent;
  /** Rendered between the heading and the communities: the team's agent tools. */
  tools?: ReactNode;
  onRequest?: (request: HomeRequest) => void;
  onSaveProfile?: (input: ProfileInput) => void;
  savingProfile?: boolean;
  /** A saved profile hides the prompt before the refetched lead arrives. */
  profileSaved?: boolean;
  profileError?: string | null;
  /** The countdown reached 00:00:00: the owner refetches rather than leaving stale listings up. */
  onExpire?: () => void;
};

/**
 * The personal list after unlock. Pure presentation: data arrives from the
 * session-cookie query, and the page background repeats the lead's identity as
 * a faint pattern (the same text burned into every photo).
 */
export function GatedCatalog({ lead, communities, now, saved, savingCard, onSave, agent, tools, onRequest, onSaveProfile, savingProfile, profileSaved, profileError, onExpire }: GatedCatalogProps) {
  const [promptDismissed, setPromptDismissed] = useState(false);
  const updatedAt = communities.map((community) => community.updatedAt).filter((value): value is string => Boolean(value)).sort().at(-1);
  const savedSet = new Set(saved ?? []);
  const eyebrow = lead.teamPreview ? "Team view" : agent ? `Shared by ${agent.name}` : "Private buyer list";
  return <main data-deals-gated="true" style={identityPatternStyle(lead.display)} className="min-h-screen max-w-full overflow-x-clip bg-background">
    <header className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border/60 px-5 py-5"><Link href="/" className="font-serif text-sm tracking-[0.14em]">LIFESTYLE DESIGN <span className="text-gold">REALTY</span></Link><span className="flex items-center gap-4 text-xs text-gold">{lead.teamPreview && <Link href="/deals/team" className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">Agent tools</Link>}<span><Clock3 className="mr-1 inline h-3.5 w-3.5" /> <Countdown expiresAt={lead.expiresAt} now={now} onExpire={onExpire} /></span></span></header>
    <section className="px-5 py-10 sm:px-8"><div className="mx-auto max-w-5xl">
      <div className="border-b border-border pb-7"><p className="eyebrow text-gold">{eyebrow}</p><h1 className="mt-2 break-words text-4xl sm:text-5xl">Prepared for {lead.display}</h1><p className="mt-3 text-sm text-muted-foreground">Updated {formatChicagoDate(updatedAt)}. Your access expires in <Countdown expiresAt={lead.expiresAt} now={now} />.</p>{agent && !lead.teamPreview && <p className="mt-3 text-sm text-foreground" data-deals-agent-note="true">Shared with you by {agent.name}. Tap Save on any home and {agent.firstName ?? "your agent"} hears about it right away.{agent.phone ? ` Questions? Text ${agent.firstName ?? agent.name} at ${agent.phone}.` : ""}</p>}</div>
      {tools}
      {!promptDismissed && !profileSaved && !lead.name && !lead.teamPreview && <NamePrompt onSave={onSaveProfile} saving={savingProfile} error={profileError} onDismiss={() => setPromptDismissed(true)} />}
      <div className="mt-10 space-y-12">{communities.map((community, index) => <section key={index} className="border-t border-border pt-8">
        <p className="eyebrow text-gold">{community.area}{community.schoolDistrict ? ` · ${community.schoolDistrict}` : ""}</p>
        <h2 className="mt-2 text-4xl">{community.label}</h2>
        <CommunityDetails details={community.details} />
        <AreaMap chips={community.driveTimes} map={community.areaMap} />
        {community.lotSizes && <p className="mt-2 text-sm text-muted-foreground">{community.lotSizes}</p>}
        <div className="mt-5"><ReelCard reelUrl={community.reelUrl} label={community.label} /></div>
        <div className="mt-5"><Incentive incentive={community.incentive} /></div>
        {community.amenities && community.amenities.length > 0 && <div className="mt-5 flex flex-wrap gap-2">{community.amenities.map((item) => <span key={item} className="border border-border px-3 py-1.5 text-xs text-muted-foreground">{item}</span>)}</div>}
        <div className="mt-7 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2">{community.homes.map((home) => <HomeCard key={home.card} home={home} teamPreview={lead.teamPreview} saved={savedSet.has(home.card)} saving={savingCard === home.card} onRequest={onRequest} onSave={onSave} />)}</div>
      </section>)}</div>
    </div></section>
    <DealsFooter />
  </main>;
}
