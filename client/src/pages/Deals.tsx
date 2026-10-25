import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { LockKeyhole, RotateCcw, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { MINE_COPY, isUnauthorizedDealsError, profileErrorCopy } from "@/lib/dealsMine";
import { TRANSIENT_GATE_PARAMS, clientLinkTokenInUrl, forgetClientLinkToken, keepClientLinkToken, rememberClientLinkToken } from "@/lib/dealsGate";
import { GateSheet } from "@/components/deals/GateSheet";
import { GatedCatalog, type GatedCommunity, type HomeRequest } from "@/components/deals/GatedCatalog";
import { FeaturedStrip, type FeaturedDealsData } from "@/components/deals/FeaturedDeals";
import { AgentTools, type AgentWorkspaceData } from "@/components/deals/AgentTools";
import { ComingSoonSection } from "@/components/deals/ComingSoon";
import { DealsFooter, formatChicagoDate, useInstagramEmbeds } from "@/components/deals/shared";
import { BrowseBar, BROWSE_COPY } from "@/components/deals/BrowseBar";
import { LandingBrowse, type PublicHome, type UseCommunityHomes } from "@/components/deals/LandingBrowse";
import { BROWSE_PAGE, EMPTY_FILTERS, landingMatches, type BrowseFilters } from "@/lib/dealsBrowse";

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
  const state = trpc.deals.state.useQuery(clientToken ? { c: clientToken } : undefined);
  // An agent kept off Builder Deals (their own answer or the screening) is sent to the agent recruiting page.
  const realtorRedirect = state.data && "realtorRedirect" in state.data ? state.data.realtorRedirect : null;
  useEffect(() => { if (realtorRedirect && realtorRedirect.startsWith("/")) window.location.replace(realtorRedirect); }, [realtorRedirect]);
  // The reel that brought the visitor (?src=) puts its community first.
  const [src] = useState(() => new URLSearchParams(window.location.search).get("src")?.trim().slice(0, 40) || undefined);
  const catalog = trpc.deals.publicCatalog.useQuery(src ? { src } : undefined);
  const [filters, setFilters] = useState<BrowseFilters>(EMPTY_FILTERS);
  const all = catalog.data ?? [];
  const matching = useMemo(() => all.filter((community) => landingMatches(community, filters)), [all, filters]);
  const changeFilters = (next: BrowseFilters) => setFilters(next);
  const featured = trpc.deals.featured.useQuery();
  const comingSoon = trpc.deals.comingSoon.useQuery();
  // October 24, 2026: visitors browse every home first; the sign-up opens when they ask for addresses, or when a
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
  const updatedAt = catalog.data?.map((community) => community.updatedAt).filter((value): value is string => Boolean(value)).sort().at(-1);
  return <main className="deals-light min-h-screen max-w-full overflow-x-clip bg-background"><header className="deals-chrome flex min-w-0 items-center justify-center border-b border-border/60 px-5 py-5"><Link href="/" className="font-serif text-sm tracking-[0.14em]">LIFESTYLE DESIGN <span className="text-gold">REALTY</span></Link></header><section className="ambient-section px-4 pb-28 pt-6 sm:px-6"><div className="mx-auto max-w-[1600px]"><p className="eyebrow text-gold">{shared ? `Shared by ${shared.agentName}` : "New construction deals"}</p><h1 className="mt-2 max-w-3xl text-3xl leading-tight sm:text-4xl">{sourceLabel}</h1><p className="mt-2 text-sm text-muted-foreground">{shared ? `${shared.agentName} shared this list with you. Verify your number once to open every address, photo and incentive.` : "Hand-picked by Property Pete."}{updatedAt ? ` Updated ${formatChicagoDate(updatedAt)}.` : ""}</p>{all.length > BROWSE_PAGE / 2 && <BrowseBar filters={filters} onChange={changeFilters} areas={all} shown={matching.length} total={all.length} unit="communities" />}{all.length > 0 && matching.length === 0 && <p role="status" className="mt-8 text-sm text-muted-foreground">{BROWSE_COPY.none}</p>}<LandingBrowse communities={matching} filters={filters} useHomes={useLandingHomes} onUnlock={() => setGateOpen(true)} top={<FeaturedStrip featured={featured.data as FeaturedDealsData | undefined} onSelect={() => setGateOpen(true)} />} /><ComingSoonSection items={comingSoon.data} action={{ kind: "unlock", onClick: () => setGateOpen(true) }} /></div></section><button type="button" onClick={() => setGateOpen(true)} className="fixed bottom-5 left-5 right-5 z-30 min-h-14 bg-gold px-5 text-sm font-medium uppercase tracking-[0.14em] text-primary-foreground shadow-xl sm:left-auto sm:right-8 sm:w-72">Schedule a tour <LockKeyhole className="ml-2 inline h-4 w-4" /></button><DealsFooter />{askToConnect && shared && linkToken ? <ConnectSheet agentName={shared.agentName} token={linkToken} /> : gateOpen && !hasSession && !deadKeptToken && <GateSheet key={`${linkToken ?? "reel"}:${lapsedReelBuyer ? "lapsed" : "open"}`} state={state.data} clientToken={linkToken} lapsed={lapsedReelBuyer} onClose={() => setGateOpen(false)} />}</main>;
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
  useInstagramEmbeds();
  if (mine.isLoading) return <div className="deals-light min-h-screen bg-background p-8 text-center text-muted-foreground">Preparing your private list…</div>;
  // Only "no live session" falls back to the landing page and its gate; any other
  // failure keeps the visitor here with a retry and never navigates.
  if (mine.isError && isUnauthorizedDealsError(mine.error)) return <Landing />;
  if (mine.isError || !mine.data) return <MineRetry onRetry={() => { void mine.refetch(); }} retrying={mine.isFetching} />;
  return <>
    <GatedCatalog lead={mine.data.lead} communities={mine.data.communities as GatedCommunity[]} featured={mine.data.featured as FeaturedDealsData} saved={mine.data.saved} savingCard={savingCard} onSave={onSave} agent={mine.data.agent} onRequest={setRequest} onViewCommunity={(key) => viewed.mutate({ key })} onSaveProfile={(input) => update.mutate(input)} savingProfile={update.isPending} profileSaved={update.isSuccess} profileError={profileErrorCopy(update.error)} onExpire={() => { void mine.refetch(); }} comingSoon={comingSoon.data} />
    <HomeRequestSheet key={request ? `${request.requestType}:${request.card}` : "closed"} request={request} onClose={() => setRequest(null)} />
  </>;
}

