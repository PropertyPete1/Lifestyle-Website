import { useEffect, useState } from "react";
import { Check, ChevronDown, Copy, Heart, Link2, ListChecks, Mail, MessageSquareText, Send, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatPhoneInput, money } from "./shared";

/** deals.team.workspace as the tools need it. The link path carries the token. */
export type AgentClient = {
  id: number;
  clientName: string;
  clientPhone: string | null;
  /** National digits for the Text it link; null when no number is known. */
  clientPhoneDigits?: string | null;
  note: string | null;
  path: string;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
  openedAt: string | null;
  openCount: number;
  verifiedAt: string | null;
  /** The client moved to another agent's link; their activity is no longer shown here. */
  movedAway?: boolean;
  accessExpiresAt: string | null;
  lastViewedAt: string | null;
  /** When "Text it" was last tapped for this link. */
  lastTextedAt?: string | null;
  saves: Array<{ card: string; description: string; price: number | null; communityLabel: string; savedAt: string }>;
  requests: Array<{ kind: "tour" | "ask"; description: string; preferredAt: string; createdAt: string }>;
  /** Oct 26, 2026: the homes the agent picked for this client, in their order. */
  picks?: Array<{ card: string; description: string; price: number | null; communityLabel: string }>;
};
export type AgentWorkspaceData = { agent: { name: string; email: string | null; fubLinked: boolean }; clients: AgentClient[] };
export type NewClientLink = { id: number; path: string; expiresAt: string; clientName?: string; clientPhoneDigits?: string | null; pickCount?: number };
export type CreateClientInput = { clientName: string; clientPhone?: string; note?: string; picks?: string[] };
/** deals.team.textClientLink: the message the phone sends and where; how FUB took the record. */
export type TextClientResult = { ok: true; message: string; smsTo: string; fub: "logged" | "recorded_no_timeline" | "unavailable" | "skipped"; repeat: boolean };
export const TEXT_MAX_CHARS = 320;

export const AGENT_COPY = {
  heading: "Send the list to a client",
  intro: "Your client gets this week's full list: every address, photo and current incentive. They verify their own mobile number once, and you hear about it when they save a home or ask for a tour. Each link works for one client; add their mobile so nobody else can use it.",
  created: "Link ready. Text it or copy it.",
  copied: "Link copied.",
  noClients: "No client links yet. Send your first one above.",
  /** Oct 27, 2026 (Peter: "too much to say", "adding a number is a waste"): one line, name only; the rest folds away. */
  short: "Type a name, get a private link to text or email. Picks you tap go on it.",
  more: "Lock to their mobile · add a note",
  less: "Hide mobile and note",
  phoneHint: "Optional. Only that number can open the link, and their saves land on the right FUB contact.",
  clients: (count: number) => `Your clients (${count})`,
  notOpened: "Not opened yet",
  opened: "Opened",
  verified: "Verified",
  revoked: "Link turned off",
  expired: "Link expired before they used it",
  movedAway: "Now connected through another agent's link",
  textTitle: "Text the link",
  textIntro: "Your phone sends this text. The client is added to Follow Up Boss under you, and the text is logged on their timeline.",
  textSend: "Open Messages",
  textCancel: "Cancel",
  textedAgain: "Already texted in the last few minutes; opening Messages again without a second log.",
  textedFubDown: "Follow Up Boss didn't answer, so this send isn't logged there. Messages still opened.",
  texted: (name: string) => `Logged in Follow Up Boss. Send the text to ${name} in Messages.`,
  confirmRevoke: "Turn off this link? Your client keeps the standard list but loses the addresses, and the link stops working. This can't be undone; you can send a new link.",
  /** Picks: tap "Pick for client" on homes in the list, then send them with a new link or put them on an existing client's link. */
  picksOnNew: (count: number) => `${count} picked home${count === 1 ? "" : "s"} will lead this client's list.`,
  picksNone: "Tap \"Pick for client\" on any homes below to send a short list instead of the whole market.",
  picksOnLink: (count: number) => `Put ${count} pick${count === 1 ? "" : "s"} on this list`,
  picksPut: (count: number, name: string) => `${count} pick${count === 1 ? "" : "s"} now lead ${name}'s list. Text them the link.`,
  picksClear: "Clear picks",
  picksFor: "Picked for them",
} as const;

