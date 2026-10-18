import { describe, expect, it } from "vitest";
import {
  extractTenDigitPhoneStrings,
  hasDealsTestFlag,
  normalizeFubPhone,
} from "./dealsMaintenance";

describe("Builder Deals maintenance utilities", () => {
  it("normalizes only valid North American FUB phone values", () => {
    expect(normalizeFubPhone("(210) 555-0123")).toBe("+12105550123");
    expect(normalizeFubPhone("+1 210 555 0123")).toBe("+12105550123");
    expect(normalizeFubPhone("not a phone")).toBeNull();
  });

  it("extracts only standalone ten-digit strings from notes", () => {
    expect(extractTenDigitPhoneStrings("Call 2105550123 or 2105550123; not 12105550123.")).toEqual(["2105550123"]);
  });

  it("requires an explicit TEST flag in supported JSON flag shapes", () => {
    expect(hasDealsTestFlag('["TEST", "team"]')).toBe(true);
    expect(hasDealsTestFlag('{"flags":["test"]}')).toBe(true);
    expect(hasDealsTestFlag('["CONTEST"]')).toBe(false);
    expect(hasDealsTestFlag("not json")).toBe(false);
  });
});
