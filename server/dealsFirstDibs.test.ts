import { describe, expect, it } from "vitest";
import { DEFAULT_PAYMENT_COSTS } from "../shared/dealsFeatured";
import { FIRST_DIBS_CONSENT, normalizeFirstDibsEmail } from "../shared/dealsFirstDibs";
import { SITE } from "../shared/site";
import { firstDibsEmail, firstDibsHomeId, firstDibsHomesForArea, firstDibsLinks, pickFirstDibsHomes, type FirstDibsHome } from "./dealsFirstDibs";
import { firstDibsMessage } from "./dealsFub";

const home = (over: Partial<FirstDibsHome> & { id: string }): FirstDibsHome => ({ communityKey: over.id.slice(0, 3), area: "East San Antonio", price: 250_000, previousPrice: null, beds: 3, baths: 2, sqft: 1500, kind: "quick_move_in", isNew: false, photo: "/deals/pub/img/x", monthly: 2000, veteranMonthly: 1400, ...over });

describe("first dibs: who signs up", () => {
  it("keeps a real address, lowercased and trimmed, and nothing else", () => {
    expect(normalizeFirstDibsEmail("  Maria.Lopez@Example.COM ")).toBe("maria.lopez@example.com");
    expect(normalizeFirstDibsEmail("maria@example")).toBeNull();
    expect(normalizeFirstDibsEmail("maria example.com")).toBeNull();
    expect(normalizeFirstDibsEmail("<script>@x.com")).toBeNull();
    expect(normalizeFirstDibsEmail(`${"a".repeat(250)}@x.com`)).toBeNull();
    expect(normalizeFirstDibsEmail("")).toBeNull();
  });

  it("stores the same consent words the card shows", () => {
    expect(FIRST_DIBS_CONSENT).toMatch(/email you new homes and price drops/);
    expect(FIRST_DIBS_CONSENT).toMatch(/Unsubscribe anytime/);
  });

  it("tells FUB it is email only, with the area, and how they add a number", () => {
    expect(firstDibsMessage("New Braunfels")).toMatch(/first dibs on new deals in New Braunfels\. Email only, no phone yet/);
    expect(firstDibsMessage("")).toMatch(/in any area/);
    expect(firstDibsMessage("Seguin", true)).toMatch(/^Signed up again/);
  });
});

describe("first dibs: which homes an email carries", () => {
  it("weekly: only new homes and price drops not sent before; none means no email", () => {
    const homes = [home({ id: "aaa:1", isNew: true }), home({ id: "bbb:1", previousPrice: 260_000 }), home({ id: "ccc:1" }), home({ id: "ddd:1", isNew: true })];
    expect(pickFirstDibsHomes(homes, { weekly: true, sent: new Set(["ddd:1"]) }).map((item) => item.id).sort()).toEqual(["aaa:1", "bbb:1"]);
    expect(pickFirstDibsHomes([home({ id: "ccc:1" })], { weekly: true, sent: new Set() })).toEqual([]);
  });

  it("welcome: new and dropped first, then the lowest monthly; photos first; one per community before repeats", () => {
    const homes = [home({ id: "aaa:1", monthly: 1800 }), home({ id: "aaa:2", monthly: 1700 }), home({ id: "bbb:1", monthly: 2500, isNew: true }), home({ id: "ccc:1", monthly: 1500, photo: null }), home({ id: "ddd:1", monthly: 2100 })];
    const picked = pickFirstDibsHomes(homes, { weekly: false, sent: new Set(), limit: 4 }).map((item) => item.id);
    expect(picked).toEqual(["bbb:1", "aaa:2", "ddd:1", "ccc:1"]);
    expect(pickFirstDibsHomes(homes, { weekly: false, sent: new Set(), limit: 5 }).map((item) => item.id)).toContain("aaa:1");
  });

  it("ids match the page's hearts (community key, price, size, kind)", () => {
    expect(firstDibsHomeId("abc123abc123", { price: 250_000, sqft: 1500, kind: "quick_move_in" })).toBe("abc123abc123:250000:1500:quick_move_in");
  });

  it("figures the monthly total only at a builder rate with its APR, with the veteran figure beside it", async () => {
    const catalog = async () => [
      { key: "k1", area: "East San Antonio", incentive: { headlineRate: "4.99%", followOnRate: null, apr: "5.62%", loanType: "FHA", downPayment: "3.5% down" } },
      { key: "k2", area: "East San Antonio", incentive: { headlineRate: "4.99%", followOnRate: null, apr: null, loanType: "FHA", downPayment: null } },
      { key: "k3", area: "Seguin", incentive: null },
    ];
    const homes = async () => [{ kind: "quick_move_in", beds: 3, baths: 2, sqft: 1500, price: 250_000, previousPrice: null, isNew: true, photos: ["/deals/pub/img/t1"] }];
    const assumptions = async () => ({ defaultDownPercent: 5, termYears: 30, costs: DEFAULT_PAYMENT_COSTS });
    const east = await firstDibsHomesForArea("East San Antonio", { catalog, homes, assumptions });
    expect(east).toHaveLength(2);
    const [rated, noApr] = east;
    expect(rated!.monthly).toBeGreaterThan(1900);
    expect(rated!.veteranMonthly).toBe(rated!.monthly! - Math.round((250_000 * DEFAULT_PAYMENT_COSTS.taxRatePercent) / 100 / 12));
    expect(noApr!.monthly).toBeNull();
    expect(noApr!.veteranMonthly).toBeNull();
    expect(await firstDibsHomesForArea("", { catalog, homes, assumptions })).toHaveLength(3);
  });
});

