import { describe, expect, it } from "vitest";
import {
  aptInvoiceNumber, canAdvanceLease, clientOption, clientOptionsMessage, commissionFor, guestCardLetter, invoiceAgeDays, invoiceLetter, leaseVerificationLetter, locatorResults, matchesSearch, publicResults, scrubApartmentText,
  type AptAgent, type AptBrokerage, type AptClient, type AptFloorplan, type AptProperty,
} from "../shared/apartments";

/**
 * Apartment locating (Nov 17, 2026): the money math, what a renter may see, and the three letters that protect a
 * commission (guest card, lease verification, invoice). All fixtures are invented.
 */
const TODAY = "2026-11-17";
const plan = (id: number, beds: number, rentMin: number, over: Partial<AptFloorplan> = {}): AptFloorplan => ({ id, name: `A${id}`, beds, baths: beds ? beds : 1, sqft: 600 + beds * 250, rentMin, rentMax: rentMin + 150, availableCount: 2, availableOn: "2026-12-01", ...over });
const property = (id: number, over: Partial<AptProperty> = {}): AptProperty => ({
  id, name: `Fixture Flats ${id}`, managementCompany: "Sample Residential", address: `${id}00 Fixture Pkwy, San Antonio, TX 78216`, city: "San Antonio", zip: "78216", lat: 29.5512, lng: -98.4873, areaLabel: "North Central San Antonio",
  phone: "(210) 555-0100", leasingEmail: `leasing${id}@fixtureflats.example`, website: "https://www.fixtureflats.example/sa", yearBuilt: 2019, unitCount: 300,
  sendPercent: 50, escortPercent: 100, flatFee: null, minLeaseMonths: 12, bonusAmount: null, bonusNote: null, bonusExpiresOn: null, commissionNote: null, commissionVerifiedOn: "2026-11-10",
  registrationRequired: true, invoiceEmail: null, specialText: null, specialExpiresOn: null, brokenLease: "unknown", eviction: "no", felony: "no", misdemeanor: "unknown", minCreditScore: 600, incomeMultiple: 3, incomeRestricted: false,
  petPolicy: "Two pets, 75 lb limit", amenities: ["Pool", "Garage parking"], photos: [], floorplans: [plan(id * 10 + 1, 1, 1_200), plan(id * 10 + 2, 2, 1_600)], active: true, ...over,
});
const agent: AptAgent = { name: "Sample Agent", phone: "(210) 555-0142", email: "agent@brokerage.example", licenseNumber: "0000000" };
const brokerage: AptBrokerage = { name: "Lifestyle Design Realty", address: "1212 Chicon St Unit 101, Austin TX 78702", phone: "(210) 981-3830", email: "team@brokerage.example", licenseNumber: null };
const client: AptClient = { name: "Sample Renter", phone: "(210) 555-0199", email: "renter@mail.example", moveDate: "2026-12-15", beds: 2, budgetMax: 1_700 };

