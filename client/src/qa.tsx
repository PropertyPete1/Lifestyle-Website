import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import "./index.css";
import { GatedCatalog, type GatedCommunity } from "@/components/deals/GatedCatalog";
import { AgentTools, type AgentWorkspaceData } from "@/components/deals/AgentTools";
import { GateSheetView } from "@/components/deals/GateSheet";
import { initialGateState, readGateParams } from "@/lib/dealsGate";
import { FeaturedDeals, FeaturedStrip } from "@/components/deals/FeaturedDeals";
import { BrowseBar } from "@/components/deals/BrowseBar";
import { EMPTY_FILTERS, landingMatches, sortLandingCommunities, type BrowseFilters } from "@/lib/dealsBrowse";
import { rankFeatured } from "@shared/dealsFeatured";
import { LandingBrowse, type LandingCommunity } from "@/components/deals/LandingBrowse";

const featured = rankFeatured([
  { communityKey: "a", label: "Southeast San Antonio | New Phase Now Selling", area: "Southeast San Antonio", card: "aaaaaaaaaaaaaaaaaaa2", price: 354_990, beds: "4", sqft: 2011, kind: "quick_move_in", offer: null, acres: null, excluded: false, garage: "2" },
  { communityKey: "b", label: "Southeast San Antonio | Half-Acre Lots and Lakes", area: "Southeast San Antonio", card: "aaaaaaaaaaaaaaaaaaa1", price: 499_990, beds: "4", sqft: 2776, kind: "quick_move_in", offer: { ratePercent: 4.999, firstYearRatePercent: null, loanType: "FHA", downPercent: 3.5 }, acres: 0.5, excluded: false, garage: "2", previousPrice: 529_990 },
  { communityKey: "c", label: "Northwest San Antonio | Hill Country Views", area: "Northwest San Antonio", card: "c1", price: 389_990, beds: "3", sqft: 1850, kind: "quick_move_in", offer: { ratePercent: 5.99, firstYearRatePercent: 3.99, loanType: "Conventional", downPercent: 5 }, acres: null, excluded: false, garage: "2" },
], { marketRatePercent: 7.4, defaultDownPercent: 5 });

