import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Nov 5, 2026: only the team view is primed on boot; the 512 MB host could not carry a second list through the morning sync. */
describe("list priming", () => {
  it("primes the team view only", () => {
    const source = readFileSync(new URL("./dealsRouter.ts", import.meta.url), "utf8");
    const line = source.split("\n").find((l) => l.startsWith("const PRIMED_LIST_VIEWS"))!;
    expect(line).toContain('[{ view: "full", builderPages: true }]');
    expect(line).not.toContain('"gated"');
  });
});
