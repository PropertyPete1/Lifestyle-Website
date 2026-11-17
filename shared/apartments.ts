/**
 * APARTMENT LOCATING (Nov 17, 2026, Peter: "similar to the builder website except for apartments, what's paying
 * locators commissions, guest cards, lease confirmation sender, everything").
 *
 * Two audiences, as on Builder Deals:
 *  - Renters (public): what is available where, rents, specials and what a property accepts. Never the property's
 *    name, address, management company, phone or anything about commissions; a renter gets the list from a locator.
 *  - Locators (signed-in team): everything, sorted by what the property pays, plus the paperwork that protects
 *    the commission: the guest card (client registration), the lease verification and the invoice.
 *
 * Everything here is pure (no database, no network) so the money math and the letters are tested on their own.
 * Texas rules that shape it (TREC): a locator must hold a license; an invoice may only claim a tenant the locator
 * actually procured; a rebate to a tenant needs the property's consent first, so nothing here advertises one.
 */

export type AptYesNo = "yes" | "no" | "case_by_case" | "unknown";
export type AptMethod = "send" | "escort";

export type AptFloorplan = {
  id: number;
  name: string | null;
  /** 0 is a studio. */
  beds: number;
  baths: number | null;
  sqft: number | null;
  rentMin: number | null;
  rentMax: number | null;
  availableCount: number | null;
  /** YYYY-MM-DD of the earliest available unit; null when unknown. */
  availableOn: string | null;
};

export type AptProperty = {
  id: number;
  name: string;
  managementCompany: string | null;
  address: string;
  city: string;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  /** Buyer-safe area wording ("North Central San Antonio"). */
  areaLabel: string;
  phone: string | null;
  leasingEmail: string | null;
  website: string | null;
  yearBuilt: number | null;
  unitCount: number | null;
  /** What the property pays a locator, in percent of one month's rent: 100 = one full month. */
  sendPercent: number | null;
  escortPercent: number | null;
  /** A flat fee in dollars, when the property pays one instead of (or when no) percentage. */
  flatFee: number | null;
  /** The shortest lease that pays the full commission (usually 12). */
  minLeaseMonths: number | null;
  bonusAmount: number | null;
  bonusNote: string | null;
  /** YYYY-MM-DD the bonus ends (inclusive); null = no end stated. */
  bonusExpiresOn: string | null;
  commissionNote: string | null;
  /** YYYY-MM-DD the commission was last confirmed with the property or its flyer. */
  commissionVerifiedOn: string | null;
  /** The client must be registered (guest card) before the first visit. */
  registrationRequired: boolean;
  invoiceEmail: string | null;
  specialText: string | null;
  specialExpiresOn: string | null;
  brokenLease: AptYesNo;
  eviction: AptYesNo;
  felony: AptYesNo;
  misdemeanor: AptYesNo;
  minCreditScore: number | null;
  /** Income required as a multiple of rent (3 = three times the rent). */
  incomeMultiple: number | null;
  /** An income-restricted (affordable, tax credit) community: rents are capped for households under an income limit. */
  incomeRestricted: boolean;
  petPolicy: string | null;
  amenities: string[];
  floorplans: AptFloorplan[];
  active: boolean;
};

export type AptSearch = {
  city?: string | null;
  area?: string | null;
  /** Exact bedroom count; 0 = studio. */
  beds?: number | null;
  maxRent?: number | null;
  /** YYYY-MM-DD: a floor plan available on or before this day (unknown availability still counts). */
  moveBy?: string | null;
  needsBrokenLeaseOk?: boolean;
  needsEvictionOk?: boolean;
  needsFelonyOk?: boolean;
  /** Income-restricted (affordable) communities only. */
  needsIncomeRestricted?: boolean;
  /** Any second-chance community: one that works with a broken lease, an eviction or a record. */
  secondChanceOnly?: boolean;
  /** The renter's score: properties whose minimum is above it are left out. */
  creditScore?: number | null;
  /** Locator view only: only properties with a stated commission. */
  paysOnly?: boolean;
};

