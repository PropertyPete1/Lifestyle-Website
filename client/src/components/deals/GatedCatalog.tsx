import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ComingSoonSection, type ComingSoonItem } from "./ComingSoon";
import { Link } from "wouter";
import { ArrowDown, ArrowDownUp, Bath, BedDouble, Check, ChevronDown, Clock3, ExternalLink, Flame, Heart, Plus, Ruler, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/useMobile";
import { Button } from "@/components/ui/button";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious, type CarouselApi } from "@/components/ui/carousel";
import { identityPatternStyle } from "@/lib/dealsIdentityPattern";
import { PROFILE_NAME_MAX, PROFILE_TIMELINES, profileInput, type ProfileInput } from "@/lib/dealsMine";
import { AreaMap } from "./AreaMap";
import { Countdown } from "./Countdown";
import { DealsFooter, Incentive, NewBadge, RedHotBadge, RedHotSavings, ReelCard, RetryImage, formatChicagoDate, money, type DealsIncentive } from "./shared";
import { FeaturedDeals, type FeaturedDealsData } from "./FeaturedDeals";
import { BrowseBar, BROWSE_COPY, ShowMore } from "./BrowseBar";
import { AutoMore, LandingBrowse, sheetHistory, type BrowseListContext, type LandingCommunity, type PublicHome } from "./LandingBrowse";
import { redHotDeal } from "@shared/dealsFeatured";
import { BROWSE_PAGE, BROWSE_SORTS, EMPTY_FILTERS, OPEN_ALL_UP_TO, numberFrom, newThisWeekKnown, sortGatedCommunities, sortHomes, storiesKnown, builderChoices, dealSelection, gatedCommunityVisible, homeFiltersOn, homesMatching, type BrowseFilters } from "@/lib/dealsBrowse";

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
  garage?: string | null;
  stories?: number | null;
  price?: number | null;
  previousPrice?: number | null;
  moveInDate?: string | null;
  lotSize?: string | null;
  photos?: string[];
  details?: GatedHomeDetails | null;
  isNew?: boolean;
};

