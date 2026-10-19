/**
 * Pure helpers for the Builder Deals admin panel. No React, no tRPC: the
 * server-side vitest suite imports this file directly, so every rule the
 * panel relies on (upload limits, region math, funnel columns, deep links)
 * is covered by behavioural tests without a DOM.
 */

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export const FUB_PERSON_URL = "https://app.followupboss.com/2/people/view";

/** The FUB web link for a synced lead, or null when the lead never reached FUB. */
export function fubPersonLink(fubPersonId: string | null | undefined): string | null {
  const id = fubPersonId?.trim();
  return id ? `${FUB_PERSON_URL}/${encodeURIComponent(id)}` : null;
}

export const SCRUB_CATEGORIES = ["builder", "lender", "community", "plan", "street", "other"] as const;
export type ScrubCategory = (typeof SCRUB_CATEGORIES)[number];
export type ScrubDraft = Record<ScrubCategory, string>;

export const SCRUB_CATEGORY_LABELS: Record<ScrubCategory, string> = {
  builder: "Builder names and aliases",
  lender: "Builder's lender names",
  community: "Community names",
  plan: "Floor plan names",
  street: "Street names",
  other: "Other private words",
};

export function emptyScrubDraft(): ScrubDraft {
  return { builder: "", lender: "", community: "", plan: "", street: "", other: "" };
}

/** Textarea text (one term per line or comma separated) to a trimmed, de-duplicated list. */
export function toList(value: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const raw of value.split(/[\n,]/)) {
    const item = raw.trim();
    if (!item || seen.has(item.toLowerCase())) continue;
    seen.add(item.toLowerCase());
    items.push(item);
  }
  return items;
}

export function listValue(items: readonly string[] | undefined): string {
  return (items ?? []).join("\n");
}

/** Categorised scrub config (from communityDiagnostics.scrubConfig) to the six textarea drafts. */
export function scrubDraftFromConfig(config: Partial<Record<ScrubCategory, readonly string[]>> | null | undefined): ScrubDraft {
  const draft = emptyScrubDraft();
  for (const category of SCRUB_CATEGORIES) draft[category] = listValue(config?.[category]);
  return draft;
}

/** The six drafts to the categorised saveCommunity input (empty categories omitted). */
export function scrubListFromDraft(draft: ScrubDraft): Partial<Record<ScrubCategory, string[]>> {
  const result: Partial<Record<ScrubCategory, string[]>> = {};
  for (const category of SCRUB_CATEGORIES) {
    const terms = toList(draft[category]);
    if (terms.length) result[category] = terms;
  }
  return result;
}

export type PhotoRegion = { x: number; y: number; width: number; height: number };
export type RegionDraft = { x: string; y: string; width: string; height: string };

export function regionToDraft(region: PhotoRegion | null | undefined): RegionDraft {
  return region
    ? { x: String(region.x), y: String(region.y), width: String(region.width), height: String(region.height) }
    : { x: "", y: "", width: "", height: "" };
}

/**
 * Percent box typed by the admin. Returns null when every field is blank (clear
 * the region), or an error string when the box is not inside the frame.
 */
export function parseRegionDraft(draft: RegionDraft): { region: PhotoRegion | null } | { error: string } {
  const values = [draft.x, draft.y, draft.width, draft.height].map((value) => value.trim());
  if (values.every((value) => value === "")) return { region: null };
  const numbers = values.map(Number);
  if (numbers.some((value) => !Number.isFinite(value))) return { error: "Enter all four region values as percentages." };
  const [x, y, width, height] = numbers;
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 100 || y + height > 100) return { error: "The region must be a percent box inside the photo (x + width and y + height at most 100)." };
  return { region: { x, y, width, height } };
}

/** CSS percent offsets for the overlay drawn on a sample thumbnail. */
export function regionOverlayStyle(region: PhotoRegion): { left: string; top: string; width: string; height: string } {
  return { left: `${region.x}%`, top: `${region.y}%`, width: `${region.width}%`, height: `${region.height}%` };
}