/** Days after which a commission figure should be confirmed again before it is quoted on an invoice. */
export const APT_COMMISSION_STALE_DAYS = 30;
const DEFAULT_MIN_LEASE = 12;

const dayNumber = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
const isDay = (value: string | null | undefined): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)));
const money = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;
const accepts = (value: AptYesNo) => value === "yes" || value === "case_by_case";

/**
 * SECOND CHANCE (Nov 17, 2026, Peter: "broken leases, evictions, all that stuff, we have places for them as well, so
 * we can get all the leads"; it "should stand out"). A community is second chance when it says yes or case-by-case
 * to a broken lease, an eviction or a felony. Unknown is never a yes: a renter is not sent somewhere on a guess.
 */
export function isSecondChance(property: Pick<AptProperty, "brokenLease" | "eviction" | "felony">): boolean {
  return accepts(property.brokenLease) || accepts(property.eviction) || accepts(property.felony);
}

/** Floor plans of a property that fit the search (beds, rent ceiling, move date). */
export function matchingFloorplans(property: AptProperty, search: AptSearch): AptFloorplan[] {
  return property.floorplans.filter((plan) => {
    if (search.beds != null && plan.beds !== search.beds) return false;
    if (search.maxRent != null && (plan.rentMin == null || plan.rentMin > search.maxRent)) return false;
    if (isDay(search.moveBy) && isDay(plan.availableOn) && dayNumber(plan.availableOn) > dayNumber(search.moveBy)) return false;
    if (plan.availableCount === 0) return false;
    return true;
  });
}

/** Whether a property answers the search at all. An unknown policy never passes a "needs" filter: it is not a yes. */
export function matchesSearch(property: AptProperty, search: AptSearch): boolean {
  if (!property.active) return false;
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  if (search.city && !same(property.city, search.city)) return false;
  if (search.area && !same(property.areaLabel, search.area)) return false;
  if (search.needsBrokenLeaseOk && !accepts(property.brokenLease)) return false;
  if (search.needsEvictionOk && !accepts(property.eviction)) return false;
  if (search.needsFelonyOk && !accepts(property.felony)) return false;
  if (search.needsIncomeRestricted && !property.incomeRestricted) return false;
  if (search.secondChanceOnly && !isSecondChance(property)) return false;
  if (search.creditScore != null && property.minCreditScore != null && property.minCreditScore > search.creditScore) return false;
  if (search.paysOnly && property.sendPercent == null && property.escortPercent == null && property.flatFee == null) return false;
  const filtersPlans = search.beds != null || search.maxRent != null || isDay(search.moveBy);
  return !filtersPlans || matchingFloorplans(property, search).length > 0;
}

export type AptCommission = {
  /** Percent of one month's rent used, or null when a flat fee (or nothing) applies. */
  percent: number | null;
  base: number;
  bonus: number;
  total: number;
  /** What must be confirmed with the property before this number goes on an invoice. Empty = nothing. */
  confirm: string[];
  /** A one-line explanation of the math. */
  line: string;
};

/**
 * What a lease pays the locator. Send = the client went alone and named us; escort = the locator toured with them.
 * A missing escort rate falls back to the send rate (never the other way round: escort is the higher one).
 * Nothing is guessed: a short lease, an old commission figure or a missing rate is returned as something to confirm.
 */
