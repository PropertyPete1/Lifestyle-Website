import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull, like, lt, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { dealFirstDibs } from "../drizzle/schema";
import { homePaymentEstimate, type PaymentAssumptions } from "../shared/dealsFeatured";
import { FIRST_DIBS_CONSENT, normalizeFirstDibsEmail } from "../shared/dealsFirstDibs";
import { SITE } from "../shared/site";
import { getDb } from "./db";

/**
 * Oct 30, 2026 (Peter): "Get first dibs on new deals". A visitor leaves an email and an area (no phone). They go into
 * Follow Up Boss tagged First Dibs, get 3 to 5 homes in that area right away, and then one email a week only when
 * there are new homes or price drops there. Every email links back to the homes, offers "add your number" (the
 * site's own phone sign-up, so the team can reach out), and carries a one-click unsubscribe. Peter and Steven get one
 * email per sign-up. Nothing here ever names a builder, a community or an address: the homes come from the same
 * public catalog and public homes the page shows.
 */

/** At most this many sign-ups an hour from one connection (a form anyone can post to). */
const SIGNUPS_PER_IP_HOUR = 5;
/** A subscriber hears from us at most once a week. */
export const DIGEST_EVERY_DAYS = 7;
/** Homes in one email. */
export const HOMES_PER_EMAIL = 5;
/** The ids of homes already sent, newest kept. */
const SENT_HOMES_KEPT = 300;

const origin = () => (process.env.DEALS_SITE_ORIGIN?.trim() || "https://lifestyledesignrealty.com").replace(/\/+$/, "");

/** One home as an email shows it: public figures only. */
export type FirstDibsHome = {
  id: string;
  communityKey: string;
  area: string;
  price: number;
  previousPrice: number | null;
  beds: string | number | null;
  baths: string | number | null;
  sqft: number | null;
  kind: string;
  isNew: boolean;
  photo: string | null;
  monthly: number | null;
  veteranMonthly: number | null;
};

/** The same id the page's hearts use (publicSaveId): community key, price, size and kind. */
export function firstDibsHomeId(communityKey: string, home: { price?: number | null; sqft?: number | null; kind: string }): string {
  return `${communityKey}:${home.price ?? ""}:${home.sqft ?? ""}:${home.kind}`;
}

const fresh = (home: Pick<FirstDibsHome, "isNew" | "previousPrice" | "price">) => home.isNew || (home.previousPrice !== null && home.previousPrice > home.price);

/**
 * Which homes an email carries. The welcome email leads with new homes and price drops, then the lowest monthly
 * totals (or prices); a weekly email carries only new homes and price drops not sent before, and none at all means
 * no email. Homes with a photo come first, at most one home per community up front so the email is not one street.
 */
export function pickFirstDibsHomes(homes: readonly FirstDibsHome[], options: { weekly: boolean; sent: ReadonlySet<string>; limit?: number }): FirstDibsHome[] {
  const limit = options.limit ?? HOMES_PER_EMAIL;
  const pool = homes.filter((home) => !options.sent.has(home.id) && (!options.weekly || fresh(home)));
  const score = (home: FirstDibsHome) => [home.photo ? 0 : 1, fresh(home) ? 0 : 1, home.monthly ?? Number.MAX_SAFE_INTEGER, home.price] as const;
  const sorted = [...pool].sort((a, b) => { const x = score(a); const y = score(b); for (let index = 0; index < x.length; index++) { if (x[index] !== y[index]) return (x[index] as number) - (y[index] as number); } return a.id.localeCompare(b.id); });
  const picked: FirstDibsHome[] = [];
  const communities = new Set<string>();
  for (const home of sorted) { if (picked.length >= limit) break; if (communities.has(home.communityKey)) continue; communities.add(home.communityKey); picked.push(home); }
  for (const home of sorted) { if (picked.length >= limit) break; if (!picked.includes(home)) picked.push(home); }
  return picked;
}

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export const FIRST_DIBS_EMAIL_COPY = {
  welcomeSubject: (area: string) => `Your first dibs: new-build deals${area ? ` in ${area}` : ""}`,
  weeklySubject: (area: string, count: number) => `${count} new deal${count === 1 ? "" : "s"}${area ? ` in ${area}` : ""} this week`,
  welcomeIntro: (area: string) => `Here are a few of the best new-build deals${area ? ` in ${area}` : ""} right now. We'll email you when new homes or price drops come up, about once a week at most.`,
  weeklyIntro: (area: string) => `New homes and price drops${area ? ` in ${area}` : ""} since we last wrote.`,
  addNumber: "Ready to see one in person? Add your number and one of our agents will reach out to set up a tour.",
  addNumberButton: "Add my number",
  see: "See this home",
  veteran: (amount: string) => `100% disabled veteran: about ${amount}/mo with Texas' property tax exemption`,
  estimate: "Monthly totals are estimates at the builder's rate, with estimated tax, insurance and HOA. Not a commitment to lend.",
  why: "You're getting this because you signed up for first dibs on new deals at lifestyledesignrealty.com/deals.",
  unsubscribe: "Unsubscribe",
} as const;

