import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePitch } from "./partnerPitch";

/**
 * Mocked Anthropic-path tests for generatePitch. No API key or network needed,
 * so a change to the request shape, the compliance guard, or the retry/fallback
 * flow fails in CI instead of only surfacing live in production.
 */

const prevKey = process.env.ANTHROPIC_API_KEY;

function anthropicText(text: string) {
  return {
    ok: true,
    json: async () => ({ content: [{ type: "text", text }] }),
    text: async () => "",
  } as unknown as Response;
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = prevKey;
});

const input = { selections: ["Lake/Water Life", "Outdoor/Hill Country Living"], city: "New Braunfels" };

describe("generatePitch (Anthropic path, mocked)", () => {
  it("returns the generated narrative on a clean, compliant response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      anthropicText("Wake to the river just beyond your porch and hills at your back.")
    );
    vi.stubGlobal("fetch", fetchMock);

    const text = await generatePitch(input);
    expect(text).toContain("river just beyond your porch");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // sends the key and never leaks it into the body
    const [, opts] = fetchMock.mock.calls[0];
    expect((opts.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
  });

  it("retries once when the first result violates compliance, then returns the clean retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(anthropicText("Save thousands — homes here cost half what you'd pay in California."))
      .mockResolvedValueOnce(anthropicText("A slower morning, a bigger yard, and the Guadalupe at your door."));
    vi.stubGlobal("fetch", fetchMock);

    const text = await generatePitch(input);
    expect(text).toContain("Guadalupe at your door");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws when both attempts violate compliance (caller uses fallback)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(anthropicText("Rates as low as 4.99% and save $50,000!"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(generatePitch(input)).rejects.toThrow(/compliance/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws on a non-OK Anthropic response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "rate limited",
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(generatePitch(input)).rejects.toThrow(/Anthropic API error 429/);
  });

  it("throws when ANTHROPIC_API_KEY is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(generatePitch(input)).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});