export function commissionFor(input: { property: Pick<AptProperty, "sendPercent" | "escortPercent" | "flatFee" | "minLeaseMonths" | "bonusAmount" | "bonusExpiresOn" | "commissionVerifiedOn">; rent: number; termMonths: number; method: AptMethod; leaseSignedOn: string; today?: string }): AptCommission {
  const { property, rent, termMonths, method, leaseSignedOn } = input;
  const confirm: string[] = [];
  const percent = method === "escort" ? property.escortPercent ?? property.sendPercent : property.sendPercent;
  let base = 0;
  let line: string;
  if (percent != null) {
    base = Math.round((rent * percent) / 100);
    line = `${percent}% of ${money(rent)} (${method})`;
    if (method === "send" && property.sendPercent == null) confirm.push("no send rate on file");
    if (method === "escort" && property.escortPercent == null) confirm.push("no escort rate on file: the send rate was used");
  } else if (property.flatFee != null) {
    base = property.flatFee;
    line = `flat fee ${money(property.flatFee)}`;
  } else {
    line = "no commission on file";
    confirm.push("no commission on file for this property");
  }
  const minLease = property.minLeaseMonths ?? DEFAULT_MIN_LEASE;
  if (termMonths < minLease) confirm.push(`${termMonths}-month lease is shorter than the ${minLease} months that pay the full commission: ask the property what a short lease pays`);
  let bonus = 0;
  if (property.bonusAmount && (!isDay(property.bonusExpiresOn) || (isDay(leaseSignedOn) && dayNumber(leaseSignedOn) <= dayNumber(property.bonusExpiresOn)))) {
    bonus = property.bonusAmount;
    line += ` + ${money(bonus)} bonus`;
  }
  const today = input.today ?? leaseSignedOn;
  if (!isDay(property.commissionVerifiedOn)) confirm.push("the commission has never been confirmed with the property");
  else if (isDay(today) && dayNumber(today) - dayNumber(property.commissionVerifiedOn) > APT_COMMISSION_STALE_DAYS) confirm.push(`the commission was last confirmed ${property.commissionVerifiedOn}, more than ${APT_COMMISSION_STALE_DAYS} days ago`);
  return { percent: percent ?? null, base, bonus, total: base + bonus, confirm, line };
}

/** The most a property would pay for this search: its best rate on the dearest matching floor plan. Locator sort key. */
export function bestCommission(property: AptProperty, search: AptSearch, today: string): number {
  const plans = matchingFloorplans(property, search);
  const rent = Math.max(0, ...plans.map((plan) => plan.rentMin ?? 0));
  if (!rent && property.flatFee == null) return 0;
  return commissionFor({ property, rent, termMonths: property.minLeaseMonths ?? DEFAULT_MIN_LEASE, method: "escort", leaseSignedOn: today, today }).total;
}

/** Locator results: what pays most first; a tie goes to the lower rent (easier to lease). */
export function locatorResults(properties: readonly AptProperty[], search: AptSearch, today: string): Array<{ property: AptProperty; plans: AptFloorplan[]; pays: number }> {
  return properties.filter((property) => matchesSearch(property, search))
    .map((property) => ({ property, plans: matchingFloorplans(property, search), pays: bestCommission(property, search, today) }))
    .sort((a, b) => b.pays - a.pays || lowestRent(a.plans) - lowestRent(b.plans) || a.property.name.localeCompare(b.property.name));
}

const lowestRent = (plans: readonly AptFloorplan[]) => Math.min(Number.MAX_SAFE_INTEGER, ...plans.map((plan) => plan.rentMin ?? Number.MAX_SAFE_INTEGER));

/** What a renter may see: no name, address, management, phone, link or commission. The special is shown only with the name scrubbed out. */
export type PublicApartment = {
  /** An opaque reference the renter can quote; never the database id pattern of a property's own site. */
  ref: string;
  city: string;
  areaLabel: string;
  yearBuilt: number | null;
  rentFrom: number | null;
  plans: Array<{ beds: number; baths: number | null; sqft: number | null; rentMin: number | null; rentMax: number | null; availableOn: string | null }>;
  special: string | null;
  /** Works with a broken lease, an eviction or a record: the badge that stands out. */
  secondChance: boolean;
  acceptsBrokenLease: boolean;
  acceptsEviction: boolean;
  acceptsFelony: boolean;
  incomeRestricted: boolean;
  /** Income needed as a multiple of the rent, when the community states it. */
  incomeMultiple: number | null;
  /** The middle of a roughly 1.5-mile square the community sits in: enough for an area map, never its pin. */
  approx: { lat: number; lng: number } | null;
  petPolicy: string | null;
  amenities: string[];
};

