import { and, asc, eq } from "drizzle-orm";
import { dealHomes, dealLeads, dealTourRequests } from "../drizzle/schema";
import { getDb } from "./db";
import { hashSecret, logDealEvent } from "./dealsService";
import { createBuilderDealsTourTask, appendBuilderDealsActivity } from "./dealsFub";
import { notifyOwner } from "./_core/notification";

function chicagoDay(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (name: string) => parts.find((item) => item.type === name)?.value || "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** The opaque card is resolved only after session authentication; no private mapping enters the browser. */
export async function createDealsHomeRequest(input: { leadId: number; card: string; requestType: "tour" | "ask"; preferredAt: Date; sourceCode: string; deviceHash: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  if (input.preferredAt.getTime() < Date.now() + 30 * 60_000) throw new Error("Choose a time at least 30 minutes from now");
  const homes = await db.select().from(dealHomes).where(eq(dealHomes.status, "available")).orderBy(asc(dealHomes.id));
  const home = homes.find((item) => hashSecret(`deals-card:${item.sourceKey}`).slice(0, 20) === input.card);
  if (!home) throw new Error("That home is no longer available");
  const lead = (await db.select().from(dealLeads).where(eq(dealLeads.id, input.leadId)).limit(1))[0];
  if (!lead) throw new Error("Access expired");
  const day = chicagoDay(input.preferredAt);
  const prior = await db.select().from(dealTourRequests).where(and(eq(dealTourRequests.leadId, lead.id), eq(dealTourRequests.chicagoDay, day))).orderBy(asc(dealTourRequests.createdAt));
  const same = prior.find((item) => item.homeId === home.id);
  if (same) return { ok: true as const, appended: true, duplicate: true };
  await db.insert(dealTourRequests).values({ leadId: lead.id, homeId: home.id, requestType: input.requestType, preferredAt: input.preferredAt, chicagoDay: day });
  const privateDescription = `${home.privateAddress ?? "Requested home"}${home.privatePlanName ? ` (${home.privatePlanName})` : ""}`;
  if (lead.status !== "team") {
    if (prior.length === 0) {
      await createBuilderDealsTourTask({ lead, privateDescription, requestType: input.requestType, preferredAt: input.preferredAt });
      await notifyOwner({ title: "Builder Deals tour request", content: `To: peter@lifestyledesignrealty.com, steven@lifestyledesignrealty.com\n\nBuilder Deals lead ${lead.id} requested ${privateDescription} for ${input.preferredAt.toISOString()}.` });
    } else {
      await appendBuilderDealsActivity(lead, `Added request: ${privateDescription} for ${input.preferredAt.toISOString()}`);
      await notifyOwner({ title: "Builder Deals request added", content: `To: peter@lifestyledesignrealty.com, steven@lifestyledesignrealty.com\n\nAdded: ${privateDescription}` });
    }
  }
  await logDealEvent({ leadId: lead.id, kind: "tour_request", sourceCode: input.sourceCode, deviceHash: input.deviceHash, detail: input.requestType });
  return { ok: true as const, appended: prior.length > 0, duplicate: false };
}
