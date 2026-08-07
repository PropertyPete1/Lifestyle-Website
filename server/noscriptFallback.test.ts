/**
 * The site is a client-rendered SPA: with JavaScript disabled, `#root` stays
 * empty and the page is entirely blank — no brokerage name, no phone, no TREC
 * notices. TREC requires the brokerage to be identified on its own website, so
 * "blank" is the one rendering outcome that is not acceptable.
 *
 * This pins the static floor in index.html. It is not SSR and does not pretend
 * to be; it is the identification and contact path a no-JS visitor (or a
 * crawler that does not execute JS) must still get.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const html = readFileSync(join(process.cwd(), "client", "index.html"), "utf-8");
const noscript = html.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1] ?? "";

describe("no-JS fallback", () => {
  it("exists at all", () => {
    expect(noscript.trim().length, "index.html must contain a <noscript> block").toBeGreaterThan(0);
  });

  it("identifies the brokerage", () => {
    expect(noscript).toMatch(/LIFESTYLE DESIGN/i);
    expect(noscript).toMatch(/REALTY/i);
  });

  it("gives a working contact route", () => {
    expect(noscript).toMatch(/tel:\+12109813830/);
    expect(noscript).toMatch(/team@lifestyledesignrealty\.com/);
    expect(noscript).toMatch(/1212 Chicon St/);
  });

  it("carries the TREC notices and the privacy link", () => {
    expect(noscript).toMatch(/Information About Brokerage Services/);
    expect(noscript).toMatch(/Consumer Protection Notice/);
    expect(noscript).toMatch(/trec\.texas\.gov/);
    expect(noscript).toMatch(/href="\/privacy"/);
  });

  it("carries the deemed-reliable disclaimer and EHO", () => {
    expect(noscript).toMatch(/deemed reliable but not guaranteed/i);
    expect(noscript).toMatch(/Equal Housing Opportunity/i);
  });

  it("is self-contained — no dependency on the JS bundle or its CSS", () => {
    expect(noscript).not.toMatch(/<script/i);
    // Styling is inline so it still reads if the stylesheet never applies.
    expect(noscript).toMatch(/style="/);
  });

  it("keeps the phone number consistent with the rest of the site", async () => {
    const { SITE } = await import("../shared/site");
    expect(noscript).toContain(SITE.email);
    expect(noscript).toContain(SITE.phone.replace(/[^\d]/g, "").slice(0, 3)); // area code
    expect(noscript).toContain(SITE.iabsUrl);
    expect(noscript).toContain(SITE.cpnUrl);
  });
});