describe("what a lease pays", () => {
  it("send and escort rates, a flat fee, and a bonus only while it runs", () => {
    const base = { rent: 1_600, termMonths: 12, leaseSignedOn: TODAY, today: TODAY };
    expect(commissionFor({ ...base, property: property(1), method: "send" })).toMatchObject({ percent: 50, base: 800, bonus: 0, total: 800, confirm: [] });
    expect(commissionFor({ ...base, property: property(1), method: "escort" })).toMatchObject({ percent: 100, total: 1_600, confirm: [] });
    expect(commissionFor({ ...base, property: property(1, { sendPercent: null, escortPercent: null, flatFee: 500 }), method: "send" })).toMatchObject({ percent: null, total: 500, line: "flat fee $500" });
    const bonus = property(1, { bonusAmount: 250, bonusExpiresOn: "2026-11-30" });
    expect(commissionFor({ ...base, property: bonus, method: "escort" })).toMatchObject({ bonus: 250, total: 1_850 });
    expect(commissionFor({ ...base, property: bonus, method: "escort", leaseSignedOn: "2026-12-01" })).toMatchObject({ bonus: 0, total: 1_600 });
  });

  it("never guesses: a missing rate, a short lease and an old figure come back as things to confirm", () => {
    const base = { rent: 1_600, leaseSignedOn: TODAY, today: TODAY };
    // No escort rate: the send rate is used and said so. No send rate: escort is never used for a send.
    expect(commissionFor({ ...base, termMonths: 12, property: property(1, { escortPercent: null }), method: "escort" })).toMatchObject({ total: 800, confirm: ["no escort rate on file: the send rate was used"] });
    expect(commissionFor({ ...base, termMonths: 12, property: property(1, { sendPercent: null }), method: "send" })).toMatchObject({ total: 0, confirm: ["no commission on file for this property"] });
    expect(commissionFor({ ...base, termMonths: 6, property: property(1), method: "send" }).confirm[0]).toMatch(/6-month lease is shorter than the 12 months/);
    expect(commissionFor({ ...base, termMonths: 12, property: property(1, { commissionVerifiedOn: "2026-10-01" }), method: "send" }).confirm[0]).toMatch(/more than 30 days ago/);
    expect(commissionFor({ ...base, termMonths: 12, property: property(1, { commissionVerifiedOn: null }), method: "send" }).confirm).toEqual(["the commission has never been confirmed with the property"]);
  });
});

describe("search", () => {
  const all = [
    property(1),
    property(2, { escortPercent: 125, floorplans: [plan(21, 2, 1_650)] }),
    property(3, { sendPercent: null, escortPercent: null, brokenLease: "yes", eviction: "case_by_case", minCreditScore: null, floorplans: [plan(31, 2, 1_100)] }),
    property(4, { city: "Austin", areaLabel: "East Austin", floorplans: [plan(41, 2, 1_900, { availableOn: "2027-02-01" })] }),
    property(5, { active: false }),
  ];

  it("locators see what pays most first; an unknown policy is never a yes", () => {
    const results = locatorResults(all, { city: "san antonio", beds: 2, maxRent: 1_700 }, TODAY);
    expect(results.map((entry) => [entry.property.id, entry.pays])).toEqual([[2, 2_063], [1, 1_600], [3, 0]]);
    expect(locatorResults(all, { beds: 2, paysOnly: true }, TODAY).map((entry) => entry.property.id)).toEqual([2, 4, 1]);
    expect(locatorResults(all, { needsBrokenLeaseOk: true, needsEvictionOk: true }, TODAY).map((entry) => entry.property.id)).toEqual([3]);
    expect(matchesSearch(all[0]!, { creditScore: 580 })).toBe(false);
    expect(matchesSearch(all[2]!, { creditScore: 580 })).toBe(true);
    // Move date: a plan that opens after the move is out; inactive properties never show.
    expect(locatorResults(all, { city: "Austin", moveBy: "2026-12-31" }, TODAY)).toEqual([]);
    expect(locatorResults(all, {}, TODAY).some((entry) => entry.property.id === 5)).toBe(false);
  });

  it("renters see rent, area and what is accepted, cheapest first, and nothing that names or pays", () => {
    const special = property(6, { specialText: "Fixture Flats 6 by Sample Residential: 6 weeks free! Call (210) 555-0100 or visit www.fixtureflats.example/sa, 600 Fixture Pkwy", specialExpiresOn: "2026-12-31" });
    const results = publicResults([...all, special], { city: "San Antonio", beds: 2 }, TODAY);
    expect(results.map((entry) => entry.rentFrom)).toEqual([1_100, 1_600, 1_600, 1_650]);
    expect(results[0]).toMatchObject({ areaLabel: "North Central San Antonio", acceptsBrokenLease: true, acceptsEviction: true });
    const text = JSON.stringify(results);
    for (const secret of ["Fixture Flats", "Sample Residential", "Fixture Pkwy", "555-0100", "fixtureflats", "leasing", "sendPercent", "escortPercent", "flatFee", "bonus", "commission"]) expect(text, secret).not.toContain(secret);
    expect(results.find((entry) => entry.special)!.special).toBe("this community by this community: 6 weeks free! Call or visit this community");
    // An ended special is not shown.
    expect(publicResults([property(7, { specialText: "One month free", specialExpiresOn: "2026-11-01" })], {}, TODAY)[0]!.special).toBeNull();
    // A renter's own filter cannot be turned into a commission probe.
    expect(publicResults(all, { paysOnly: true, beds: 2, city: "San Antonio" }, TODAY)).toHaveLength(3);
    expect(scrubApartmentText("Email leasing1@fixtureflats.example", property(1))).toBe("Email");
  });
});

