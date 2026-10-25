import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GATE_COPY, INSTAGRAM_HANDLE_MAX, SOURCE_CODE_MAX, codeStepAlert, gateReducer, gateStepAlert, initialGateState, readGateParams, startLeavesPending, stripTransientGateParams, type GateDealsState, type GateState } from "../client/src/lib/dealsGate";
import type { GateSheetViewProps } from "../client/src/components/deals/GateSheet";

/**
 * Gate sheet behaviour for the server outcomes the visitor can hit (A6, A17,
 * funnel items 7 to 9). The reducer is exercised directly; the view is rendered
 * to static markup so the copy and controls for each state can be asserted
 * without a browser.
 *
 * The server-side vitest config compiles client JSX with the classic runtime
 * (the Vite build uses the automatic one), so React is exposed as a global
 * before the component module is loaded.
 */
(globalThis as { React?: typeof React }).React = React;
const { GateSheetView } = await import("../client/src/components/deals/GateSheet");
const { createElement } = React;

const noPending: GateDealsState = { pending: null };
const withPending: GateDealsState = { pending: { displayPhone: "(210) •••-0123", expiresAt: "2026-10-19T00:10:00.000Z" } };
const gateParams = (search: string) => readGateParams(search);
const fresh = (search = "", state: GateDealsState = undefined) => initialGateState(gateParams(search), state);

const SERVER_OUTSIDE_US = "US mobile numbers only for now. Outside the US? Text HOME to (512) 542-1477 and we'll help you directly.";
const SERVER_CANNOT_RECEIVE = "That number can't receive texts. Try a mobile number or tap Call me.";

function render(gate: GateState, state: GateDealsState, overrides: Partial<GateSheetViewProps> = {}) {
  const noop = () => undefined;
  const props: GateSheetViewProps = {
    gate, state: state as GateSheetViewProps["state"], phone: "(210) 555-0123", name: "Maria Lopez", email: "maria@example.com", code: "", choice: "buyer",
    onPhone: noop, onCode: noop, onChoice: noop, onContinue: noop, onConfirmAgent: noop, onGo: noop, onResend: noop, onChangeNumber: noop, onCopyLink: noop, onClose: noop,
    ...overrides,
  };
  return renderToStaticMarkup(createElement(GateSheetView, props));
}

const decode = (value: string) => value.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const alerts = (html: string) => Array.from(html.matchAll(/<p[^>]*role="alert"[^>]*>([^<]*)<\/p>/g)).map((match) => decode(match[1]));
const statuses = (html: string) => Array.from(html.matchAll(/<p[^>]*role="status"[^>]*>([^<]*)<\/p>/g)).map((match) => decode(match[1]));

