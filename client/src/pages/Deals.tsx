import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, ChevronLeft, Clock3, Copy, LockKeyhole, Phone, Send, ShieldCheck, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const sourceLabel = "This week's best new-build deals in San Antonio.";

type GateStep = "gate" | "confirm-agent" | "code" | "blocked" | "expired";

function getParams() {
  const params = new URLSearchParams(window.location.search);
  return { src: params.get("src") ?? undefined, ig: params.get("ig") ?? undefined, expired: params.get("expired") === "1", codeError: params.get("codeError") === "1" };
}

function formatPhoneInput(value: string) {
  const hasPlus = value.trim().startsWith("+");
  const digits = value.replace(/\D/g, "").slice(0, hasPlus ? 15 : 10);
  if (hasPlus) return `+${digits}`;
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function ReelCard({ reelUrl, label }: { reelUrl: string | null; label: string }) {
  const [fallback, setFallback] = useState(!reelUrl);
  useEffect(() => {
    if (!reelUrl) return;
    const timer = window.setTimeout(() => setFallback(true), 5000);
    return () => window.clearTimeout(timer);
  }, [reelUrl]);
  if (fallback) {
    return (
      <a href={reelUrl ?? "#unlock"} target={reelUrl ? "_blank" : undefined} rel="noreferrer" className="flex aspect-[4/5] w-full flex-col items-center justify-center bg-[radial-gradient(ellipse_at_50%_0%,oklch(0.75_0.09_85_/_0.16),transparent_60%),linear-gradient(150deg,oklch(0.2_0.01_285),oklch(0.09_0.005_285))] px-6 text-center">
        <div className="mb-4 rounded-full border border-gold/40 p-4 text-gold"><Send className="h-5 w-5" /></div>
        <span className="eyebrow text-gold">{reelUrl ? "Watch on Instagram" : "Video coming soon"}</span>
        <span className="mt-3 max-w-[16rem] font-serif text-2xl leading-tight">{label}</span>
      </a>
    );
  }
  return (
    <div className="relative aspect-[4/5] overflow-hidden bg-secondary">
      <blockquote className="instagram-media h-full min-w-0 max-w-none bg-transparent" data-instgrm-permalink={reelUrl ?? undefined} data-instgrm-version="14" aria-label={`Instagram reel for ${label}`} />
    </div>
  );
}

function Incentive({ incentive, compact = false }: { incentive: any; compact?: boolean }) {
  if (!incentive) return null;
  return (
    <div className="border-l-2 border-gold bg-gold/5 p-4">
      <p className="text-sm leading-relaxed text-foreground">{compact ? (incentive.teaser ?? incentive.text) : incentive.text}</p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div><p className="text-lg font-medium text-gold">{incentive.headlineRate}</p><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{incentive.followOnPeriod ? "First year" : "Rate"}</p></div>
        {incentive.followOnRate && <div><p className="text-lg font-medium text-gold">{incentive.followOnRate}</p><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{incentive.followOnPeriod}</p></div>}
        <div><p className="text-lg font-medium text-gold">{incentive.apr}</p><p className="text-[10px] uppercase tracking-wider text-muted-foreground">APR</p></div>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{[incentive.loanType, incentive.downPayment, incentive.repaymentTerms, !compact && incentive.contractBy && `Contract by ${new Date(incentive.contractBy).toLocaleDateString()}`, !compact && incentive.closeBy && `Close by ${new Date(incentive.closeBy).toLocaleDateString()}`].filter(Boolean).join(" · ")} · On select homes with qualifying financing through the builder's lender. Not a commitment to lend.</p>
    </div>
  );
}

function DealsFooter() {
  return <footer className="border-t border-border/60 px-5 py-10 text-center text-[11px] leading-relaxed text-muted-foreground"><p>Prices, incentives, and availability change often and are set by the builder. Rates shown are on select homes with qualifying financing through the builder's lender. Not a commitment to lend. Verify all details with us before making decisions.</p><div className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2"><a href="https://drive.google.com/file/d/1DTDRFjzJJS_iD8aaNu8l4Wr3YmmR9zHe/view" target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-gold">IABS</a><a href="https://www.trec.texas.gov/forms/consumer-protection-notice" target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-gold">Consumer Protection Notice</a><Link href="/privacy" className="underline underline-offset-4 hover:text-gold">Privacy Policy</Link></div><p className="mt-5 uppercase tracking-[0.16em] text-foreground/80">Lifestyle Design Realty · Equal Housing Opportunity</p></footer>;
}

function BuyerTextLine({ state }: { state: any }) {
  const keyword = state?.commentKeyword || "HOME";
  const line = state?.textLine;
  if (!line) return null;
  const digits = String(line).replace(/\D/g, "");
  return <a href={`sms:${digits}?&body=${encodeURIComponent(keyword)}`} className="text-gold underline underline-offset-4">Text {keyword} to {line}</a>;
}

function GateSheet({ state, onClose }: { state: any; onClose: () => void }) {
  const params = useMemo(getParams, []);
  const [step, setStep] = useState<GateStep>(params.expired ? "expired" : state?.pending ? "code" : "gate");
  const [phone, setPhone] = useState("");
  const [choice, setChoice] = useState<"buyer" | "has_agent" | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const start = trpc.deals.start.useMutation({ onSuccess: (result) => { if (result.ok) { setStep("code"); setMessage(""); } else { setMessage(result.message); setStep(result.kind === "blocked" ? "blocked" : "gate"); } }, onError: () => setMessage("We couldn't start verification. Please try again.") });
  const resend = trpc.deals.resend.useMutation({ onSuccess: (result) => setMessage(result.ok ? "A fresh code is on its way." : result.message) });
  const change = trpc.deals.changeNumber.useMutation({ onSuccess: () => { setStep("gate"); setCode(""); setMessage(""); } });
  const continueGate = () => { if (choice === "has_agent") { setStep("confirm-agent"); return; } if (choice) start.mutate({ phone, choice, src: params.src, ig: params.ig }); };
  return <AnimatePresence><motion.div className="fixed inset-0 z-[90] flex items-end bg-black/65 sm:items-center sm:justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.section id="unlock" role="dialog" aria-modal="true" aria-labelledby="deals-gate-title" className="relative w-full min-h-[650px] max-h-[92dvh] overflow-y-auto border-t border-gold/40 bg-[#07070a] px-5 pb-7 pt-6 shadow-2xl sm:max-w-lg sm:border sm:px-8" initial={{ y: 36 }} animate={{ y: 0 }} exit={{ y: 36 }} transition={{ duration: 0.22 }}>
    <button type="button" aria-label="Close gate" onClick={onClose} className="absolute right-3 top-3 p-2 text-muted-foreground hover:text-gold"><X className="h-4 w-4" /></button>
    {step === "expired" && <><p className="eyebrow text-gold">Builder Deals</p><h2 id="deals-gate-title" className="mt-2 text-4xl">This link expired.</h2><p className="mt-3 text-sm text-muted-foreground">Get a fresh personal link for the latest available homes. Need help? <BuyerTextLine state={state} /></p><Button onClick={() => setStep("gate")} className="mt-6 w-full bg-gold py-6 text-primary-foreground">Get a new link now <ArrowRight className="ml-2 h-4 w-4" /></Button></>}
    {step === "blocked" && <><p className="eyebrow text-gold">Builder Deals</p><h2 id="deals-gate-title" className="mt-2 text-3xl leading-tight">This page is for buyers who are not working with an agent yet.</h2><p className="mt-4 text-sm leading-relaxed text-muted-foreground">{message} Made a mistake? <BuyerTextLine state={state} /></p></>}
    {step === "confirm-agent" && <><p className="eyebrow text-gold">One quick confirmation</p><h2 id="deals-gate-title" className="mt-2 text-3xl leading-tight">Just to confirm: you are a licensed agent, or already working with one?</h2><div className="mt-6 grid gap-3"><Button onClick={() => start.mutate({ phone, choice: "has_agent", src: params.src, ig: params.ig })} className="bg-gold py-6 text-primary-foreground">Yes, that's right</Button><Button variant="outline" onClick={() => setStep("gate")} className="py-6">No, go back</Button></div></>}
    {step === "code" && <><p className="eyebrow text-gold">One more step</p><h2 id="deals-gate-title" className="mt-2 text-3xl">Check your messages.</h2><p className="mt-3 text-sm text-muted-foreground">We sent a code to {state?.pending?.displayPhone ?? phone}. Enter it below to unlock your personal list.</p><form action="/deals/verify" method="post"><Label htmlFor="deals-code" className="mt-6 block text-xs uppercase tracking-widest">6-digit code</Label><Input id="deals-code" name="code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]*" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} className="mt-2 h-14 text-center text-2xl tracking-[0.45em]" /><Button type="submit" disabled={code.length !== 6} className="mt-4 w-full bg-gold py-6 text-primary-foreground">Unlock my list</Button></form><div className="mt-4 flex items-center justify-between text-xs"><button onClick={() => resend.mutate({ channel: "sms" })} className="text-gold underline underline-offset-4">Didn't get it? Resend</button><button onClick={() => resend.mutate({ channel: "call" })} className="text-gold underline underline-offset-4">Call me with the code instead</button></div><button onClick={() => change.mutate()} className="mt-5 text-xs text-muted-foreground underline underline-offset-4">Wrong number? Change it</button>{(message || params.codeError) && <p role="alert" className="mt-4 text-sm text-destructive">{message || "That code didn't match. Please try again."}</p>}</>}
    {step === "gate" && <><p className="eyebrow text-gold">Private buyer access</p><h2 id="deals-gate-title" className="mt-2 text-4xl leading-none">Unlock the full list.</h2><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Phone verification protects these hand-picked deals for buyers who have not chosen an agent.</p>{state?.googleEnabled && <Button variant="outline" onClick={() => window.location.assign("/deals/auth/google")} className="mt-5 w-full py-6">Continue with Google</Button>}<Label htmlFor="deals-phone" className="mt-6 block text-xs uppercase tracking-widest">Mobile phone</Label><Input id="deals-phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="(210) 555-0123" value={phone} onChange={(e) => setPhone(formatPhoneInput(e.target.value))} onFocus={() => undefined} className="mt-2 h-14 text-lg" /><p className="mt-5 text-xs uppercase tracking-widest text-muted-foreground">Are you a realtor, or working with one?</p><div className="mt-3 grid grid-cols-2 gap-3"><button type="button" onClick={() => setChoice("buyer")} className={`min-h-14 border px-3 text-sm transition-colors ${choice === "buyer" ? "border-gold bg-gold/10 text-gold" : "border-border text-foreground"}`}>No, just me</button><button type="button" onClick={() => setChoice("has_agent")} className={`min-h-14 border px-3 text-sm transition-colors ${choice === "has_agent" ? "border-gold bg-gold/10 text-gold" : "border-border text-foreground"}`}>Yes</button></div><Button disabled={!choice || !phone || start.isPending} onClick={continueGate} className="mt-5 w-full bg-gold py-6 text-primary-foreground">{start.isPending ? "Sending…" : "Continue"} <ArrowRight className="ml-2 h-4 w-4" /></Button>{message && <p role="alert" className="mt-4 text-sm text-destructive">{message}</p>}<p className="mt-5 text-xs leading-relaxed text-foreground">{state?.consentText}</p></>}
  </motion.section></motion.div></AnimatePresence>;
}

function Landing() {
  const params = useMemo(getParams, []);
  const state = trpc.deals.state.useQuery();
  const catalog = trpc.deals.publicCatalog.useQuery();
  const [gateOpen, setGateOpen] = useState(true);
  useEffect(() => { if (state.data?.session) window.location.assign("/deals/mine"); }, [state.data?.session]);
  useEffect(() => { if (state.data?.pending) setGateOpen(true); }, [state.data?.pending]);
  return <main className="min-h-screen bg-background"><header className="flex items-center justify-center border-b border-border/60 px-5 py-5"><Link href="/" className="font-serif text-sm tracking-[0.14em]">LIFESTYLE DESIGN <span className="text-gold">REALTY</span></Link></header><section className="ambient-section px-5 pb-28 pt-14 sm:px-8"><div className="mx-auto max-w-6xl"><p className="eyebrow text-gold">Private buyer access</p><h1 className="mt-3 max-w-xl text-5xl leading-[0.9] sm:text-7xl">{sourceLabel}</h1><p className="mt-5 text-sm text-muted-foreground">Hand-picked by Property Pete. Updated {new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric" }).format(new Date())}.</p><div className="mt-12 grid gap-6 md:grid-cols-2">{(catalog.data ?? []).map((community: any) => <motion.article key={community.label} className="overflow-hidden border border-border bg-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}><ReelCard reelUrl={community.reelUrl} label={community.label} /><div className="p-5"><p className="eyebrow text-gold">{community.area}</p><h2 className="mt-2 text-3xl leading-tight">{community.label}</h2>{community.fromPrice && <p className="mt-4 text-xl text-gold">From {money.format(community.fromPrice)}</p>}<div className="mt-5"><Incentive incentive={community.incentive} compact /></div><p className="mt-4 text-sm text-muted-foreground">{community.homesAvailable > 0 ? `${community.homesAvailable} homes available now` : `To-be-built from ${community.fromPrice ? money.format(community.fromPrice) : "current pricing"}`}</p></div></motion.article>)}</div></div></section><button onClick={() => setGateOpen(true)} className="fixed bottom-5 left-5 right-5 z-30 min-h-14 bg-gold px-5 text-sm font-medium uppercase tracking-[0.14em] text-primary-foreground shadow-xl sm:left-auto sm:right-8 sm:w-72">Unlock the full list <LockKeyhole className="ml-2 inline h-4 w-4" /></button><DealsFooter />{gateOpen && <GateSheet state={state.data} onClose={() => setGateOpen(false)} />}</main>;
}

function Mine() {
  const mine = trpc.deals.mine.useQuery(undefined, { retry: false });
  const update = trpc.deals.updateProfile.useMutation({ onSuccess: () => mine.refetch() });
  const [showPrompt, setShowPrompt] = useState(true);
  const [name, setName] = useState("");
  const [timeline, setTimeline] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, []);
  if (mine.isLoading) return <div className="min-h-screen bg-background p-8 text-center text-muted-foreground">Preparing your private list…</div>;
  if (mine.isError || !mine.data) return <Landing />;
  const seconds = Math.max(0, Math.floor((new Date(mine.data.lead.expiresAt).getTime() - now) / 1000));
  const timer = `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return <main className="min-h-screen bg-background"><header className="flex items-center justify-between border-b border-border/60 px-5 py-5"><Link href="/" className="font-serif text-sm tracking-[0.14em]">LIFESTYLE DESIGN <span className="text-gold">REALTY</span></Link><span className="text-xs text-gold"><Clock3 className="mr-1 inline h-3.5 w-3.5" /> {timer}</span></header><section className="px-5 py-10 sm:px-8"><div className="mx-auto max-w-5xl"><p className="eyebrow text-gold">Private buyer list</p><h1 className="mt-2 text-4xl sm:text-5xl">Prepared for {mine.data.lead.display}</h1><p className="mt-3 text-sm text-muted-foreground">Updated today. Your access expires in {timer}.</p>{showPrompt && !mine.data.lead.name && <section className="mt-8 border border-gold/30 bg-gold/5 p-5"><button onClick={() => setShowPrompt(false)} className="float-right text-muted-foreground hover:text-gold" aria-label="Dismiss name prompt"><X className="h-4 w-4" /></button><h2 className="text-2xl">Add your name so we know who to text.</h2><div className="mt-4 grid gap-3 sm:grid-cols-3"><Input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} /><select value={timeline} onChange={(e) => setTimeline(e.target.value)} className="h-10 border border-input bg-transparent px-3 text-sm"><option value="">When are you looking?</option><option>0-3 months</option><option>3-6 months</option><option>6-12 months</option><option>12+ months</option></select><Button onClick={() => update.mutate({ name: name || undefined, timeline: timeline as any || undefined })} className="bg-gold text-primary-foreground">Save</Button></div></section>}<div className="mt-10 space-y-12">{mine.data.communities.map((community: any) => <section key={community.label} className="border-t border-border pt-8"><p className="eyebrow text-gold">{community.area}{community.schoolDistrict ? ` · ${community.schoolDistrict}` : ""}</p><h2 className="mt-2 text-4xl">{community.label}</h2>{community.lotSizes && <p className="mt-2 text-sm text-muted-foreground">{community.lotSizes}</p>}<div className="mt-5"><ReelCard reelUrl={community.reelUrl} label={community.label} /></div><div className="mt-5"><Incentive incentive={community.incentive} /></div>{community.amenities?.length > 0 && <div className="mt-5 flex flex-wrap gap-2">{community.amenities.map((item: string) => <span key={item} className="border border-border px-3 py-1.5 text-xs text-muted-foreground">{item}</span>)}</div>}<div className="mt-7 grid gap-5 sm:grid-cols-2">{community.homes.map((home: any) => <article key={home.card} className="border border-border bg-card p-5"><div className="flex items-start justify-between gap-4"><p className="eyebrow text-gold">{home.kind === "to_be_built" ? "To Be Built" : "Available now"}</p>{home.previousPrice && home.price < home.previousPrice && <span className="bg-gold px-2 py-1 text-[10px] uppercase tracking-widest text-primary-foreground">Price drop</span>}</div><h3 className="mt-3 text-3xl">{home.price ? money.format(home.price) : "Ask for current pricing"}</h3>{home.previousPrice && home.price < home.previousPrice && <p className="mt-1 text-sm text-muted-foreground line-through">{money.format(home.previousPrice)}</p>}<p className="mt-4 text-sm text-muted-foreground">{[home.beds && `${home.beds} beds`, home.baths && `${home.baths} baths`, home.sqft && `${home.sqft.toLocaleString()} sq ft`].filter(Boolean).join(" · ")}</p>{home.moveInDate && <p className="mt-2 text-sm text-muted-foreground">Est. move-in: {home.moveInDate}</p>}{home.lotSize && <p className="mt-1 text-sm text-muted-foreground">Lot: {home.lotSize}</p>}<Button className="mt-6 w-full bg-gold text-primary-foreground">{home.kind === "to_be_built" ? "Ask about this one" : "Tour this home with us"}</Button></article>)}</div></section>)}</div></div></section><DealsFooter /></main>;
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