describe("the paperwork", () => {
  const lease = { unit: "1204", rent: 1_600, termMonths: 12, leaseStartOn: "2026-12-15", leaseSignedOn: "2026-11-20", method: "escort" as const };

  it("guest card: registers the client before the visit and says who referred them and how they will visit", () => {
    const letter = guestCardLetter({ property: property(1), client, agent, brokerage, method: "send", visitOn: "2026-11-19", sentOn: TODAY });
    expect(letter.to).toBe("leasing1@fixtureflats.example");
    expect(letter.subject).toBe("Locator guest card: Sample Renter (Lifestyle Design Realty)");
    expect(letter.body).toContain("register my client below as a locator referral from Lifestyle Design Realty, dated 2026-11-17");
    expect(letter.body).toContain("my client will visit on their own on 2026-11-19 and will name me as their locator");
    expect(letter.body).toContain("Looking for: 2 bedroom");
    expect(letter.body).toContain("TREC License 0000000");
    expect(guestCardLetter({ property: property(1), client, agent, brokerage, method: "escort", visitOn: null, sentOn: TODAY }).body).toContain("I will tour with my client.");
    // A missing detail is left out, never printed as "null".
    expect(guestCardLetter({ property: property(1), client: { ...client, email: null, budgetMax: null }, agent: { ...agent, licenseNumber: null }, brokerage, method: "send", visitOn: null, sentOn: TODAY }).body).not.toMatch(/null|undefined|TREC License/);
  });

  it("lease verification: asks the property to confirm the lease and the commission before any invoice", () => {
    const letter = leaseVerificationLetter({ property: property(1, { bonusAmount: 250, bonusExpiresOn: "2026-11-30" }), client, agent, brokerage, lease, guestCardSentOn: TODAY, today: "2026-11-21" });
    expect(letter.commission.total).toBe(1_850);
    expect(letter.subject).toBe("Lease verification request: Sample Renter, unit 1204");
    expect(letter.body).toContain("registered as my referral on 2026-11-17");
    expect(letter.body).toContain("Locator commission as we understand it: 100% of $1,600 (escort) + $250 bonus = $1,850");
    expect(leaseVerificationLetter({ property: property(1, { sendPercent: null, escortPercent: null }), client, agent, brokerage, lease, guestCardSentOn: null, today: TODAY }).body).toContain("Locator commission: please state the amount");
  });

  it("invoice: only what the property verified, one stable number per lease, due 30 days after the lease starts", () => {
    const args = { leaseId: 12, property: property(1, { invoiceEmail: "ap@samplemgmt.example" }), client, agent, brokerage, lease, issuedOn: "2026-12-16" };
    expect(() => invoiceLetter({ ...args, verifiedOn: null, verifiedAmount: 1_600 })).toThrow(/has not verified/);
    expect(() => invoiceLetter({ ...args, verifiedOn: "2026-11-22", verifiedAmount: null })).toThrow(/has not verified/);
    const invoice = invoiceLetter({ ...args, verifiedOn: "2026-11-22", verifiedAmount: 1_600 });
    expect(invoice).toMatchObject({ number: "LDR-APT-202612-0012", amount: 1_600, dueOn: "2027-01-14", to: "ap@samplemgmt.example" });
    expect(invoice.body).toContain("AMOUNT DUE: $1,600");
    expect(invoice.body).toContain("Verified by the property on 2026-11-22");
    expect(invoice.body).toContain("Bill to:\nFixture Flats 1\n100 Fixture Pkwy, San Antonio, TX 78216");
    expect(aptInvoiceNumber(12, "2026-12-15")).toBe(invoice.number);
    expect(invoiceLetter({ ...args, property: property(1), verifiedOn: "2026-11-22", verifiedAmount: 1_600 }).to).toBe("leasing1@fixtureflats.example");
  });

  it("a lease moves one honest step at a time", () => {
    expect(canAdvanceLease("reported", "verification_sent")).toBe(true);
    expect(canAdvanceLease("reported", "invoiced")).toBe(false);
    expect(canAdvanceLease("verified", "invoiced")).toBe(true);
    expect(canAdvanceLease("verified", "paid")).toBe(false);
    expect(canAdvanceLease("paid", "invoiced")).toBe(false);
    expect(invoiceAgeDays("2027-01-14", "2027-02-01")).toBe(18);
  });
});