/** The email's links: every one is a public page (never a builder's site, never an address). */
export function firstDibsLinks(token: string) {
  const base = origin();
  return {
    deals: `${base}/deals?src=firstdibs`,
    home: (communityKey: string) => `${base}/deals?k=${encodeURIComponent(communityKey)}&src=firstdibs`,
    addNumber: `${base}/deals?gate=1&src=firstdibs`,
    unsubscribe: `${base}/deals/first-dibs/unsubscribe?t=${encodeURIComponent(token)}`,
  };
}

const specs = (home: FirstDibsHome) => [home.beds ? `${home.beds} beds` : null, home.baths ? `${home.baths} baths` : null, home.sqft ? `${home.sqft.toLocaleString("en-US")} sq ft` : null, home.kind === "to_be_built" ? "to be built" : null].filter(Boolean).join(" · ");

/** The email, as HTML (a single-column table that holds up in Gmail and Outlook) and as plain text. */
export function firstDibsEmail(input: { area: string; token: string; homes: readonly FirstDibsHome[]; weekly: boolean }): { subject: string; html: string; text: string; headers: Record<string, string> } {
  const links = firstDibsLinks(input.token);
  const copy = FIRST_DIBS_EMAIL_COPY;
  const subject = input.weekly ? copy.weeklySubject(input.area, input.homes.length) : copy.welcomeSubject(input.area);
  const intro = input.weekly ? copy.weeklyIntro(input.area) : copy.welcomeIntro(input.area);
  const serif = "Georgia, 'Times New Roman', serif";
  const sans = "Helvetica, Arial, sans-serif";
  const homeHtml = input.homes.map((home) => {
    const drop = home.previousPrice !== null && home.previousPrice > home.price ? `<span style="color:#b91c1c;font-weight:600"> · ${money(home.previousPrice - home.price)} off</span>` : home.isNew ? `<span style="color:#7a5a1c;font-weight:600"> · New this week</span>` : "";
    return `<tr><td style="padding:0 0 20px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e7e1d6;border-radius:14px;border-collapse:separate">
      ${home.photo ? `<tr><td style="padding:10px 10px 0 10px"><a href="${links.home(home.communityKey)}"><img src="${escapeHtml(origin() + home.photo)}" alt="Home in ${escapeHtml(home.area)}" width="520" style="display:block;width:100%;max-width:520px;height:auto;border-radius:10px;border:0"></a></td></tr>` : ""}
      <tr><td style="padding:14px 18px 18px 18px;font-family:${sans};color:#26231f">
        <div style="font-family:${serif};font-size:22px;font-weight:bold">${escapeHtml(home.area)}</div>
        <div style="margin-top:4px;font-size:14px;color:#5b5650">${money(home.price)}${drop}</div>
        ${home.monthly !== null ? `<div style="margin-top:8px;font-family:${serif};font-size:24px;font-weight:bold">${money(home.monthly)}<span style="font-family:${sans};font-size:12px;font-weight:normal;color:#5b5650"> /mo est.</span></div>` : ""}
        ${home.veteranMonthly !== null ? `<div style="margin-top:2px;font-size:12px;color:#5b5650">${escapeHtml(copy.veteran(money(home.veteranMonthly)))}</div>` : ""}
        <div style="margin-top:8px;font-size:14px;color:#26231f">${escapeHtml(specs(home))}</div>
        <div style="margin-top:14px"><a href="${links.home(home.communityKey)}" style="display:inline-block;padding:11px 18px;border:1px solid #8a6220;border-radius:10px;color:#26231f;text-decoration:none;font-family:${serif};font-size:17px;font-weight:bold">${copy.see}</a></div>
      </td></tr></table></td></tr>`;
  }).join("");
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f8f5ef"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f5ef"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
      <tr><td style="padding:0 4px 18px 4px;font-family:${serif};font-size:22px;color:#26231f">Lifestyle Design Realty</td></tr>
      <tr><td style="padding:0 4px 8px 4px;font-family:${serif};font-size:30px;font-weight:bold;color:#26231f">${input.weekly ? "New deals for you" : "Your first dibs"}</td></tr>
      <tr><td style="padding:0 4px 20px 4px;font-family:${sans};font-size:15px;line-height:1.5;color:#5b5650">${escapeHtml(intro)}</td></tr>
      ${homeHtml}
      <tr><td style="padding:4px 0 20px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3ead9;border:1px solid #e2d2b0;border-radius:14px;border-collapse:separate"><tr><td style="padding:18px;font-family:${sans};font-size:15px;line-height:1.5;color:#26231f">${escapeHtml(copy.addNumber)}<div style="margin-top:12px"><a href="${links.addNumber}" style="display:inline-block;padding:12px 20px;background:#8a6220;border-radius:10px;color:#ffffff;text-decoration:none;font-weight:bold">${copy.addNumberButton}</a></div></td></tr></table></td></tr>
      <tr><td style="padding:0 4px;font-family:${sans};font-size:11px;line-height:1.6;color:#7a746c">${escapeHtml(copy.estimate)}<br><br>${escapeHtml(copy.why)} <a href="${links.unsubscribe}" style="color:#7a746c">${copy.unsubscribe}</a><br>Lifestyle Design Realty · ${escapeHtml(SITE.address)}</td></tr>
    </table></td></tr></table></body></html>`;
  const text = [
    input.weekly ? "New deals for you" : "Your first dibs",
    "",
    intro,
    "",
    ...input.homes.flatMap((home) => [
      `${home.area}: ${money(home.price)}${home.previousPrice !== null && home.previousPrice > home.price ? ` (${money(home.previousPrice - home.price)} off)` : home.isNew ? " (new this week)" : ""}`,
      ...(home.monthly !== null ? [`${money(home.monthly)}/mo est.${home.veteranMonthly !== null ? ` (${copy.veteran(money(home.veteranMonthly))})` : ""}`] : []),
      specs(home),
      links.home(home.communityKey),
      "",
    ]),
    copy.addNumber,
    links.addNumber,
    "",
    copy.estimate,
    `${copy.why} ${copy.unsubscribe}: ${links.unsubscribe}`,
    `Lifestyle Design Realty · ${SITE.address}`,
  ].join("\n");
  return { subject, html, text, headers: { "List-Unsubscribe": `<${links.unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } };
}

