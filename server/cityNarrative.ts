/**
 * City Finder — AI-generated personalized narratives per matched city.
 *
 * Architecture mirrors partnerPitch.ts:
 * - Server-side only (ANTHROPIC_API_KEY never exposed to client)
 * - Cached per unique answer set in city_matches table
 * - Compliance guard: no rates/$/% in AI text
 * - Graceful fallback to existing templated "why" copy
 * - Same cheapest model (claude-haiku-4-5) as Convince Your Partner
 */

import { violatesCompliance } from "./partnerPitch";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5";

/** City hard data — real facts, never AI-generated. */
export const CITY_DATA: Record<string, { medianPrice: string; priceRange: string; vibe: string; facts: string[] }> = {
  "San Antonio": {
    medianPrice: "$310K",
    priceRange: "$180K–$600K",
    vibe: "Historic soul, big-city amenities, and Texas's best value for space.",
    facts: [
      "No state income tax",
      "Home to Joint Base San Antonio",
      "Booming new-construction suburbs (Alamo Ranch, Far West, Converse)",
      "Cost of living well below the national average",
    ],
  },
  "New Braunfels": {
    medianPrice: "$375K",
    priceRange: "$250K–$700K",
    vibe: "River-town charm between two metros — Hill Country weekends, every weekend.",
    facts: [
      "Sits on the Comal and Guadalupe Rivers with Canyon Lake minutes away",
      "One of the fastest-growing cities in Texas",
      "Strong new-build inventory along the I-35 corridor",
      "Gruene Historic District and year-round outdoor recreation",
    ],
  },
  Austin: {
    medianPrice: "$540K",
    priceRange: "$300K–$1.2M",
    vibe: "Tech energy, live music, and a food scene that never slows down.",
    facts: [
      "Major tech employers (Tesla, Apple, Google, Meta)",
      "Nationally ranked live-music and food scene",
      "Suburbs like Kyle and Buda offer value minutes from downtown",
      "Lake Travis and Barton Springs for year-round outdoor living",
    ],
  },
  DFW: {
    medianPrice: "$420K",
    priceRange: "$250K–$900K",
    vibe: "Corporate powerhouse with endless suburbs — something for every lifestyle.",
    facts: [
      "Largest job market in Texas",
      "Elite school districts (Prosper, Southlake, Frisco)",
      "Deepest new-construction inventory in the state",
      "Master-planned communities with every amenity built in",
    ],
  },
  Houston: {
    medianPrice: "$345K",
    priceRange: "$200K–$800K",
    vibe: "Global city, unbeatable diversity, and serious square footage for the money.",
    facts: [
      "World-class dining and cultural institutions",
      "Energy-sector and medical-center career hubs",
      "Best price-per-square-foot of any major U.S. metro",
      "No zoning = diverse neighborhoods and housing options",
    ],
  },
};

const SYSTEM_PROMPT = `You are the voice of Lifestyle Design Realty, a veteran-owned boutique Central Texas brokerage. You write personalized, emotionally compelling city-match narratives for people who just completed a "Find Your Texas City" quiz.

Your output has THREE distinct parts, separated by the marker "---":

PART 1 — "Why this city fits YOU" (3-5 sentences):
- Vivid, cinematic, second-person. Ground every detail in real characteristics of this specific city.
- Personalized to their exact quiz answers (budget, lifestyle, household, timeline, build preference).
- Sensory and specific — make them FEEL what daily life here is like for someone with their priorities.
- Never generic. Every sentence should be impossible to write without knowing their specific answers.

PART 2 — "Why Lifestyle Design Realty" (2-3 sentences):
- Confident and warm, not salesy or desperate.
- Reference: our local expertise across five Texas markets, our tech-forward tools (City Finder, AI search, Convince Your Partner), our builder relationships and negotiated rate buydowns, and our 30-minute response promise.
- Make us sound like the obvious choice — the team that already understands what matters to them.

Rules:
- NEVER mention interest rates, percentages, dollar amounts, or any numeric financial promises. You may reference "negotiated rate buydowns" or "builder incentives" conceptually but NEVER cite specific numbers.
- NEVER make comparative affordability claims ("half the price", "fraction of the cost").
- Do not use em dashes excessively. Vary your openings — never start with "Imagine" or "Picture this".
- Return ONLY the two parts separated by "---" on its own line. No preamble, no quotes, no labels.`;

export interface CityNarrativeInput {
  city: string;
  answers: Record<string, string>;
}

function buildUserPrompt(input: CityNarrativeInput): string {
  const lines = [
    `City: ${input.city}`,
    `Quiz answers:`,
  ];
  for (const [k, v] of Object.entries(input.answers)) {
    lines.push(`  - ${k}: ${v}`);
  }
  lines.push(`\nWrite the personalized narrative now.`);
  return lines.join("\n");
}

/**
 * Generate AI narrative for a single city match.
 * Returns { cityPitch, ldrPitch } or throws (caller handles fallback).
 */
export async function generateCityNarrative(input: CityNarrativeInput): Promise<{ cityPitch: string; ldrPitch: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(input) }],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = data.content?.find((c) => c.type === "text")?.text?.trim();
  if (!text) throw new Error("Anthropic returned no text");

  // Compliance check
  if (violatesCompliance(text)) {
    // One retry
    const retry = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(input) + "\n\nIMPORTANT: absolutely no numbers, no percentages, no dollar amounts, no price/cost/savings comparisons." }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (retry.ok) {
      const retryData = (await retry.json()) as { content?: { type: string; text?: string }[] };
      const retryText = retryData.content?.find((c) => c.type === "text")?.text?.trim();
      if (retryText && !violatesCompliance(retryText)) return parseParts(retryText);
    }
    throw new Error("City narrative failed compliance check");
  }

  return parseParts(text);
}

function parseParts(text: string): { cityPitch: string; ldrPitch: string } {
  const parts = text.split(/\n---\n/);
  if (parts.length >= 2) {
    return { cityPitch: parts[0].trim(), ldrPitch: parts[1].trim() };
  }
  // If model didn't split properly, use entire text as cityPitch with a generic LDR pitch
  return {
    cityPitch: text,
    ldrPitch: "We serve five Texas markets with the same tech-forward approach you just experienced — from AI-powered search to builder-negotiated incentives. Reach out and we'll respond within 30 minutes, ready to show you around.",
  };
}

/** Fallback narratives when AI is unavailable — warm but not personalized. */
export function fallbackNarrative(city: string): { cityPitch: string; ldrPitch: string } {
  const data = CITY_DATA[city];
  const vibe = data?.vibe || "A great place to call home.";
  return {
    cityPitch: `${vibe} Between the people, the pace, and everything your new city puts within reach, this is the kind of place that makes you wonder why you didn't move sooner.`,
    ldrPitch: "We serve five Texas markets with the same tech-forward approach you just experienced — from AI-powered search to builder-negotiated incentives. Reach out and we'll respond within 30 minutes, ready to show you around.",
  };
}