const photos = [1, 2, 3, 4, 5, 6].map((n) => `/qa/home${n}.jpg`);
const day = 86_400_000;
const communities: GatedCommunity[] = [{
  label: "Southeast San Antonio | Half-Acre Lots and Lakes", area: "Southeast San Antonio", schoolDistrict: "East Central ISD", lotSizes: "Half-acre homesites", amenities: ["Lakes", "Trails", "Pool"],
  fromPrice: 499_990, reelUrl: "https://youtube.com/shorts/1P43uC596Wc?si=Xc2k_g7b2y9kaWvU", updatedAt: new Date().toISOString(),
  incentive: { text: "4.999% (5.737% APR) FHA 30yr, fixed-rate special financing on select homes! 3.5% minimum down payment. 360 monthly payments.", teaser: "4.999% FHA special financing", headlineRate: "4.999%", followOnRate: null, followOnPeriod: null, apr: "5.737%", loanType: "FHA", downPayment: "3.5% minimum down payment", repaymentTerms: null, contractBy: null, closeBy: null } as never,
  details: { builderName: "Chesmar Homes", communityName: "Sienna Lakes", address: "100 Sienna Lakes Blvd, San Antonio, TX 78263", salesLine: "(210) 555-0999", builderPage: "https://www.chesmar.com/" },
  homes: [
    { card: "aaaaaaaaaaaaaaaaaaa1", kind: "quick_move_in", beds: 4, baths: 3, sqft: 2776, price: 507_990, previousPrice: 529_990, moveInDate: "2026-11-15", lotSize: "0.5 acre", photos, details: { address: "118 Sienna Lakes Blvd", planName: "Brandon", builderPage: "https://www.chesmar.com/" } },
    { card: "aaaaaaaaaaaaaaaaaaa2", kind: "quick_move_in", beds: 5, baths: 4, sqft: 3803, price: 589_990, moveInDate: "2026-12-01", photos: photos.slice(2, 5), details: { address: "126 Sienna Lakes Blvd", planName: "Evan", builderPage: null } },
    { card: "aaaaaaaaaaaaaaaaaaa3", kind: "to_be_built", beds: 4, baths: 3, sqft: 2900, price: 499_990, photos: [], details: { planName: "Lexington" } },
  ],
}];
const lead = (over: Record<string, unknown> = {}) => ({ display: "(210) •••-0202", expiresAt: new Date(Date.now() + 6.5 * day).toISOString(), name: "Maria", timeline: "0-3 months", teamPreview: false, agentClient: true, ...over });
const workspace: AgentWorkspaceData = { agent: { name: "Tiffany Agent", email: "t@example.com", fubLinked: true }, pagePath: "/deals/u/tiffany-proske", clients: [
  { id: 1, clientName: "Maria Lopez", clientPhone: "(210) 555-0202", clientPhoneDigits: "2105550202", note: "Wants 4 beds, VA loan", path: "/deals?c=Abc123_-Abc123_-Abc123_-Abc123_-", createdAt: new Date(Date.now() - 2 * day).toISOString(), expiresAt: new Date(Date.now() + 28 * day).toISOString(), revoked: false, openedAt: new Date(Date.now() - day).toISOString(), openCount: 3, verifiedAt: new Date(Date.now() - day).toISOString(), accessExpiresAt: new Date(Date.now() + 6 * day).toISOString(), lastViewedAt: new Date(Date.now() - 3_600_000).toISOString(),
    saves: [{ card: "x", description: "118 Sienna Lakes Blvd (Brandon)", price: 507_990, communityLabel: "Sienna Lakes (Southeast San Antonio | Half-Acre Lots and Lakes)", savedAt: new Date().toISOString() }],
    requests: [{ kind: "tour", description: "126 Sienna Lakes Blvd (Evan)", preferredAt: new Date(Date.now() + 2 * day).toISOString(), createdAt: new Date().toISOString() }] },
  { id: 2, clientName: "Sam Reyes", clientPhone: null, clientPhoneDigits: null, note: null, path: "/deals?c=Zzz123_-Zzz123_-Zzz123_-Zzz123_-", createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(), expiresAt: new Date(Date.now() + 30 * day).toISOString(), revoked: false, openedAt: null, openCount: 0, verifiedAt: null, accessExpiresAt: null, lastViewedAt: null, saves: [], requests: [] },
], assigned: [
  { leadId: 9, name: "Jordan Ellis", phone: "(210) 555-0404", phoneDigits: "2105550404", fubUrl: "https://app.followupboss.com/2/people/view/501", viaAgent: null, lastViewedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    saves: [{ card: "y", description: "2215 Saddle Ridge (Ash)", price: 389_990, communityLabel: "Saddle Ridge (North San Antonio | Hill Country Views)", savedAt: new Date(Date.now() - 5 * 3_600_000).toISOString() }, { card: "z", description: "9 Bluebonnet Way (Cedar)", price: 412_490, communityLabel: "Bluebonnet Park (New Braunfels | Pool and Trails)", savedAt: new Date(Date.now() - 3 * 3_600_000).toISOString() }], requests: [] },
  { leadId: 10, name: "Priya Shah", phone: "(210) 555-0505", phoneDigits: "2105550505", fubUrl: "https://app.followupboss.com/2/people/view/502", viaAgent: "Steven Allen", lastViewedAt: null,
    saves: [], requests: [{ kind: "tour", description: "77 Oak Run (Laurel)", preferredAt: new Date(Date.now() + day).toISOString(), createdAt: new Date().toISOString() }] },
] };

