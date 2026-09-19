/**
 * The Express app, separated from the listener so it can be exercised over
 * real HTTP in tests (body limits, cache headers, auth on the cron callback)
 * without booting the production entry point.
 */
import express, { type Express } from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { registerOgMeta } from "../ogMeta";
import { appRouter } from "../routers";
import { syncStatsHandler } from "../scheduledStatsHandler";
import { createContext } from "./context";

/**
 * This app accepts small JSON (lead forms, quiz answers, analytics pings) and
 * nothing else — there is no upload route, and the largest legitimate body
 * (a lead with a 5,000-character message) is a few kilobytes. The template
 * shipped with a 50 MB limit "for file uploads" that never existed here,
 * which meant any anonymous caller could make the process buffer 50 MB per
 * request. 1 MB is still hundreds of times more than any real request.
 */
export const JSON_BODY_LIMIT = "1mb";

export function createApp(): Express {
  const app = express();
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(express.urlencoded({ limit: JSON_BODY_LIMIT, extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerOgMeta(app);
  // Heartbeat cron callbacks — must be mounted before the Vite/static fallthrough
  app.post("/api/scheduled/syncStats", syncStatsHandler);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  return app;
}
