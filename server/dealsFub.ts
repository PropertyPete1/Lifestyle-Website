import { sendFubNote } from "./fub";
import { fubHeaders } from "./fub";

const FUB_API_URL = "https://api.followupboss.com/v1";

export async function sendBuilderDealsLeadToFub(input: { phone: string; instagramHandle?: string | null; sourceCode: string; consentText: string; consentAt: Date; consentIp: string | null; isTest?: boolean }) {
  const apiKey = process.env.FUB_API_KEY;
  if (!apiKey) return { ok: false, error: "FUB_API_KEY not configured" };
  const body = {
    source: "Website - Builder Deals",
    system: "Lifestyle Design Realty Website",
    type: "General Inquiry",
    message: [
      "BUILDER DEALS BUYER LEAD",
      input.isTest ? "TEST RECORD - remove during Builder Deals cleanup" : undefined,
      `Source: ${input.sourceCode}`,
      input.instagramHandle ? `Instagram: @${input.instagramHandle}` : undefined,
      `TCPA consent captured: ${input.consentAt.toISOString()}`,
      input.consentIp ? `Consent IP: ${input.consentIp}` : undefined,
      `Consent text: ${input.consentText}`,
    ].filter(Boolean).join("\n"),
    person: {
      firstName: input.instagramHandle ? `@${input.instagramHandle}` : "Builder Deals Buyer",
      phones: [{ value: input.phone }],
      tags: ["Builder Deals Buyer", ...(input.isTest ? ["TEST"] : [])],
    },
  };
  try {
    const res = await fetch(`${FUB_API_URL}/events`, { method: "POST", headers: fubHeaders(apiKey), body: JSON.stringify(body), signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return { ok: false, error: `FUB ${res.status}` };
    const data = await res.json().catch(() => ({})) as { id?: string | number; personId?: string | number; person?: { id?: string | number } };
    const personId = data.person?.id ?? data.personId ?? data.id;
    return { ok: true, personId: personId ? String(personId) : undefined };
  } catch { return { ok: false, error: "FUB delivery failed" }; }
}

export function builderDealsRelayedNote(input: { sourceCode: string; instagramHandle?: string | null }) {
  return ["Builder Deals access verified.", `Source: ${input.sourceCode}`, input.instagramHandle ? `Instagram: @${input.instagramHandle}` : undefined].filter(Boolean).join("\n");
}
