import { describe, expect, it } from "vitest";
import { ADMIN_EMAILS, isAdminEmail } from "../shared/site";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function ctxFor(user: { email: string | null; role: "admin" | "user"; openId: string }): TrpcContext {
  return {
    user: {
      id: 999,
      openId: user.openId,
      email: user.email,
      name: "Test",
      loginMethod: "google",
      role: user.role,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => undefined, cookie: () => undefined } as unknown as TrpcContext["res"],
  };
}

describe("admin allowlist", () => {
  it("contains exactly the three company Google accounts", () => {
    expect([...ADMIN_EMAILS].sort()).toEqual([
      "peter@lifestyledesignrealty.com",
      "stefanie@lifestyledesignrealty.com",
      "steven@lifestyledesignrealty.com",
    ]);
  });

  it("isAdminEmail accepts all admins case-insensitively and rejects others", () => {
    expect(isAdminEmail("peter@lifestyledesignrealty.com")).toBe(true);
    expect(isAdminEmail("steven@lifestyledesignrealty.com")).toBe(true);
    expect(isAdminEmail("stefanie@lifestyledesignrealty.com")).toBe(true);
    expect(isAdminEmail("Stefanie@LifestyleDesignRealty.com")).toBe(true);
    expect(isAdminEmail("Steven@LifestyleDesignRealty.com")).toBe(true);
    expect(isAdminEmail(" steven@lifestyledesignrealty.com ")).toBe(true);
    expect(isAdminEmail("random@gmail.com")).toBe(false);
    expect(isAdminEmail("attacker@lifestyledesignrealty.com.evil.com")).toBe(false);
    expect(isAdminEmail("team@lifestyledesignrealty.com")).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
    expect(isAdminEmail("")).toBe(false);
  });

  it("grants admin procedures to Steven (allowlisted + admin role)", async () => {
    const caller = appRouter.createCaller(
      ctxFor({ email: "steven@lifestyledesignrealty.com", role: "admin", openId: "steven-open-id" })
    );
    // listAll is admin-gated; reaching the DB layer (not FORBIDDEN) proves authorization passed.
    await expect(caller.testimonials.listAll()).resolves.toBeDefined();
  });

  it("grants admin procedures to Stefanie (allowlisted + admin role)", async () => {
    const caller = appRouter.createCaller(
      ctxFor({ email: "stefanie@lifestyledesignrealty.com", role: "admin", openId: "stefanie-open-id" })
    );
    await expect(caller.testimonials.listAll()).resolves.toBeDefined();
  });

  it("refuses a random account even if its DB role were tampered to admin", async () => {
    const caller = appRouter.createCaller(
      ctxFor({ email: "random@gmail.com", role: "admin", openId: "random-open-id" })
    );
    await expect(caller.testimonials.listAll()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a non-admin-role account even with an allowlisted email", async () => {
    const caller = appRouter.createCaller(
      ctxFor({ email: "steven@lifestyledesignrealty.com", role: "user", openId: "steven-open-id" })
    );
    await expect(caller.testimonials.listAll()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