/** Degrees per side of the square a renter's map point is snapped to (about 1.5 miles). */
const AREA_CELL = 0.02;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Removes the property's own names from text a renter will read. */
export function scrubApartmentText(text: string, property: Pick<AptProperty, "name" | "managementCompany" | "address" | "phone" | "website">): string {
  // Links, e-mail addresses and phone numbers go first (a name inside a link would otherwise leave half a link behind).
  let out = text
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "")
    .replace(/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "");
  const street = property.address.split(",")[0]?.trim() ?? "";
  const host = property.website ? property.website.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0] ?? "" : "";
  for (const term of [property.name, property.managementCompany ?? "", street, host]) {
    if (term.trim().length >= 3) out = out.replace(new RegExp(escapeRegExp(term.trim()), "gi"), "this community");
  }
  return out.replace(/\s+([,.;:!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

export function publicApartment(property: AptProperty, search: AptSearch, today: string): PublicApartment {
  const plans = (search.beds != null || search.maxRent != null || isDay(search.moveBy) ? matchingFloorplans(property, search) : property.floorplans.filter((plan) => plan.availableCount !== 0))
    .map((plan) => ({ beds: plan.beds, baths: plan.baths, sqft: plan.sqft, rentMin: plan.rentMin, rentMax: plan.rentMax, availableOn: plan.availableOn }))
    .sort((a, b) => a.beds - b.beds || (a.rentMin ?? 0) - (b.rentMin ?? 0));
  const rents = plans.map((plan) => plan.rentMin).filter((rent): rent is number => rent != null);
  const specialLive = property.specialText && (!isDay(property.specialExpiresOn) || dayNumber(property.specialExpiresOn) >= dayNumber(today));
  const scrub = (value: string) => scrubApartmentText(value, property);
  return {
    ref: `A${(property.id * 7919 + 104_729).toString(36).toUpperCase()}`,
    city: property.city,
    areaLabel: property.areaLabel,
    yearBuilt: property.yearBuilt,
    rentFrom: rents.length ? Math.min(...rents) : null,
    plans,
    special: specialLive ? scrub(property.specialText!) || null : null,
    secondChance: isSecondChance(property),
    acceptsBrokenLease: accepts(property.brokenLease),
    acceptsEviction: accepts(property.eviction),
    acceptsFelony: accepts(property.felony),
    incomeRestricted: property.incomeRestricted,
    incomeMultiple: property.incomeMultiple,
    approx: property.lat != null && property.lng != null ? { lat: (Math.floor(property.lat / AREA_CELL) + 0.5) * AREA_CELL, lng: (Math.floor(property.lng / AREA_CELL) + 0.5) * AREA_CELL } : null,
    petPolicy: property.petPolicy ? scrub(property.petPolicy) || null : null,
    amenities: property.amenities.map(scrub).filter(Boolean),
  };
}

/** Renter results: cheapest first. */
export function publicResults(properties: readonly AptProperty[], search: AptSearch, today: string): PublicApartment[] {
  const renterSearch: AptSearch = { ...search, paysOnly: false };
  return properties.filter((property) => matchesSearch(property, renterSearch)).map((property) => publicApartment(property, renterSearch, today))
    .filter((entry) => entry.plans.length > 0)
    .sort((a, b) => (a.rentFrom ?? Number.MAX_SAFE_INTEGER) - (b.rentFrom ?? Number.MAX_SAFE_INTEGER) || a.ref.localeCompare(b.ref));
}

/* ----------------------------------------------------------------------------------------------------------------
 * The paperwork. Each returns a letter (to, subject, body) the locator sends from their own e-mail, so the property
 * hears from the person it will pay and nothing is sent in anyone's name by a machine.
 * ------------------------------------------------------------------------------------------------------------- */

export type AptAgent = { name: string; phone: string | null; email: string | null; licenseNumber: string | null };
export type AptBrokerage = { name: string; address: string; phone: string; email: string; licenseNumber: string | null };
export type AptClient = { name: string; phone: string | null; email: string | null; moveDate: string | null; beds: number | null; budgetMax: number | null };
export type AptLetter = { to: string | null; subject: string; body: string };

const bedsLabel = (beds: number | null) => beds == null ? null : beds === 0 ? "Studio" : `${beds} bedroom`;
const lines = (rows: Array<string | null | false | undefined>) => rows.filter((row): row is string => typeof row === "string").join("\n");
const signature = (agent: AptAgent, brokerage: AptBrokerage) => lines([
  agent.name,
  `Apartment Locator, ${brokerage.name}`,
  agent.licenseNumber ? `TREC License ${agent.licenseNumber}` : null,
  agent.phone,
  agent.email,
]);

/**
 * The guest card: registers the client with the property BEFORE the visit, so the lease is credited to the locator.
 * It states plainly who referred the client and how they will visit (send or escort).
 */
export function guestCardLetter(input: { property: Pick<AptProperty, "name" | "leasingEmail">; client: AptClient; agent: AptAgent; brokerage: AptBrokerage; method: AptMethod; visitOn: string | null; sentOn: string }): AptLetter {
  const { property, client, agent, brokerage, method, visitOn, sentOn } = input;
  return {
    to: property.leasingEmail,
    subject: `Locator guest card: ${client.name} (${brokerage.name})`,
    body: lines([
      `Hello ${property.name} leasing team,`,
      "",
      `Please register my client below as a locator referral from ${brokerage.name}, dated ${sentOn}.`,
      "",
      `Client: ${client.name}`,
      client.phone ? `Phone: ${client.phone}` : null,
      client.email ? `Email: ${client.email}` : null,
      client.moveDate ? `Move-in date: ${client.moveDate}` : null,
      bedsLabel(client.beds) ? `Looking for: ${bedsLabel(client.beds)}` : null,
      client.budgetMax ? `Budget: up to ${money(client.budgetMax)}` : null,
      method === "escort" ? `Visit: I will tour with my client${visitOn ? ` on ${visitOn}` : ""}.` : `Visit: my client will visit on their own${visitOn ? ` on ${visitOn}` : ""} and will name me as their locator.`,
      "",
      "Please reply to confirm the registration and your current locator commission, and list me as the locator on the guest card and application.",
      "",
      "Thank you,",
      signature(agent, brokerage),
    ]),
  };
}

export type AptLeaseFacts = { unit: string | null; rent: number; termMonths: number; leaseStartOn: string; leaseSignedOn: string; method: AptMethod };

/**
 * The lease verification: asks the property to confirm the lease and the commission in writing BEFORE an invoice
 * goes out (an invoice may only claim a tenant the locator procured, and the number must be the property's).
 */
export function leaseVerificationLetter(input: { property: Pick<AptProperty, "name" | "leasingEmail" | "sendPercent" | "escortPercent" | "flatFee" | "minLeaseMonths" | "bonusAmount" | "bonusExpiresOn" | "commissionVerifiedOn">; client: Pick<AptClient, "name">; agent: AptAgent; brokerage: AptBrokerage; lease: AptLeaseFacts; guestCardSentOn: string | null; today: string }): AptLetter & { commission: AptCommission } {
  const { property, client, agent, brokerage, lease, guestCardSentOn, today } = input;
  const commission = commissionFor({ property, rent: lease.rent, termMonths: lease.termMonths, method: lease.method, leaseSignedOn: lease.leaseSignedOn, today });
  return {
    commission,
    to: property.leasingEmail,
    subject: `Lease verification request: ${client.name}${lease.unit ? `, unit ${lease.unit}` : ""}`,
    body: lines([
      `Hello ${property.name} leasing team,`,
      "",
      `My client ${client.name} has leased with you${guestCardSentOn ? ` (registered as my referral on ${guestCardSentOn})` : ""}. Before I send our invoice, please confirm or correct the details below by replying to this e-mail:`,
      "",
      `Resident: ${client.name}`,
      `Unit: ${lease.unit ?? "(please fill in)"}`,
      `Lease start: ${lease.leaseStartOn}`,
      `Lease term: ${lease.termMonths} months`,
      `Monthly rent: ${money(lease.rent)}`,
      `Locator: ${agent.name}, ${brokerage.name} (${lease.method})`,
      commission.total > 0 ? `Locator commission as we understand it: ${commission.line} = ${money(commission.total)}` : "Locator commission: please state the amount",
      "",
      "Please also tell us where to send the invoice and whether you need our W-9.",
      "",
      "Thank you,",
      signature(agent, brokerage),
    ]),
  };
}

/** LDR-APT-<lease start yyyymm>-<lease id>: stable for a lease, so a resend never creates a second invoice number. */
export function aptInvoiceNumber(leaseId: number, leaseStartOn: string): string {
  return `LDR-APT-${leaseStartOn.slice(0, 7).replace("-", "")}-${String(leaseId).padStart(4, "0")}`;
}

export type AptInvoice = AptLetter & { number: string; amount: number; dueOn: string };

/**
 * The invoice. It refuses (throws) unless the property verified the lease and an amount: we bill what the property
 * confirmed, never our own estimate. Due 30 days after the lease starts unless the property stated otherwise.
 */
export function invoiceLetter(input: { leaseId: number; property: Pick<AptProperty, "name" | "address" | "invoiceEmail" | "leasingEmail">; client: Pick<AptClient, "name">; agent: AptAgent; brokerage: AptBrokerage; lease: AptLeaseFacts; verifiedOn: string | null; verifiedAmount: number | null; issuedOn: string; dueOn?: string | null }): AptInvoice {
  const { leaseId, property, client, agent, brokerage, lease, verifiedOn, verifiedAmount, issuedOn } = input;
  if (!isDay(verifiedOn) || verifiedAmount == null || !(verifiedAmount > 0)) throw new Error("The property has not verified this lease and its commission yet: send the lease verification first.");
  const number = aptInvoiceNumber(leaseId, lease.leaseStartOn);
  const due = isDay(input.dueOn) ? input.dueOn : new Date((dayNumber(lease.leaseStartOn) + 30) * 86_400_000).toISOString().slice(0, 10);
  return {
    number,
    amount: verifiedAmount,
    dueOn: due,
    to: property.invoiceEmail ?? property.leasingEmail,
    subject: `Invoice ${number}: locator commission, ${client.name}`,
    body: lines([
      `INVOICE ${number}`,
      `Date: ${issuedOn}`,
      `Due: ${due}`,
      "",
      "From:",
      brokerage.name,
      brokerage.address,
      `${brokerage.phone} | ${brokerage.email}`,
      brokerage.licenseNumber ? `TREC Broker License ${brokerage.licenseNumber}` : null,
      "",
      "Bill to:",
      property.name,
      property.address,
      "",
      `Locator commission for resident ${client.name}${lease.unit ? `, unit ${lease.unit}` : ""}`,
      `Lease start ${lease.leaseStartOn}, ${lease.termMonths} months at ${money(lease.rent)} a month`,
      `Locator: ${agent.name}${agent.licenseNumber ? ` (TREC License ${agent.licenseNumber})` : ""}`,
      `Verified by the property on ${verifiedOn}`,
      "",
      `AMOUNT DUE: ${money(verifiedAmount)}`,
      "",
      `Please make payment to ${brokerage.name}. Our W-9 is available on request.`,
      "",
      "Thank you,",
      signature(agent, brokerage),
    ]),
  };
}

/** Where a client's file stands, in order. A lease can only move forward one honest step at a time. */
export const APT_LEASE_STATUSES = ["reported", "verification_sent", "verified", "invoiced", "paid"] as const;
export type AptLeaseStatus = (typeof APT_LEASE_STATUSES)[number];

/** Whether a lease may move from one status to the next (no skipping the verification; paid only after an invoice). */
export function canAdvanceLease(from: AptLeaseStatus, to: AptLeaseStatus): boolean {
  return APT_LEASE_STATUSES.indexOf(to) === APT_LEASE_STATUSES.indexOf(from) + 1;
}

/** Unpaid invoices by age, for the locator's "who owes us" list. */
export function invoiceAgeDays(dueOn: string, today: string): number {
  return isDay(dueOn) && isDay(today) ? dayNumber(today) - dayNumber(dueOn) : 0;
}

/* ----------------------------------------------------------------------------------------------------------------
 * The client's options. A locator picks communities and sends the client one link. The client sees the names and
 * how to reach them (they came through us, as on an agent's Builder Deals link) and, on every one, the line that
 * protects the referral: who to name as their locator. Never what the community pays.
 * ------------------------------------------------------------------------------------------------------------- */

export type ClientOption = {
  name: string;
  address: string;
  city: string;
  areaLabel: string;
  phone: string | null;
  website: string | null;
  yearBuilt: number | null;
  plans: PublicApartment["plans"];
  special: string | null;
  secondChance: boolean;
  acceptsBrokenLease: boolean;
  acceptsEviction: boolean;
  acceptsFelony: boolean;
  incomeRestricted: boolean;
  incomeMultiple: number | null;
  petPolicy: string | null;
  amenities: string[];
  lat: number | null;
  lng: number | null;
};

export function clientOption(property: AptProperty, today: string): ClientOption {
  const specialLive = property.specialText && (!isDay(property.specialExpiresOn) || dayNumber(property.specialExpiresOn) >= dayNumber(today));
  return {
    name: property.name, address: property.address, city: property.city, areaLabel: property.areaLabel, phone: property.phone, website: property.website, yearBuilt: property.yearBuilt,
    plans: property.floorplans.filter((plan) => plan.availableCount !== 0).map((plan) => ({ beds: plan.beds, baths: plan.baths, sqft: plan.sqft, rentMin: plan.rentMin, rentMax: plan.rentMax, availableOn: plan.availableOn })).sort((a, b) => a.beds - b.beds || (a.rentMin ?? 0) - (b.rentMin ?? 0)),
    special: specialLive ? property.specialText : null,
    secondChance: isSecondChance(property), acceptsBrokenLease: accepts(property.brokenLease), acceptsEviction: accepts(property.eviction), acceptsFelony: accepts(property.felony),
    incomeRestricted: property.incomeRestricted, incomeMultiple: property.incomeMultiple, petPolicy: property.petPolicy, amenities: property.amenities, lat: property.lat, lng: property.lng,
  };
}

/** What the client must do so the locator is credited (and the client keeps a free service). */
export function referralLine(agent: Pick<AptAgent, "name">, brokerage: Pick<AptBrokerage, "name">): string {
  return `When you tour or apply, write "${agent.name}, ${brokerage.name}" as your locator or "how did you hear about us".`;
}

/** The message a locator sends with the client's link (text or e-mail). */
export function clientOptionsMessage(input: { client: Pick<AptClient, "name">; agent: AptAgent; brokerage: AptBrokerage; count: number; url: string }): AptLetter {
  const first = input.client.name.trim().split(/\s+/)[0] ?? "";
  return {
    to: null,
    subject: `${input.count} apartment${input.count === 1 ? "" : "s"} I picked for you`,
    body: lines([
      `Hi ${first}, here ${input.count === 1 ? "is the apartment" : `are the ${input.count} apartments`} I picked for you, with rents, specials and how to reach each one:`,
      input.url,
      "",
      referralLine(input.agent, input.brokerage),
      "My help is free to you. Tell me which ones you like and I will set up the tours.",
      "",
      input.agent.name,
      input.brokerage.name,
      input.agent.phone,
    ]),
  };
}
