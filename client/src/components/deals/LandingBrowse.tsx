import { useEffect, useMemo, useRef, useState } from "react";
import { Home, LockKeyhole, MapPin, Play, X } from "lucide-react";
import { AreaMap } from "./AreaMap";
import { Incentive, ReelCard, type DealsIncentive } from "./shared";
import { ShowMore } from "./BrowseBar";
import { BROWSE_PAGE } from "@/lib/dealsBrowse";

/**
 * The landing page's list, laid out like a home search: photo cards beside one
 * map of the market. Hovering a card lights its marker and hovering a marker
 * lights its card; a marker group narrows the list to that part of town. A card
 * opens the community's sheet: the video tour at full size, the general area,
 * the offer and the unlock button. Everything here comes from the public
 * catalog: opaque keys, price bands and coarse map points only.
 */
export type LandingCommunity = {
  key?: string;
  label: string;
  area: string;
  fromPrice?: number | null;
  fromPriceLabel?: string | null;
  reelUrl: string | null;
  homesAvailable: number;
  incentive?: (DealsIncentive & { pending?: true }) | null;
  areaMap?: unknown;
  fromYourReel?: boolean;
  cover?: string | null;
  pin?: { x: number; y: number } | null;
};

export const LANDING_COPY = {
  homesReady: (count: number) => `${count} move-in ready home${count === 1 ? "" : "s"}`,
  toBeBuilt: "Build new: pick your plan",
  photosSoon: "Photos coming soon",
  videoTour: "Video tour",
  fromYourReel: "From your reel",
  rate: (badge: { rate: string; apr: string }) => `${badge.rate} rate · ${badge.apr} APR`,
  areaFilter: (count: number) => `Showing ${count} in this part of town`,
  clearArea: "Show all",
  mapLabel: "Map of the communities",
  mapAttribution: "Map data and imagery from Google. Markers show the general area only, never the community.",
  showMap: "Show map",
  hideMap: "Hide map",
  unlock: "Unlock homes, photos and prices",
  close: "Close",
} as const;

/** The builder's rate and its APR (Reg Z: a rate is never printed without its APR); null when either is missing. */
export function rateBadge(incentive: LandingCommunity["incentive"]): { rate: string; apr: string } | null {
  if (!incentive || incentive.pending || !incentive.headlineRate || !incentive.apr) return null;
  const percent = (value: string) => /(\d{1,2}(?:\.\d{1,3})?)\s*%?/.exec(value)?.[1];
  const rate = percent(incentive.headlineRate);
  const apr = percent(incentive.apr);
  return rate && apr ? { rate: `${rate}%`, apr: `${apr}%` } : null;
}

const keyOf = (community: LandingCommunity, index: number) => community.key ?? `${community.label}-${index}`;

export function CommunityCard({ community, active, onHover, onOpen }: { community: LandingCommunity; active: boolean; onHover: (on: boolean) => void; onOpen: () => void }) {
  const [failed, setFailed] = useState(false);
  const rate = rateBadge(community.incentive);
  const cover = community.cover && !failed ? community.cover : null;
  return <article data-deals-card="true" data-active={active ? "true" : undefined} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} className={`min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md ${active ? "border-gold ring-2 ring-gold/60" : "border-border"}`}>
    <button type="button" onClick={onOpen} onFocus={() => onHover(true)} onBlur={() => onHover(false)} className="block w-full min-w-0 text-left">
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-secondary">
        {cover
          ? <img src={cover} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} onContextMenu={(event) => event.preventDefault()} className="block h-full w-full select-none object-cover [-webkit-touch-callout:none]" />
          : <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground"><Home className="h-8 w-8" /><span className="text-xs">{LANDING_COPY.photosSoon}</span></div>}
        <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5">
          {community.fromYourReel && <span className="rounded-full bg-gold px-2.5 py-1 text-[11px] font-semibold text-primary-foreground shadow">{LANDING_COPY.fromYourReel}</span>}
          {rate && <span data-deals-card-rate="true" className="rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-foreground shadow">{LANDING_COPY.rate(rate)}</span>}
        </div>
        {community.reelUrl && <span className="pointer-events-none absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-medium text-white"><Play className="h-3 w-3 fill-current" />{LANDING_COPY.videoTour}</span>}
      </div>
      <div className="min-w-0 p-4">
        {community.fromPriceLabel && <p className="text-xl font-semibold leading-tight text-foreground">{community.fromPriceLabel}</p>}
        <p className="mt-1 break-words text-sm leading-snug text-foreground">{community.label}</p>
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3.5 w-3.5 shrink-0" />{community.area}</p>
        <p className="mt-2 text-xs font-medium text-gold">{community.homesAvailable > 0 ? LANDING_COPY.homesReady(community.homesAvailable) : LANDING_COPY.toBeBuilt}</p>
        <span className="sr-only">Open details</span>
      </div>
    </button>
  </article>;
}