type CatalogCommunity = { key: string; area: string; incentive?: Parameters<typeof homePaymentEstimate>[1] };
type PublicHomeRow = { kind: string; beds?: string | number | null; baths?: string | number | null; sqft?: number | null; price?: number | null; previousPrice?: number | null; isNew?: boolean; photos?: string[] };

/** Where the homes come from (the router passes its cached public catalog; tests pass fakes). */
export type FirstDibsDeps = {
  catalog?: () => Promise<readonly CatalogCommunity[]>;
  homes?: (key: string) => Promise<readonly PublicHomeRow[] | null>;
  assumptions?: () => Promise<PaymentAssumptions | null>;
};

/** Each loader once per run (the weekly job reads every area from one catalog). */
function once<T>(load: () => Promise<T>): () => Promise<T> { let value: Promise<T> | null = null; return () => (value ??= load()); }

/** The homes a subscriber's area offers right now, from the page's own public catalog and public homes. */
export async function firstDibsHomesForArea(area: string, deps: FirstDibsDeps = {}): Promise<FirstDibsHome[]> {
  const catalog = deps.catalog ?? (async () => (await import("./dealsService")).publicDealsCatalog() as Promise<CatalogCommunity[]>);
  const homesOf = deps.homes ?? (async (key: string) => (await (await import("./dealsService")).publicCommunityHomes(key)) as PublicHomeRow[] | null);
  const assumptionsOf = deps.assumptions ?? (async () => { const featured = await (await import("./dealsFeatured")).featuredDeals("public"); return { defaultDownPercent: featured.assumptions.defaultDownPercent, termYears: featured.assumptions.termYears, costs: featured.assumptions.costs }; });
  const [communities, assumptions] = await Promise.all([catalog(), assumptionsOf().catch(() => null)]);
  // "Every area" reads at most 40 communities (the catalog's own order); one area reads all of its own.
  const inArea = communities.filter((community) => community.key && (!area || community.area === area)).slice(0, area ? 200 : 40);
  const out: FirstDibsHome[] = [];
  for (const community of inArea) {
    const homes = await homesOf(community.key).catch(() => null);
    for (const home of homes ?? []) {
      if (!home.price || home.price <= 0) continue;
      const estimate = homePaymentEstimate(home.price, community.incentive ?? null, assumptions);
      out.push({
        id: firstDibsHomeId(community.key, home),
        communityKey: community.key,
        area: community.area,
        price: home.price,
        previousPrice: home.previousPrice ?? null,
        beds: home.beds ?? null,
        baths: home.baths ?? null,
        sqft: home.sqft ?? null,
        kind: home.kind,
        isNew: Boolean(home.isNew),
        photo: home.photos?.[0] ?? null,
        monthly: estimate ? estimate.parts.total : null,
        veteranMonthly: estimate && estimate.parts.propertyTax > 0 ? estimate.parts.total - estimate.parts.propertyTax : null,
      });
    }
  }
  return out;
}

