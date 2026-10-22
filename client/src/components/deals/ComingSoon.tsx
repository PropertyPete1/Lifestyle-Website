import { CalendarClock } from "lucide-react";
import { SITE } from "@shared/site";

/** One community a builder lists as coming soon: the area and a price band only, never a name or address. */
export type ComingSoonItem = { key: string; area: string; fromPriceLabel: string | null };

/** Where the section's button goes: the unlock on the landing page, a text to the buyer's agent (or the team) on the list. */
export type ComingSoonAction = { kind: "unlock"; onClick: () => void } | { kind: "text"; phone: string | null; name: string | null };

export const COMING_SOON_COPY = {
  eyebrow: "Coming soon",
  title: "New communities opening around San Antonio",
  body: "The builders have not released homes here yet. Reach out and we will walk you through what is coming and put you first in line when they open.",
  unlock: "Get first pick when they open",
  noPrice: "Pricing not released yet",
} as const;

function smsHref(phone: string, body: string): string {
  return `sms:${phone.replace(/[^\d+]/g, "")}?body=${encodeURIComponent(body)}`;
}

export function ComingSoonSection({ items, action }: { items: readonly ComingSoonItem[] | undefined; action: ComingSoonAction }) {
  if (!items?.length) return null;
  const phone = action.kind === "text" ? action.phone ?? SITE.phone : null;
  const textLabel = action.kind === "text" ? `Text ${action.name ?? "us"} about these` : null;
  return <section data-deals-coming-soon="true" aria-labelledby="deals-coming-soon-title" className="mt-16 border-t border-border pt-10">
    <p className="eyebrow text-gold">{COMING_SOON_COPY.eyebrow}</p>
    <h2 id="deals-coming-soon-title" className="mt-2 text-3xl leading-tight sm:text-4xl">{COMING_SOON_COPY.title}</h2>
    <p className="mt-3 max-w-2xl text-sm text-muted-foreground">{COMING_SOON_COPY.body}</p>
    <ul className="mt-6 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => <li key={item.key} data-deals-coming-soon-item="true" className="flex min-w-0 items-start gap-3 border border-border bg-card p-4">
        <CalendarClock aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
        <div className="min-w-0">
          <p className="truncate font-serif text-xl leading-tight">{item.area}</p>
          <p className="mt-1 text-xs uppercase tracking-[0.14em] text-gold">New community · Coming soon</p>
          <p className="mt-1 text-sm text-muted-foreground">{item.fromPriceLabel ?? COMING_SOON_COPY.noPrice}</p>
        </div>
      </li>)}
    </ul>
    {action.kind === "unlock"
      ? <button type="button" onClick={action.onClick} className="mt-6 min-h-12 w-full bg-gold px-6 text-sm font-medium uppercase tracking-[0.14em] text-primary-foreground sm:w-auto">{COMING_SOON_COPY.unlock}</button>
      : <a href={smsHref(phone!, "I'd like first pick on the coming-soon communities.")} className="mt-6 inline-flex min-h-12 w-full items-center justify-center bg-gold px-6 text-sm font-medium uppercase tracking-[0.14em] text-primary-foreground sm:w-auto">{textLabel}</a>}
  </section>;
}