type Marker = { id: string; x: number; y: number; keys: string[]; label: string };

/** Markers closer than this share one numbered bubble (fractions of the map's width). */
const GROUP_CELL = 0.045;

/** One marker per community, grouped where they overlap; a group shows its count, a lone community its price band. */
export function groupMarkers(items: ReadonlyArray<{ key: string; pin?: { x: number; y: number } | null; fromPriceLabel?: string | null }>): Marker[] {
  const groups = new Map<string, { xs: number[]; ys: number[]; keys: string[]; labels: string[] }>();
  for (const item of items) {
    if (!item.pin) continue;
    const id = `${Math.floor(item.pin.x / GROUP_CELL)}:${Math.floor(item.pin.y / GROUP_CELL)}`;
    const group = groups.get(id) ?? { xs: [], ys: [], keys: [], labels: [] };
    group.xs.push(item.pin.x); group.ys.push(item.pin.y); group.keys.push(item.key); group.labels.push((item.fromPriceLabel ?? "").replace(/^From the /, ""));
    groups.set(id, group);
  }
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  return Array.from(groups.entries()).map(([id, group]) => ({ id, x: mean(group.xs), y: mean(group.ys), keys: group.keys, label: group.keys.length > 1 ? String(group.keys.length) : group.labels[0] || "1" }));
}

export function RegionMap({ items, activeKey, onHover, onSelect, selectedId }: {
  items: ReadonlyArray<{ key: string; pin?: { x: number; y: number } | null; fromPriceLabel?: string | null }>;
  activeKey: string | null;
  onHover: (key: string | null) => void;
  onSelect: (marker: { id: string; keys: string[] } | null) => void;
  selectedId: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const markers = useMemo(() => groupMarkers(items), [items]);
  if (failed) return null;
  return <figure aria-label={LANDING_COPY.mapLabel} data-deals-region-map="true" className="min-w-0">
    <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-border bg-secondary shadow-sm">
      <img src="/deals/maps/region.webp" alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} className="block h-full w-full select-none object-cover" />
      {markers.map((marker) => {
        const lit = (activeKey !== null && marker.keys.includes(activeKey)) || selectedId === marker.id;
        const group = marker.keys.length > 1;
        // A group is a numbered bubble; a lone community is a dot that shows its price band when lit.
        const shape = group ? "min-h-7 min-w-7 px-1.5 text-[11px]" : lit ? "min-h-7 px-2 text-[11px]" : "h-4 w-4";
        return <button key={marker.id} type="button" data-deals-marker={group ? "group" : "single"} data-active={lit ? "true" : undefined}
          aria-label={group ? `${marker.keys.length} communities here. Show them` : `Community ${marker.label}. Show it`}
          onMouseEnter={() => onHover(group ? null : marker.keys[0]!)} onMouseLeave={() => onHover(null)}
          onClick={() => onSelect(selectedId === marker.id ? null : { id: marker.id, keys: marker.keys })}
          style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }}
          className={`absolute inline-flex -translate-x-1/2 -translate-y-1/2 before:absolute before:-inset-3 before:content-[''] items-center justify-center whitespace-nowrap rounded-full border-2 border-white font-semibold shadow-md transition-transform ${shape} ${lit ? "z-20 scale-110 bg-gold text-primary-foreground" : "z-10 bg-[oklch(0.25_0.02_260)] text-white hover:scale-110"}`}>
          {group || lit ? marker.label : null}
        </button>;
      })}
    </div>
    <figcaption className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{LANDING_COPY.mapAttribution}</figcaption>
  </figure>;
}