const comingSoon = [{ key: "a1", area: "New Braunfels", fromPriceLabel: "From the $300s" }, { key: "a2", area: "Boerne", fromPriceLabel: null }, { key: "a3", area: "Castroville", fromPriceLabel: "From the $400s" }, { key: "a4", area: "Northeast San Antonio", fromPriceLabel: "From the $200s" }];
function Client() {
  const [saved, setSaved] = useState<string[]>(["aaaaaaaaaaaaaaaaaaa1"]);
  return <GatedCatalog lead={lead()} communities={communities} featured={featured} saved={saved} onSave={(card, on) => setSaved((s) => on ? [...s, card] : s.filter((c) => c !== card))} agent={{ name: "Tiffany Agent", firstName: "Tiffany", phone: "(210) 555-0101" }} onRequest={() => undefined} comingSoon={comingSoon} />;
}
function Team() {
  const [picked, setPicked] = useState<string[]>(["aaaaaaaaaaaaaaaaaaa1"]);
  const pick = { picked: new Set(picked), onToggle: (card: string) => setPicked((s) => s.includes(card) ? s.filter((c) => c !== card) : [...s, card]) };
  const ws = { ...workspace, clients: workspace.clients.map((c, i) => i === 0 ? { ...c, picks: [{ card: "aaaaaaaaaaaaaaaaaaa2", description: "126 Sienna Lakes Blvd (Evan)", price: 589_990, communityLabel: "Sienna Lakes (Southeast San Antonio | Half-Acre Lots and Lakes)" }] } : c) };
  return <><GatedCatalog lead={lead({ teamPreview: true, agentClient: false, name: "Tiffany" })} communities={communities} pick={pick} tools={<AgentTools workspace={ws} onCreate={() => undefined} onRevoke={() => undefined} onCopy={() => undefined} picked={picked} onClearPicks={() => setPicked([])} onSetPicks={async () => ({ pickCount: picked.length })} />} />
    {picked.length > 0 && <div role="status" data-deals-pick-tray="true" className="fixed bottom-5 left-5 right-5 z-30 flex items-center justify-between gap-3 border border-gold/50 bg-card/95 px-4 py-3 shadow-xl backdrop-blur sm:left-auto sm:right-8 sm:w-[26rem]"><p className="min-w-0 text-sm"><span className="font-medium">{picked.length} home{picked.length === 1 ? "" : "s"} picked</span></p><div className="flex shrink-0 items-center gap-2"><button type="button" onClick={() => setPicked([])} className="min-h-11 px-2 text-xs uppercase tracking-widest text-muted-foreground hover:text-gold">Clear</button><button type="button" className="min-h-11 bg-gold px-4 text-xs font-medium uppercase tracking-[0.14em] text-primary-foreground">Send to a client</button></div></div>}
  </>;
}
function Picked() {
  return <GatedCatalog lead={lead()} communities={communities} featured={featured} saved={[]} picks={["aaaaaaaaaaaaaaaaaaa2", "aaaaaaaaaaaaaaaaaaa1"]} onSave={() => undefined} agent={{ name: "Tiffany Agent", firstName: "Tiffany", phone: "(210) 555-0101" }} onRequest={() => undefined} comingSoon={comingSoon} />;
}
function Gate() {
  const state = { pending: null, consentText: "By tapping Continue, you agree that Lifestyle Design Realty may call and text you about new-build homes at the number you entered, including automated texts.", clientLink: { state: "live", agentName: "Tiffany Agent", clientFirstName: "Maria" } } as never;
  const noop = () => undefined;
  return <div className="deals-light min-h-screen bg-background"><GateSheetView gate={initialGateState(readGateParams("?c=Abc123_-Abc123_-Abc123_-Abc123_-"), state)} state={state} phone="" code="" choice={null} onPhone={noop} onCode={noop} onChoice={noop} onContinue={noop} onConfirmAgent={noop} onGo={noop} onResend={noop} onChangeNumber={noop} onCopyLink={noop} onClose={noop} /></div>;
}
function PageGate() {
  const state = { pending: null, consentText: "By tapping Continue, you agree that Lifestyle Design Realty may call and text you about new-build homes at the number you entered, including automated texts.", clientLink: null, agentPage: { agentName: "Tiffany Proske", firstName: "Tiffany" } } as never;
  const noop = () => undefined;
  return <div className="deals-light min-h-screen bg-background"><GateSheetView gate={initialGateState(readGateParams("?a=tiffany-proske"), state)} state={state} phone="" code="" choice={null} onPhone={noop} onCode={noop} onChoice={noop} onContinue={noop} onConfirmAgent={noop} onGo={noop} onResend={noop} onChangeNumber={noop} onCopyLink={noop} onClose={noop} /></div>;
}
function TeamGate() {
  const state = { pending: null, consentText: "By tapping Continue, you agree that Lifestyle Design Realty may call and text you about new-build homes at the number you entered, including automated texts." } as never;
  const noop = () => undefined;
  return <div className="deals-light min-h-screen bg-background"><GateSheetView gate={initialGateState(readGateParams("?gate=1&team=1"), state)} state={state} phone="" code="" choice={null} teamSignIn onSiteLogin={noop} onPhone={noop} onCode={noop} onChoice={noop} onContinue={noop} onConfirmAgent={noop} onGo={noop} onResend={noop} onChangeNumber={noop} onCopyLink={noop} onClose={noop} /></div>;
}
function Landing() {
  return <main className="deals-light min-h-screen bg-background px-5 pb-10 pt-6"><FeaturedDeals featured={featured} locked onSelect={() => undefined} /></main>;
}
const AREAS = ["Northwest San Antonio", "New Braunfels", "Southeast San Antonio", "North San Antonio", "Boerne", "Kyle", "Georgetown", "North Austin"];
const DISTRICTS = ["Northside ISD", "Comal ISD", "Boerne ISD", "Hays CISD", "Georgetown ISD", "Austin ISD"];
const many: GatedCommunity[] = Array.from({ length: 20 }, (_, index) => ({
  ...communities[0]!, key: `k${index}`, fromYourReel: index === 0, details: null,
  label: `${AREAS[index % AREAS.length]} | ${["Half-Acre Lots and Lakes", "From the $300s", "Move-In Ready Homes", "Trails and Parks"][index % 4]}`,
  area: AREAS[index % AREAS.length]!, reelUrl: index % 3 === 0 ? "https://www.instagram.com/reel/DepdmLHMLet/" : null,
  incentive: index % 2 === 0 ? communities[0]!.incentive : null,
  homes: communities[0]!.homes.map((home, n) => ({ ...home, card: `${home.card.slice(0, 15)}${String(index).padStart(2, "0")}${n}x`, price: (home.price ?? 400_000) - 120_000 + index * 9_000, details: undefined })),
}));
function Many() {
  return <GatedCatalog lead={lead({ agentClient: false })} communities={many} featured={featured} saved={[]} onSave={() => undefined} onRequest={() => undefined} />;
}

