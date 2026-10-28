import { useEffect, useState } from "react";
import { HOME_PAGE, HomeTile, type GatedCommunity, type GatedHome } from "./GatedCatalog";
import { AutoMore, type BrowseListContext, type LandingCommunity, type UseCommunityHomes } from "./LandingBrowse";
import { ShowMore } from "./BrowseBar";
import { homeFiltersOn, homePasses, landingHome, sortHomes, type BrowseFilters, type LandingHomeFacts } from "@/lib/dealsBrowse";

/**
 * Oct 28, 2026 (Peter: the public page gets the same home list as the team view): every home on the landing page as a
 * New Home Buddy card. The landing catalog carries each home's public figures (never an address, builder or community
 * name); a card's photo comes from its community's public homes, read for the communities on screen.
 */
export type PublicHomeEntry = { key: string; index: number; community: LandingCommunity; home: GatedHome };
/** A landing community with its homes' public figures (the catalog sends them for the filters). */
type WithFacts = LandingCommunity & { homeFacts?: ReadonlyArray<LandingHomeFacts | readonly unknown[]> | null };

/** The landing's homes, one entry each, in the communities' order (or sorted), with the page's home filters applied. */
export function publicHomeEntries(communities: readonly WithFacts[], filters: BrowseFilters): PublicHomeEntry[] {
  const narrow = homeFiltersOn(filters);
  const entries = communities.flatMap((community) => (community.homeFacts ?? []).map((facts, index: number) => {
    const home = landingHome(facts as LandingHomeFacts);
    return { key: community.key ?? "", index, community, home: { ...home, card: `${community.key ?? "c"}-${index}`, beds: home.beds ?? null, baths: home.baths ?? null, garage: home.garage == null ? null : String(home.garage), photos: [] } as GatedHome };
  })).filter((entry) => entry.key && (!narrow || homePasses(entry.home, { ...filters, bigLots: false })));
  return filters.sort === "recommended" ? entries : sortHomes(entries.map((entry) => ({ ...entry.home, entry })), filters.sort).map((item) => item.entry);
}

function PublicTile({ entry, context, useHomes }: { entry: PublicHomeEntry; context: BrowseListContext; useHomes: UseCommunityHomes }) {
  const homes = useHomes(entry.key);
  // Matched by its figures (the catalog and the community's homes are read a moment apart), else by its place.
  const match = homes.data?.find((home) => home.price === entry.home.price && home.sqft === entry.home.sqft && home.kind === entry.home.kind) ?? homes.data?.[entry.index];
  const home = { ...entry.home, photos: match?.photos?.slice(0, 1) ?? [] };
  return <HomeTile home={home} community={entry.community as unknown as GatedCommunity} photoPending={homes.isLoading}
    onOpen={() => context.open(entry.key, { price: entry.home.price, sqft: entry.home.sqft, kind: entry.home.kind })}
    onHover={(on) => context.hover(on ? entry.key : null)} />;
}

export function PublicHomeList({ entries, context, useHomes }: { entries: readonly PublicHomeEntry[]; context: BrowseListContext; useHomes: UseCommunityHomes }) {
  const inView = entries.filter((entry) => context.keys.has(entry.key));
  const [pages, setPages] = useState(1);
  const keysSignature = Array.from(context.keys).join(",");
  useEffect(() => setPages(1), [keysSignature, entries]);
  const shown = inView.slice(0, pages * HOME_PAGE);
  return <div data-deals-home-list="public">
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
      {shown.map((entry) => <PublicTile key={entry.home.card} entry={entry} context={context} useHomes={useHomes} />)}
    </div>
    <AutoMore key={shown.length} active={inView.length > shown.length} onNear={() => setPages((value) => value + 1)} />
    <ShowMore remaining={inView.length - shown.length} step={HOME_PAGE} onClick={() => setPages((value) => value + 1)} />
  </div>;
}
