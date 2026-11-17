import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { locatorResults, publicResults, type AptSearch } from "../shared/apartments";
import { adminProcedure, publicProcedure, router } from "./_core/trpc";
import {
  addAptClient, AptError, clientListByToken, confirmCommission, createClientList, draftGuestCard, draftInvoice, draftLeaseVerification, importApartments, loadApartments, locatorBook, locatorFor, markGuestCard, markLeasePaid, markVerificationSent, recordVerification, reportLease,
} from "./apartmentsStore";

/**
 * Apartment locating API (shared/apartments.ts). Three fences:
 *  - `search` is public and answers only with PublicApartment (no name, address, contact or commission);
 *  - `locator.*` needs a live team sign-in (the same one as Builder Deals) and only ever touches that locator's own
 *    clients, guest cards and leases;
 *  - `admin.*` adds and updates properties.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const yesNo = z.enum(["yes", "no", "case_by_case", "unknown"]);
const method = z.enum(["send", "escort"]);
const id = z.number().int().positive();
const dollars = z.number().int().min(0).max(1_000_000);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

const searchInput = z.object({
  city: z.string().trim().max(120).nullish(),
  area: z.string().trim().max(120).nullish(),
  beds: z.number().int().min(0).max(6).nullish(),
  maxRent: dollars.nullish(),
  moveBy: day.nullish(),
  needsBrokenLeaseOk: z.boolean().optional(),
  needsEvictionOk: z.boolean().optional(),
  needsFelonyOk: z.boolean().optional(),
  needsIncomeRestricted: z.boolean().optional(),
  secondChanceOnly: z.boolean().optional(),
  creditScore: z.number().int().min(300).max(850).nullish(),
  paysOnly: z.boolean().optional(),
}).default({});

/** Today in Central time (the brokerage's day), as YYYY-MM-DD. */
export function chicagoToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The signed-in locator's team id, from the Builder Deals team session. */
async function locatorId(req: unknown): Promise<number> {
  const { isLiveDealSession } = await import("./dealsService");
  const session = await isLiveDealSession(req as Parameters<typeof isLiveDealSession>[0]);
  const teamId = session?.lead.agentTeamId;
  if (!teamId) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in as a team member to use the locator tools." });
  return teamId;
}

/** The site's own address for links sent to clients: the request's host, https except on a local host. */
function siteOrigin(req: unknown): string {
  const headers = (req as { headers?: Record<string, string | string[] | undefined> }).headers ?? {};
  const pick = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.split(",")[0]?.trim();
  const host = pick(headers["x-forwarded-host"]) ?? pick(headers.host) ?? "lifestyledesignrealty.com";
  return `${/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? "http" : "https"}://${host}`;
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) {
    if (error instanceof AptError) throw new TRPCError({ code: error.code === "not_found" ? "NOT_FOUND" : "BAD_REQUEST", message: error.message });
    if (error instanceof Error && /has not verified this lease/.test(error.message)) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    throw error;
  }
}

const locatorProcedure = publicProcedure.use(async ({ ctx, next }) => next({ ctx: { ...ctx, agentTeamId: await locatorId(ctx.req) } }));

