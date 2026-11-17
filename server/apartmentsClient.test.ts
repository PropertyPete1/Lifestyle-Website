import { describe, expect, it } from "vitest";
import { EMPTY_APT_FILTERS, gmailLetterHref, letterAppHref, needsSummary, searchInput, smsHref } from "../client/src/lib/apartments";
import { isExitIntentExcluded } from "../client/src/components/ExitIntentModal";

/** Apartment screens: what the boxes send to the search, and where a drafted letter opens. */
describe("apartment screens", () => {
  it("blank boxes are left out; second-chance needs go through as flags and into the lead note", () => {
    expect(searchInput(EMPTY_APT_FILTERS)).toEqual({});
    const filters = { ...EMPTY_APT_FILTERS, city: "San Antonio", beds: "0", maxRent: "$1,500", moveBy: "2026-12-15", needs: { needsBrokenLeaseOk: true, needsEvictionOk: false, needsIncomeRestricted: true }, secondChanceOnly: true };
    expect(searchInput(filters)).toEqual({ city: "San Antonio", beds: 0, maxRent: 1500, moveBy: "2026-12-15", needsBrokenLeaseOk: true, needsIncomeRestricted: true, secondChanceOnly: true });
    expect(needsSummary(filters)).toBe("in San Antonio, Studio, up to $1500, moving by 2026-12-15, needs: broken lease, needs: income-based rent, second chance");
    expect(needsSummary(EMPTY_APT_FILTERS)).toBe("No filters chosen");
  });

  it("a letter opens in the locator's own Lifestyle Gmail, in the Gmail app on an iPhone, and a text carries the body", () => {
    const letter = { to: "leasing@fixture.example", subject: "Guest card: A & B", body: "Line 1\nLine 2" };
    expect(gmailLetterHref(letter, "Agent@LifestyleDesignRealty.com")).toBe("https://mail.google.com/mail/u/agent%40lifestyledesignrealty.com/?view=cm&fs=1&tf=1&to=leasing%40fixture.example&su=Guest%20card%3A%20A%20%26%20B&body=Line%201%0ALine%202");
    expect(gmailLetterHref({ ...letter, to: null }, "someone@gmail.com")).toContain("/mail/u/0/?view=cm&fs=1&tf=1&su=");
    expect(letterAppHref(letter, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("googlegmail://co?to=leasing%40fixture.example&subject=Guest%20card%3A%20A%20%26%20B&body=Line%201%0ALine%202");
    expect(letterAppHref(letter, "Mozilla/5.0 (Linux; Android 15)")).toMatch(/^mailto:leasing%40fixture\.example\?subject=/);
    expect(letterAppHref(letter, "Mozilla/5.0 (Windows NT 10.0)")).toBeNull();
    expect(smsHref("Hi there", "(210) 555-0199", "iPhone")).toBe("sms:2105550199&body=Hi%20there");
    expect(smsHref("Hi there", null, "Android")).toBe("sms:?body=Hi%20there");
  });

  it("the site-wide exit pop-up stays off the apartment pages", () => {
    expect(isExitIntentExcluded("/apartments")).toBe(true);
    expect(isExitIntentExcluded("/apartments/list/abc")).toBe(true);
  });
});