const parseSent = (value: string | null | undefined): string[] => { try { const parsed: unknown = JSON.parse(value ?? "[]"); return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []; } catch { return []; } };

/** The areas a visitor may pick: the public catalog's own area labels. */
async function publicAreas(deps: FirstDibsDeps): Promise<Set<string>> {
  const catalog = deps.catalog ?? (async () => (await import("./dealsService")).publicDealsCatalog() as Promise<CatalogCommunity[]>);
  return new Set((await catalog()).map((community) => community.area).filter(Boolean));
}

/** Email the area's homes to one subscriber; returns whether an email went out. */
async function emailSubscriber(row: typeof dealFirstDibs.$inferSelect, weekly: boolean, homesFor: (area: string) => Promise<FirstDibsHome[]>, now: Date): Promise<boolean> {
  const sent = parseSent(row.sentHomes);
  const homes = pickFirstDibsHomes(await homesFor(row.area), { weekly, sent: new Set(sent) });
  if (!homes.length) return false;
  const email = firstDibsEmail({ area: row.area, token: row.token, homes, weekly });
  const { sendBuyerEmail } = await import("./dealsEmail");
  const result = await sendBuyerEmail({ category: weekly ? "first_dibs_weekly" : "first_dibs_welcome", to: row.email, ...email });
  if (!result.ok) return false;
  const db = await getDb();
  await db?.update(dealFirstDibs).set({ lastEmailedAt: now, sentHomes: JSON.stringify([...homes.map((home) => home.id), ...sent].slice(0, SENT_HOMES_KEPT)) }).where(eq(dealFirstDibs.id, row.id));
  return true;
}

