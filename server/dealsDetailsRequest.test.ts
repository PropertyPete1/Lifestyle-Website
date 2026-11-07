import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
vi.mock("./_core/notification", () => ({ notifyOwner: vi.fn(async () => true) }));
import { DETAILS_CONSENT_TEXT, detailsRequestInput, detailsRequestNote, publicHomeLine } from "./dealsDetailsRequest";
import { DETAILS_REQUEST_TAG, sendBuilderDealsDetailsRequestToFub, AGENT_PAGE_TAG } from "./dealsFub";
import { DEALS_DETAILS_CONSENT_TEXT } from "../shared/deals";

(globalThis as { React?: typeof React }).React = React;
const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf-8");

/**
 * Oct 31, 2026 (Peter: "yes just get name number email required fields and notes if they wanna add notes and done"):
 * "Get this home's details" goes straight to Follow Up Boss, no text code.
 */
describe("details request: the form's rules", () => {
  const ok = { name: "Maria Lopez", phone: "(210) 555-0123", email: "maria@example.com", consent: true as const };
  it("requires name, mobile, email and consent; notes are optional", () => {
    expect(detailsRequestInput.safeParse(ok).success).toBe(true);
    expect(detailsRequestInput.safeParse({ ...ok, notes: "Moving in March, need 4 beds" }).success).toBe(true);
    expect(detailsRequestInput.safeParse({ ...ok, name: "" }).success).toBe(false);
    expect(detailsRequestInput.safeParse({ ...ok, email: "" }).success).toBe(false);
    expect(detailsRequestInput.safeParse({ ...ok, email: "not-an-email" }).success).toBe(false);
    expect(detailsRequestInput.safeParse({ ...ok, phone: "" }).success).toBe(false);
    expect(detailsRequestInput.safeParse({ ...ok, consent: false }).success).toBe(false);
    expect(detailsRequestInput.safeParse({ ...ok, notes: "x".repeat(1001) }).success).toBe(false);
  });

  it("describes the home from public figures and writes a complete FUB note", () => {
    expect(publicHomeLine({ key: "a1b2c3d4e5f6", area: "East San Antonio", price: 329_990, beds: 3, sqft: 1800, kind: "quick_move_in" })).toBe("3 beds · 1,800 sq ft · $329,990 · Move-in ready · East San Antonio");
    expect(publicHomeLine(undefined)).toBeNull();
    const note = detailsRequestNote({ publicLine: "3 beds · $329,990", privateLine: "Home: 123 Oak St in Sienna Lakes by Chesmar", notes: "Need a big yard", agentName: "Tiffany Proske", sourceCode: "agent-page", consentAt: new Date("2026-10-31T15:00:00Z"), ip: "1.2.3.4", isTest: false });
    expect(note).toContain("asked for this home's details (no text code)");
    expect(note).toContain("Card they tapped: 3 beds · $329,990");
    expect(note).toContain("Home: 123 Oak St in Sienna Lakes by Chesmar");
    expect(note).toContain("Their notes: Need a big yard");
    expect(note).toContain("Came through Tiffany Proske's Builder Deals link.");
    expect(note).toContain("TCPA consent captured: 2026-10-31T15:00:00.000Z");
    expect(note).toContain(`Consent text: ${DETAILS_CONSENT_TEXT}`);
    expect(detailsRequestNote({ publicLine: null, privateLine: null, sourceCode: "ig", consentAt: new Date(), ip: "1", isTest: true })).toContain("Card they tapped: not specified (ask which home)");
  });

  it("uses the sign-up's consent wording, named for this button, on both sides", () => {
    expect(DETAILS_CONSENT_TEXT).toBe(DEALS_DETAILS_CONSENT_TEXT);
    expect(DETAILS_CONSENT_TEXT.startsWith("By tapping Send me the details, you agree that Lifestyle Design Realty may call and text you")).toBe(true);
  });
});

