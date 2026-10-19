import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GATE_COPY, codeStepAlert, gateReducer, gateStepAlert, initialGateState, readGateParams, stripTransientGateParams, type GateDealsState, type GateState } from "../client/src/lib/dealsGate";
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
    gate, state: state as GateSheetViewProps["state"], phone: "(210) 555-0123", code: "", choice: "buyer",
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
  it("shows the expired page first and carries the explanation onto the gate when a new link is requested", () => {
    const expired = fresh("?expired=1", noPending);
    expect(expired.step).toBe("expired");
    const html = render(expired, { pending: null, commentKeyword: "HOME", textLine: "(512) 542-1477" } as GateDealsState);
    expect(html).toContain("This link expired.");
    expect(html).toContain("Get a new link now");
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
