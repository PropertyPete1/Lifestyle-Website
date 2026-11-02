import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { displayForLead } from "../shared/deals";

(globalThis as { React?: typeof React }).React = React;
const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf-8");

/** Nov 1, 2026 (Peter: an agent's link "should just open for whoever gets sent the link"). */
describe("the page opens an agent's link with no form", () => {
  it("shows 'Opening your list' and posts the link to /deals/open (never a GET a link preview could fire)", async () => {
    const { OpeningClientList } = await import("../client/src/pages/Deals");
    const html = renderToStaticMarkup(React.createElement(OpeningClientList, { token: "Abc123_-Abc123_-Abc123_-Abc123_-", submit: true, agentName: "Peter Allen" }));
    expect(html).toContain("Shared by Peter Allen");
    expect(html).toContain("Opening your list");
    expect(html).toMatch(/<form[^>]*action="\/deals\/open"[^>]*method="post"/);
    expect(html).toContain('name="c" value="Abc123_-Abc123_-Abc123_-Abc123_-"');
    expect(html).not.toContain('id="deals-phone"');
  });

  it("opens only an unlocked live link, with no team session, and the server's ?code=1 goes back to the gate", () => {
    const src = read("client/src/pages/Deals.tsx");
    expect(src).toContain('const opensDirectly = Boolean(linkToken && shared && "opensDirectly" in shared && shared.opensDirectly && !backToGate && !teamSession && (!hasSession || state.data?.connectOffer === "open"));');
    expect(src).toContain("if (clientToken && !backToGate && (state.isLoading || opensDirectly)) return <OpeningClientList");
    const routes = read("server/dealsRoutes.ts");
    expect(routes).toContain('app.post("/deals/open"');
    expect(routes).not.toContain('app.get("/deals/open"');
  });

  it("a lead with no phone is named, never shown as a masked number", () => {
    expect(displayForLead({ name: "Karyme Lopez", phoneE164: null })).toBe("Karyme Lopez");
    expect(displayForLead({ phoneE164: null })).toBe("Your agent's client");
  });
});