export function CommunitySheet({ community, onClose, onUnlock }: { community: LandingCommunity; onClose: () => void; onUnlock: () => void }) {
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  // The latest close handler, so the effect below runs once per opening (not on every parent render).
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    // Focus moves into the sheet, stays there while it is open, and goes back to the card that opened it.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { close.current(); return; }
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>('button, a[href], iframe, [tabindex]:not([tabindex="-1"])')).filter((element) => !element.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; opener?.focus(); };
  }, []);
  return <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 sm:items-center sm:p-6" onClick={onClose}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="deals-community-title" data-deals-community-sheet="true" onClick={(event) => event.stopPropagation()} className="deals-light relative max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-t-2xl bg-background shadow-2xl sm:rounded-2xl">
      <button ref={closeButton} type="button" onClick={onClose} aria-label={LANDING_COPY.close} className="absolute right-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow hover:text-foreground"><X className="h-5 w-5" /></button>
      <div className="grid min-w-0 gap-6 p-5 sm:p-6 md:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <div className="mx-auto w-full min-w-0 max-w-[360px]"><ReelCard reelUrl={community.reelUrl} label={community.label} autoLoad /></div>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-widest text-gold">{community.area}</p>
          <h2 id="deals-community-title" className="mt-2 text-3xl leading-tight">{community.label}</h2>
          {community.fromPriceLabel && <p className="mt-3 text-2xl font-semibold">{community.fromPriceLabel}</p>}
          <p className="mt-1 text-sm text-muted-foreground">{community.homesAvailable > 0 ? LANDING_COPY.homesReady(community.homesAvailable) : LANDING_COPY.toBeBuilt}</p>
          {community.incentive && <div className="mt-5"><Incentive incentive={community.incentive} compact /></div>}
          {community.areaMap ? <AreaMap map={community.areaMap} variant="public" /> : null}
          <button type="button" onClick={onUnlock} className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-gold px-5 text-sm font-semibold text-primary-foreground shadow hover:opacity-95">{LANDING_COPY.unlock}<LockKeyhole className="h-4 w-4" /></button>
        </div>
      </div>
    </section>
  </div>;
}

/** The list and the map side by side (the map stays in view on a wide screen; a phone opens it with a button). */
export function LandingBrowse({ communities, onUnlock }: { communities: readonly LandingCommunity[]; onUnlock: () => void }) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ id: string; keys: string[] } | null>(null);
  const [open, setOpen] = useState<LandingCommunity | null>(null);
  const [mapOnPhone, setMapOnPhone] = useState(false);
  const [pages, setPages] = useState(1);
  const keyed = useMemo(() => communities.map((community, index) => ({ ...community, key: keyOf(community, index) })), [communities]);
  // New filters start the list from the top again.
  useEffect(() => setPages(1), [communities]);
  // A marker group the current filters no longer show is let go.
  useEffect(() => { if (selected && !selected.keys.some((key) => keyed.some((item) => item.key === key))) setSelected(null); }, [keyed, selected]);
  const matching = selected ? keyed.filter((item) => selected.keys.includes(item.key)) : keyed;
  const shown = matching.slice(0, pages * BROWSE_PAGE);
  const map = <RegionMap items={keyed} activeKey={activeKey} onHover={setActiveKey} onSelect={setSelected} selectedId={selected?.id ?? null} />;
  return <>
    <div className="mt-8 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,40%)]">
      <div className="min-w-0">
        <div className="mb-4 flex min-w-0 flex-wrap items-center gap-2 lg:hidden">
          <button type="button" onClick={() => setMapOnPhone((value) => !value)} aria-expanded={mapOnPhone} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm shadow-sm"><MapPin className="h-4 w-4 text-gold" />{mapOnPhone ? LANDING_COPY.hideMap : LANDING_COPY.showMap}</button>
        </div>
        {mapOnPhone && <div className="mb-6 lg:hidden">{map}</div>}
        {selected && <div role="status" className="mb-4 flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-gold/40 bg-gold/5 px-4 py-2 text-sm"><span>{LANDING_COPY.areaFilter(matching.length)}</span><button type="button" onClick={() => setSelected(null)} className="min-h-11 font-medium text-gold underline underline-offset-4">{LANDING_COPY.clearArea}</button></div>}
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2">
          {shown.map((community) => <CommunityCard key={community.key} community={community} active={activeKey === community.key} onHover={(on) => setActiveKey(on ? community.key : null)} onOpen={() => setOpen(community)} />)}
        </div>
        <ShowMore remaining={matching.length - shown.length} onClick={() => setPages((value) => value + 1)} />
      </div>
      <aside className="hidden min-w-0 lg:block"><div className="sticky top-6">{map}</div></aside>
    </div>
    {open && <CommunitySheet community={open} onClose={() => setOpen(null)} onUnlock={() => { setOpen(null); onUnlock(); }} />}
  </>;
}
