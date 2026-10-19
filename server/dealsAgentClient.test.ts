import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { describe, expect, it } from "vitest";
import { initialGateState, readGateParams, stripTransientGateParams, type GateDealsState } from "../client/src/lib/dealsGate";
import type { GateSheetViewProps } from "../client/src/components/deals/GateSheet";
import type { GatedCatalogProps, GatedCommunity, GatedLead } from "../client/src/components/deals/GatedCatalog";

/**
 * The agent-facing pieces rendered to static markup: the gate as an agent's
 * client sees it, the full list with its private details and save hearts, and
 * the agent tools (client links and activity) on /deals/team.
 */
(globalThis as { React?: typeof React }).React = React;
const { GateSheetView } = await import("../client/src/components/deals/GateSheet");
const { GatedCatalog } = await import("../client/src/components/deals/GatedCatalog");
const { AgentTools, clientMessage, clientStatus, smsHref, absoluteLink } = await import("../client/src/components/deals/AgentTools");
const { clientLinkState } = await import("../client/src/components/builder-deals/ClientLinksSection");
const { createElement } = React;
const decode = (value: string) => value.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);
const TOKEN = "Abc123_-".repeat(4);

describe("the gate for an agent's client", () => {
  const noop = () => undefined;
  function render(state: GateDealsState, overrides: Partial<GateSheetViewProps> = {}) {
    const props: GateSheetViewProps = {
      gate: initialGateState(readGateParams(`?c=${TOKEN}`), state), state: state as GateSheetViewProps["state"], phone: "(210) 555-0202", code: "", choice: null,
      onPhone: noop, onCode: noop, onChoice: noop, onContinue: noop, onConfirmAgent: noop, onGo: noop, onResend: noop, onChangeNumber: noop, onCopyLink: noop, onClose: noop, ...overrides,
    };
    return decode(renderToStaticMarkup(createElement(GateSheetView, props)));
  }

  it("keeps the client link token through the URL helpers and drops a malformed one", () => {
    expect(readGateParams(`?c=${TOKEN}&src=sl1`)).toMatchObject({ c: TOKEN, src: "sl1" });
    expect(readGateParams("?c=too-short").c).toBeUndefined();
    expect(readGateParams(`?c=${"x".repeat(80)}`).c).toBeUndefined();
    expect(stripTransientGateParams(`http://localhost/deals?c=${TOKEN}&expired=1&gate=1`)).toBe(`/deals?c=${TOKEN}`);
  });

  it("names the agent, skips the realtor question and lets Continue go on the phone alone", () => {
    const html = render({ pending: null, consentText: "By tapping Continue, you agree.", clientLink: { agentName: "Tiffany Agent", clientFirstName: "Maria" } } as GateDealsState);
    expect(html).toContain("Shared by Tiffany Agent");
    expect(html).toContain("Maria, your homes are ready.");
    expect(html).not.toContain("Are you a realtor, or working with one?");
    expect(html).not.toContain("No, just me");
    expect(html).not.toContain("Continue with Google");
    // Continue is enabled with no choice made: the link answered the question.
    const continueButton = html.match(/<button[^>]*>(?:(?!<\/button>).)*Continue(?:(?!<\/button>).)*<\/button>/)?.[0] ?? "";
    expect(continueButton).not.toContain('disabled=""');
    // Consent copy still renders for the agent's client.
    expect(html).toContain("By tapping Continue");
  });

  it("asks the realtor question as before when there is no client link", () => {
    const html = render({ pending: null, clientLink: null, consentText: "consent" } as GateDealsState);
    expect(html).toContain("Are you a realtor, or working with one?");
    expect(html).toContain("Private buyer access");
    expect(html).toContain("On the Lifestyle Design Realty team?");
    const continueButton = html.match(/<button[^>]*>(?:(?!<\/button>).)*Continue(?:(?!<\/button>).)*<\/button>/)?.[0] ?? "";
    expect(continueButton).toContain('disabled=""');
  });
});

