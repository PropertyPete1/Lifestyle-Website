import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { Copy, Mail, MapPin, MessageSquareText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { APT_COMMISSION_STALE_DAYS } from "@shared/apartments";
import { aptMoney, bedsLabel, EMPTY_APT_FILTERS, mapsHref, openLetter, rentRange, searchInput, shortDay, smsHref, type AptFilters, type Letter } from "@/lib/apartments";
import { AptBadges, AptFilterBar } from "./AptFilterBar";
import { AptGallery } from "./AptGallery";
import { AptMap } from "./AptMap";

/**
 * The locators' workspace (/apartments/team), behind the same team sign-in as Builder Deals. Search is sorted by
 * what a community pays; from a result a locator sends the client their options, registers the client (guest card),
 * and after a lease walks it through verification, invoice and paid. The app writes every letter; the locator sends
 * it from their own Gmail and taps the step, so the property always hears from the person it will pay.
 */
const FIELD = "h-11 w-full rounded-none border border-border bg-card px-3 text-sm";
const GOLD_BUTTON = "min-h-11 rounded-none bg-gold text-primary-foreground hover:bg-gold/90";
const LINE_BUTTON = "inline-flex min-h-11 items-center justify-center gap-1.5 border border-border px-3 text-sm hover:border-gold";
const accepts = (value: string) => value === "yes" || value === "case_by_case";
const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const daysSince = (day: string | null) => day ? Math.floor((Date.parse(`${todayIso()}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000) : null;

/** How "pays up to" was reached, in the locator's words: the best rate on the dearest matching floor plan, plus a live bonus. */
function payMath(property: { escortPercent: number | null; sendPercent: number | null; flatFee: number | null; bonusAmount: number | null }, plans: Array<{ rentMin: number | null }>): string {
  const rent = Math.max(0, ...plans.map((plan) => plan.rentMin ?? 0));
  const percent = property.escortPercent ?? property.sendPercent;
  const base = percent != null && rent ? `${property.escortPercent != null ? "escort" : "send"} ${percent}% of ${aptMoney(rent)}` : property.flatFee != null ? `flat ${aptMoney(property.flatFee)}` : "";
  return [base, property.bonusAmount ? `${aptMoney(property.bonusAmount)} bonus` : ""].filter(Boolean).join(" + ");
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-[95] flex items-end bg-black/70 p-3 sm:items-center sm:justify-center" data-apt-sheet="true"><section role="dialog" aria-modal="true" aria-label={title} className="deals-light max-h-[92vh] w-full max-w-xl overflow-y-auto border border-border bg-background p-5 text-foreground">
    <div className="mb-4 flex items-start justify-between gap-3"><h2 className="font-serif text-2xl leading-tight">{title}</h2><button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 shrink-0 items-center justify-center border border-border"><X className="h-4 w-4" /></button></div>
    {children}
  </section></div>;
}

/** A drafted letter: read it, open it in Gmail (the app on a phone), copy it, then say it was sent. */
function LetterView({ letter, agentEmail, sentLabel, onSent, sms }: { letter: Letter; agentEmail: string | null; sentLabel?: string; onSent?: () => void; sms?: { phone: string | null } }) {
  const copy = async () => { try { await navigator.clipboard.writeText(`${letter.subject}\n\n${letter.body}`); toast.success("Copied"); } catch { toast.error("Could not copy. Select the text and copy it."); } };
  return <div data-apt-letter="true">
    <p className="text-xs text-muted-foreground">{letter.to ? `To: ${letter.to}` : sms ? "Send it to your client" : "No e-mail on file for this property: add the address in Gmail"}</p>
    <p className="mt-1 text-sm font-semibold">{letter.subject}</p>
    <pre className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap break-words border border-border bg-card p-3 font-sans text-sm">{letter.body}</pre>
    <div className="mt-3 flex flex-wrap gap-2">
      {sms && <a href={smsHref(letter.body, sms.phone)} className={`${LINE_BUTTON} border-gold text-gold`}><MessageSquareText className="h-4 w-4" />Text it</a>}
      <button type="button" onClick={() => openLetter(letter, agentEmail)} className={`${LINE_BUTTON} border-gold text-gold`}><Mail className="h-4 w-4" />Email it</button>
      <button type="button" onClick={copy} className={LINE_BUTTON}><Copy className="h-4 w-4" />Copy</button>
      {onSent && <Button type="button" onClick={onSent} className={GOLD_BUTTON}>{sentLabel ?? "I sent it"}</Button>}
    </div>
  </div>;
}

type Sheets =
  | { kind: "client" }
  | { kind: "guest"; propertyId: number; propertyName: string }
  | { kind: "lease"; propertyId: number; propertyName: string }
  | { kind: "pay"; propertyId: number; propertyName: string; send: number | null; escort: number | null; flat: number | null; bonus: number | null }
  | { kind: "send" }
  | { kind: "letter"; title: string; letter: Letter; sentLabel?: string; onSent?: () => void; sms?: { phone: string | null } }
  | { kind: "verified"; leaseId: number; expected: number }
  | { kind: "paid"; leaseId: number; amount: number };

export function LocatorWorkspace() {
  const utils = trpc.useUtils();
  const me = trpc.apartments.locator.me.useQuery(undefined, { retry: false });
  const signedIn = Boolean(me.data);
  const [tab, setTab] = useState<"search" | "book">("search");
  const [filters, setFilters] = useState<AptFilters>(EMPTY_APT_FILTERS);
  const [picks, setPicks] = useState<number[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheets | null>(null);
  const cities = trpc.apartments.cities.useQuery(undefined, { enabled: signedIn, staleTime: 300_000 });
  const results = trpc.apartments.locator.search.useQuery(searchInput(filters), { enabled: signedIn, placeholderData: (previous) => previous });
  const book = trpc.apartments.locator.book.useQuery(undefined, { enabled: signedIn });
  const refresh = () => { void utils.apartments.locator.book.invalidate(); void utils.apartments.locator.search.invalidate(); };
  const fail = (error: { message: string }) => toast.error(error.message);
  const items = results.data ?? [];
  const clients = book.data?.clients ?? [];
  const agentEmail = me.data?.email ?? null;
  const points = useMemo(() => items.flatMap((item) => item.property.lat != null && item.property.lng != null ? [{ id: String(item.property.id), lat: item.property.lat, lng: item.property.lng, label: item.pays > 0 ? aptMoney(item.pays) : "No pay on file" }] : []), [items]);

  const addClient = trpc.apartments.locator.addClient.useMutation({ onSuccess: () => { toast.success("Client added"); refresh(); setSheet(null); }, onError: fail });
  const guestCard = trpc.apartments.locator.guestCard.useMutation({ onError: fail });
  const markCard = trpc.apartments.locator.markGuestCard.useMutation({ onSuccess: () => { refresh(); setSheet(null); }, onError: fail });
  const sendOptions = trpc.apartments.locator.sendOptions.useMutation({ onError: fail });
  const reportLease = trpc.apartments.locator.reportLease.useMutation({ onError: fail });
  const confirmPay = trpc.apartments.locator.confirmCommission.useMutation({ onSuccess: () => { toast.success("Pay updated and dated today"); refresh(); setSheet(null); }, onError: fail });
  const verification = trpc.apartments.locator.leaseVerification.useMutation({ onError: fail });
  const markVerification = trpc.apartments.locator.markVerificationSent.useMutation({ onSuccess: () => { refresh(); setSheet(null); }, onError: fail });
  const recordVerified = trpc.apartments.locator.recordVerification.useMutation({ onSuccess: () => { toast.success("Verified amount saved"); refresh(); setSheet(null); }, onError: fail });
  const invoice = trpc.apartments.locator.invoice.useMutation({ onError: fail });
  const markPaid = trpc.apartments.locator.markPaid.useMutation({ onSuccess: () => { toast.success("Marked paid"); refresh(); setSheet(null); }, onError: fail });

  const header = <header className="deals-chrome flex min-w-0 items-center justify-between gap-3 border-b border-border/60 bg-background px-5 py-4 text-foreground"><Link href="/apartments" className="font-serif text-sm tracking-[0.14em]">LIFESTYLE DESIGN <span className="text-gold">REALTY</span></Link><span className="text-xs text-muted-foreground">{me.data ? `Locator: ${me.data.name}` : "Locators"}</span></header>;
  if (me.isLoading) return <main className="deals-light min-h-screen bg-background">{header}<p className="px-5 py-16 text-center text-sm text-muted-foreground">Checking your sign-in...</p></main>;
  if (!me.data) return <main className="deals-light min-h-screen bg-background" data-apt-locator="signed-out">{header}<section className="mx-auto max-w-md px-5 py-16 text-center"><p className="eyebrow text-gold">Team only</p><h1 className="mt-2 font-serif text-3xl">Sign in to the locator tools</h1><p className="mt-3 text-sm text-muted-foreground">Use the same team sign-in as Builder Deals, then come back to this page.</p><a href="/deals/team" className={`mt-6 inline-flex items-center px-6 ${GOLD_BUTTON}`}>Team sign-in</a></section></main>;

  const clientSelect = (name = "clientId") => <select name={name} required className={FIELD} defaultValue=""><option value="" disabled>Choose a client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select>;
  const form = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); return new FormData(event.currentTarget); };
  const text = (data: FormData, key: string) => String(data.get(key) ?? "").trim();
  const numberOrNull = (data: FormData, key: string) => { const value = text(data, key).replace(/[^\d.]/g, ""); return value === "" ? null : Number(value); };
  const noClients = <p className="text-sm">Add the client first. <button type="button" className="text-gold underline underline-offset-2" onClick={() => setSheet({ kind: "client" })}>Add a client</button></p>;

  return <main className="deals-light min-h-screen max-w-full overflow-x-clip bg-background pb-24" data-apt-locator="signed-in">
    {header}
    <nav className="mx-auto flex w-full max-w-6xl gap-2 px-5 pt-5" aria-label="Locator sections">
      {(["search", "book"] as const).map((key) => <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)} className={`min-h-11 border px-4 text-sm ${tab === key ? "border-gold bg-gold text-primary-foreground" : "border-border bg-card"}`}>{key === "search" ? "Find apartments" : `My clients and money${book.data ? ` (${book.data.clients.length})` : ""}`}</button>)}
      <button type="button" onClick={() => setSheet({ kind: "client" })} className={`${LINE_BUTTON} ml-auto border-gold text-gold`}>Add a client</button>
    </nav>

    {tab === "search" && <section className="mx-auto w-full max-w-6xl px-5 py-5">
      {clients.length > 0 && <label className="mb-4 block text-xs uppercase tracking-widest text-muted-foreground">Search for a client
        <select className={`${FIELD} mt-1 normal-case tracking-normal`} defaultValue="" onChange={(event) => { const client = clients.find((entry) => entry.id === Number(event.target.value)); if (client) setFilters({ ...filters, beds: client.beds == null ? "" : String(client.beds), maxRent: client.budgetMax == null ? "" : String(client.budgetMax), moveBy: client.moveDate ?? "" }); }}>
          <option value="">Fill the search from a client's file</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
        </select></label>}
      <AptFilterBar filters={filters} onChange={setFilters} cities={cities.data ?? []} locator />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="min-w-0">
          <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">{results.isLoading ? "Searching..." : `${items.length} communit${items.length === 1 ? "y" : "ies"}, best paying first`}</p>
          {!results.isLoading && items.length === 0 && <p className="border border-border bg-card p-5 text-sm">No community on file matches. Loosen the search, or ask Peter to add the community.</p>}
          <ul className="space-y-4">
            {items.map(({ property, plans, pays }) => {
              const age = daysSince(property.commissionVerifiedOn);
              const stale = age == null || age > APT_COMMISSION_STALE_DAYS;
              const picked = picks.includes(property.id);
              const rates = [property.sendPercent != null && `send ${property.sendPercent}%`, property.escortPercent != null && `escort ${property.escortPercent}%`, property.flatFee != null && `flat ${aptMoney(property.flatFee)}`, property.bonusAmount ? `+${aptMoney(property.bonusAmount)} bonus${property.bonusExpiresOn ? ` to ${property.bonusExpiresOn}` : ""}` : ""].filter(Boolean).join(" · ");
              return <li key={property.id} onMouseEnter={() => setActive(String(property.id))} className={`min-w-0 border bg-card p-4 ${active === String(property.id) ? "border-gold" : "border-border"}`} data-apt-locator-card={property.id}>
                {property.photos.length > 0 ? <AptGallery photos={property.photos} label={property.name} className="mb-4 sm:float-right sm:mb-2 sm:ml-4 sm:w-56" /> : <p className="mb-2 text-xs text-destructive">No photos on file yet: a list sent to a client will show this one without pictures.</p>}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="text-xs uppercase tracking-widest text-muted-foreground">{property.areaLabel}{property.managementCompany ? ` · ${property.managementCompany}` : ""}</p><h2 className="font-serif text-2xl leading-tight">{property.name}</h2>
                    <a href={mapsHref(`${property.name}, ${property.address}`)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-start gap-1.5 text-sm text-gold underline underline-offset-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0" />{property.address}</a></div>
                  <div className="shrink-0 text-right" data-apt-pay="true"><span className="block text-[11px] text-muted-foreground">pays up to</span><span className="font-serif text-3xl text-gold">{pays > 0 ? aptMoney(pays) : "?"}</span>{pays > 0 && <span className="block max-w-[11rem] text-[11px] leading-tight text-muted-foreground">{payMath(property, plans)}</span>}</div>
                </div>
                <p className="mt-2 text-sm font-medium">{rates || "No pay on file: check Smart Apartment Data, then tap Update pay"}{property.minLeaseMonths ? ` · ${property.minLeaseMonths}-month lease` : ""}</p>
                <p className={`mt-1 text-xs ${stale ? "text-destructive" : "text-muted-foreground"}`}>{age == null ? "Pay never confirmed: confirm before you quote it" : stale ? `Pay last confirmed ${age} days ago: confirm it again` : `Pay confirmed ${age === 0 ? "today" : `${age} day${age === 1 ? "" : "s"} ago`}`}{property.registrationRequired ? " · Register the client before the visit" : ""}</p>
                {property.commissionNote && <p className="mt-1 text-xs text-muted-foreground">{property.commissionNote}</p>}
                <div className="mt-3"><AptBadges item={{ secondChance: accepts(property.brokenLease) || accepts(property.eviction) || accepts(property.felony), acceptsBrokenLease: accepts(property.brokenLease), acceptsEviction: accepts(property.eviction), acceptsFelony: accepts(property.felony), incomeRestricted: property.incomeRestricted, incomeMultiple: property.incomeMultiple }} /></div>
                {property.minCreditScore != null && <p className="mt-2 text-xs text-muted-foreground">Minimum credit score {property.minCreditScore}</p>}
                {property.specialText && <p className="mt-3 border-l-2 border-gold bg-gold/5 px-3 py-2 text-sm"><span className="font-semibold">Special: </span>{property.specialText}{property.specialExpiresOn ? ` (to ${property.specialExpiresOn})` : ""}</p>}
                <ul className="mt-3 space-y-1 text-sm">{plans.slice(0, 5).map((plan) => <li key={plan.id} className="flex justify-between gap-3"><span>{plan.name ? `${plan.name}: ` : ""}{bedsLabel(plan.beds)}{plan.baths != null ? `, ${plan.baths} bath` : ""}{plan.sqft ? `, ${plan.sqft.toLocaleString("en-US")} sq ft` : ""}{plan.availableOn ? `, available ${shortDay(plan.availableOn)}` : ""}</span><span className="shrink-0 text-muted-foreground">{rentRange(plan.rentMin, plan.rentMax)}</span></li>)}</ul>
                <div className="mt-4 flex clear-both flex-wrap gap-2">
                  <button type="button" aria-pressed={picked} onClick={() => setPicks(picked ? picks.filter((id) => id !== property.id) : [...picks, property.id])} className={`min-h-11 border px-3 text-sm ${picked ? "border-gold bg-gold text-primary-foreground" : "border-gold text-gold"}`}>{picked ? "Picked ✓" : "Pick for a client"}</button>
                  <button type="button" onClick={() => setSheet({ kind: "guest", propertyId: property.id, propertyName: property.name })} className={LINE_BUTTON}>Guest card</button>
                  <button type="button" onClick={() => setSheet({ kind: "lease", propertyId: property.id, propertyName: property.name })} className={LINE_BUTTON}>Client leased</button>
                  <button type="button" onClick={() => setSheet({ kind: "pay", propertyId: property.id, propertyName: property.name, send: property.sendPercent, escort: property.escortPercent, flat: property.flatFee, bonus: property.bonusAmount })} className={LINE_BUTTON}>Update pay</button>
                  {property.phone && <a href={`tel:${property.phone}`} className={LINE_BUTTON}>Call</a>}
                  {property.website && <a href={property.website} target="_blank" rel="noopener noreferrer" className={LINE_BUTTON}>Website</a>}
                </div>
              </li>;
            })}
          </ul>
        </div>
        {points.length > 0 && <aside className="min-w-0 lg:sticky lg:top-4 lg:self-start"><AptMap points={points} activeId={active} onPick={(id) => { setActive(id); document.querySelector(`[data-apt-locator-card="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }} className="h-80 w-full lg:h-[32rem]" /></aside>}
      </div>
    </section>}

    {tab === "book" && <section className="mx-auto w-full max-w-6xl px-5 py-5" data-apt-book="true">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{([["Expected", book.data?.money.expected], ["Verified, not invoiced", book.data?.money.verified], ["Invoiced, unpaid", book.data?.money.invoicedUnpaid], ["Paid", book.data?.money.paid]] as const).map(([label, amount]) => <div key={label} className="border border-border bg-card p-4"><p className="text-xs uppercase tracking-widest text-muted-foreground">{label}</p><p className="mt-1 font-serif text-2xl text-gold">{aptMoney(amount ?? 0)}</p></div>)}</div>

      <h2 className="mt-8 font-serif text-2xl">Leases</h2>
      {(book.data?.leases.length ?? 0) === 0 && <p className="mt-2 text-sm text-muted-foreground">No leases yet. When a client signs, tap "Client leased" on the community.</p>}
      <ul className="mt-3 space-y-3">{book.data?.leases.map((lease) => {
        const client = clients.find((entry) => entry.id === lease.clientId);
        return <li key={lease.id} className="border border-border bg-card p-4" data-apt-lease={lease.status}>
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{client?.name ?? "Client"} at {lease.property}{lease.unit ? `, unit ${lease.unit}` : ""}</p><p className="text-sm text-muted-foreground">{aptMoney(lease.rent)} a month, {lease.termMonths} months from {lease.leaseStartOn} ({lease.method})</p></div><p className="text-right text-sm"><span className="block text-xs uppercase tracking-widest text-muted-foreground">{lease.status.replace(/_/g, " ")}</span><span className="font-serif text-xl text-gold">{aptMoney(lease.paidAmount ?? lease.verifiedAmount ?? lease.expectedAmount)}</span>{lease.verifiedAmount == null && <span className="block text-[11px] text-muted-foreground">our estimate</span>}</p></div>
          {lease.invoiceNumber && <p className="mt-1 text-xs text-muted-foreground">Invoice {lease.invoiceNumber}{lease.dueOn ? `, due ${lease.dueOn}` : ""}{lease.paidOn ? `, paid ${lease.paidOn}` : ""}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {(lease.status === "reported" || lease.status === "verification_sent") && <Button type="button" className={GOLD_BUTTON} disabled={verification.isPending} onClick={() => verification.mutate({ leaseId: lease.id }, { onSuccess: (letter) => setSheet({ kind: "letter", title: "Lease verification", letter, ...(lease.status === "reported" ? { sentLabel: "I sent the verification", onSent: () => markVerification.mutate({ leaseId: lease.id }) } : {}) }) })}>{lease.status === "reported" ? "1. Send lease verification" : "Verification letter again"}</Button>}
            {lease.status === "verification_sent" && <Button type="button" className={GOLD_BUTTON} onClick={() => setSheet({ kind: "verified", leaseId: lease.id, expected: lease.expectedAmount })}>2. Property confirmed the amount</Button>}
            {(lease.status === "verified" || lease.status === "invoiced" || lease.status === "paid") && <Button type="button" className={lease.status === "verified" ? GOLD_BUTTON : "min-h-11 rounded-none border border-border bg-card text-foreground hover:bg-secondary"} disabled={invoice.isPending} onClick={() => invoice.mutate({ leaseId: lease.id }, { onSuccess: (made) => { refresh(); setSheet({ kind: "letter", title: `Invoice ${made.number}`, letter: made }); } })}>{lease.status === "verified" ? "3. Create the invoice" : "Open the invoice"}</Button>}
            {lease.status === "invoiced" && <Button type="button" className={GOLD_BUTTON} onClick={() => setSheet({ kind: "paid", leaseId: lease.id, amount: lease.verifiedAmount ?? 0 })}>4. We got paid</Button>}
          </div>
        </li>;
      })}</ul>

      <h2 className="mt-8 font-serif text-2xl">Lists you sent</h2>
      {(book.data?.sentLists.length ?? 0) === 0 && <p className="mt-2 text-sm text-muted-foreground">Nothing sent yet. Pick communities on the search and tap "Send to a client".</p>}
      <ul className="mt-3 space-y-2">{book.data?.sentLists.map((list) => <li key={list.id} className={`border bg-card p-3 text-sm ${list.liked.length ? "border-gold" : "border-border"}`} data-apt-sent-list={list.liked.length}>
        <div className="flex flex-wrap items-center justify-between gap-3"><span>{clients.find((entry) => entry.id === list.clientId)?.name ?? "Client"}: {list.count} apartment{list.count === 1 ? "" : "s"}</span><span className={list.opened ? "text-gold" : "text-muted-foreground"}>{list.opened ? "Opened" : "Not opened yet"}</span></div>
        {list.liked.length > 0 && <p className="mt-1 font-medium">Liked: {list.liked.map((entry) => entry.property).join(", ")}</p>}
        <a href={`/apartments/list/${list.token}`} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-gold underline underline-offset-2">Open their list</a>
      </li>)}</ul>

      <h2 className="mt-8 font-serif text-2xl">Guest cards</h2>
      {(book.data?.guestCards.length ?? 0) === 0 && <p className="mt-2 text-sm text-muted-foreground">No guest cards yet. Register a client from "Guest card" on a community before they visit.</p>}
      <ul className="mt-3 space-y-2">{book.data?.guestCards.map((card) => <li key={card.id} className="flex flex-wrap items-center justify-between gap-3 border border-border bg-card p-3 text-sm">
        <span>{clients.find((entry) => entry.id === card.clientId)?.name ?? "Client"} at {card.property} ({card.method}{card.visitOn ? `, visit ${card.visitOn}` : ""})</span>
        <span className="flex flex-wrap items-center gap-2">{card.confirmedOn ? <span className="text-gold">Confirmed {card.confirmedOn}</span> : card.sentOn ? <><span className="text-muted-foreground">Sent {card.sentOn}</span><button type="button" className={LINE_BUTTON} onClick={() => markCard.mutate({ id: card.id, confirmed: true })}>Property confirmed</button></> : <button type="button" className={LINE_BUTTON} onClick={() => markCard.mutate({ id: card.id, sent: true })}>Mark sent</button>}</span>
      </li>)}</ul>

      <h2 className="mt-8 font-serif text-2xl">Clients</h2>
      {clients.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No clients yet.</p>}
      <ul className="mt-3 grid gap-2 md:grid-cols-2">{clients.map((client) => <li key={client.id} className="border border-border bg-card p-3 text-sm"><p className="font-semibold">{client.name}</p><p className="text-muted-foreground">{[client.phone, client.email, client.beds != null && bedsLabel(client.beds), client.budgetMax != null && `up to ${aptMoney(client.budgetMax)}`, client.moveDate && `moving ${client.moveDate}`].filter(Boolean).join(" · ") || "No details yet"}</p>{client.notes && <p className="mt-1 text-xs">{client.notes}</p>}</li>)}</ul>
    </section>}

    {picks.length > 0 && <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gold bg-background px-5 py-3" data-apt-picks={picks.length}><div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3"><p className="text-sm">{picks.length} picked</p><div className="flex gap-2"><button type="button" className={LINE_BUTTON} onClick={() => setPicks([])}>Clear</button><Button type="button" className={GOLD_BUTTON} onClick={() => setSheet({ kind: "send" })}>Send to a client</Button></div></div></div>}

    {sheet?.kind === "client" && <Sheet title="Add a client" onClose={() => setSheet(null)}><form className="space-y-3" onSubmit={(event) => { const data = form(event); addClient.mutate({ name: text(data, "name"), phone: text(data, "phone") || null, email: text(data, "email") || null, moveDate: text(data, "moveDate") || null, beds: text(data, "beds") === "" ? null : Number(text(data, "beds")), budgetMax: numberOrNull(data, "budget"), notes: text(data, "notes") || null }); }}>
      <Input name="name" required minLength={2} placeholder="Full name" className={FIELD} />
      <div className="grid grid-cols-2 gap-3"><Input name="phone" type="tel" placeholder="Phone" className={FIELD} /><Input name="email" type="email" placeholder="Email (optional)" className={FIELD} /></div>
      <div className="grid grid-cols-3 gap-3"><select name="beds" className={FIELD} defaultValue=""><option value="">Beds</option><option value="0">Studio</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option></select><Input name="budget" inputMode="numeric" placeholder="Max rent" className={FIELD} /><Input name="moveDate" type="date" aria-label="Move date" className={FIELD} /></div>
      <textarea name="notes" maxLength={2000} placeholder="Notes: broken lease, eviction, pets, areas..." className="min-h-20 w-full border border-border bg-card p-3 text-sm" />
      <Button type="submit" disabled={addClient.isPending} className={`w-full ${GOLD_BUTTON}`}>Save client</Button>
    </form></Sheet>}

    {sheet?.kind === "guest" && <Sheet title={`Guest card: ${sheet.propertyName}`} onClose={() => setSheet(null)}>{clients.length === 0 ? noClients : <form className="space-y-3" onSubmit={(event) => { const data = form(event); const client = clients.find((entry) => entry.id === Number(text(data, "clientId"))); guestCard.mutate({ clientId: Number(text(data, "clientId")), propertyId: sheet.propertyId, method: text(data, "method") === "escort" ? "escort" : "send", visitOn: text(data, "visitOn") || null }, { onSuccess: (made) => { refresh(); setSheet({ kind: "letter", title: `Guest card: ${client?.name ?? ""}`, letter: made.letter, sentLabel: "I sent the guest card", onSent: () => markCard.mutate({ id: made.id, sent: true }) }); } }); }}>
      <p className="text-sm text-muted-foreground">Registers your client with the leasing office before they visit, so the lease is credited to you.</p>
      {clientSelect()}
      <div className="grid grid-cols-2 gap-3"><select name="method" className={FIELD} defaultValue="send"><option value="send">Send (client goes alone)</option><option value="escort">Escort (I tour with them)</option></select><Input name="visitOn" type="date" aria-label="Visit date" className={FIELD} /></div>
      <Button type="submit" disabled={guestCard.isPending} className={`w-full ${GOLD_BUTTON}`}>Write the guest card</Button>
    </form>}</Sheet>}

    {sheet?.kind === "send" && <Sheet title={`Send ${picks.length} apartment${picks.length === 1 ? "" : "s"} to a client`} onClose={() => setSheet(null)}>{clients.length === 0 ? noClients : <form className="space-y-3" onSubmit={(event) => { const data = form(event); const client = clients.find((entry) => entry.id === Number(text(data, "clientId"))); sendOptions.mutate({ clientId: Number(text(data, "clientId")), propertyIds: picks, note: text(data, "note") || null, pickNotes: Object.fromEntries(picks.flatMap((id) => { const why = text(data, `why-${id}`); return why ? [[String(id), why]] : []; })) }, { onSuccess: (made) => { setPicks([]); setSheet({ kind: "letter", title: `Options for ${client?.name ?? "your client"}`, letter: made.message, sms: { phone: client?.phone ?? null } }); } }); }}>
      <p className="text-sm text-muted-foreground">Your client gets one link with the names, addresses, rents and specials, and the line telling them to name you as their locator. It never shows what a community pays.</p>
      {clientSelect()}
      <textarea name="note" maxLength={500} placeholder="A note shown at the top of their list (optional)" className="min-h-20 w-full border border-border bg-card p-3 text-sm" />
      <p className="text-xs uppercase tracking-widest text-muted-foreground">Why you picked each one (optional, shown to the client)</p>
      {picks.map((id) => <label key={id} className="block text-sm">{items.find((item) => item.property.id === id)?.property.name ?? `Community ${id}`}<Input name={`why-${id}`} maxLength={400} placeholder="Closest to your work, and the special covers your first month" className={`${FIELD} mt-1`} /></label>)}
      <Button type="submit" disabled={sendOptions.isPending} className={`w-full ${GOLD_BUTTON}`}>Make the link</Button>
    </form>}</Sheet>}

    {sheet?.kind === "lease" && <Sheet title={`Client leased: ${sheet.propertyName}`} onClose={() => setSheet(null)}>{clients.length === 0 ? noClients : <form className="space-y-3" onSubmit={(event) => { const data = form(event); reportLease.mutate({ clientId: Number(text(data, "clientId")), propertyId: sheet.propertyId, unit: text(data, "unit") || null, rent: Number(text(data, "rent").replace(/[^\d]/g, "")), termMonths: Number(text(data, "term")), leaseStartOn: text(data, "start"), leaseSignedOn: text(data, "signed"), method: text(data, "method") === "escort" ? "escort" : "send" }, { onSuccess: (made) => { toast.success(`Lease saved. Our estimate: ${aptMoney(made.expectedAmount)}${made.confirm.length ? `. Confirm: ${made.confirm.join("; ")}` : ""}`, { duration: 9000 }); refresh(); setSheet(null); setTab("book"); } }); }}>
      {clientSelect()}
      <div className="grid grid-cols-2 gap-3"><Input name="unit" placeholder="Unit" className={FIELD} /><Input name="rent" required inputMode="numeric" placeholder="Monthly rent" className={FIELD} /></div>
      <div className="grid grid-cols-2 gap-3"><label className="text-xs text-muted-foreground">Lease term (months)<Input name="term" required type="number" min={1} max={36} defaultValue={12} className={`${FIELD} mt-1`} /></label><label className="text-xs text-muted-foreground">Send or escort<select name="method" className={`${FIELD} mt-1`} defaultValue="send"><option value="send">Send</option><option value="escort">Escort</option></select></label></div>
      <div className="grid grid-cols-2 gap-3"><label className="text-xs text-muted-foreground">Lease signed<Input name="signed" required type="date" defaultValue={todayIso()} className={`${FIELD} mt-1`} /></label><label className="text-xs text-muted-foreground">Lease starts<Input name="start" required type="date" className={`${FIELD} mt-1`} /></label></div>
      <Button type="submit" disabled={reportLease.isPending} className={`w-full ${GOLD_BUTTON}`}>Save the lease</Button>
    </form>}</Sheet>}

    {sheet?.kind === "pay" && <Sheet title={`Update pay: ${sheet.propertyName}`} onClose={() => setSheet(null)}><form className="space-y-3" onSubmit={(event) => { const data = form(event); confirmPay.mutate({ propertyId: sheet.propertyId, sendPercent: numberOrNull(data, "send"), escortPercent: numberOrNull(data, "escort"), flatFee: numberOrNull(data, "flat"), bonusAmount: numberOrNull(data, "bonus"), bonusExpiresOn: text(data, "bonusEnds") || null, commissionNote: text(data, "note") || null }); }}>
      <p className="text-sm text-muted-foreground">Enter what the community told you (flyer, call or their reply to your guest card). It is saved for the whole team and dated today.</p>
      <div className="grid grid-cols-2 gap-3"><label className="text-xs text-muted-foreground">Send %<Input name="send" inputMode="numeric" defaultValue={sheet.send ?? ""} className={`${FIELD} mt-1`} /></label><label className="text-xs text-muted-foreground">Escort %<Input name="escort" inputMode="numeric" defaultValue={sheet.escort ?? ""} className={`${FIELD} mt-1`} /></label></div>
      <div className="grid grid-cols-3 gap-3"><label className="text-xs text-muted-foreground">Flat fee $<Input name="flat" inputMode="numeric" defaultValue={sheet.flat ?? ""} className={`${FIELD} mt-1`} /></label><label className="text-xs text-muted-foreground">Bonus $<Input name="bonus" inputMode="numeric" defaultValue={sheet.bonus ?? ""} className={`${FIELD} mt-1`} /></label><label className="text-xs text-muted-foreground">Bonus ends<Input name="bonusEnds" type="date" className={`${FIELD} mt-1`} /></label></div>
      <Input name="note" maxLength={400} placeholder="Where this came from (optional)" className={FIELD} />
      <Button type="submit" disabled={confirmPay.isPending} className={`w-full ${GOLD_BUTTON}`}>Save, confirmed today</Button>
    </form></Sheet>}

    {sheet?.kind === "verified" && <Sheet title="What did the property confirm?" onClose={() => setSheet(null)}><form className="space-y-3" onSubmit={(event) => { const data = form(event); recordVerified.mutate({ leaseId: sheet.leaseId, verifiedAmount: Math.round(numberOrNull(data, "amount") ?? 0) }); }}>
      <p className="text-sm text-muted-foreground">Enter the commission the property confirmed in writing. The invoice bills this amount, not our estimate ({aptMoney(sheet.expected)}).</p>
      <Input name="amount" required inputMode="numeric" placeholder="Confirmed commission $" className={FIELD} />
      <Button type="submit" disabled={recordVerified.isPending} className={`w-full ${GOLD_BUTTON}`}>Save the confirmed amount</Button>
    </form></Sheet>}

    {sheet?.kind === "paid" && <Sheet title="Payment received" onClose={() => setSheet(null)}><form className="space-y-3" onSubmit={(event) => { const data = form(event); markPaid.mutate({ leaseId: sheet.leaseId, paidAmount: Math.round(numberOrNull(data, "amount") ?? 0) }); }}>
      <Input name="amount" required inputMode="numeric" defaultValue={sheet.amount || ""} placeholder="Amount received $" className={FIELD} />
      <Button type="submit" disabled={markPaid.isPending} className={`w-full ${GOLD_BUTTON}`}>Mark paid</Button>
    </form></Sheet>}

    {sheet?.kind === "letter" && <Sheet title={sheet.title} onClose={() => setSheet(null)}><LetterView letter={sheet.letter} agentEmail={agentEmail} sentLabel={sheet.sentLabel} onSent={sheet.onSent} sms={sheet.sms} /></Sheet>}
  </main>;
}