describe("gate reducer: cannot_receive keeps the visitor on the code step with Call me", () => {
  it("moves start -> cannot_receive to the code step, keeps the server message verbatim and marks Call me as the next step", () => {
    const gate = gateReducer(fresh(), { type: "start_result", result: { ok: false, kind: "cannot_receive", message: SERVER_CANNOT_RECEIVE, displayPhone: "(210) •••-0123" } });
    expect(gate.step).toBe("code");
    expect(gate.cannotReceive).toBe(true);
    expect(gate.message).toBe(SERVER_CANNOT_RECEIVE);
    expect(gate.pendingDisplayPhone).toBe("(210) •••-0123");
  });

  it("renders the cannot_receive code step with the message in an alert and a primary Call me button above the code field", () => {
    const gate = gateReducer(fresh(), { type: "start_result", result: { ok: false, kind: "cannot_receive", message: SERVER_CANNOT_RECEIVE } });
    const html = render(gate, withPending);
    expect(decode(alerts(html).join("\n"))).toContain(SERVER_CANNOT_RECEIVE);
    const callButton = html.indexOf("Call me with the code instead");
    const codeField = html.indexOf('id="deals-code"');
    expect(callButton).toBeGreaterThan(-1);
    expect(callButton).toBeLessThan(codeField);
    expect(html.slice(html.lastIndexOf("<button", callButton), callButton)).toContain("bg-gold");
    expect(html).not.toContain("Check your messages.");
    expect(html).toContain("Wrong number? Change it");
    // The masked number comes from deals.state when start did not return one.
    expect(html).toContain("(210) •••-0123");
  });

  it("clears the Call me emphasis once the voice code is on its way and keeps it when resend reports cannot_receive", () => {
    const stuck = gateReducer(fresh(), { type: "start_result", result: { ok: false, kind: "cannot_receive", message: SERVER_CANNOT_RECEIVE } });
    const called = gateReducer(stuck, { type: "resend_result", channel: "call", result: { ok: true } });
    expect(called.cannotReceive).toBe(false);
    expect(called.step).toBe("code");
    expect(called.message).toBe(GATE_COPY.calling);
    const again = gateReducer(gateReducer(fresh(), { type: "start_result", result: { ok: true, displayPhone: "(210) •••-0123" } }), { type: "resend_result", channel: "sms", result: { ok: false, kind: "cannot_receive", message: SERVER_CANNOT_RECEIVE } });
    expect(again.cannotReceive).toBe(true);
    expect(again.message).toBe(SERVER_CANNOT_RECEIVE);
    expect(render(again, withPending)).toContain("Call me with the code instead");
  });

  it("returns to the gate with the server message when the resend finds no pending record", () => {
    const gate = gateReducer(gateReducer(fresh(), { type: "start_result", result: { ok: true, displayPhone: "(210) •••-0123" } }), { type: "resend_result", channel: "sms", result: { ok: false, kind: "expired", message: "Your code session expired. Start again." } });
    expect(gate.step).toBe("gate");
    expect(gateStepAlert(gate, noPending)).toBe("Your code session expired. Start again.");
  });
});

describe("gate reducer: server copy is rendered verbatim", () => {
  it("shows the outside-US message exactly as the server sent it and stays on the phone step", () => {
    const gate = gateReducer(fresh(), { type: "start_result", result: { ok: false, kind: "outside_us", message: SERVER_OUTSIDE_US } });
    expect(gate.step).toBe("gate");
    expect(gateStepAlert(gate, noPending)).toBe(SERVER_OUTSIDE_US);
    expect(gateStepAlert(gate, undefined)).toBe(SERVER_OUTSIDE_US);
    expect(decode(alerts(render(gate, noPending)).join(""))).toBe(SERVER_OUTSIDE_US);
  });

  it("routes blocked and cookie_blocked outcomes to their steps with the server message", () => {
    const blocked = gateReducer(fresh(), { type: "start_result", result: { ok: false, kind: "blocked", message: "This page is for buyers who aren't working with an agent yet. Thanks for checking us out! Made a mistake? Text HOME to (512) 542-1477." } });
    expect(blocked.step).toBe("blocked");
    expect(decode(render(blocked, noPending))).toContain("Made a mistake? Text HOME to (512) 542-1477.");
    const cookie = gateReducer(fresh(), { type: "start_result", result: { ok: false, kind: "cookie_blocked", message: "Your browser is blocking cookies. Open this link in Safari or Chrome. Or text HOME to (512) 542-1477." } });
    expect(cookie.step).toBe("cookie-blocked");
    expect(render(cookie, noPending)).toContain("Copy link");
  });

  it("keeps rate-limit copy from the server on the phone step", () => {
    const message = "We're getting a lot of traffic, so please try again in a bit. Or text HOME to (512) 542-1477.";
    const gate = gateReducer(fresh(), { type: "start_result", result: { ok: false, kind: "rate_limited", message } });
    expect(gate.step).toBe("gate");
    expect(decode(alerts(render(gate, noPending)).join(""))).toBe(message);
  });
});

