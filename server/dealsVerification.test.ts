import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkTwilioVerify, classifyTwilioSendError, sendTwilioVerify } from "./dealsVerification";

const TWILIO_ENV = { TWILIO_ACCOUNT_SID: "ACtest", TWILIO_AUTH_TOKEN: "token", TWILIO_VERIFY_SERVICE_SID: "VAtest" } as const;

function twilioError(code: number, status = 400) {
  return new Response(JSON.stringify({ code, message: `twilio ${code}`, status }), { status, headers: { "content-type": "application/json" } });
}

describe("Twilio Verify send outcomes", () => {
  beforeEach(() => { for (const [key, value] of Object.entries(TWILIO_ENV)) vi.stubEnv(key, value); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("reports unavailable without a Verify configuration and never calls Twilio", async () => {
    vi.stubEnv("TWILIO_VERIFY_SERVICE_SID", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendTwilioVerify("+12105550123", "sms")).toEqual({ ok: false, reason: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the number and channel to the Verify service and succeeds on a 2xx", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "pending" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendTwilioVerify("+12105550123", "call")).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://verify.twilio.com/v2/Services/VAtest/Verifications");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toBe(new URLSearchParams({ To: "+12105550123", Channel: "call" }).toString());
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("ACtest:token").toString("base64")}`);
  });

  it("maps landline, blocked and STOP refusals to cannot_receive so the sheet can offer Call me", async () => {
    for (const code of [60205, 60410, 21610]) {
      vi.stubGlobal("fetch", vi.fn(async () => twilioError(code)));
      expect(await sendTwilioVerify("+12105550123", "sms"), String(code)).toEqual({ ok: false, reason: "cannot_receive" });
    }
  });

  it("treats 60203 (max send attempts) as rate limited, not as a number that cannot receive texts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => twilioError(60203, 429)));
    expect(await sendTwilioVerify("+12105550123", "sms")).toEqual({ ok: false, reason: "rate_limited" });
    expect(classifyTwilioSendError(60203)).toBe("rate_limited");
    expect(classifyTwilioSendError("60203")).toBe("rate_limited");
  });

  it("counts every other API failure, an unparseable body and a network error as a Twilio error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => twilioError(60200)));
    expect(await sendTwilioVerify("+12105550123", "sms")).toEqual({ ok: false, reason: "twilio" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>bad gateway</html>", { status: 502 })));
    expect(await sendTwilioVerify("+12105550123", "sms")).toEqual({ ok: false, reason: "twilio" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    expect(await sendTwilioVerify("+12105550123", "sms")).toEqual({ ok: false, reason: "twilio" });
    expect(classifyTwilioSendError(undefined)).toBe("twilio");
  });

  it("approves a code only when Verify says approved", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "approved" }), { status: 200 })));
    expect(await checkTwilioVerify("+12105550123", "123456")).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "pending" }), { status: 200 })));
    expect(await checkTwilioVerify("+12105550123", "123456")).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => twilioError(20404, 404)));
    expect(await checkTwilioVerify("+12105550123", "123456")).toBe(false);
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await checkTwilioVerify("+12105550123", "123456")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
