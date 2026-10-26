import "dotenv/config";
// First: a production process without MALLOC_ARENA_MAX replaces itself with it set (see the module).
import "./mallocArena";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { registerOgMeta } from "../ogMeta";
import { appRouter } from "../routers";
import { syncStatsHandler } from "../scheduledStatsHandler";
import { ensureDealsCron, ensureStatsSyncCron } from "../registerCron";
import { registerDealsRoutes } from "../dealsRoutes";
import { scheduledDealsHandler } from "../scheduledDealsHandler";
import { SUPPLIED_IMPORT_PATH, suppliedImportBodyLimit, suppliedImportHandler } from "../dealsSuppliedImport";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

process.on("unhandledRejection", (error) => {
  // Keep a failed optional Deals side effect from terminating the web process;
  // request handlers themselves still return a controlled error response.
  console.error("[unhandled-rejection]", error);
});

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  // The managed runtime adds exactly one trusted proxy hop. Express derives
  // req.ip from that hop only, protecting Deals consent and rate-limit keys.
  app.set("trust proxy", 1);
  const server = createServer(app);
  // The supplied-import route reads its own body (2 MB cap) before the app-wide parser below can.
  app.use(SUPPLIED_IMPORT_PATH, suppliedImportBodyLimit());
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerOgMeta(app);
  registerDealsRoutes(app);
  // Heartbeat cron callbacks — must be mounted before the Vite/static fallthrough
  app.post("/api/scheduled/syncStats", syncStatsHandler);
  app.post("/api/scheduled/refreshDeals", scheduledDealsHandler);
  // The owner's browser agent posts what it saw on a builder's pages (docs/builder-deals-supplied-import.md).
  app.post(SUPPLIED_IMPORT_PATH, suppliedImportHandler);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    // Register scheduled jobs (daily stats sync). Production only so local dev
    // never touches the shared cron registry; idempotent and non-blocking.
    if (process.env.NODE_ENV === "production") {
      void ensureStatsSyncCron().catch(console.error);
      void ensureDealsCron().catch(console.error);
      // The Builder Deals landing's reads are built now, not by its first visitor (each process has its own cache).
      void import("../dealsRouter").then(({ warmPublicPages }) => warmPublicPages()).catch(console.error);
      // Each start is kept so the health check can tell restarts (and their memory) apart from a busy server.
      void import("../dealsProcessTelemetry").then(({ recordServerBoot, installServerExitRecorder, startServerBeats }) => {
        // How each process ends (stopped, crashed, or killed with its last memory) is kept for the health check.
        installServerExitRecorder();
        startServerBeats();
        return recordServerBoot();
      }).catch(console.error);
    }
  });
}

startServer().catch(console.error);