describe("codeError lives in state and is cleared on step changes", () => {
  it("shows nothing on the gate while deals.state is still loading, and the wrong-code copy on the code step once a pending record resolves", () => {
    const start = fresh("?codeError=invalid_code", undefined);
    expect(start.step).toBe("gate");
    expect(start.codeError).toBe("invalid_code");
    expect(gateStepAlert(start, undefined)).toBeNull();
    expect(alerts(render(start, undefined))).toEqual([]);
    const resumed = gateReducer(start, { type: "state_changed", state: withPending });
    expect(resumed.step).toBe("code");
    expect(codeStepAlert(resumed)).toBe(GATE_COPY.codeMismatch);
    expect(alerts(render(resumed, withPending))).toEqual([GATE_COPY.codeMismatch]);
  });

  it("explains the fifth wrong code on the gate only after deals.state resolved without a pending record", () => {
    const start = fresh("?codeError=invalid_code", undefined);
    const resolved = gateReducer(start, { type: "state_changed", state: noPending });
    expect(resolved.step).toBe("gate");
    expect(gateStepAlert(resolved, noPending)).toBe(GATE_COPY.tooManyWrongCodes);
    expect(alerts(render(resolved, noPending))).toEqual([GATE_COPY.tooManyWrongCodes]);
    expect(GATE_COPY.tooManyWrongCodes).not.toMatch(/—/);
  });

  it("drops codeError when the visitor changes the number, so the gate no longer says too many wrong codes", () => {
    const resumed = gateReducer(fresh("?codeError=invalid_code", withPending), { type: "state_changed", state: withPending });
    const changed = gateReducer(resumed, { type: "changed_number", pending: withPending.pending });
    expect(changed.step).toBe("gate");
    expect(changed.codeError).toBeNull();
    expect(gateStepAlert(changed, noPending)).toBeNull();
    // A stale refetch still carrying the dismissed pending record must not bounce them back to the code step.
    expect(gateReducer(changed, { type: "state_changed", state: withPending }).step).toBe("gate");
    const freshPending: GateDealsState = { pending: { displayPhone: "(210) •••-0456", expiresAt: "2026-10-19T00:20:00.000Z" } };
    expect(gateReducer(changed, { type: "state_changed", state: freshPending }).step).toBe("code");
  });

  it("clears codeError on any user-driven step change and on a new start", () => {
    const code = gateReducer(fresh("?codeError=invalid_code", withPending), { type: "state_changed", state: withPending });
    expect(gateReducer(code, { type: "go", step: "gate" }).codeError).toBeNull();
    expect(gateReducer(code, { type: "start_result", result: { ok: true, displayPhone: "(210) •••-0123" } }).codeError).toBeNull();
  });

  it("strips the one-time flags from the URL but keeps src and ig", () => {
    expect(stripTransientGateParams("https://example.test/deals?src=sl1&ig=pete&codeError=invalid_code&expired=1&error=1&blocked=1&gate=1&cookieBlocked=1&google=failed")).toBe("/deals?src=sl1&ig=pete");
    expect(stripTransientGateParams("/deals?src=vg1")).toBe("/deals?src=vg1");
    expect(stripTransientGateParams("/deals")).toBe("/deals");
  });
});