const browse: LandingCommunity[] = Array.from({ length: 14 }, (_, index) => ({
  key: `k${String(index).padStart(11, "0")}`, label: `${AREAS[index % AREAS.length]} | ${["Half-Acre Lots and Lakes", "From the $300s", "Move-In Ready Homes", "Trails and Parks"][index % 4]}`, area: AREAS[index % AREAS.length]!,
  fromPriceLabel: `From the $${2 + (index % 4)}00s`, fromPrice: 200_000 + (index % 4) * 100_000, reelUrl: index % 3 === 0 ? "https://youtube.com/shorts/1P43uC596Wc" : null, homesAvailable: index % 4 === 3 ? 0 : (index % 5) + 1,
  incentive: index % 2 === 0 ? ({ text: "x", teaser: "4.99% FHA special financing", headlineRate: "4.99%", apr: "5.6%", followOnRate: null, followOnPeriod: null } as never) : null,
  cover: index % 6 === 5 ? null : photos[index % 6], pin: { x: 0.3 + ((index * 37) % 40) / 100, y: 0.3 + ((index * 53) % 40) / 100 }, fromYourReel: index === 0,
}));
const featuredWithPhotos = { ...featured, lowestPayment: featured.lowestPayment.map((deal, index) => ({ ...deal, photo: photos[index] })) };
function Browse() {
  return <main className="deals-light min-h-screen bg-background px-5 pb-10 pt-6"><div className="mx-auto max-w-7xl"><h1 className="max-w-2xl text-4xl leading-tight sm:text-5xl">This week's best new-build deals in San Antonio.</h1><FeaturedDeals featured={featuredWithPhotos} locked onSelect={() => undefined} /><LandingBrowse communities={browse} useHomes={() => ({ isLoading: false, data: [0, 1, 2, 3].map((n) => ({ card: `h${n}`, kind: n === 3 ? "to_be_built" : "quick_move_in", beds: 3 + (n % 2), baths: 2, sqft: 1800 + n * 150, garage: "2", stories: 1 + (n % 2), price: 289_990 + n * 15_000, previousPrice: n === 0 ? 299_990 : null, moveInDate: n === 3 ? null : "Dec 2026", lotSize: n === 1 ? "0.18 acre" : null, photos: n === 2 ? [] : photos.slice(n, n + 3) })) })} onUnlock={() => undefined} /></div></main>;
}
const livePins: Array<{ key: string; pin: { x: number; y: number } }> = location.search.includes("live") ? (() => { const xhr = new XMLHttpRequest(); xhr.open("GET", "/qa/live-pins.json", false); xhr.send(); return JSON.parse(xhr.responseText); })() : [];
const saPins = livePins.length ? livePins.map((item, index) => ({ ...browse[index % browse.length]!, key: item.key, pin: item.pin, redHotDeals: 0, homeFacts: [] })) : browse.map((item, index) => ({ ...item, schoolDistrict: DISTRICTS[index % DISTRICTS.length], pin: index % 3 === 0 ? { x: 0.47, y: 0.62 } : { x: 0.36 + ((index * 37) % 26) / 100, y: 0.55 + ((index * 53) % 24) / 100 }, redHotDeals: index % 4 === 1 ? 2 : 0, newThisWeek: index % 6 === 2 ? 1 : 0, homeFacts: [[280_000 + index * 9_000, 3 + (index % 3), 2 + (index % 2) * 0.5, 1_500 + index * 60, 2 + (index % 4 === 0 ? 1 : 0), index % 5 === 0 ? 1 : 0, 1 + (index % 2), null, null, index % 6 === 2 ? 1 : 0]] }));
function TeamMany() {
  const [picked, setPicked] = useState<string[]>([]);
  const pick = { picked: new Set(picked), onToggle: (card: string) => setPicked((s) => s.includes(card) ? s.filter((c) => c !== card) : [...s, card]) };
  const list = many.map((community, index) => ({ ...community, pin: saPins[index % saPins.length]!.pin, details: { builderName: "Chesmar", communityName: `Place ${index}`, address: "100 Example Rd, San Antonio, TX 78263", salesLine: "(210) 555-0999", builderPage: "https://www.chesmar.com/" }, homes: index === 0 ? communities[0]!.homes : community.homes }));
  return <GatedCatalog lead={lead({ teamPreview: true, agentClient: false, name: "Peter Allen", display: "Peter Allen" })} communities={list} featured={featured} pick={pick} tools={<AgentTools workspace={workspace} onCreate={() => undefined} onRevoke={() => undefined} onCopy={() => undefined} picked={picked} onClearPicks={() => setPicked([])} onSetPicks={async () => ({ pickCount: picked.length })} defaultClientsOpen={false} />} />;
}
function DealsPage() {
  const [filters, setFilters] = useState<BrowseFilters>(EMPTY_FILTERS);
  const matching = sortLandingCommunities(saPins.filter((community) => landingMatches(community as never, filters)) as never[], filters.sort);
  return <main className="deals-light min-h-screen max-w-full overflow-x-clip bg-background"><header className="deals-chrome flex min-w-0 items-center justify-center border-b border-border/60 px-5 py-5"><span className="font-serif text-sm tracking-[0.14em]">LIFESTYLE DESIGN <span className="text-gold">REALTY</span></span></header><section className="ambient-section px-4 pb-28 pt-6 sm:px-6"><div className="mx-auto max-w-[1600px]"><p className="eyebrow text-gold">New construction deals</p><h1 className="mt-2 max-w-3xl text-3xl leading-tight sm:text-4xl">This week's best new-build deals in San Antonio.</h1><p className="mt-2 text-sm text-muted-foreground">Hand-picked by Property Pete.</p><BrowseBar filters={filters} onChange={setFilters} areas={saPins} shown={matching.length} total={saPins.length} unit="communities" showNew /><LandingBrowse communities={matching as never} filters={filters} useHomes={() => ({ isLoading: false, data: [0, 1, 2, 3].map((n) => ({ card: `h${n}`, kind: n === 3 ? "to_be_built" : "quick_move_in", beds: 3 + (n % 2), baths: 2, sqft: 1800 + n * 150, garage: "2", stories: 1 + (n % 2), isNew: n === 1, price: 289_990 + n * 15_000, previousPrice: n === 0 ? 309_990 : null, moveInDate: n === 3 ? null : "Dec 2026", lotSize: n === 1 ? "0.18 acre" : null, photos: n === 2 ? [] : photos.slice(n, n + 3) })) })} onUnlock={() => undefined} top={(actions) => <FeaturedStrip featured={{ ...featuredWithPhotos, lowestPayment: featuredWithPhotos.lowestPayment.map((deal, index) => ({ ...deal, landingKey: saPins[index * 4 + 1]?.key, price: location.search.includes("match") ? 240_105 + (index * 4 + 1) * 9_000 : 304_990, sqft: location.search.includes("match") ? 1_276 + (index * 4 + 1) * 60 : 1_950, kind: location.search.includes("match") && (index * 4 + 1) % 5 === 0 ? "to_be_built" : "quick_move_in" })) }} opens onHover={(deal) => actions.hover(deal?.landingKey ?? null)} onSelect={(deal) => { if (deal.landingKey) actions.openHome(deal.landingKey, { price: deal.price, sqft: deal.sqft, kind: deal.kind }); }} />} /></div></section></main>;
}

