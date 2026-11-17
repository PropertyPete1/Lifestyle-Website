import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { aptClientLists, aptClients, aptFloorplans, aptPhotos, aptGuestCards, aptLeases, aptProperties, dealTeamAllowlist } from "../drizzle/schema";
import { SITE } from "../shared/site";
import {
  aptInvoiceNumber, canAdvanceLease, clientOption, clientOptionsMessage, commissionFor, guestCardLetter, referralLine, invoiceLetter, leaseVerificationLetter,
  type AptAgent, type AptBrokerage, type AptClient, type AptFloorplan, type AptLeaseStatus, type AptLetter, type AptMethod, type AptProperty, type AptYesNo, type ClientOption,
} from "../shared/apartments";
import { getDb } from "./db";

/**
 * Storage for apartment locating (shared/apartments.ts has the rules). Every client, guest card and lease belongs
 * to the locator who created it (`agentTeamId`, their row in the Builder Deals team list); another locator's id
 * finds nothing. The app drafts letters; the locator sends them from their own e-mail and then marks the step.
 */

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db;
}

export class AptError extends Error {
  constructor(public code: "not_found" | "bad_step" | "bad_input", message: string) { super(message); }
}

type PropertyRow = typeof aptProperties.$inferSelect;
type FloorplanRow = typeof aptFloorplans.$inferSelect;
type PhotoRow = typeof aptPhotos.$inferSelect;

const parseList = (value: string | null): string[] => {
  try { const parsed = JSON.parse(value ?? "[]") as unknown; return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : []; } catch { return []; }
};

const num = (value: string | null) => { const parsed = value == null || value.trim() === "" ? NaN : Number(value); return Number.isFinite(parsed) ? parsed : null; };

const toPlan = (row: FloorplanRow): AptFloorplan => ({ id: row.id, name: row.name, beds: row.beds, baths: row.bathsTenths == null ? null : row.bathsTenths / 10, sqft: row.sqft, rentMin: row.rentMin, rentMax: row.rentMax, availableCount: row.availableCount, availableOn: row.availableOn });

function toProperty(row: PropertyRow, plans: readonly FloorplanRow[], photos: readonly PhotoRow[]): AptProperty {
  return {
    id: row.id, name: row.name, managementCompany: row.managementCompany, address: row.address, city: row.city, zip: row.zip, lat: num(row.lat), lng: num(row.lng), areaLabel: row.areaLabel, phone: row.phone, leasingEmail: row.leasingEmail, website: row.website,
    yearBuilt: row.yearBuilt, unitCount: row.unitCount, sendPercent: row.sendPercent, escortPercent: row.escortPercent, flatFee: row.flatFee, minLeaseMonths: row.minLeaseMonths, bonusAmount: row.bonusAmount, bonusNote: row.bonusNote,
    bonusExpiresOn: row.bonusExpiresOn, commissionNote: row.commissionNote, commissionVerifiedOn: row.commissionVerifiedOn, registrationRequired: row.registrationRequired, invoiceEmail: row.invoiceEmail, specialText: row.specialText,
    specialExpiresOn: row.specialExpiresOn, brokenLease: row.brokenLease, eviction: row.eviction, felony: row.felony, misdemeanor: row.misdemeanor, minCreditScore: row.minCreditScore,
    incomeMultiple: row.incomeMultipleTenths == null ? null : row.incomeMultipleTenths / 10, incomeRestricted: row.incomeRestricted, petPolicy: row.petPolicy, amenities: parseList(row.amenities),
    // A photo whose copy failed (dead link, not an image) is left out; one still waiting is shown from its source to the team only.
    photos: photos.filter((photo) => photo.propertyId === row.id && !photo.failedReason).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id).map((photo) => ({ url: photo.storedUrl ?? photo.sourceUrl, caption: photo.caption, stored: Boolean(photo.storedUrl) })),
    floorplans: plans.filter((plan) => plan.propertyId === row.id).map(toPlan), active: row.active,
  };
}

/** Every property with its floor plans (private shape: callers decide what a viewer may see). */
export async function loadApartments(): Promise<AptProperty[]> {
  const db = await requireDb();
  const rows = await db.select().from(aptProperties);
  const plans = rows.length ? await db.select().from(aptFloorplans).where(inArray(aptFloorplans.propertyId, rows.map((row) => row.id))) : [];
  const photos = rows.length ? await db.select().from(aptPhotos).where(inArray(aptPhotos.propertyId, rows.map((row) => row.id))).orderBy(asc(aptPhotos.sortOrder)) : [];
  return rows.map((row) => toProperty(row, plans, photos));
}

