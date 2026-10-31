import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLIENT_EMAIL_COLORS, clientEmailIntro, clientEmailSubject, clientListEmailFragment, clientListEmailHtml, clientListEmailText, safeHref } from "../shared/dealsClientEmail";
import { absoluteEmailData, gmailDraftHref } from "../client/src/lib/dealsClientEmailCopy";

(globalThis as { React?: typeof React }).React = React;

const members = vi.hoisted(() => ({ rows: [] as Array<{ name: string; title: string; photo: string | null; phone: string | null; email: string | null }> }));
vi.mock("./db", () => ({ getDb: async () => ({ select: () => ({ from: () => ({ where: async () => members.rows }) }) }) }));
const { clientEmailAgent } = await import("./dealsClientEmailData");

/**
 * Oct 31, 2026 (Peter: "make the email look sexy when sending the list to the client ... without brown and cream";
 * "ask ChatGPT to make it"; then "doesn't the email just have a link ... with the map and options we curated?").
 */
const agent = { name: "Tiffany Proske", title: "REALTOR®", phone: "+12105550142", email: "tiffany@lifestyledesignrealty.com", photoUrl: "https://lifestyledesignrealty.com/team/tiffany.webp" };
const base = { clientName: "Maria Lopez", listUrl: "https://lifestyledesignrealty.com/deals?c=abc123", picked: true, homeCount: 5, agent };