import { PublicHomeList, publicHomeEntries } from "@/components/deals/PublicHomeList";
function PublicHomesQA() {
  const [filters, setFilters] = useState<BrowseFilters>(EMPTY_FILTERS);
  const [listView, setListView] = useState<"homes" | "communities">("homes");
  const withFacts = saPins.map((item, index) => ({ ...item, homeFacts: [0, 1, 2].map((n) => [280_000 + index * 9_000 + n * 21_000, 3 + ((index + n) % 3), 2 + (n % 2) * 0.5, 1_500 + index * 60 + n * 200, 2, (index + n) % 5 === 0 ? 1 : 0, 1 + (n % 2), n === 0 && index % 3 === 0 ? 300_000 + index * 9_000 : null, n === 1 ? "Dec 2026" : null, 0]) }));
  const matching = sortLandingCommunities(withFacts.filter((community) => landingMatches(community as never, filters)) as never[], filters.sort) as typeof withFacts;
  const entries = publicHomeEntries(matching as never, filters);
  const useHomes = (key: string | undefined) => { const community = withFacts.find((item) => item.key === key); return { isLoading: false, data: (community?.homeFacts ?? []).map((facts, n) => ({ card: `h${n}`, kind: facts[5] ? "to_be_built" : "quick_move_in", beds: facts[1], baths: facts[2], sqft: facts[3], garage: "2", price: facts[0], previousPrice: facts[7], moveInDate: facts[8], photos: n === 2 ? [] : photos.slice(n, n + 3) })) as never }; };
  return <main className="deals-light min-h-screen max-w-full overflow-x-clip bg-background"><header className="deals-chrome flex min-w-0 items-center justify-center border-b border-border/60 px-5 py-5"><span className="font-serif text-sm tracking-[0.14em]">LIFESTYLE DESIGN <span className="text-gold">REALTY</span></span></header><section className="ambient-section px-4 pb-28 pt-6 sm:px-6"><div className="mx-auto max-w-[1600px]"><p className="eyebrow text-gold">New construction deals</p><h1 className="mt-2 max-w-3xl text-3xl leading-tight sm:text-4xl">This week's best new-build deals in San Antonio.</h1><p className="mt-2 text-sm text-muted-foreground">Hand-picked by Property Pete.</p>
    <BrowseBar compact filters={filters} onChange={setFilters} areas={withFacts} shown={entries.length} total={withFacts.length * 3} unit="homes" showBeds showNew />
    <div className="mt-2 flex items-center justify-between gap-2" data-deals-results-bar="true"><p data-deals-result-count="true">{entries.length} HOMES</p><div>{(["homes", "communities"] as const).map((value) => <button key={value} type="button" data-deals-list-view={value} onClick={() => setListView(value)}>{value}</button>)}</div></div>
    <LandingBrowse mapSide="left" phoneMap="floating" searchArea floatingMapBottom="bottom-24" communities={matching as never} filters={filters} useHomes={useHomes} onUnlock={() => undefined} renderList={listView === "homes" ? (context) => <PublicHomeList entries={entries} context={context} useHomes={useHomes} /> : undefined} top={(actions) => <FeaturedStrip featured={{ ...featuredWithPhotos, lowestPayment: featuredWithPhotos.lowestPayment.map((deal, index) => ({ ...deal, landingKey: saPins[index * 4 + 1]?.key, price: 304_990, sqft: 1_950, kind: "quick_move_in" })) }} opens onHover={(deal) => actions.hover(deal?.landingKey ?? null)} onSelect={(deal) => { if (deal.landingKey) actions.openHome(deal.landingKey, { price: deal.price, sqft: deal.sqft, kind: deal.kind }); }} />} /></div></section></main>;
}
import { PublicDealsPage } from "@/components/deals/PublicDealsPage";
function useQaSlow() { const slow = location.search.includes("slow"); const [ready, setReady] = useState(!slow); useEffect(() => { if (!slow) return; const t = setTimeout(() => setReady(true), 2500); return () => clearTimeout(t); }, [slow]); return ready; }
function DesignF() {
  const rates = [
    { text: "x", teaser: "4.99% FHA special financing", headlineRate: "4.99%", followOnRate: null, followOnPeriod: null, apr: "5.62%", loanType: "FHA", downPayment: "3.5% down", repaymentTerms: null, contractBy: null, closeBy: null },
    { text: "x", teaser: "3.99% first year, then 5.99%", headlineRate: "3.99%", followOnRate: "5.99%", followOnPeriod: "Years 2-30", apr: "6.21%", loanType: "Conventional", downPayment: "5% down", repaymentTerms: null, contractBy: null, closeBy: null },
    null,
  ];
  const withFacts = saPins.map((item, index) => ({ ...item, incentive: rates[index % 3] as never, updatedAt: new Date().toISOString(), homeFacts: [0, 1, 2].map((n) => [240_105 + index * 9_000 + n * 21_000, 3 + ((index + n) % 3), 2 + (n % 2) * 0.5, 1_276 + index * 60 + n * 200, 2, (index + n) % 5 === 0 ? 1 : 0, 1 + (n % 2), n === 0 && index % 3 === 0 ? 255_000 + index * 9_000 : null, n === 1 ? "Dec 2026" : null, index === 2 && n === 0 ? 1 : 0]) as never }));
  const useHomes = (key: string | undefined) => { const ready = useQaSlow(); const community = withFacts.find((item) => item.key === key); return { isLoading: !ready, data: !ready ? undefined : ((community?.homeFacts ?? []) as never[]).map((facts: never[], n) => ({ card: `h${n}`, kind: facts[5] ? "to_be_built" : "quick_move_in", beds: facts[1], baths: facts[2], sqft: facts[3], garage: "2", price: facts[0], previousPrice: facts[7], moveInDate: facts[8], photos: photos.slice((n + (key?.length ?? 0)) % 6, ((n + (key?.length ?? 0)) % 6) + 3) })) as never }; };
  return <PublicDealsPage communities={withFacts as never} useHomes={useHomes} featured={{ ...featuredWithPhotos, lowestPayment: featuredWithPhotos.lowestPayment.map((deal, index) => ({ ...deal, landingKey: saPins[index * 4 + 1]?.key, price: location.search.includes("match") ? 240_105 + (index * 4 + 1) * 9_000 : 304_990, sqft: location.search.includes("match") ? 1_276 + (index * 4 + 1) * 60 : 1_950, kind: location.search.includes("match") && (index * 4 + 1) % 5 === 0 ? "to_be_built" : "quick_move_in" })) } as never} comingSoon={comingSoon} onTour={() => undefined} />;
}
import TeamPhotoQ from "@/components/TeamPhoto";
function TeamCardsQA() {
  const people = [["Tiffany Proske", "REALTOR®", ""], ["Nicki Pauley", "REALTOR®", ""], ["Laila Maria", "REALTOR®", "/team/laila.webp"], ["Stefanie Graham", "Market Team Lead · REALTOR®", "https://drive.google.com/thumbnail?id=broken"]];
  return <main className="min-h-screen bg-background p-6"><div className="grid grid-cols-2 gap-6 md:grid-cols-4">{people.map(([name, title, photo]) => <div key={name} className="group text-left"><div className="relative aspect-[3/4] bg-secondary overflow-hidden flex items-center justify-center"><TeamPhotoQ photo={photo} name={name} className="h-full w-full object-cover" /></div><h2 className="font-sans text-base uppercase tracking-[0.12em] mt-4">{name}</h2><p className="text-[11px] uppercase tracking-[0.15em] text-gold mt-1">{title}</p></div>)}</div></main>;
}
import { DetailsRequestView as DetailsViewQ } from "@/components/deals/DetailsRequestSheet";
function DetailsQA() {
  const [form, setForm] = useState({ name: "", phone: "", email: "", notes: "" });
  const done = location.search.includes("done");
  return <div className="deals-light min-h-screen bg-background"><DetailsViewQ summary="3 beds · 1,800 sq ft · $329,990 · East San Antonio" form={form} onChange={(next) => setForm((c) => ({ ...c, ...next }))} problem={location.search.includes("err") ? "Enter a valid email." : null} sending={false} sentTo={done ? "Maria" : null} onSubmit={() => undefined} onClose={() => undefined} /></div>;
}