describe("second chance and the client's options", () => {
  const places = [
    property(1),
    property(2, { brokenLease: "yes" }),
    property(3, { eviction: "case_by_case", felony: "yes" }),
    property(4, { incomeRestricted: true, incomeMultiple: 2.5 }),
  ];

  it("second-chance and income-restricted filters work for renters and locators, and unknown is never a yes", () => {
    expect(publicResults(places, { secondChanceOnly: true }, TODAY)).toHaveLength(2);
    expect(publicResults(places, { secondChanceOnly: true }, TODAY).every((entry) => entry.secondChance)).toBe(true);
    expect(publicResults(places, { needsEvictionOk: true, needsFelonyOk: true }, TODAY)).toHaveLength(1);
    expect(publicResults(places, { needsIncomeRestricted: true }, TODAY)).toEqual([expect.objectContaining({ incomeRestricted: true, incomeMultiple: 2.5, secondChance: false })]);
    expect(locatorResults(places, { secondChanceOnly: true }, TODAY).map((entry) => entry.property.id)).toEqual([2, 3]);
    expect(publicResults([property(1)], {}, TODAY)[0]).toMatchObject({ secondChance: false, acceptsBrokenLease: false, acceptsFelony: false });
  });

  it("a renter's map point is the middle of its square, never the property's own coordinates", () => {
    const [entry] = publicResults([property(1)], {}, TODAY);
    expect(entry!.approx!.lat).toBeCloseTo(29.55, 5);
    expect(entry!.approx!.lng).toBeCloseTo(-98.49, 5);
    expect(JSON.stringify(entry)).not.toMatch(/29\.5512|98\.4873/);
    expect(publicResults([property(1, { lat: null, lng: null })], {}, TODAY)[0]!.approx).toBeNull();
  });

  it("the client's list names the community and how to reach it, tells them who to name, and never says what it pays", () => {
    const option = clientOption(property(2, { brokenLease: "yes", specialText: "One month free", bonusAmount: 500, commissionNote: "pays fast" }), TODAY);
    expect(option).toMatchObject({ name: "Fixture Flats 2", address: "200 Fixture Pkwy, San Antonio, TX 78216", phone: "(210) 555-0100", special: "One month free", secondChance: true });
    expect(JSON.stringify(option)).not.toMatch(/Percent|flatFee|bonus|commission|pays fast|leasing2@|invoice/i);
    const message = clientOptionsMessage({ client: { name: "Sample Renter" }, agent, brokerage, count: 3, url: "https://site.example/apartments/list/abc" });
    expect(message.subject).toBe("3 apartments I picked for you");
    expect(message.body).toContain("Hi Sample, here are the 3 apartments I picked for you");
    expect(message.body).toContain('write "Sample Agent, Lifestyle Design Realty" as your locator');
    expect(message.body).toContain("https://site.example/apartments/list/abc");
  });
});
