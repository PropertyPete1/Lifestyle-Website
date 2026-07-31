import { describe, expect, it } from "vitest";
import {
  GENERIC_SUBMIT_ERROR,
  NETWORK_SUBMIT_ERROR,
  SUPPORT_PHONE,
  humanizeSubmitError,
  isUsableEmail,
  isUsablePhone,
} from "../shared/formErrors";

/**
 * Regression guard for a bug that was live: tRPC returns zod failures as a RAW
 * JSON array in err.message, and the forms piped that straight into a toast, so
 * a visitor with a short phone number saw a JSON blob.
 */
describe("humanizeSubmitError", () => {
  it("extracts the human sentence from a raw zod issue array", () => {
    const raw = JSON.stringify([
      { code: "custom", path: ["phone"], message: "A valid phone number is required." },
    ]);
    expect(humanizeSubmitError(raw)).toBe("A valid phone number is required.");
  });

  it("handles the exact TCPA payload the live server returns", () => {
    const raw =
      '[\n  {\n    "code": "invalid_value",\n    "values": [\n      true\n    ],\n    "path": [\n      "tcpaConsent"\n    ],\n    "message": "TCPA consent is required"\n  }\n]';
    expect(humanizeSubmitError(raw)).toBe("TCPA consent is required");
  });

  it("accepts an Error-shaped object, not just a string", () => {
    expect(humanizeSubmitError(new Error(JSON.stringify([{ message: "Nope." }])))).toBe("Nope.");
  });

  it("NEVER leaks raw JSON to a visitor", () => {
    for (const raw of ['[{"code":"custom"}]', "[not json", '{"code":"BAD_REQUEST"}', "TRPCClientError: x"]) {
      const out = humanizeSubmitError(raw);
      expect(out).not.toContain("{");
      expect(out).not.toContain('"code"');
      expect(out).toContain(SUPPORT_PHONE); // always offers the phone fallback
    }
  });

  it("maps network/timeout/abort failures to the connection message", () => {
    for (const raw of ["Failed to fetch", "The operation timed out", "signal is aborted", "NetworkError"]) {
      expect(humanizeSubmitError(raw)).toBe(NETWORK_SUBMIT_ERROR);
    }
  });

  it("falls back to the generic message for empty/unknown input", () => {
    expect(humanizeSubmitError(undefined)).toBe(GENERIC_SUBMIT_ERROR);
    expect(humanizeSubmitError(null)).toBe(GENERIC_SUBMIT_ERROR);
    expect(humanizeSubmitError("")).toBe(GENERIC_SUBMIT_ERROR);
  });

  it("always gives the visitor a path forward (phone number present)", () => {
    expect(GENERIC_SUBMIT_ERROR).toContain(SUPPORT_PHONE);
    expect(NETWORK_SUBMIT_ERROR).toContain(SUPPORT_PHONE);
  });

  it("passes through an already-human message untouched", () => {
    expect(humanizeSubmitError("A valid phone number is required.")).toBe(
      "A valid phone number is required."
    );
  });
});

describe("isUsablePhone — mirrors the server rule (>=7 digits)", () => {
  it("accepts real formats", () => {
    for (const p of ["2109813830", "(210) 981-3830", "+1 210-981-3830", "210.981.3830"]) {
      expect(isUsablePhone(p), p).toBe(true);
    }
  });
  it("rejects what the server would reject", () => {
    for (const p of ["", "   ", "12", "555-12", "abcdef", undefined, null]) {
      expect(isUsablePhone(p as string), String(p)).toBe(false);
    }
  });
});

describe("isUsableEmail", () => {
  it("accepts normal addresses and rejects obvious junk", () => {
    expect(isUsableEmail("a@b.co")).toBe(true);
    for (const e of ["", "a@b", "a b@c.com", "nope", undefined]) {
      expect(isUsableEmail(e as string), String(e)).toBe(false);
    }
  });
});