const propertyInput = z.object({
  sourceKey: z.string().trim().min(3).max(255),
  name: z.string().trim().min(1).max(190),
  managementCompany: optionalText(190),
  address: z.string().trim().min(5).max(255),
  city: z.string().trim().min(1).max(120),
  zip: optionalText(10),
  areaLabel: z.string().trim().min(1).max(120),
  phone: optionalText(40),
  leasingEmail: z.string().trim().email().max(320).nullable().optional(),
  website: z.string().trim().url().max(2048).nullable().optional(),
  yearBuilt: z.number().int().min(1900).max(2100).nullable().optional(),
  unitCount: z.number().int().min(1).max(5000).nullable().optional(),
  sendPercent: z.number().int().min(0).max(300).nullable().optional(),
  escortPercent: z.number().int().min(0).max(300).nullable().optional(),
  flatFee: dollars.nullable().optional(),
  minLeaseMonths: z.number().int().min(1).max(36).nullable().optional(),
  bonusAmount: dollars.nullable().optional(),
  bonusNote: optionalText(255),
  bonusExpiresOn: day.nullable().optional(),
  commissionNote: optionalText(2000),
  commissionVerifiedOn: day.nullable().optional(),
  registrationRequired: z.boolean().optional(),
  invoiceEmail: z.string().trim().email().max(320).nullable().optional(),
  specialText: optionalText(2000),
  specialExpiresOn: day.nullable().optional(),
  brokenLease: yesNo.optional(),
  eviction: yesNo.optional(),
  felony: yesNo.optional(),
  misdemeanor: yesNo.optional(),
  minCreditScore: z.number().int().min(300).max(850).nullable().optional(),
  incomeRestricted: z.boolean().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  incomeMultiple: z.number().min(1).max(6).nullable().optional(),
  petPolicy: optionalText(255),
  amenities: z.array(z.string().trim().min(1).max(80)).max(60).optional(),
  active: z.boolean().optional(),
  photos: z.array(z.object({ url: z.string().trim().url().max(2048).refine((value) => value.startsWith("https://"), "Photo links must be https"), caption: optionalText(190) })).max(120).optional(),
  floorplans: z.array(z.object({ name: optionalText(120), beds: z.number().int().min(0).max(6), baths: z.number().min(0.5).max(6).nullable().optional(), sqft: z.number().int().min(150).max(6000).nullable().optional(), rentMin: dollars.nullable().optional(), rentMax: dollars.nullable().optional(), availableCount: z.number().int().min(0).max(999).nullable().optional(), availableOn: day.nullable().optional() })).max(80).optional(),
});

