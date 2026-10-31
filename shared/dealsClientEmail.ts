/**
 * Oct 31, 2026 (Peter: "make the email look sexy when sending the list to the client ... luxury, clean, professional,
 * without brown and cream colors"; "ask ChatGPT to make it just like it made the website idea"; then "doesn't the email
 * just have a link and they can click it with the map and options we curated? That's more efficient"). ChatGPT's
 * design: crisp white, deep charcoal, cool slate and one refined navy accent, Georgia headings over Helvetica, a
 * signature card. The email carries one thing to do: open the private list (homes, map, the agent's picks).
 *
 * The agent pastes it into their own Lifestyle Gmail (a Gmail draft cannot be opened with HTML in it), so it is
 * email-safe: 600px, tables, every style inline, no web fonts, no scripts, bulletproof buttons. Every value is
 * escaped and every link is checked (https, or sms/tel/mailto for the agent's own buttons).
 */
export const CLIENT_EMAIL_COLORS = {
  white: "#FFFFFF",
  charcoal: "#171B21",
  navy: "#102B4C",
  slate: "#66717E",
  ink: "#39434F",
  ice: "#F4F6F8",
  silver: "#DDE3EA",
} as const;

export type ClientEmailAgent = {
  name: string;
  title?: string | null;
  phone?: string | null;
  email?: string | null;
  photoUrl?: string | null;
};

export type ClientEmailInput = {
  clientName: string;
  listUrl: string;
  /** Picked by the agent ("I hand-picked") or the homes the agent's filters show ("match what you're looking for"). */
  picked: boolean;
  /** How many homes the list opens on (0: the whole list). */
  homeCount: number;
  agent: ClientEmailAgent;
};

