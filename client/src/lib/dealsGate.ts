/**
 * Gate sheet state machine. Pure, so the step transitions and the copy the
 * visitor sees for every server outcome can be tested without a browser.
 *
 * Server copy (blocked, outside US, rate limited, cannot receive) is rendered
 * verbatim; this module only owns the wording for client-side situations.
 */
export type GateStep = "gate" | "confirm-agent" | "confirm-realtor" | "realtor" | "code" | "blocked" | "paused" | "expired" | "cookie-blocked";

export type GateParams = {
  src?: string;
  ig?: string;
  /** An LDR agent's client link token (?c=); it survives reloads like src and ig. */
  c?: string;
  expired: boolean;
  error: boolean;
  cookieBlocked: boolean;
  blocked: boolean;
  codeError: string | null;
  google: string | null;
  /** Why the site login did not open the team list (Oct 27): not on the team, no mobile on the profile, access turned off. */
  login: "not_team" | "no_phone" | "turned_off" | null;
};

/** Pending verification as deals.state reports it; the display phone is already masked by the server. */
export type GatePending = { displayPhone: string; expiresAt: string };
/** `paused`: an admin turned this buyer off (Oct 25, 2026); the sheet opens on the neutral paused screen. */
export type GateDealsState = { pending: GatePending | null; paused?: boolean } | undefined;

export type GateStartResult =
  | { ok: true; displayPhone: string }
  | { ok: false; kind: string; message: string; displayPhone?: string | null; redirect?: string };
export type GateResendResult = { ok: true } | { ok: false; kind: string; message: string };

/**
 * Whether deals.start left a pending verification on the server (a sent code, or
 * a number that cannot receive texts awaiting the voice call). The cached
 * deals.state must be refetched then, so a sheet closed on the code step resumes
 * there instead of asking for the phone again and burning a second code.
 */
export function startLeavesPending(result: GateStartResult): boolean {
  return result.ok || result.kind === "cannot_receive";
}

export type GateState = {
  step: GateStep;
  /** Copy shown as the current alert or status. Server messages land here untouched. */
  message: string | null;
  /** The ?codeError value from the verify redirect; cleared on any user-driven step change. */
  codeError: string | null;
  /** Twilio reported the number cannot receive texts: Call me is the next step. */
  cannotReceive: boolean;
  /** Masked phone returned by deals.start; falls back to deals.state's pending copy. */
  pendingDisplayPhone: string | null;
  /** A pending row the visitor dismissed with "Wrong number? Change it"; a stale refetch must not bounce them back. */
  dismissedPending: string | null;
  /** The visitor arrived from an expired link; the gate explains why it asks for the number again. */
  expiredLink: boolean;
};

export type GateAction =
  | { type: "state_changed"; state: GateDealsState }
  | { type: "go"; step: GateStep }
  | { type: "start_result"; result: GateStartResult }
  | { type: "start_failed" }
  | { type: "resend_result"; channel: "sms" | "call"; result: GateResendResult }
  | { type: "resend_failed" }
  | { type: "changed_number"; pending: GatePending | null | undefined }
  | { type: "status"; message: string };

export const GATE_COPY = {
  tooManyWrongCodes: "Too many wrong codes, start again",
  codeSessionExpired: "Your code session expired. Start again.",
  linkExpired: "This link expired, enter your number to get a new one",
  somethingWrong: "Something went wrong, try again",
  codeMismatch: "That code didn't match. Please try again.",
  startFailed: "We couldn't start verification. Please try again.",
  resendFailed: "We couldn't send a code right now. Please try again.",
  freshCode: "A fresh code is on its way.",
  calling: "We're calling you now. Enter the code you hear below.",
  googleFailed: "Google sign-in didn't work here. Enter your mobile number instead.",
  loginNotTeam: "That login isn't on the team list. Sign in with your Lifestyle e-mail, or get a code by text.",
  loginNoPhone: "Your team profile has no mobile number on file yet. Ask Peter to add it, then sign in again.",
  loginTurnedOff: "Your team access is turned off. Text the office to turn it back on.",
  linkCopied: "Link copied. Open it in Safari or Chrome.",
} as const;

/** Progress notes rather than errors: rendered as a status in the brand colour, not as an alert. */
const STATUS_COPY: ReadonlySet<string> = new Set<string>([GATE_COPY.freshCode, GATE_COPY.calling, GATE_COPY.linkCopied, GATE_COPY.linkExpired, GATE_COPY.codeSessionExpired]);
export function isGateStatusMessage(message: string | null): boolean {
  return message !== null && STATUS_COPY.has(message);
}

/** Query flags the server uses to hand the sheet a one-time outcome. Never src or ig. */
export const TRANSIENT_GATE_PARAMS = ["codeError", "expired", "error", "blocked", "gate", "cookieBlocked", "google", "team", "login"] as const;

/** Spec sanitizer limits: a reel code is at most 40 characters, a handle at most 30 after the leading @. */
export const SOURCE_CODE_MAX = 40;
export const INSTAGRAM_HANDLE_MAX = 30;