/** Peter and Steven hear about every sign-up (Peter, Oct 30: "make sure we get notified by email"). */
async function notifyTeam(row: Pick<typeof dealFirstDibs.$inferSelect, "email" | "area" | "fubPersonId">, again: boolean) {
  const { getDealSettings } = await import("./dealsService");
  const { sendBuilderDealsEmail } = await import("./dealsEmail");
  const { fubPersonLink } = await import("./dealsFub");
  const settings = await getDealSettings();
  await sendBuilderDealsEmail({
    category: "deals_first_dibs",
    recipients: settings.alertRecipients,
    subject: `First dibs sign-up${again ? " (again)" : ""}: ${row.email}`,
    content: [
      `${row.email} signed up${again ? " again" : ""} for first dibs on new deals in ${row.area || "any area"}.`,
      "Email only, no phone yet. They got the homes in that area by email and will get new homes and price drops once a week; every email asks them to add their number.",
      row.fubPersonId ? `Follow Up Boss: ${fubPersonLink(row.fubPersonId)}` : "Follow Up Boss: not added yet (it is retried with the weekly emails).",
    ].join("\n\n"),
  });
}

/**
 * A sign-up from the page. A known address that is still subscribed only updates its area (no second welcome, no
 * second FUB event, no team email): a form anyone can post to must not become a way to email someone over and over.
 */
export async function subscribeFirstDibs(input: { email: string; area: string; ip: string }, now = new Date(), deps: FirstDibsDeps = {}): Promise<{ ok: true }> {
  const email = normalizeFirstDibsEmail(input.email);
  if (!email) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a valid email address." });
  const { rateLimitCount, logDealEvent } = await import("./dealsService");
  if (await rateLimitCount("first_dibs", new Date(now.getTime() - 60 * 60_000), { ip: input.ip }) >= SIGNUPS_PER_IP_HOUR) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many sign-ups from this connection. Try again in an hour." });
  await logDealEvent({ kind: "first_dibs", ip: input.ip, detail: input.area.slice(0, 120) || null });
  const area = input.area && (await publicAreas(deps)).has(input.area) ? input.area : "";
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not sign you up. Try again." });
  const existing = (await db.select().from(dealFirstDibs).where(eq(dealFirstDibs.email, email)).limit(1))[0];
  if (existing?.status === "active") {
    if (existing.area !== area) await db.update(dealFirstDibs).set({ area }).where(eq(dealFirstDibs.id, existing.id));
    return { ok: true };
  }
  const again = Boolean(existing);
  const token = randomBytes(24).toString("base64url");
  if (existing) await db.update(dealFirstDibs).set({ status: "active", area, token, consentText: FIRST_DIBS_CONSENT, consentIp: input.ip.slice(0, 64), unsubscribedAt: null, lastEmailedAt: null }).where(eq(dealFirstDibs.id, existing.id));
  else await db.insert(dealFirstDibs).values({ email, area, token, consentText: FIRST_DIBS_CONSENT, consentIp: input.ip.slice(0, 64) });
  const row = (await db.select().from(dealFirstDibs).where(eq(dealFirstDibs.email, email)).limit(1))[0]!;
  // The rest happens after the answer: the visitor sees "You're on the list" without waiting on FUB or email.
  void (async () => {
    const { sendFirstDibsToFub } = await import("./dealsFub");
    const fub = await sendFirstDibsToFub({ email, area, again });
    if (fub.ok) { await db.update(dealFirstDibs).set({ fubPersonId: fub.personId }).where(eq(dealFirstDibs.id, row.id)); row.fubPersonId = fub.personId; }
    else console.error("[first dibs] FUB:", fub.error);
    await emailSubscriber(row, false, (picked) => firstDibsHomesForArea(picked, deps), now).catch((error) => console.error("[first dibs] welcome email:", error));
    await notifyTeam(row, again).catch((error) => console.error("[first dibs] team email:", error));
  })().catch((error) => console.error("[first dibs] after sign-up:", error));
  return { ok: true };
}

