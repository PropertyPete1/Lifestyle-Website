import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Flame, Home, LockKeyhole, MapPin, Play, Share2, Sparkles, X } from "lucide-react";
import { AreaMap } from "./AreaMap";
import { Incentive, NEW_COPY, NewBadge, RedHotBadge, RedHotSavings, ReelCard, RetryImage, money, type DealsIncentive } from "./shared";
import { ProtectedGallery } from "./GatedCatalog";
import { ShowMore } from "./BrowseBar";
import { BROWSE_PAGE, homeFiltersOn, homePasses, numberFrom, sortHomes, type BrowseFilters } from "@/lib/dealsBrowse";

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
  /** Homes here that are Red Hot Deals. */
  redHotDeals?: number;
  /** Homes here that arrived this week. */
  newThisWeek?: number;
  /** The community's school district ("Northside ISD"), public like the area. */
  schoolDistrict?: string | null;
};

export const LANDING_COPY = {
  homesReady: (count: number) => `${count} move-in ready home${count === 1 ? "" : "s"}`,
  toBeBuilt: "Build new: pick your plan",
  photosSoon: "Photos coming soon",
  videoTour: "Video tour",
  fromYourReel: "From your reel",
  rate: (badge: { rate: string; apr: string }) => `${badge.rate} rate · ${badge.apr} APR`,
  redHot: (count: number) => count === 1 ? "Red Hot Deal" : `${count} Red Hot Deals`,
  areaFilter: (count: number) => `Showing ${count} in this part of town`,
  clearArea: "Show all",
  seeList: "See the list",
  featuredHome: "Featured deal",
  sheetFiltered: (shown: number, total: number) => `${shown} of ${total} homes match your filters.`,
  sheetShowAll: "Show every home",
  mapLabel: "Map of the communities",
  mapAttribution: "Map data and imagery from Google. Markers show the general area only, never the community.",
  showMap: "Show map",
  mapButton: "Map",
  hideMap: "Hide map",
  unlock: "Schedule a tour",
  homeAddress: "Schedule a tour",
  homesHeading: (count: number) => `${count} home${count === 1 ? "" : "s"} available`,
  homesLoading: "Loading homes…",
  homesNone: "Homes are being added. Ask us for the current list.",
  privacy: "One of our agents will reach out to set it up and answer your questions.",
  /** Oct 26, 2026: a buyer sends a community to a spouse; the link opens this sheet and carries a preview card. */
  markerView: "View",
  /** A community with plans but no priced home yet (build-only) says so on its marker instead of "View". */
  markerBuild: "Build new",
  share: "Share",
  shareCopied: "Link copied",
  shareTitle: (label: string) => `${label} — Builder Deals`,
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
          ? <RetryImage src={cover} alt="" loading="lazy" decoding="async" draggable={false} onGiveUp={() => setFailed(true)} onContextMenu={(event) => event.preventDefault()} className="block h-full w-full select-none object-cover [-webkit-touch-callout:none]" />
          : <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground"><Home className="h-8 w-8" /><span className="text-xs">{LANDING_COPY.photosSoon}</span></div>}
        <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5">
          {community.fromYourReel && <span className="rounded-full bg-gold px-2.5 py-1 text-[11px] font-semibold text-primary-foreground shadow">{LANDING_COPY.fromYourReel}</span>}
          {(community.redHotDeals ?? 0) > 0 && <span data-deals-card-red-hot="true" className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white shadow"><Flame className="h-3.5 w-3.5" />{LANDING_COPY.redHot(community.redHotDeals!)}</span>}
          {(community.newThisWeek ?? 0) > 0 && <span data-deals-card-new="true" className="inline-flex items-center gap-1 rounded-full border border-gold bg-card/90 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-gold shadow"><Sparkles className="h-3.5 w-3.5" />{NEW_COPY.count(community.newThisWeek!)}</span>}
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

/** Markers closer than this share one numbered bubble (fractions of the map's width at its opening zoom). */
const GROUP_CELL = 0.045;

/** One marker per community, grouped where they overlap; a group shows its count, a lone community its price band. */
/** What a lone marker says: its price band, else "Build new" for a plan-only community, else "View". */
export function loneMarkerLabel(item: { fromPriceLabel?: string | null; homesAvailable?: number }): string {
  return (item.fromPriceLabel ?? "").replace(/^From the /, "") || (item.homesAvailable === 0 ? LANDING_COPY.markerBuild : LANDING_COPY.markerView);
}

export function groupMarkers(items: ReadonlyArray<{ key: string; pin?: { x: number; y: number } | null; fromPriceLabel?: string | null; homesAvailable?: number }>, cell = GROUP_CELL): Marker[] {
  const groups = new Map<string, { xs: number[]; ys: number[]; keys: string[]; labels: string[] }>();
  for (const item of items) {
    if (!item.pin) continue;
    const id = `${Math.floor(item.pin.x / cell)}:${Math.floor(item.pin.y / cell)}`;
    const group = groups.get(id) ?? { xs: [], ys: [], keys: [], labels: [] };
    group.xs.push(item.pin.x); group.ys.push(item.pin.y); group.keys.push(item.key); group.labels.push(loneMarkerLabel(item));
    groups.set(id, group);
  }
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  // A lone community without a starting price reads "View" when lit, never "1" (that looked like a bubble of one).
  return Array.from(groups.entries()).map(([id, group]) => ({ id, x: mean(group.xs), y: mean(group.ys), keys: group.keys, label: group.keys.length > 1 ? String(group.keys.length) : group.labels[0] || LANDING_COPY.markerView }));
}

/**
 * The market picture's shape and its opening view (San Antonio), as server/dealsRegionMap.ts computes them (a test
 * keeps the two equal), and the quick jumps. October 24, 2026 (Peter): the map drags and zooms up to Austin.
 */
export const REGION_VIEW = {
  aspect: 1920 / 1840,
  home: { x: 0.4810, y: 0.6503, span: 0.6146 },
  jumps: [
    { label: "San Antonio", x: 0.4810, y: 0.6503, span: 0.6146 },
    { label: "New Braunfels", x: 0.5933, y: 0.5442, span: 0.32 },
    { label: "Austin", x: 0.7313, y: 0.2622, span: 0.36 },
  ],
} as const;
/** The shaded area around a hovered community: a few miles across, as a share of the picture's width (never the exact spot). */
export const AREA_DIAMETER = 0.04;
/** On-screen marker spacing that groups markers, in CSS pixels. */
const GROUP_PIXELS = 28;
const MAX_ZOOM = 7;
/** The most communities one fanned-out ring shows (a ring of more covers the map). */
const FAN_MAX = 6;

type View = { z: number; tx: number; ty: number };

/**
 * The view that fits a group's communities with room around them: content width z (pixels for the picture's full
 * width) and its offset. Communities on one public point get a close view of that point (a few miles across).
 */
export function clusterView(pins: ReadonlyArray<{ x: number; y: number }>, w: number, h: number, maxZ = Infinity): View {
  if (!pins.length) return { z: w, tx: 0, ty: 0 };
  const xs = pins.map((pin) => pin.x);
  const ys = pins.map((pin) => pin.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // A group inside one grid cell (about 0.025 of the picture across) fills most of the map; maxZ caps it.
  const spanX = Math.max(maxX - minX, 0.012);
  const spanY = Math.max((maxY - minY) / REGION_VIEW.aspect, 0.012 / REGION_VIEW.aspect);
  // The closest the map goes is decided before centring, so the group stays in the middle at that zoom.
  const z = Math.min((w * 0.62) / spanX, (h * 0.62) / spanY, maxZ);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { z, tx: w / 2 - cx * z, ty: h / 2 - cy * (z / REGION_VIEW.aspect) };
}

/** True when, at this zoom, some of the communities would still share one bubble (their points are under GROUP_PIXELS apart). */
export function stillStacked(pins: ReadonlyArray<{ x: number; y: number } | null>, z: number): boolean {
  const placed = pins.filter((pin): pin is { x: number; y: number } => Boolean(pin));
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    const a = placed[i]!; const b = placed[j]!;
    if (Math.hypot((a.x - b.x) * z, (a.y - b.y) * (z / REGION_VIEW.aspect)) < GROUP_PIXELS) return true;
  }
  return false;
}

/** Where each fanned-out community sits around its shared point, in pixels: a ring that grows with the count. */
export function fanOffsets(count: number): Array<{ dx: number; dy: number }> {
  // Price pills are about 56 pixels wide: the ring keeps neighbours from touching.
  const radius = Math.max(58, (count * 62) / (2 * Math.PI));
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
    return { dx: Math.round(Math.cos(angle) * radius), dy: Math.round(Math.sin(angle) * radius) };
  });
}

