import { describe, expect, it } from "vitest";

describe("Builder Deals test-only OTP configuration", () => {
  it("is present as a six-digit server secret and not a documented example", () => {
    const otp = process.env.DEALS_TEST_OTP;
    expect(otp).toMatch(/^\d{6}$/);
    expect(["000000", "111111", "123456"]).not.toContain(otp);
  });
});
