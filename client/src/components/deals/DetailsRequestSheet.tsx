import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { DEALS_DETAILS_CONSENT_TEXT } from "@shared/deals";
import { formatPhoneInput } from "./shared";

/**
 * Oct 31, 2026 (Peter: "just get name number email required fields and notes if they wanna add notes and done"):
 * "Get this home's details" on the public pages. No text code: the request goes straight to Follow Up Boss and an
 * agent texts the address, builder and community. Nothing private is shown here.
 */
export type DetailsContext = {
  key?: string;
  area?: string;
  price?: number | null;
  beds?: string | number | null;
  sqft?: number | null;
  kind?: string;
};

export const DETAILS_COPY = {
  eyebrow: "Builder Deals",
  heading: "Get this home's details",
  intro: "An agent will text you the address, builder and community, usually within 30 minutes.",
  name: "Full name",
  phone: "Mobile number",
  email: "Email",
  notes: "Notes (optional)",
  notesPlaceholder: "Timeline, must-haves, questions…",
  submit: "Send me the details",
  sending: "Sending…",
  done: (first: string) => `Got it${first ? `, ${first}` : ""}!`,
  doneBody: "An agent will text you this home's address and details shortly.",
  back: "Back to the homes",
} as const;

/** The consent shown under the button (the sign-up's own wording, for this button). */
export const DETAILS_CONSENT = DEALS_DETAILS_CONSENT_TEXT;

const money = (value: number) => `$${value.toLocaleString("en-US")}`;