export function RegionMap({ items, activeKey, onHover, onSelect, selectedId, className = "" }: {
  items: ReadonlyArray<{ key: string; pin?: { x: number; y: number } | null; fromPriceLabel?: string | null; homesAvailable?: number }>;
  activeKey: string | null;
  onHover: (key: string | null) => void;
  onSelect: (marker: { id: string; keys: string[] } | null) => void;
  selectedId: string | null;
  /** The box's size (the page gives it a height); the map covers the whole box. */
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<View | null>(null);
  const viewRef = useRef<View | null>(null);
  viewRef.current = view;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: number; pinch: number | null }>({ moved: 0, pinch: null });

  const minWidth = (w: number, h: number) => Math.max(w, h * REGION_VIEW.aspect);
  const clamp = (next: View, w: number, h: number): View => {
    const z = Math.min(Math.max(next.z, minWidth(w, h)), minWidth(w, h) * MAX_ZOOM);
    const height = z / REGION_VIEW.aspect;
    return { z, tx: Math.min(0, Math.max(w - z, next.tx)), ty: Math.min(0, Math.max(h - height, next.ty)) };
  };
  const goTo = (spot: { x: number; y: number; span: number }, w: number, h: number) => {
    const z = Math.min(Math.max(w / spot.span, minWidth(w, h)), minWidth(w, h) * MAX_ZOOM);
    return clamp({ z, tx: w / 2 - spot.x * z, ty: h / 2 - spot.y * (z / REGION_VIEW.aspect) }, w, h);
  };
  // Until the visitor moves the map, a change of box size re-centres it on San Antonio (the box settles after the list loads).
  const touched = useRef(false);
  /** The box's size right now. Every action reads it fresh: a size kept from the first paint, before the list column
   * appeared, put New Braunfels over Converse and Austin over Kyle (Peter, Oct 24). */
  const measure = (): { w: number; h: number } | null => {
    const element = box.current;
    if (!element || !element.clientWidth || !element.clientHeight) return null;
    const next = { w: element.clientWidth, h: element.clientHeight };
    setSize((current) => current && current.w === next.w && current.h === next.h ? current : next);
    return next;
  };
  const settle = () => {
    const now = measure();
    if (!now) return;
    // A phone's narrow box opens closer in on San Antonio, so its markers spread out instead of piling up.
    const home = now.w < 560 ? { ...REGION_VIEW.home, span: REGION_VIEW.home.span * 0.62 } : REGION_VIEW.home;
    setView((current) => !current || !touched.current ? goTo(home, now.w, now.h) : clamp(current, now.w, now.h));
  };
  useEffect(() => {
    settle();
    // The map box follows the window and the page layout; the window's resize and a few settling checks after load
    // are the signals (no ResizeObserver: NowHiringBanner stays the only one, see bannerResizeObserver.test).
    const timers = [150, 600, 1500, 3000].map((ms) => window.setTimeout(settle, ms));
    window.addEventListener("resize", settle);
    return () => { timers.forEach((id) => window.clearTimeout(id)); window.removeEventListener("resize", settle); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const zoomAt = (factor: number, px: number, py: number) => {
    const current = viewRef.current;
    const now = measure();
    if (!current || !now) return;
    touched.current = true;
    const z = current.z * factor;
    const ratio = z / current.z;
    setView(clamp({ z, tx: px - (px - current.tx) * ratio, ty: py - (py - current.ty) * ratio }, now.w, now.h));
  };
  const jumpTo = (spot: { x: number; y: number; span: number }) => {
    const now = measure();
    if (!now) return;
    touched.current = true;
    setFanned(null);
    setView(goTo(spot, now.w, now.h));
  };
  // Communities whose public points sit on top of each other even fully zoomed in fan out around that point.
  const [fanned, setFanned] = useState<string[] | null>(null);
  /** A numbered bubble zooms in to fit its communities (New Home Buddy style); the ones that still overlap fan out. */
  const openGroup = (marker: Marker) => {
    const now = measure();
    const current = viewRef.current;
    if (!now || !current) return;
    touched.current = true;
    const target = clusterView(marker.keys.map((key) => items.find((item) => item.key === key)?.pin).filter((pin): pin is { x: number; y: number } => Boolean(pin)), now.w, now.h, minWidth(now.w, now.h) * MAX_ZOOM);
    const next = clamp(target, now.w, now.h);
    setView(next);
    const stacked = stillStacked(marker.keys.map((key) => items.find((item) => item.key === key)?.pin ?? null), next.z);
    // A few that still overlap fan out in a ring. A bigger bubble zooms in and narrows the list beside the map (on a
    // phone, "See the list" under it), and its smaller bubbles fan out in turn.
    setFanned(stacked && marker.keys.length <= FAN_MAX ? marker.keys : null);
  };
  // The wheel zooms the map, not the page (a passive listener could not stop the page scrolling).
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  });
  const onPointerDown = (event: React.PointerEvent) => {
    measure();
    touched.current = true;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) gesture.current = { moved: 0, pinch: null };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const before = pointers.current.get(event.pointerId);
    if (!before || !size) return;
    const current = viewRef.current;
    if (!current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) {
      const dx = event.clientX - before.x;
      const dy = event.clientY - before.y;
      gesture.current.moved += Math.abs(dx) + Math.abs(dy);
      setView(clamp({ ...current, tx: current.tx + dx, ty: current.ty + dy }, size.w, size.h));
    } else if (pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values()) as [{ x: number; y: number }, { x: number; y: number }];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = box.current!.getBoundingClientRect();
      if (gesture.current.pinch) zoomAt(distance / gesture.current.pinch, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
      gesture.current.pinch = distance;
      gesture.current.moved += 10;
    }
  };
  const onPointerUp = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) gesture.current.pinch = null;
  };
  const cell = view ? Math.max(0.004, GROUP_PIXELS / view.z) : GROUP_CELL;
  const bucket = Math.round(Math.log2(cell) * 4);
  const markers = useMemo(() => groupMarkers(items, 2 ** (bucket / 4)), [items, bucket]);
  // Hovering a card shades its general area on the map (New Home Buddy style), around the same coarse point its marker uses.
  const activePin = activeKey ? items.find((item) => item.key === activeKey)?.pin ?? null : null;
  // A card whose area is off the visible map (Peter, Oct 25: "some homes don't highlight on the map") glides the map
  // over to it after a moment, so the shaded area is always in view. A drag in progress is never interrupted.
  const [gliding, setGliding] = useState(false);
  useEffect(() => {
    if (!activePin) return;
    const timer = window.setTimeout(() => {
      const current = viewRef.current;
      const now = measure();
      if (!current || !now || pointers.current.size) return;
      const x = activePin.x * current.z + current.tx;
      const y = activePin.y * (current.z / REGION_VIEW.aspect) + current.ty;
      const margin = 48;
      if (x >= margin && x <= now.w - margin && y >= margin && y <= now.h - margin) return;
      touched.current = true;
      setGliding(true);
      setView(clamp({ ...current, tx: now.w / 2 - activePin.x * current.z, ty: now.h / 2 - activePin.y * (current.z / REGION_VIEW.aspect) }, now.w, now.h));
      window.setTimeout(() => setGliding(false), 450);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [activePin?.x, activePin?.y]); // eslint-disable-line react-hooks/exhaustive-deps
  if (failed) return null;
  const zoomButton = (factor: number) => () => { const now = measure(); if (now) zoomAt(factor, now.w / 2, now.h / 2); };
  return <figure aria-label={LANDING_COPY.mapLabel} data-deals-region-map="true" className={`relative min-w-0 overflow-hidden rounded-xl border border-border bg-[#e8eaed] shadow-sm ${className}`}>
    <div ref={box} className="absolute inset-0 cursor-grab touch-none select-none active:cursor-grabbing" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onClickCapture={(event) => { if (gesture.current.moved > 6) { event.stopPropagation(); event.preventDefault(); } }}
      onClick={(event) => { if (!(event.target as HTMLElement).closest("button")) setFanned(null); }}>
      {view && <div data-deals-map-content="true" className="absolute left-0 top-0" style={{ width: view.z, height: view.z / REGION_VIEW.aspect, transform: `translate(${view.tx}px, ${view.ty}px)`, transition: gliding ? "transform 400ms ease-out" : undefined }}>
        <img src="/deals/maps/region.webp" alt="" decoding="async" draggable={false} onError={() => setFailed(true)} className="pointer-events-none block h-full w-full select-none" />
        {activePin && <span aria-hidden="true" data-deals-map-area="true" style={{ left: `${activePin.x * 100}%`, top: `${activePin.y * 100}%`, width: `${AREA_DIAMETER * 100}%` }}
          className="pointer-events-none absolute z-[5] aspect-square min-w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-gold/80 bg-gold/25 shadow-[0_0_0_6px_rgba(184,146,74,0.12)] transition-all duration-200" />}
        {markers.map((marker) => {
          const group = marker.keys.length > 1;
          if (group && fanned && marker.keys.length <= FAN_MAX && marker.keys.every((key) => fanned.includes(key))) {
            const offsets = fanOffsets(marker.keys.length);
            return <div key={marker.id} data-deals-fan="true" className="absolute z-30" style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }}>
              <span aria-hidden="true" className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-gold shadow" />
              <svg aria-hidden="true" className="pointer-events-none absolute overflow-visible" width="1" height="1">{offsets.map((offset, index) => <line key={index} x1="0" y1="0" x2={offset.dx} y2={offset.dy} stroke="rgba(30,35,45,0.45)" strokeWidth="1.5" />)}</svg>
              {marker.keys.map((key, index) => {
                const item = items.find((entry) => entry.key === key);
                const lit = activeKey === key;
                const label = item ? loneMarkerLabel(item) : LANDING_COPY.markerView;
                return <button key={key} type="button" data-deals-marker="fan" data-active={lit ? "true" : undefined} aria-label={`Community ${label}. Open it`}
                  onPointerDown={(event) => { event.stopPropagation(); gesture.current.moved = 0; }}
                  onMouseEnter={() => onHover(key)} onMouseLeave={() => onHover(null)}
                  onClick={() => onSelect({ id: `fan:${key}`, keys: [key] })}
                  style={{ left: offsets[index]!.dx, top: offsets[index]!.dy }}
                  className={`absolute inline-flex min-h-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center whitespace-nowrap rounded-full border-2 border-white px-2 text-[11px] font-semibold shadow-md transition-transform before:absolute before:-inset-1.5 before:content-[''] ${lit ? "z-20 scale-110 bg-gold text-primary-foreground" : "bg-[oklch(0.25_0.02_260)] text-white hover:scale-110"}`}>{label}</button>;
              })}
            </div>;
          }
          const lit = (activeKey !== null && marker.keys.includes(activeKey)) || selectedId === marker.id;
          // While a ring is open, the other markers step back so its pills read clearly.
          const dim = Boolean(fanned) && !lit;
          // A group is a numbered bubble; a lone community is a dot that shows its price band when lit.
          const shape = group ? "min-h-7 min-w-7 px-1.5 text-[11px]" : lit ? "min-h-7 px-2 text-[11px]" : "h-4 w-4";
          return <button key={marker.id} type="button" data-deals-marker={group ? "group" : "single"} data-active={lit ? "true" : undefined}
            aria-label={group ? `${marker.keys.length} communities here. Zoom in and show them` : `Community ${marker.label}. Show it`}
            // The press stops here so a drag cannot start on a marker; the drag guard is reset too (Peter, Oct 26: after
            // one drag of the map, every later marker click was swallowed, because only a background press reset it).
            onPointerDown={(event) => { event.stopPropagation(); gesture.current.moved = 0; }}
            onMouseEnter={() => onHover(group ? null : marker.keys[0]!)} onMouseLeave={() => onHover(null)}
            onClick={() => {
              if (!group) { onSelect({ id: marker.id, keys: marker.keys }); return; }
              openGroup(marker);
              onSelect({ id: marker.id, keys: marker.keys });
            }}
            style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }}
            className={`absolute inline-flex -translate-x-1/2 -translate-y-1/2 before:absolute before:-inset-3 before:content-[''] items-center justify-center whitespace-nowrap rounded-full border-2 border-white font-semibold shadow-md transition-transform ${shape} ${lit ? "z-20 scale-110 bg-gold text-primary-foreground" : "z-10 bg-[oklch(0.25_0.02_260)] text-white hover:scale-110"} ${dim ? "opacity-30" : ""}`}>
            {group || lit ? marker.label : null}
          </button>;
        })}
      </div>}
    </div>
    <div className="pointer-events-none absolute left-2 right-2 top-2 flex flex-wrap items-start justify-between gap-2">
      <div className="pointer-events-auto flex flex-wrap gap-1.5">{REGION_VIEW.jumps.map((spot) => <button key={spot.label} type="button" onClick={() => jumpTo(spot)} className="min-h-9 rounded-full border border-border bg-white/95 px-3 text-xs font-medium text-foreground shadow-sm hover:border-gold">{spot.label}</button>)}</div>
      <div className="pointer-events-auto flex flex-col overflow-hidden rounded-lg border border-border bg-white/95 shadow-sm">
        <button type="button" onClick={zoomButton(1.5)} aria-label="Zoom in" className="flex h-9 w-9 items-center justify-center text-lg font-semibold hover:bg-secondary">+</button>
        <button type="button" onClick={zoomButton(1 / 1.5)} aria-label="Zoom out" className="flex h-9 w-9 items-center justify-center border-t border-border text-lg font-semibold hover:bg-secondary">−</button>
      </div>
    </div>
    <figcaption className="pointer-events-none absolute bottom-2 left-2 right-2 rounded bg-white/85 px-2 py-1 text-[10px] leading-snug text-muted-foreground">{LANDING_COPY.mapAttribution}</figcaption>
  </figure>;
}