/**
 * Attribution params as the server's sanitizers will read them, bounded before
 * they are sent: an oversized ?src or ?ig would otherwise fail the server's
 * input validation on every start and lock the visitor out of the gate.
 */
export function boundSourceCode(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value.trim().replace(/[^A-Za-z0-9-]/g, "").slice(0, SOURCE_CODE_MAX) || undefined;
}

export function boundInstagramHandle(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value.trim().replace(/^@+/, "").replace(/[^A-Za-z0-9._]/g, "").slice(0, INSTAGRAM_HANDLE_MAX) || undefined;
}

/** The client link token exactly as the server validates it: 20 to 64 URL-safe characters, else nothing. */
export const CLIENT_LINK_TOKEN_MAX = 64;
export function boundClientLinkToken(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const token = value.trim();
  return /^[A-Za-z0-9_-]{20,64}$/.test(token) ? token : undefined;
}

const CLIENT_LINK_STORAGE_KEY = "ldr_deals_client_link";
type LinkStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;
function linkStore(storage: LinkStore | null | undefined): LinkStore | null {
  return storage === undefined ? (typeof window === "undefined" ? null : window.sessionStorage) : storage;
}

/**
 * The agent's client-link token for this tab: from the URL when present (and
 * kept for the rest of the tab), otherwise the one kept earlier, so a redirect
 * that dropped ?c= (a lapsed list, a reload in Instagram) still shows the
 * agent's gate. A reel link (?src= without ?c=) is a fresh start and forgets
 * the kept token. Storage can be unavailable; the URL alone then decides.
 */
export function rememberClientLinkToken(search: string, storage?: LinkStore | null): string | undefined {
  const params = new URLSearchParams(search);
  const fromUrl = boundClientLinkToken(params.get("c"));
  try {
    const store = linkStore(storage);
    if (fromUrl) { store?.setItem(CLIENT_LINK_STORAGE_KEY, fromUrl); return fromUrl; }
    if (params.get("src")) { store?.removeItem(CLIENT_LINK_STORAGE_KEY); return undefined; }
    return boundClientLinkToken(store?.getItem(CLIENT_LINK_STORAGE_KEY) ?? null);
  } catch { return fromUrl; }
}

/** Keep a token the server found for this browser (a lapsed agent-client session), for the rest of the tab. */
export function keepClientLinkToken(token: string, storage?: LinkStore | null) {
  try { linkStore(storage)?.setItem(CLIENT_LINK_STORAGE_KEY, token); } catch { /* storage unavailable */ }
}

/** A kept token whose link is dead: forget it so this tab can reach the regular gate again. */
export function forgetClientLinkToken(storage?: LinkStore | null) {
  try { linkStore(storage)?.removeItem(CLIENT_LINK_STORAGE_KEY); } catch { /* storage unavailable */ }
}

/** Whether the token in use came from this page's own URL (an agent's link the visitor just opened). */
export function clientLinkTokenInUrl(search: string): boolean {
  return Boolean(boundClientLinkToken(new URLSearchParams(search).get("c")));
}

export function readGateParams(search: string): GateParams {
  const params = new URLSearchParams(search);
  const codeError = params.get("codeError");
  return {
    src: boundSourceCode(params.get("src")),
    ig: boundInstagramHandle(params.get("ig")),
    c: boundClientLinkToken(params.get("c")),
    expired: params.get("expired") === "1",
    error: params.get("error") === "1",
    cookieBlocked: params.get("cookieBlocked") === "1",
    blocked: params.get("blocked") === "1",
    codeError: codeError && codeError.trim() ? codeError.trim().slice(0, 40) : null,
    google: params.get("google"),
    login: (["not_team", "no_phone", "turned_off"] as const).find((value) => value === params.get("login")) ?? null,
  };
}