/** Funnel columns in gate order; the server stores one dealEvents.kind per column. */
export const FUNNEL_COLUMNS = [
  { kind: "landed", label: "Landed" },
  { kind: "started_gate", label: "Gate started" },
  { kind: "code_sent", label: "Code sent" },
  { kind: "verified", label: "Verified" },
  { kind: "viewed_listings", label: "Viewed listings" },
  { kind: "tour_request", label: "Tour requests" },
  { kind: "blocked", label: "Blocked" },
  { kind: "has_agent", label: "Has agent" },
  { kind: "team", label: "Team" },
] as const;

export type FunnelRow = { sourceCode: string; counts: Record<string, number> };

/** Rows in reel-code order with "other" last, every column present (0 when absent). */
export function funnelTable(rows: readonly FunnelRow[]): Array<{ sourceCode: string; cells: number[] }> {
  return [...rows]
    .sort((a, b) => (a.sourceCode === "other" ? 1 : b.sourceCode === "other" ? -1 : a.sourceCode.localeCompare(b.sourceCode)))
    .map((row) => ({ sourceCode: row.sourceCode, cells: FUNNEL_COLUMNS.map((column) => Number(row.counts[column.kind] ?? 0)) }));
}

/** /admin/deals?lead=42 opens that lead's row and the Block and kill link dialog. */
export function leadIdFromSearch(search: string): number | null {
  const value = new URLSearchParams(search.startsWith("?") ? search : `?${search}`).get("lead");
  if (!value || !/^\d{1,9}$/.test(value)) return null;
  const id = Number(value);
  return id > 0 ? id : null;
}

/** ISO date/time to the YYYY-MM-DD the Chicago calendar shows (contract-by dates are stored as Chicago end of day). */
export function chicagoDateInput(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
}

export function ageHours(value: Date | string | null | undefined, now = new Date()): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.round((now.getTime() - date.getTime()) / 36e5));
}

export function ageLabel(hours: number | null): string {
  if (hours === null) return "unknown age";
  if (hours < 1) return "under an hour";
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** OCR matches stored on a photo row to the readable list of terms that hid it. */
export function ocrMatchTerms(value: unknown): string[] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  const terms = parsed.map((match) => {
    if (typeof match === "string") return match;
    if (match && typeof match === "object" && typeof (match as { term?: unknown }).term === "string") return (match as { term: string }).term;
    return "";
  }).filter(Boolean);
  return Array.from(new Set(terms));
}

export type PhotoStateLabel = { label: string; tone: "ready" | "waiting" | "hidden" | "failed" | "pending" };

/** One readable state per photo row: awaiting_region beats pending, hidden explains itself. */
export function photoStateLabel(photo: { processingState: string; automaticHidden: boolean; adminHidden: boolean; lastProcessingError: string | null; ocrMatches?: unknown }): PhotoStateLabel {
  if (photo.lastProcessingError === "awaiting_region") return { label: "Set watermark region", tone: "waiting" };
  if (photo.processingState === "failed") return { label: `Failed${photo.lastProcessingError ? `: ${photo.lastProcessingError.replaceAll("_", " ")}` : ""}`, tone: "failed" };
  if (photo.processingState !== "processed") return { label: photo.processingState === "processing" ? "Processing" : "Pending", tone: "pending" };
  if (photo.automaticHidden) {
    const terms = ocrMatchTerms(photo.ocrMatches);
    return { label: terms.length ? `Auto-hidden: ${terms.join(", ")}` : "Auto-hidden", tone: "hidden" };
  }
  if (photo.adminHidden) return { label: "Hidden by admin", tone: "hidden" };
  return { label: "Served", tone: "ready" };
}

export type IncentiveFieldKey = "contractBy" | "closeBy" | "headlineRate" | "followOnRate" | "followOnPeriod" | "apr" | "loanType" | "downPayment" | "repaymentTerms" | "publicText";

