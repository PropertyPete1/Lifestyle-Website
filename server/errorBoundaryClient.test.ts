import { describe, expect, it } from "vitest";

describe("the page's error screen (Oct 28: a tab left open across a release broke on the new server's answer)", async () => {
  const { shouldAutoReload } = await import("../client/src/components/ErrorBoundary");
  it("reloads itself once, and never twice within a minute (a real fault shows the message, no loop)", () => {
    const now = 1_000_000;
    expect(shouldAutoReload(null, now)).toBe(true);
    expect(shouldAutoReload(now - 5_000, now)).toBe(false);
    expect(shouldAutoReload(now - 61_000, now)).toBe(true);
  });
});
