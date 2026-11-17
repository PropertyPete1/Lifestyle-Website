import { useMemo, useState } from "react";
import { Link } from "wouter";
import { MessageSquareText } from "lucide-react";
import FormError from "@/components/FormError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { humanizeSubmitError, isUsablePhone, PHONE_HINT } from "@shared/formErrors";
import { trpc } from "@/lib/trpc";
import { getVisitorId } from "@/lib/visitor";
import { markLeadCaptured } from "@/lib/leadSession";
import { aptMoney, bedsLabel, EMPTY_APT_FILTERS, needsSummary, rentRange, searchInput, type AptFilters } from "@/lib/apartments";
import { AptBadges, AptFilterBar } from "./AptFilterBar";
import { AptGallery } from "./AptGallery";
import { AptMap } from "./AptMap";

export const APT_SOURCE_TAG = "Website - Apartments";

/**
 * The renter's sign-up: first name and mobile number, as everywhere on the site since Nov 3, 2026 (we text them;
 * they never text us first). The lead note carries what they searched for and the apartment they asked about, so
 * the locator calls already knowing the second-chance needs.
 */
function RenterForm({ filters, askedAbout, onDone }: { filters: AptFilters; askedAbout: string | null; onDone?: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [done, setDone] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submit = trpc.leads.submit.useMutation({ onSuccess: () => { setDone(true); markLeadCaptured(); onDone?.(); }, onError: (error) => setSubmitError(humanizeSubmitError(error)) });
  const send = () => {
    if (submit.isPending) return;
    setSubmitError(null);
    submit.mutate({ name: name.trim(), email: "", phone, sourceTag: APT_SOURCE_TAG, answers: { interest: "Renting an apartment", lookingFor: needsSummary(filters), ...(askedAbout ? { askedAbout: `Apartment ${askedAbout}` } : {}) }, tcpaConsent: true, visitorId: getVisitorId() || undefined });
  };
  if (done) return <div data-lead-converted className="flex flex-col items-center gap-3 py-8 text-center"><MessageSquareText className="h-10 w-10 text-gold" /><h3 className="font-serif text-2xl">Check your texts.</h3><p className="max-w-sm text-sm text-muted-foreground">A locator will text you shortly with the apartments that fit, and set up your tours. It never costs you anything.</p></div>;
  return <form className="space-y-3 text-left" data-apt-renter-form="true" onSubmit={(event) => {
    event.preventDefault();
    setFieldError(null);
    if (!name.trim()) return setFieldError("Please add your first name so we know who to text.");
    if (!isUsablePhone(phone)) return setFieldError(PHONE_HINT);
    send();
  }}>
    {askedAbout && <p className="border border-gold/50 bg-gold/5 px-3 py-2 text-sm">Asking about apartment <strong>{askedAbout}</strong>. We will send its name, address and tour times.</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5"><Label htmlFor="apt-phone" className="text-xs uppercase tracking-widest text-muted-foreground">Your mobile number *</Label><Input id="apt-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="(210) 555-0123" value={phone} onChange={(event) => setPhone(event.target.value)} required className="h-12 rounded-none border-border bg-card text-base" /></div>
      <div className="space-y-1.5"><Label htmlFor="apt-name" className="text-xs uppercase tracking-widest text-muted-foreground">First name *</Label><Input id="apt-name" autoComplete="given-name" value={name} onChange={(event) => setName(event.target.value)} required className="h-12 rounded-none border-border bg-card text-base" /></div>
    </div>
    {fieldError && <p role="alert" className="text-[11px] text-destructive">{fieldError}</p>}
    {submitError && <FormError message={submitError} onRetry={send} retrying={submit.isPending} />}
    <Button type="submit" disabled={submit.isPending} className="min-h-12 w-full rounded-none bg-gold px-8 py-6 font-serif text-[19px] font-normal normal-case tracking-normal text-primary-foreground hover:bg-gold/90">{submit.isPending ? "Sending..." : "Text me my apartments"}</Button>
    <p className="text-[11px] leading-relaxed text-muted-foreground">By tapping the button you agree to get a text from Lifestyle Design Realty at this number about renting an apartment. Message and data rates may apply. Reply STOP anytime. See our <Link href="/privacy" className="underline underline-offset-2 hover:text-gold">Privacy Policy</Link> and <Link href="/terms" className="underline underline-offset-2 hover:text-gold">Terms</Link>.</p>
  </form>;
}

/**
 * The renter page (/apartments). Everything a renter needs to choose is open: area, rents, floor plans, specials and
 * what a community works with. The name, address and tour come from a locator, which is what makes it a lead.
 */
export function PublicApartments() {
  const [filters, setFilters] = useState<AptFilters>(EMPTY_APT_FILTERS);
  const [activeRef, setActiveRef] = useState<string | null>(null);
  const [asked, setAsked] = useState<string | null>(null);
  const cities = trpc.apartments.cities.useQuery(undefined, { staleTime: 300_000 });
  const results = trpc.apartments.search.useQuery(searchInput(filters), { placeholderData: (previous) => previous, staleTime: 30_000 });
  const items = results.data ?? [];
  const points = useMemo(() => items.filter((item) => item.approx).map((item) => ({ id: item.ref, lat: item.approx!.lat, lng: item.approx!.lng, label: item.rentFrom != null ? `from ${aptMoney(item.rentFrom)}` : item.areaLabel, area: true })), [items]);
  const ask = (ref: string | null) => { setAsked(ref); document.getElementById("apt-sign-up")?.scrollIntoView({ behavior: "smooth", block: "start" }); };

  return <main className="deals-light min-h-screen max-w-full overflow-x-clip bg-background" data-apt-public-page="true">
    <header className="deals-chrome flex min-w-0 items-center justify-between gap-3 border-b border-border/60 bg-background px-5 py-4 text-foreground">
      <Link href="/" className="font-serif text-sm tracking-[0.14em]">LIFESTYLE DESIGN <span className="text-gold">REALTY</span></Link>
      <button type="button" onClick={() => ask(null)} className="min-h-11 border border-gold px-4 text-sm text-gold">Get my list</button>
    </header>

    <section className="mx-auto w-full max-w-6xl px-5 pb-6 pt-10">
      <p className="eyebrow text-gold">Free apartment locating</p>
      <h1 className="mt-2 font-serif text-4xl leading-tight sm:text-5xl">Find your next apartment. We do the searching, free.</h1>
      <p className="mt-3 max-w-2xl text-base text-muted-foreground">Rents, specials and what each community works with, across San Antonio and Austin. Tell us what you need and a licensed locator sends the names, sets up the tours and stays with you until you have keys. The apartment community pays us, never you.</p>
      <div className="mt-8"><AptFilterBar filters={filters} onChange={setFilters} cities={cities.data ?? []} /></div>
    </section>

    <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 pb-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]" aria-label="Apartments">
      <div className="min-w-0">
        <p className="mb-3 text-sm text-muted-foreground" aria-live="polite" data-apt-count="true">{results.isLoading ? "Finding apartments..." : items.length === 0 ? "" : `${items.length} apartment communit${items.length === 1 ? "y" : "ies"} match`}</p>
        {!results.isLoading && items.length === 0 && <div className="border border-border bg-card p-6" data-apt-empty="true"><h2 className="font-serif text-2xl">Nothing listed for that yet.</h2><p className="mt-2 text-sm text-muted-foreground">Our locators work with more communities than are shown here, including second-chance ones. Leave your number and we will text you what fits.</p><Button type="button" onClick={() => ask(null)} className="mt-4 min-h-11 rounded-none bg-gold text-primary-foreground hover:bg-gold/90">Text me what fits</Button></div>}
        <ul className="grid gap-4 sm:grid-cols-2">
          {items.map((item) => <li key={item.ref} onMouseEnter={() => setActiveRef(item.ref)} onFocus={() => setActiveRef(item.ref)} className={`flex min-w-0 flex-col border bg-card transition-colors ${activeRef === item.ref ? "border-gold" : "border-border"}`} data-apt-card={item.ref}>
            <AptGallery photos={item.photos} label={`${item.areaLabel} apartment ${item.ref}`} />
            <div className="flex min-w-0 flex-1 flex-col p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><p className="text-xs uppercase tracking-widest text-muted-foreground">{item.city}</p><h2 className="font-serif text-xl leading-tight">{item.areaLabel}</h2></div>
              <p className="shrink-0 text-right"><span className="block text-[11px] text-muted-foreground">from</span><span className="font-serif text-2xl text-gold">{item.rentFrom != null ? aptMoney(item.rentFrom) : "Call"}</span></p>
            </div>
            <div className="mt-3"><AptBadges item={item} /></div>
            {item.special && <p className="mt-3 border-l-2 border-gold bg-gold/5 px-3 py-2 text-sm"><span className="font-semibold">Special: </span>{item.special}</p>}
            <ul className="mt-3 space-y-1 text-sm">
              {item.plans.slice(0, 4).map((plan, index) => <li key={index} className="flex justify-between gap-3"><span>{bedsLabel(plan.beds)}{plan.baths != null ? `, ${plan.baths} bath` : ""}{plan.sqft ? `, ${plan.sqft.toLocaleString("en-US")} sq ft` : ""}</span><span className="shrink-0 text-muted-foreground">{rentRange(plan.rentMin, plan.rentMax)}</span></li>)}
              {item.plans.length > 4 && <li className="text-xs text-muted-foreground">{item.plans.length - 4} more floor plans</li>}
            </ul>
            {(item.amenities.length > 0 || item.petPolicy) && <p className="mt-3 text-xs text-muted-foreground">{[...item.amenities.slice(0, 5), item.petPolicy ? `Pets: ${item.petPolicy}` : ""].filter(Boolean).join(" · ")}</p>}
            <div className="mt-auto pt-4"><Button type="button" onClick={() => ask(item.ref)} className="min-h-11 w-full rounded-none bg-gold text-primary-foreground hover:bg-gold/90">Get the name and tour times</Button><p className="mt-1 text-center text-[11px] text-muted-foreground">Apartment {item.ref}</p></div>
            </div>
          </li>)}
        </ul>
      </div>
      <aside className="min-w-0 space-y-6 lg:sticky lg:top-4 lg:self-start">
        {points.length > 0 && <div><AptMap points={points} activeId={activeRef} onPick={setActiveRef} className="h-72 w-full" /><p className="mt-1 text-[11px] text-muted-foreground">Shaded circles are general areas, not addresses.</p></div>}
        <section id="apt-sign-up" className="scroll-mt-4 border border-gold/60 bg-card p-5" aria-labelledby="apt-sign-up-title">
          <h2 id="apt-sign-up-title" className="font-serif text-2xl leading-tight">Get your list by text</h2>
          <p className="mb-4 mt-1 text-sm text-muted-foreground">Names, addresses, current specials and tour times for the apartments that fit you{Object.values(filters.needs).some(Boolean) || filters.secondChanceOnly ? ", including the ones that work with your situation" : ""}.</p>
          <RenterForm filters={filters} askedAbout={asked} />
        </section>
      </aside>
    </section>

    <footer className="deals-chrome border-t border-border/60 bg-background px-5 py-8 text-center text-xs text-muted-foreground">
      <p>Lifestyle Design Realty. Apartment locating is free to renters; our fee is paid by the community you lease from.</p>
      <p className="mt-2">Rents, specials and availability change daily and are confirmed by your locator before a tour. Approval is always the community's decision. Equal Housing Opportunity.</p>
      <p className="mt-2"><Link href="/privacy" className="underline underline-offset-2">Privacy</Link> · <Link href="/terms" className="underline underline-offset-2">Terms</Link> · <Link href="/apartments/team" className="underline underline-offset-2">Locator sign-in</Link></p>
    </footer>
  </main>;
}
