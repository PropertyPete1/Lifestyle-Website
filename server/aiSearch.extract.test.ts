import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mocked LLM-path tests for extractCriteria. These run in CI without any API
 * key, so a change to the prompt/JSON schema or the response-parsing logic
 * fails here instead of silently degrading search in production.
 */

vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));

import { invokeLLM } from "./_core/llm";
import { extractCriteria } from "./aiSearch";

const mockLLM = vi.mocked(invokeLLM);

/** Build the response shape extractCriteria reads: choices[0].message.content = JSON string. */
function llmReturns(criteria: Record<string, unknown>) {
  mockLLM.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(criteria) } }],
  } as unknown as Awaited<ReturnType<typeof invokeLLM>>);
}

beforeEach(() => mockLLM.mockReset());

describe("extractCriteria (LLM path, mocked)", () => {
  it("maps a well-formed LLM response into typed criteria", async () => {
    llmReturns({
      city: "Austin",
      minPrice: null,
      maxPrice: 500000,
      minBeds: 3,
      minBaths: 2,
      minSqft: null,
      hasPool: true,
      isNewConstruction: null,
      stories: 1,
      primaryBedDown: true,
      propertyType: "Residential",
      keywords: ["greenbelt"],
    });

    const c = await extractCriteria("3 bed pool home in Austin under 500k, single story, primary down");
    expect(c).toMatchObject({
      city: "Austin",
      maxPrice: 500000,
      minBeds: 3,
      minBaths: 2,
      hasPool: true,
      stories: 1,
      primaryBedDown: true,
      propertyType: "Residential",
    });
    // nulls must be dropped, not carried through as fields
    expect(c.minPrice).toBeUndefined();
    expect(c.isNewConstruction).toBeUndefined();
    expect(c.keywords).toEqual(["greenbelt"]);
  });

  it("falls back to the regex parser when the LLM returns unusable (non-JSON) content", async () => {
    // Covers the catch→fallback path: the model replies with something that
    // isn't parseable JSON, so extractCriteria must recover via regex rather
    // than dead-ending the search.
    mockLLM.mockResolvedValue({
      choices: [{ message: { content: "sorry, I cannot help" } }],
    } as unknown as Awaited<ReturnType<typeof invokeLLM>>);
    const c = await extractCriteria("condo in Houston under 600k with a pool");
    expect(c.city).toBe("Houston");
    expect(c.propertyType).toBe("Townhome/Condo");
    expect(c.hasPool).toBe(true);
    expect(c.maxPrice).toBe(600000);
  });

  it("ignores malformed field types from the model", async () => {
    llmReturns({ city: 123, maxPrice: "lots", hasPool: "yes", keywords: "nope" });
    const c = await extractCriteria("whatever");
    expect(c.city).toBeUndefined();
    expect(c.maxPrice).toBeUndefined();
    expect(c.hasPool).toBeUndefined();
    expect(c.keywords).toBeUndefined();
  });
});
