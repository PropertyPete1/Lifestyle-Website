import { beforeEach, describe, expect, it, vi } from "vitest";
import { aptFloorplans, aptGuestCards, aptLeases, aptProperties, dealTeamAllowlist } from "../drizzle/schema";
import { FakeDealsDb } from "./dealsSync.fakeDb";

/**
 * Apartment locating storage: a property import that can be run twice, a locator's own clients and paperwork, and
 * a lease that reaches an invoice only through the property's verification. Fixtures are invented.
 */
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));

import { publicResults } from "../shared/apartments";
import { addAptClient, clientListByToken, confirmCommission, createClientList, draftGuestCard, draftInvoice, draftLeaseVerification, importApartments, loadApartments, locatorBook, markGuestCard, markLeasePaid, markVerificationSent, recordVerification, reportLease, type AptPropertyInput } from "./apartmentsStore";

const TODAY = "2026-11-17";
const flats: AptPropertyInput = {
  sourceKey: "manual:fixture-flats", name: "Fixture Flats", managementCompany: "Sample Residential", address: "100 Fixture Pkwy, San Antonio, TX 78216", city: "San Antonio", areaLabel: "North Central San Antonio",
  leasingEmail: "leasing@fixtureflats.example", sendPercent: 50, escortPercent: 100, commissionVerifiedOn: "2026-11-10", brokenLease: "case_by_case", amenities: ["Pool"],
  floorplans: [{ name: "A1", beds: 1, baths: 1, sqft: 700, rentMin: 1_200, rentMax: 1_300 }, { name: "B1", beds: 2, baths: 2.5, sqft: 1_100, rentMin: 1_600, rentMax: 1_750 }],
};

let db: FakeDealsDb;
let pete: number;
let other: number;
beforeEach(() => {
  db = new FakeDealsDb();
  mocks.getDb.mockResolvedValue(db);
  pete = db.seed(dealTeamAllowlist, { name: "Sample Locator", phoneE164: "+12105550142", email: "locator@brokerage.example", source: "manual", active: true });
  other = db.seed(dealTeamAllowlist, { name: "Other Locator", phoneE164: "+12105550143", email: "other@brokerage.example", source: "manual", active: true });
});
const propertyId = () => (db.rows(aptProperties) as Array<{ id: number }>)[0]!.id;

describe("property import", () => {
  it("adds once, updates on a rerun, and a rent-only refresh keeps the confirmed commission", async () => {
    expect(await importApartments([flats])).toEqual({ added: 1, updated: 0 });
    expect(await importApartments([flats])).toEqual({ added: 0, updated: 1 });
    expect(db.rows(aptProperties)).toHaveLength(1);
    expect(db.rows(aptFloorplans)).toHaveLength(2);
    await importApartments([{ sourceKey: flats.sourceKey, name: flats.name, address: flats.address, city: flats.city, areaLabel: flats.areaLabel, floorplans: [{ beds: 2, baths: 2.5, rentMin: 1_550 }] }]);
    const [stored] = await loadApartments();
    expect(stored).toMatchObject({ sendPercent: 50, escortPercent: 100, commissionVerifiedOn: "2026-11-10", brokenLease: "case_by_case", amenities: ["Pool"] });
    expect(stored!.floorplans).toEqual([expect.objectContaining({ beds: 2, baths: 2.5, rentMin: 1_550 })]);
    // What a renter gets from the stored row: no name, contact or pay.
    const text = JSON.stringify(publicResults(await loadApartments(), {}, TODAY));
    for (const secret of ["Fixture Flats", "Sample Residential", "Fixture Pkwy", "leasing@", "Percent"]) expect(text, secret).not.toContain(secret);
  });
});