async function loadApartment(id: number): Promise<AptProperty> {
  const db = await requireDb();
  const row = (await db.select().from(aptProperties).where(eq(aptProperties.id, id)).limit(1))[0];
  if (!row) throw new AptError("not_found", "That property is not on file.");
  return toProperty(row, await db.select().from(aptFloorplans).where(eq(aptFloorplans.propertyId, id)), await db.select().from(aptPhotos).where(eq(aptPhotos.propertyId, id)));
}

export type AptPropertyInput = {
  sourceKey: string; name: string; managementCompany?: string | null; address: string; city: string; zip?: string | null; areaLabel: string; phone?: string | null; leasingEmail?: string | null; website?: string | null;
  yearBuilt?: number | null; unitCount?: number | null; sendPercent?: number | null; escortPercent?: number | null; flatFee?: number | null; minLeaseMonths?: number | null; bonusAmount?: number | null; bonusNote?: string | null;
  bonusExpiresOn?: string | null; commissionNote?: string | null; commissionVerifiedOn?: string | null; registrationRequired?: boolean; invoiceEmail?: string | null; specialText?: string | null; specialExpiresOn?: string | null;
  brokenLease?: AptYesNo; eviction?: AptYesNo; felony?: AptYesNo; misdemeanor?: AptYesNo; minCreditScore?: number | null; incomeMultiple?: number | null; incomeRestricted?: boolean; lat?: number | null; lng?: number | null; petPolicy?: string | null; amenities?: string[]; active?: boolean;
  /** When given, replaces the property's floor plans; when omitted, they are left as they are. */
  /** When given, becomes the property's photos in this order (the first is the cover). A photo already copied keeps its copy. */
  photos?: Array<{ url: string; caption?: string | null }>;
  floorplans?: Array<{ name?: string | null; beds: number; baths?: number | null; sqft?: number | null; rentMin?: number | null; rentMax?: number | null; availableCount?: number | null; availableOn?: string | null }>;
};

/**
 * Adds or updates properties by `sourceKey` (an import run twice changes nothing the second time). A field left
 * out of an update keeps its stored value, so a rent-only refresh never wipes a commission someone confirmed.
 */
export async function importApartments(inputs: readonly AptPropertyInput[]): Promise<{ added: number; updated: number }> {
  const db = await requireDb();
  let added = 0;
  let updated = 0;
  for (const input of inputs) {
    const { floorplans, photos, amenities, incomeMultiple, lat, lng, sourceKey, ...rest } = input;
    const fields = Object.fromEntries(Object.entries({
      ...rest,
      ...(amenities !== undefined ? { amenities: JSON.stringify(amenities) } : {}),
      ...(lat !== undefined ? { lat: lat == null ? null : String(lat) } : {}),
      ...(lng !== undefined ? { lng: lng == null ? null : String(lng) } : {}),
      ...(incomeMultiple !== undefined ? { incomeMultipleTenths: incomeMultiple == null ? null : Math.round(incomeMultiple * 10) } : {}),
    }).filter(([, value]) => value !== undefined));
    const existing = (await db.select({ id: aptProperties.id }).from(aptProperties).where(eq(aptProperties.sourceKey, sourceKey)).limit(1))[0];
    let id: number;
    if (existing) {
      id = existing.id;
      if (Object.keys(fields).length) await db.update(aptProperties).set(fields).where(eq(aptProperties.id, id));
      updated += 1;
    } else {
      await db.insert(aptProperties).values({ sourceKey, ...fields } as typeof aptProperties.$inferInsert);
      id = (await db.select({ id: aptProperties.id }).from(aptProperties).where(eq(aptProperties.sourceKey, sourceKey)).limit(1))[0]!.id;
      added += 1;
    }
    if (photos) {
      const existing = await db.select().from(aptPhotos).where(eq(aptPhotos.propertyId, id));
      const wanted = Array.from(new Map(photos.map((photo) => [photo.url.trim(), photo])).values());
      const gone = existing.filter((row) => !wanted.some((photo) => photo.url.trim() === row.sourceUrl)).map((row) => row.id);
      if (gone.length) await db.delete(aptPhotos).where(inArray(aptPhotos.id, gone));
      for (let sortOrder = 0; sortOrder < wanted.length; sortOrder++) {
        const photo = wanted[sortOrder]!;
        const kept = existing.find((row) => row.sourceUrl === photo.url.trim());
        if (kept) await db.update(aptPhotos).set({ sortOrder, caption: photo.caption?.trim() || null }).where(eq(aptPhotos.id, kept.id));
        else await db.insert(aptPhotos).values({ propertyId: id, sourceUrl: photo.url.trim(), caption: photo.caption?.trim() || null, sortOrder });
      }
    }
    if (floorplans) {
      await db.delete(aptFloorplans).where(eq(aptFloorplans.propertyId, id));
      for (const plan of floorplans) await db.insert(aptFloorplans).values({ propertyId: id, name: plan.name ?? null, beds: plan.beds, bathsTenths: plan.baths == null ? null : Math.round(plan.baths * 10), sqft: plan.sqft ?? null, rentMin: plan.rentMin ?? null, rentMax: plan.rentMax ?? null, availableCount: plan.availableCount ?? null, availableOn: plan.availableOn ?? null });
    }
  }
  return { added, updated };
}

