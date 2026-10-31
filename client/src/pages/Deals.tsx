import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { ArrowDownUp, ListChecks, LockKeyhole, RotateCcw, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { startLogin } from "@/const";
import { MINE_COPY, isUnauthorizedDealsError, parseMineCommunities, profileErrorCopy } from "@/lib/dealsMine";
import { TRANSIENT_GATE_PARAMS, agentRecruitRedirect, clientLinkTokenInUrl, forgetClientLinkToken, keepClientLinkToken, readGateParams, rememberClientLinkToken } from "@/lib/dealsGate";
import { GateSheet } from "@/components/deals/GateSheet";
import { GatedCatalog, HOME_LIST_COPY, ListSkeleton, pickedHomes, picksAsText, type GatedCommunity, type HomeRequest, type PickControl } from "@/components/deals/GatedCatalog";
import { PublicDealsPage } from "@/components/deals/PublicDealsPage";
import { keepSharedFilters, takeSharedFilters } from "@/lib/dealsListShare";
import { FeaturedStrip, type FeaturedDealsData } from "@/components/deals/FeaturedDeals";
import { AgentTools, type AgentWorkspaceData } from "@/components/deals/AgentTools";
import { ComingSoonSection } from "@/components/deals/ComingSoon";
import { DealsFooter, formatChicagoDate, useInstagramEmbeds } from "@/components/deals/shared";
import { BrowseBar, BROWSE_COPY } from "@/components/deals/BrowseBar";
import { LandingBrowse, type PublicHome, type UseCommunityHomes } from "@/components/deals/LandingBrowse";
import { BROWSE_PAGE, BROWSE_SORTS, EMPTY_FILTERS, landingMatches, newThisWeekKnown, sortLandingCommunities, storiesKnown, type BrowseFilters } from "@/lib/dealsBrowse";

const sourceLabel = "This week's best new-build deals in San Antonio.";

/** Mounted per home (keyed by the caller), so the preferred time never carries over from the previous card. */
function HomeRequestSheet({ request, onClose }: { request: HomeRequest | null; onClose: () => void }) {
  const [preferred, setPreferred] = useState("");
  const submit = trpc.deals.requestHome.useMutation({ onSuccess: () => { toast.success(MINE_COPY.requestSent); onClose(); } });
  if (!request) return null;
  return <div className="fixed inset-0 z-[95] flex items-end bg-black/70 p-4 sm:items-center sm:justify-center"><section role="dialog" aria-modal="true" aria-labelledby="deals-request-title" className="w-full max-w-md border border-gold/40 bg-card p-6 shadow-2xl"><button type="button" onClick={onClose} className="float-right -mr-2 -mt-2 flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-gold" aria-label="Close request form"><X className="h-4 w-4" /></button><p className="eyebrow text-gold">Personal assistance</p><h2 id="deals-request-title" className="mt-2 text-3xl">{request.requestType === "tour" ? "Tour this home with us" : "Ask about this one"}</h2><p className="mt-3 text-sm text-muted-foreground">Choose the day and time that works for you. We will confirm the details directly.</p><Label htmlFor="deals-preferred" className="mt-6 block text-xs uppercase tracking-widest">Preferred day and time</Label><Input id="deals-preferred" type="datetime-local" value={preferred} onChange={(event) => setPreferred(event.target.value)} className="mt-2 min-h-11" /><Button type="button" disabled={!preferred || submit.isPending} onClick={() => submit.mutate({ card: request.card, requestType: request.requestType, preferredAt: new Date(preferred).toISOString() })} className="mt-5 w-full bg-gold py-6 text-primary-foreground">{submit.isPending ? "Sending…" : "Send request"}</Button>{submit.isError && <p role="alert" className="mt-3 text-sm text-destructive">{submit.error.message}</p>}</section></div>;
}

/**
 * A buyer who already has a live list opens an agent's client link: one tap
 * connects the list to that agent (no second code), or they keep it as it is.
 */
function ConnectSheet({ agentName, token }: { agentName: string; token: string }) {
  const goToList = () => window.location.assign("/deals/mine");
  const attach = trpc.deals.attachClientLink.useMutation({
    onSuccess: (result) => { if (!result.ok) toast.error(result.message); goToList(); },
    onError: goToList,
  });
  return <div className="fixed inset-0 z-[95] flex items-end bg-black/70 p-4 sm:items-center sm:justify-center"><section role="dialog" aria-modal="true" aria-labelledby="deals-connect-title" data-deals-connect="true" className="w-full max-w-md border border-gold/40 bg-card p-6 shadow-2xl"><p className="eyebrow text-gold">Shared by {agentName}</p><h2 id="deals-connect-title" className="mt-2 text-3xl leading-tight">Connect your list with {agentName}?</h2><p className="mt-3 text-sm text-muted-foreground">You already have access. Connecting shows every address on your list, and {agentName} hears about the homes you save.</p><Button type="button" disabled={attach.isPending} onClick={() => attach.mutate({ c: token })} className="mt-6 w-full bg-gold py-6 text-primary-foreground">{attach.isPending ? "Connecting…" : `Yes, connect with ${agentName}`}</Button><Button type="button" variant="outline" disabled={attach.isPending} onClick={goToList} className="mt-3 w-full py-6">No thanks, take me to my list</Button></section></div>;
}

/** A community's homes on the landing page (prices, photos and specs; never an address or a name). */
const useLandingHomes: UseCommunityHomes = (key) => {
  const query = trpc.deals.publicHomes.useQuery({ key: key ?? "" }, { enabled: Boolean(key && /^[a-f0-9]{12}$/.test(key)), staleTime: 60_000 });
  return { isLoading: query.isLoading, data: query.data as PublicHome[] | undefined };
};

function Landing() {
  // An agent's client link (?c=, or the one this tab kept) goes to the state query, the gate and the start call.
  const [clientToken, setClientToken] = useState(() => rememberClientLinkToken(window.location.search));
  // Oct 28, 2026: an agent's link may carry the filters they sent (?f=); kept so the list opens on them after the code check.
  useState(() => { if (clientToken) keepSharedFilters(window.location.search); return null; });
  // Oct 28, 2026: an agent's own page (/deals/u/<name> → ?a=<name>); the server also remembers it for this browser.
  const [agentPageSlug] = useState(() => readGateParams(window.location.search).a);
  const state = trpc.deals.state.useQuery(clientToken ? { c: clientToken } : agentPageSlug ? { a: agentPageSlug } : undefined);
  // Oct 26, 2026: /deals/team with no session is the agent sign-in page (the same sheet, agent wording, phone only).
  const [teamSignIn] = useState(() => (/^\/deals\/team/.test(window.location.pathname) || new URLSearchParams(window.location.search).get("team") === "1") && !clientToken);
  // An agent kept off Builder Deals (their own answer or the screening) is sent to the agent recruiting page — unless
  // they came for the agent sign-in (Oct 27: Peter's browser was flagged on Oct 26, and every later visit, the sign-in
  // included, bounced to recruiting; signing in as the team clears the flag).
  const realtorRedirect = agentRecruitRedirect(state.data && "realtorRedirect" in state.data ? state.data.realtorRedirect : null, teamSignIn);
  useEffect(() => { if (realtorRedirect) window.location.replace(realtorRedirect); }, [realtorRedirect]);
  // The reel that brought the visitor (?src=) puts its community first.
  const [src] = useState(() => new URLSearchParams(window.location.search).get("src")?.trim().slice(0, 40) || undefined);
  // A shared community link (?k=<key>, Oct 26, 2026; ?c= is an agent's client link): that community's sheet opens on arrival.
  const [sharedKey] = useState(() => { const key = new URLSearchParams(window.location.search).get("k")?.trim().toLowerCase() ?? ""; return /^[a-f0-9]{12}$/.test(key) ? key : null; });
  const catalog = trpc.deals.publicCatalog.useQuery(src ? { src } : undefined);
  const featured = trpc.deals.featured.useQuery();
  const comingSoon = trpc.deals.comingSoon.useQuery();
  // October 24, 2026: visitors browse every home first; the sign-up opens when they ask for a tour, or when a
  // link brings them to it (an agent's client link, a code in progress, an expired or blocked session, a lapsed list).
  const [gateOpen, setGateOpen] = useState(() => Boolean(clientToken) || TRANSIENT_GATE_PARAMS.some((name) => new URLSearchParams(window.location.search).has(name)) || /^\/deals\/(mine|team)/.test(window.location.pathname));
  useInstagramEmbeds();
  // With no token in hand, the server may name the link from this browser's lapsed agent-client session.
  const linkToken = clientToken ?? state.data?.clientLinkToken ?? undefined;
  useEffect(() => { if (!clientToken && state.data?.clientLinkToken) keepClientLinkToken(state.data.clientLinkToken); }, [clientToken, state.data?.clientLinkToken]);
  // A kept token (not in this URL) whose link died is forgotten, so the tab reaches the regular gate.
  const deadKeptToken = Boolean(clientToken && state.data?.clientLink?.state === "dead" && !clientLinkTokenInUrl(window.location.search));
  useEffect(() => { if (deadKeptToken) { forgetClientLinkToken(); setClientToken(undefined); } }, [deadKeptToken]);
  const hasSession = Boolean(state.data?.session);
  const teamSession = Boolean(state.data?.session?.teamPreview);
  const shared = state.data?.clientLink?.state === "live" ? state.data.clientLink : null;
  const agentPage = !shared && state.data && "agentPage" in state.data ? state.data.agentPage ?? null : null;
  // A buyer with a live list is asked before a new agent's link is connected; their own link, or one made for another number, goes straight to their list.
  const askToConnect = hasSession && !teamSession && Boolean(linkToken && shared) && state.data?.connectOffer === "ask";
  // A lapsed reel buyer back from a bookmark sees "comment again or reach out"; a fresh DM link (?src=) still opens the gate.
  const lapsedReelBuyer = Boolean(state.data?.lapsed) && !linkToken && !new URLSearchParams(window.location.search).has("src");
  useEffect(() => {
    if (!hasSession || askToConnect) return;
    window.location.assign(teamSession ? "/deals/team" : "/deals/mine");
  }, [hasSession, teamSession, askToConnect]);
  const pendingKey = state.data?.pending?.expiresAt ?? null;
  useEffect(() => { if (pendingKey) setGateOpen(true); }, [pendingKey]);
  // A buyer whose list lapsed is told how to get back in.
  useEffect(() => { if (state.data?.lapsed) setGateOpen(true); }, [state.data?.lapsed]);
  // A buyer an admin turned off is shown "your access is paused" right away.
  const paused = Boolean(state.data && "paused" in state.data && state.data.paused);
  useEffect(() => { if (paused) setGateOpen(true); }, [paused]);
  const eyebrow = shared ? `Shared by ${shared.agentName}` : agentPage ? `${agentPage.agentName}'s new home search` : null;
  const intro = shared ? `${shared.agentName} shared this list with you. Verify your number once to open every address, photo and incentive.` : agentPage ? `Hand-picked by ${agentPage.agentName} at Lifestyle Design Realty.` : undefined;
  // Oct 30, 2026 (design F): the page itself is presentational (PublicDealsPage); this keeps the session, links and gate.
  return <>
    <PublicDealsPage loading={catalog.isLoading} communities={catalog.data ?? []} useHomes={useLandingHomes} featured={featured.data as FeaturedDealsData | undefined} comingSoon={comingSoon.data} eyebrow={eyebrow} intro={intro} openKey={sharedKey} onTour={() => setGateOpen(true)} />
    {askToConnect && shared && linkToken ? <ConnectSheet agentName={shared.agentName} token={linkToken} /> : gateOpen && !hasSession && !deadKeptToken && <GateSheet key={`${linkToken ?? "reel"}:${lapsedReelBuyer ? "lapsed" : "open"}`} state={state.data} clientToken={linkToken} lapsed={lapsedReelBuyer} teamSignIn={teamSignIn} onSiteLogin={() => startLogin({ returnTo: "/deals/team" })} onClose={() => setGateOpen(false)} />}
  </>;
}

/**
 * The list could not be loaded while the session may still be live. The visitor
 * stays here with a retry: the landing page would see the live session and bounce
 * them straight back to /deals/mine, a reload loop with nothing explained.
 */
export function MineRetry({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return <main data-deals-retry="true" className="deals-light flex min-h-screen flex-col bg-background"><header className="deals-chrome flex min-w-0 items-center justify-center border-b border-border/60 px-5 py-5"><Link href="/" className="font-serif text-sm tracking-[0.14em]">LIFESTYLE DESIGN <span className="text-gold">REALTY</span></Link></header><section className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-16 text-center"><div role="alert"><p className="eyebrow text-gold">Private buyer list</p><h1 className="mt-3 text-4xl leading-tight">{MINE_COPY.loadFailed}</h1><p className="mt-4 text-sm text-muted-foreground">{MINE_COPY.loadFailedHint}</p></div><Button type="button" onClick={onRetry} disabled={retrying} className="mt-8 w-full bg-gold py-6 text-primary-foreground"><RotateCcw className={`mr-2 h-4 w-4 ${retrying ? "animate-spin" : ""}`} />{retrying ? MINE_COPY.retrying : MINE_COPY.retry}</Button></section><DealsFooter /></main>;
}

/** The save heart: the list refetches so the saved set comes from the server record. */
function useSaveHome(refetch: () => void) {
  const [savingCard, setSavingCard] = useState<string | null>(null);
  const save = trpc.deals.saveHome.useMutation({
    onSuccess: (result) => { if (result.saved && result.notified) toast.success(MINE_COPY.homeSaved); refetch(); },
    onError: (error) => toast.error(error.message || MINE_COPY.saveFailed),
    onSettled: () => setSavingCard(null),
  });
  return { savingCard, onSave: (card: string, saved: boolean) => { setSavingCard(card); save.mutate({ card, saved }); } };
}

function Mine() {
  const mine = trpc.deals.mine.useQuery(undefined, { retry: false });
  const comingSoon = trpc.deals.comingSoon.useQuery();
  const update = trpc.deals.updateProfile.useMutation({ onSuccess: () => { toast.success(MINE_COPY.profileSaved); void mine.refetch(); } });
  const viewed = trpc.deals.viewedCommunity.useMutation();
  const [request, setRequest] = useState<HomeRequest | null>(null);
  const { savingCard, onSave } = useSaveHome(() => { void mine.refetch(); });
  const communities = useMemo(() => parseMineCommunities<GatedCommunity>(mine.data?.communitiesJson), [mine.data?.communitiesJson]);
  // The filters an agent's link carried (kept by the landing page through the code check), taken once.
  const [sharedFilters] = useState(() => takeSharedFilters());
  useInstagramEmbeds();
  if (mine.isLoading) return <ListSkeleton label="Preparing your private list…" />;
  // Only "no live session" falls back to the landing page and its gate; any other
  // failure keeps the visitor here with a retry and never navigates.
  if (mine.isError && isUnauthorizedDealsError(mine.error)) return <Landing />;
  if (mine.isError || !mine.data) return <MineRetry onRetry={() => { void mine.refetch(); }} retrying={mine.isFetching} />;
  return <>
    <GatedCatalog initialFilters={sharedFilters} lead={mine.data.lead} communities={communities} featured={mine.data.featured as FeaturedDealsData} saved={mine.data.saved} picks={mine.data.picks} savingCard={savingCard} onSave={onSave} agent={mine.data.agent} onRequest={setRequest} onViewCommunity={(key) => viewed.mutate({ key })} onSaveProfile={(input) => update.mutate(input)} savingProfile={update.isPending} profileSaved={update.isSuccess} profileError={profileErrorCopy(update.error)} onExpire={() => { void mine.refetch(); }} comingSoon={comingSoon.data} />
    <HomeRequestSheet key={request ? `${request.requestType}:${request.card}` : "closed"} request={request} onClose={() => setRequest(null)} />
  </>;
}

const PICKS_STORAGE = "deals-picks";
const PICKS_MAX = 30;
/** The agent's picks survive a reload (and the hop from the list to the tools) in this tab only. */
function readPicks(): string[] {
  try { const raw = window.sessionStorage.getItem(PICKS_STORAGE); const parsed: unknown = raw ? JSON.parse(raw) : []; return Array.isArray(parsed) ? parsed.filter((card): card is string => typeof card === "string" && /^[a-f0-9]{20}$/.test(card)).slice(0, PICKS_MAX) : []; }
  catch { return []; }
}
function writePicks(picks: readonly string[]) { try { window.sessionStorage.setItem(PICKS_STORAGE, JSON.stringify(picks)); } catch { /* private mode: the picks live in memory only */ } }

/** Oct 26, 2026: the agent's pick tray; it sits above the list while anything is picked. */
function PickTray({ count, onSend, onClear, onCopy }: { count: number; onSend: () => void; onClear: () => void; onCopy: () => void }) {
  if (count === 0) return null;
  // Dark like the site header (explicit colors: the tray sits outside the light Deals theme scope).
  return <div role="status" data-deals-pick-tray="true" className="fixed bottom-5 left-5 right-5 z-30 flex items-center justify-between gap-3 border border-gold/50 bg-[oklch(0.2_0.02_260)] px-4 py-3 text-white shadow-xl sm:left-auto sm:right-8 sm:w-[26rem]">
    <p className="min-w-0 text-sm"><ListChecks className="mr-2 inline h-4 w-4 text-gold" /><span className="font-medium">{count} home{count === 1 ? "" : "s"} picked</span></p>
    <div className="flex shrink-0 items-center gap-2">
      <button type="button" onClick={onClear} className="min-h-11 px-2 text-xs uppercase tracking-widest text-white/70 hover:text-gold">Clear</button>
      <button type="button" onClick={onCopy} data-deals-copy-picks="true" aria-label="Copy the picked homes as text" className="min-h-11 px-2 text-xs uppercase tracking-widest text-white/70 hover:text-gold">Copy list</button>
      <button type="button" onClick={onSend} className="min-h-11 bg-gold px-4 text-xs font-medium uppercase tracking-[0.14em] text-primary-foreground">Send to a client</button>
    </div>
  </div>;
}

/** /deals/team: the full list plus the agent tools, for a live team session. */
function Team() {
  const mine = trpc.deals.mine.useQuery(undefined, { retry: false });
  const workspace = trpc.deals.team.workspace.useQuery(undefined, { retry: false });
  const comingSoon = trpc.deals.comingSoon.useQuery();
  const [picked, setPicked] = useState<string[]>(() => readPicks());
  // Oct 28, 2026 (New Home Buddy's bulk send): the filters on the list and their home count, for a link with no picks.
  const [listShare, setListShare] = useState<{ filters: BrowseFilters; count: number } | null>(null);
  useEffect(() => { writePicks(picked); }, [picked]);
  const communities = useMemo(() => parseMineCommunities<GatedCommunity>(mine.data?.communitiesJson), [mine.data?.communitiesJson]);
  const pick: PickControl = useMemo(() => ({ picked: new Set(picked), onToggle: (card) => setPicked((current) => current.includes(card) ? current.filter((entry) => entry !== card) : current.length >= PICKS_MAX ? (toast.error(`Up to ${PICKS_MAX} picks per client.`), current) : [...current, card]), sendOne: (card) => sendOneRef.current(card) }), [picked]);
  const clearPicks = () => setPicked([]);
  // "Send this home to a client" (the opened home's sheet): it joins the picks, the sheet closes, and the cursor waits in Client name.
  const sendOneRef = useRef<(card: string) => void>(() => undefined);
  sendOneRef.current = (card: string) => sendOne(card);
  const sendOne = (card: string) => {
    setPicked((current) => current.includes(card) ? current : current.length >= PICKS_MAX ? current : [...current, card]);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    window.setTimeout(sendPicksToClient, 60);
  };
  // "Send to a client" lands the agent in the form with the cursor in the client-name field (focus after the smooth scroll settles).
  const sendPicksToClient = () => {
    document.getElementById("deals-agent-tools")?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => document.getElementById("deals-client-name")?.focus({ preventScroll: true }), 450);
  };
  const setPicks = trpc.deals.team.setClientLinkPicks.useMutation({ onSuccess: () => { clearPicks(); void workspace.refetch(); } });
  // A new link made with picks takes them with it; the tray empties so the next client starts fresh.
  const create = trpc.deals.team.createClientLink.useMutation({ onSuccess: (result) => { if (result.pickCount) clearPicks(); void workspace.refetch(); } });
  const text = trpc.deals.team.textClientLink.useMutation({ onSuccess: () => { void workspace.refetch(); } });
  const revoke = trpc.deals.team.revokeClientLink.useMutation({ onSuccess: () => { toast.success("Link turned off. That client now sees the standard list."); void workspace.refetch(); }, onError: (error) => toast.error(error.message || "Could not turn that link off.") });
  const restore = trpc.deals.team.restoreClientLink.useMutation({ onSuccess: () => { toast.success("Link turned back on. Same link, same picks."); void workspace.refetch(); }, onError: (error) => toast.error(error.message || "Could not turn that link back on.") });
  const remove = trpc.deals.team.removeClientLink.useMutation({ onSuccess: () => { toast.success("Removed from your list."); void workspace.refetch(); }, onError: (error) => toast.error(error.message || "Could not remove that link.") });
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  useInstagramEmbeds();
  const forbidden = workspace.isError && workspace.error.data?.code === "FORBIDDEN";
  useEffect(() => { if (forbidden && !mine.data?.lead.teamPreview && mine.data) window.location.assign("/deals/mine"); }, [forbidden, mine.data]);
  if (mine.isLoading) return <ListSkeleton label="Preparing the team list…" />;
  if (mine.isError && isUnauthorizedDealsError(mine.error)) return <Landing />;
  if (mine.isError || !mine.data) return <MineRetry onRetry={() => { void mine.refetch(); }} retrying={mine.isFetching} />;
  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); setCopiedUrl(url); toast.success("Link copied."); }
    catch { window.prompt("Copy this link:", url); }
  };
  // Oct 27, 2026: the picked homes as text, for a CRM note or an e-mail written by hand.
  const copyPicks = async () => {
    const text = picksAsText(pickedHomes(communities, picked));
    try { await navigator.clipboard.writeText(text); toast.success(`${picked.length} home${picked.length === 1 ? "" : "s"} copied as text.`); }
    catch { window.prompt("Copy this list:", text); }
  };
  const tools = <AgentTools workspace={workspace.data as AgentWorkspaceData | undefined} loading={workspace.isLoading} error={workspace.isError ? workspace.error.message : null}
    created={create.data ?? null} creating={create.isPending} createError={create.isError ? create.error.message : null}
    onCreate={(input) => create.mutate(input)} onRevoke={(id) => revoke.mutate({ id })} onRestore={(id) => restore.mutate({ id })} onRemove={(id) => remove.mutate({ id })} onCopy={(url) => { void copy(url); }} copiedUrl={copiedUrl}
    onText={(input) => text.mutateAsync(input)} texting={text.isPending}
    picked={picked} onClearPicks={clearPicks} onSetPicks={(input) => setPicks.mutateAsync(input)} settingPicks={setPicks.isPending} defaultClientsOpen={false} listShare={listShare} />;
  // Agents send the list; their own view has no Save hearts (a heart there would belong to no client). Pick buttons stand in.
  return <>
    <GatedCatalog lead={mine.data.lead} communities={communities} featured={mine.data.featured as FeaturedDealsData} tools={tools} onExpire={() => { void mine.refetch(); }} comingSoon={comingSoon.data} pick={pick} onListChange={setListShare} />
    <PickTray count={picked.length} onClear={clearPicks} onSend={sendPicksToClient} onCopy={() => { void copyPicks(); }} />
  </>;
}

export default function Deals() {
  const [location] = useLocation();
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    meta.dataset.dealsRobots = "true";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
  if (location.startsWith("/deals/team")) return <Team />;
  return location.startsWith("/deals/mine") ? <Mine /> : <Landing />;
}