describe("expired and error redirects map to gate messages", () => {
  it("tells a reel buyer whose list expired to comment again or reach out, with no self-serve way back in", () => {
    const expired = fresh("?expired=1", noPending);
    expect(expired.step).toBe("expired");
    const html = render(expired, { pending: null, commentKeyword: "HOME", textLine: "(512) 542-1477" } as GateDealsState);
    expect(html).toContain("Your list has expired.");
    expect(html).toContain("Comment HOME on one of our videos again, or reach out to us so we can help you find your home.");
    expect(html).toContain('href="https://www.instagram.com/lifestyledesignrealtytexas/"');
    expect(html).toContain('href="tel:5125421477"');
    expect(html).toContain("Call (512) 542-1477");
    // A phone can text the line straight from the screen.
    expect(html).toContain('href="sms:5125421477"');
    expect(html).toContain("Text (512) 542-1477");
    expect(html).not.toContain("Get a new link now");
    expect(html).not.toContain('id="deals-phone"');
    expect(html).not.toContain("?body=");
    // The reducer still carries the explanation if a later step sends the visitor to the gate.
    const gate = gateReducer(expired, { type: "go", step: "gate" });
    expect(gate.step).toBe("gate");
    expect(gateStepAlert(gate, noPending)).toBe(GATE_COPY.linkExpired);
    // An explanation, not a refusal: rendered as a status, and gone once the visitor moves on.
    const rendered = render(gate, noPending);
    expect(statuses(rendered)).toEqual([GATE_COPY.linkExpired]);
    expect(alerts(rendered)).toEqual([]);
    expect(gateReducer(gate, { type: "go", step: "confirm-agent" }).message).toBeNull();
  });

  it("renders progress notes as a status and refusals as an alert on the code step", () => {
    const code = gateReducer(fresh(), { type: "start_result", result: { ok: true, displayPhone: "(210) •••-0123" } });
    const resent = gateReducer(code, { type: "resend_result", channel: "sms", result: { ok: true } });
    expect(statuses(render(resent, withPending))).toEqual([GATE_COPY.freshCode]);
    expect(alerts(render(resent, withPending))).toEqual([]);
    const limited = gateReducer(code, { type: "resend_result", channel: "sms", result: { ok: false, kind: "rate_limited", message: "We're getting a lot of traffic, so please try again in a bit. Or text HOME to (512) 542-1477." } });
    expect(limited.step).toBe("code");
    expect(alerts(render(limited, withPending))).toEqual(["We're getting a lot of traffic, so please try again in a bit. Or text HOME to (512) 542-1477."]);
  });

  it("maps ?error=1 to a gate message and ?blocked=1 to the blocked step", () => {
    const errored = fresh("?error=1", noPending);
    expect(errored.step).toBe("gate");
    expect(gateStepAlert(errored, undefined)).toBe(GATE_COPY.somethingWrong);
    expect(alerts(render(errored, undefined))).toEqual([GATE_COPY.somethingWrong]);
    expect(fresh("?gate=1&blocked=1", noPending).step).toBe("blocked");
    expect(fresh("?cookieBlocked=1", noPending).step).toBe("cookie-blocked");
  });

  it("uses no em dashes in any client-owned gate copy", () => {
    for (const copy of Object.values(GATE_COPY)) expect(copy).not.toMatch(/—/);
  });
});

describe("expired code session (/deals/verify -> ?codeError=expired)", () => {
  it("explains the expired code session on the gate as a status, at once and without the wrong-code copy", () => {
    const gate = fresh("?codeError=expired", undefined);
    expect(gate.step).toBe("gate");
    expect(gateStepAlert(gate, undefined)).toBe(GATE_COPY.codeSessionExpired);
    expect(gateStepAlert(gate, noPending)).toBe(GATE_COPY.codeSessionExpired);
    const html = render(gate, noPending);
    expect(statuses(html)).toEqual([GATE_COPY.codeSessionExpired]);
    expect(alerts(html)).toEqual([]);
    expect(html).not.toContain(GATE_COPY.tooManyWrongCodes);
    expect(html).not.toContain("This link expired.");
    // Moving on clears it like any other codeError.
    expect(gateStepAlert(gateReducer(gate, { type: "go", step: "confirm-agent" }), noPending)).toBeNull();
  });

  it("never reads a stale expired flag as a wrong code when a pending record does exist", () => {
    const resumed = gateReducer(fresh("?codeError=expired", undefined), { type: "state_changed", state: withPending });
    expect(resumed.step).toBe("code");
    expect(codeStepAlert(resumed)).toBeNull();
    expect(alerts(render(resumed, withPending))).toEqual([]);
  });
});