export const INCENTIVE_FIELD_LABELS: Record<IncentiveFieldKey, string> = {
  contractBy: "Contract-by date",
  closeBy: "Close-by date",
  headlineRate: "Headline rate",
  followOnRate: "Rate after the promotional period",
  followOnPeriod: "Period that rate applies to",
  apr: "APR",
  loanType: "Loan type",
  downPayment: "Down payment",
  repaymentTerms: "Repayment terms",
  publicText: "Incentive text (private names remain)",
};

export type AcceptDraft = Record<Exclude<IncentiveFieldKey, "publicText">, string> & { publicText: string; noContractDeadline: boolean };

export function emptyAcceptDraft(): AcceptDraft {
  return { contractBy: "", closeBy: "", headlineRate: "", followOnRate: "", followOnPeriod: "", apr: "", loanType: "", downPayment: "", repaymentTerms: "", publicText: "", noContractDeadline: false };
}

/**
 * "Accept this update" stays disabled until every missing field is filled; the
 * contract deadline may instead be satisfied by the "no contract deadline" tick.
 */
export function acceptHoldReady(missingFields: readonly string[], draft: AcceptDraft): boolean {
  return missingFields.every((field) => {
    if (field === "contractBy") return draft.noContractDeadline || draft.contractBy.trim() !== "";
    if (field === "publicText") return draft.publicText.trim() !== "";
    const value = draft[field as Exclude<IncentiveFieldKey, "publicText">];
    return typeof value === "string" && value.trim() !== "";
  });
}

/** Accept input: only the fields the admin filled (blank fields keep the held row's own values). */
export function acceptHoldInput(id: number, draft: AcceptDraft) {
  const text = (value: string) => (value.trim() ? value.trim() : undefined);
  return {
    id,
    contractBy: text(draft.contractBy),
    closeBy: text(draft.closeBy),
    noContractDeadline: draft.noContractDeadline || undefined,
    headlineRate: text(draft.headlineRate),
    followOnRate: text(draft.followOnRate),
    followOnPeriod: text(draft.followOnPeriod),
    apr: text(draft.apr),
    loanType: text(draft.loanType),
    downPayment: text(draft.downPayment),
    repaymentTerms: text(draft.repaymentTerms),
    publicText: text(draft.publicText),
  };
}

/** Whole non-negative integer from a text input, undefined when blank, NaN when invalid. */
export function optionalInteger(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const number = Number(trimmed.replace(/[$,]/g, ""));
  return Number.isInteger(number) && number >= 0 ? number : Number.NaN;
}

export function formatMoney(value: number | null | undefined): string {
  return typeof value === "number" ? `$${value.toLocaleString()}` : "none";
}

/** The browser's Date/ISO value as a readable local timestamp, never a dash placeholder. */
export function displayDate(value: Date | string | null | undefined): string {
  if (!value) return "none";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "none" : date.toLocaleString();
}

export function maskedHash(value: string | null | undefined): string {
  if (!value) return "none";
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function sourceHost(value: string): string {
  if (value.startsWith("upload:")) return "Admin upload";
  if (value.startsWith("manual:")) return "Manual entry";
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

/** Stored lead flags: a bare array or `{ flags: [...] }`. */
export function flagValues(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    const values = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && "flags" in parsed ? (parsed as { flags?: unknown }).flags : [];
    return Array.isArray(values) ? values.map((flag) => String(flag)) : [];
  } catch {
    return [];
  }
}

/** Reads a picked file as a data URL, refusing anything over the 8 MB limit before it leaves the device. */
export function readPhotoFile(file: File, reader: { readAsDataUrl: (file: File) => Promise<string> }): Promise<{ base64: string; contentType: string }> {
  if (file.size > MAX_UPLOAD_BYTES) return Promise.reject(new Error("Photos must be 8 MB or smaller."));
  if (!file.type.startsWith("image/")) return Promise.reject(new Error("Choose an image file (JPEG, PNG, WebP, or HEIC)."));
  return reader.readAsDataUrl(file).then((base64) => ({ base64, contentType: file.type }));
}

export function browserDataUrlReader(): { readAsDataUrl: (file: File) => Promise<string> } {
  return {
    readAsDataUrl: (file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("That photo could not be read on this device."));
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.readAsDataURL(file);
    }),
  };
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}
