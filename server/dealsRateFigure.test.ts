import { describe, expect, it } from "vitest";
import { normalizeRateFigure } from "../shared/deals";

describe("normalizeRateFigure", () => {
  it("drops a label the card prints itself and keeps the figure", () => {
    expect(normalizeRateFigure("5.737% APR")).toBe("5.737%");
    expect(normalizeRateFigure("5.737% APR.")).toBe("5.737%");
    expect(normalizeRateFigure("APR: 6.051%")).toBe("6.051%");
    expect(normalizeRateFigure("4.25% interest rate")).toBe("4.25%");
    expect(normalizeRateFigure("4.999% rate")).toBe("4.999%");
    expect(normalizeRateFigure("5.25 % annual percentage rate")).toBe("5.25%");
    expect(normalizeRateFigure("4.999% fixed")).toBe("4.999%");
  });

  it("adds the percent sign to a bare number and leaves other wording alone", () => {
    expect(normalizeRateFigure("5.737")).toBe("5.737%");
    expect(normalizeRateFigure("  4.25%  ")).toBe("4.25%");
    expect(normalizeRateFigure("as low as 4.25%")).toBe("as low as 4.25%");
    expect(normalizeRateFigure("Years 2 to 30")).toBe("Years 2 to 30");
  });

  it("maps nothing to null", () => {
    expect(normalizeRateFigure(null)).toBeNull();
    expect(normalizeRateFigure(undefined)).toBeNull();
    expect(normalizeRateFigure("")).toBeNull();
    expect(normalizeRateFigure(" APR ")).toBeNull();
  });
});