/** "3 beds · 1,800 sq ft · $329,990 · East San Antonio" for the sheet's summary line. */
export function detailsSummary(context: DetailsContext | null | undefined): string | null {
  if (!context) return null;
  const beds = context.beds !== null && context.beds !== undefined && String(context.beds).trim() ? `${context.beds} beds` : null;
  const parts = [beds, context.sqft ? `${context.sqft.toLocaleString("en-US")} sq ft` : null, context.price ? money(context.price) : null, context.area ?? null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** Light checks before sending; the server checks again. */
export function detailsProblem(form: { name: string; phone: string; email: string }): string | null {
  if (form.name.trim().length < 2) return "Enter your name.";
  if (form.phone.replace(/\D/g, "").length < 10) return "Enter your mobile number.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return "Enter a valid email.";
  return null;
}

export type DetailsForm = { name: string; phone: string; email: string; notes: string };

export function DetailsRequestSheet({ context, agentSlug, onClose }: { context: DetailsContext | null; agentSlug?: string | null; onClose: () => void }) {
  const [form, setForm] = useState<DetailsForm>({ name: "", phone: "", email: "", notes: "" });
  const [problem, setProblem] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const send = trpc.deals.requestDetails.useMutation({
    onSuccess: (result) => { if (result.ok) setSentTo(result.firstName); else setProblem(result.message); },
    onError: (error) => setProblem(error.message || "Something went wrong. Please try again."),
  });
  const submit = () => {
    if (send.isPending) return;
    const issue = detailsProblem(form);
    setProblem(issue);
    if (issue) return;
    const src = new URLSearchParams(window.location.search).get("src")?.trim().slice(0, 40) || undefined;
    const home = context ? {
      key: context.key && /^[a-f0-9]{12}$/.test(context.key) ? context.key : undefined,
      area: context.area?.slice(0, 120),
      price: typeof context.price === "number" && context.price > 0 ? Math.round(context.price) : null,
      beds: context.beds ?? null,
      sqft: typeof context.sqft === "number" && context.sqft > 0 ? Math.round(context.sqft) : null,
      kind: context.kind?.slice(0, 40),
    } : undefined;
    send.mutate({ name: form.name.trim(), phone: form.phone, email: form.email.trim(), notes: form.notes.trim() || undefined, home, src, a: agentSlug ?? undefined, consent: true });
  };
  return <DetailsRequestView summary={detailsSummary(context)} form={form} onChange={(next) => setForm((current) => ({ ...current, ...next }))} problem={problem} sending={send.isPending} sentTo={sentTo} onSubmit={submit} onClose={onClose} />;
}

/** The sheet itself, without the request (the QA harness renders it on its own). */
export function DetailsRequestView({ summary, form, onChange, problem, sending, sentTo, onSubmit, onClose }: { summary: string | null; form: DetailsForm; onChange: (next: Partial<DetailsForm>) => void; problem: string | null; sending: boolean; sentTo: string | null; onSubmit: () => void; onClose: () => void }) {
  return <AnimatePresence><motion.div className="fixed inset-0 z-[100] flex items-end bg-black/70 backdrop-blur-sm sm:items-center sm:justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <motion.section id="unlock" role="dialog" aria-modal="true" aria-labelledby="deals-details-title" data-deals-details-sheet="true" className="relative max-h-[92dvh] w-full min-w-0 overflow-y-auto overflow-x-hidden border-t border-gold/40 bg-card px-5 pb-7 pt-6 shadow-2xl sm:max-w-lg sm:border sm:px-8" initial={{ y: 36 }} animate={{ y: 0 }} exit={{ y: 36 }} transition={{ duration: 0.22 }}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-gold"><X className="h-4 w-4" /></button>
      {sentTo !== null
        ? <div role="status" data-deals-details-done="true" className="flex flex-col items-center py-10 text-center">
          <CheckCircle2 className="h-11 w-11 text-gold" aria-hidden="true" />
          <h2 id="deals-details-title" className="mt-4 text-3xl leading-tight">{DETAILS_COPY.done(sentTo)}</h2>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">{DETAILS_COPY.doneBody}</p>
          <Button type="button" onClick={onClose} className="mt-8 w-full bg-gold py-6 text-primary-foreground">{DETAILS_COPY.back}</Button>
        </div>
        : <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }} noValidate>
          <p className="eyebrow text-gold">{DETAILS_COPY.eyebrow}</p>
          <h2 id="deals-details-title" className="mt-2 text-3xl leading-tight">{DETAILS_COPY.heading}</h2>
          {summary && <p data-deals-details-home="true" className="mt-2 text-sm font-medium text-foreground">{summary}</p>}
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{DETAILS_COPY.intro}</p>
          <div className="mt-5 grid gap-3">
            <div><Label htmlFor="details-name" className="text-xs uppercase tracking-widest">{DETAILS_COPY.name} *</Label><Input id="details-name" autoComplete="name" required value={form.name} onChange={(event) => onChange({ name: event.target.value })} className="mt-1 min-h-11" /></div>
            <div><Label htmlFor="details-phone" className="text-xs uppercase tracking-widest">{DETAILS_COPY.phone} *</Label><Input id="details-phone" type="tel" inputMode="tel" autoComplete="tel" required value={form.phone} onChange={(event) => onChange({ phone: formatPhoneInput(event.target.value) })} className="mt-1 min-h-11" /></div>
            <div><Label htmlFor="details-email" className="text-xs uppercase tracking-widest">{DETAILS_COPY.email} *</Label><Input id="details-email" type="email" inputMode="email" autoComplete="email" required value={form.email} onChange={(event) => onChange({ email: event.target.value })} className="mt-1 min-h-11" /></div>
            <div><Label htmlFor="details-notes" className="text-xs uppercase tracking-widest">{DETAILS_COPY.notes}</Label><Textarea id="details-notes" rows={3} maxLength={1000} value={form.notes} placeholder={DETAILS_COPY.notesPlaceholder} onChange={(event) => onChange({ notes: event.target.value })} className="mt-1" /></div>
          </div>
          {problem && <p role="alert" data-deals-details-problem="true" className="mt-3 text-sm text-destructive">{problem}</p>}
          <Button type="submit" disabled={sending} data-deals-details-submit="true" className="mt-5 w-full bg-gold py-6 text-base text-primary-foreground">{sending ? DETAILS_COPY.sending : DETAILS_COPY.submit}</Button>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{DETAILS_CONSENT}</p>
        </form>}
    </motion.section>
  </motion.div></AnimatePresence>;
}
