import { describe, expect, it } from "vitest";
import { hasPrivateTerm, normalizeUsPhone, normalizedDealSourceKey, sanitizeInstagramHandle, scrubPrivateNames } from "../shared/deals";
import { DEALS_OG_DESCRIPTION, DEALS_OG_TITLE, DEALS_OG_IMAGE } from "./ogMeta";

const privateTerms = ["Sienna Lakes", "Vista Gardens", "Chesmar", "M/I Homes", "Rio Grande", "7711 Hanging Basket"];

describe("Builder Deals privacy boundary", () => {
  it("normalizes valid US mobile numbers to E.164", () => {
    expect(normalizeUsPhone("(210) 555-0123")).toEqual({ ok: true, e164: "+12105550123", display: "(210) 555-0123" });
  });

  it("rejects non-US numbers unless Canada is expressly enabled", () => {
    expect(normalizeUsPhone("+44 20 7946 0958")).toMatchObject({ ok: false, reason: "outside_us" });
    expect(normalizeUsPhone("+1 416 555 0123")).toMatchObject({ ok: false, reason: "outside_us" });
    expect(normalizeUsPhone("+1 416 555 0123", { allowCanada: true })).toMatchObject({ ok: true, e164: "+14165550123" });
  });

  it("drops the Instagram placeholder instead of storing or displaying it", () => {
    expect(sanitizeInstagramHandle("{{username}}")).toBeNull();
    expect(sanitizeInstagramHandle("@property.pete_tx")).toBe("property.pete_tx");
  });

  it("keys a source URL the same however its path is spelled: case of the host, a trailing slash, a query, an apostrophe or its percent escape", () => {
    expect(normalizedDealSourceKey("https://WWW.tollbrothers.com/luxury-homes-for-sale/Texas/Toll-Brothers-at-George%27s-Ranch/?utm=x#top")).toBe(normalizedDealSourceKey("https://www.tollbrothers.com/luxury-homes-for-sale/Texas/Toll-Brothers-at-George's-Ranch"));
    expect(normalizedDealSourceKey("not a url")).toMatch(/^invalid:/);
  });

  it("replaces configured private names and detects residual terms", () => {
    const scrubbed = scrubPrivateNames("Sienna Lakes by Chesmar", privateTerms);
    expect(hasPrivateTerm(scrubbed, privateTerms)).toBe(false);
    expect(hasPrivateTerm("Visit 7711 Hanging Basket", privateTerms)).toBe(true);
    // A double space or a line break inside a name is the same name: scrubbed, not left for the residue check to drop.
    expect(scrubPrivateNames("Sienna  Lakes by Chesmar", privateTerms)).not.toMatch(/Sienna/);
    expect(scrubPrivateNames("Sienna\nLakes amenity center", privateTerms)).toBe("this community amenity center");
    // A builder's name before "homes" or "community" drops out; elsewhere it reads "the builder".
    const builder = { builder: ["Centex Homes", "Centex"], lender: ["Pulte Mortgage"], community: [], plan: [], street: [], other: [] };
    expect(scrubPrivateNames("Save up to $43,000 on select Centex homes, built by Centex with financing through Pulte Mortgage.", builder)).toBe("Save up to $43,000 on select homes, built by the builder with financing through the builder's lender.");
    expect(scrubPrivateNames("When you purchase a new Centex® home, you receive $2,000.", builder)).toBe("When you purchase a new home, you receive $2,000.");
    // "of" is not a lead: the builder's own name after it keeps "the builder". A replacement that opens a sentence is capitalised.
    const davidson = { builder: ["Davidson Homes", "Davidson"], lender: ["NorthStar Mortgage"], community: [], plan: [], street: [], other: [] };
    expect(scrubPrivateNames("Experience the quality of Davidson Homes. NorthStar Mortgage is an Equal Opportunity Lender.", davidson)).toBe("Experience the quality of the builder. The builder's lender is an Equal Opportunity Lender.");
    expect(scrubPrivateNames("Davidson Homes builds here.", davidson)).toBe("The builder builds here.");
    // "a new Toll Brothers quick move-in home" reads as "a new quick move-in home".
    expect(scrubPrivateNames("Choose a beautiful new Toll Brothers quick move-in home now.", { builder: ["Toll Brothers"], lender: [], community: [], plan: [], street: [], other: [] })).toBe("Choose a beautiful new quick move-in home now.");
  });

  it("keeps the only shareable Deals metadata generic and landing-only", () => {
    const og = `${DEALS_OG_TITLE} ${DEALS_OG_DESCRIPTION} ${DEALS_OG_IMAGE}`;
    expect(og).toContain("This week's best new-build deals in San Antonio");
    expect(hasPrivateTerm(og, privateTerms)).toBe(false);
    expect(DEALS_OG_IMAGE).toMatch(/^\/manus-storage\/builder-deals-og-card_/);
  });
});

describe("opaque handles", () => {
  it("keys card and community handles with the server secret: a listing URL's plain hash is not its card", async () => {
    const { dealsCardHandle, dealsHandle, hashSecret } = await import("./dealsService");
    const key = hashSecret("https://www.example-builder.com/homes/1");
    expect(dealsCardHandle(key)).toMatch(/^[0-9a-f]{20}$/);
    expect(dealsCardHandle(key)).not.toBe(hashSecret(`deals-card:${key}`).slice(0, 20));
    expect(dealsCardHandle(key)).toBe(dealsCardHandle(key));
    expect(dealsHandle("deals-community:7", 16)).not.toBe(hashSecret("deals-community:7").slice(0, 16));
  });
});