export type GatedCommunityDetails = { builderName?: string | null; communityName?: string | null; address?: string | null; salesLine?: string | null; builderPage?: string | null };
export type GatedCommunity = {
  /** Opaque handle for the page (open/closed state); not a database id. */
  key?: string;
  /** The community whose reel this buyer commented on: first, and open. */
  fromYourReel?: boolean;
  label: string;
  area: string;
  schoolDistrict?: string | null;
  lotSizes?: string | null;
  amenities?: string[];
  driveTimes?: unknown;
  areaMap?: unknown;
  /** The region map marker (the ZIP centroid's coarse cell), like the landing page's. */
  pin?: { x: number; y: number } | null;
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
/** Arrows stay readable on bright exteriors and dark interiors alike, with a near-44 px tap target. */
const GALLERY_ARROW = "z-10 size-10 border-white/30 bg-black/60 text-white shadow-md hover:bg-black/75 hover:text-white dark:border-white/30 dark:bg-black/60 dark:hover:bg-black/75";

export function ProtectedGallery({ photos: all }: { photos?: string[] }) {
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  // A photo that will not load (after its retries) leaves the gallery instead of showing a broken frame.
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  const photos = all?.filter((src) => !broken.has(src));
  useEffect(() => {
    if (!api) return;
    const onSelect = () => setCurrent(api.selectedScrollSnap());
    onSelect();
    api.on("select", onSelect);
    api.on("reInit", onSelect);
    return () => { api.off("select", onSelect); api.off("reInit", onSelect); };
  }, [api]);
  if (!photos?.length) return <div className="mt-4 flex aspect-[4/3] w-full min-w-0 max-w-full items-center justify-center border border-border bg-secondary px-4 text-center text-xs text-muted-foreground">{PHOTOS_ON_REQUEST}</div>;
  const many = photos.length > 1;
  return <Carousel setApi={setApi} className="relative mt-4 w-full min-w-0 max-w-full overflow-hidden" opts={{ loop: many }}>
    <CarouselContent className="ml-0 min-w-0 bg-secondary">{photos.map((src, index) => <CarouselItem key={src} className="min-w-0 basis-full pl-0"><RetryImage src={src} onGiveUp={() => setBroken((current) => new Set(current).add(src))} alt={`Home photo ${index + 1} of ${photos.length}`} loading="lazy" decoding="async" draggable={false} onContextMenu={(event) => event.preventDefault()} className="block aspect-[4/3] w-full min-w-0 max-w-full select-none bg-secondary object-cover [-webkit-touch-callout:none]" /></CarouselItem>)}</CarouselContent>
    {many && <>
      <CarouselPrevious aria-label="Previous home photo" className={`left-2 ${GALLERY_ARROW}`} />
      <CarouselNext aria-label="Next home photo" className={`right-2 ${GALLERY_ARROW}`} />
      <p data-deals-photo-count="true" className="pointer-events-none absolute bottom-2 right-2 z-10 bg-black/60 px-2 py-1 text-[11px] font-medium tracking-wider text-white">{current + 1} / {photos.length}</p>
    </>}
  </Carousel>;
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

/** Oct 26, 2026: an agent picks homes for a client; the picks ride the client link. Team view only. */
export type PickControl = { picked: ReadonlySet<string>; onToggle: (card: string) => void; /** Oct 27, 2026: "Send this home": pick it (keeping other picks) and go to the client form. */ sendOne?: (card: string) => void };

export function PickButton({ picked, onToggle }: { picked: boolean; onToggle: () => void }) {
  return <button type="button" aria-pressed={picked} aria-label={picked ? "Picked for your client. Tap to remove" : "Pick this home for a client"} onClick={onToggle} data-deals-pick={picked ? "picked" : "unpicked"} className={`flex min-h-11 items-center gap-2 border px-3 text-xs uppercase tracking-widest transition-colors ${picked ? "border-gold bg-gold text-primary-foreground" : "border-border text-muted-foreground hover:border-gold hover:text-gold"}`}>{picked ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{picked ? "Picked" : "Pick for client"}</button>;
}

function HomeCard({ home, teamPreview, saved, saving, onRequest, onSave, pick }: { home: GatedHome; teamPreview: boolean; saved: boolean; saving?: boolean; onRequest?: (request: HomeRequest) => void; onSave?: (card: string, saved: boolean) => void; pick?: PickControl }) {
  const toBeBuilt = home.kind === "to_be_built";
  const details = home.details ?? null;
  const picked = pick?.picked.has(home.card) ?? false;
  return <article id={`home-${home.card}`} data-deals-picked={picked ? "true" : undefined} className={`min-w-0 max-w-full scroll-mt-6 overflow-hidden border bg-card p-5 ${picked ? "border-gold shadow-[0_0_0_1px_var(--color-gold)]" : "border-border"}`}>
    <div className="flex items-start justify-between gap-4"><p className="eyebrow text-gold">{toBeBuilt ? "To Be Built" : "Available now"}</p><span className="flex flex-wrap justify-end gap-2"><RedHotBadge price={home.price} previousPrice={home.previousPrice} /><NewBadge isNew={home.isNew} /></span></div>
    <ProtectedGallery photos={home.photos} />
    <h3 className="mt-3 text-3xl">{home.price ? money.format(home.price) : "Ask for current pricing"}</h3>
    <RedHotSavings price={home.price} previousPrice={home.previousPrice} />
    {details && (details.address || details.planName) && <p className="mt-3 text-sm text-foreground" data-deals-home-details="true">{[details.planName, details.address].filter(Boolean).join(" · ")}</p>}
    <p className="mt-4 text-sm text-muted-foreground">{[home.beds && `${home.beds} beds`, home.baths && `${home.baths} baths`, home.sqft && `${home.sqft.toLocaleString()} sq ft`, numberFrom(home.garage) && `${numberFrom(home.garage)}-car garage`, home.stories && `${home.stories} ${home.stories === 1 ? "story" : "stories"}`].filter(Boolean).join(" · ")}</p>
    {home.moveInDate && <p className="mt-2 text-sm text-muted-foreground">Est. move-in: {home.moveInDate}</p>}
    {home.lotSize && <p className="mt-1 text-sm text-muted-foreground">Lot: {home.lotSize}</p>}
    {details?.builderPage && <a href={details.builderPage} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-1 text-xs uppercase tracking-widest text-gold underline-offset-4 hover:underline">Builder page <ExternalLink className="h-3.5 w-3.5" /></a>}
    {/* Wraps on a narrow phone instead of clipping the request button. */}
    <div className="mt-6 flex flex-wrap items-stretch gap-3">
      {onSave && <SaveButton saved={saved} saving={saving} onToggle={() => onSave(home.card, !saved)} />}
      {pick && <PickButton picked={picked} onToggle={() => pick.onToggle(home.card)} />}
      {teamPreview ? (pick ? null : <p className="flex min-w-[10rem] flex-1 items-center justify-center border border-gold/35 px-4 py-3 text-center text-xs uppercase tracking-widest text-gold">Team view</p>) : <Button type="button" onClick={() => onRequest?.({ card: home.card, requestType: toBeBuilt ? "ask" : "tour" })} className="h-auto min-h-11 min-w-[10rem] flex-1 whitespace-normal bg-gold text-primary-foreground">{toBeBuilt ? "Ask about this one" : "Tour this home with us"}</Button>}
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
  /** The Coming Soon section under the list: area and price band only, the same for every visitor. */
  comingSoon?: readonly ComingSoonItem[];
  onRequest?: (request: HomeRequest) => void;
  onSaveProfile?: (input: ProfileInput) => void;
  savingProfile?: boolean;
  /** A saved profile hides the prompt before the refetched lead arrives. */
  profileSaved?: boolean;
  profileError?: string | null;
  /** The countdown reached 00:00:00: the owner refetches rather than leaving stale listings up. */
  onExpire?: () => void;
  /** Best Deals across every community; each deal jumps to its home's card. */
  featured?: FeaturedDealsData | null;
  /** Called with a community's key when the buyer opens it (every open community on a short list). */
  onViewCommunity?: (key: string) => void;
  /** Team view: every home card gets a Pick button and the picked set is shown. */
  pick?: PickControl;
  /** A client's list: the card handles their agent picked for them, shown first in the agent's order. */
  picks?: readonly string[];
};

/**
 * The personal list after unlock. Pure presentation: data arrives from the
 * session-cookie query, and the page background repeats the lead's identity as
 * a faint pattern (the same text burned into every photo).
 */
/** Jump to a featured home's card on this page. */
export function scrollToHomeCard(card: string | undefined) {
  if (!card || typeof document === "undefined") return;
  document.getElementById(`home-${card}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function communityKey(community: GatedCommunity, index: number) {
  return community.key ?? `${community.label}#${index}`;
}

/** One community: a tappable summary row on a long list, the full section when open. */
function CommunitySection({ community, homes, open, onToggle, autoLoadReel, teamPreview, savedSet, savingCard, onRequest, onSave, id, pick }: {
  community: GatedCommunity; homes: GatedHome[]; open: boolean; onToggle?: () => void; autoLoadReel: boolean; teamPreview: boolean; savedSet: Set<string>; savingCard?: string | null;
  onRequest?: (request: HomeRequest) => void; onSave?: (card: string, saved: boolean) => void; id: string; pick?: PickControl;
}) {
  const prices = homes.map((home) => home.price).filter((price): price is number => typeof price === "number" && price > 0);
  const from = prices.length ? Math.min(...prices) : community.fromPrice ?? null;
  const ready = homes.filter((home) => home.kind === "quick_move_in").length;
  const summary = [from ? `From ${money.format(from)}` : null, ready ? `${ready} quick move-in` : `${homes.length} home${homes.length === 1 ? "" : "s"}`, community.incentive?.headlineRate ? "Builder rate offer" : null].filter(Boolean).join(" · ");
  return <section className="border-t border-border pt-8" data-deals-community={open ? "open" : "closed"}>
    {onToggle
      ? <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={id} className="flex w-full min-w-0 items-start justify-between gap-4 text-left">
          <span className="min-w-0"><span className="eyebrow block text-gold">{community.area}{community.schoolDistrict ? ` · ${community.schoolDistrict}` : ""}{community.fromYourReel ? " · From your reel" : ""}</span><span className="mt-2 block break-words font-serif text-3xl leading-tight sm:text-4xl">{community.label}</span><span className="mt-2 block text-sm text-muted-foreground">{summary}</span></span>
          <ChevronDown className={`mt-2 h-5 w-5 shrink-0 text-gold transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
      : <><p className="eyebrow text-gold">{community.area}{community.schoolDistrict ? ` · ${community.schoolDistrict}` : ""}</p><h2 className="mt-2 text-4xl">{community.label}</h2></>}
    {open && <div id={id}>
      <CommunityDetails details={community.details} />
      {community.lotSizes && <p className="mt-2 text-sm text-muted-foreground">{community.lotSizes}</p>}
      <div className="mt-5"><ReelCard reelUrl={community.reelUrl} label={community.label} autoLoad={autoLoadReel} poster={community.homes.find((home) => home.photos?.length)?.photos?.[0] ?? null} /></div>
      {/* The area map sits right under the reel: the general area, never the community. */}
      <AreaMap chips={community.driveTimes} map={community.areaMap} />
      <div className="mt-5"><Incentive incentive={community.incentive} /></div>
      {community.amenities && community.amenities.length > 0 && <div className="mt-5 flex flex-wrap gap-2">{community.amenities.map((item) => <span key={item} className="border border-border px-3 py-1.5 text-xs text-muted-foreground">{item}</span>)}</div>}
      <div className="mt-7 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2">{homes.map((home) => <HomeCard key={home.card} home={home} teamPreview={teamPreview} saved={savedSet.has(home.card)} saving={savingCard === home.card} onRequest={onRequest} onSave={onSave} pick={pick} />)}</div>
    </div>}
  </section>;
}

/** The homes an agent picked, in their order, with the community each sits in (a pick no longer on the list is skipped). */
export function pickedHomes(communities: readonly GatedCommunity[], picks: readonly string[] | undefined): Array<{ home: GatedHome; community: GatedCommunity }> {
  if (!picks?.length) return [];
  const byCard = new Map<string, { home: GatedHome; community: GatedCommunity }>();
  for (const community of communities) for (const home of community.homes) if (!byCard.has(home.card)) byCard.set(home.card, { home, community });
  return picks.flatMap((card) => { const entry = byCard.get(card); return entry ? [entry] : []; });
}

/**
 * Oct 27, 2026: the picked homes as plain text for the agent's clipboard (a CRM note, an e-mail, a text): one line
 * per home with price, specs, the address or plan, the community and when it is ready. The agent sees the full list,
 * so the private names are theirs to paste; a buyer's page never shows this.
 */
export function picksAsText(picked: ReadonlyArray<{ home: GatedHome; community: GatedCommunity }>, listUrl?: string | null): string {
  const spec = (home: GatedHome) => [home.beds ? `${home.beds} bd` : null, home.baths ? `${home.baths} ba` : null, home.sqft ? `${home.sqft.toLocaleString("en-US")} sq ft` : null, home.garage ? `${home.garage} garage` : null].filter(Boolean).join(" · ");
  const ready = (home: GatedHome) => home.kind === "to_be_built" ? "to be built" : home.moveInDate ? `move-in ${home.moveInDate}` : "available now";
  const lines = picked.map(({ home, community }, index) => {
    const where = [home.details?.address, home.details?.planName ? `${home.details.planName} plan` : null].filter(Boolean).join(" · ") || community.label;
    const place = [community.details?.communityName, community.details?.builderName].filter(Boolean).join(" by ") || community.area;
    return `${index + 1}. ${home.price ? money.format(home.price) : "Price on request"}${home.previousPrice && home.price && home.previousPrice > home.price ? ` (was ${money.format(home.previousPrice)})` : ""} — ${spec(home) || "specs on request"}\n   ${where}\n   ${place} · ${ready(home)}`;
  });
  return [`${picked.length} new-build home${picked.length === 1 ? "" : "s"} picked for you:`, "", ...lines, ...(listUrl ? ["", `Photos, prices and this week's incentives: ${listUrl}`] : [])].join("\n");
}

export const PICKS_COPY = {
  heading: (first: string | null | undefined, count: number) => `${first ?? "Your agent"} picked ${count === 1 ? "this home" : `these ${count} homes`} for you`,
  intro: "Start here. The full list is below if you want to see everything else.",
} as const;

/**
 * Oct 27, 2026 (Peter: "the client page is nicer", "where is the map"): the unlocked list as the landing page's cards
 * beside one map. A community as a landing card: its own homes (after the filters) give the price, cover and badges.
 */
export function gatedAsLanding(community: GatedCommunity, key: string, homes: readonly GatedHome[]): LandingCommunity {
  const priced = homes.filter((home) => typeof home.price === "number" && home.price > 0).sort((a, b) => a.price! - b.price!);
  const from = priced[0]?.price ?? community.fromPrice ?? null;
  const first = [...priced, ...homes].find((home) => home.photos?.length)?.photos?.[0];
  const cover = first ? cardPhoto(first) : null;
  return {
    key, label: community.label, area: community.area, schoolDistrict: community.schoolDistrict || null, reelUrl: community.reelUrl, fromYourReel: community.fromYourReel,
    fromPrice: from, fromPriceLabel: from ? `From ${money.format(from)}` : null,
    homesAvailable: homes.filter((home) => home.kind === "quick_move_in").length,
    incentive: (community.incentive ?? null) as LandingCommunity["incentive"], cover, pin: community.pin ?? null,
    redHotDeals: homes.filter((home) => redHotDeal(home.price ?? null, home.previousPrice ?? null)).length,
    newThisWeek: homes.filter((home) => home.isNew).length,
  };
}

export const HOME_LIST_COPY = {
  count: (count: number) => `${count.toLocaleString("en-US")} home${count === 1 ? "" : "s"}`,
  homes: "Homes",
  communities: "Communities",
  moveIn: "Move-in ready",
  build: "Build new",
  pick: "Pick",
  picked: "Picked",
  noPhoto: "Photos on request",
} as const;
export const HOME_PAGE = 24;

/** The street line and the city line of a full address ("118 Main St, San Antonio, TX 78263"). */
export function addressLines(address: string | null | undefined): { street: string; city: string | null } | null {
  if (!address?.trim()) return null;
  const [street, ...rest] = address.split(",").map((part) => part.trim()).filter(Boolean);
  return street ? { street, city: rest.length ? rest.join(", ") : null } : null;
}

/**
 * A home's status the way New Home Buddy words it: "Build new" for a plan, "Move-in ready" when it is ready now, and
 * "Ready Nov 2026" for a home under construction (an ISO date from the builder is shown as month and year).
 */
export function homeStatusLabel(home: Pick<GatedHome, "kind" | "moveInDate">, now = new Date()): string {
  if (home.kind === "to_be_built") return HOME_LIST_COPY.build;
  const raw = home.moveInDate?.trim();
  if (!raw) return HOME_LIST_COPY.moveIn;
  const iso = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(raw);
  if (iso) {
    const date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3] ?? 1)));
    if (date.getTime() <= now.getTime()) return HOME_LIST_COPY.moveIn;
    return `Ready ${new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(date)}`;
  }
  return /now|ready|complete|available/i.test(raw) ? HOME_LIST_COPY.moveIn : `Ready ${raw}`;
}

/**
 * Oct 28, 2026: while the list loads (a few seconds on a freshly started server), the page's own shape shows at once,
 * New Home Buddy style: the header, the filter row, the map and grey home cards, instead of one line on a blank page.
 */
export function ListSkeleton({ label }: { label: string }) {
  const pulse = "animate-pulse bg-foreground/[0.07]";
  return <div className="deals-light min-h-screen bg-background" data-deals-list-skeleton="true" aria-busy="true">
    <header className="deals-chrome flex min-w-0 items-center border-b border-border/60 px-4 py-3 sm:px-6"><span className="font-serif text-sm tracking-[0.14em]">LIFESTYLE DESIGN <span className="text-gold">REALTY</span></span></header>
    <div className="mx-auto max-w-[1600px] px-4 sm:px-6">
      <p role="status" className="pt-3 text-sm text-muted-foreground">{label}</p>
      <div className="mt-3 flex gap-2 overflow-hidden">{Array.from({ length: 8 }, (_, index) => <span key={index} className={`h-10 w-28 shrink-0 rounded-full ${pulse}`} />)}</div>
      <div className="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(360px,44%)_minmax(0,1fr)]">
        <div className={`hidden h-[70vh] rounded-xl lg:block ${pulse}`} />
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">{Array.from({ length: 4 }, (_, index) => <div key={index} className="overflow-hidden rounded-lg border border-border bg-card">
          <div className={`aspect-[16/10] ${pulse}`} />
          <div className="space-y-2 p-3"><span className={`block h-4 w-2/3 rounded ${pulse}`} /><span className={`block h-6 w-1/3 rounded ${pulse}`} /><span className={`block h-3 w-1/2 rounded ${pulse}`} /></div>
        </div>)}</div>
      </div>
    </div>
  </div>;
}

/**
 * A buyer's card has no address or plan to lead with, and its area already sits on the right: the community's own
 * line after "Area | " reads better than the area twice ("Northwest San Antonio | Hal…" beside "Northwest San Antonio").
 */
export function labelHook(label: string, fallback?: string): string {
  const cut = label.indexOf(" | ");
  if (cut < 0) return label;
  // The card shows its own price, so a price band in the line ("From the $300s") is dropped; nothing left, the fallback.
  const hook = label.slice(cut + 3).replace(/\s*(?:\band\s+)?(?:From the \$\d00s|Over \$1M|Under \$100K)(?:\s+and\b)?\s*/g, " ").trim();
  return hook || fallback || label;
}

/** "4-bed new home": a buyer's card title when the community's line is only a price band. */
function homeNoun(home: GatedHome): string {
  return `${home.beds ? `${home.beds}-bed ` : ""}${home.kind === "to_be_built" ? "home to build" : "new home"}`;
}

/**
 * Oct 28, 2026 (Peter: photos showed up a couple of seconds late while scrolling): a list card asks for the card-size
 * render of its photo (a fraction of the full photo's pixels to watermark and send); the opened home keeps full size.
 */
export function cardPhoto(src: string): string {
  return src.startsWith("/deals/mine/img/") && !src.includes("?") ? `${src}?s=card` : src;
}

/** One home in the flat list, like a New Home Buddy card: photo, price, where, and the specs at a glance. */
export function HomeTile({ home, community, onOpen, onHover, pick, saved, saving, onSave, photoPending = false }: { home: GatedHome; community: GatedCommunity; onOpen: () => void; onHover?: (on: boolean) => void; pick?: PickControl; saved?: boolean; saving?: boolean; onSave?: (card: string, saved: boolean) => void; /** The photo is still on its way (the public list reads it per community): a grey frame, not "Photos on request". */ photoPending?: boolean }) {
  const [failed, setFailed] = useState(false);
  const photo = !failed && home.photos?.[0] ? cardPhoto(home.photos[0]) : undefined;
  const lines = addressLines(home.details?.address);
  const plan = home.details?.planName ?? null;
  const title = lines?.street ?? (plan ? `${plan} plan` : labelHook(community.label, homeNoun(home)));
  const subtitle = lines?.city ?? (plan ? community.area : null);
  const place = [community.details?.communityName, community.details?.builderName].filter(Boolean).join(" · ") || community.area;
  const drop = home.previousPrice && home.price && home.previousPrice > home.price ? home.previousPrice - home.price : 0;
  const picked = pick?.picked.has(home.card) ?? false;
  const specs = [
    home.beds ? { icon: BedDouble, text: `${home.beds} bd` } : null,
    home.baths ? { icon: Bath, text: `${home.baths} ba` } : null,
    home.sqft ? { icon: Ruler, text: `${home.sqft.toLocaleString("en-US")} sqft` } : null,
  ].filter((item): item is { icon: typeof Bath; text: string } => Boolean(item));
  return <article id={`tile-${home.card}`} data-deals-home-tile="true" data-deals-picked={picked ? "true" : undefined} onMouseEnter={() => onHover?.(true)} onMouseLeave={() => onHover?.(false)} className={`relative min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md ${picked ? "border-gold ring-2 ring-gold/60" : "border-border"}`}>
    <button type="button" onClick={onOpen} className="block w-full min-w-0 text-left" aria-label={`${title}, ${home.price ? money.format(home.price) : "price on request"}. Open details`}>
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-secondary">
        {photo ? <RetryImage src={photo} alt="" loading="lazy" decoding="async" draggable={false} onGiveUp={() => setFailed(true)} onContextMenu={(event) => event.preventDefault()} className="block h-full w-full select-none object-cover [-webkit-touch-callout:none]" />
          : photoPending ? <div className="h-full w-full animate-pulse bg-foreground/[0.06]" aria-hidden="true" />
          : <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">{HOME_LIST_COPY.noPhoto}</div>}
        {community.details?.builderName && <span data-deals-tile-builder="true" className="pointer-events-none absolute bottom-2 right-2 max-w-[60%] truncate rounded-sm bg-white/95 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-foreground shadow">{community.details.builderName}</span>}
        <div className="pointer-events-none absolute left-2 top-2 flex flex-wrap gap-1">
          {/* One badge for a cut price: red for a Red Hot Deal, green like New Home Buddy's for any other drop. */}
          {drop > 0 && <span data-deals-tile-drop={redHotDeal(home.price ?? null, home.previousPrice ?? null) ? "red-hot" : "drop"} className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-white shadow ${redHotDeal(home.price ?? null, home.previousPrice ?? null) ? "bg-red-600" : "bg-emerald-700"}`}>{redHotDeal(home.price ?? null, home.previousPrice ?? null) ? <Flame className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{money.format(drop)}</span>}
          <NewBadge isNew={home.isNew} />
        </div>
      </div>
      <div className="min-w-0 p-3">
        <div className="flex min-w-0 items-start justify-between gap-2"><p className="min-w-0 truncate text-sm font-medium text-foreground">{title}</p><p className="max-w-[48%] shrink-0 truncate text-right text-xs text-muted-foreground" title={place}>{place}</p></div>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        <p className="mt-2 flex min-w-0 flex-wrap items-baseline gap-x-2">{home.kind === "to_be_built" && home.price ? <span className="text-xs text-muted-foreground">Starting from</span> : null}<span className="text-xl font-semibold leading-none">{home.price ? money.format(home.price) : "Ask for pricing"}</span><span className="text-xs text-muted-foreground">{homeStatusLabel(home)}</span></p>
        {specs.length > 0 && <p className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">{specs.map(({ icon: Icon, text }) => <span key={text} className="inline-flex items-center gap-1"><Icon className="h-3.5 w-3.5" />{text}</span>)}</p>}
      </div>
    </button>
    {pick
      ? <button type="button" aria-pressed={picked} aria-label={picked ? "Picked for your client. Tap to remove" : "Pick this home for a client"} onClick={() => pick.onToggle(home.card)} data-deals-pick={picked ? "picked" : "unpicked"} className={`absolute right-2 top-2 inline-flex min-h-9 items-center gap-1 rounded-full px-3 text-[11px] font-semibold uppercase tracking-wider shadow ${picked ? "bg-gold text-primary-foreground" : "bg-white/95 text-foreground hover:text-gold"}`}>{picked ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}{picked ? HOME_LIST_COPY.picked : HOME_LIST_COPY.pick}</button>
      : onSave ? <button type="button" aria-pressed={saved} aria-label={saved ? "Saved. Tap to unsave" : "Save this home"} disabled={saving} onClick={() => onSave(home.card, !saved)} data-deals-save={saved ? "saved" : "unsaved"} className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-white/95 shadow"><Heart className={`h-4 w-4 ${saved ? "fill-red-600 text-red-600" : "text-foreground"}`} /></button> : null}
  </article>;
}

/**
 * Oct 27, 2026 (New Home Buddy opens a home on its photos): the home a card opened, shown first in its community's
 * sheet: a photo grid (one big, four small, "See all"), the price and where, the specs, and the card's own buttons.
 */
export function HomeHero({ home, community, teamPreview, pick, saved, saving, onSave, onRequest, agent }: { home: GatedHome; community: GatedCommunity; teamPreview: boolean; pick?: PickControl; saved?: boolean; saving?: boolean; onSave?: (card: string, saved: boolean) => void; onRequest?: (request: HomeRequest) => void; /** A client's agent: New Home Buddy's "Get more info" card, as a text to them. */ agent?: GatedAgent }) {
  const [shown, setShown] = useState<number | null>(null);
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  const photos = (home.photos ?? []).filter((src) => !broken.has(src));
  const lines = addressLines(home.details?.address);
  const plan = home.details?.planName ?? null;
  const title = lines?.street ?? (plan ? `${plan} plan` : labelHook(community.label, homeNoun(home)));
  /** What a text to the agent names: the street, the plan, or the community's whole line. */
  const named = lines?.street ?? (plan ? `${plan} plan` : community.label);
  const place = [community.details?.communityName, community.details?.builderName].filter(Boolean).join(" by ") || community.area;
  const toBeBuilt = home.kind === "to_be_built";
  const picked = pick?.picked.has(home.card) ?? false;
  const grid = photos.length >= 5;
  // While the photo viewer is open, Escape and the arrow keys belong to it (not to the sheet, which closes on Escape).
  useEffect(() => {
    if (shown === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopImmediatePropagation(); setShown(null); }
      else if (event.key === "ArrowRight") setShown((value) => value === null ? value : (value + 1) % photos.length);
      else if (event.key === "ArrowLeft") setShown((value) => value === null ? value : (value + photos.length - 1) % photos.length);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [shown, photos.length]);
  // The phone's back button closes the photos first, then the home (New Home Buddy), never the page.
  const viewerOpen = shown !== null;
  useEffect(() => viewerOpen ? sheetHistory(() => setShown(null)) : undefined, [viewerOpen]);
  // The big photo shows its card-size copy (already loaded by the list) until the full one arrives; the small ones are cards.
  const tile = (src: string, index: number, className: string) => <button key={src} type="button" onClick={() => setShown(index)} style={index === 0 ? { backgroundImage: `url("${cardPhoto(src)}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined} className={`relative min-h-0 min-w-0 overflow-hidden bg-secondary ${className}`} aria-label={`Photo ${index + 1} of ${photos.length}`}>
    <RetryImage src={index === 0 ? src : cardPhoto(src)} alt="" loading={index === 0 ? "eager" : "lazy"} decoding="async" draggable={false} onGiveUp={() => setBroken((current) => new Set(current).add(src))} onContextMenu={(event) => event.preventDefault()} className="block h-full w-full select-none object-cover [-webkit-touch-callout:none]" />
  </button>;
  return <section aria-label={`${title}, the home you opened`} className="min-w-0 p-5 pt-14 sm:p-6 sm:pt-6">
    {photos.length === 0
      ? <div className="flex aspect-[16/7] w-full items-center justify-center rounded-xl bg-secondary text-sm text-muted-foreground">{PHOTOS_ON_REQUEST}</div>
      : <div className={`relative grid h-[38vh] min-h-[220px] gap-1.5 overflow-hidden rounded-xl ${grid ? "grid-cols-4 grid-rows-2" : "grid-cols-1"}`} data-deals-hero-photos={photos.length}>
          {grid ? <>{tile(photos[0]!, 0, "col-span-4 row-span-2 sm:col-span-2")}{photos.slice(1, 5).map((src, index) => tile(src, index + 1, "hidden sm:block"))}</> : tile(photos[0]!, 0, "")}
          {photos.length > 1 && <button type="button" onClick={() => setShown(0)} className="absolute bottom-3 right-3 rounded-md bg-black/70 px-3 py-1.5 text-xs font-semibold text-white">See all {photos.length} photos</button>}
        </div>}
    <div className="mt-4 flex min-w-0 flex-wrap items-start justify-between gap-x-6 gap-y-2">
      <div className="min-w-0">
        <h2 className="break-words font-serif text-2xl leading-tight sm:text-3xl">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{[lines?.city, place].filter(Boolean).join(" · ")}</p>
        <p className="mt-2 text-sm text-foreground">{[home.beds && `${home.beds} beds`, home.baths && `${home.baths} baths`, home.sqft && `${home.sqft.toLocaleString("en-US")} sq ft`, numberFrom(home.garage) && `${numberFrom(home.garage)}-car garage`, home.stories && `${home.stories} ${home.stories === 1 ? "story" : "stories"}`, home.lotSize && `Lot ${home.lotSize}`].filter(Boolean).join(" · ")}</p>
      </div>
      <div className="text-left sm:text-right">
        <p className="text-3xl font-semibold leading-none">{home.price ? money.format(home.price) : "Ask for pricing"}</p>
        <RedHotSavings price={home.price} previousPrice={home.previousPrice} />
        <p className="mt-1 text-sm text-muted-foreground">{homeStatusLabel(home)}</p>
      </div>
    </div>
    <div className="mt-4 flex flex-wrap items-stretch gap-3">
      {onSave && <SaveButton saved={Boolean(saved)} saving={saving} onToggle={() => onSave(home.card, !saved)} />}
      {pick && <PickButton picked={picked} onToggle={() => pick.onToggle(home.card)} />}
      {pick?.sendOne && <Button type="button" onClick={() => pick.sendOne!(home.card)} data-deals-send-one="true" className="h-auto min-h-11 whitespace-normal bg-gold px-5 text-primary-foreground">Send this home to a client</Button>}
      {!teamPreview && <Button type="button" onClick={() => onRequest?.({ card: home.card, requestType: toBeBuilt ? "ask" : "tour" })} className="h-auto min-h-11 whitespace-normal bg-gold px-6 text-primary-foreground">{toBeBuilt ? "Ask about this one" : "Tour this home with us"}</Button>}
      {home.details?.builderPage && <a href={home.details.builderPage} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 px-2 text-xs uppercase tracking-widest text-gold underline-offset-4 hover:underline">Builder page <ExternalLink className="h-3.5 w-3.5" /></a>}
    </div>
    {!teamPreview && agent?.phone && <div className="mt-4 flex min-w-0 flex-wrap items-center justify-between gap-3 border border-gold/30 bg-gold/5 px-4 py-3" data-deals-hero-agent="true">
      <p className="min-w-0 text-sm"><span className="block text-[10px] uppercase tracking-[0.2em] text-gold">Questions about this home?</span><span className="font-medium">{agent.name}</span> <span className="text-muted-foreground">· Lifestyle Design Realty</span></p>
      <a href={`sms:${agent.phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(`Hi ${agent.firstName ?? agent.name}, I have a question about ${named} (${home.price ? money.format(home.price) : "this home"}).`)}`} className="inline-flex min-h-11 items-center rounded-full bg-foreground px-5 text-sm font-semibold text-background">Text {agent.firstName ?? agent.name}</a>
    </div>}
    {community.updatedAt && <p className="mt-3 text-[11px] text-muted-foreground">Last checked with the builder {formatChicagoDate(community.updatedAt)}</p>}
    {shown !== null && photos[shown] && <div role="dialog" aria-modal="true" aria-label="Photos" data-deals-photo-viewer="true" className="fixed inset-0 z-[110] flex flex-col bg-black" onClick={() => setShown(null)}>
      <div className="flex items-center justify-between p-3 text-sm text-white"><span>{shown + 1} / {photos.length}</span><button type="button" onClick={() => setShown(null)} aria-label="Close photos" className="flex h-11 w-11 items-center justify-center"><X className="h-6 w-6" /></button></div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-6" onClick={(event) => event.stopPropagation()}>
        <RetryImage key={photos[shown]} src={photos[shown]!} alt={`Photo ${shown + 1} of ${photos.length}`} draggable={false} onContextMenu={(event) => event.preventDefault()} className="max-h-full max-w-full select-none object-contain" />
        {photos.length > 1 && <><button type="button" aria-label="Previous photo" onClick={() => setShown((shown + photos.length - 1) % photos.length)} className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-2xl text-white">‹</button>
        <button type="button" aria-label="Next photo" onClick={() => setShown((shown + 1) % photos.length)} className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-2xl text-white">›</button></>}
      </div>
    </div>}
  </section>;
}

/** What the home search matches: the street address, plan, community label and area, community name and builder. */
export function homeSearchText(home: GatedHome, community: GatedCommunity): string {
  return [home.details?.address, home.details?.planName, community.label, community.area, community.details?.communityName, community.details?.builderName].filter(Boolean).join(" ").toLowerCase();
}

/** The flat list: every matching home in the communities in view, sorted, 24 at a time as the reader scrolls. */
function HomeList({ entries, context, pick, savedSet, savingCard, onSave }: { entries: ReadonlyArray<{ home: GatedHome; community: GatedCommunity; key: string }>; context: BrowseListContext; pick?: PickControl; savedSet: Set<string>; savingCard?: string | null; onSave?: (card: string, saved: boolean) => void }) {
  const inView = entries.filter((entry) => context.keys.has(entry.key));
  const [pages, setPages] = useState(1);
  const keysSignature = Array.from(context.keys).join(",");
  useEffect(() => setPages(1), [keysSignature, entries]);
  const shown = inView.slice(0, pages * HOME_PAGE);
  return <div data-deals-home-list="true">
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
      {shown.map(({ home, community, key }) => <HomeTile key={home.card} home={home} community={community} onOpen={() => context.open(key, { card: home.card })} onHover={(on) => context.hover(on ? key : null)} pick={pick} saved={savedSet.has(home.card)} saving={savingCard === home.card} onSave={onSave} />)}
    </div>
    <AutoMore key={shown.length} active={inView.length > shown.length} onNear={() => setPages((value) => value + 1)} />
    <ShowMore remaining={inView.length - shown.length} step={HOME_PAGE} onClick={() => setPages((value) => value + 1)} />
  </div>;
}

export function GatedCatalog({ lead, communities, now, saved, savingCard, onSave, agent, tools, onRequest, onSaveProfile, savingProfile, profileSaved, profileError, onExpire, featured, onViewCommunity, comingSoon, pick, picks }: GatedCatalogProps) {
  const [promptDismissed, setPromptDismissed] = useState(false);
  const pickedForMe = useMemo(() => pickedHomes(communities, picks), [communities, picks]);
  const updatedAt = communities.map((community) => community.updatedAt).filter((value): value is string => Boolean(value)).sort().at(-1);
  const savedSet = new Set(saved ?? []);
  // Saved homes that are still on this list (a saved home that sold or went off the list is not counted or filtered on).
  const savedOnList = new Set(communities.flatMap((community) => community.homes.map((home) => home.card)).filter((card) => savedSet.has(card)));
  const savedGone = savedSet.size - savedOnList.size;
  const eyebrow = lead.teamPreview ? "Team view" : agent ? `Shared by ${agent.name}` : "Private buyer list";
  // A short list shows everything open, as before. A list of every community opens only the buyer's own (or the first).
  const many = communities.length > OPEN_ALL_UP_TO;
  /** The header's "Agent tools" link is for a team member on their own list; on the team page it would point at itself. */
  const onTeamPage = typeof window !== "undefined" && window.location.pathname.startsWith("/deals/team");
  const [filters, setFilters] = useState<BrowseFilters>(EMPTY_FILTERS);
  const [pages, setPages] = useState(1);
  const [opened, setOpened] = useState<Set<string>>(() => new Set(communities.flatMap((community, index) => (community.fromYourReel || index === 0) ? [communityKey(community, index)] : [])));
  const [pendingCard, setPendingCard] = useState<string | null>(null);
  const homeFilters = homeFiltersOn(filters, savedOnList);
  // The Saved filter turns itself off once nothing saved is left on the list (its toggle is hidden then).
  useEffect(() => { if (filters.savedOnly && savedOnList.size === 0) setFilters((current) => ({ ...current, savedOnly: false })); }, [filters.savedOnly, savedOnList.size]);
  const savedKey = (saved ?? []).join(",");
  // The visible communities in the chosen order (judged by the homes each one shows after the filters), then paged.
  const matching = useMemo(() => {
    const visible = communities.map((community, index) => ({ community, index, key: communityKey(community, index), homes: homeFiltersOn(filters, savedOnList) ? homesMatching(community, filters, savedOnList) : community.homes })).filter(({ community }) => gatedCommunityVisible(community, filters, savedOnList));
    return sortGatedCommunities(visible, filters.sort);
  }, [communities, filters, savedKey]);
  const visible = many ? matching.slice(0, pages * BROWSE_PAGE) : matching;
  const homeCount = communities.reduce((total, community) => total + community.homes.length, 0);
  const shownHomes = matching.reduce((total, { community }) => total + (homeFilters ? homesMatching(community, filters, savedOnList) : community.homes).length, 0);
  // The cards-and-map layout (a long list): every community as a landing card, its sheet showing the homes that match.
  const landing = useMemo(() => matching.map(({ community, key, homes }) => gatedAsLanding(community, key, homes)), [matching]);
  const landingAll = useMemo(() => communities.map((community, index) => gatedAsLanding(community, communityKey(community, index), community.homes)), [communities]);
  const byKey = useMemo(() => new Map(communities.map((community, index) => [communityKey(community, index), community])), [communities]);
  const matchingHomes = useMemo(() => new Map(matching.map(({ key, homes }) => [key, homes])), [matching]);
  // Oct 27, 2026: homes first, like New Home Buddy; the community cards are one tap away.
  const [listView, setListView] = useState<"homes" | "communities">("homes");
  // New Home Buddy's "Search homes by address": a street, plan, community or builder narrows the homes.
  const [homeQuery, setHomeQuery] = useState("");
  // A phone's search box is narrow: a short hint that fits instead of one cut off mid-word.
  const phone = useIsMobile();
  // The communities a map bubble narrowed the list to; the count in the results bar follows it.
  const [areaKeys, setAreaKeys] = useState<ReadonlySet<string> | null>(null);
  const homeEntries = useMemo(() => {
    const needle = homeQuery.trim().toLowerCase();
    const entries = matching.flatMap(({ community, key, homes }) => homes.map((home) => ({ home, community, key })))
      .filter(({ home, community }) => !needle || homeSearchText(home, community).includes(needle));
    return filters.sort === "recommended" ? entries : sortHomes(entries.map((entry) => ({ ...entry.home, entry })), filters.sort).map((item) => item.entry);
  }, [matching, filters.sort, homeQuery]);
  const keyByCard = useMemo(() => new Map(communities.flatMap((community, index) => community.homes.map((home) => [home.card, communityKey(community, index)] as const))), [communities]);
  const useSheetHomes = (key: string | undefined) => {
    const community = key ? byKey.get(key) : undefined;
    const homes = key ? matchingHomes.get(key) : undefined;
    return { isLoading: false, data: (homes?.length ? sortHomes(homes, filters.sort) : sortHomes(community?.homes ?? [], filters.sort)) as unknown as PublicHome[] };
  };
  // A Best Deals tap opens that home's community (clearing filters that hide it) and scrolls to the card once it is on the page.
  const selectDeal = (card: string | undefined) => {
    if (!card) return;
    const selection = dealSelection(communities, card, filters, { many, pages, visibleIndexes: matching.map((entry) => entry.index) }, savedOnList);
    if (selection.index < 0) return scrollToHomeCard(card);
    if (selection.clearFilters) setFilters(EMPTY_FILTERS);
    if (selection.pages !== null) setPages(selection.pages);
    setOpened((current) => new Set(current).add(communityKey(communities[selection.index]!, selection.index)));
    setPendingCard(card);
  };
  // Every open community counts as viewed once per page load (the list already holds one row per hour server-side).
  const [reported] = useState(() => new Set<string>());
  useEffect(() => {
    if (!onViewCommunity) return;
    for (const { community, key } of visible) {
      if ((!many || opened.has(key)) && community.key && !reported.has(key)) { reported.add(key); onViewCommunity(community.key); }
    }
  }, [visible, opened, many, onViewCommunity, reported]);
  useEffect(() => {
    if (!pendingCard || typeof window === "undefined") return;
    const frame = window.requestAnimationFrame(() => { scrollToHomeCard(pendingCard); setPendingCard(null); });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingCard, opened, pages, filters]);
  return <main data-deals-gated="true" style={identityPatternStyle(lead.display)} className="deals-light min-h-screen max-w-full overflow-x-clip bg-background [overflow-anchor:none]">
    <header className={`deals-chrome flex min-w-0 items-center justify-between gap-x-3 gap-y-2 border-b border-border/60 ${many ? "flex-nowrap px-4 py-3 sm:px-6" : "flex-wrap px-5 py-5"}`}><span className="flex min-w-0 items-center gap-4"><Link href="/" className="shrink-0 font-serif text-sm tracking-[0.14em]">LIFESTYLE DESIGN <span className="text-gold">REALTY</span></Link>
      {/* Oct 28, 2026 (New Home Buddy: "Lifestyle Design Realty's New Home Search / Prepared by" sits in the header bar). */}
      {many && <span className="hidden min-w-0 border-l border-white/20 pl-4 sm:block" data-deals-header-title="true"><span className="block text-[10px] uppercase tracking-[0.2em] text-gold">{eyebrow}</span><h1 className="truncate font-serif text-lg leading-tight">Prepared for {lead.display}</h1></span>}</span><span className="flex items-center gap-4 text-xs text-gold">{lead.teamPreview && !onTeamPage && <Link href="/deals/team" className={`${many ? "hidden sm:inline-flex" : "inline-flex"} min-h-11 items-center underline-offset-4 hover:underline`}>Agent tools</Link>}{/* Oct 28, 2026: an agent's 90-day sign-in needs no clock in the header (New Home Buddy has none); a buyer's list does. */}<span className={lead.teamPreview ? "sr-only" : undefined}><Clock3 className="mr-1 inline h-3.5 w-3.5" /> <Countdown expiresAt={lead.expiresAt} now={now} onExpire={onExpire} /></span></span></header>
    <section className={many ? "px-4 py-3 sm:px-6" : "px-5 py-10 sm:px-8"}><div className={`mx-auto ${many ? "max-w-[1600px]" : "max-w-5xl"}`}>
      {many
        // Oct 27, 2026 (New Home Buddy: a title line, then straight to the homes): one line instead of a hero heading.
        ? null
        : <div className="border-b border-border pb-7"><p className="eyebrow text-gold">{eyebrow}</p><h1 className="mt-2 break-words text-4xl sm:text-5xl">Prepared for {lead.display}</h1><p className="mt-3 text-sm text-muted-foreground">Updated {formatChicagoDate(updatedAt)}. Your access expires in <Countdown expiresAt={lead.expiresAt} now={now} />.</p></div>}
      <div>{agent && !lead.teamPreview && <p className="mt-3 text-sm text-foreground" data-deals-agent-note="true">Shared with you by {agent.name}. Tap Save on any home and {agent.firstName ?? "your agent"} hears about it right away.{agent.phone ? ` Questions? Text ${agent.firstName ?? agent.name} at ${agent.phone}.` : ""}</p>}</div>
      {tools}
      {!promptDismissed && !profileSaved && !lead.name && !lead.teamPreview && <NamePrompt onSave={onSaveProfile} saving={savingProfile} error={profileError} onDismiss={() => setPromptDismissed(true)} />}
      {pickedForMe.length > 0 && <section aria-labelledby="deals-picked" data-deals-picked-for-you="true" className="mt-8 border border-gold/40 bg-gold/5 p-5 sm:p-6">
        <p className="eyebrow text-gold">Picked for you</p>
        <h2 id="deals-picked" className="mt-2 text-3xl sm:text-4xl">{PICKS_COPY.heading(agent?.firstName ?? agent?.name, pickedForMe.length)}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{PICKS_COPY.intro}</p>
        <div className="mt-6 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2">{pickedForMe.map(({ home, community }) => <div key={`pick-${home.card}`} className="min-w-0"><p className="mb-2 truncate text-xs uppercase tracking-widest text-muted-foreground">{community.label}</p><HomeCard home={{ ...home, card: `pick-${home.card}` }} teamPreview={lead.teamPreview} saved={savedSet.has(home.card)} saving={savingCard === home.card} onRequest={onRequest ? (request) => onRequest({ ...request, card: home.card }) : undefined} onSave={onSave ? (_card, next) => onSave(home.card, next) : undefined} /></div>)}</div>
      </section>}
      {many ? <>
      {(many || savedOnList.size > 0) && <BrowseBar compact filters={filters} onChange={(next) => {
        // Turning Saved on opens the communities that hold a saved home; each can still be collapsed.
        if (next.savedOnly && !filters.savedOnly) setOpened((current) => new Set([...Array.from(current), ...communities.flatMap((community, index) => community.homes.some((home) => savedOnList.has(home.card)) ? [communityKey(community, index)] : [])]));
        setFilters(next); setPages(1);
      }} areas={communities} shown={shownHomes} total={homeCount} unit="homes" showBeds savedCount={savedOnList.size} showStories={storiesKnown(communities)} showNew={newThisWeekKnown(communities)} builders={lead.teamPreview ? builderChoices(communities) : []} />}
      {(filters.savedOnly || savedOnList.size === 0) && savedGone > 0 && <p role="status" className="mt-3 text-xs text-muted-foreground" data-deals-saved-gone="true">{savedGone === 1 ? "1 home you saved is no longer available." : `${savedGone} homes you saved are no longer available.`}</p>}
      {(many || savedOnList.size > 0) && matching.length === 0 && <p role="status" className="mt-8 text-sm text-muted-foreground">{filters.savedOnly && savedOnList.size > 0 ? BROWSE_COPY.noneSaved : BROWSE_COPY.none}</p>}
        {/* Phone: count + Homes/Communities, then search + sort. Wider: count, search, sort, toggle in one row. */}
        <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2" data-deals-results-bar="true">
          <p className="order-1 text-sm font-semibold uppercase tracking-widest text-foreground" data-deals-result-count="true">{listView === "homes" ? HOME_LIST_COPY.count(areaKeys ? homeEntries.filter((entry) => areaKeys.has(entry.key)).length : homeQuery.trim() ? homeEntries.length : shownHomes) : `${areaKeys ? areaKeys.size : matching.length} communities`}</p>
          {listView === "homes" && <label className="order-3 min-w-0 flex-1 sm:order-2 sm:max-w-sm"><span className="sr-only">Search homes by address</span><input type="search" value={homeQuery} onChange={(event) => setHomeQuery(event.target.value)} placeholder={phone ? "Address or plan" : "Search address, plan, community, builder"} data-deals-home-search="true" className="min-h-9 w-full rounded-full border border-border bg-card px-4 text-sm" /></label>}
          <label className="order-4 inline-flex min-h-9 min-w-0 max-w-[11rem] shrink-0 items-center gap-1.5 rounded-full border border-border bg-card pl-3 text-xs text-foreground sm:order-3 sm:ml-auto sm:max-w-none" data-deals-sort="true"><ArrowDownUp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="sr-only">Sort</span>
            <select aria-label="Sort" value={filters.sort} onChange={(event) => { setFilters((current) => ({ ...current, sort: event.target.value as BrowseFilters["sort"] })); setPages(1); }} className="min-h-9 min-w-0 bg-transparent pr-3 text-xs">{BROWSE_SORTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          </label>
          <div role="group" aria-label="Show homes or communities" className="order-2 inline-flex rounded-full border border-border bg-card p-0.5 text-xs sm:order-4">
            {(["homes", "communities"] as const).map((value) => <button key={value} type="button" aria-pressed={listView === value} data-deals-list-view={value} onClick={() => setListView(value)} className={`min-h-9 rounded-full px-3 font-medium sm:px-4 ${listView === value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>{value === "homes" ? HOME_LIST_COPY.homes : HOME_LIST_COPY.communities}</button>)}
          </div>
          {listView === "homes" && <span className="order-2 basis-full sm:hidden" aria-hidden="true" />}
        </div>
        <LandingBrowse mapSide="left" phoneMap="floating" searchArea onAreaChange={(keys) => setAreaKeys(keys ? new Set(keys) : null)} areaStatus={listView === "homes" ? (keys) => { const inArea = new Set(keys); const homes = homeEntries.filter((entry) => inArea.has(entry.key)).length; return `Showing ${HOME_LIST_COPY.count(homes)} in this part of town`; } : undefined} communities={landing} lookup={landingAll} floatingMapBottom={pick && pick.picked.size > 0 ? "bottom-24" : "bottom-6"} useHomes={useSheetHomes} filters={{ ...EMPTY_FILTERS, sort: filters.sort }}
          renderList={listView === "homes" ? (context) => <HomeList entries={homeEntries} context={context} pick={pick} savedSet={savedSet} savingCard={savingCard} onSave={onSave} /> : undefined}
          onOpenCommunity={(key) => { const community = byKey.get(key); if (community?.key && onViewCommunity && !reported.has(key)) { reported.add(key); onViewCommunity(community.key); } }}
          top={listView === "homes" ? undefined : (actions) => <FeaturedDeals featured={featured} onSelect={(deal) => {
            const key = deal.card ? keyByCard.get(deal.card) : undefined;
            if (!key) return;
            // A featured home the filters hide: the filters go so its sheet shows it.
            if (!(matchingHomes.get(key) ?? []).some((home) => home.card === deal.card)) setFilters(EMPTY_FILTERS);
            actions.openHome(key, { card: deal.card });
          }} />}
          sheet={{
            unlock: false, share: false, publicAreaMap: false,
            focusHero: (home, item) => { const community = item.key ? byKey.get(item.key) : undefined; return community ? <HomeHero home={home as unknown as GatedHome} community={community} teamPreview={lead.teamPreview} agent={agent} pick={pick} saved={savedSet.has(home.card)} saving={savingCard === home.card} onSave={onSave} onRequest={onRequest} /> : null; },
            details: (item) => { const community = item.key ? byKey.get(item.key) : undefined; return community ? <><CommunityDetails details={community.details} />{community.lotSizes && <p className="mt-2 text-sm text-muted-foreground">{community.lotSizes}</p>}</> : null; },
            area: (item) => { const community = item.key ? byKey.get(item.key) : undefined; return community ? <><AreaMap chips={community.driveTimes} map={community.areaMap} />{community.amenities && community.amenities.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{community.amenities.map((amenity) => <span key={amenity} className="border border-border px-3 py-1.5 text-xs text-muted-foreground">{amenity}</span>)}</div>}</> : null; },
            renderHome: (home, featuredHome) => <div className={featuredHome ? "ring-2 ring-gold/60" : undefined} data-deals-featured-home={featuredHome ? "true" : undefined}><HomeCard home={home as unknown as GatedHome} teamPreview={lead.teamPreview} saved={savedSet.has(home.card)} saving={savingCard === home.card} onRequest={onRequest} onSave={onSave} pick={pick} /></div>,
          }}
          below={<ComingSoonSection items={comingSoon} action={{ kind: "text", phone: !lead.teamPreview ? agent?.phone ?? null : null, name: !lead.teamPreview ? agent?.firstName ?? agent?.name ?? null : null }} />} />
      </> : <>
      <FeaturedDeals featured={featured} onSelect={(deal) => selectDeal(deal.card)} />
      {(many || savedOnList.size > 0) && <BrowseBar filters={filters} onChange={(next) => {
        // Turning Saved on opens the communities that hold a saved home; each can still be collapsed.
        if (next.savedOnly && !filters.savedOnly) setOpened((current) => new Set([...Array.from(current), ...communities.flatMap((community, index) => community.homes.some((home) => savedOnList.has(home.card)) ? [communityKey(community, index)] : [])]));
        setFilters(next); setPages(1);
      }} areas={communities} shown={shownHomes} total={homeCount} unit="homes" showBeds savedCount={savedOnList.size} showStories={storiesKnown(communities)} showNew={newThisWeekKnown(communities)} builders={lead.teamPreview ? builderChoices(communities) : []} />}
      {(filters.savedOnly || savedOnList.size === 0) && savedGone > 0 && <p role="status" className="mt-3 text-xs text-muted-foreground" data-deals-saved-gone="true">{savedGone === 1 ? "1 home you saved is no longer available." : `${savedGone} homes you saved are no longer available.`}</p>}
      {(many || savedOnList.size > 0) && matching.length === 0 && <p role="status" className="mt-8 text-sm text-muted-foreground">{filters.savedOnly && savedOnList.size > 0 ? BROWSE_COPY.noneSaved : BROWSE_COPY.none}</p>}
      <div className="mt-10 space-y-12">{visible.map(({ community, key, homes }, position) => <CommunitySection key={key} id={`deals-community-${position}`} community={community} homes={sortHomes(homes, filters.sort)} open={!many || opened.has(key)} onToggle={many ? () => setOpened((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; }) : undefined} autoLoadReel={!many || position === 0} teamPreview={lead.teamPreview} savedSet={savedSet} savingCard={savingCard} onRequest={onRequest} onSave={onSave} pick={pick} />)}</div>
      {many && <ShowMore remaining={matching.length - visible.length} onClick={() => setPages((value) => value + 1)} />}
      <ComingSoonSection items={comingSoon} action={{ kind: "text", phone: !lead.teamPreview ? agent?.phone ?? null : null, name: !lead.teamPreview ? agent?.firstName ?? agent?.name ?? null : null }} />
      </>}
    </div></section>
    <DealsFooter agentSignIn={!lead.teamPreview} />
  </main>;
}