describe("attribution params are bounded before they reach the server", () => {
  it("cuts an oversized ?src and ?ig down to the sanitizer limits and strips the leading @", () => {
    const params = readGateParams(`?src=${"a".repeat(200)}&ig=@@${"b".repeat(100)}`);
    expect(params.src).toHaveLength(SOURCE_CODE_MAX);
    expect(params.src).toBe("a".repeat(40));
    expect(params.ig).toHaveLength(INSTAGRAM_HANDLE_MAX);
    expect(params.ig).toBe("b".repeat(30));
    expect(params.ig?.startsWith("@")).toBe(false);
  });

  it("keeps ordinary codes and handles as they are and drops what the server would reject", () => {
    expect(readGateParams("?src=sl1&ig=@pete.realtor_tx")).toMatchObject({ src: "sl1", ig: "pete.realtor_tx" });
    expect(readGateParams("?src=vg-1&ig=pete")).toMatchObject({ src: "vg-1", ig: "pete" });
    expect(readGateParams("?src=%3Cscript%3E&ig=%40%40")).toMatchObject({ src: "script", ig: undefined });
    expect(readGateParams("")).toMatchObject({ src: undefined, ig: undefined });
    expect(readGateParams("?ig=@so%20called%20handle").ig).toBe("socalledhandle");
  });

  it("refreshes deals.state after a sent code and after cannot_receive, not after a refusal", () => {
    expect(startLeavesPending({ ok: true, displayPhone: "(210) •••-0123" })).toBe(true);
    expect(startLeavesPending({ ok: false, kind: "cannot_receive", message: SERVER_CANNOT_RECEIVE })).toBe(true);
    expect(startLeavesPending({ ok: false, kind: "outside_us", message: SERVER_OUTSIDE_US })).toBe(false);
    expect(startLeavesPending({ ok: false, kind: "blocked", message: "blocked" })).toBe(false);
    expect(startLeavesPending({ ok: false, kind: "rate_limited", message: "later" })).toBe(false);
  });
});

