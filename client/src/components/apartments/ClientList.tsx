import { useMemo, useState } from "react";
import { Link } from "wouter";
import { MapPin, Phone } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { bedsLabel, mapsHref, rentRange, shortDay, smsHref } from "@/lib/apartments";
import { AptBadges } from "./AptFilterBar";
import { AptGallery } from "./AptGallery";
import { AptMap } from "./AptMap";

/**
 * What a client's link opens (/apartments/list/<token>): the communities their locator picked, with names, how to
 * reach them, and on top the one thing they must do so the locator is credited. No sign-up: the locator already has
 * their number (the Builder Deals client-link rule, Nov 1, 2026). Addresses open Google Maps (Nov 5, 2026).
 */
export function ClientList({ token }: { token: string }) {
  const list = trpc.apartments.list.useQuery({ token }, { enabled: /^[a-f0-9]{48}$/.test(token), retry: false });
  const [active, setActive] = useState<string | null>(null);
  const options = list.data?.options ?? [];
  const points = useMemo(() => options.flatMap((option, index) => option.lat != null && option.lng != null ? [{ id: String(index), lat: option.lat, lng: option.lng, label: `${index + 1}. ${option.name}` }] : []), [options]);
  const header = <header className="deals-chrome flex min-w-0 items-center justify-center border-b border-border/60 bg-background px-5 py-4 text-foreground"><Link href="/apartments" className="font-serif text-sm tracking-[0.14em]">LIFESTYLE DESIGN <span className="text-gold">REALTY</span></Link></header>;
  if (list.isLoading) return <main className="deals-light min-h-screen bg-background">{header}<p className="px-5 py-16 text-center text-sm text-muted-foreground">Opening your list...</p></main>;
  if (!list.data) return <main className="deals-light min-h-screen bg-background" data-apt-client-list="missing">{header}<section className="mx-auto max-w-md px-5 py-16 text-center"><h1 className="font-serif text-3xl">This link did not open a list.</h1><p className="mt-3 text-sm text-muted-foreground">Ask your locator to send it again, or start a new search.</p><Link href="/apartments" className="mt-6 inline-flex min-h-11 items-center border border-gold px-5 text-sm text-gold">Search apartments</Link></section></main>;
  const { agent, clientFirstName, referralLine, note, brokerage } = list.data;
  const first = agent.name.split(" ")[0] ?? agent.name;
  const ask = (body: string) => agent.phone ? smsHref(body, agent.phone) : agent.email ? `mailto:${agent.email}?body=${encodeURIComponent(body)}` : null;
  return <main className="deals-light min-h-screen max-w-full overflow-x-clip bg-background" data-apt-client-list="open">
    {header}
    <section className="mx-auto w-full max-w-5xl px-5 py-8">
      <p className="eyebrow text-gold">Picked for you by {agent.name}</p>
      <h1 className="mt-2 font-serif text-3xl leading-tight sm:text-4xl">{clientFirstName ? `${clientFirstName}, here are your apartments` : "Here are your apartments"}</h1>
      {note && <p className="mt-3 max-w-2xl text-base">{note}</p>}
      <p className="mt-3 text-sm text-muted-foreground">Tap "I want to tour this one" on any you like and {first} sets it up. It costs you nothing.</p>
      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        {agent.phone && <a href={`tel:${agent.phone}`} className="inline-flex min-h-11 items-center gap-2 border border-gold px-4 text-gold"><Phone className="h-4 w-4" />Call {agent.name.split(" ")[0]}</a>}
        {agent.phone && <a href={`sms:${agent.phone}`} className="inline-flex min-h-11 items-center border border-gold px-4 text-gold">Text {agent.name.split(" ")[0]}</a>}
      </div>
      {options.length === 0 && <p className="mt-8 text-sm text-muted-foreground">These apartments are no longer available. {agent.name} can send you new ones.</p>}
      <ol className="mt-6 grid gap-6 md:grid-cols-2">
        {options.map((option, index) => <li key={index} data-apt-option={index} onMouseEnter={() => setActive(String(index))} className={`min-w-0 border bg-card ${active === String(index) ? "border-gold" : "border-border"}`}>
          <AptGallery photos={option.photos} label={option.name} strip />
          <div className="p-4">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">{index + 1} · {option.areaLabel}</p>
          <h2 className="mt-1 font-serif text-2xl leading-tight">{option.name}</h2>
          <a href={mapsHref(`${option.name}, ${option.address}`)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-start gap-1.5 text-sm text-gold underline underline-offset-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0" />{option.address}</a>
          <div className="mt-3"><AptBadges item={option} /></div>
          {option.special && <p className="mt-3 border-l-2 border-gold bg-gold/5 px-3 py-2 text-sm"><span className="font-semibold">Special: </span>{option.special}</p>}
          <ul className="mt-3 space-y-1 text-sm">{option.plans.map((plan, row) => <li key={row} className="flex justify-between gap-3"><span>{bedsLabel(plan.beds)}{plan.baths != null ? `, ${plan.baths} bath` : ""}{plan.sqft ? `, ${plan.sqft.toLocaleString("en-US")} sq ft` : ""}{plan.availableOn ? `, available ${shortDay(plan.availableOn)}` : ""}</span><span className="shrink-0 text-muted-foreground">{rentRange(plan.rentMin, plan.rentMax)}</span></li>)}</ul>
          {(option.amenities.length > 0 || option.petPolicy) && <p className="mt-3 text-xs text-muted-foreground">{[...option.amenities.slice(0, 8), option.petPolicy ? `Pets: ${option.petPolicy}` : ""].filter(Boolean).join(" · ")}</p>}
          {ask(`Hi ${first}, I want to tour ${option.name}. `) && <a href={ask(`Hi ${first}, I want to tour ${option.name}. `)!} className="mt-4 flex min-h-12 w-full items-center justify-center bg-gold px-4 text-base font-medium text-primary-foreground" data-apt-tour="true">I want to tour this one</a>}
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            {ask(`Hi ${first}, a question about ${option.name}: `) && <a href={ask(`Hi ${first}, a question about ${option.name}: `)!} className="inline-flex min-h-11 flex-1 items-center justify-center border border-gold px-3 text-gold">Ask {first} a question</a>}
            {option.website && <a href={option.website} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 flex-1 items-center justify-center border border-border px-3 text-muted-foreground">Their website</a>}
          </div>
          </div>
        </li>)}
      </ol>
      {points.length > 0 && <AptMap points={points} activeId={active} onPick={(id) => { setActive(id); document.querySelector(`[data-apt-option="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }} className="mt-8 h-72 w-full" />}
      {options.length > 0 && <div className="mt-6 border-2 border-gold bg-gold/10 p-4" data-apt-referral="true"><p className="font-semibold">If you tour or apply on your own</p><p className="mt-1 text-sm">{referralLine} That is how {first} can keep helping you for free.</p></div>}
    </section>
    <footer className="deals-chrome border-t border-border/60 bg-background px-5 py-8 text-center text-xs text-muted-foreground"><p>{brokerage}. Rents, specials and availability change daily; your locator confirms them before a tour. Approval is always the community's decision. Equal Housing Opportunity.</p></footer>
  </main>;
}
