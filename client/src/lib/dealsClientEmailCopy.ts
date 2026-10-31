import type { ClientEmailAgent } from "@shared/dealsClientEmail";

/**
 * Oct 31, 2026 (Peter: the designed email for a client's list). A Gmail draft cannot be opened with HTML in it, so the
 * agent copies the designed email and pastes it into their own Lifestyle Gmail draft: the clipboard carries the HTML
 * (Gmail keeps the layout, photos and buttons) with plain text alongside for apps that take only text.
 */
export type ClientEmailData = { agent: ClientEmailAgent };

/** A site path ("/team/laila.webp") as a full link a client's mail app can open. */
export function absoluteEmailData(data: ClientEmailData, origin: string): ClientEmailData {
  const full = (value: string | null | undefined) => !value ? null : /^https:\/\//i.test(value) ? value : value.startsWith("/") ? `${origin}${value}` : null;
  return { agent: { ...data.agent, photoUrl: full(data.agent.photoUrl) } };
}

/** A Gmail draft in the agent's own Lifestyle account with the subject filled in; the body is pasted. */
export function gmailDraftHref(subject: string, agentEmail?: string | null): string {
  const account = agentEmail && /@lifestyledesignrealty\.com$/i.test(agentEmail.trim()) ? encodeURIComponent(agentEmail.trim().toLowerCase()) : "0";
  return `https://mail.google.com/mail/u/${account}/?view=cm&fs=1&tf=1&su=${encodeURIComponent(subject)}`;
}

/** Copies the email as HTML (and text); true when the browser took it. Falls back to copying a rendered selection. */
export async function copyRichEmail(html: string, text: string, env: { navigator?: Navigator; document?: Document } = {}): Promise<boolean> {
  const nav = env.navigator ?? (typeof navigator === "undefined" ? undefined : navigator);
  const doc = env.document ?? (typeof document === "undefined" ? undefined : document);
  try {
    if (nav?.clipboard?.write && typeof ClipboardItem !== "undefined") {
      await nav.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]);
      return true;
    }
  } catch { /* falls through to the selection copy */ }
  if (!doc) return false;
  const holder = doc.createElement("div");
  holder.setAttribute("aria-hidden", "true");
  holder.style.cssText = "position:fixed;left:-10000px;top:0;width:600px;opacity:0;pointer-events:none;";
  holder.innerHTML = html;
  doc.body.appendChild(holder);
  try {
    const selection = doc.getSelection();
    const range = doc.createRange();
    range.selectNodeContents(holder);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const ok = doc.execCommand("copy");
    selection?.removeAllRanges();
    return ok;
  } catch {
    return false;
  } finally {
    holder.remove();
  }
}