export function absoluteLink(path: string, origin = typeof window === "undefined" ? "" : window.location.origin) {
  return `${origin}${path}`;
}

/** The suggested text message; the client's first name and the agent's name make it personal without any private home data. */
export function clientMessage(input: { clientName: string; agentName: string; url: string; pickCount?: number }) {
  const first = input.clientName.trim().split(/\s+/)[0] || "there";
  const agentFirst = input.agentName.trim().split(/\s+/)[0] || input.agentName;
  // The same wording as the server's default (clientLinkTextMessage), so the preview matches what gets logged.
  if (input.pickCount && input.pickCount > 0) return `Hi ${first}, I picked ${input.pickCount} new-build home${input.pickCount === 1 ? "" : "s"} for you at Lifestyle Design Realty. Photos, prices and this week's incentives: ${input.url}. Text me with questions.`;
  return `Hi ${first}, here's your private list of new-build deals from ${agentFirst} at Lifestyle Design Realty: ${input.url}. Tap any home for photos and pricing. Text me with questions.`;
}

/** Oct 27, 2026 (Peter: send clients the list by email too): the agent's mail app opens with the message; they add the address. */
export function mailtoHref(input: { clientName: string; agentName: string; url: string; pickCount?: number }) {
  const subject = input.pickCount && input.pickCount > 0 ? `${input.pickCount} new-build home${input.pickCount === 1 ? "" : "s"} I picked for you` : "Your private list of new-build deals";
  const body = `${clientMessage(input)}\n\n${input.agentName}\nLifestyle Design Realty`;
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** iOS wants "sms:number&body=", Android "sms:number?body="; "?&body=" is read by both. */
export function smsHref(body: string, phoneDigits?: string | null) {
  const digits = phoneDigits?.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "") ?? "";
  return `sms:${digits.length === 10 ? `+1${digits}` : ""}?&body=${encodeURIComponent(body)}`;
}

function when(value: string | null | undefined) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }).format(new Date(value));
}

/** An unused link past its date can no longer be sent; a client's own link never lapses. */
export function linkSendable(client: AgentClient, now = Date.now()) {
  if (client.revoked || client.movedAway) return false;
  return Boolean(client.verifiedAt) || new Date(client.expiresAt).getTime() > now;
}

export function clientStatus(client: AgentClient, now = Date.now()): { label: string; tone: "muted" | "gold" | "live" } {
  if (client.revoked) return { label: AGENT_COPY.revoked, tone: "muted" };
  if (client.movedAway) return { label: AGENT_COPY.movedAway, tone: "muted" };
  if (client.verifiedAt) return { label: `${AGENT_COPY.verified} ${when(client.verifiedAt)}${client.accessExpiresAt ? ` · list open until ${when(client.accessExpiresAt)}` : " · access lapsed, the same link renews it"}`, tone: "live" };
  if (new Date(client.expiresAt).getTime() <= now) return { label: AGENT_COPY.expired, tone: "muted" };
  if (client.openedAt) return { label: `${AGENT_COPY.opened} ${when(client.openedAt)}, not verified yet`, tone: "gold" };
  return { label: AGENT_COPY.notOpened, tone: "muted" };
}

