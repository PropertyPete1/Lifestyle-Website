export async function sendTwilioVerify(phone: string, channel: "sms" | "call") {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const service = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!sid || !token || !service) return { ok: false as const, reason: "unavailable" as const };
  const body = new URLSearchParams({ To: phone, Channel: channel });
  try {
    const res = await fetch(`https://verify.twilio.com/v2/Services/${encodeURIComponent(service)}/Verifications`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({})) as { code?: number };
      const cannotReceive = [60203, 60205, 60410, 21610].includes(Number(payload.code));
      return { ok: false as const, reason: cannotReceive ? "cannot_receive" as const : "twilio" as const };
    }
    return { ok: true as const };
  } catch { return { ok: false as const, reason: "twilio" as const }; }
}

export async function checkTwilioVerify(phone: string, code: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const service = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!sid || !token || !service) return false;
  try {
    const res = await fetch(`https://verify.twilio.com/v2/Services/${encodeURIComponent(service)}/VerificationCheck`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: phone, Code: code }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return false;
    const value = await res.json().catch(() => ({})) as { status?: string };
    return value.status === "approved";
  } catch { return false; }
}
