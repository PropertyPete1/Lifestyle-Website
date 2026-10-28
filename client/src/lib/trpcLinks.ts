import { COOKIE_NAME } from "@shared/const";
import { REQUEST_TIMEOUT_MS, withTimeout } from "@shared/requestTimeout";
import { httpBatchLink, httpLink, splitLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../../server/routers";

/**
 * Oct 28, 2026 (Peter: "make sure everything looks efficient"): calls made together share one HTTP request, and that
 * request answers when its slowest call is done. The big lists go on their own, so the homes paint as soon as they
 * arrive instead of waiting for the agent's client list (or the gate state) that happened to be asked for alongside.
 */
export const UNBATCHED_PATHS = new Set(["deals.mine", "deals.publicCatalog", "deals.team.workspace"]);

/** The client's links: the big lists on their own request, everything else batched. */
export function trpcLinks(fetchImpl: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init)) {
  return [
    splitLink<AppRouter>({
      condition: (op) => UNBATCHED_PATHS.has(op.path),
      true: httpLink<AppRouter>(linkOptions(fetchImpl)),
      false: httpBatchLink<AppRouter>(linkOptions(fetchImpl)),
    }),
  ];
}

function linkOptions(fetchImpl: typeof globalThis.fetch) {
  return {
    url: "/api/trpc",
    transformer: superjson,
    headers() {
      // Preview auto-login fallback: when the browser blocks iframe cookies
      // (Safari ITP / private browsing / WebView), the runtime mirrors the
      // session into sessionStorage so we can forward it as a Bearer token.
      // The regular OAuth cookie flow keeps working and takes priority server-side.
      try {
        const raw = sessionStorage.getItem("manus-cookie");
        if (raw) {
          const prefix = `${COOKIE_NAME}=`;
          const pair = raw.split(";").find(s => s.trim().startsWith(prefix));
          const token = pair?.trim().slice(prefix.length);
          if (token) {
            return { Authorization: `Bearer ${token}` };
          }
        }
      } catch {
        // sessionStorage unavailable
      }
      return {};
    },
    fetch(input: RequestInfo | URL, init?: RequestInit) {
      return fetchImpl(input, {
        ...(init ?? {}),
        credentials: "include",
        /**
         * Hard timeout on every request. Without one, a hung request left a
         * lead form's submit button spinning forever with no error and no
         * retry path — the visitor simply assumed it worked. 20s is far
         * beyond a normal submit (sub-second) but short enough that a stuck
         * request surfaces as a real, actionable error instead of an endless
         * spinner.
         *
         * COMBINED, never chosen: httpBatchLink always supplies its own
         * signal, so `init?.signal ?? timeout` silently discarded the
         * deadline on every request. See shared/requestTimeout.ts.
         */
        signal: withTimeout(init?.signal, REQUEST_TIMEOUT_MS),
      });
    },
  };
}

