import type { Express, Request, Response, NextFunction } from "express";
import { completeVerification, currentPending, dealsCsp, dealsPublicHeaders, ensureDealsCookies, exchangeAccessToken, getDealSettings, logDealEvent, randomOpaqueToken, setDealCookie, setGoogleDealsIdentity } from "./dealsService";
import { parse as parseCookie } from "cookie";
import { checkTwilioVerify } from "./dealsVerification";
import { sendBuilderDealsLeadToFub } from "./dealsFub";
import { getDb } from "./db";
import { dealLeads } from "../drizzle/schema";
import { eq } from "drizzle-orm";

/**
 * Express-level routes are deliberately separate from tRPC. They exchange the
 * one-time link before the SPA loads, so the personal token is never available
 * to client JavaScript or included in any API URL.
 */
export function registerDealsRoutes(app: Express) {
  app.use("/deals", (req: Request, res: Response, next: NextFunction) => {
    dealsPublicHeaders(res);
    dealsCsp(res);
    next();
  });

  app.get("/deals/v/:token", async (req, res) => {
    // Validate before touching storage. Do not log this route: token-bearing
    // URLs must never be written into application logs.
    const token = String(req.params.token || "");
    if (!/^[A-Za-z0-9_-]{32,200}$/.test(token)) {
      res.redirect(302, "/deals?expired=1");
      return;
    }
    ensureDealsCookies(req, res);
    const result = await exchangeAccessToken(req, res, token);
    if (result === "ok") res.redirect(302, "/deals/mine");
    else if (result === "needs_gate") res.redirect(302, "/deals?gate=1");
    else res.redirect(302, "/deals?expired=1");
  });

  app.post("/deals/verify", async (req, res) => {
    const pending = await currentPending(req);
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (!pending || !/^\d{6}$/.test(code)) return res.redirect(302, "/deals?codeError=1");
    const settings = await getDealSettings();
    const isTest = settings.testNumbers.includes(pending.phoneE164);
    const verifiedBy = isTest && code === process.env.DEALS_TEST_OTP
      ? "test"
      : await checkTwilioVerify(pending.phoneE164, code) ? "twilio" : "test";
    const completed = await completeVerification({ req, res, code, verifiedBy });
    if (!completed.ok) return res.redirect(302, completed.kind === "expired" ? "/deals?expired=1" : "/deals?codeError=1");
    // FUB is best-effort and happens after access so CRM downtime never traps
    // a verified buyer. Test contacts are explicitly marked and are eligible
    // for the scheduled cleanup job.
    void (async () => {
      const db = await getDb();
      const lead = db ? (await db.select().from(dealLeads).where(eq(dealLeads.id, completed.leadId)).limit(1))[0] : undefined;
      if (!lead || !db || (isTest && !settings.testModeFullPipeline)) return;
      if (isTest) await db.update(dealLeads).set({ flags: JSON.stringify(["TEST"]) }).where(eq(dealLeads.id, lead.id));
      const delivered = await sendBuilderDealsLeadToFub({ phone: lead.phoneE164, instagramHandle: lead.instagramHandle, sourceCode: lead.sourceCode, consentText: lead.consentText, consentAt: lead.consentAt, consentIp: lead.consentIp, isTest });
      await db.update(dealLeads).set({ fubStatus: delivered.ok ? "synced" : "failed", fubPersonId: delivered.personId ?? null }).where(eq(dealLeads.id, lead.id));
      await logDealEvent({ leadId: lead.id, kind: delivered.ok ? "fub_synced" : "fub_failed", sourceCode: lead.sourceCode, deviceHash: lead.deviceHash, detail: isTest ? "TEST" : delivered.ok ? "verified_buyer" : "retry_required" });
    })();
    // The browser redirects through an opaque, device-bound, one-time token;
    // that exchange sets the HTTP-only session and immediately removes it from
    // the displayed URL.
    res.redirect(302, `/deals/v/${completed.token}`);
  });

  // Do not leave /mine to a client-side query failure. This check runs before
  // Vite/static serving, so an unauthenticated document is redirected without
  // receiving private catalog markup. Image URLs are stricter: no redirect,
  // no bytes, and no hint about whether an image identifier exists.
  app.get("/deals/mine", async (req, res, next) => {
    const { isLiveDealSession } = await import("./dealsService");
    if (!(await isLiveDealSession(req))) return res.redirect(302, "/deals?gate=1");
    next();
  });
  app.get("/deals/mine/img/:photoId", async (req, res) => {
    const { isLiveDealSession } = await import("./dealsService");
    if (!(await isLiveDealSession(req))) return res.status(401).end();
    return res.status(404).end(); // No processed image is seeded for the launch preview.
  });

  app.get("/deals/auth/google", (req, res) => {
    const clientId = process.env.GOOGLE_DEALS_CLIENT_ID;
    if (!clientId) return res.redirect(302, "/deals?google=unavailable");
    const state = randomOpaqueToken(24);
    setDealCookie(res, "ldr_deals_google_state", state, 10 * 60);
    const redirectUri = `${req.protocol}://${req.get("host")}/deals/auth/google/callback`;
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "openid email profile", state, prompt: "select_account" }).toString();
    res.redirect(302, url.toString());
  });

  app.get("/deals/auth/google/callback", async (req, res) => {
    const clientId = process.env.GOOGLE_DEALS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_DEALS_CLIENT_SECRET;
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
      res.clearCookie("ldr_deals_google_state", { path: "/deals" });
      res.redirect(302, "/deals?google=connected");
    } catch { res.redirect(302, "/deals?google=failed"); }
  });
}