/** How the sheet reads a community's homes (the page passes the server query; a preview passes fixed homes). */
export type UseCommunityHomes = (key: string | undefined) => { isLoading: boolean; data?: readonly PublicHome[] | null };

/** The home a featured card stands for, by its public figures (the sheet's homes carry no shared key). */
export type SheetFocus = { price?: number | null; sqft?: number | null; beds?: string | number | null; kind?: string; /** The unlocked list knows the home by its card handle. */ card?: string };

/** True when a sheet home is the featured one: same kind, price and size. */
export function isFocusHome(home: PublicHome, focus: SheetFocus | undefined): boolean {
  if (focus?.card) return home.card === focus.card;
  if (!focus || !focus.price) return false;
  return home.price === focus.price && (!focus.sqft || home.sqft === focus.sqft) && (!focus.kind || home.kind === focus.kind);
}

/** The public link to one community's sheet: the landing page plus its opaque key (never a name or an address). */
export function communityShareUrl(key: string | undefined): string | null {
  if (!key || typeof window === "undefined") return null;
  return `${window.location.origin}/deals?k=${encodeURIComponent(key)}`;
}

function ShareButton({ community }: { community: LandingCommunity }) {
  const [copied, setCopied] = useState(false);
  const url = communityShareUrl(community.key);
  if (!url) return null;
  const share = async () => {
    const nav = navigator as Navigator & { share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>; canShare?: (data: unknown) => boolean };
    try {
      if (typeof nav.share === "function" && (!nav.canShare || nav.canShare({ url }))) { await nav.share({ title: LANDING_COPY.shareTitle(community.label), text: community.fromPriceLabel ?? undefined, url }); return; }
    } catch (error) { if ((error as { name?: string }).name === "AbortError") return; }
    try { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { window.prompt(LANDING_COPY.share, url); }
  };
  return <button type="button" onClick={() => void share()} data-deals-share="true" aria-live="polite" className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-foreground hover:border-gold hover:text-gold"><Share2 className="h-4 w-4" />{copied ? LANDING_COPY.shareCopied : LANDING_COPY.share}</button>;
}

/**
 * Oct 27, 2026: the unlocked list (team and clients) opens the same sheet with its own pieces: the community's private
 * details and gated area map above the homes, its own home cards (address, pick, save, tour) and no unlock button.
 */
export type SheetOptions = {
  /** Rendered under the price line, before the offer: the full list's builder, community name and address block. */
  details?: (community: LandingCommunity) => ReactNode;
  /** Rendered after the offer: the gated area map with drive times, the lot sizes and amenities. */
  area?: (community: LandingCommunity) => ReactNode;
  /** A home card of the caller's own (the unlocked list's, with its buttons); the public card otherwise. */
  renderHome?: (home: PublicHome, featured: boolean, community: LandingCommunity) => ReactNode;
  /** The unlock ("Schedule a tour") button and its privacy line; off on a list that is already unlocked. */
  unlock?: boolean;
  /** The public share button (a link to the landing page's sheet); off on a private list. */
  share?: boolean;
  /** The public area map under the offer; off when `area` draws the gated one. */
  publicAreaMap?: boolean;
  /** Oct 27, 2026 (New Home Buddy opens a home on its photos): the opened home shown first, above the community. */
  focusHero?: (home: PublicHome, community: LandingCommunity) => ReactNode;
};

export function CommunitySheet({ community, onClose, onUnlock, useHomes, filters, focus, options = {} }: { community: LandingCommunity; onClose: () => void; onUnlock?: () => void; useHomes: UseCommunityHomes; /** The page's filters: the homes that match come first, the rest one tap away. */ filters?: BrowseFilters; focus?: SheetFocus; options?: SheetOptions }) {
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
  const homes = useHomes(community.key);
  const all = homes.data ?? [];
  const [showAll, setShowAll] = useState(false);
  const narrowed = filters && homeFiltersOn(filters) && !showAll ? all.filter((home) => homePasses(home, filters)) : null;
  // When no home passes (the community matched on its offer or area), every home shows rather than an empty sheet.
  const base = sortHomes(narrowed && narrowed.length ? narrowed : all, filters?.sort ?? "recommended");
  // A featured home leads the sheet, whatever the filters say.
  const featuredHome = all.find((home) => isFocusHome(home, focus));
  const list = featuredHome ? [featuredHome, ...base.filter((home) => home !== featuredHome)] : base;
  const homesTop = useRef<HTMLDivElement>(null);
  // A featured home is scrolled to in the list, unless the sheet leads with it (the unlocked list's home hero).
  useEffect(() => { if (featuredHome && !options.focusHero) window.setTimeout(() => homesTop.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 250); }, [featuredHome]);
  // On document.body, so no section's stacking (or the page's floating button) can sit over the sheet.
  return createPortal(<div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 sm:items-center sm:p-6" onClick={onClose}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="deals-community-title" data-deals-community-sheet="true" onClick={(event) => event.stopPropagation()} className="deals-light relative max-h-[94vh] w-full max-w-6xl overflow-y-auto rounded-t-2xl bg-background shadow-2xl sm:rounded-2xl">
      <button ref={closeButton} type="button" onClick={onClose} aria-label={LANDING_COPY.close} className="absolute right-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow hover:text-foreground"><X className="h-5 w-5" /></button>
      {featuredHome && options.focusHero && <div className="border-b border-border" data-deals-focus-hero="true">{options.focusHero(featuredHome, community)}</div>}
      <div className="grid min-w-0 gap-6 p-5 sm:p-6 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="mx-auto w-full min-w-0 max-w-[340px]"><ReelCard reelUrl={community.reelUrl} label={community.label} autoLoad poster={community.cover ?? null} /></div>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-widest text-gold">{community.area}{community.schoolDistrict ? <span data-deals-school-district="true"> · {community.schoolDistrict}</span> : null}</p>
          <h2 id="deals-community-title" className="mt-2 text-3xl leading-tight">{community.label}</h2>
          {community.fromPriceLabel && <p className="mt-3 text-2xl font-semibold">{community.fromPriceLabel}</p>}
          <p className="mt-1 text-sm text-muted-foreground">{community.homesAvailable > 0 ? LANDING_COPY.homesReady(community.homesAvailable) : LANDING_COPY.toBeBuilt}</p>
          {options.details?.(community)}
          {community.incentive && <div className="mt-5"><Incentive incentive={community.incentive} compact /></div>}
          {options.publicAreaMap !== false && community.areaMap ? <AreaMap map={community.areaMap} variant="public" /> : null}
          {options.area?.(community)}
          {options.unlock !== false && onUnlock && <><button type="button" onClick={onUnlock} className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-gold px-5 text-sm font-semibold text-primary-foreground shadow hover:opacity-95">{LANDING_COPY.unlock}<LockKeyhole className="h-4 w-4" /></button>
          <p className="mt-2 text-xs text-muted-foreground">{LANDING_COPY.privacy}</p></>}
          {options.share !== false && <ShareButton community={community} />}
        </div>
      </div>
      <div ref={homesTop} className="scroll-mt-2 border-t border-border px-5 pb-8 pt-6 sm:px-6" data-deals-public-homes="true">
        <h3 className="text-xl font-semibold">{homes.isLoading ? LANDING_COPY.homesLoading : list.length ? LANDING_COPY.homesHeading(list.length) : LANDING_COPY.homesNone}</h3>
        {narrowed && narrowed.length > 0 && narrowed.length < all.length && <p role="status" className="mt-2 flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground" data-deals-sheet-filtered="true">{LANDING_COPY.sheetFiltered(narrowed.length, all.length)}<button type="button" onClick={() => setShowAll(true)} className="min-h-11 font-medium text-gold underline underline-offset-4">{LANDING_COPY.sheetShowAll}</button></p>}
        {list.length > 0 && <div className="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2 lg:grid-cols-3">{list.map((home) => options.renderHome ? <div key={home.card} className="min-w-0">{options.renderHome(home, home === featuredHome, community)}</div> : <PublicHomeCard key={home.card} home={home} onAddress={() => onUnlock?.()} featured={home === featuredHome} />)}</div>}
      </div>
    </section>
  </div>, document.body);
}

/** A home on the landing page: the same facts as the private list, with no address, plan, builder or community name. */
export type PublicHome = { card: string; kind: string; beds?: string | number | null; baths?: string | number | null; sqft?: number | null; garage?: string | null; stories?: number | null; price?: number | null; previousPrice?: number | null; moveInDate?: string | null; lotSize?: string | null; photos?: string[]; isNew?: boolean };

export function PublicHomeCard({ home, onAddress, featured = false }: { home: PublicHome; onAddress: () => void; featured?: boolean }) {
  return <article data-deals-public-home="true" data-deals-featured-home={featured ? "true" : undefined} className={`relative min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm ${featured ? "border-gold ring-2 ring-gold/60" : "border-border"}`}>
    {featured && <span className="absolute left-2 top-2 z-10 rounded-full bg-gold px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-primary-foreground shadow">{LANDING_COPY.featuredHome}</span>}
    <div className="[&>*]:mt-0"><ProtectedGallery photos={home.photos} /></div>
    <div className="p-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-medium text-foreground">{home.kind === "to_be_built" ? "To be built" : "Move-in ready"}</span>
        <RedHotBadge price={home.price} previousPrice={home.previousPrice} />
        <NewBadge isNew={home.isNew} />
      </div>
      <p className="mt-2 text-2xl font-semibold leading-tight">{home.price ? money.format(home.price) : "Ask for current pricing"}</p>
      <RedHotSavings price={home.price} previousPrice={home.previousPrice} />
      <p className="mt-1 text-sm text-foreground">{[home.beds && `${home.beds} beds`, home.baths && `${home.baths} baths`, home.sqft && `${home.sqft.toLocaleString()} sq ft`, numberFrom(home.garage) && `${numberFrom(home.garage)}-car garage`, home.stories && `${home.stories} ${home.stories === 1 ? "story" : "stories"}`].filter(Boolean).join(" · ")}</p>
      {home.moveInDate && <p className="mt-1 text-xs text-muted-foreground">Est. move-in: {home.moveInDate}</p>}
      {home.lotSize && <p className="mt-0.5 text-xs text-muted-foreground">Lot: {home.lotSize}</p>}
      <button type="button" onClick={onAddress} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-gold/50 px-4 text-sm font-semibold text-gold hover:bg-gold/10">{LANDING_COPY.homeAddress}</button>
    </div>
  </article>;
}

/** Calls onNear when this marker comes within a screen of the viewport (infinite scroll, like New Home Buddy). */
export function AutoMore({ active, onNear }: { active: boolean; onNear: () => void }) {
  const marker = useRef<HTMLDivElement>(null);
  const near = useRef(onNear);
  near.current = onNear;
  useEffect(() => {
    const element = marker.current;
    if (!active || !element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) near.current(); }, { rootMargin: "800px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [active]);
  return <div ref={marker} aria-hidden="true" className="h-px w-full" />;
}

/** The list and the map side by side (the map stays in view on a wide screen; a phone opens it with a button). */
/** What the featured row can do on the landing page: open a community's sheet on one of its homes, and light its area on the map. */
export type LandingActions = { openHome: (key: string, focus?: SheetFocus) => boolean; hover: (key: string | null) => void };

/** What a caller's own list (the unlocked list's flat home list) gets: the communities in view and how to open one. */
export type BrowseListContext = { keys: ReadonlySet<string>; open: (key: string, focus?: SheetFocus) => void; hover: (key: string | null) => void; activeKey: string | null };

export function LandingBrowse({ communities, onUnlock, useHomes, top, filters, lookup, openKey, sheet, onOpenCommunity, below, renderList, floatingMapBottom = "bottom-6", mapSide = "right", areaStatus, onAreaChange }: {
  communities: readonly LandingCommunity[]; onUnlock?: () => void; useHomes: UseCommunityHomes;
  /** The sheet's pieces for an unlocked list (see SheetOptions). */
  sheet?: SheetOptions;
  /** Called with the community's key each time its sheet opens (the unlocked list logs the view). */
  onOpenCommunity?: (key: string) => void;
  /** Rendered under the cards in the list column (the Coming Soon section). */
  below?: ReactNode;
  /** Oct 27, 2026 (New Home Buddy lists homes, not communities): the caller's own list in place of the community cards. */
  renderList?: (context: BrowseListContext) => ReactNode;
  /** Where the phone's floating Map button sits (the team page lifts it above its pick tray). */
  floatingMapBottom?: string;
  /** Oct 28, 2026: the unlocked list puts the map on the left, like New Home Buddy; the landing page keeps it on the right. */
  mapSide?: "left" | "right";
  /** The "Showing N in this part of town" line for a caller's own list (the home list counts homes, not communities). */
  areaStatus?: (keys: readonly string[]) => string;
  /** Told which communities a map bubble narrowed the list to (null when cleared), so the caller's count follows. */
  onAreaChange?: (keys: readonly string[] | null) => void;
  /** A shared link's community (?k=key): its sheet opens once the catalog has it. */
  openKey?: string | null;
  /** Shown at the top of the list column (the featured row); a function gets the actions above. */
  top?: ReactNode | ((actions: LandingActions) => ReactNode);
  filters?: BrowseFilters;
  /** Every community on the page, filtered or not, so a featured home opens even when the filters hide its card. */
  lookup?: readonly LandingCommunity[];
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ id: string; keys: string[] } | null>(null);
  const [open, setOpen] = useState<LandingCommunity | null>(null);
  const [focus, setFocus] = useState<SheetFocus | undefined>(undefined);
  const openKeyRef = useRef<string | null>(null);
  useEffect(() => { const key = open?.key ?? null; if (key && key !== openKeyRef.current) onOpenCommunity?.(key); openKeyRef.current = key; }, [open, onOpenCommunity]);
  const [mapOnPhone, setMapOnPhone] = useState(false);
  // Oct 27, 2026 (New Home Buddy's floating MAP button): once the top Map button scrolls away, a pill stays at the bottom.
  const phoneMapTop = useRef<HTMLDivElement>(null);
  const [mapButtonAway, setMapButtonAway] = useState(false);
  useEffect(() => {
    const element = phoneMapTop.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => setMapButtonAway(entries.every((entry) => !entry.isIntersecting && entry.boundingClientRect.top < 0)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const openPhoneMap = () => { setMapOnPhone(true); window.setTimeout(() => phoneMapTop.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 30); };
  const [pages, setPages] = useState(1);
  const keyed = useMemo(() => communities.map((community, index) => ({ ...community, key: keyOf(community, index) })), [communities]);
  // New filters start the list from the top again.
  useEffect(() => setPages(1), [communities]);
  // A shared link opens its community once (the visitor can close it and browse on).
  const openedFromLink = useRef<string | null>(null);
  useEffect(() => {
    if (!openKey || openedFromLink.current === openKey) return;
    const community = keyed.find((item) => item.key === openKey) ?? lookup?.find((item) => item.key === openKey);
    if (!community) return;
    openedFromLink.current = openKey;
    setFocus(undefined);
    setOpen(community);
  }, [openKey, keyed, lookup]);
  // A marker group the current filters no longer show is let go.
  useEffect(() => { if (selected && !selected.keys.some((key) => keyed.some((item) => item.key === key))) setSelected(null); }, [keyed, selected]);
  const matching = selected ? keyed.filter((item) => selected.keys.includes(item.key)) : keyed;
  const selectedSignature = selected ? selected.keys.join(",") : null;
  useEffect(() => { onAreaChange?.(selectedSignature === null ? null : selectedSignature.split(",")); }, [selectedSignature]);
  const shown = matching.slice(0, pages * BROWSE_PAGE);
  const listTop = useRef<HTMLDivElement>(null);
  // A lone community's marker opens that community (its homes and photos); a group's marker narrows the list to it.
  const selectMarker = (marker: { id: string; keys: string[] } | null) => {
    if (marker && marker.keys.length === 1) {
      const community = keyed.find((item) => item.key === marker.keys[0]);
      if (community) { setFocus(undefined); setOpen(community); return; }
    }
    setSelected(marker);
    // On a wide screen the map stays put beside the list, so the list scrolls to its top. On a phone the map sits
    // above the list: scrolling away would hide the zoom and the fanned-out communities the visitor just asked for.
    if (marker && window.matchMedia?.("(min-width: 1024px)").matches) window.setTimeout(() => listTop.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  const actions: LandingActions = {
    openHome: (key, homeFocus) => {
      const community = keyed.find((item) => item.key === key) ?? lookup?.find((item) => item.key === key);
      if (!community) return false;
      setFocus(homeFocus);
      setOpen(community);
      return true;
    },
    hover: setActiveKey,
  };
  const mapProps = { items: keyed, activeKey, onHover: setActiveKey, onSelect: selectMarker, selectedId: selected?.id ?? null };
  const map = <RegionMap {...mapProps} className="h-[65vh] w-full" />;
  return <>
    <div className={`mt-6 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 ${mapSide === "left" ? "mt-3 gap-4 lg:grid-cols-[minmax(360px,44%)_minmax(0,1fr)]" : "lg:grid-cols-[minmax(0,1fr)_minmax(360px,42%)]"}`}>
      <div className="min-w-0">
        {/* On a phone the map button sits right under the search, before the featured row (Peter: map and search first). */}
        <div ref={phoneMapTop} className="mb-4 flex min-w-0 scroll-mt-2 flex-wrap items-center gap-2 lg:hidden">
          <button type="button" onClick={() => setMapOnPhone((value) => !value)} aria-expanded={mapOnPhone} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm shadow-sm"><MapPin className="h-4 w-4 text-gold" />{mapOnPhone ? LANDING_COPY.hideMap : LANDING_COPY.showMap}</button>
        </div>
        {mapOnPhone && <div className="mb-6 lg:hidden">{map}
          {/* The bubble the visitor tapped narrows the list below; on a phone that is said right under the map. */}
          {selected && <div role="status" data-deals-phone-area="true" className="mt-2 flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-gold/40 bg-gold/5 px-4 py-1 text-sm"><span>{(areaStatus ? areaStatus(matching.map((item) => item.key)) : LANDING_COPY.areaFilter(matching.length))}</span><button type="button" onClick={() => listTop.current?.scrollIntoView({ behavior: "smooth", block: "start" })} className="min-h-11 font-medium text-gold underline underline-offset-4">{LANDING_COPY.seeList}</button><button type="button" onClick={() => setSelected(null)} className="min-h-11 font-medium text-muted-foreground underline underline-offset-4">{LANDING_COPY.clearArea}</button></div>}
        </div>}
        {top && <div className="mb-6 min-w-0">{typeof top === "function" ? top(actions) : top}</div>}
        <div ref={listTop} className="scroll-mt-4" />
        {selected && <div role="status" className="mb-4 flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-gold/40 bg-gold/5 px-4 py-2 text-sm"><span>{(areaStatus ? areaStatus(matching.map((item) => item.key)) : LANDING_COPY.areaFilter(matching.length))}</span><button type="button" onClick={() => setSelected(null)} className="min-h-11 font-medium text-gold underline underline-offset-4">{LANDING_COPY.clearArea}</button></div>}
        {renderList ? renderList({ keys: new Set(matching.map((item) => item.key)), open: (key, homeFocus) => { const community = keyed.find((item) => item.key === key) ?? lookup?.find((item) => item.key === key); if (community) { setFocus(homeFocus); setOpen(community); } }, hover: setActiveKey, activeKey }) : <>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2">
          {shown.map((community) => <CommunityCard key={community.key} community={community} active={activeKey === community.key} onHover={(on) => setActiveKey(on ? community.key : null)} onOpen={() => { setFocus(undefined); setOpen(community); }} />)}
        </div>
        {/* The next page loads as the visitor nears the end of the list (the button stays for keyboards and old browsers). */}
        <AutoMore key={shown.length} active={matching.length > shown.length} onNear={() => setPages((value) => value + 1)} />
        <ShowMore remaining={matching.length - shown.length} onClick={() => setPages((value) => value + 1)} />
        </>}
        {below}
      </div>
      {mapButtonAway && <button type="button" onClick={openPhoneMap} data-deals-floating-map="true" className={`fixed ${floatingMapBottom} left-1/2 z-30 inline-flex min-h-11 -translate-x-1/2 items-center gap-2 rounded-full bg-foreground px-5 text-sm font-semibold text-background shadow-xl lg:hidden`}><MapPin className="h-4 w-4" />{LANDING_COPY.mapButton}</button>}
      {/* The map fills the side of the screen and stays there while the list scrolls (no empty space under it). */}
      <aside className={`hidden min-w-0 lg:block ${mapSide === "left" ? "lg:order-first" : ""}`} data-deals-map-side={mapSide}><div className={`sticky top-0 h-[100dvh] ${mapSide === "left" ? "py-2" : "py-4"}`}><RegionMap {...mapProps} className="h-full w-full" /></div></aside>
    </div>
    {open && <CommunitySheet community={open} useHomes={useHomes} filters={filters} focus={focus} options={sheet} onClose={() => setOpen(null)} onUnlock={onUnlock ? () => { setOpen(null); onUnlock(); } : undefined} />}
  </>;
}