describe("details request: Follow Up Boss", () => {
  const savedKey = process.env.FUB_API_KEY;
  beforeEach(() => { process.env.FUB_API_KEY = "test-key"; });
  afterEach(() => { vi.restoreAllMocks(); process.env.FUB_API_KEY = savedKey; });
  type Call = { url: string; method: string; body: Record<string, unknown> | null };
  const mock = (answer: (call: Call) => Response) => {
    const calls: Call[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = { url: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null };
      calls.push(call);
      return answer(call);
    });
    return calls;
  };
  const input = { name: "Maria Lopez", phone: "+12105550123", email: "maria@example.com", note: "note", agent: { name: "Tiffany Proske", fubUserId: "77", email: null }, isTest: false };

  it("posts one IG Builder Deals inquiry assigned to the agent whose link they used, with the details tag", async () => {
    const calls = mock((call) => call.url.endsWith("/events") ? new Response(JSON.stringify({ id: 901, assignedUserId: 77 }), { status: 201 }) : new Response("{}", { status: 200 }));
    const result = await sendBuilderDealsDetailsRequestToFub(input);
    expect(result).toEqual({ ok: true, personId: "901" });
    const event = calls.find((call) => call.url.endsWith("/events"))!;
    expect(event.body?.source).toBe("IG Builder Deals");
    expect(event.body?.type).toBe("Property Inquiry");
    const person = event.body?.person as Record<string, unknown>;
    expect(person.firstName).toBe("Maria");
    expect(person.lastName).toBe("Lopez");
    expect(person.phones).toEqual([{ value: "+12105550123" }]);
    expect(person.emails).toEqual([{ value: "maria@example.com" }]);
    expect(person.assignedUserId).toBe(77);
    expect(person.tags).toEqual(["IG Builder Deals", DETAILS_REQUEST_TAG, AGENT_PAGE_TAG]);
    // already assigned by FUB: no extra PUT
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(0);
  });

  it("assigns a new contact FUB left unassigned, and reports a lead flow that ignores the event", async () => {
    const calls = mock((call) => call.url.endsWith("/events") ? new Response(JSON.stringify({ id: 902 }), { status: 201 }) : new Response("{}", { status: 200 }));
    expect((await sendBuilderDealsDetailsRequestToFub(input)).ok).toBe(true);
    const put = calls.find((call) => call.method === "PUT")!;
    expect(put.url).toContain("/people/902");
    expect(put.body?.assignedUserId).toBe(77);
    mock(() => new Response(null, { status: 204 }));
    const ignored = await sendBuilderDealsDetailsRequestToFub(input);
    expect(ignored.ok).toBe(false);
    expect(ignored.ok === false && ignored.terminal).toBe(true);
  });
});

describe("details request: the page", async () => {
  const { DetailsRequestSheet, DETAILS_CONSENT, detailsProblem, detailsSummary } = await import("../client/src/components/deals/DetailsRequestSheet");
  it("asks for name, mobile and email (required) and notes (optional), with the consent under the button", () => {
    expect(DETAILS_CONSENT).toBe(DEALS_DETAILS_CONSENT_TEXT);
    expect(detailsProblem({ name: "M", phone: "2105550123", email: "a@b.co" })).toBe("Enter your name.");
    expect(detailsProblem({ name: "Maria", phone: "210555", email: "a@b.co" })).toBe("Enter your mobile number.");
    expect(detailsProblem({ name: "Maria", phone: "(210) 555-0123", email: "nope" })).toBe("Enter a valid email.");
    expect(detailsProblem({ name: "Maria", phone: "(210) 555-0123", email: "maria@example.com" })).toBeNull();
    expect(detailsSummary({ area: "Seguin", price: 301_966, beds: 4, sqft: 2100 })).toBe("4 beds · 2,100 sq ft · $301,966 · Seguin");
    const src = read("client/src/components/deals/DetailsRequestSheet.tsx");
    for (const id of ['id="details-name"', 'id="details-phone"', 'id="details-email"', 'id="details-notes"']) expect(src).toContain(id);
    expect(src).not.toMatch(/one-time-code|6-digit/);
    expect(typeof DetailsRequestSheet).toBe("function");
  });

  it("promises only that an agent will reach out: no home details by text, no timing (Peter, Nov 7)", async () => {
    const { DETAILS_COPY } = await import("../client/src/components/deals/DetailsRequestSheet");
    expect(DETAILS_COPY.intro).toBe("An agent will reach out and go over some options with you.");
    expect(DETAILS_COPY.doneBody).toBe("An agent will reach out and go over some options with you.");
    const shown = Object.values(DETAILS_COPY).map((v) => (typeof v === "function" ? v("Maria") : v)).join(" ");
    expect(shown).not.toMatch(/minutes|address|community|shortly|text you/i);
  });

  it("opens from every public 'Get this home's details' with the home attached; an agent's client link still verifies", () => {
    const page = read("client/src/components/deals/PublicDealsPage.tsx");
    expect(page.match(/onTour\(\{ key: community\.key, area: community\.area, price: home\.price/g)?.length).toBe(2);
    expect(page).toContain("onTour={(entry) => onTour({ key: entry.key, area: entry.community.area");
    const deals = read("client/src/pages/Deals.tsx");
    expect(deals).toContain("const askForDetails = (home?: DetailsContext) => { if (shared || askToConnect) setGateOpen(true); else setDetails(home ?? null); };");
    expect(deals).toContain("onTour={askForDetails}");
    expect(read("server/dealsRouter.ts")).toContain("requestDetails: publicProcedure.input(detailsRequestInput)");
  });
});
