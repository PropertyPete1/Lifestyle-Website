import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MINE_COPY } from "../client/src/lib/dealsMine";

/**
 * Data wiring of the deals pages with tRPC mocked at the module boundary: what
 * the /deals/mine page does with each mine outcome, and which cache refreshes
 * the gate sheet triggers after deals.start. Hooks run once in a static render,
 * so the mutation options the components register are captured and driven
 * directly, the way react-query would invoke them.
 */
const mocks = vi.hoisted(() => {
  const mutation = (captured: { options: Record<string, unknown> | null }) => (options: Record<string, unknown>) => {
    captured.options = options;
    return { mutate: vi.fn(), isPending: false, isError: false, isSuccess: false, error: null };
  };
  const start = { options: null as Record<string, unknown> | null };
  const updateProfile = { options: null as Record<string, unknown> | null };
  return {
    start,
    updateProfile,
    mine: vi.fn(),
    state: vi.fn(() => ({ data: undefined, isLoading: true })),
    publicCatalog: vi.fn(() => ({ data: undefined, isLoading: true })),
    invalidateState: vi.fn(),
    updateProfileResult: { mutate: vi.fn(), isPending: false, isError: false, isSuccess: false, error: null as null | { message: string; data?: { code?: string } } },
    useMutation: mutation,
  };
});

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ deals: { state: { invalidate: mocks.invalidateState } } }),
    deals: {
      mine: { useQuery: (...args: unknown[]) => mocks.mine(...args) },
      state: { useQuery: () => mocks.state() },
      publicCatalog: { useQuery: () => mocks.publicCatalog() },
      featured: { useQuery: () => ({ data: undefined, isLoading: true }) },
      comingSoon: { useQuery: () => ({ data: undefined, isLoading: true }) },
      firstDibs: { useMutation: () => ({ mutateAsync: vi.fn(async () => ({ ok: true })), isPending: false }) },
      updateProfile: { useMutation: (options: Record<string, unknown>) => { mocks.updateProfile.options = options; return mocks.updateProfileResult; } },
      requestHome: { useMutation: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }) },
      saveHome: { useMutation: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }) },
      viewedCommunity: { useMutation: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }) },
      attachClientLink: { useMutation: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }) },
      team: {
        workspace: { useQuery: () => ({ data: undefined, isLoading: true, isError: false, error: null }) },
        createClientLink: { useMutation: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null, data: undefined }) },
        revokeClientLink: { useMutation: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }) },
      },
      start: { useMutation: mocks.useMutation(mocks.start) },
      resend: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      changeNumber: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      gateFocused: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

// The server-side vitest config compiles client JSX with the classic runtime.
(globalThis as { React?: typeof React }).React = React;
const { default: Deals } = await import("../client/src/pages/Deals");
const { GateSheet } = await import("../client/src/components/deals/GateSheet");
const { createElement } = React;

// The gate sheet reads the URL once when it mounts; a static render needs a location to read.
(globalThis as { window?: unknown }).window = { location: { search: "", pathname: "/deals/mine", hash: "", href: "http://localhost/deals/mine" } };

const NOW = Date.now();
const lead = { display: "@demo_buyer", expiresAt: new Date(NOW + 3600_000).toISOString(), name: null, timeline: null, teamPreview: false };
const communities = [{ label: "Southeast demo area | New phase", area: "Southeast demo area", reelUrl: null, areaMap: null, driveTimes: [], updatedAt: "2026-10-17T12:00:00.000Z", incentive: null, homes: [] }];
const refetch = vi.fn();
const mineResult = (overrides: Record<string, unknown>) => ({ data: undefined, error: null, isLoading: false, isError: false, isFetching: false, refetch, ...overrides });

const renderMine = () => renderToStaticMarkup(createElement(Router, { ssrPath: "/deals/mine" }, createElement(Deals)));
const decode = (value: string) => value.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.start.options = null;
  mocks.updateProfile.options = null;
  mocks.updateProfileResult.isSuccess = false;
  mocks.updateProfileResult.isError = false;
  mocks.updateProfileResult.error = null;
});

