/**
 * REQUEST TIMEOUT — combining a caller's abort signal with a hard deadline.
 *
 * Why this exists: the lead-form submit path sets a 20s ceiling so a hung
 * request surfaces as a real error instead of a spinner that never stops. The
 * obvious way to write that is
 *
 *     signal: init?.signal ?? AbortSignal.timeout(20_000)
 *
 * and it is silently wrong. tRPC's httpBatchLink ALWAYS passes a signal into
 * the custom fetch (it races the caller's signal against its own cancellation
 * controller), so `init.signal` is never nullish, `??` always takes tRPC's
 * signal, and the timeout is constructed and thrown away on every request. The
 * ceiling never fires: a hung submit spins forever, the visitor sees no error
 * banner, no retry, and no phone fallback — and assumes the lead was sent.
 *
 * The fix is to combine rather than choose. Both signals must be able to abort
 * the request: the caller's (so React Query can still cancel) and the deadline's.
 */

/** Milliseconds before a request is considered hung. */
export const REQUEST_TIMEOUT_MS = 20_000;

/**
 * A signal that aborts when EITHER `signal` aborts or `ms` elapses.
 *
 * Uses `AbortSignal.any` where available and falls back to wiring an
 * AbortController by hand, because `AbortSignal.any` only landed in Safari
 * 17.4 — on an older iPhone the optimistic call would throw a TypeError inside
 * fetch and break every request on the site, which is a far worse failure than
 * the one being fixed.
 */
export function withTimeout(
  signal: AbortSignal | null | undefined,
  ms: number = REQUEST_TIMEOUT_MS
): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  // Already aborted upstream — nothing to combine.
  if (signal.aborted) return signal;

  const anyOf = (AbortSignal as unknown as {
    any?: (signals: AbortSignal[]) => AbortSignal;
  }).any;
  if (typeof anyOf === "function") {
    return anyOf.call(AbortSignal, [signal, timeout]);
  }

  const controller = new AbortController();
  const abort = (source: AbortSignal) => () => {
    if (!controller.signal.aborted) controller.abort(source.reason);
  };
  signal.addEventListener("abort", abort(signal), { once: true });
  timeout.addEventListener("abort", abort(timeout), { once: true });
  return controller.signal;
}