const C = CLIENT_EMAIL_COLORS;
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "Helvetica,Arial,sans-serif";

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** An https link (or the agent's own sms:/tel:/mailto:), escaped for an attribute; anything else is no link. */
export function safeHref(value: string | null | undefined, allow: ReadonlyArray<"https" | "sms" | "tel" | "mailto"> = ["https"]): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const scheme = /^([a-z]+):/i.exec(raw)?.[1]?.toLowerCase();
  if (!scheme || !(allow as readonly string[]).includes(scheme)) return null;
  if (scheme === "https") { try { new URL(raw); } catch { return null; } }
  return escapeHtml(raw);
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name.trim();
const digits = (phone: string | null | undefined) => {
  const all = String(phone ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return all.length === 10 ? all : null;
};
const prettyPhone = (ten: string) => `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;

/** The subject line the Gmail draft opens with. */
export function clientEmailSubject(input: Pick<ClientEmailInput, "picked" | "homeCount" | "clientName">): string {
  const count = input.homeCount;
  if (count <= 0) return "Your private list of new-build homes";
  return input.picked
    ? `${count} new-build home${count === 1 ? "" : "s"} I picked for you`
    : `${count.toLocaleString("en-US")} new-build home${count === 1 ? "" : "s"} for you`;
}

/** The agent's line under the greeting. */
export function clientEmailIntro(input: Pick<ClientEmailInput, "picked" | "homeCount">): string {
  const count = input.homeCount;
  if (count <= 0) return "Here's your private list of new-build homes, with this week's builder incentives.";
  const homes = `${count.toLocaleString("en-US")} new-build home${count === 1 ? "" : "s"}`;
  return input.picked ? `I hand-picked ${homes} for you.` : `Here are ${homes} that match what you're looking for.`;
}

function button(href: string, label: string, options: { width?: string; fill?: boolean; size?: number; padding?: string; maxWidth?: string } = {}): string {
  const fill = options.fill ?? true;
  const bg = fill ? C.navy : C.white;
  const color = fill ? C.white : C.navy;
  const width = options.width ? ` width="${options.width}"` : "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"${width} bgcolor="${bg}" style="${options.width ? `width:${options.width};` : ""}${options.maxWidth ? `max-width:${options.maxWidth};` : ""}border-collapse:separate;background-color:${bg};border-radius:5px;"><tr><td align="center" bgcolor="${bg}" style="background-color:${bg};border-radius:5px;">`
    + `<a href="${href}" target="_blank" style="display:block;padding:${options.padding ?? "13px 22px"};font-family:${SANS};font-size:${options.size ?? 13}px;line-height:19px;font-weight:bold;letter-spacing:0.6px;text-decoration:none;color:${color};border:1px solid ${C.navy};border-radius:5px;white-space:nowrap;">${label}</a>`
    + `</td></tr></table>`;
}

function divider(): string {
  return `<tr><td style="padding:0 24px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;"><tr><td bgcolor="${C.silver}" height="1" style="height:1px;line-height:1px;font-size:1px;background-color:${C.silver};">&nbsp;</td></tr></table></td></tr>`;
}

function agentPhoto(agent: ClientEmailAgent): string {
  const photo = safeHref(agent.photoUrl);
  if (photo) return `<img src="${photo}" alt="${escapeHtml(agent.name)}" width="96" height="96" border="0" style="display:block;width:96px;height:96px;border:0;border-radius:50%;object-fit:cover;background-color:${C.silver};">`;
  const initials = agent.name.trim().split(/\s+/).map((part) => part[0] ?? "").join("").slice(0, 2).toUpperCase() || "LD";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr><td align="center" valign="middle" width="96" height="96" bgcolor="${C.navy}" style="width:96px;height:96px;border-radius:50%;background-color:${C.navy};font-family:${SERIF};font-size:32px;line-height:96px;font-weight:bold;color:${C.white};">${escapeHtml(initials)}</td></tr></table>`;
}

function signature(agent: ClientEmailAgent): string {
  const phone = digits(agent.phone);
  const sms = phone ? safeHref(`sms:+1${phone}`, ["sms"]) : null;
  const tel = phone ? safeHref(`tel:+1${phone}`, ["tel"]) : null;
  const mail = agent.email && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(agent.email.trim()) ? safeHref(`mailto:${agent.email.trim()}`, ["mailto"]) : null;
  const buttons = [sms ? button(sms, `Text ${escapeHtml(firstName(agent.name))}`, { width: "100%", size: 12, padding: "13px 6px" }) : null, mail ? button(mail, "Email", { width: "100%", fill: false, size: 12, padding: "13px 6px" }) : null].filter((cell): cell is string => Boolean(cell));
  const title = `${escapeHtml(agent.title?.trim() || "REALTOR®")} &middot; Lifestyle Design Realty`;
  return `<tr><td bgcolor="${C.white}" style="padding:0 24px 30px 24px;background-color:${C.white};">`
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${C.ice}" style="width:100%;border-collapse:separate;background-color:${C.ice};border:1px solid ${C.silver};border-radius:6px;">`
    + `<tr><td align="center" style="padding:25px 20px 10px 20px;">${agentPhoto(agent)}</td></tr>`
    + `<tr><td align="center" style="padding:7px 15px 0 15px;"><div style="font-family:${SERIF};font-size:25px;line-height:32px;font-weight:bold;color:${C.charcoal};text-align:center;">${escapeHtml(agent.name)}</div></td></tr>`
    + `<tr><td align="center" style="padding:6px 12px 18px 12px;"><div style="font-family:${SANS};font-size:11px;line-height:19px;font-weight:bold;letter-spacing:0.5px;color:${C.slate};text-align:center;">${title}</div></td></tr>`
    + (buttons.length ? `<tr><td align="center" style="padding:0 16px 15px 16px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:380px;border-collapse:collapse;"><tr>${buttons.map((cell, index) => `<td align="center" valign="top" width="${buttons.length === 1 ? "100%" : "50%"}" style="width:${buttons.length === 1 ? "100%" : "50%"};${buttons.length === 1 ? "" : index === 0 ? "padding-right:5px;" : "padding-left:5px;"}">${cell}</td>`).join("")}</tr></table></td></tr>` : "")
    + (tel && phone ? `<tr><td align="center" style="padding:0 15px 24px 15px;"><a href="${tel}" style="font-family:${SANS};font-size:14px;line-height:22px;font-weight:bold;color:${C.ink};text-decoration:none;">${prettyPhone(phone)}</a></td></tr>` : `<tr><td style="padding:0 0 10px 0;font-size:1px;line-height:1px;">&nbsp;</td></tr>`)
    + `</table></td></tr>`;
}

/** The email's body only (what goes on the clipboard for pasting into a Gmail draft): the outer table, no <html> or <title>. */
export function clientListEmailFragment(input: ClientEmailInput): string {
  const html = clientListEmailHtml(input);
  const start = html.indexOf("<body");
  const open = html.indexOf(">", start) + 1;
  return html.slice(open, html.lastIndexOf("</body>"));
}

/** The whole email as one HTML document. */
export function clientListEmailHtml(input: ClientEmailInput): string {
  const listUrl = safeHref(input.listUrl);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(clientEmailSubject(input))}</title></head>`
    + `<body bgcolor="${C.ice}" style="margin:0;padding:0;background-color:${C.ice};color:${C.charcoal};font-family:${SANS};">`
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${C.ice}" style="width:100%;background-color:${C.ice};border-collapse:collapse;"><tr><td align="center" style="padding:20px 10px;">`
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${C.white}" style="width:100%;max-width:600px;background-color:${C.white};border-collapse:collapse;border:1px solid ${C.silver};">`
    // Header: the wordmark.
    + `<tr><td align="center" bgcolor="${C.white}" style="padding:34px 20px 25px 20px;background-color:${C.white};"><div style="font-family:${SERIF};font-size:25px;line-height:31px;font-weight:bold;letter-spacing:0.5px;color:${C.charcoal};text-align:center;">Lifestyle Design Realty</div><div style="font-family:${SANS};font-size:10px;line-height:17px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${C.slate};text-align:center;padding-top:10px;">VETERAN-OWNED &amp; OPERATED</div></td></tr>`
    + divider()
    // Greeting and the agent's line.
    + `<tr><td bgcolor="${C.white}" style="padding:30px 24px 12px 24px;background-color:${C.white};"><div style="font-family:${SERIF};font-size:29px;line-height:36px;font-weight:bold;color:${C.charcoal};">Hi ${escapeHtml(firstName(input.clientName) || "there")},</div><div style="font-family:${SANS};font-size:16px;line-height:25px;color:${C.ink};padding-top:12px;">${escapeHtml(clientEmailIntro(input))}</div></td></tr>`
    // The one thing to do: open the private list.
    + (listUrl ? `<tr><td align="center" bgcolor="${C.white}" style="padding:18px 24px 12px 24px;background-color:${C.white};">${button(listUrl, "VIEW YOUR PRIVATE LIST &nbsp;&#8594;", { width: "100%", maxWidth: "350px", size: 14, padding: "17px 14px" })}</td></tr>` : "")
    + `<tr><td align="center" bgcolor="${C.white}" style="padding:0 24px 30px 24px;background-color:${C.white};font-family:${SANS};font-size:12px;line-height:19px;color:${C.slate};">Photos, prices, the map and this week's builder incentives, all in one place.</td></tr>`
    // Planning a visit.
    + `<tr><td bgcolor="${C.white}" style="padding:0 24px 29px 24px;background-color:${C.white};"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${C.ice}" style="width:100%;border-collapse:separate;background-color:${C.ice};border-left:3px solid ${C.navy};"><tr><td style="padding:17px 18px;font-family:${SANS};font-size:13px;line-height:21px;color:${C.ink};"><strong style="color:${C.charcoal};">Planning a visit?</strong><br>Text me first so I can register you with the builder. Builders ask for your agent at the first visit.</td></tr></table></td></tr>`
    + signature(input.agent)
    + divider()
    // Footer.
    + `<tr><td align="center" bgcolor="${C.white}" style="padding:27px 20px 32px 20px;background-color:${C.white};"><div style="font-family:${SERIF};font-size:18px;line-height:25px;font-weight:bold;letter-spacing:0.3px;color:${C.charcoal};text-align:center;">Lifestyle Design Realty</div><div style="font-family:${SANS};font-size:10px;line-height:18px;font-weight:bold;letter-spacing:1.5px;color:${C.slate};text-align:center;padding-top:7px;">VETERAN-OWNED &amp; OPERATED</div><div style="font-family:${SANS};font-size:11px;line-height:19px;color:${C.slate};text-align:center;padding-top:10px;">San Antonio &middot; Austin &middot; New Braunfels, Texas</div><div style="padding-top:10px;"><a href="https://lifestyledesignrealty.com" target="_blank" style="font-family:${SANS};font-size:11px;line-height:19px;font-weight:bold;color:${C.navy};text-decoration:none;">lifestyledesignrealty.com</a></div></td></tr>`
    + `</table></td></tr></table></body></html>`;
}

/** The same email as plain text (the clipboard's fallback, and what a mail app without HTML shows). */
export function clientListEmailText(input: ClientEmailInput): string {
  const lines = [`Hi ${firstName(input.clientName) || "there"},`, "", clientEmailIntro(input), "", `View your private list: ${input.listUrl}`, "Photos, prices, the map and this week's builder incentives, all in one place.", "", "Planning a visit? Text me first so I can register you with the builder. Builders ask for your agent at the first visit.", "", input.agent.name, `${input.agent.title?.trim() || "REALTOR®"} · Lifestyle Design Realty`];
  const phone = digits(input.agent.phone);
  if (phone) lines.push(prettyPhone(phone));
  if (input.agent.email) lines.push(input.agent.email);
  return lines.join("\n");
}