/** The locator behind a team sign-in. The license number is not on file anywhere yet, so letters leave it out rather than invent one. */
export async function locatorFor(agentTeamId: number): Promise<AptAgent> {
  const db = await requireDb();
  const row = (await db.select().from(dealTeamAllowlist).where(eq(dealTeamAllowlist.id, agentTeamId)).limit(1))[0];
  if (!row || !row.active) throw new AptError("not_found", "This sign-in is not on the team list.");
  return { name: row.name ?? "Lifestyle Design Realty", phone: row.phoneE164, email: row.email, licenseNumber: null };
}

export const APT_BROKERAGE: AptBrokerage = { name: SITE.name, address: SITE.address, phone: SITE.phone, email: SITE.email, licenseNumber: null };

type ClientRow = typeof aptClients.$inferSelect;
const toClient = (row: ClientRow): AptClient => ({ name: row.name, phone: row.phone, email: row.email, moveDate: row.moveDate, beds: row.beds, budgetMax: row.budgetMax });

export async function addAptClient(agentTeamId: number, input: { name: string; phone?: string | null; email?: string | null; moveDate?: string | null; beds?: number | null; budgetMax?: number | null; notes?: string | null }): Promise<number> {
  const db = await requireDb();
  await db.insert(aptClients).values({ agentTeamId, name: input.name.trim(), phone: input.phone ?? null, email: input.email ?? null, moveDate: input.moveDate ?? null, beds: input.beds ?? null, budgetMax: input.budgetMax ?? null, notes: input.notes ?? null });
  const rows = await db.select({ id: aptClients.id }).from(aptClients).where(eq(aptClients.agentTeamId, agentTeamId));
  return Math.max(...rows.map((row) => row.id));
}

async function ownClient(agentTeamId: number, clientId: number): Promise<ClientRow> {
  const db = await requireDb();
  const row = (await db.select().from(aptClients).where(and(eq(aptClients.id, clientId), eq(aptClients.agentTeamId, agentTeamId))).limit(1))[0];
  if (!row) throw new AptError("not_found", "That client is not one of yours.");
  return row;
}

/**
 * Drafts (or redrafts) the guest card for a client and a property and keeps one record of it. Nothing is sent here:
 * the letter comes back for the locator's own e-mail, and markGuestCard records when they sent it and when the
 * property confirmed.
 */
export async function draftGuestCard(agentTeamId: number, input: { clientId: number; propertyId: number; method: AptMethod; visitOn?: string | null; today: string }): Promise<{ id: number; letter: AptLetter }> {
  const db = await requireDb();
  const client = await ownClient(agentTeamId, input.clientId);
  const property = await loadApartment(input.propertyId);
  const where = and(eq(aptGuestCards.clientId, input.clientId), eq(aptGuestCards.propertyId, input.propertyId));
  const existing = (await db.select().from(aptGuestCards).where(where).limit(1))[0];
  if (existing) await db.update(aptGuestCards).set({ method: input.method, visitOn: input.visitOn ?? null }).where(eq(aptGuestCards.id, existing.id));
  else await db.insert(aptGuestCards).values({ clientId: input.clientId, propertyId: input.propertyId, agentTeamId, method: input.method, visitOn: input.visitOn ?? null });
  const card = (await db.select().from(aptGuestCards).where(where).limit(1))[0]!;
  const letter = guestCardLetter({ property, client: toClient(client), agent: await locatorFor(agentTeamId), brokerage: APT_BROKERAGE, method: input.method, visitOn: input.visitOn ?? null, sentOn: card.sentOn ?? input.today });
  return { id: card.id, letter };
}