describe("first dibs: the email", () => {
  const homes = [home({ id: "k1:1", communityKey: "abc123abc123", isNew: true }), home({ id: "k2:1", communityKey: "def456def456", previousPrice: 265_000, monthly: null, veteranMonthly: null, photo: null })];
  const email = firstDibsEmail({ area: "East San Antonio", token: "tok_abcdefghijklmnop", homes, weekly: false });

  it("links only to public pages: the home's area sheet, the phone sign-up and the unsubscribe", () => {
    const links = firstDibsLinks("tok_abcdefghijklmnop");
    expect(email.html).toContain(links.home("abc123abc123"));
    expect(email.html).toContain(links.addNumber);
    expect(email.html).toContain(links.unsubscribe);
    expect(links.addNumber).toMatch(/\/deals\?gate=1&src=firstdibs$/);
    expect(email.text).toContain(links.unsubscribe);
    const hrefs = Array.from(email.html.matchAll(/href="([^"]+)"/g), (match) => match[1]!);
    expect(hrefs.every((href) => href.startsWith("https://lifestyledesignrealty.com/deals"))).toBe(true);
  });

  it("carries the unsubscribe headers, the postal address and the estimate wording", () => {
    expect(email.headers["List-Unsubscribe"]).toBe(`<${firstDibsLinks("tok_abcdefghijklmnop").unsubscribe}>`);
    expect(email.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(email.html).toContain(SITE.address);
    expect(email.text).toContain(SITE.address);
    expect(email.text).toMatch(/estimates at the builder's rate/);
  });

  it("shows the price, the drop, the monthly total and the veteran figure; no monthly without one", () => {
    expect(email.html).toContain("$250,000");
    expect(email.html).toContain("$15,000 off");
    expect(email.html).toContain("$2,000");
    expect(email.html).toMatch(/100% disabled veteran: about \$1,400\/mo/);
    expect(email.text.match(/\/mo est\./g)).toHaveLength(1);
    expect(email.subject).toBe("Your first dibs: new-build deals in East San Antonio");
    expect(firstDibsEmail({ area: "", token: "tok_abcdefghijklmnop", homes, weekly: true }).subject).toBe("2 new deals this week");
  });

  it("escapes what it prints", () => {
    const odd = firstDibsEmail({ area: "<b>x</b>", token: "tok_abcdefghijklmnop", homes: [home({ id: "k:1", area: "<img src=x>" })], weekly: false });
    expect(odd.html).not.toContain("<img src=x>");
    expect(odd.html).not.toContain("<b>x</b>");
  });
});