const lead: GatedLead = { display: "Maria Lopez", expiresAt: new Date(NOW + 70 * 3600_000).toISOString(), name: "Maria Lopez", timeline: null, teamPreview: false, agentClient: true };
const communities: GatedCommunity[] = [{
  label: "Southeast demo area | Half-acre lots", area: "Southeast demo area", reelUrl: null, areaMap: null, driveTimes: [], updatedAt: "2026-10-18T12:00:00.000Z", incentive: null,
  details: { builderName: "Demo Builder", communityName: "Demo Lakes", address: "100 Demo Lakes Blvd, San Antonio, TX", salesLine: "(210) 555-0999", builderPage: null },
  homes: [
    { card: "a".repeat(20), kind: "quick_move_in", beds: "4", baths: "3", sqft: 2500, price: 489990, photos: ["/deals/mine/img/1"], details: { address: "118 Demo Lakes Blvd", planName: "Brandon", builderPage: null } },
    { card: "b".repeat(20), kind: "quick_move_in", beds: "3", baths: "2", sqft: 1800, price: 389000, photos: [], details: { address: "120 Demo Lakes Blvd", planName: "Evan", builderPage: "https://builder.example/evan" } },
  ],
}];
function renderList(overrides: Partial<GatedCatalogProps> = {}) {
  return decode(renderToStaticMarkup(createElement(Router, { ssrPath: "/deals/mine" }, createElement(GatedCatalog, { lead, communities, now: NOW, saved: ["a".repeat(20)], onSave: () => undefined, agent: { name: "Tiffany Agent", phone: "(210) •••-0101" }, ...overrides }))));
}

describe("the full list for an agent's client", () => {
  it("shows the builder, community, address and plan, the agent's note and a heart per home with the saved state", () => {
    const html = renderList();
    expect(html).toContain("Shared by Tiffany Agent");
    expect(html).toContain("Demo Builder · Demo Lakes");
    expect(html).toContain("100 Demo Lakes Blvd, San Antonio, TX");
    expect(html).toContain("Sales office: (210) 555-0999");
    expect(html).toContain("Brandon · 118 Demo Lakes Blvd");
    expect(html).toContain("Tiffany Agent picked these for you.");
    expect(html).toContain("Text Tiffany at (210) •••-0101");
    expect(html.match(/data-deals-save="saved"/g)?.length).toBe(1);
    expect(html.match(/data-deals-save="unsaved"/g)?.length).toBe(1);
    expect(html.match(/Tour this home with us/g)?.length).toBe(2);
    expect(html).toContain('href="https://builder.example/evan"');
    // No name prompt for a buyer who already has a name.
    expect(html).not.toContain("Add your name so we know who to text.");
  });

  it("renders a reel buyer's list exactly as before: no details, no agent note, hearts still available", () => {
    const stripped = communities.map((community) => ({ ...community, details: undefined, homes: community.homes.map((home) => ({ ...home, details: undefined })) }));
    const html = renderList({ lead: { ...lead, agentClient: false, name: null }, communities: stripped, agent: null, saved: [] });
    expect(html).toContain("Private buyer list");
    expect(html).not.toContain("Demo Builder");
    expect(html).not.toContain("Demo Lakes");
    expect(html).not.toContain("picked these for you");
    expect(html.match(/data-deals-save="unsaved"/g)?.length).toBe(2);
    expect(html).toContain("Add your name so we know who to text.");
  });
});