import { trpc as trpcQ } from "@/lib/trpc";
import { trpcLinks as trpcLinksQ } from "@/lib/trpcLinks";
import { QueryClient as QCQ, QueryClientProvider as QCPQ } from "@tanstack/react-query";
import { Route as RouteQ } from "wouter";
import ValuationQ from "@/pages/Valuation";
import SellQ from "@/pages/Sell";
import NeighborhoodDetailQ from "@/pages/NeighborhoodDetail";
import superjsonQ from "superjson";
const qaHood = { id: 1, slug: "san-antonio", name: "San Antonio", region: "Bexar County", tagline: "Military City USA, Hill Country edges and the River Walk.", description: "San Antonio overview text.", heroImage: location.search.includes("nophoto") ? null : "/brand/texas-river.webp", stats: null };
const qaFetch: typeof fetch = async (input) => {
  const url = new URL(String(input), location.href);
  const paths = url.pathname.replace("/api/trpc/", "").split(",");
  const body = paths.map((path) => path === "neighborhoods.bySlug" ? { result: { data: superjsonQ.serialize(qaHood) } } : path.startsWith("listings.") ? { result: { data: superjsonQ.serialize([]) } } : { error: superjsonQ.serialize({ message: "qa", code: -32004, data: { code: "NOT_FOUND", httpStatus: 404 } }) });
  return new Response(JSON.stringify(url.searchParams.get("batch") ? body : body[0]), { status: 200, headers: { "content-type": "application/json" } });
};
function PagesQA({ page }: { page: string }) {
  document.documentElement.classList.remove("dark");
  const [qc] = useState(() => new QCQ({ defaultOptions: { queries: { retry: false } } }));
  const [client] = useState(() => trpcQ.createClient({ links: trpcLinksQ(qaFetch) }));
  return <trpcQ.Provider client={client} queryClient={qc}><QCPQ client={qc}>{page === "valuation" ? <ValuationQ /> : page === "sell" ? <SellQ /> : <RouteQ path="/:slug" component={NeighborhoodDetailQ} />}</QCPQ></trpcQ.Provider>;
}

const view = location.hash.slice(1);
import { ListSkeleton as ListSkeletonComponent } from "@/components/deals/GatedCatalog";
function ListSkeletonQA() { return <ListSkeletonComponent label="Preparing the team list…" />; }
createRoot(document.getElementById("root")!).render(["valuation","sell","city"].includes(view) ? <PagesQA page={view} /> : view === "details" ? <DetailsQA /> : view === "teamcards" ? <TeamCardsQA /> : view === "f" ? <DesignF /> : view === "publichomes" ? <PublicHomesQA /> : view === "skeleton" ? <ListSkeletonQA /> : view === "team" ? <Team /> : view === "teammany" ? <TeamMany /> : view === "picked" ? <Picked /> : view === "gate" ? <Gate /> : view === "pagegate" ? <PageGate /> : view === "teamgate" ? <TeamGate /> : view === "landing" ? <Landing /> : view === "many" ? <Many /> : view === "browse" ? <Browse /> : view === "deals" ? <DealsPage /> : <Client />);