/** Turning a link off is permanent, so it always asks first. */
export function confirmAndRevoke(client: Pick<AgentClient, "id" | "clientName">, ask: (message: string) => boolean, onRevoke: (id: number) => void) {
  if (ask(`${client.clientName}: ${AGENT_COPY.confirmRevoke}`)) { onRevoke(client.id); return true; }
  return false;
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
  /** "Text it": logs the send in FUB, then resolves with the message to put in the phone's Messages app. */
  onText?: (input: { id: number; message: string }) => Promise<TextClientResult>;
  texting?: boolean;
  /** Fixed origin for static rendering and tests. */
  origin?: string;
  /** Test seam for the turn-off confirmation; the browser uses window.confirm. */
  confirm?: (message: string) => boolean;
  /** The card handles picked on the list right now (team view); they go on the next link, or onto an existing one. */
  picked?: readonly string[];
  onClearPicks?: () => void;
  /** Puts the current picks on one of the agent's links; resolves with how many stuck. */
  onSetPicks?: (input: { id: number; picks: string[] }) => Promise<{ pickCount: number }>;
  settingPicks?: boolean;
};

export function AgentTools({ workspace, loading, error, created, creating, createError, onCreate, onRevoke, onCopy, copiedUrl, origin, confirm, onText, texting, picked = [], onClearPicks, onSetPicks, settingPicks }: AgentToolsProps) {
  const [clientName, setClientName] = useState("");
  const [putNote, setPutNote] = useState<{ id: number; text: string } | null>(null);
  const putPicks = async (client: AgentClient) => {
    if (!onSetPicks || picked.length === 0) return;
    try {
      const result = await onSetPicks({ id: client.id, picks: Array.from(picked) });
      setPutNote({ id: client.id, text: AGENT_COPY.picksPut(result.pickCount, client.clientName.split(/\s+/)[0] || client.clientName) });
    } catch (caught) {
      setPutNote({ id: client.id, text: caught instanceof Error ? caught.message : "Could not put the picks on this link." });
    }
  };
  // The "Text it" sheet: which link, the editable message, and what the server said after logging it.
  const [textFor, setTextFor] = useState<{ id: number; name: string; phoneDigits: string | null } | null>(null);
  const [textBody, setTextBody] = useState("");
  const [textNote, setTextNote] = useState<string | null>(null);
  const openText = (client: { id: number; clientName: string; clientPhoneDigits?: string | null }, message: string) => { setTextFor({ id: client.id, name: client.clientName, phoneDigits: client.clientPhoneDigits ?? null }); setTextBody(message); setTextNote(null); };
  const sendText = async () => {
    if (!textFor) return;
    if (!onText) { window.location.href = smsHref(textBody, textFor.phoneDigits); setTextFor(null); return; }
    try {
      const result = await onText({ id: textFor.id, message: textBody });
      setTextNote(result.repeat ? AGENT_COPY.textedAgain : result.fub === "unavailable" ? AGENT_COPY.textedFubDown : AGENT_COPY.texted(textFor.name));
      window.location.href = smsHref(result.message, textFor.phoneDigits);
    } catch (caught) {
      setTextNote(caught instanceof Error ? caught.message : "Could not log the text.");
    }
  };
  const [clientPhone, setClientPhone] = useState("");
  const [showMore, setShowMore] = useState(false);
  // Open: a client's saves and tour requests are the agent's to-do list. One tap folds it away to get to the homes.
  const [clientsOpen, setClientsOpen] = useState(true);
  const [note, setNote] = useState("");
  const agentName = workspace?.agent.name ?? "Lifestyle Design Realty";
  const createdUrl = created ? absoluteLink(created.path, origin) : null;
  // The form clears only once the server accepted the link, so a rejected phone keeps what the agent typed.
  useEffect(() => { if (created?.id) { setClientName(""); setClientPhone(""); setNote(""); } }, [created?.id]);
  const submit = () => {
    const name = clientName.trim();
    if (name.length < 2) return;
    onCreate({ clientName: name, clientPhone: clientPhone.trim() || undefined, note: note.trim() || undefined, picks: picked.length ? Array.from(picked) : undefined });
  };
  const revoke = (client: AgentClient) => { confirmAndRevoke(client, confirm ?? ((message: string) => window.confirm(message)), onRevoke); };
  const createdMessage = createdUrl && created ? clientMessage({ clientName: created.clientName ?? "", agentName, url: createdUrl, pickCount: created.pickCount }) : null;
  return <section aria-labelledby="deals-agent-tools" data-deals-agent-tools="true" className="mt-5 min-w-0 space-y-4">
    <div className="min-w-0 border border-gold/30 bg-gold/5 p-4">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><h2 id="deals-agent-tools" className="text-xl">{AGENT_COPY.heading}</h2><p className="text-xs text-muted-foreground"><span className="uppercase tracking-widest text-gold">Agent tools · {agentName}</span> · {AGENT_COPY.short}</p></div>
      {workspace && !workspace.agent.fubLinked && <p role="status" className="mt-2 text-xs text-gold">Your number is on the team list without a Follow Up Boss user, so your clients' contacts and tasks go to Peter in FUB until it is linked. Emails still reach you{workspace.agent.email ? ` at ${workspace.agent.email}` : ""}.</p>}
      <form className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <Label htmlFor="deals-client-name" className="sr-only">Client name</Label>
        <Input id="deals-client-name" value={clientName} maxLength={190} onChange={(event) => setClientName(event.target.value)} placeholder="Client name" autoComplete="off" className="min-h-11 min-w-0 flex-1 bg-background" />
        <Button type="submit" disabled={creating || clientName.trim().length < 2} className="min-h-11 shrink-0 bg-gold text-primary-foreground"><Link2 className="mr-2 h-4 w-4" />{creating ? "Creating link…" : picked.length ? `Create link with ${picked.length} pick${picked.length === 1 ? "" : "s"}` : "Create client link"}</Button>
      </form>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <button type="button" onClick={() => setShowMore((value) => !value)} aria-expanded={showMore} data-deals-more-fields="true" className="min-h-11 text-muted-foreground underline-offset-4 hover:text-gold hover:underline">{showMore ? AGENT_COPY.less : AGENT_COPY.more}</button>
        {onSetPicks && <span role="status" data-deals-picks-note={picked.length ? "some" : "none"} className={`flex flex-wrap items-center gap-x-3 ${picked.length ? "text-foreground" : "text-muted-foreground"}`}><ListChecks className="h-4 w-4 shrink-0 text-gold" />{picked.length ? AGENT_COPY.picksOnNew(picked.length) : AGENT_COPY.picksNone}{picked.length > 0 && onClearPicks && <button type="button" onClick={onClearPicks} className="min-h-11 uppercase tracking-widest text-gold hover:underline">Clear picks</button>}</span>}
      </div>
      {showMore && <div className="mt-1 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
        <div className="min-w-0"><Label htmlFor="deals-client-phone" className="text-xs uppercase tracking-widest">Client mobile</Label><Input id="deals-client-phone" type="tel" inputMode="tel" value={clientPhone} onChange={(event) => setClientPhone(formatPhoneInput(event.target.value))} placeholder="(210) 555-0123" className="mt-1 min-h-11 bg-background" /><p className="mt-1 text-[11px] text-muted-foreground">{AGENT_COPY.phoneHint}</p></div>
        <div className="min-w-0"><Label htmlFor="deals-client-note" className="text-xs uppercase tracking-widest">Private note</Label><Input id="deals-client-note" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="Pre-approved, wants 4 beds" className="mt-1 min-h-11 bg-background" /></div>
      </div>}
      {createError && <p role="alert" className="mt-3 text-sm text-destructive">{createError}</p>}
      {createdUrl && createdMessage && created && <div className="mt-5 min-w-0 border border-gold/40 bg-background/60 p-4" data-deals-created-link="true">
        <p role="status" className="text-sm text-gold">{AGENT_COPY.created}</p>
        <p className="mt-2 break-all text-xs text-muted-foreground">{createdUrl}</p>
        <p className="mt-3 text-sm text-foreground [overflow-wrap:anywhere]">{createdMessage}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {created.clientPhoneDigits
            ? <button type="button" data-deals-text-it="true" onClick={() => openText({ id: created.id, clientName: created.clientName ?? "", clientPhoneDigits: created.clientPhoneDigits }, createdMessage)} className="inline-flex min-h-11 items-center gap-2 bg-gold px-4 text-sm text-primary-foreground"><MessageSquareText className="h-4 w-4" /> Text it</button>
            : <a href={smsHref(createdMessage, null)} className="inline-flex min-h-11 items-center gap-2 bg-gold px-4 text-sm text-primary-foreground"><MessageSquareText className="h-4 w-4" /> Text it</a>}
          <a href={mailtoHref({ clientName: created.clientName ?? "", agentName, url: createdUrl, pickCount: created.pickCount })} data-deals-email-it="true" className="inline-flex min-h-11 items-center gap-2 border border-border px-4 text-sm hover:border-gold hover:text-gold"><Mail className="h-4 w-4" /> Email it</a>
          <Button type="button" variant="outline" onClick={() => onCopy(createdUrl)} className="min-h-11"><Copy className="mr-2 h-4 w-4" />{copiedUrl === createdUrl ? AGENT_COPY.copied : "Copy link"}</Button>
        </div>
      </div>}
    </div>

    <div className="min-w-0">
      <button type="button" onClick={() => setClientsOpen((value) => !value)} aria-expanded={clientsOpen} data-deals-clients-toggle="true" className="flex min-h-11 items-center gap-2 text-xs uppercase tracking-widest text-gold"><ChevronDown className={`h-4 w-4 transition-transform ${clientsOpen ? "rotate-180" : ""}`} />{AGENT_COPY.clients(workspace?.clients.length ?? 0)}</button>
      {clientsOpen && <>
      {loading && <p className="mt-3 text-sm text-muted-foreground">Loading your clients…</p>}
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      {workspace && workspace.clients.length === 0 && <p className="mt-3 text-sm text-muted-foreground">{AGENT_COPY.noClients}</p>}
      <div className="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">{(workspace?.clients ?? []).map((client) => {
        const status = clientStatus(client);
        const url = absoluteLink(client.path, origin);
        const sendable = linkSendable(client);
        return <article key={client.id} data-deals-client="true" className="min-w-0 border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words text-2xl">{client.clientName}</h3><p className="mt-1 text-xs text-muted-foreground">{[client.clientPhone, `sent ${when(client.createdAt)}`].filter(Boolean).join(" · ")}</p></div>{!client.revoked && !client.movedAway && <button type="button" onClick={() => revoke(client)} aria-label={`Turn off the link for ${client.clientName}`} className="flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground hover:text-destructive"><X className="h-4 w-4" /></button>}</div>
          <p className={`mt-3 text-xs uppercase tracking-widest ${status.tone === "live" ? "text-emerald-700" : status.tone === "gold" ? "text-gold" : "text-muted-foreground"}`}>{status.label}</p>
          {client.note && <p className="mt-2 break-words text-sm text-muted-foreground">Note: {client.note}</p>}
          {client.lastTextedAt && <p className="mt-2 text-xs text-muted-foreground" data-deals-texted-at="true">Texted {when(client.lastTextedAt)}</p>}
          {(client.picks?.length ?? 0) > 0 && <div className="mt-4" data-deals-client-picks="true"><p className="text-xs uppercase tracking-widest text-gold"><Check className="mr-1 inline h-3.5 w-3.5" />{AGENT_COPY.picksFor} ({client.picks!.length})</p><ul className="mt-2 space-y-1 text-sm">{client.picks!.map((pick) => <li key={pick.card} className="break-words">{pick.description}{pick.price ? ` · ${money.format(pick.price)}` : ""}{pick.communityLabel ? ` · ${pick.communityLabel}` : ""}</li>)}</ul></div>}
          {putNote?.id === client.id && <p role="status" className="mt-3 text-sm text-gold">{putNote.text}</p>}
          {client.lastViewedAt && <p className="mt-2 text-xs text-muted-foreground">Last looked at the list {when(client.lastViewedAt)}</p>}
          {client.saves.length > 0 && <div className="mt-4"><p className="text-xs uppercase tracking-widest text-gold"><Heart className="mr-1 inline h-3.5 w-3.5 fill-current" />Saved homes</p><ul className="mt-2 space-y-1 text-sm">{client.saves.map((save) => <li key={`${save.card}-${save.savedAt}`} className="break-words">{save.description}{save.price ? ` · ${money.format(save.price)}` : ""}{save.communityLabel ? ` · ${save.communityLabel}` : ""} <span className="text-xs text-muted-foreground">{when(save.savedAt)}</span></li>)}</ul></div>}
          {client.requests.length > 0 && <div className="mt-4"><p className="text-xs uppercase tracking-widest text-gold"><Send className="mr-1 inline h-3.5 w-3.5" />Tour and question requests</p><ul className="mt-2 space-y-1 text-sm">{client.requests.map((request) => <li key={`${request.kind}-${request.createdAt}`} className="break-words">{request.kind === "tour" ? "Tour" : "Question"}: {request.description} <span className="text-xs text-muted-foreground">preferred {when(request.preferredAt)}</span></li>)}</ul></div>}
          {sendable && <div className="mt-5 flex flex-wrap gap-3">
            {onSetPicks && picked.length > 0 && <button type="button" data-deals-put-picks="true" disabled={settingPicks} onClick={() => { void putPicks(client); }} className="inline-flex min-h-11 items-center gap-2 bg-gold px-4 text-sm text-primary-foreground disabled:opacity-60"><ListChecks className="h-4 w-4" /> {AGENT_COPY.picksOnLink(picked.length)}</button>}
            {client.clientPhoneDigits
              ? <button type="button" data-deals-text-it="true" onClick={() => openText(client, clientMessage({ clientName: client.clientName, agentName, url, pickCount: client.picks?.length }))} className="inline-flex min-h-11 items-center gap-2 border border-border px-4 text-sm hover:border-gold hover:text-gold"><MessageSquareText className="h-4 w-4" /> {client.lastTextedAt ? "Text it again" : "Text it"}</button>
              : <a href={smsHref(clientMessage({ clientName: client.clientName, agentName, url, pickCount: client.picks?.length }), null)} className="inline-flex min-h-11 items-center gap-2 border border-border px-4 text-sm hover:border-gold hover:text-gold"><MessageSquareText className="h-4 w-4" /> Text it</a>}
            <a href={mailtoHref({ clientName: client.clientName, agentName, url, pickCount: client.picks?.length })} data-deals-email-it="true" className="inline-flex min-h-11 items-center gap-2 border border-border px-4 text-sm hover:border-gold hover:text-gold"><Mail className="h-4 w-4" /> Email it</a>
            <Button type="button" variant="outline" onClick={() => onCopy(url)} className="min-h-11"><Copy className="mr-2 h-4 w-4" />{copiedUrl === url ? AGENT_COPY.copied : "Copy link"}</Button>
          </div>}
        </article>;
      })}</div></>}
    </div>
    <Dialog open={Boolean(textFor)} onOpenChange={(open) => { if (!open) setTextFor(null); }}>
      <DialogContent className="max-w-lg" data-deals-text-dialog="true">
        <DialogHeader><DialogTitle>{AGENT_COPY.textTitle}{textFor ? ` · ${textFor.name}` : ""}</DialogTitle><DialogDescription>{AGENT_COPY.textIntro}</DialogDescription></DialogHeader>
        <Textarea value={textBody} maxLength={TEXT_MAX_CHARS} rows={5} onChange={(event) => setTextBody(event.target.value)} aria-label="Text message" className="min-h-28 text-sm" />
        <p className="text-right text-xs text-muted-foreground">{textBody.length} / {TEXT_MAX_CHARS}</p>
        {textNote && <p role="status" className="text-sm text-gold">{textNote}</p>}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => setTextFor(null)} className="min-h-11">{AGENT_COPY.textCancel}</Button>
          <Button type="button" disabled={texting || textBody.trim().length === 0} onClick={() => { void sendText(); }} className="min-h-11 bg-gold text-primary-foreground"><MessageSquareText className="mr-2 h-4 w-4" />{texting ? "Logging…" : AGENT_COPY.textSend}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
