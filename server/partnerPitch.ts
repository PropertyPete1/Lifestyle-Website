/**
 * Convince Your Partner — server-side AI pitch generation.
 *
 * SECURITY: Uses ANTHROPIC_API_KEY from server environment only. The key is
 * never sent to the client; the browser only ever receives the generated text.
 *
 * CACHING: Results are stored in partner_pitches keyed by slug. The tRPC layer
 * only calls generatePitch() once per quiz submission; shared links read the
 * cached row and never regenerate.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
// Cheapest Anthropic model that writes well (verified working on this key).
// Haiku 4.5 = $1/$5 per MTok vs Sonnet 4.5's $3/$15 — same model for ALL
// AI writing on the site (Convince Your Partner + City Finder narratives).
const MODEL = "claude-haiku-4-5";

export const LIFESTYLE_OPTIONS = [
  "Lake/Water Life",
  "Nightlife & Food Scene",
  "Space & Land",
  "Top-Rated Schools",
  "Short Commute",
  "Low Taxes & Cost of Living",
  "Outdoor/Hill Country Living",
  "Family-Friendly Community",
] as const;
export type LifestyleOption = (typeof LIFESTYLE_OPTIONS)[number];

/** "What's their biggest hesitation?" — multi-select quiz question. */
export const HESITATION_OPTIONS = [
  "Leaving family/friends",
  "Cold weather where we are now",
  "Job/career concerns",
  "Cost of moving",
  "Never lived somewhere new",
  'Not sure Texas is "us"',
] as const;
export type HesitationOption = (typeof HESITATION_OPTIONS)[number];

/** "What do you do for work?" — quick-select quiz question. */
export const WORK_OPTIONS = [
  "Remote/Work From Home",
  "Hybrid",
  "Would need to find a new job",
  "Business owner",
] as const;
export type WorkOption = (typeof WORK_OPTIONS)[number];

/** Deterministic market match from selections (mirrors City Finder spirit). */
export function matchCity(selections: string[]): string {
  const s = new Set(selections);
  const scores: Record<string, number> = {
    "San Antonio": 0,
    "New Braunfels": 0,
    Austin: 0,
    DFW: 0,
    Houston: 0,
  };
  if (s.has("Lake/Water Life")) {
    scores["New Braunfels"] += 3;
    scores.Austin += 2;
  }
  if (s.has("Nightlife & Food Scene")) {
    scores.Austin += 3;
    scores.Houston += 2;
    scores["San Antonio"] += 1;
  }
  if (s.has("Space & Land")) {
    scores["San Antonio"] += 2;
    scores["New Braunfels"] += 2;
    scores.Houston += 1;
  }
  if (s.has("Top-Rated Schools")) {
    scores.DFW += 3;
    scores["San Antonio"] += 1;
  }
  if (s.has("Short Commute")) {
    scores.DFW += 2;
    scores.Austin += 2;
    scores.Houston += 1;
  }
  if (s.has("Low Taxes & Cost of Living")) {
    scores["San Antonio"] += 3;
    scores.Houston += 2;
  }
  if (s.has("Outdoor/Hill Country Living")) {
    scores["New Braunfels"] += 3;
    scores["San Antonio"] += 2;
  }
  if (s.has("Family-Friendly Community")) {
    scores["San Antonio"] += 2;
    scores.DFW += 2;
    scores["New Braunfels"] += 1;
  }
  let best = "San Antonio";
  let bestScore = -1;
  for (const [city, score] of Object.entries(scores)) {
    if (score > bestScore) {
      best = city;
      bestScore = score;
    }
  }
  return best;
}