export async function markGuestCard(agentTeamId: number, input: { id: number; sentOn?: string; confirmedOn?: string }): Promise<void> {
  const db = await requireDb();
  const card = (await db.select().from(aptGuestCards).where(and(eq(aptGuestCards.id, input.id), eq(aptGuestCards.agentTeamId, agentTeamId))).limit(1))[0];
  if (!card) throw new AptError("not_found", "That guest card is not one of yours.");
  if (input.confirmedOn && !(input.sentOn ?? card.sentOn)) throw new AptError("bad_step", "Mark the guest card sent before marking it confirmed.");
  await db.update(aptGuestCards).set({ ...(input.sentOn ? { sentOn: input.sentOn } : {}), ...(input.confirmedOn ? { confirmedOn: input.confirmedOn } : {}) }).where(eq(aptGuestCards.id, card.id));
}

type LeaseRow = typeof aptLeases.$inferSelect;

async function ownLease(agentTeamId: number, id: number): Promise<LeaseRow> {
  const db = await requireDb();
  const row = (await db.select().from(aptLeases).where(and(eq(aptLeases.id, id), eq(aptLeases.agentTeamId, agentTeamId))).limit(1))[0];
  if (!row) throw new AptError("not_found", "That lease is not one of yours.");
  return row;
}

const leaseFacts = (row: LeaseRow) => ({ unit: row.unit, rent: row.rent, termMonths: row.termMonths, leaseStartOn: row.leaseStartOn, leaseSignedOn: row.leaseSignedOn, method: row.method });

function step(row: LeaseRow, to: AptLeaseStatus) {
  if (!canAdvanceLease(row.status, to)) throw new AptError("bad_step", `This lease is at "${row.status.replace(/_/g, " ")}"; it cannot go to "${to.replace(/_/g, " ")}" yet.`);
}

/** Records that a client leased. One lease per client and property; the amount stored is our estimate until the property verifies. */
export async function reportLease(agentTeamId: number, input: { clientId: number; propertyId: number; unit?: string | null; rent: number; termMonths: number; leaseStartOn: string; leaseSignedOn: string; method: AptMethod; today: string }): Promise<{ id: number; expectedAmount: number; confirm: string[] }> {
  const db = await requireDb();
  await ownClient(agentTeamId, input.clientId);
  const property = await loadApartment(input.propertyId);
  const where = and(eq(aptLeases.clientId, input.clientId), eq(aptLeases.propertyId, input.propertyId));
  if ((await db.select({ id: aptLeases.id }).from(aptLeases).where(where).limit(1))[0]) throw new AptError("bad_input", "A lease for this client at this property is already on file.");
  const commission = commissionFor({ property, rent: input.rent, termMonths: input.termMonths, method: input.method, leaseSignedOn: input.leaseSignedOn, today: input.today });
  await db.insert(aptLeases).values({ clientId: input.clientId, propertyId: input.propertyId, agentTeamId, unit: input.unit ?? null, rent: input.rent, termMonths: input.termMonths, leaseStartOn: input.leaseStartOn, leaseSignedOn: input.leaseSignedOn, method: input.method, expectedAmount: commission.total });
  return { id: (await db.select({ id: aptLeases.id }).from(aptLeases).where(where).limit(1))[0]!.id, expectedAmount: commission.total, confirm: commission.confirm };
}

/** The lease verification letter for the locator to send; the lease does not move until markVerificationSent. */
export async function draftLeaseVerification(agentTeamId: number, leaseId: number, today: string): Promise<AptLetter> {
  const db = await requireDb();
  const lease = await ownLease(agentTeamId, leaseId);
  const card = (await db.select().from(aptGuestCards).where(and(eq(aptGuestCards.clientId, lease.clientId), eq(aptGuestCards.propertyId, lease.propertyId))).limit(1))[0];
  const { commission: _commission, ...letter } = leaseVerificationLetter({ property: await loadApartment(lease.propertyId), client: toClient(await ownClient(agentTeamId, lease.clientId)), agent: await locatorFor(agentTeamId), brokerage: APT_BROKERAGE, lease: leaseFacts(lease), guestCardSentOn: card?.sentOn ?? null, today });
  return letter;
}