describe("/deals/mine: only a dead session falls back to the landing page", () => {
  it("renders an inline retry panel for a server error and never mounts the landing page that would bounce back to /deals/mine", () => {
    mocks.mine.mockReturnValue(mineResult({ isError: true, error: { message: "assertNoPrivateResidue", data: { code: "INTERNAL_SERVER_ERROR" } } }));
    const html = decode(renderMine());
    expect(html).toContain(MINE_COPY.loadFailed);
    expect(html).toContain(MINE_COPY.loadFailedHint);
    expect(html).toMatch(new RegExp(`<button[^>]*>(?:(?!</button>).)*${MINE_COPY.retry}</button>`));
    expect(html).toContain('data-deals-retry="true"');
    expect(html).not.toContain("Schedule a tour <");
    expect(html).not.toContain("Schedule a tour.");
    expect(mocks.state).not.toHaveBeenCalled();
    expect(mocks.publicCatalog).not.toHaveBeenCalled();
    // The failure message itself is not shown to the visitor.
    expect(html).not.toContain("assertNoPrivateResidue");
  });

  it("shows the retry panel for a request timeout too, and marks the button busy while the refetch runs", () => {
    mocks.mine.mockReturnValue(mineResult({ isError: true, error: { message: "Request timed out" }, isFetching: true }));
    const html = decode(renderMine());
    expect(html).toContain(MINE_COPY.loadFailed);
    expect(html).toContain(MINE_COPY.retrying);
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>(?:(?!<\/button>).)*Trying again/);
    expect(mocks.state).not.toHaveBeenCalled();
  });

  it("falls back to the landing page and its gate only for UNAUTHORIZED", () => {
    mocks.mine.mockReturnValue(mineResult({ isError: true, error: { message: "UNAUTHORIZED", data: { code: "UNAUTHORIZED" } } }));
    mocks.state.mockReturnValue({ data: { session: null, pending: null, consentText: "consent", googleEnabled: false, commentKeyword: "HOME", textLine: "(512) 542-1477", blockedMessage: null }, isLoading: false });
    mocks.publicCatalog.mockReturnValue({ data: [], isLoading: false });
    const html = decode(renderMine());
    // Oct 30, 2026 (design F): the public page, with the gate open over it (each home card carries its own tour button).
    expect(html).toContain('data-deals-public-page="true"');
    expect(html).toContain("New construction deals");
    expect(html).toContain("Schedule a tour.");
    expect(html).not.toContain(MINE_COPY.loadFailed);
    expect(mocks.state).toHaveBeenCalled();
  });

  it("renders the personal list when mine succeeds, with no retry panel", () => {
    mocks.mine.mockReturnValue(mineResult({ data: { lead, communitiesJson: JSON.stringify(communities) } }));
    const html = decode(renderMine());
    expect(html).toContain("Prepared for @demo_buyer");
    expect(html).toContain('data-deals-gated="true"');
    expect(html).not.toContain(MINE_COPY.loadFailed);
    expect(html).not.toContain("Schedule a tour <");
  });

  it("shows the readable profile error under the name prompt and hides the prompt once a save succeeded", () => {
    mocks.mine.mockReturnValue(mineResult({ data: { lead, communitiesJson: JSON.stringify(communities) } }));
    mocks.updateProfileResult.isError = true;
    mocks.updateProfileResult.error = { message: '[{"code":"too_small","minimum":2}]', data: { code: "BAD_REQUEST" } };
    const failed = decode(renderMine());
    expect(failed).toContain(`<p role="alert" class="mt-3 text-sm text-destructive">${MINE_COPY.profileInvalid}</p>`);
    expect(failed).not.toContain("too_small");
    mocks.updateProfileResult.isError = false;
    mocks.updateProfileResult.error = null;
    mocks.updateProfileResult.isSuccess = true;
    const saved = decode(renderMine());
    expect(saved).not.toContain("Add your name so we know who to text.");
    // A successful save refetches the list so the saved name arrives from the server.
    (mocks.updateProfile.options?.onSuccess as () => void)();
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe("gate sheet: deals.state is refetched whenever start leaves a pending record", () => {
  const renderSheet = () => renderToStaticMarkup(createElement(GateSheet, { state: { pending: null, consentText: "consent" }, onClose: () => undefined }));
  const startSucceeded = (result: unknown) => (mocks.start.options?.onSuccess as (result: unknown) => void)(result);

  it("invalidates deals.state after a sent code, so a closed sheet reopens on the code step instead of burning a new code", () => {
    renderSheet();
    expect(mocks.start.options).not.toBeNull();
    startSucceeded({ ok: true, displayPhone: "(210) •••-0123" });
    expect(mocks.invalidateState).toHaveBeenCalledTimes(1);
  });

  it("still invalidates for cannot_receive and not for a refusal that leaves no pending record", () => {
    renderSheet();
    startSucceeded({ ok: false, kind: "cannot_receive", message: "That number can't receive texts. Try a mobile number or tap Call me." });
    expect(mocks.invalidateState).toHaveBeenCalledTimes(1);
    startSucceeded({ ok: false, kind: "outside_us", message: "US mobile numbers only for now." });
    startSucceeded({ ok: false, kind: "rate_limited", message: "Try again in a bit." });
    startSucceeded({ ok: false, kind: "blocked", message: "Buyer access only." });
    expect(mocks.invalidateState).toHaveBeenCalledTimes(1);
  });
});