/** The same URL without the one-time outcome flags; src, ig and c survive a reload. */
export function stripTransientGateParams(href: string): string {
  const url = new URL(href, "http://localhost");
  for (const key of TRANSIENT_GATE_PARAMS) url.searchParams.delete(key);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function initialGateState(params: GateParams, state: GateDealsState): GateState {
  const step: GateStep = state?.paused ? "paused" : params.cookieBlocked ? "cookie-blocked" : params.expired ? "expired" : params.blocked ? "blocked" : state?.pending ? "code" : "gate";
  return {
    step,
    message: params.error ? GATE_COPY.somethingWrong : params.google === "failed" ? GATE_COPY.googleFailed : params.login === "not_team" ? GATE_COPY.loginNotTeam : params.login === "no_phone" ? GATE_COPY.loginNoPhone : params.login === "turned_off" ? GATE_COPY.loginTurnedOff : null,
    codeError: params.codeError,
    cannotReceive: false,
    pendingDisplayPhone: state?.pending?.displayPhone ?? null,
    dismissedPending: null,
    expiredLink: params.expired,
  };
}

export function gateReducer(gate: GateState, action: GateAction): GateState {
  switch (action.type) {
    case "state_changed": {
      const pending = action.state?.pending;
      if (action.state?.paused && gate.step !== "paused") return { ...gate, step: "paused", codeError: null, cannotReceive: false };
      if (!pending || pending.expiresAt === gate.dismissedPending) return gate;
      if (gate.step !== "gate" && gate.step !== "code") return gate;
      // The server-side pending record wins over a reload: resume at the code
      // step without burning a second code. codeError survives so the wrong-code
      // explanation is still shown on the code step.
      return { ...gate, step: "code", pendingDisplayPhone: gate.pendingDisplayPhone ?? pending.displayPhone };
    }
    case "go": {
      const fromExpired = gate.step === "expired" && action.step === "gate";
      return { ...gate, step: action.step, codeError: null, cannotReceive: false, message: fromExpired && gate.expiredLink ? GATE_COPY.linkExpired : null };
    }
    case "start_result": {
      const { result } = action;
      if (result.ok) return { ...gate, step: "code", message: null, codeError: null, cannotReceive: false, pendingDisplayPhone: result.displayPhone, dismissedPending: null };
      if (result.kind === "cookie_blocked") return { ...gate, step: "cookie-blocked", message: result.message, codeError: null, cannotReceive: false };
      if (result.kind === "blocked") return { ...gate, step: "blocked", message: result.message, codeError: null, cannotReceive: false };
      if (result.kind === "paused") return { ...gate, step: "paused", message: result.message, codeError: null, cannotReceive: false };
      // A realtor is sent to the recruiting page (the sheet opens it); this step shows the note and a link meanwhile.
      if (result.kind === "realtor") return { ...gate, step: "realtor", message: result.message, codeError: null, cannotReceive: false };
      if (result.kind === "cannot_receive") {
        // The pending row is kept server-side, so the visitor lands on the code
        // step where "Call me" (the voice channel) is the obvious next step.
        return { ...gate, step: "code", message: result.message, codeError: null, cannotReceive: true, pendingDisplayPhone: result.displayPhone ?? gate.pendingDisplayPhone, dismissedPending: null };
      }
      return { ...gate, step: "gate", message: result.message, codeError: null, cannotReceive: false };
    }
    case "start_failed":
      return { ...gate, step: gate.step === "confirm-agent" || gate.step === "confirm-realtor" ? "gate" : gate.step, message: GATE_COPY.startFailed, codeError: null };
    case "resend_result": {
      const { result } = action;
      if (result.ok) return { ...gate, message: action.channel === "call" ? GATE_COPY.calling : GATE_COPY.freshCode, cannotReceive: false, codeError: null };
      if (result.kind === "expired") return { ...gate, step: "gate", message: result.message, codeError: null, cannotReceive: false, pendingDisplayPhone: null };
      return { ...gate, message: result.message, codeError: null, cannotReceive: result.kind === "cannot_receive" || gate.cannotReceive };
    }
    case "resend_failed":
      return { ...gate, message: GATE_COPY.resendFailed, codeError: null };
    case "changed_number":
      return { ...gate, step: "gate", message: null, codeError: null, cannotReceive: false, pendingDisplayPhone: null, dismissedPending: action.pending?.expiresAt ?? gate.dismissedPending };
    case "status":
      return { ...gate, message: action.message };
    default:
      return gate;
  }
}

/**
 * Alert for the phone step. A wrong-code redirect lands on the gate only after
 * deals.state has resolved without a pending record (the fifth wrong code), so
 * nothing flashes while the state query is still loading.
 */
export function gateStepAlert(gate: GateState, state: GateDealsState): string | null {
  if (gate.message) return gate.message;
  // /deals/verify found no live 10-minute code session: an explanation, shown at once
  // because the server has already said there is no pending record to resume.
  if (gate.codeError === "expired") return GATE_COPY.codeSessionExpired;
  if (gate.codeError && state !== undefined && !state.pending) return GATE_COPY.tooManyWrongCodes;
  return null;
}

/** Alert for the code step; the cannot-receive message is rendered by the step itself. */
export function codeStepAlert(gate: GateState): string | null {
  if (gate.cannotReceive) return null;
  if (gate.message) return gate.message;
  // A pending record exists after all, so an "expired" flag is stale rather than a wrong code.
  if (gate.codeError && gate.codeError !== "expired") return GATE_COPY.codeMismatch;
  return null;
}

/** Where the gate leaves a realtor's typed number for the recruiting form (this tab only; never in a URL). */
export const RECRUIT_PREFILL_KEY = "ldr_recruit_phone";

/**
 * Where a browser kept off Builder Deals (its own "I'm a realtor" answer or the screening) is sent: the recruiting
 * path the server named, same-origin only. Never from the agent sign-in (Oct 27, 2026: Peter's browser was flagged
 * the day before and every visit, the sign-in included, bounced to recruiting; signing in as the team clears it).
 */
export function agentRecruitRedirect(redirect: string | null | undefined, teamSignIn: boolean): string | null {
  if (teamSignIn || typeof redirect !== "string" || !redirect.startsWith("/") || redirect.startsWith("//")) return null;
  return redirect;
}
