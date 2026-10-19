import { useState } from "react";
import { Copy, Heart, Link2, MessageSquareText, Send, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatPhoneInput, money } from "./shared";

/** deals.team.workspace as the tools need it. Phones arrive masked; the link path carries the token. */
export type AgentClient = {
  id: number;
  clientName: string;
  clientPhone: string | null;
  /** National digits for the Text it link; null when the agent typed no number. */
  clientPhoneDigits?: string | null;
  note: string | null;
  path: string;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
  openedAt: string | null;
  openCount: number;
  verifiedAt: string | null;
  accessExpiresAt: string | null;
  lastViewedAt: string | null;
  saves: Array<{ card: string; description: string; price: number | null; communityLabel: string; savedAt: string }>;
  requests: Array<{ kind: "tour" | "ask"; description: string; preferredAt: string; createdAt: string }>;
};
export type AgentWorkspaceData = { agent: { name: string; email: string | null; fubLinked: boolean }; clients: AgentClient[] };
export type NewClientLink = { id: number; path: string; expiresAt: string };
export type CreateClientInput = { clientName: string; clientPhone?: string; note?: string };

export const AGENT_COPY = {
  heading: "Send homes to a client",
  intro: "Your client gets this list with every address, photo and incentive. They verify their own mobile number once, and you hear about it when they save a home or ask for a tour.",
  created: "Link ready. Text it or copy it.",
  copied: "Link copied.",
  noClients: "No client links yet. Send your first one above.",
  notOpened: "Not opened yet",
  opened: "Opened",
  verified: "Verified",
  revoked: "Link turned off",
  expired: "Link expired",
} as const;

export function absoluteLink(path: string, origin = typeof window === "undefined" ? "" : window.location.origin) {
  return `${origin}${path}`;
}

/** The suggested text message; the client's first name and the agent's name make it personal without any private home data. */
export function clientMessage(input: { clientName: string; agentName: string; url: string }) {
  const first = input.clientName.trim().split(/\s+/)[0] || "there";
  return `Hi ${first}, here are the new-build homes I picked for you, with the current builder incentives. Open the link and verify your mobile number once: ${input.url} - ${input.agentName}`;
}

/** iOS wants "sms:number&body=", Android "sms:number?body="; "?&body=" is read by both. */
export function smsHref(body: string, phoneDigits?: string | null) {
  return `sms:${phoneDigits ? `+1${phoneDigits}` : ""}?&body=${encodeURIComponent(body)}`;
}

function when(value: string | null | undefined) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }).format(new Date(value));
}

export function clientStatus(client: AgentClient, now = Date.now()): { label: string; tone: "muted" | "gold" | "live" } {
  if (client.revoked) return { label: AGENT_COPY.revoked, tone: "muted" };
  if (client.verifiedAt) return { label: `${AGENT_COPY.verified} ${when(client.verifiedAt)}${client.accessExpiresAt ? ` · list open until ${when(client.accessExpiresAt)}` : " · access expired, the same link renews it"}`, tone: "live" };
  if (new Date(client.expiresAt).getTime() <= now) return { label: AGENT_COPY.expired, tone: "muted" };
  if (client.openedAt) return { label: `${AGENT_COPY.opened} ${when(client.openedAt)}, not verified yet`, tone: "gold" };
  return { label: AGENT_COPY.notOpened, tone: "muted" };
}

export type AgentToolsProps = {
  workspace: AgentWorkspaceData | undefined;
  loading?: boolean;
  error?: string | null;
  created?: NewClientLink | null;
  creating?: boolean;
  createError?: string | null;
  onCreate: (input: CreateClientInput) => void;
  onRevoke: (id: number) => void;
  onCopy: (url: string) => void;
  copiedUrl?: string | null;
  /** Fixed origin for static rendering and tests. */
  origin?: string;
};

