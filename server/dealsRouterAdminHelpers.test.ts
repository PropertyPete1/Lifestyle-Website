import { describe, expect, it } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  acceptHoldInput,
  acceptHoldReady,
  ageLabel,
  chicagoDateInput,
  emptyAcceptDraft,
  flagValues,
  fubPersonLink,
  funnelTable,
  leadIdFromSearch,
  mergeUntouched,
  ocrMatchTerms,
  optionalInteger,
  pageCount,
  parseRegionDraft,
  photoStateLabel,
  readPhotoFile,
  regionOverlayStyle,
  regionToDraft,
  scrubDraftFromConfig,
  scrubListFromDraft,
  sourceHost,
  toList,
  touchedKeys,
  touchedPatch,
} from "@/components/builder-deals/helpers";

/** The admin panel's pure rules, exercised without a DOM: what the controls send and show. */
describe("admin panel helpers", () => {
  it("builds the FUB person link only for synced leads", () => {
    expect(fubPersonLink("4521")).toBe("https://app.followupboss.com/2/people/view/4521");
    expect(fubPersonLink(" 77 ")).toBe("https://app.followupboss.com/2/people/view/77");
    expect(fubPersonLink(null)).toBeNull();
    expect(fubPersonLink("")).toBeNull();
  });

  it("round-trips the categorised scrub lists through the six textareas, dropping blanks and duplicates", () => {
    const draft = scrubDraftFromConfig({ builder: ["Acme Homes", "Acme"], lender: [], community: ["Fixture Gardens"], plan: ["Magnolia"], street: ["Fixture Street", "Fixture Road"], other: [] });
    expect(draft.builder).toBe("Acme Homes\nAcme");
    expect(draft.street).toBe("Fixture Street\nFixture Road");
    expect(draft.lender).toBe("");
    expect(scrubListFromDraft({ ...draft, plan: "Magnolia, magnolia\n\nCypress", other: "  " })).toEqual({
      builder: ["Acme Homes", "Acme"], community: ["Fixture Gardens"], plan: ["Magnolia", "Cypress"], street: ["Fixture Street", "Fixture Road"],
    });
    expect(toList("a,\nb\n")).toEqual(["a", "b"]);
  });

  it("validates the percent region: blank clears, a box outside the frame is refused, the overlay uses percent offsets", () => {
    expect(parseRegionDraft({ x: "", y: "", width: "", height: "" })).toEqual({ region: null });
    expect(parseRegionDraft({ x: "0", y: "88", width: "100", height: "12" })).toEqual({ region: { x: 0, y: 88, width: 100, height: 12 } });
    expect(parseRegionDraft({ x: "0", y: "95", width: "100", height: "12" })).toMatchObject({ error: expect.stringContaining("inside the photo") });
    expect(parseRegionDraft({ x: "0", y: "0", width: "0", height: "10" })).toMatchObject({ error: expect.any(String) });
    expect(parseRegionDraft({ x: "abc", y: "0", width: "10", height: "10" })).toMatchObject({ error: expect.stringContaining("four region values") });
    expect(regionOverlayStyle({ x: 65, y: 85, width: 35, height: 15 })).toEqual({ left: "65%", top: "85%", width: "35%", height: "15%" });
    expect(regionToDraft(null)).toEqual({ x: "", y: "", width: "", height: "" });
    expect(regionToDraft({ x: 1, y: 2, width: 3, height: 4 })).toEqual({ x: "1", y: "2", width: "3", height: "4" });
  });

  it("lays the funnel out in gate order per reel code with other last and zero-filled columns", () => {
    const rows = funnelTable([
      { sourceCode: "other", counts: { landed: 3 } },
      { sourceCode: "vg1", counts: { landed: 10, started_gate: 6, code_sent: 5, verified: 4, viewed_listings: 4, tour_request: 1, blocked: 1, has_agent: 1, team: 1 } },
      { sourceCode: "sl1", counts: { landed: 2, verified: 1 } },
    ]);
    expect(rows.map((row) => row.sourceCode)).toEqual(["sl1", "vg1", "other"]);
    expect(rows[1].cells).toEqual([10, 6, 5, 4, 4, 1, 1, 1, 1]);
    expect(rows[0].cells).toEqual([2, 0, 0, 1, 0, 0, 0, 0, 0]);
    expect(rows[2].cells).toEqual([3, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("reads the lead deep link from /admin/deals?lead=42 and ignores junk", () => {
    expect(leadIdFromSearch("?lead=42")).toBe(42);
    expect(leadIdFromSearch("lead=42&x=1")).toBe(42);
    expect(leadIdFromSearch("?lead=0")).toBeNull();
    expect(leadIdFromSearch("?lead=abc")).toBeNull();
    expect(leadIdFromSearch("?lead=42abc")).toBeNull();
    expect(leadIdFromSearch("")).toBeNull();
  });

  it("shows a Chicago end-of-day deadline as that Chicago calendar date", () => {
    // 2026-11-08 23:59:59 America/Chicago (CST, UTC-6) is 2026-11-09T05:59:59Z.
    expect(chicagoDateInput("2026-11-09T05:59:59.000Z")).toBe("2026-11-08");
    expect(chicagoDateInput(new Date("2026-07-02T04:59:59.000Z"))).toBe("2026-07-01");
    expect(chicagoDateInput(null)).toBe("");
    expect(chicagoDateInput("not a date")).toBe("");
  });

  it("keeps Accept this update disabled until every missing field is filled, the contract tick counting for contractBy", () => {
    const draft = emptyAcceptDraft();
    expect(acceptHoldReady(["contractBy", "followOnRate", "followOnPeriod"], draft)).toBe(false);
    const filled = { ...draft, followOnRate: "6.25%", followOnPeriod: "years 2 to 30" };
    expect(acceptHoldReady(["contractBy", "followOnRate", "followOnPeriod"], filled)).toBe(false);
    expect(acceptHoldReady(["contractBy", "followOnRate", "followOnPeriod"], { ...filled, noContractDeadline: true })).toBe(true);
    expect(acceptHoldReady(["contractBy"], { ...draft, contractBy: "2026-11-08" })).toBe(true);
    expect(acceptHoldReady(["publicText"], { ...draft, publicText: "Clean wording" })).toBe(true);
    expect(acceptHoldReady([], draft)).toBe(true);
    expect(acceptHoldInput(9, { ...filled, noContractDeadline: true })).toEqual({
      id: 9, contractBy: undefined, closeBy: undefined, noContractDeadline: true, headlineRate: undefined, followOnRate: "6.25%", followOnPeriod: "years 2 to 30",
      apr: undefined, loanType: undefined, downPayment: undefined, repaymentTerms: undefined, publicText: undefined,
    });
    expect(acceptHoldInput(9, draft).noContractDeadline).toBeUndefined();
  });

  it("labels each photo row: awaiting region beats pending, hidden rows name the OCR terms", () => {
    expect(photoStateLabel({ processingState: "pending", automaticHidden: true, adminHidden: false, lastProcessingError: "awaiting_region" })).toEqual({ label: "Set watermark region", tone: "waiting" });
    expect(photoStateLabel({ processingState: "pending", automaticHidden: true, adminHidden: false, lastProcessingError: null })).toEqual({ label: "Pending", tone: "pending" });
    expect(photoStateLabel({ processingState: "failed", automaticHidden: true, adminHidden: false, lastProcessingError: "unapproved_source" })).toEqual({ label: "Failed: unapproved source", tone: "failed" });
    expect(photoStateLabel({ processingState: "processed", automaticHidden: true, adminHidden: false, lastProcessingError: null, ocrMatches: JSON.stringify([{ term: "Acme Homes", confidence: 91, words: ["Acme", "Homes"] }, { term: "Realty", confidence: 80, words: ["Realty"] }]) })).toEqual({ label: "Auto-hidden: Acme Homes, Realty", tone: "hidden" });
    expect(photoStateLabel({ processingState: "processed", automaticHidden: false, adminHidden: true, lastProcessingError: null })).toEqual({ label: "Hidden by admin", tone: "hidden" });
    expect(photoStateLabel({ processingState: "processed", automaticHidden: false, adminHidden: false, lastProcessingError: null })).toEqual({ label: "Served", tone: "ready" });
    expect(ocrMatchTerms("not json")).toEqual([]);
    expect(ocrMatchTerms(["MLS", "MLS"])).toEqual(["MLS"]);
  });

  it("refuses a photo over 8 MB or a non-image before reading it, and returns a data URL otherwise", async () => {
    const reader = { readAsDataUrl: async () => "data:image/jpeg;base64,/9j/4AAQ" };
    const big = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "big.jpg", { type: "image/jpeg" });
    await expect(readPhotoFile(big, reader)).rejects.toThrow("8 MB");
    const text = new File([new Uint8Array(10)], "notes.txt", { type: "text/plain" });
    await expect(readPhotoFile(text, reader)).rejects.toThrow("image file");
    const ok = new File([new Uint8Array(10)], "kitchen.jpg", { type: "image/jpeg" });
    await expect(readPhotoFile(ok, reader)).resolves.toEqual({ base64: "data:image/jpeg;base64,/9j/4AAQ", contentType: "image/jpeg" });
  });

  it("saves only the settings keys the admin edited, so a concurrent switch or cap raise is never overwritten", () => {
    type S = { commentKeyword: string; textLine: string; dailyVerificationCap: number; testTeamNumbers: string[]; testNumbers: string[] };
    const server: S = { commentKeyword: "HOME", textLine: "(512) 542-1477", dailyVerificationCap: 200, testTeamNumbers: [], testNumbers: ["+15125550123"] };
    // The admin edits the keyword, nothing else.
    let touched = touchedKeys<keyof S>([], { commentKeyword: "DEALS" });
    const draft: S = { ...server, commentKeyword: "DEALS" };
    expect(touched).toEqual(["commentKeyword"]);
    // Meanwhile the Team switch saved testTeamNumbers and Raise cap added 1,000; the refetched copy keeps the edit.
    const refreshed: S = { ...server, testTeamNumbers: ["+15125550123"], dailyVerificationCap: 1200 };
    const merged = mergeUntouched(refreshed, draft, touched);
    expect(merged).toEqual({ ...refreshed, commentKeyword: "DEALS" });
    // Save sends the edited key only: the stale list and the old cap never travel.
    expect(touchedPatch(merged, touched)).toEqual({ commentKeyword: "DEALS" });
    // Editing more keys accumulates without duplicates, and an untouched list is still not sent.
    touched = touchedKeys(touched, { textLine: "(512) 555-0100", commentKeyword: "DEALS" });
    expect(touched).toEqual(["commentKeyword", "textLine"]);
    expect(Object.keys(touchedPatch({ ...merged, textLine: "(512) 555-0100" }, touched)).sort()).toEqual(["commentKeyword", "textLine"]);
    // With nothing edited the whole server copy is adopted and the patch is empty.
    expect(mergeUntouched(refreshed, draft, [])).toEqual(refreshed);
    expect(touchedPatch(merged, [])).toEqual({});
  });

  it("parses optional whole-number inputs, flags, hosts, ages and pages", () => {
    expect(optionalInteger("")).toBeUndefined();
    expect(optionalInteger("$354,990")).toBe(354990);
    expect(Number.isNaN(optionalInteger("12.5"))).toBe(true);
    expect(Number.isNaN(optionalInteger("-1"))).toBe(true);
    expect(flagValues('["Possible Agent - Handle"]')).toEqual(["Possible Agent - Handle"]);
    expect(flagValues('{"flags":["TEST"]}')).toEqual(["TEST"]);
    expect(flagValues("broken")).toEqual([]);
    expect(sourceHost("upload:abc")).toBe("Admin upload");
    expect(sourceHost("manual:abc")).toBe("Manual entry");
    expect(sourceHost("https://www.example-builder.test/plan/1")).toBe("www.example-builder.test");
    expect(ageLabel(null)).toBe("unknown age");
    expect(ageLabel(0)).toBe("under an hour");
    expect(ageLabel(30)).toBe("30h");
    expect(ageLabel(72)).toBe("3d");
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(51, 25)).toBe(3);
  });
});

describe("Communities list search and paging (Oct 27: 934 cards at once was a 34,000-node page)", async () => {
  const { COMMUNITY_LIST_PAGE, communityMatches, visibleCommunities } = await import("@/components/builder-deals/helpers");
  const row = (id: number, over: Partial<Parameters<typeof communityMatches>[0]> = {}) => ({ id, builder: "Chesmar", privateName: `Place ${id}`, publicLabel: `Area ${id} | New Homes`, areaLabel: "Southeast San Antonio", schoolDistrict: "East Central ISD", holdReason: null, awaitingFirstSync: false, paused: false, active: true, ...over });
  it("matches builder, names, area, district, hold reason and id, and the words held, paused, hidden, waiting", () => {
    const held = row(7, { holdReason: "catalog: incomplete_inventory", builder: "M/I Homes" });
    expect(communityMatches(held, "m/i")).toBe(true);
    expect(communityMatches(held, "incomplete")).toBe(true);
    expect(communityMatches(held, "held")).toBe(true);
    expect(communityMatches(row(8), "held")).toBe(false);
    expect(communityMatches(row(9, { paused: true }), "paused")).toBe(true);
    expect(communityMatches(row(10, { active: false }), "hidden")).toBe(true);
    expect(communityMatches(row(11, { awaitingFirstSync: true }), "waiting")).toBe(true);
    expect(communityMatches(row(12), "12")).toBe(true);
    expect(communityMatches(row(12), "east central")).toBe(true);
    expect(communityMatches(row(12), "")).toBe(true);
  });
  it("shows a page until searched or opened in full", () => {
    const rows = Array.from({ length: 100 }, (_, index) => row(index + 1));
    expect(visibleCommunities(rows, "", false)).toMatchObject({ matching: 100 });
    expect(visibleCommunities(rows, "", false).shown).toHaveLength(COMMUNITY_LIST_PAGE);
    expect(visibleCommunities(rows, "", true).shown).toHaveLength(100);
    expect(visibleCommunities(rows, "place 9", false).shown.map((item) => item.id)).toEqual([9, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99]);
  });
});
