import type { Express, Request, Response, NextFunction } from "express";
import { completeVerification, currentDealSource, dealsCsp, dealsPublicHeaders, ensureDealsCookies, exchangeAccessToken, getDealSettings, isDealsCrawler, randomOpaqueToken, recordDealsLanding, setDealCookie, setGoogleDealsIdentity } from "./dealsService";
import { DEALS_COOKIE } from "../shared/deals";
import { parse as parseCookie } from "cookie";

const safe = (handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { void handler(req, res, next).catch(next); };

/**
 * Express-level routes are deliberately separate from tRPC. They exchange the
 * one-time link before the SPA loads, so the personal token is never available
 * to client JavaScript or included in any API URL.
 */
export function registerDealsRoutes(app: Express) {
  app.use("/deals", (req: Request, res: Response, next: NextFunction) => {
    dealsPublicHeaders(res);
    dealsCsp(res);
    // The landing response—not a later API response—must establish the device
    // and probe cookies. A blocked browser is detected on the next request.
    if (req.method === "GET") {
      const cookies = ensureDealsCookies(req, res);
      if (req.path === "/" && !isDealsCrawler(req)) {
        void getDealSettings().then((settings) => recordDealsLanding({ sourceCode: currentDealSource(String(req.query.src ?? ""), settings), deviceHash: cookies.deviceHash, ip: req.ip || req.socket.remoteAddress || "0.0.0.0" })).catch(() => console.error("[deals] landing event failed"));
      }
    }
    next();
  });

  app.get("/deals/v/:token", safe(async (req, res) => {
    // Validate before touching storage. Do not log this route: token-bearing
    // URLs must never be written into application logs.
    const token = String(req.params.token || "");
    if (!/^[A-Za-z0-9_-]{32,200}$/.test(token)) {
      res.redirect(302, "/deals?expired=1");
      return;
    }
    const result = await exchangeAccessToken(req, res, token);
    // Team members land on their agent tools; buyers on their list.
    if (result === "ok") res.redirect(302, "/deals/mine");
    else if (result === "ok_team") res.redirect(302, "/deals/team");
    else if (result === "needs_gate") res.redirect(302, "/deals?gate=1");
    else if (result === "cookie_blocked") res.redirect(302, "/deals?cookieBlocked=1");
    else res.redirect(302, "/deals?expired=1");
  }));

  app.post("/deals/verify", safe(async (req, res) => {
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (!/^\d{6}$/.test(code)) return res.redirect(302, "/deals?codeError=1");
    const completed = await completeVerification({ req, res, code });
    // An expired 10-minute code session is a gate outcome (?codeError=expired, "Your code
    // session expired. Start again."), not an expired personal link (?expired=1).
    if (!completed.ok) return res.redirect(302, completed.kind === "blocked" ? "/deals?gate=1&blocked=1" : `/deals?codeError=${encodeURIComponent(completed.kind)}`);
    const settings = await getDealSettings();
    const isTest = completed.isTest;
    // Access is never held hostage by CRM availability. A durable job re-reads
    // the lead before every attempt, so a later block/team change suppresses it.
    // The single unlock alert is queued by the job runner once the first_unlock
    // job resolves (so it carries the FUB link, assignment and opt-out marker);
    // team members create no FUB lead and no alert, and a double-submitted
    // verify (duplicate receipt) must not add a spurious "second device" note.
    try {
      if (!completed.isTeam && !completed.duplicate && (!isTest || settings.testModeFullPipeline)) {
        const { enqueueDealsFubJob, runPendingDealsFubJobs } = await import("./dealsFubJobs");
        await enqueueDealsFubJob(completed.leadId, completed.firstUnlock ? "first_unlock" : "reverify", {
          reason: completed.reverifiedActive ? "re-verified on a second device" : "returned for a new link",
          // FUB was unreachable at verification: the runner re-runs the realtor
          // check with the background timeout before any FUB write.
          deferredCheck: completed.fubCheckDeferred,
        });
        void runPendingDealsFubJobs(1).catch(console.error);
      }
    } catch { console.error("[deals] verification side-effect enqueue failed"); }
    // The browser redirects through an opaque, device-bound, one-time token;
    // that exchange sets the HTTP-only session and immediately removes it from
    // the displayed URL.
    res.redirect(302, `/deals/v/${completed.token}`);
  }));

  // Do not leave /mine to a client-side query failure. This check runs before
  // Vite/static serving, so an unauthenticated document is redirected without
  // receiving private catalog markup. Image URLs are stricter: no redirect,
  // no bytes, and no hint about whether an image identifier exists.
  app.get("/deals/mine", safe(async (req, res, next) => {
    const { isLiveDealSession } = await import("./dealsService");
    if (!(await isLiveDealSession(req))) {
      // A session cookie that no longer unlocks anything is an expired 24 h link: that
      // visitor gets the expired page; a browser with no session at all gets the gate.
      const hadSession = Boolean(parseCookie(req.headers.cookie || "")[DEALS_COOKIE.session]);
      return res.redirect(302, hadSession ? "/deals?expired=1" : "/deals?gate=1");
    }
    next();
  }));
  // Agent tools: the same session rules as /deals/mine, and a buyer session is sent to its own list.
  app.get("/deals/team", safe(async (req, res, next) => {
    const { isLiveDealSession } = await import("./dealsService");
    const session = await isLiveDealSession(req);
    if (!session) {
      const hadSession = Boolean(parseCookie(req.headers.cookie || "")[DEALS_COOKIE.session]);
      return res.redirect(302, hadSession ? "/deals?expired=1" : "/deals?gate=1");
    }
    if (session.lead.status !== "team") return res.redirect(302, "/deals/mine");
    next();
  }));
  // Static area map for a community: session-checked, marker-free, no-store (AREA MAP). The param may be "12" or "12.png".
  app.get("/deals/mine/maps/:communityId", safe(async (req, res) => {
    const { dealsMapImageHandler } = await import("./dealsMap");
    await dealsMapImageHandler(req, res);
  }));
  app.get("/deals/mine/img/:photoId", safe(async (req, res) => {
    const { isLiveDealSession } = await import("./dealsService");
    const session = await isLiveDealSession(req);
    if (!session) return res.status(401).end();
    const id = Number(req.params.photoId);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(404).end();
    const rendered = await (await import("./dealsPhotos")).renderDealPhotoForLead(id, session.leadId);
    if (!rendered) return res.status(404).end();
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.type(rendered.contentType).send(rendered.data);
  }));

  app.get("/deals/auth/google", (req, res) => {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? process.env.GOOGLE_DEALS_CLIENT_ID;
    if (!clientId) return res.redirect(302, "/deals?google=unavailable");
    const state = randomOpaqueToken(24);
    setDealCookie(res, "ldr_deals_google_state", state, 10 * 60);
    const redirectUri = `${req.protocol}://${req.get("host")}/deals/auth/google/callback`;
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "openid email profile", state, prompt: "select_account" }).toString();
    res.redirect(302, url.toString());
  });

  app.get("/deals/auth/google/callback", safe(async (req, res) => {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? process.env.GOOGLE_DEALS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? process.env.GOOGLE_DEALS_CLIENT_SECRET;
    const receivedState = String(req.query.state || "");
    const savedState = parseCookie(req.headers.cookie || "")["ldr_deals_google_state"];
    if (!clientId || !clientSecret || !savedState || receivedState !== savedState || typeof req.query.code !== "string") return res.redirect(302, "/deals?google=failed");
    const redirectUri = `${req.protocol}://${req.get("host")}/deals/auth/google/callback`;
    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: req.query.code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }), signal: AbortSignal.timeout(10_000) });
      if (!tokenRes.ok) return res.redirect(302, "/deals?google=failed");
      const tokens = await tokenRes.json() as { access_token?: string };
      if (!tokens.access_token) return res.redirect(302, "/deals?google=failed");
      const profileRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(10_000) });
      const profile = await profileRes.json() as { email?: string; email_verified?: boolean; name?: string };
      if (!profileRes.ok || !profile.email_verified || !profile.email) return res.redirect(302, "/deals?google=failed");
      setGoogleDealsIdentity(res, { email: profile.email, name: profile.name?.slice(0, 190) || null });
      const { clearDealCookie } = await import("./dealsService");
      clearDealCookie(res, "ldr_deals_google_state");
      res.redirect(302, "/deals?google=connected");
    } catch { res.redirect(302, "/deals?google=failed"); }
  }));

  app.use("/deals", (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // Error messages/stacks can contain the personal URL or upstream request
    // credentials. Only a generic marker belongs in the web-process log.
    console.error("[deals] route failure");
    if (res.headersSent) return _next(error);
    if (!res.headersSent) res.redirect(302, "/deals?error=1");
  });
}
