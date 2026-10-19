import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { LockKeyhole, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { GateSheet } from "@/components/deals/GateSheet";
import { GatedCatalog, type GatedCommunity, type HomeRequest } from "@/components/deals/GatedCatalog";
import { DealsFooter, Incentive, ReelCard, formatChicagoDate, money, useInstagramEmbeds } from "@/components/deals/shared";

const sourceLabel = "This week's best new-build deals in San Antonio.";

function HomeRequestSheet({ request, onClose }: { request: HomeRequest | null; onClose: () => void }) {
  const [preferred, setPreferred] = useState("");
  const submit = trpc.deals.requestHome.useMutation({ onSuccess: onClose });
  if (!request) return null;
  return <div className="fixed inset-0 z-[95] flex items-end bg-black/70 p-4 sm:items-center sm:justify-center"><section role="dialog" aria-modal="true" aria-labelledby="deals-request-title" className="w-full max-w-md border border-gold/40 bg-[#07070a] p-6 shadow-2xl"><button type="button" onClick={onClose} className="float-right text-muted-foreground hover:text-gold" aria-label="Close request form"><X className="h-4 w-4" /></button><p className="eyebrow text-gold">Personal assistance</p><h2 id="deals-request-title" className="mt-2 text-3xl">{request.requestType === "tour" ? "Tour this home with us" : "Ask about this one"}</h2><p className="mt-3 text-sm text-muted-foreground">Choose the day and time that works for you. We will confirm the details directly.</p><Label htmlFor="deals-preferred" className="mt-6 block text-xs uppercase tracking-widest">Preferred day and time</Label><Input id="deals-preferred" type="datetime-local" value={preferred} onChange={(event) => setPreferred(event.target.value)} className="mt-2" /><Button type="button" disabled={!preferred || submit.isPending} onClick={() => submit.mutate({ card: request.card, requestType: request.requestType, preferredAt: new Date(preferred).toISOString() })} className="mt-5 w-full bg-gold py-6 text-primary-foreground">{submit.isPending ? "Sending…" : "Send request"}</Button>{submit.isError && <p role="alert" className="mt-3 text-sm text-destructive">{submit.error.message}</p>}</section></div>;
}

function Landing() {
  const state = trpc.deals.state.useQuery();
  const catalog = trpc.deals.publicCatalog.useQuery();
  const [gateOpen, setGateOpen] = useState(true);
  useInstagramEmbeds();
  const hasSession = Boolean(state.data?.session);
  useEffect(() => { if (hasSession) window.location.assign("/deals/mine"); }, [hasSession]);
  const pendingKey = state.data?.pending?.expiresAt ?? null;
  useEffect(() => { if (pendingKey) setGateOpen(true); }, [pendingKey]);
  const updatedAt = catalog.data?.map((community) => community.updatedAt).filter((value): value is string => Boolean(value)).sort().at(-1);
  return <main className="min-h-screen max-w-full overflow-x-clip bg-background"><header className="flex min-w-0 items-center justify-center border-b border-border/60 px-5 py-5"><Link href="/" className="font-serif text-sm tracking-[0.14em]">LIFESTYLE DESIGN <span className="text-gold">REALTY</span></Link></header><section className="ambient-section px-5 pb-28 pt-14 sm:px-8"><div className="mx-auto max-w-6xl"><p className="eyebrow text-gold">Private buyer access</p><h1 className="mt-3 max-w-xl text-5xl leading-[0.9] sm:text-7xl">{sourceLabel}</h1><p className="mt-5 text-sm text-muted-foreground">Hand-picked by Property Pete. Updated {formatChicagoDate(updatedAt)}.</p><div className="mt-12 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-2">{(catalog.data ?? []).map((community) => <motion.article key={community.label} className="min-w-0 overflow-hidden border border-border bg-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}><ReelCard reelUrl={community.reelUrl} label={community.label} /><div className="p-5"><p className="eyebrow text-gold">{community.area}</p><h2 className="mt-2 text-3xl leading-tight">{community.label}</h2>{community.fromPrice && <p className="mt-4 text-xl text-gold">From {money.format(community.fromPrice)}</p>}<div className="mt-5"><Incentive incentive={community.incentive} compact /></div><p className="mt-4 text-sm text-muted-foreground">{community.homesAvailable > 0 ? `${community.homesAvailable} homes available now` : `To-be-built from ${community.fromPrice ? money.format(community.fromPrice) : "current pricing"}`}</p></div></motion.article>)}</div></div></section><button type="button" onClick={() => setGateOpen(true)} className="fixed bottom-5 left-5 right-5 z-30 min-h-14 bg-gold px-5 text-sm font-medium uppercase tracking-[0.14em] text-primary-foreground shadow-xl sm:left-auto sm:right-8 sm:w-72">Unlock the full list <LockKeyhole className="ml-2 inline h-4 w-4" /></button><DealsFooter />{gateOpen && <GateSheet state={state.data} onClose={() => setGateOpen(false)} />}</main>;
}

function Mine() {
  const mine = trpc.deals.mine.useQuery(undefined, { retry: false });
  const update = trpc.deals.updateProfile.useMutation({ onSuccess: () => mine.refetch() });
  const [request, setRequest] = useState<HomeRequest | null>(null);
  const [now, setNow] = useState(Date.now());
  useInstagramEmbeds();
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, []);
  if (mine.isLoading) return <div className="min-h-screen bg-background p-8 text-center text-muted-foreground">Preparing your private list…</div>;
  if (mine.isError || !mine.data) return <Landing />;
  return <>
    <GatedCatalog lead={mine.data.lead} communities={mine.data.communities as GatedCommunity[]} now={now} onRequest={setRequest} onSaveProfile={(input) => update.mutate(input)} savingProfile={update.isPending} />
    <HomeRequestSheet request={request} onClose={() => setRequest(null)} />
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
  return location.startsWith("/deals/mine") ? <Mine /> : <Landing />;
}
