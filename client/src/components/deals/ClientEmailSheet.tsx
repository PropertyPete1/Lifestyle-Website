import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Mail, X } from "lucide-react";
import { clientEmailSubject, clientListEmailFragment, clientListEmailHtml, clientListEmailText, type ClientEmailInput } from "@shared/dealsClientEmail";
import { absoluteEmailData, copyRichEmail, gmailDraftHref, type ClientEmailData } from "@/lib/dealsClientEmailCopy";

/**
 * Oct 31, 2026 (Peter: "make the email look sexy when sending the list to the client"). The agent sees the designed
 * email (ChatGPT's look: white, charcoal, one navy accent), copies it, and pastes it into a Gmail draft in their own
 * Lifestyle account. Two plain steps, so no browser blocks the copy or the new tab.
 */
export const CLIENT_EMAIL_COPY = {
  title: "Email your client",
  loading: "Building the email…",
  failed: "Could not build the email. Try again, or use Copy link.",
  copy: "1. Copy email",
  copied: "Copied",
  copyFailed: "Your browser would not copy it. Select the email below and copy it.",
  open: "2. Open Gmail and paste",
  how: "In the Gmail draft, click in the message and paste (⌘V on a Mac, Ctrl+V on Windows; on a phone, tap and hold, then Paste).",
} as const;

export type ClientEmailRequest = Omit<ClientEmailInput, "agent">;

export function ClientEmailSheet({ request, load, origin, agentEmail, onClose }: { request: ClientEmailRequest; load: () => Promise<ClientEmailData>; origin: string; agentEmail?: string | null; onClose: () => void }) {
  const [data, setData] = useState<ClientEmailData | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    load().then((result) => { if (live) setData(absoluteEmailData(result, origin)); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const input: ClientEmailInput | null = data ? { ...request, agent: data.agent } : null;
  const html = useMemo(() => input ? clientListEmailHtml(input) : null, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const subject = clientEmailSubject(request);
  const copy = async () => {
    if (!input) return;
    setCopied(await copyRichEmail(clientListEmailFragment(input), clientListEmailText(input)));
  };
  return <div className="fixed inset-0 z-[100] flex items-end bg-black/70 sm:items-center sm:justify-center" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} data-deals-client-email="true">
    <section role="dialog" aria-modal="true" aria-labelledby="deals-client-email-title" className="relative flex max-h-[94dvh] w-full min-w-0 flex-col overflow-hidden border-t border-border bg-card shadow-2xl sm:max-w-2xl sm:border">
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 id="deals-client-email-title" className="font-serif text-2xl leading-tight">{CLIENT_EMAIL_COPY.title}</h2>
          <p className="mt-1 truncate text-xs text-muted-foreground">Subject: {subject}</p>
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-[#F4F6F8]">
        {failed ? <p role="alert" className="p-6 text-sm text-destructive">{CLIENT_EMAIL_COPY.failed}</p>
          : !html ? <p role="status" className="p-6 text-sm text-muted-foreground">{CLIENT_EMAIL_COPY.loading}</p>
          : <iframe title="Email preview" srcDoc={html} sandbox="" data-deals-client-email-preview="true" className="block h-[58dvh] w-full border-0 bg-[#F4F6F8]" />}
      </div>
      <div className="border-t border-border px-5 py-4">
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={!html} onClick={() => { void copy(); }} data-deals-client-email-copy="true" className="inline-flex min-h-11 items-center gap-2 bg-[#102B4C] px-5 text-sm font-medium text-white disabled:opacity-50">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? CLIENT_EMAIL_COPY.copied : CLIENT_EMAIL_COPY.copy}</button>
          <a href={gmailDraftHref(subject, agentEmail)} target="_blank" rel="noreferrer" aria-disabled={!copied} data-deals-client-email-open="true" className={`inline-flex min-h-11 items-center gap-2 border border-[#102B4C] px-5 text-sm font-medium text-[#102B4C] ${copied ? "" : "opacity-60"}`}><Mail className="h-4 w-4" />{CLIENT_EMAIL_COPY.open}</a>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{copied === false ? CLIENT_EMAIL_COPY.copyFailed : CLIENT_EMAIL_COPY.how}</p>
      </div>
    </section>
  </div>;
}