export async function markVerificationSent(agentTeamId: number, leaseId: number, sentOn: string): Promise<void> {
  const db = await requireDb();
  const lease = await ownLease(agentTeamId, leaseId);
  step(lease, "verification_sent");
  await db.update(aptLeases).set({ status: "verification_sent", verificationSentOn: sentOn }).where(eq(aptLeases.id, lease.id));
}

/** The property's written answer: the day and the amount it confirmed. This amount, not our estimate, is what gets invoiced. */
export async function recordVerification(agentTeamId: number, input: { leaseId: number; verifiedOn: string; verifiedAmount: number }): Promise<void> {
  const db = await requireDb();
  const lease = await ownLease(agentTeamId, input.leaseId);
  step(lease, "verified");
  if (!(input.verifiedAmount > 0)) throw new AptError("bad_input", "Enter the commission amount the property confirmed.");
  await db.update(aptLeases).set({ status: "verified", verifiedOn: input.verifiedOn, verifiedAmount: Math.round(input.verifiedAmount) }).where(eq(aptLeases.id, lease.id));
}

/** Creates the invoice for a verified lease (or returns the same one again: the number never changes). */
export async function draftInvoice(agentTeamId: number, leaseId: number, today: string): Promise<AptLetter & { number: string; amount: number; dueOn: string }> {
  const db = await requireDb();
  const lease = await ownLease(agentTeamId, leaseId);
  if (lease.status !== "invoiced" && lease.status !== "paid") step(lease, "invoiced");
  const invoice = invoiceLetter({ leaseId: lease.id, property: await loadApartment(lease.propertyId), client: toClient(await ownClient(agentTeamId, lease.clientId)), agent: await locatorFor(agentTeamId), brokerage: APT_BROKERAGE, lease: leaseFacts(lease), verifiedOn: lease.verifiedOn, verifiedAmount: lease.verifiedAmount, issuedOn: lease.invoicedOn ?? today, dueOn: lease.dueOn });
  if (lease.status === "verified") await db.update(aptLeases).set({ status: "invoiced", invoiceNumber: invoice.number, invoicedOn: today, dueOn: invoice.dueOn }).where(eq(aptLeases.id, lease.id));
  return invoice;
}

export async function markLeasePaid(agentTeamId: number, input: { leaseId: number; paidOn: string; paidAmount: number }): Promise<void> {
  const db = await requireDb();
  const lease = await ownLease(agentTeamId, input.leaseId);
  step(lease, "paid");
  await db.update(aptLeases).set({ status: "paid", paidOn: input.paidOn, paidAmount: Math.round(input.paidAmount) }).where(eq(aptLeases.id, lease.id));
}

/** A locator's own book: clients, guest cards, leases and the money at each stage. */
export async function locatorBook(agentTeamId: number) {
  const db = await requireDb();
  const [clients, cards, leases, properties] = await Promise.all([
    db.select().from(aptClients).where(eq(aptClients.agentTeamId, agentTeamId)),
    db.select().from(aptGuestCards).where(eq(aptGuestCards.agentTeamId, agentTeamId)),
    db.select().from(aptLeases).where(eq(aptLeases.agentTeamId, agentTeamId)),
    db.select({ id: aptProperties.id, name: aptProperties.name }).from(aptProperties),
  ]);
  const nameOf = (id: number) => properties.find((property) => property.id === id)?.name ?? "Unknown property";
  const sum = (rows: readonly LeaseRow[], pick: (row: LeaseRow) => number | null) => rows.reduce((total, row) => total + (pick(row) ?? 0), 0);
  return {
    clients: clients.map((client) => ({ id: client.id, ...toClient(client), notes: client.notes })),
    guestCards: cards.map((card) => ({ id: card.id, clientId: card.clientId, propertyId: card.propertyId, property: nameOf(card.propertyId), method: card.method, visitOn: card.visitOn, sentOn: card.sentOn, confirmedOn: card.confirmedOn })),
    leases: leases.map((lease) => ({ id: lease.id, clientId: lease.clientId, propertyId: lease.propertyId, property: nameOf(lease.propertyId), status: lease.status, ...leaseFacts(lease), expectedAmount: lease.expectedAmount, verifiedAmount: lease.verifiedAmount, invoiceNumber: lease.invoiceNumber ?? (lease.status === "invoiced" || lease.status === "paid" ? aptInvoiceNumber(lease.id, lease.leaseStartOn) : null), dueOn: lease.dueOn, paidOn: lease.paidOn, paidAmount: lease.paidAmount })),
    money: {
      expected: sum(leases.filter((lease) => lease.status === "reported" || lease.status === "verification_sent"), (lease) => lease.expectedAmount),
      verified: sum(leases.filter((lease) => lease.status === "verified"), (lease) => lease.verifiedAmount),
      invoicedUnpaid: sum(leases.filter((lease) => lease.status === "invoiced"), (lease) => lease.verifiedAmount),
      paid: sum(leases.filter((lease) => lease.status === "paid"), (lease) => lease.paidAmount),
    },
  };
}