/** The once-a-day job: every subscriber due a weekly email gets one, only when their area has new homes or drops. */
export async function sendFirstDibsDigests(now = new Date()): Promise<{ due: number; emailed: number; fubRetried: number }> {
  const db = await getDb();
  if (!db) return { due: 0, emailed: 0, fubRetried: 0 };
  const cutoff = new Date(now.getTime() - DIGEST_EVERY_DAYS * 86_400_000);
  const due = await db.select().from(dealFirstDibs).where(and(eq(dealFirstDibs.status, "active"), or(isNull(dealFirstDibs.lastEmailedAt), lt(dealFirstDibs.lastEmailedAt, cutoff)))).limit(2000);
  // One read of each area, however many subscribers picked it.
  const byArea = new Map<string, Promise<FirstDibsHome[]>>();
  const shared: FirstDibsDeps = {
    catalog: once(async () => (await import("./dealsService")).publicDealsCatalog() as Promise<CatalogCommunity[]>),
    assumptions: once(async () => { const featured = await (await import("./dealsFeatured")).featuredDeals("public"); return { defaultDownPercent: featured.assumptions.defaultDownPercent, termYears: featured.assumptions.termYears, costs: featured.assumptions.costs }; }),
  };
  const homesFor = (area: string) => { let homes = byArea.get(area); if (!homes) { homes = firstDibsHomesForArea(area, shared); byArea.set(area, homes); } return homes; };
  let emailed = 0;
  let fubRetried = 0;
  const { sendFirstDibsToFub } = await import("./dealsFub");
  for (const row of due) {
    if (!row.fubPersonId) { const fub = await sendFirstDibsToFub({ email: row.email, area: row.area }); if (fub.ok) { fubRetried++; await db.update(dealFirstDibs).set({ fubPersonId: fub.personId }).where(eq(dealFirstDibs.id, row.id)); } }
    if (await emailSubscriber(row, true, homesFor, now).catch(() => false)) emailed++;
  }
  return { due: due.length, emailed, fubRetried };
}

/** The unsubscribe link (and the one-click header): turns the emails off and notes it in FUB. Unknown tokens do nothing. */
export async function unsubscribeFirstDibs(token: string, now = new Date()): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return false;
  const db = await getDb();
  if (!db) return false;
  const row = (await db.select().from(dealFirstDibs).where(eq(dealFirstDibs.token, token)).limit(1))[0];
  if (!row) return false;
  if (row.status !== "unsubscribed") {
    await db.update(dealFirstDibs).set({ status: "unsubscribed", unsubscribedAt: now }).where(eq(dealFirstDibs.id, row.id));
    if (row.fubPersonId) { const { noteFirstDibsInFub } = await import("./dealsFub"); await noteFirstDibsInFub(row.fubPersonId, "Unsubscribed from first dibs", "Unsubscribed from the Builder Deals first-dibs emails. Do not add them back to those emails.").catch(() => null); }
  }
  return true;
}

/** Admin: who signed up for first dibs (Admin, Builder Deals, Leads). */
export async function listFirstDibs(input: { search: string; page: number; pageSize: number }) {
  const db = await getDb();
  if (!db) return { rows: [], total: 0 };
  const where = input.search ? like(dealFirstDibs.email, `%${input.search.replace(/[\\%_]/g, "\\$&")}%`) : undefined;
  const [rows, counts] = await Promise.all([
    db.select({ id: dealFirstDibs.id, email: dealFirstDibs.email, area: dealFirstDibs.area, status: dealFirstDibs.status, fubPersonId: dealFirstDibs.fubPersonId, lastEmailedAt: dealFirstDibs.lastEmailedAt, createdAt: dealFirstDibs.createdAt, unsubscribedAt: dealFirstDibs.unsubscribedAt }).from(dealFirstDibs).where(where).orderBy(desc(dealFirstDibs.createdAt)).limit(input.pageSize).offset((input.page - 1) * input.pageSize),
    db.select({ n: sql<number>`count(*)` }).from(dealFirstDibs).where(where),
  ]);
  const { fubPersonLink } = await import("./dealsFub");
  return { rows: rows.map((row) => ({ ...row, fubUrl: row.fubPersonId ? fubPersonLink(row.fubPersonId) : null })), total: Number(counts[0]?.n ?? 0) };
}
