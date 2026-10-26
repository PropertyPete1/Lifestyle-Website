import { useEffect, useReducer, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Copy, PhoneCall, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { GATE_COPY, RECRUIT_PREFILL_KEY, codeStepAlert, gateReducer, gateStepAlert, initialGateState, isGateStatusMessage, readGateParams, startLeavesPending, stripTransientGateParams, type GateParams, type GatePending, type GateState, type GateStep } from "@/lib/dealsGate";
import { ExpiredHelp, InstagramHelp, formatPhoneInput } from "./shared";

/** deals.state as the sheet needs it; undefined while the query is still loading. */
export type GateSheetState = {
  pending: GatePending | null;
  commentKeyword?: string | null;
  textLine?: string | null;
  blockedMessage?: string | null;
  /** An admin turned this buyer off: the sheet opens on "access is paused". */
  paused?: boolean;
  pausedMessage?: string | null;
  consentText?: string | null;
  googleEnabled?: boolean;
  /** The visitor opened an LDR agent's client link: the agent question is skipped and the sheet names the agent. */
  clientLink?: { state: "live"; agentName: string; clientFirstName: string } | { state: "dead"; agentName: string | null } | null;
} | undefined;

/** Continue needs a name (2+ characters) and an email that looks like one. */
export function gateContactReady(name: string, email: string): boolean {
  return name.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

export const GATE_CHOICES: ReadonlyArray<{ value: GateChoice; label: string }> = [
  { value: "buyer", label: "No, just me" },
  { value: "has_agent", label: "I have an agent" },
  { value: "realtor", label: "I'm a realtor" },
];
export const GATE_REALTOR_COPY = {
  confirmNote: "Builder Deals are for home buyers. Agents on our team get these deals for their clients, so we'll take you to our agent page.",
  heading: "Builder Deals are for buyers",
  body: "Agents on our team get these deals for their clients. Taking you to our agent page.",
  button: "See our agent page",
  path: "/join?from=builder-deals",
} as const;

/** Oct 25, 2026 (Peter): a buyer an admin turned off is told access is paused, never why. */
export const GATE_PAUSED_COPY = {
  heading: "Your access is paused",
  body: "Your Builder Deals access is paused right now. Reach out to us and we'll help you get back in.",
} as const;

/** Oct 24, 2026 (Peter): a realtor answers for themselves and is sent to recruiting; a buyer with an agent is told the page is for buyers. */
export type GateChoice = "buyer" | "has_agent" | "realtor";

export type GateSheetViewProps = {
  gate: GateState;
  state: GateSheetState;
  phone: string;
  /** Oct 24, 2026 (Peter): the gate asks for name and email too. */
  name?: string;
  email?: string;
  code: string;
  choice: GateChoice | null;
  starting?: boolean;
  resending?: boolean;
  onPhone: (value: string) => void;
  onName?: (value: string) => void;
  onEmail?: (value: string) => void;
  onCode: (value: string) => void;
  onChoice: (value: GateChoice) => void;
  onFocusPhone?: () => void;
  onContinue: () => void;
  onConfirmAgent: () => void;
  /** "I'm a realtor", confirmed: the server keeps them off Builder Deals and the sheet opens the recruiting page. */
  onConfirmRealtor?: () => void;
  onGo: (step: GateStep) => void;
  onResend: (channel: "sms" | "call") => void;
  onChangeNumber: () => void;
  onCopyLink: () => void;
  onClose: () => void;
  /** An agent's client-link token: posted with the code so every redirect keeps the agent's gate. */
  clientToken?: string;
  /** Oct 26, 2026 (Peter: "there is no login page"): /deals/team opens the sheet as the agent sign-in, no buyer question. */
  teamSignIn?: boolean;
};

/**
 * The sheet itself, free of data hooks so every step can be rendered and
 * asserted without a browser. Server copy is rendered verbatim.
 */
export const GATE_TEAM_COPY = {
  eyebrow: "Lifestyle Design Realty agents",
  heading: "Agent sign-in.",
  body: "Enter the mobile number on your team profile. We text you a code, and the full list opens with every address, photo and incentive, plus your client tools.",
  hint: "Not on the team yet?",
  joinLabel: "See our agent page",
} as const;

export function GateSheetView({ gate, state, phone, name = "", email = "", onName, onEmail, code, choice, starting, resending, onPhone, onCode, onChoice, onFocusPhone, onContinue, onConfirmAgent, onConfirmRealtor, onGo, onResend, onChangeNumber, onCopyLink, onClose, clientToken, teamSignIn = false }: GateSheetViewProps) {
  const { step } = gate;
  const shared = state?.clientLink?.state === "live" ? state.clientLink : null;
  const deadLink = state?.clientLink?.state === "dead" ? state.clientLink : null;
  const displayPhone = gate.pendingDisplayPhone ?? state?.pending?.displayPhone ?? formatPhoneInput(phone);
  const gateAlert = step === "gate" ? gateStepAlert(gate, state) : null;
  const codeAlert = step === "code" ? codeStepAlert(gate) : null;
  // A voice code is on its way: the heading says so instead of pointing at messages.
  const calling = gate.message === GATE_COPY.calling;
  // Server refusals and wrong codes are alerts; progress notes read as a status in the brand colour.
  const notice = (message: string) => isGateStatusMessage(message)
    ? <p role="status" className="mt-4 text-sm text-gold">{message}</p>
    : <p role="alert" className="mt-4 text-sm text-destructive">{message}</p>;
  // Recovery links are small text but keep the 44 px tap target the spec asks for.
  const recoveryLink = "inline-flex min-h-11 items-center underline underline-offset-4";
  return <AnimatePresence><motion.div className="fixed inset-0 z-[90] flex items-end bg-black/70 backdrop-blur-sm sm:items-center sm:justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.section id="unlock" role="dialog" aria-modal="true" aria-labelledby="deals-gate-title" className="relative w-full min-w-0 min-h-[min(620px,92dvh)] max-h-[92dvh] overflow-x-hidden overflow-y-auto border-t border-gold/40 bg-card px-5 pb-7 pt-6 shadow-2xl sm:max-w-lg sm:border sm:px-8" initial={{ y: 36 }} animate={{ y: 0 }} exit={{ y: 36 }} transition={{ duration: 0.22 }}>
    <button type="button" aria-label="Close gate" onClick={onClose} className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-gold"><X className="h-4 w-4" /></button>
    {step === "cookie-blocked" && <><p className="eyebrow text-gold">Builder Deals</p><h2 id="deals-gate-title" className="mt-2 text-3xl leading-tight">Your browser is blocking cookies. Open this link in Safari or Chrome</h2><p className="mt-4 text-sm text-muted-foreground">Your personal list needs a private browser cookie to protect access.</p><Button onClick={onCopyLink} className="mt-6 w-full bg-gold py-6 text-primary-foreground"><Copy className="mr-2 h-4 w-4" />Copy link</Button>{gate.message && notice(gate.message)}</>}
    {step === "expired" && !deadLink && (shared
      ? <><p className="eyebrow text-gold" data-deals-shared-by="true">Shared by {shared.agentName}</p><h2 id="deals-gate-title" className="mt-2 text-4xl leading-none">Your list access ended.</h2><p className="mt-3 text-sm text-muted-foreground">Verify your number again to reopen the list {shared.agentName} shared with you. Your saved homes are still there.</p><Button onClick={() => onGo("gate")} className="mt-6 w-full bg-gold py-6 text-primary-foreground">Reopen my list <ArrowRight className="ml-2 h-4 w-4" /></Button></>
      : <><p className="eyebrow text-gold">Builder Deals</p><h2 id="deals-gate-title" className="mt-2 text-4xl leading-none">Your list has expired.</h2><ExpiredHelp state={state} /></>)}
    {step === "blocked" && <><p className="eyebrow text-gold">Builder Deals</p><h2 id="deals-gate-title" className="mt-2 text-3xl leading-tight">{state?.clientLink ? "We can't open this list" : "Buyer access only"}</h2><p role="alert" className="mt-4 text-sm leading-relaxed text-muted-foreground">{gate.message || state?.blockedMessage || "This page is for buyers who are not working with an agent yet."}</p><InstagramHelp state={state} /></>}
    {step === "paused" && <><p className="eyebrow text-gold">Builder Deals</p><h2 id="deals-gate-title" className="mt-2 text-3xl leading-tight">{GATE_PAUSED_COPY.heading}</h2><p role="status" data-deals-paused="true" className="mt-4 text-sm leading-relaxed text-muted-foreground">{gate.message || state?.pausedMessage || GATE_PAUSED_COPY.body}</p></>}
    {step === "confirm-agent" && <><p className="eyebrow text-gold">One quick confirmation</p><h2 id="deals-gate-title" className="mt-2 text-3xl leading-tight">Just to confirm: you're already working with an agent?</h2><div className="mt-6 grid gap-3"><Button onClick={onConfirmAgent} disabled={starting} className="bg-gold py-6 text-primary-foreground">Yes, that's right</Button><Button variant="outline" onClick={() => onGo("gate")} className="py-6">No, go back</Button></div></>}
    {step === "confirm-realtor" && <><p className="eyebrow text-gold">One quick confirmation</p><h2 id="deals-gate-title" className="mt-2 text-3xl leading-tight">Just to confirm: you're a licensed real estate agent?</h2><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{GATE_REALTOR_COPY.confirmNote}</p><div className="mt-6 grid gap-3"><Button onClick={onConfirmRealtor} disabled={starting} className="bg-gold py-6 text-primary-foreground">Yes, I'm an agent</Button><Button variant="outline" onClick={() => onGo("gate")} className="py-6">No, go back</Button></div></>}
    {step === "realtor" && <><p className="eyebrow text-gold">For agents</p><h2 id="deals-gate-title" className="mt-2 text-3xl leading-tight">{GATE_REALTOR_COPY.heading}</h2><p role="status" className="mt-3 text-sm leading-relaxed text-muted-foreground">{gate.message ?? GATE_REALTOR_COPY.body}</p><a href={GATE_REALTOR_COPY.path} data-deals-recruit-link="true" className="mt-6 inline-flex min-h-12 w-full items-center justify-center bg-gold px-5 text-sm font-medium uppercase tracking-[0.14em] text-primary-foreground">{GATE_REALTOR_COPY.button}</a></>}
    {step === "code" && <><p className="eyebrow text-gold">One more step</p>
      {gate.cannotReceive
        ? <><h2 id="deals-gate-title" className="mt-2 text-3xl">Let's call you instead.</h2><p role="alert" data-deals-cannot-receive="true" className="mt-3 text-sm leading-relaxed text-foreground">{gate.message}</p><Button type="button" onClick={() => onResend("call")} disabled={resending} className="mt-5 w-full bg-gold py-6 text-primary-foreground"><PhoneCall className="mr-2 h-4 w-4" />{resending ? "Calling…" : "Call me with the code instead"}</Button><p className="mt-3 text-xs text-muted-foreground">We call {displayPhone} and read the 6-digit code to you. Enter it below.</p></>
        : calling
          ? <><h2 id="deals-gate-title" className="mt-2 text-3xl">Pick up, we're calling you.</h2><p className="mt-3 text-sm text-muted-foreground">The call to {displayPhone} reads out a 6-digit code. Enter it below to unlock your personal list.</p></>
          : <><h2 id="deals-gate-title" className="mt-2 text-3xl">Check your messages.</h2><p className="mt-3 text-sm text-muted-foreground">We sent a code to {displayPhone}. Enter it below to unlock your personal list.</p></>}
      <form action="/deals/verify" method="post">{clientToken && <input type="hidden" name="c" value={clientToken} />}<Label htmlFor="deals-code" className="mt-6 block text-xs uppercase tracking-widest">6-digit code</Label><Input id="deals-code" name="code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]*" maxLength={6} value={code} onChange={(event) => onCode(event.target.value.replace(/\D/g, "").slice(0, 6))} className="mt-2 h-14 text-center text-2xl tracking-[0.45em]" /><Button type="submit" disabled={code.length !== 6} className="mt-4 w-full bg-gold py-6 text-primary-foreground">Unlock my list</Button></form>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 text-xs"><button type="button" onClick={() => onResend("sms")} disabled={resending} className={`${recoveryLink} text-gold`}>Didn't get it? Resend</button>{!gate.cannotReceive && <button type="button" onClick={() => onResend("call")} disabled={resending} className={`${recoveryLink} text-gold`}>Call me with the code instead</button>}</div>
      <button type="button" onClick={onChangeNumber} className={`${recoveryLink} mt-1 text-xs text-muted-foreground`}>Wrong number? Change it</button>
      {codeAlert && notice(codeAlert)}</>}
    {(step === "gate" || step === "expired") && deadLink && <><p className="eyebrow text-gold">Builder Deals</p><h2 id="deals-gate-title" className="mt-2 text-3xl leading-tight">This link has expired.</h2><p role="alert" data-deals-dead-link="true" className="mt-4 text-sm leading-relaxed text-muted-foreground">It was turned off or is no longer active. Ask {deadLink.agentName ?? "your agent"} to send you a new one.</p><InstagramHelp state={state} /></>}
    {step === "gate" && !deadLink && (() => {
      // An agent's client is working with an agent by definition: no question, Continue needs only the phone.
      // The agent already knows their own client: name and email are optional there, and required for everyone else.
      // The team sign-in needs only the phone: the team list already knows the agent's name and email.
      const ready = shared || teamSignIn ? true : Boolean(choice) && gateContactReady(name, email);
      return <>{shared
        ? <><p className="eyebrow text-gold" data-deals-shared-by="true">Shared by {shared.agentName}</p><h2 id="deals-gate-title" className="mt-2 text-4xl leading-none">{shared.clientFirstName ? `${shared.clientFirstName}, your list is ready.` : "Your list is ready."}</h2><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{shared.agentName} shared this week's new-build deals with you. Verify your mobile number once and the full list opens, with every address, photo and current incentive.</p></>
        : teamSignIn
          ? <><p className="eyebrow text-gold" data-deals-team-signin="true">{GATE_TEAM_COPY.eyebrow}</p><h2 id="deals-gate-title" className="mt-2 text-4xl leading-none">{GATE_TEAM_COPY.heading}</h2><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{GATE_TEAM_COPY.body}</p></>
          : <><p className="eyebrow text-gold">Tours</p><h2 id="deals-gate-title" className="mt-2 text-4xl leading-none">Schedule a tour.</h2><p className="mt-3 text-sm leading-relaxed text-muted-foreground" data-deals-gate-intro="true">Add your name, email and number, and one of our agents will reach out to set up your tour and answer your questions.</p></>}
      {state?.googleEnabled && !shared && !teamSignIn && <Button variant="outline" onClick={() => window.location.assign("/deals/auth/google")} className="mt-5 w-full py-6">Continue with Google</Button>}{!teamSignIn && <div className="mt-6 grid gap-4 sm:grid-cols-2"><div><Label htmlFor="deals-name" className="block text-xs uppercase tracking-widest">Name</Label><Input id="deals-name" autoComplete="name" placeholder="First and last name" value={name} onChange={(event) => onName?.(event.target.value.slice(0, 190))} className="mt-2 h-14 text-lg" /></div><div><Label htmlFor="deals-email" className="block text-xs uppercase tracking-widest">Email</Label><Input id="deals-email" type="email" autoComplete="email" inputMode="email" placeholder="you@example.com" value={email} onChange={(event) => onEmail?.(event.target.value.slice(0, 320))} className="mt-2 h-14 text-lg" /></div></div>}<Label htmlFor="deals-phone" className={`${teamSignIn ? "mt-6" : "mt-4"} block text-xs uppercase tracking-widest`}>Mobile phone</Label><Input id="deals-phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="(210) 555-0123" value={phone} onChange={(event) => onPhone(formatPhoneInput(event.target.value))} onFocus={onFocusPhone} className="mt-2 h-14 text-lg" />
      {teamSignIn && <p className="mt-3 text-xs text-muted-foreground">{GATE_TEAM_COPY.hint} <a href={GATE_REALTOR_COPY.path} className="text-gold underline-offset-4 hover:underline">{GATE_TEAM_COPY.joinLabel}</a></p>}
      {!shared && !teamSignIn && <><p id="deals-agent-question" className="mt-5 text-xs uppercase tracking-widest text-muted-foreground">Are you a realtor, or working with one?</p><div role="group" aria-labelledby="deals-agent-question" className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">{GATE_CHOICES.map((option) => <button key={option.value} type="button" aria-pressed={choice === option.value} data-deals-choice={option.value} onClick={() => onChoice(option.value)} className={`min-h-14 border px-2 text-sm leading-tight transition-colors ${choice === option.value ? "border-gold bg-gold/10 text-gold" : "border-border text-foreground"}`}>{option.label}</button>)}</div><p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Lifestyle Design Realty agents: enter your own mobile number to open your agent tools.</p></>}
      {/* Continue waits for deals.state so the consent line below is on screen before anyone can agree to it. */}<Button disabled={!ready || phone.replace(/\D/g, "").length < 10 || starting || state === undefined} onClick={onContinue} className="mt-5 w-full bg-gold py-6 text-primary-foreground">{starting ? "Sending…" : "Continue"} <ArrowRight className="ml-2 h-4 w-4" /></Button>{gateAlert && notice(gateAlert)}<p className="mt-5 text-xs leading-relaxed text-foreground">{state?.consentText}</p></>;
    })()}
  </motion.section></motion.div></AnimatePresence>;
}

/** Data wiring for the sheet: deals.state, the gate mutations and the one-time URL flags. */
export function GateSheet({ state, onClose, clientToken, lapsed = false, teamSignIn = false }: { state: GateSheetState; onClose: () => void; clientToken?: string; lapsed?: boolean; teamSignIn?: boolean }) {
  // The landing page passes the token it kept (URL or this tab's storage), so "Change number" and a wrong code keep it.
  // A reel buyer whose list lapsed, back from a bookmark rather than a fresh DM link, starts on the expired screen.
  const [params] = useState<GateParams>(() => { const read = readGateParams(window.location.search); return { ...read, c: read.c ?? clientToken, expired: read.expired || lapsed }; });
  const [gate, dispatch] = useReducer(gateReducer, undefined, () => initialGateState(params, state));
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [choice, setChoice] = useState<GateChoice | null>(null);
  const [code, setCode] = useState("");
  const focusSent = useRef(false);
  const utils = trpc.useUtils();
  const focused = trpc.deals.gateFocused.useMutation();
  const start = trpc.deals.start.useMutation({
    onSuccess: (result) => {
      dispatch({ type: "start_result", result });
      // A realtor goes to the recruiting page; the number they typed rides along in this tab only, for the form.
      if (!result.ok && result.kind === "realtor") {
        try { window.sessionStorage.setItem(RECRUIT_PREFILL_KEY, JSON.stringify({ phone, name, email })); } catch { /* storage blocked: the form starts empty */ }
        const target = "redirect" in result && typeof result.redirect === "string" && result.redirect.startsWith("/") ? result.redirect : GATE_REALTOR_COPY.path;
        window.setTimeout(() => window.location.assign(target), 1200);
      }
      // A sent code and cannot_receive both leave a pending row server-side; refetch so
      // the masked number and the resume-at-code behaviour come from the server record,
      // and a sheet closed on the code step reopens there instead of burning a new code.
      if (startLeavesPending(result)) void utils.deals.state.invalidate();
    },
    onError: () => dispatch({ type: "start_failed" }),
  });
  const resend = trpc.deals.resend.useMutation({
    onSuccess: (result, variables) => dispatch({ type: "resend_result", channel: variables.channel ?? "sms", result }),
    onError: () => dispatch({ type: "resend_failed" }),
  });
  const change = trpc.deals.changeNumber.useMutation({
    onSuccess: () => { dispatch({ type: "changed_number", pending: state?.pending }); setCode(""); void utils.deals.state.invalidate(); },
  });
  // One-time outcome flags must not survive Instagram's reload loop: a stale
  // ?codeError or ?expired would otherwise re-announce itself on every reload.
  useEffect(() => {
    const stripped = stripTransientGateParams(window.location.href);
    if (stripped !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", stripped);
  }, []);
  const pendingKey = state?.pending ? `${state.pending.expiresAt}|${state.pending.displayPhone}` : state === undefined ? "loading" : "none";
  useEffect(() => { dispatch({ type: "state_changed", state }); }, [pendingKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const copyLink = async () => {
    const text = window.location.href;
    try { await navigator.clipboard.writeText(text); dispatch({ type: "status", message: GATE_COPY.linkCopied }); }
    catch { window.prompt("Copy this link:", text); }
  };
  const continueGate = () => {
    // A client link answers the agent question for the visitor; the token rides along so the server attributes them.
    if (state?.clientLink?.state === "live") { start.mutate({ phone, name, email, choice: "buyer", src: params.src, ig: params.ig, c: params.c }); return; }
    // The agent sign-in posts as a buyer: a team number is the team either way, and a stranger's number just gets the buyer screening (never a realtor block for landing here).
    if (teamSignIn) { start.mutate({ phone, name, email, choice: "buyer", src: params.src, ig: params.ig, c: params.c }); return; }
    if (choice === "has_agent") { dispatch({ type: "go", step: "confirm-agent" }); return; }
    if (choice === "realtor") { dispatch({ type: "go", step: "confirm-realtor" }); return; }
    if (choice) start.mutate({ phone, name, email, choice, src: params.src, ig: params.ig, c: params.c });
  };
  const focusPhone = () => {
    if (focusSent.current) return;
    focusSent.current = true;
    focused.mutate({ src: params.src, c: params.c });
  };
  return <GateSheetView gate={gate} state={state} phone={phone} name={name} email={email} onName={setName} onEmail={setEmail} code={code} choice={choice} starting={start.isPending} resending={resend.isPending}
    onPhone={setPhone} onCode={setCode} onChoice={setChoice} onFocusPhone={focusPhone} onContinue={continueGate}
    onConfirmAgent={() => start.mutate({ phone, name, email, choice: "has_agent", src: params.src, ig: params.ig, c: params.c })}
    onConfirmRealtor={() => start.mutate({ phone, name, email, choice: "realtor", src: params.src, ig: params.ig, c: params.c })}
    onGo={(step) => { dispatch({ type: "go", step }); if (step === "gate") setCode(""); }}
    onResend={(channel) => resend.mutate({ channel })} onChangeNumber={() => change.mutate()} onCopyLink={() => { void copyLink(); }} onClose={onClose} clientToken={params.c} teamSignIn={teamSignIn} />;
}