/** /deals/team: the full list plus the agent tools, for a live team session. */
function Team() {
  const mine = trpc.deals.mine.useQuery(undefined, { retry: false });
  const workspace = trpc.deals.team.workspace.useQuery(undefined, { retry: false });
  const comingSoon = trpc.deals.comingSoon.useQuery();
  const create = trpc.deals.team.createClientLink.useMutation({ onSuccess: () => { void workspace.refetch(); } });
  const revoke = trpc.deals.team.revokeClientLink.useMutation({ onSuccess: () => { toast.success("Link turned off. That client now sees the standard list."); void workspace.refetch(); }, onError: (error) => toast.error(error.message || "Could not turn that link off.") });
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  useInstagramEmbeds();
  const forbidden = workspace.isError && workspace.error.data?.code === "FORBIDDEN";
  useEffect(() => { if (forbidden && !mine.data?.lead.teamPreview && mine.data) window.location.assign("/deals/mine"); }, [forbidden, mine.data]);
  if (mine.isLoading) return <div className="deals-light min-h-screen bg-background p-8 text-center text-muted-foreground">Preparing the team list…</div>;
  if (mine.isError && isUnauthorizedDealsError(mine.error)) return <Landing />;
  if (mine.isError || !mine.data) return <MineRetry onRetry={() => { void mine.refetch(); }} retrying={mine.isFetching} />;
  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); setCopiedUrl(url); toast.success("Link copied."); }
    catch { window.prompt("Copy this link:", url); }
  };
  const tools = <AgentTools workspace={workspace.data as AgentWorkspaceData | undefined} loading={workspace.isLoading} error={workspace.isError ? workspace.error.message : null}
    created={create.data ?? null} creating={create.isPending} createError={create.isError ? create.error.message : null}
    onCreate={(input) => create.mutate(input)} onRevoke={(id) => revoke.mutate({ id })} onCopy={(url) => { void copy(url); }} copiedUrl={copiedUrl} />;
  // Agents send the list; their own view has no Save hearts (a heart there would belong to no client).
  return <GatedCatalog lead={mine.data.lead} communities={mine.data.communities as GatedCommunity[]} featured={mine.data.featured as FeaturedDealsData} tools={tools} onExpire={() => { void mine.refetch(); }} comingSoon={comingSoon.data} />;
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