export function AgentTools({ workspace, loading, error, created, creating, createError, onCreate, onRevoke, onCopy, copiedUrl, origin }: AgentToolsProps) {
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [note, setNote] = useState("");
  const [lastSent, setLastSent] = useState<{ clientName: string; clientPhone: string } | null>(null);
  const agentName = workspace?.agent.name ?? "Lifestyle Design Realty";
  const createdUrl = created ? absoluteLink(created.path, origin) : null;
  const submit = () => {
    const name = clientName.trim();
    if (name.length < 2) return;
    setLastSent({ clientName: name, clientPhone });
    onCreate({ clientName: name, clientPhone: clientPhone.trim() || undefined, note: note.trim() || undefined });
    setClientName(""); setClientPhone(""); setNote("");
  };
  return <section aria-labelledby="deals-agent-tools" data-deals-agent-tools="true" className="mt-8 space-y-8">
    <div className="border border-gold/30 bg-gold/5 p-5">
      <p className="eyebrow text-gold">Agent tools · {agentName}</p>
      <h2 id="deals-agent-tools" className="mt-2 text-3xl">{AGENT_COPY.heading}</h2>
      <p className="mt-3 text-sm text-muted-foreground">{AGENT_COPY.intro}</p>
      {workspace && !workspace.agent.fubLinked && <p role="status" className="mt-3 text-xs text-gold">Your number is on the team list without a Follow Up Boss user, so your clients' contacts and tasks go to Peter in FUB until it is linked. Emails still reach you{workspace.agent.email ? ` at ${workspace.agent.email}` : ""}.</p>}
      <div className="mt-5 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
        <div><Label htmlFor="deals-client-name" className="text-xs uppercase tracking-widest">Client name</Label><Input id="deals-client-name" value={clientName} maxLength={190} onChange={(event) => setClientName(event.target.value)} placeholder="Maria Lopez" className="mt-2 min-h-11" /></div>
        <div><Label htmlFor="deals-client-phone" className="text-xs uppercase tracking-widest">Client mobile (optional)</Label><Input id="deals-client-phone" type="tel" inputMode="tel" value={clientPhone} onChange={(event) => setClientPhone(formatPhoneInput(event.target.value))} placeholder="(210) 555-0123" className="mt-2 min-h-11" /></div>
        <div><Label htmlFor="deals-client-note" className="text-xs uppercase tracking-widest">Private note (optional)</Label><Input id="deals-client-note" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="Pre-approved, wants 4 beds" className="mt-2 min-h-11" /></div>
      </div>
      <Button type="button" disabled={creating || clientName.trim().length < 2} onClick={submit} className="mt-4 min-h-11 w-full bg-gold text-primary-foreground sm:w-auto"><Link2 className="mr-2 h-4 w-4" />{creating ? "Creating link…" : "Create client link"}</Button>
      {createError && <p role="alert" className="mt-3 text-sm text-destructive">{createError}</p>}
      {createdUrl && lastSent && <div className="mt-5 border border-gold/40 bg-background/60 p-4" data-deals-created-link="true">
        <p role="status" className="text-sm text-gold">{AGENT_COPY.created}</p>
        <p className="mt-2 break-all text-xs text-muted-foreground">{createdUrl}</p>
        <p className="mt-3 text-sm text-foreground">{clientMessage({ clientName: lastSent.clientName, agentName, url: createdUrl })}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a href={smsHref(clientMessage({ clientName: lastSent.clientName, agentName, url: createdUrl }), lastSent.clientPhone.replace(/\D/g, "") || null)} className="inline-flex min-h-11 items-center gap-2 bg-gold px-4 text-sm text-primary-foreground"><MessageSquareText className="h-4 w-4" /> Text it</a>
          <Button type="button" variant="outline" onClick={() => onCopy(createdUrl)} className="min-h-11"><Copy className="mr-2 h-4 w-4" />{copiedUrl === createdUrl ? AGENT_COPY.copied : "Copy link"}</Button>
        </div>
      </div>}
    </div>

    <div>
      <p className="eyebrow text-gold">Your clients</p>
      {loading && <p className="mt-3 text-sm text-muted-foreground">Loading your clients…</p>}
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      {workspace && workspace.clients.length === 0 && <p className="mt-3 text-sm text-muted-foreground">{AGENT_COPY.noClients}</p>}
      <div className="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">{(workspace?.clients ?? []).map((client) => {
        const status = clientStatus(client);
        const url = absoluteLink(client.path, origin);
        return <article key={client.id} data-deals-client="true" className="min-w-0 border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-3"><div><h3 className="text-2xl">{client.clientName}</h3><p className="mt-1 text-xs text-muted-foreground">{[client.clientPhone, `sent ${when(client.createdAt)}`].filter(Boolean).join(" · ")}</p></div>{!client.revoked && <button type="button" onClick={() => onRevoke(client.id)} aria-label={`Turn off the link for ${client.clientName}`} className="flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-destructive"><X className="h-4 w-4" /></button>}</div>
          <p className={`mt-3 text-xs uppercase tracking-widest ${status.tone === "live" ? "text-emerald-400" : status.tone === "gold" ? "text-gold" : "text-muted-foreground"}`}>{status.label}</p>
          {client.note && <p className="mt-2 text-sm text-muted-foreground">Note: {client.note}</p>}
          {client.lastViewedAt && <p className="mt-2 text-xs text-muted-foreground">Last looked at the list {when(client.lastViewedAt)}</p>}
          {client.saves.length > 0 && <div className="mt-4"><p className="text-xs uppercase tracking-widest text-gold"><Heart className="mr-1 inline h-3.5 w-3.5 fill-current" />Saved homes</p><ul className="mt-2 space-y-1 text-sm">{client.saves.map((save) => <li key={`${save.card}-${save.savedAt}`}>{save.description}{save.price ? ` · ${money.format(save.price)}` : ""}{save.communityLabel ? ` · ${save.communityLabel}` : ""} <span className="text-xs text-muted-foreground">{when(save.savedAt)}</span></li>)}</ul></div>}
          {client.requests.length > 0 && <div className="mt-4"><p className="text-xs uppercase tracking-widest text-gold"><Send className="mr-1 inline h-3.5 w-3.5" />Tour and question requests</p><ul className="mt-2 space-y-1 text-sm">{client.requests.map((request) => <li key={`${request.kind}-${request.createdAt}`}>{request.kind === "tour" ? "Tour" : "Question"}: {request.description} <span className="text-xs text-muted-foreground">preferred {when(request.preferredAt)}</span></li>)}</ul></div>}
          {!client.revoked && <div className="mt-5 flex flex-wrap gap-3">
            <a href={smsHref(clientMessage({ clientName: client.clientName, agentName, url }), client.clientPhoneDigits ?? null)} className="inline-flex min-h-11 items-center gap-2 border border-border px-4 text-sm hover:border-gold hover:text-gold"><MessageSquareText className="h-4 w-4" /> Text it</a>
            <Button type="button" variant="outline" onClick={() => onCopy(url)} className="min-h-11"><Copy className="mr-2 h-4 w-4" />{copiedUrl === url ? AGENT_COPY.copied : "Copy link"}</Button>
          </div>}
        </article>;
      })}</div>
    </div>
  </section>;
}