describe("a locator's file, start to paid", () => {
  it("guest card, lease, verification, invoice, payment: each step in order, and only for the locator who owns it", async () => {
    await importApartments([flats]);
    const clientId = await addAptClient(pete, { name: "Sample Renter", phone: "(210) 555-0199", moveDate: "2026-12-15", beds: 2, budgetMax: 1_700 });

    // Guest card: drafted for the locator to send; one record however many times it is redrafted.
    const card = await draftGuestCard(pete, { clientId, propertyId: propertyId(), method: "escort", visitOn: "2026-11-19", today: TODAY });
    expect(card.letter).toMatchObject({ to: "leasing@fixtureflats.example", subject: "Locator guest card: Sample Renter (Lifestyle Design Realty)" });
    expect(card.letter.body).toContain("Sample Locator");
    await draftGuestCard(pete, { clientId, propertyId: propertyId(), method: "send", today: TODAY });
    expect(db.rows(aptGuestCards)).toHaveLength(1);
    await expect(markGuestCard(pete, { id: card.id, confirmedOn: TODAY })).rejects.toThrow(/sent before/);
    await expect(markGuestCard(other, { id: card.id, sentOn: TODAY })).rejects.toThrow(/not one of yours/);
    await markGuestCard(pete, { id: card.id, sentOn: TODAY });
    await markGuestCard(pete, { id: card.id, confirmedOn: "2026-11-18" });

    // Another locator cannot touch this client.
    await expect(draftGuestCard(other, { clientId, propertyId: propertyId(), method: "send", today: TODAY })).rejects.toThrow(/not one of yours/);
    await expect(reportLease(other, { clientId, propertyId: propertyId(), rent: 1_600, termMonths: 12, leaseStartOn: "2026-12-15", leaseSignedOn: "2026-11-20", method: "escort", today: TODAY })).rejects.toThrow(/not one of yours/);

    const lease = await reportLease(pete, { clientId, propertyId: propertyId(), unit: "1204", rent: 1_600, termMonths: 12, leaseStartOn: "2026-12-15", leaseSignedOn: "2026-11-20", method: "escort", today: "2026-11-20" });
    expect(lease).toMatchObject({ expectedAmount: 1_600, confirm: [] });
    await expect(reportLease(pete, { clientId, propertyId: propertyId(), rent: 1_600, termMonths: 12, leaseStartOn: "2026-12-15", leaseSignedOn: "2026-11-20", method: "escort", today: TODAY })).rejects.toThrow(/already on file/);

    // No invoice before the property verifies, and no skipping steps.
    await expect(draftInvoice(pete, lease.id, "2026-11-21")).rejects.toThrow(/cannot go to "invoiced"/);
    await expect(recordVerification(pete, { leaseId: lease.id, verifiedOn: "2026-11-21", verifiedAmount: 1_600 })).rejects.toThrow(/cannot go to "verified"/);
    const letter = await draftLeaseVerification(pete, lease.id, "2026-11-21");
    expect(letter.body).toContain("registered as my referral on 2026-11-17");
    expect(letter.body).toContain("100% of $1,600 (escort) = $1,600");
    await markVerificationSent(pete, lease.id, "2026-11-21");
    expect((await locatorBook(pete)).money).toEqual({ expected: 1_600, verified: 0, invoicedUnpaid: 0, paid: 0 });

    // The property confirms a different figure: that is the one invoiced.
    await recordVerification(pete, { leaseId: lease.id, verifiedOn: "2026-11-22", verifiedAmount: 1_500 });
    await expect(draftInvoice(other, lease.id, "2026-12-16")).rejects.toThrow(/not one of yours/);
    const invoice = await draftInvoice(pete, lease.id, "2026-12-16");
    expect(invoice).toMatchObject({ amount: 1_500, dueOn: "2027-01-14", to: "leasing@fixtureflats.example" });
    expect(invoice.number).toMatch(/^LDR-APT-202612-\d{4}$/);
    // Asking again returns the same invoice, not a second one.
    const again = await draftInvoice(pete, lease.id, "2026-12-20");
    expect(again.number).toBe(invoice.number);
    expect(again.body).toContain("Date: 2026-12-16");
    expect((db.rows(aptLeases) as Array<{ status: string; invoicedOn: string }>)[0]).toMatchObject({ status: "invoiced", invoicedOn: "2026-12-16" });
    expect((await locatorBook(pete)).money).toEqual({ expected: 0, verified: 0, invoicedUnpaid: 1_500, paid: 0 });

    await markLeasePaid(pete, { leaseId: lease.id, paidOn: "2027-01-10", paidAmount: 1_500 });
    await expect(markLeasePaid(pete, { leaseId: lease.id, paidOn: "2027-01-11", paidAmount: 1_500 })).rejects.toThrow(/cannot go/);
    const book = await locatorBook(pete);
    expect(book.money).toEqual({ expected: 0, verified: 0, invoicedUnpaid: 0, paid: 1_500 });
    expect(book.leases[0]).toMatchObject({ property: "Fixture Flats", status: "paid", invoiceNumber: invoice.number });
    // The other locator's book is empty.
    expect(await locatorBook(other)).toMatchObject({ clients: [], guestCards: [], leases: [] });
  });
});

describe("sending a client their options, and keeping pay current", () => {
  it("one link opens the picked communities for the client: names and contacts, the referral line, no pay; a bad token opens nothing", async () => {
    await importApartments([flats, { ...flats, sourceKey: "manual:fixture-lofts", name: "Fixture Lofts", eviction: "yes", incomeRestricted: true }]);
    const [a, b] = (db.rows(aptProperties) as Array<{ id: number }>).map((row) => row.id) as [number, number];
    const clientId = await addAptClient(pete, { name: "Sample Renter" });
    await expect(createClientList(other, { clientId, propertyIds: [a], baseUrl: "https://site.example" })).rejects.toThrow(/not one of yours/);
    await expect(createClientList(pete, { clientId, propertyIds: [a, 9_999], baseUrl: "https://site.example" })).rejects.toThrow(/on file/);
    const sent = await createClientList(pete, { clientId, propertyIds: [b, a, b], note: "Start with the first one", baseUrl: "https://site.example/" });
    expect(sent.url).toBe(`https://site.example/apartments/list/${sent.token}`);
    expect(sent.message.body).toContain(sent.url);
    expect(sent.message.subject).toBe("2 apartments I picked for you");
    const view = await clientListByToken(sent.token, TODAY);
    expect(view).toMatchObject({ clientFirstName: "Sample", agent: { name: "Sample Locator" }, note: "Start with the first one" });
    expect(view!.options.map((option) => option.name)).toEqual(["Fixture Lofts", "Fixture Flats"]);
    expect(view!.options[0]).toMatchObject({ secondChance: true, incomeRestricted: true });
    expect(view!.referralLine).toContain("Sample Locator, Lifestyle Design Realty");
    expect(JSON.stringify(view)).not.toMatch(/Percent|flatFee|commission|leasing@/i);
    expect(await clientListByToken("0".repeat(48), TODAY)).toBeNull();
    expect(await clientListByToken("not-a-token", TODAY)).toBeNull();
  });

  it("a locator's confirmation updates the pay and stamps the date and who confirmed it", async () => {
    await importApartments([{ ...flats, commissionVerifiedOn: "2026-09-01" }]);
    await confirmCommission(pete, { propertyId: propertyId(), escortPercent: 125, bonusAmount: 300, bonusExpiresOn: "2026-12-31", commissionNote: "From the November flyer", today: TODAY });
    const [stored] = await loadApartments();
    expect(stored).toMatchObject({ sendPercent: 50, escortPercent: 125, bonusAmount: 300, commissionVerifiedOn: TODAY, commissionNote: "From the November flyer (confirmed 2026-11-17 by Sample Locator)" });
  });
});