/** True, selection-tied supporting stats (verified general facts, no rates). */
export function pickStats(selections: string[], city: string): string[] {
  const s = new Set(selections);
  const stats: string[] = [];
  if (s.has("Low Taxes & Cost of Living"))
    stats.push("Texas has no state income tax — your paycheck goes further from day one.");
  if (s.has("Top-Rated Schools"))
    stats.push(
      city === "DFW"
        ? "DFW suburbs like Prosper, Southlake, and Frisco are home to some of the highest-rated school districts in Texas."
        : "Texas is home to hundreds of A-rated public school districts, with strong options in every market we serve."
    );
  if (s.has("Lake/Water Life"))
    stats.push(
      city === "New Braunfels"
        ? "New Braunfels sits on two rivers — the Comal and the Guadalupe — with Canyon Lake minutes away."
        : "Central Texas offers year-round lake living, from Lake Travis to Canyon Lake."
    );
  if (s.has("Space & Land"))
    stats.push("Texas offers dramatically more square footage and lot size per dollar than coastal markets.");
  if (s.has("Nightlife & Food Scene"))
    stats.push(
      city === "Austin"
        ? "Austin's live-music and food scene is nationally ranked — and it never slows down."
        : "Texas's big-city food scenes rank among the best in the country."
    );
  if (s.has("Short Commute"))
    stats.push("Master-planned communities across our markets put major employers within a short drive.");
  if (s.has("Outdoor/Hill Country Living"))
    stats.push("The Texas Hill Country offers hiking, rivers, and vineyard weekends right outside your door.");
  if (s.has("Family-Friendly Community"))
    stats.push("Texas consistently ranks among the top states families relocate to, year after year.");
  if (stats.length === 0)
    stats.push("Texas has no state income tax — your paycheck goes further from day one.");
  return stats.slice(0, 2);
}

const SYSTEM_PROMPT = `You are the voice of Lifestyle Design Realty, a boutique Central Texas brokerage. You write short, cinematic, emotionally persuasive "dream scene" narratives that help someone convince their partner to move to Texas.

Rules:
- Write in warm, confident, genuinely persuasive second person ("you", or addressed to the partner by name when given) — like a personal love letter to a lifestyle, never like a listing or an ad.
- Ground every detail in real, verifiable characteristics of the matched market (San Antonio, New Braunfels, Austin, DFW, or Houston). Never invent false claims, fake statistics, or specific numbers.
- NEVER mention interest rates, percentages, prices, or any numeric financial promises. Financial copy is handled separately outside your text.
- NEVER make comparative affordability or savings claims (e.g. "costs half what you'd pay elsewhere", "for a fraction of the price", "twice the house for the money"). You may evoke value softly ("your money goes further") but never quantify or compare prices, costs, or savings.
- 2 to 4 sentences. Vivid, specific, sensory. Every result must feel uniquely written for this person's exact combination of preferences — never generic or template-like.
- When the partner's hesitations are provided, address them directly and tactfully inside the scene — acknowledge the concern with empathy, then resolve it with a real, specific quality of the matched market. When a work situation is provided, make the move feel practical for it — but never promise jobs, income, or business outcomes.
- Do not use em dashes excessively, do not start with "Imagine". Vary your openings.
- Return ONLY the narrative text, no preamble, no quotes.`;

export interface PitchInput {
  selections: string[];
  partnerName?: string;
  city: string;
  /** Partner's stated hesitations — the pitch should tactfully address these. */
  hesitations?: string[];
  /** The mover's work situation — the pitch should acknowledge it naturally. */
  workSituation?: string;
}

/** Builds the user-turn prompt content shared by the first call and the compliance retry. */
export function buildUserPrompt(input: PitchInput, nameLine: string, retrySuffix = ""): string {
  const lines = [
    `Their dream-life picks: ${input.selections.join(", ")}.`,
    `Matched Texas market: ${input.city}.`,
  ];
  if (input.hesitations && input.hesitations.length > 0) {
    lines.push(
      `The partner's biggest hesitations about moving: ${input.hesitations.join(", ")}. ` +
        "Tactfully and directly ease these specific concerns within the scene — acknowledge the feeling, then show how life in this market answers it. Never dismiss or belittle the hesitation."
    );
  }
  if (input.workSituation) {
    lines.push(
      `Their work situation: ${input.workSituation}. ` +
        "Weave this in naturally so the move feels practical for how they actually work (e.g. remote work travels with them; a business owner finds a business-friendly climate; a job seeker finds thriving job markets). Do not cite statistics or make guarantees about employment."
    );
  }
  lines.push(nameLine);
  lines.push(`\nWrite the dream scene now.${retrySuffix}`);
  return lines.join("\n");
}

