import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { isAdminEmail } from "@shared/site";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { ENV } from "./env";
import { checkRateLimit, clientKey, RATE_LIMIT_MESSAGE, type RateLimitRule } from "../rateLimit";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

/**
 * Admin = signed in AND DB role "admin" AND on the hard allowlist
 * (shared/site.ts ADMIN_EMAILS, or the project owner's openId).
 *
 * The allowlist lives HERE, on the one admin procedure every router shares,
 * rather than in routers.ts. Before this, routers.ts had its own allowlisted
 * copy while the platform's systemRouter (notifyOwner) used a role-only
 * check — so a tampered DB role could page the owner without being on the
 * allowlist. One definition, one rule.
 */
export const adminProcedure = t.procedure.use(requireUser).use(async ({ ctx, next }) => {
  const allowlisted = isAdminEmail(ctx.user.email) || ctx.user.openId === ENV.ownerOpenId;
  if (ctx.user.role !== "admin" || !allowlisted) {
    throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
  }
  return next({ ctx });
});

/**
 * A public procedure with a per-connection request budget (see rateLimit.ts).
 * Over budget → TOO_MANY_REQUESTS with a message the forms show verbatim.
 */
export const rateLimitedProcedure = (rule: RateLimitRule) =>
  t.procedure.use(async ({ ctx, next }) => {
    const decision = checkRateLimit(rule, clientKey(ctx.req));
    if (!decision.allowed) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: RATE_LIMIT_MESSAGE });
    }
    return next();
  });
