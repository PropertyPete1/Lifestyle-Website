import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function makeCtx(role: "user" | "admin" | null): TrpcContext {
  const user: AuthenticatedUser | null = role
    ? {
        id: 99,
        openId: "test-user",
        email: "test@example.com",
        name: "Test User",
        loginMethod: "manus",
        role,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      }
    : null;

  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

describe("admin role gating", () => {
  it("rejects unauthenticated users from admin mutations", async () => {
    const caller = appRouter.createCaller(makeCtx(null));
    await expect(
      caller.testimonials.create({ quote: "x", author: "y", source: "", sortOrder: 1, published: true })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects non-admin users from admin mutations", async () => {
    const caller = appRouter.createCaller(makeCtx("user"));
    await expect(
      caller.testimonials.create({ quote: "x", author: "y", source: "", sortOrder: 1, published: true })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects non-admin users from lead log access", async () => {
    const caller = appRouter.createCaller(makeCtx("user"));
    await expect(caller.leads.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