/** Calls Claude to generate the dream scene. Throws on failure (caller handles fallback). */
export async function generatePitch(input: PitchInput): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const nameLine = input.partnerName
    ? `The partner's first name is "${input.partnerName}" — address parts of the scene to them by name naturally (once or twice, not every sentence).`
    : "No partner name was given — write in inviting second person.";

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: buildUserPrompt(input, nameLine),
        },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = data.content?.find((c) => c.type === "text")?.text?.trim();
  if (!text) throw new Error("Anthropic API returned no text");
  if (violatesCompliance(text)) {
    // One retry with an explicit correction, then fall back to caller's handler
    const retry = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: buildUserPrompt(input, nameLine, " IMPORTANT: absolutely no numbers, no price/cost/savings comparisons of any kind."),
          },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (retry.ok) {
      const retryData = (await retry.json()) as { content?: { type: string; text?: string }[] };
      const retryText = retryData.content?.find((c) => c.type === "text")?.text?.trim();
      if (retryText && !violatesCompliance(retryText)) return retryText;
    }
    throw new Error("Generated text failed compliance check");
  }
  return text;
}

/**
 * Compliance guard for AI output: numeric financial figures, rates, and
 * comparative affordability/savings claims are all rejected.
 *
 * WHY THE WORD FORMS MATTER AS MUCH AS THE SYMBOLS: this started as a
 * symbol-only guard (`%` and `$`), which meant an LLM that wrote "rates as low
 * as 3.99 percent" or "homes from 300,000 dollars" sailed straight through to a
 * customer. A rate quoted without the adjacent lender disclosure is exactly the
 * claim the hero's attorney-reviewed disclaimer exists to qualify, and the AI
 * pages are the one surface where nobody reviews the wording before a visitor
 * reads it. So every figure is matched in BOTH the symbol and the spelled form.
 *
 * Deliberately still allowed, because the system prompt invites them and they
 * carry no number: "negotiated rate buydowns", "builder incentives", "your
 * money goes further". Over-blocking here is not free — every rejection costs a
 * retry and then falls back to templated copy, so the patterns are written to
 * catch quantities, not the general subject of money.
 */
export function violatesCompliance(text: string): boolean {
  const patterns = [
    // --- percentages, symbol and word ---
    /\d+(\.\d+)?\s*%/, // 3.99%
    /\d[\d,.]*\s*(percent|per cent|pct)\b/i, // "3.99 percent"
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|half|quarter)\b[^.]{0,24}\bper ?cent\b/i, // "five and a half percent"

    // --- dollar figures, symbol and word ---
    /\$\s?\d/, // $310,000
    /\d[\d,.]*\s*(dollars|usd)\b/i, // "300,000 dollars"
    /\b(hundred|thousand|million)\s+dollars\b/i, // "three hundred thousand dollars"
    /\b\d[\d,.]*\s?[kK]\b/, // "310K"

    // --- rate language ---
    /\binterest rates?\b/i,
    /\b(mortgage|financing|loan|lending)\s+rates?\b/i, // "mortgage rate" — not just "interest rate"
    /\brates?\s+(as low as|starting at|from|around|near|down to)\b/i,
    /\bAPR\b/, // case-sensitive so it can't fire on "Apr"
    /\bbasis points?\b/i,
    /\b(\d+(\.\d+)?|one|two|three|four)\s+points?\s+(buy-?down)\b/i,
    /\bmortgage payments?\b/i,

    // --- comparative affordability / savings ---
    /\b(costs?|pay(ing)?|priced?)\b[^.]{0,40}\b(half|double|twice|fraction|less than|a third)\b/i,
    /\b(half|double|twice|a fraction of|a third of)\b[^.]{0,40}\b(price|cost|what you'?d pay|the money)\b/i,
    /\bsave (you )?(thousands|tens of thousands|hundreds)\b/i,
  ];
  return patterns.some((p) => p.test(text));
}

/** Graceful non-AI fallback if the API is unavailable — still warm and personal. */
export function fallbackPitch(input: PitchInput): string {
  const name = input.partnerName ? `${input.partnerName}, ` : "";
  return `${name}picture a slower morning, a bigger backyard, and a life built around what you actually love — that's what ${input.city} does best. Between the people, the pace, and everything your new hometown puts within reach, this is the move that finally makes the life you've been talking about real. Let us show you both around — no pressure, just proof.`;
}