describe("gate controls: consent before Continue, pressed pills, tap targets, voice heading", () => {
  // The rendered disabled attribute, not Tailwind's disabled: variants in the class list.
  const continueDisabled = (html: string) => {
    const index = html.indexOf(">Continue");
    expect(index).toBeGreaterThan(-1);
    return /\sdisabled=""/.test(html.slice(html.lastIndexOf("<button", index), index));
  };

  it("keeps Continue disabled until deals.state has resolved, so the consent line is on screen first", () => {
    const loading = render(fresh(), undefined);
    expect(continueDisabled(loading)).toBe(true);
    expect(loading).not.toContain("you agree that");
    const resolved = render(fresh(), { pending: null, consentText: "By tapping Continue, you agree that we may text you." } as GateDealsState);
    expect(continueDisabled(resolved)).toBe(false);
    expect(resolved).toContain("By tapping Continue, you agree that we may text you.");
    // Still disabled without a choice or a full number.
    expect(continueDisabled(render(fresh(), noPending, { choice: null }))).toBe(true);
    expect(continueDisabled(render(fresh(), noPending, { phone: "(210) 555" }))).toBe(true);
    // Oct 24 (Peter): name and email are asked for too.
    expect(continueDisabled(render(fresh(), noPending, { name: "" }))).toBe(true);
    expect(continueDisabled(render(fresh(), noPending, { email: "maria@" }))).toBe(true);
    expect(render(fresh(), noPending)).toMatch(/id="deals-name"[\s\S]*id="deals-email"[\s\S]*id="deals-phone"/);
  });

  it("marks the realtor pills with aria-pressed", () => {
    const buyer = render(fresh(), noPending, { choice: "buyer" });
    expect(buyer).toMatch(/<button[^>]*aria-pressed="true"[^>]*>No, just me<\/button>/);
    expect(buyer).toMatch(/<button[^>]*aria-pressed="false"[^>]*>I have an agent<\/button>/);
    expect(buyer).toMatch(/<button[^>]*aria-pressed="false"[^>]*>I&#x27;m a realtor<\/button>/);
    const none = render(fresh(), noPending, { choice: null });
    expect(none.match(/aria-pressed="false"/g)?.length).toBe(3);
  });

  it("asks a realtor to confirm, then shows the agent note and a link to the recruiting page (Oct 24: realtors go to recruiting)", () => {
    const confirm = decode(render(gateReducer(fresh(), { type: "go", step: "confirm-realtor" }), noPending));
    expect(confirm).toContain("Just to confirm: you're a licensed real estate agent?");
    expect(confirm).toContain("Yes, I'm an agent");
    const sent = gateReducer(fresh(), { type: "start_result", result: { ok: false, kind: "realtor", message: "Builder Deals are for home buyers.", redirect: "/join?from=builder-deals" } });
    expect(sent.step).toBe("realtor");
    const html = decode(render(sent, noPending));
    expect(html).toContain("Builder Deals are for buyers");
    expect(html).toMatch(/href="\/join\?from=builder-deals"/);
    expect(gateReducer(gateReducer(fresh(), { type: "go", step: "confirm-realtor" }), { type: "start_failed" }).step).toBe("gate");
  });

  it("gives the code-step recovery links and every close button a 44 px tap target", () => {
    const code = gateReducer(fresh(), { type: "start_result", result: { ok: true, displayPhone: "(210) •••-0123" } });
    const html = render(code, withPending);
    for (const label of ["Didn't get it? Resend", "Call me with the code instead", "Wrong number? Change it"]) {
      const encoded = label.replace("'", "&#x27;");
      const index = html.indexOf(encoded);
      expect(index, label).toBeGreaterThan(-1);
      const tag = html.slice(html.lastIndexOf("<button", index), index);
      expect(tag, label).toMatch(/class="[^"]*\bmin-h-11\b/);
    }
    const close = /<button[^>]*aria-label="Close gate"[^>]*>/.exec(html)?.[0] ?? "";
    expect(close).toMatch(/class="[^"]*\bh-11\b/);
    expect(close).toMatch(/class="[^"]*\bw-11\b/);
  });

  it("says a call is coming once the voice code is on its way, and uses you're on the confirm step", () => {
    const code = gateReducer(fresh(), { type: "start_result", result: { ok: true, displayPhone: "(210) •••-0123" } });
    const calling = gateReducer(code, { type: "resend_result", channel: "call", result: { ok: true } });
    const html = decode(render(calling, withPending));
    expect(html).toContain("Pick up, we're calling you.");
    expect(html).not.toContain("Check your messages.");
    expect(html).toContain("The call to (210) •••-0123 reads out a 6-digit code.");
    expect(statuses(render(calling, withPending))).toEqual([GATE_COPY.calling]);
    const sms = decode(render(gateReducer(calling, { type: "resend_result", channel: "sms", result: { ok: true } }), withPending));
    expect(sms).toContain("Check your messages.");
    expect(sms).not.toContain("Pick up, we're calling you.");
    const confirm = decode(render(gateReducer(fresh(), { type: "go", step: "confirm-agent" }), noPending));
    expect(confirm).toContain("you're already working with an agent");
    expect(confirm).not.toContain("you are already");
  });
});

describe("a buyer an admin turned off (Oct 25, Peter)", () => {
  const PAUSED = "Your Builder Deals access is paused right now. Text (512) 542-1477 and we'll help you get back in.";
  it("opens on the paused screen from the state, and goes there from a paused start, never to recruiting or the agent wording", () => {
    const opened = fresh("", { pending: null, paused: true });
    expect(opened.step).toBe("paused");
    const html = render(opened, { pending: null, paused: true, pausedMessage: PAUSED } as GateDealsState);
    expect(html).toContain("Your access is paused");
    expect(html).toContain(PAUSED.replace("'", "&#x27;"));
    expect(html).not.toMatch(/agent|recruit|Buyer access only/i);
    const started = gateReducer(fresh(), { type: "start_result", result: { ok: false, kind: "paused", message: PAUSED } });
    expect(started).toMatchObject({ step: "paused", message: PAUSED });
    expect(gateReducer(fresh(), { type: "state_changed", state: { pending: null, paused: true } }).step).toBe("paused");
  });
});