/**
 * What a property pays, as a locator just confirmed it (a flyer, a call, the reply to a guest card). Any locator on
 * the team may update it: the figure is stamped with today's date, which is what keeps it off the "confirm first" list.
 */
export async function confirmCommission(agentTeamId: number, input: { propertyId: number; sendPercent?: number | null; escortPercent?: number | null; flatFee?: number | null; bonusAmount?: number | null; bonusNote?: string | null; bonusExpiresOn?: string | null; commissionNote?: string | null; today: string }): Promise<void> {
  const db = await requireDb();
  const locator = await locatorFor(agentTeamId);
  await loadApartment(input.propertyId);
  const { propertyId, today, commissionNote, ...figures } = input;
  const fields = Object.fromEntries(Object.entries(figures).filter(([, value]) => value !== undefined));
  await db.update(aptProperties).set({ ...fields, commissionVerifiedOn: today, commissionNote: `${commissionNote?.trim() ? `${commissionNote.trim()} ` : ""}(confirmed ${today} by ${locator.name})` }).where(eq(aptProperties.id, propertyId));
}

/** Saves the communities a locator picked for a client and returns the link token and the message to send with it. */
export async function createClientList(agentTeamId: number, input: { clientId: number; propertyIds: number[]; note?: string | null; baseUrl: string }): Promise<{ token: string; url: string; message: AptLetter }> {
  const db = await requireDb();
  const client = await ownClient(agentTeamId, input.clientId);
  const ids = Array.from(new Set(input.propertyIds));
  const known = new Set((await loadApartments()).filter((property) => property.active).map((property) => property.id));
  if (!ids.length || ids.some((id) => !known.has(id))) throw new AptError("bad_input", "Pick at least one community that is on file.");
  const token = randomBytes(24).toString("hex");
  await db.insert(aptClientLists).values({ token, agentTeamId, clientId: input.clientId, propertyIds: JSON.stringify(ids), note: input.note?.trim() || null });
  const url = `${input.baseUrl.replace(/\/$/, "")}/apartments/list/${token}`;
  return { token, url, message: clientOptionsMessage({ client: toClient(client), agent: await locatorFor(agentTeamId), brokerage: APT_BROKERAGE, count: ids.length, url }) };
}

export type ClientListView = { clientFirstName: string; agent: { name: string; phone: string | null; email: string | null }; brokerage: string; referralLine: string; note: string | null; options: ClientOption[] };

/** What the client's link opens. Unknown token: null. A community since switched off drops out of the list. */
export async function clientListByToken(token: string, today: string): Promise<ClientListView | null> {
  if (!/^[a-f0-9]{48}$/.test(token)) return null;
  const db = await requireDb();
  const list = (await db.select().from(aptClientLists).where(eq(aptClientLists.token, token)).limit(1))[0];
  if (!list) return null;
  const client = (await db.select().from(aptClients).where(eq(aptClients.id, list.clientId)).limit(1))[0];
  const agent = await locatorFor(list.agentTeamId).catch(() => null);
  if (!client || !agent) return null;
  let ids: number[] = [];
  try { ids = (JSON.parse(list.propertyIds) as unknown[]).filter((id): id is number => typeof id === "number"); } catch { ids = []; }
  const all = await loadApartments();
  const options = ids.map((id) => all.find((property) => property.id === id && property.active)).filter((property): property is AptProperty => Boolean(property)).map((property) => clientOption(property, today));
  return { clientFirstName: client.name.trim().split(/\s+/)[0] ?? "", agent: { name: agent.name, phone: agent.phone, email: agent.email }, brokerage: APT_BROKERAGE.name, referralLine: referralLine(agent, APT_BROKERAGE), note: list.note, options };
}