describe("agent tools on /deals/team", () => {
  const workspace = {
    agent: { name: "Tiffany Agent", email: "tiffany@example.com", fubLinked: true },
    clients: [
      { id: 1, clientName: "Maria Lopez", clientPhone: "(210) 555-0202", clientPhoneDigits: "2105550202", note: "Wants 4 beds", path: `/deals?c=${TOKEN}`, createdAt: new Date(NOW - 86_400_000).toISOString(), expiresAt: new Date(NOW + 29 * 86_400_000).toISOString(), revoked: false, openedAt: new Date(NOW - 3_600_000).toISOString(), openCount: 2, verifiedAt: new Date(NOW - 1_800_000).toISOString(), accessExpiresAt: new Date(NOW + 60 * 3_600_000).toISOString(), lastViewedAt: new Date(NOW - 600_000).toISOString(), saves: [{ card: "a".repeat(20), description: "118 Demo Lakes Blvd (Brandon)", price: 489990, communityLabel: "Demo Lakes (Southeast demo area)", savedAt: new Date(NOW - 900_000).toISOString() }], requests: [{ kind: "tour" as const, description: "120 Demo Lakes Blvd (Evan)", preferredAt: new Date(NOW + 86_400_000).toISOString(), createdAt: new Date(NOW - 800_000).toISOString() }] },
      { id: 2, clientName: "Sam Reyes", clientPhone: null, note: null, path: "/deals?c=other", createdAt: new Date(NOW - 7_200_000).toISOString(), expiresAt: new Date(NOW + 29 * 86_400_000).toISOString(), revoked: false, openedAt: null, openCount: 0, verifiedAt: null, accessExpiresAt: null, lastViewedAt: null, saves: [], requests: [] },
      { id: 3, clientName: "Old Link", clientPhone: null, note: null, path: "/deals?c=old", createdAt: new Date(NOW - 40 * 86_400_000).toISOString(), expiresAt: new Date(NOW - 86_400_000).toISOString(), revoked: false, openedAt: null, openCount: 0, verifiedAt: null, accessExpiresAt: null, lastViewedAt: null, saves: [], requests: [] },
    ],
  };
  const noop = () => undefined;
  const renderTools = (overrides: Partial<Parameters<typeof AgentTools>[0]> = {}) => decode(renderToStaticMarkup(createElement(AgentTools, { workspace, onCreate: noop, onRevoke: noop, onCopy: noop, origin: "https://lifestyledesignrealty.com", ...overrides })));

  it("lists each client with their status, saves and requests, and a text/copy pair per live link", () => {
    const html = renderTools();
    expect(html).toContain("Agent tools · Tiffany Agent");
    expect(html).toContain("Send homes to a client");
    expect(html.match(/data-deals-client="true"/g)?.length).toBe(3);
    expect(html).toContain("Verified Oct 19, 6:30 AM · list open until Oct 21, 7:00 PM");
    expect(html).toContain("Not opened yet");
    expect(html).toContain("Link expired");
    expect(html).toContain("Saved homes");
    expect(html).toContain("118 Demo Lakes Blvd (Brandon) · $489,990 · Demo Lakes (Southeast demo area)");
    expect(html).toContain("Tour: 120 Demo Lakes Blvd (Evan)");
    expect(html).toContain("Note: Wants 4 beds");
    // Maria's number was typed by the agent, so her Text it is addressed; Sam's is not.
    expect(html).toContain('href="sms:+12105550202?&body=');
    expect(html).toContain('href="sms:?&body=');
    expect(html).not.toContain("Follow Up Boss user");
  });

  it("warns an agent whose team row has no FUB user, and shows the created link with the suggested text", () => {
    const html = renderTools({ workspace: { ...workspace, agent: { ...workspace.agent, fubLinked: false }, clients: [] }, created: { id: 9, path: `/deals?c=${TOKEN}`, expiresAt: new Date(NOW + 30 * 86_400_000).toISOString() } });
    expect(html).toContain("without a Follow Up Boss user");
    expect(html).toContain("No client links yet. Send your first one above.");
    // The created-link panel waits for the form submit (lastSent) in the browser; the pure helpers are asserted directly.
    const url = absoluteLink(`/deals?c=${TOKEN}`, "https://lifestyledesignrealty.com");
    expect(url).toBe(`https://lifestyledesignrealty.com/deals?c=${TOKEN}`);
    const message = clientMessage({ clientName: "Maria Lopez", agentName: "Tiffany Agent", url });
    expect(message).toBe(`Hi Maria, here are the new-build homes I picked for you, with the current builder incentives. Open the link and verify your mobile number once: ${url} - Tiffany Agent`);
    expect(smsHref(message, "2105550202")).toBe(`sms:+12105550202?&body=${encodeURIComponent(message)}`);
    expect(smsHref(message)).toBe(`sms:?&body=${encodeURIComponent(message)}`);
  });

  it("derives one status per link for agents and admin alike", () => {
    expect(clientStatus(workspace.clients[1]!, NOW)).toEqual({ label: "Not opened yet", tone: "muted" });
    expect(clientStatus({ ...workspace.clients[1]!, openedAt: new Date(NOW - 60_000).toISOString() }, NOW).label).toMatch(/^Opened .* not verified yet$/);
    expect(clientStatus({ ...workspace.clients[0]!, accessExpiresAt: null }, NOW).label).toContain("access expired, the same link renews it");
    expect(clientStatus({ ...workspace.clients[1]!, revoked: true }, NOW)).toEqual({ label: "Link turned off", tone: "muted" });
    expect(clientLinkState({ revokedAt: null, verifiedAt: null, openedAt: null, expiresAt: new Date(NOW + 1000) }, NOW)).toBe("sent");
    expect(clientLinkState({ revokedAt: null, verifiedAt: null, openedAt: new Date(NOW), expiresAt: new Date(NOW + 1000) }, NOW)).toBe("opened");
    expect(clientLinkState({ revokedAt: null, verifiedAt: new Date(NOW), openedAt: new Date(NOW), expiresAt: new Date(NOW - 1000) }, NOW)).toBe("verified");
    expect(clientLinkState({ revokedAt: new Date(NOW), verifiedAt: new Date(NOW), openedAt: null, expiresAt: new Date(NOW + 1000) }, NOW)).toBe("revoked");
    expect(clientLinkState({ revokedAt: null, verifiedAt: null, openedAt: null, expiresAt: new Date(NOW - 1000) }, NOW)).toBe("expired");
  });
});