describe("the client list email", () => {
  it("is ChatGPT's palette: white, charcoal, slate, one navy accent, no brown, tan or cream", () => {
    const html = clientListEmailHtml(base);
    const colors = Array.from(new Set(html.match(/#[0-9A-Fa-f]{6}\b/g) ?? [])).map((color) => color.toUpperCase());
    expect(colors.every((color) => (Object.values(CLIENT_EMAIL_COLORS) as string[]).includes(color))).toBe(true);
    for (const brownish of ["#8B5E3C", "#A0522D", "#C8A97E", "#F5F0E6", "#FAF7F2", "#B08D57"]) expect(html.toUpperCase()).not.toContain(brownish);
    expect(html).toContain(CLIENT_EMAIL_COLORS.navy);
  });

  it("carries one thing to do, the private list, and no house cards or builder pages", () => {
    const html = clientListEmailHtml(base);
    expect(html).toContain("Hi Maria,");
    expect(html).toContain("I hand-picked 5 new-build homes for you.");
    expect(html).toContain('href="https://lifestyledesignrealty.com/deals?c=abc123"');
    expect(html).toContain("VIEW YOUR PRIVATE LIST");
    expect(html).toContain("Planning a visit?");
    expect(html).not.toMatch(/MORE INFO|More Info/);
    expect(html).not.toMatch(/<img[^>]+deals\/pub/);
    expect(clientEmailIntro({ picked: false, homeCount: 120 })).toBe("Here are 120 new-build homes that match what you're looking for.");
    expect(clientEmailIntro({ picked: false, homeCount: 0 })).toContain("private list");
    expect(clientEmailSubject({ ...base, picked: true, homeCount: 1 })).toBe("1 new-build home I picked for you");
    expect(clientEmailSubject({ ...base, picked: false, homeCount: 0 })).toBe("Your private list of new-build homes");
  });

  it("is email-safe: tables and inline styles only, no style block, scripts or classes", () => {
    const html = clientListEmailHtml(base);
    expect(html).not.toMatch(/<style|<script|class=|@import|<link /i);
    expect(html).toMatch(/max-width:600px/);
    const fragment = clientListEmailFragment(base);
    expect(fragment.startsWith("<table")).toBe(true);
    expect(fragment).not.toMatch(/<html|<head|<title|<body/i);
  });

  it("signs with the agent's photo, title, text and email buttons and phone", () => {
    const html = clientListEmailHtml(base);
    expect(html).toContain('src="https://lifestyledesignrealty.com/team/tiffany.webp"');
    expect(html).toContain("Tiffany Proske");
    expect(html).toContain("REALTOR® &middot; Lifestyle Design Realty");
    expect(html).toContain('href="sms:+12105550142"');
    expect(html).toContain("Text Tiffany");
    expect(html).toContain('href="mailto:tiffany@lifestyledesignrealty.com"');
    expect(html).toContain("(210) 555-0142");
    // No photo: the initials in a navy circle.
    expect(clientListEmailHtml({ ...base, agent: { ...agent, photoUrl: null } })).toMatch(/>TP<\/td>/);
  });

  it("escapes every value and refuses links that are not https (or the agent's own sms/tel/mailto)", () => {
    const html = clientListEmailHtml({ ...base, clientName: "<b>Maria</b>", agent: { ...agent, name: "Tiff \"x\" <i>" } });
    expect(html).toContain("Hi &lt;b&gt;Maria&lt;/b&gt;,");
    expect(html).not.toContain("<b>Maria</b>");
    expect(html).toContain("Tiff &quot;x&quot; &lt;i&gt;");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("http://example.com")).toBeNull();
    expect(safeHref("https://example.com/?a=1&b=2")).toBe("https://example.com/?a=1&amp;b=2");
    expect(clientListEmailHtml({ ...base, listUrl: "javascript:alert(1)" })).not.toContain("javascript:");
  });

  it("has a plain-text twin for mail apps that take only text", () => {
    const text = clientListEmailText(base);
    expect(text).toContain("View your private list: https://lifestyledesignrealty.com/deals?c=abc123");
    expect(text).toContain("(210) 555-0142");
  });

  it("opens the Gmail draft in the agent's own Lifestyle account with the subject, and makes site photos full links", () => {
    expect(gmailDraftHref("5 new-build homes I picked for you", "Tiffany@LifestyleDesignRealty.com")).toBe("https://mail.google.com/mail/u/tiffany%40lifestyledesignrealty.com/?view=cm&fs=1&tf=1&su=5%20new-build%20homes%20I%20picked%20for%20you");
    expect(gmailDraftHref("x", "me@gmail.com")).toContain("/mail/u/0/");
    expect(absoluteEmailData({ agent: { ...agent, photoUrl: "/team/tiffany.webp" } }, "https://lifestyledesignrealty.com").agent.photoUrl).toBe("https://lifestyledesignrealty.com/team/tiffany.webp");
    expect(absoluteEmailData({ agent: { ...agent, photoUrl: "data:image/png;base64,x" } }, "https://x.com").agent.photoUrl).toBeNull();
  });
});

describe("the agent's signature card", () => {
  beforeEach(() => {
    members.rows = [
      { name: "Joshua McDaniel", title: "REALTOR®", photo: "/team/joshua.webp", phone: null, email: null },
      { name: "Stefanie Graham", title: "Market Team Lead · REALTOR®", photo: "https://drive.google.com/file/d/x/view", phone: null, email: null },
      { name: "Steven Van Orden", title: "Broker & Owner", photo: "/team/steven.webp", phone: null, email: null },
    ];
  });
  it("takes the team page's photo and title (Josh on the deals list is Joshua on the team page)", async () => {
    expect(await clientEmailAgent({ name: "Josh McDaniel", email: "josh@lifestyledesignrealty.com", phoneE164: "+12105550100" })).toEqual({ name: "Josh McDaniel", title: "REALTOR®", phone: "+12105550100", email: "josh@lifestyledesignrealty.com", photoUrl: "/team/joshua.webp" });
    expect((await clientEmailAgent({ name: "Steven Van Orden", email: null, phoneE164: null })).title).toBe("Broker & Owner");
  });
  it("skips a Drive link (it does not open in a mail app) and falls back to REALTOR® for someone not on the team page", async () => {
    expect((await clientEmailAgent({ name: "Stefanie Graham", email: null, phoneE164: null })).photoUrl).toBeNull();
    expect(await clientEmailAgent({ name: "Nicki Pauley", email: null, phoneE164: "+12105550199" })).toMatchObject({ title: "REALTOR®", photoUrl: null });
  });
});

describe("Email it on the agent tools", async () => {
  const { AgentTools } = await import("../client/src/components/deals/AgentTools");
  const workspace = { agent: { name: "Tiffany Proske", email: "tiffany@lifestyledesignrealty.com", fubLinked: true }, clients: [{ id: 1, clientName: "Maria Lopez", clientPhone: null, note: null, path: "/deals?c=abc", createdAt: "2026-10-31T15:00:00Z", expiresAt: "2026-11-30T15:00:00Z", revoked: false, openedAt: null, openCount: 0, verifiedAt: null, accessExpiresAt: null, lastViewedAt: null, saves: [], requests: [], picks: [] }] };
  it("opens the designed email when the page can build it, and keeps the plain Gmail draft otherwise", () => {
    const designed = renderToStaticMarkup(React.createElement(AgentTools, { workspace, onCreate: () => undefined, onRevoke: () => undefined, onCopy: () => undefined, origin: "https://lifestyledesignrealty.com", loadEmail: async () => ({ agent }) }));
    expect(designed).toMatch(/<button[^>]*data-deals-email-it="true"/);
    const plain = renderToStaticMarkup(React.createElement(AgentTools, { workspace, onCreate: () => undefined, onRevoke: () => undefined, onCopy: () => undefined, origin: "https://lifestyledesignrealty.com" }));
    expect(plain).toMatch(/<a href="https:\/\/mail\.google\.com[^"]*"[^>]*data-deals-email-it="true"/);
  });
});
