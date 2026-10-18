import { describe, expect, it } from "vitest";

const otp = process.env.DEALS_TEST_OTP?.trim();
const otpTest = otp ? it : it.skip;

describe("Builder Deals test-only OTP configuration", () => {
  otpTest(otp ? "is a six-digit server secret and not a documented example" : "skips the OTP assertion only because DEALS_TEST_OTP is absent", () => {
    expect(otp).toMatch(/^\d{6}$/);
    expect(["000000", "111111", "123456"]).not.toContain(otp);
  });
});