export const apartmentsRouter = router({
  /** Renters: areas, rents, specials and what is accepted. Nothing that names a property or what it pays. */
  search: publicProcedure.input(searchInput).query(async ({ input }) => publicResults(await loadApartments(), input as AptSearch, chicagoToday())),

  /** The cities with something to show, for the search box. */
  cities: publicProcedure.query(async () => Array.from(new Set((await loadApartments()).filter((property) => property.active).map((property) => property.city))).sort()),

  /** A client's options from their locator's link: names and contacts of the picked communities, never what they pay. */
  list: publicProcedure.input(z.object({ token: z.string().regex(/^[a-f0-9]{48}$/) })).query(async ({ input }) => clientListByToken(input.token, chicagoToday())),

  locator: router({
    me: locatorProcedure.query(async ({ ctx }) => guarded(() => locatorFor(ctx.agentTeamId))),
    /** Everything, best-paying first. */
    search: locatorProcedure.input(searchInput).query(async ({ input }) => locatorResults(await loadApartments(), input as AptSearch, chicagoToday())),
    book: locatorProcedure.query(async ({ ctx }) => guarded(() => locatorBook(ctx.agentTeamId))),
    addClient: locatorProcedure.input(z.object({ name: z.string().trim().min(2).max(190), phone: optionalText(40), email: z.string().trim().email().max(320).nullable().optional(), moveDate: day.nullable().optional(), beds: z.number().int().min(0).max(6).nullable().optional(), budgetMax: dollars.nullable().optional(), notes: optionalText(2000) }))
      .mutation(async ({ ctx, input }) => guarded(async () => ({ id: await addAptClient(ctx.agentTeamId, input) }))),
    guestCard: locatorProcedure.input(z.object({ clientId: id, propertyId: id, method, visitOn: day.nullable().optional() }))
      .mutation(async ({ ctx, input }) => guarded(() => draftGuestCard(ctx.agentTeamId, { ...input, today: chicagoToday() }))),
    markGuestCard: locatorProcedure.input(z.object({ id, sent: z.boolean().optional(), confirmed: z.boolean().optional() }))
      .mutation(async ({ ctx, input }) => guarded(async () => { await markGuestCard(ctx.agentTeamId, { id: input.id, ...(input.sent ? { sentOn: chicagoToday() } : {}), ...(input.confirmed ? { confirmedOn: chicagoToday() } : {}) }); return { ok: true as const }; })),
    /** Saves the picked communities for a client and returns the link and the message to send. */
    sendOptions: locatorProcedure.input(z.object({ clientId: id, propertyIds: z.array(id).min(1).max(25), note: optionalText(500) }))
      .mutation(async ({ ctx, input }) => guarded(() => createClientList(ctx.agentTeamId, { ...input, baseUrl: siteOrigin(ctx.req) }))),
    /** What a property pays, as just confirmed by this locator (stamped with today's date). */
    confirmCommission: locatorProcedure.input(z.object({ propertyId: id, sendPercent: z.number().int().min(0).max(300).nullable().optional(), escortPercent: z.number().int().min(0).max(300).nullable().optional(), flatFee: dollars.nullable().optional(), bonusAmount: dollars.nullable().optional(), bonusNote: optionalText(255), bonusExpiresOn: day.nullable().optional(), commissionNote: optionalText(500) }))
      .mutation(async ({ ctx, input }) => guarded(async () => { await confirmCommission(ctx.agentTeamId, { ...input, today: chicagoToday() }); return { ok: true as const }; })),
    reportLease: locatorProcedure.input(z.object({ clientId: id, propertyId: id, unit: optionalText(40), rent: z.number().int().min(300).max(30_000), termMonths: z.number().int().min(1).max(36), leaseStartOn: day, leaseSignedOn: day, method }))
      .mutation(async ({ ctx, input }) => guarded(() => reportLease(ctx.agentTeamId, { ...input, today: chicagoToday() }))),
    leaseVerification: locatorProcedure.input(z.object({ leaseId: id })).mutation(async ({ ctx, input }) => guarded(() => draftLeaseVerification(ctx.agentTeamId, input.leaseId, chicagoToday()))),
    markVerificationSent: locatorProcedure.input(z.object({ leaseId: id })).mutation(async ({ ctx, input }) => guarded(async () => { await markVerificationSent(ctx.agentTeamId, input.leaseId, chicagoToday()); return { ok: true as const }; })),
    recordVerification: locatorProcedure.input(z.object({ leaseId: id, verifiedAmount: z.number().int().min(1).max(100_000), verifiedOn: day.optional() }))
      .mutation(async ({ ctx, input }) => guarded(async () => { await recordVerification(ctx.agentTeamId, { leaseId: input.leaseId, verifiedAmount: input.verifiedAmount, verifiedOn: input.verifiedOn ?? chicagoToday() }); return { ok: true as const }; })),
    invoice: locatorProcedure.input(z.object({ leaseId: id })).mutation(async ({ ctx, input }) => guarded(() => draftInvoice(ctx.agentTeamId, input.leaseId, chicagoToday()))),
    markPaid: locatorProcedure.input(z.object({ leaseId: id, paidAmount: z.number().int().min(1).max(100_000), paidOn: day.optional() }))
      .mutation(async ({ ctx, input }) => guarded(async () => { await markLeasePaid(ctx.agentTeamId, { leaseId: input.leaseId, paidAmount: input.paidAmount, paidOn: input.paidOn ?? chicagoToday() }); return { ok: true as const }; })),
  }),

  admin: router({
    properties: adminProcedure.query(async () => loadApartments()),
    /** Adds or updates properties by sourceKey; a field left out keeps its stored value. */
    importProperties: adminProcedure.input(z.object({ properties: z.array(propertyInput).min(1).max(500) })).mutation(async ({ input }) => {
      const result = await importApartments(input.properties);
      // Start copying the new photos now (a short budget); the rest are picked up by copyPhotos.
      const photos = await (await import("./apartmentsPhotos")).cacheApartmentPhotos({ limit: 30, budgetMs: 20_000 }).catch(() => null);
      return { ...result, photos };
    }),
    /** Copies photos that have no stored copy yet. Run again until `remaining` is 0. */
    copyPhotos: adminProcedure.mutation(async () => (await import("./apartmentsPhotos")).cacheApartmentPhotos({ limit: 60, budgetMs: 45_000 })),
  }),
});
