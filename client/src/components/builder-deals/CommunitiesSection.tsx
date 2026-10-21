import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Building2, CheckCircle2, Plus, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog, EmptyRow, Field, GOLD_BUTTON, Section, SwitchRow, TAP, Warning, inputClass } from "./shared";
import {
  INCENTIVE_FIELD_LABELS, SCRUB_CATEGORIES, SCRUB_CATEGORY_LABELS, acceptHoldInput, acceptHoldReady, ageLabel, chicagoDateInput, displayDate,
  emptyAcceptDraft, emptyScrubDraft, scrubDraftFromConfig, scrubListFromDraft, sourceHost, type AcceptDraft, type IncentiveFieldKey, type ScrubDraft,
} from "./helpers";
import type { CommunityDiagnostics, CommunityRow, HeldIncentive, IncentiveRow, Overview } from "./types";

/** The server's builder ids (adapter names plus Manual); never spelled out in client code so no name ships in the public bundle. */
type Builder = string;
type BuilderOption = { id: string; label: string; host: string | null; manual: boolean };
const MANUAL_BUILDER = "Manual";

type CommunityDraft = {
  builder: Builder;
  privateName: string;
  sourceUrl: string;
  publicLabel: string;
  areaLabel: string;
  privateAddress: string;
  salesPhone: string;
  reelCode: string;
  reelUrl: string;
  scrub: ScrubDraft;
};

const EMPTY_COMMUNITY: CommunityDraft = { builder: "", privateName: "", sourceUrl: "", publicLabel: "", areaLabel: "", privateAddress: "", salesPhone: "", reelCode: "", reelUrl: "", scrub: emptyScrubDraft() };

function draftFromCommunity(community: CommunityRow, diagnostics: CommunityDiagnostics | undefined): CommunityDraft {
  return {
    builder: community.builder,
    privateName: community.privateName,
    sourceUrl: community.sourceUrl,
    publicLabel: community.publicLabel,
    areaLabel: community.areaLabel,
    privateAddress: community.privateAddress,
    salesPhone: community.salesPhone ?? "",
    reelCode: community.reelCode,
    reelUrl: community.reelUrl ?? "",
    scrub: scrubDraftFromConfig(diagnostics?.scrubConfig),
  };
}

/** Add or edit a community: builder, official URL, labels, reel, sales phone and the per-category names-to-hide lists. */
function CommunityForm({ id, initial, builders, onDone }: { id?: number; initial: CommunityDraft; builders: BuilderOption[]; onDone: () => void }) {
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState<CommunityDraft>(() => ({ ...initial, builder: initial.builder || builders.find((option) => !option.manual)?.id || builders[0]?.id || "" }));
  const prefix = id ? `community-${id}` : "community-new";
  const builder = builders.find((option) => option.id === draft.builder);
  const isManual = builder ? builder.manual : draft.builder === MANUAL_BUILDER;
  type BuilderInput = Parameters<typeof save.mutate>[0]["builder"];
  const save = trpc.deals.admin.saveCommunity.useMutation({
    onSuccess: () => {
      void utils.deals.admin.overview.invalidate();
      void utils.deals.admin.communityDiagnostics.invalidate();
      toast.success(id ? "Community saved" : "Community added");
      onDone();
    },
    onError: (error) => toast.error(error.message || "Could not save the community"),
  });
  const set = (patch: Partial<CommunityDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const submit = () => {
    const required: Array<[keyof CommunityDraft, string]> = [["privateName", "private community name"], ["sourceUrl", "builder page URL"], ["publicLabel", "public label"], ["areaLabel", "area label"], ["reelCode", "reel code"]];
    const missing = required.filter(([key]) => !String(draft[key]).trim()).map(([, label]) => label);
    if (missing.length) { toast.error(`Add the ${missing.join(", ")}.`); return; }
    if (!/^[a-z0-9_-]{1,40}$/.test(draft.reelCode.trim())) { toast.error("Reel codes use lowercase letters, numbers, dashes or underscores (max 40)."); return; }
    for (const url of [draft.sourceUrl, draft.reelUrl]) {
      if (url.trim()) { try { new URL(url.trim()); } catch { toast.error("Enter complete URLs, including https://"); return; } }
    }
    if (!builders.some((option) => option.id === draft.builder)) { toast.error("Choose a builder."); return; }
    save.mutate({
      id, builder: draft.builder as BuilderInput, privateName: draft.privateName.trim(), sourceUrl: draft.sourceUrl.trim(), publicLabel: draft.publicLabel.trim(), areaLabel: draft.areaLabel.trim(),
      privateAddress: draft.privateAddress.trim(), salesPhone: draft.salesPhone.trim() || null, reelCode: draft.reelCode.trim(), reelUrl: draft.reelUrl.trim() || null,
      scrubList: scrubListFromDraft(draft.scrub),
    });
  };
  return (
    <div className="space-y-4 border border-gold/30 bg-gold/5 p-4">
      <p className="font-medium">{id ? "Edit community" : "Add a community"}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${prefix}-builder`} label="Builder">
          <Select value={draft.builder} onValueChange={(builder) => set({ builder: builder as Builder })}>
            <SelectTrigger id={`${prefix}-builder`} className={inputClass}><SelectValue /></SelectTrigger>
            <SelectContent>{builders.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field id={`${prefix}-private-name`} label="Private community name" hint="Never shown to buyers; seeds the names-to-hide list.">
          <Input id={`${prefix}-private-name`} className={inputClass} value={draft.privateName} onChange={(event) => set({ privateName: event.target.value })} />
        </Field>
        <Field id={`${prefix}-source-url`} label={isManual ? "Reference page URL" : "Official builder page URL"} hint={isManual ? "Any HTTPS page for your own reference; a Manual community never auto-updates." : `The adapter's exact official host over HTTPS${builder?.host ? `, https://${builder.host}/...` : ""}.`} className="sm:col-span-2">
          <Input id={`${prefix}-source-url`} className={inputClass} type="url" inputMode="url" value={draft.sourceUrl} onChange={(event) => set({ sourceUrl: event.target.value })} placeholder="https://www." />
        </Field>
        <Field id={`${prefix}-public-label`} label="Public label" hint="Shown to buyers. No builder, community, plan or street names.">
          <Input id={`${prefix}-public-label`} className={inputClass} value={draft.publicLabel} onChange={(event) => set({ publicLabel: event.target.value })} placeholder="Southeast San Antonio | Half-Acre Lots and Lakes" />
        </Field>
        <Field id={`${prefix}-area-label`} label="Area label">
          <Input id={`${prefix}-area-label`} className={inputClass} value={draft.areaLabel} onChange={(event) => set({ areaLabel: event.target.value })} placeholder="Southeast San Antonio" />
        </Field>
        <Field id={`${prefix}-address`} label="Private address (with ZIP)" hint="Admin only. The ZIP code centers the buyer-facing area map; the address itself is never served.">
          <Input id={`${prefix}-address`} className={inputClass} value={draft.privateAddress} onChange={(event) => set({ privateAddress: event.target.value })} placeholder="123 Example Rd, San Antonio TX 78201" />
        </Field>
        <Field id={`${prefix}-sales-phone`} label="Sales office phone (private)">
          <Input id={`${prefix}-sales-phone`} className={inputClass} type="tel" inputMode="tel" value={draft.salesPhone} onChange={(event) => set({ salesPhone: event.target.value })} placeholder="(210) 555-0100" />
        </Field>
        <Field id={`${prefix}-reel-code`} label="Reel code (src)" hint="Lowercase, for example sl1. Add it to the active reel codes in Settings so the funnel counts it.">
          <Input id={`${prefix}-reel-code`} className={inputClass} value={draft.reelCode} onChange={(event) => set({ reelCode: event.target.value.toLowerCase() })} placeholder="sl1" />
        </Field>
        <Field id={`${prefix}-reel-url`} label="Instagram reel URL" hint="Blank shows the Video coming soon card.">
          <Input id={`${prefix}-reel-url`} className={inputClass} type="url" inputMode="url" value={draft.reelUrl} onChange={(event) => set({ reelUrl: event.target.value })} placeholder="https://www.instagram.com/reel/..." />
        </Field>
      </div>
      <div>
        <p className="text-sm font-medium">Names to hide (one per line)</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Scrubbed before anything is stored or shown. Builder and lender names become "the builder" and "the builder's lender", community names "this community", plan names "this plan" (only as "the X" or "X plan" outside plan fields), street names "this street". The builder aliases and the private community name are always included.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SCRUB_CATEGORIES.map((category) => (
            <Field key={category} id={`${prefix}-scrub-${category}`} label={SCRUB_CATEGORY_LABELS[category]}>
              <Textarea id={`${prefix}-scrub-${category}`} rows={3} value={draft.scrub[category]} onChange={(event) => set({ scrub: { ...draft.scrub, [category]: event.target.value } })} />
            </Field>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" className={`${TAP} ${GOLD_BUTTON} w-full sm:w-auto`} disabled={save.isPending} onClick={submit}><Plus className="mr-1 h-4 w-4" />{save.isPending ? "Saving..." : id ? "Save community" : "Add community"}</Button>
        <Button type="button" variant="outline" className={`${TAP} w-full sm:w-auto`} disabled={save.isPending} onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}

type IncentiveDraft = Record<IncentiveFieldKey, string> & { manual: boolean };

function incentiveDraft(active: IncentiveRow | null, manualDefault: boolean): IncentiveDraft {
  return {
    publicText: active?.publicText ?? "", contractBy: chicagoDateInput(active?.contractBy), closeBy: chicagoDateInput(active?.closeBy),
    headlineRate: active?.headlineRate ?? "", followOnRate: active?.followOnRate ?? "", followOnPeriod: active?.followOnPeriod ?? "", apr: active?.apr ?? "",
    loanType: active?.loanType ?? "", downPayment: active?.downPayment ?? "", repaymentTerms: active?.repaymentTerms ?? "", manual: active?.manual ?? manualDefault,
  };
}

const RATE_FIELDS: IncentiveFieldKey[] = ["headlineRate", "apr", "followOnRate", "followOnPeriod", "loanType", "downPayment", "repaymentTerms"];

/** Incentive text, contract-by, close-by, manual switch and the rate fields, bound to saveIncentive. Saving re-confirms. */
function IncentiveEditor({ community, active }: { community: CommunityRow; active: IncentiveRow | null }) {
  const utils = trpc.useUtils();
  const manualDefault = community.builder === MANUAL_BUILDER || community.manualMode;
  const [draft, setDraft] = useState<IncentiveDraft>(() => incentiveDraft(active, manualDefault));
  const prefix = `incentive-${community.id}`;
  const save = trpc.deals.admin.saveIncentive.useMutation({
    onSuccess: () => { void utils.deals.admin.overview.invalidate(); void utils.deals.admin.communityDiagnostics.invalidate(); toast.success("Incentive published"); },
    onError: (error) => toast.error(error.message || "Could not save the incentive"),
  });
  const set = (patch: Partial<IncentiveDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const text = (value: string) => (value.trim() ? value.trim() : null);
  const submit = () => {
    if (draft.publicText.trim().length < 2) { toast.error("Enter the incentive text."); return; }
    // The same wording is updated in place, and so is the live builder promo edited without the manual override (it stays tied to
    // the builder's text); new manual wording starts a new record so a new promo never inherits an old deadline.
    const sameText = active ? active.publicText.replace(/\s+/g, " ").trim().toLowerCase() === draft.publicText.replace(/\s+/g, " ").trim().toLowerCase() : false;
    save.mutate({
      id: active && (sameText || (!draft.manual && !active.manual)) ? active.id : undefined, communityId: community.id, publicText: draft.publicText.trim(), manual: draft.manual,
      contractBy: text(draft.contractBy), closeBy: text(draft.closeBy), headlineRate: text(draft.headlineRate), followOnRate: text(draft.followOnRate), followOnPeriod: text(draft.followOnPeriod),
      apr: text(draft.apr), loanType: text(draft.loanType), downPayment: text(draft.downPayment), repaymentTerms: text(draft.repaymentTerms),
    });
  };
  return (
    <div className="space-y-3 border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Incentive</p>
        {active ? <p className="text-[11px] text-muted-foreground">Live since {displayDate(active.confirmedAt)}{active.expiresAt ? `, expires ${displayDate(active.expiresAt)}` : ", no dates (lapse rule applies)"}{active.manual ? ", manual override" : ""}</p> : <p className="text-[11px] text-muted-foreground">No live incentive. Saving publishes immediately.</p>}
      </div>
      <Field id={`${prefix}-text`} label="Incentive text (builder's exact wording)" hint="Private names are scrubbed on save; the save is refused if any remain.">
        <Textarea id={`${prefix}-text`} rows={3} value={draft.publicText} onChange={(event) => set({ publicText: event.target.value })} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${prefix}-contract-by`} label={INCENTIVE_FIELD_LABELS.contractBy} hint="Sticky for this wording; a scrape never clears it.">
          <Input id={`${prefix}-contract-by`} className={inputClass} type="date" value={draft.contractBy} onChange={(event) => set({ contractBy: event.target.value })} />
        </Field>
        <Field id={`${prefix}-close-by`} label={INCENTIVE_FIELD_LABELS.closeBy}>
          <Input id={`${prefix}-close-by`} className={inputClass} type="date" value={draft.closeBy} onChange={(event) => set({ closeBy: event.target.value })} />
        </Field>
        {RATE_FIELDS.map((key) => (
          <Field key={key} id={`${prefix}-${key}`} label={INCENTIVE_FIELD_LABELS[key]}>
            <Input id={`${prefix}-${key}`} className={inputClass} value={draft[key]} onChange={(event) => set({ [key]: event.target.value } as Partial<IncentiveDraft>)} placeholder={key === "apr" ? "6.051%" : key === "headlineRate" ? "4.25%" : key === "followOnPeriod" ? "years 2 to 30" : ""} />
          </Field>
        ))}
      </div>
      <SwitchRow id={`${prefix}-manual`} label="Manual override" note="Holds until its own contract-by or close-by date (whichever is earlier); with no dates it follows the lapse rule. Saving counts as a re-confirmation." checked={draft.manual} onCheckedChange={(manual) => set({ manual })} />
      <Button type="button" className={`${TAP} ${GOLD_BUTTON} w-full sm:w-auto`} disabled={save.isPending} onClick={submit}>{save.isPending ? "Publishing..." : "Save incentive"}</Button>
    </div>
  );
}

/** "Accept this update": every field the hold reasons require, Accept disabled until each is filled. */
function AcceptHoldForm({ held, onDone }: { held: HeldIncentive; onDone: () => void }) {
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState<AcceptDraft>(emptyAcceptDraft);
  const prefix = `accept-${held.id}`;
  const accept = trpc.deals.admin.acceptHold.useMutation({
    onSuccess: () => { void utils.deals.admin.overview.invalidate(); void utils.deals.admin.communityDiagnostics.invalidate(); toast.success("Incentive update accepted and published"); onDone(); },
    onError: (error) => toast.error(error.message || "Could not accept this update"),
  });
  const missing = new Set(held.missingFields);
  const ready = acceptHoldReady(held.missingFields, draft);
  const fields: IncentiveFieldKey[] = ["contractBy", "closeBy", "headlineRate", "apr", "followOnRate", "followOnPeriod", "loanType", "downPayment", "repaymentTerms"];
  return (
    <div className="space-y-3 border border-gold/40 bg-background p-3">
      <p className="text-sm">Enter the figures from the builder's flyer. Fields marked required come from the hold reasons; the rest are optional.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((key) => (
          <Field key={key} id={`${prefix}-${key}`} label={`${INCENTIVE_FIELD_LABELS[key]}${missing.has(key) ? " (required)" : ""}`}>
            <Input id={`${prefix}-${key}`} className={inputClass} type={key === "contractBy" || key === "closeBy" ? "date" : "text"} value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} aria-invalid={missing.has(key) && !draft[key].trim() && !(key === "contractBy" && draft.noContractDeadline)} />
          </Field>
        ))}
        {missing.has("publicText") && <Field id={`${prefix}-publicText`} label={`${INCENTIVE_FIELD_LABELS.publicText} (required)`} className="sm:col-span-2"><Textarea id={`${prefix}-publicText`} rows={3} value={draft.publicText} onChange={(event) => setDraft({ ...draft, publicText: event.target.value })} /></Field>}
      </div>
      {missing.has("contractBy") && <label className={`flex ${TAP} items-center gap-2 text-sm`}><input type="checkbox" className="h-5 w-5 accent-[oklch(0.75_0.09_85)]" checked={draft.noContractDeadline} onChange={(event) => setDraft({ ...draft, noContractDeadline: event.target.checked })} /> The text has no contract deadline</label>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" className={`${TAP} ${GOLD_BUTTON} w-full sm:w-auto`} disabled={!ready || accept.isPending} onClick={() => accept.mutate(acceptHoldInput(held.id, draft))}>{accept.isPending ? "Publishing..." : "Accept this update"}</Button>
        <Button type="button" variant="outline" className={`${TAP} w-full sm:w-auto`} disabled={accept.isPending} onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}

/** Catalog holds offer Dismiss hold / Switch to manual only; incentive holds offer Accept this update / Dismiss. */
function HoldBanner({ community, diagnostics }: { community: CommunityRow; diagnostics: CommunityDiagnostics }) {
  const utils = trpc.useUtils();
  const [accepting, setAccepting] = useState<number | null>(null);
  const refresh = () => { void utils.deals.admin.overview.invalidate(); void utils.deals.admin.communityDiagnostics.invalidate(); };
  const onError = (error: { message: string }) => toast.error(error.message || "Could not update the hold");
  const dismissCatalog = trpc.deals.admin.dismissCatalogHold.useMutation({ onSuccess: () => { refresh(); toast.success("Hold dismissed. Last good data stays published."); }, onError });
  const switchManual = trpc.deals.admin.saveCommunityState.useMutation({ onSuccess: () => { refresh(); toast.success("Community switched to manual mode"); }, onError });
  const dismissIncentive = trpc.deals.admin.dismissHold.useMutation({ onSuccess: () => { refresh(); toast.success("Incentive hold dismissed"); }, onError });
  if (!diagnostics.catalogHold && !diagnostics.heldIncentives.length && !diagnostics.incentiveHold) return null;
  return (
    <div className="space-y-3">
      {diagnostics.catalogHold && (
        <div className="space-y-3 border border-destructive/40 bg-destructive/5 p-3">
          <p className="flex items-start gap-2 text-sm font-medium text-destructive"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Update held ({ageLabel(diagnostics.catalogHold.ageHours)}): {diagnostics.catalogHold.reason.replaceAll("_", " ")}</p>
          <p className="text-xs text-muted-foreground">The page failed to load or its homes container was missing, so nothing was published and the last good data stays up. There is nothing to accept from an empty parse.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" className={`${TAP} w-full sm:w-auto`} disabled={dismissCatalog.isPending} onClick={() => dismissCatalog.mutate({ id: community.id })}>Dismiss hold</Button>
            <Button type="button" variant="outline" className={`${TAP} w-full sm:w-auto`} disabled={switchManual.isPending || community.manualMode} onClick={() => switchManual.mutate({ id: community.id, manualMode: true })}>Switch to manual</Button>
          </div>
        </div>
      )}
      {diagnostics.heldIncentives.map((held) => (
        <div key={held.id} className="space-y-3 border border-gold/50 bg-gold/5 p-3">
          <p className="flex items-start gap-2 text-sm font-medium"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-gold" /> Incentive update held{diagnostics.incentiveHold ? ` (${ageLabel(diagnostics.incentiveHold.ageHours)})` : ""}</p>
          <p className="break-words text-sm">{held.publicText}</p>
          {held.reasons.length > 0 && <p className="text-xs text-muted-foreground">Reasons: {held.reasons.map((reason) => reason.replaceAll("_", " ")).join(", ")}</p>}
          {held.status && <p className="text-xs font-medium" data-deals-held-status="true">{held.status}. Accept is optional.</p>}
          {held.missingFields.length > 0 && <p className="text-xs text-muted-foreground">Needed to publish the full offer: {held.missingFields.map((field) => INCENTIVE_FIELD_LABELS[field as IncentiveFieldKey] ?? field).join(", ")}</p>}
          {accepting === held.id ? <AcceptHoldForm held={held} onDone={() => setAccepting(null)} /> : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" className={`${TAP} ${GOLD_BUTTON} w-full sm:w-auto`} onClick={() => setAccepting(held.id)}>Accept this update</Button>
              <Button type="button" variant="outline" className={`${TAP} w-full sm:w-auto`} disabled={dismissIncentive.isPending} onClick={() => dismissIncentive.mutate({ id: held.id })}>Dismiss</Button>
            </div>
          )}
        </div>
      ))}
      {!diagnostics.heldIncentives.length && diagnostics.incentiveHold && (
        <Warning>Incentive hold recorded ({ageLabel(diagnostics.incentiveHold.ageHours)}): {diagnostics.incentiveHold.reason}. The held record is no longer present; the next refresh will recreate it if the wording still needs figures.</Warning>
      )}
    </div>
  );
}

function CommunityCard({ community, diagnostics, activeIncentive, builders }: { community: CommunityRow; diagnostics: CommunityDiagnostics | undefined; activeIncentive: IncentiveRow | null; builders: BuilderOption[] }) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [showIncentive, setShowIncentive] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const refresh = () => { void utils.deals.admin.overview.invalidate(); void utils.deals.admin.communityDiagnostics.invalidate(); };
  const onError = (error: { message: string }) => toast.error(error.message || "Could not update the community");
  const saveState = trpc.deals.admin.saveCommunityState.useMutation({ onSuccess: () => { refresh(); toast.success("Community state saved"); }, onError });
  const remove = trpc.deals.admin.removeCommunity.useMutation({ onSuccess: () => { refresh(); setConfirmRemove(false); toast.success("Community removed from the catalog (archived)"); }, onError });
  const refreshNow = trpc.deals.admin.refreshCommunity.useMutation({
    onSuccess: (result) => {
      // Queued for the next builder check (every 10 minutes in catalog hours), which reads it first.
      toast[result.queued ? "success" : "message"](result.message);
      window.setTimeout(refresh, 4000);
    },
    onError,
  });
  const testSource = trpc.deals.admin.testCommunitySource.useMutation({
    onSuccess: (result) => toast[result.status >= 200 && result.status < 300 ? "success" : "warning"](result.error ? `Source test failed: ${result.error}` : `Source ${result.host} answered ${result.status}${result.redirected ? (result.redirectSameHost === false ? " (redirect to another host, not followed)" : " (after a same-host redirect)") : ""}${result.status === 401 || result.status === 403 ? ": the builder refuses automated reads; a one-off challenge can clear on its own, so if it keeps happening, switch this community to Manual" : ""}, ${result.bytes.toLocaleString()} bytes read${result.truncated ? " (test capped at 64 KB; the reader reads the whole page)" : ""}.`),
    onError,
  });
  const manual = community.builder === MANUAL_BUILDER || community.manualMode;
  const lastRun = diagnostics?.lastRefreshRun ?? null;
  return (
    <div className="space-y-4 border border-border p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="break-words font-medium">{community.publicLabel}</p>
            {community.awaitingFirstSync ? <Badge variant="outline">{diagnostics && !diagnostics.readerAvailable ? `Waiting for a ${community.builder} reader` : "Added automatically, goes live after its first clean update"}</Badge> : !community.active && <Badge variant="secondary">Archived</Badge>}
            {community.paused && <Badge variant="destructive">Paused (hidden from public)</Badge>}
            {manual && <Badge className="bg-gold text-primary-foreground">Manual mode, no auto-update</Badge>}
            {diagnostics?.refreshDue && !manual && <Badge variant="outline">Refresh due</Badge>}
          </div>
          <p className="break-words text-xs text-muted-foreground">Private mapping: {community.builder} / {community.privateName} / {community.privateAddress || "no address"} / {community.salesPhone || "no sales phone"} / {sourceHost(community.sourceUrl)}</p>
          <p className="text-xs text-muted-foreground">Reel code {community.reelCode}. Last successful update {displayDate(community.lastSuccessfulSyncAt)}. Last attempt {displayDate(community.lastAttemptAt)}. Catalog updated {displayDate(community.catalogUpdatedAt)}.</p>
          {diagnostics && <p className="text-xs text-muted-foreground">{diagnostics.homes.quickMoveIn} available now, {diagnostics.homes.toBeBuilt} to be built, {diagnostics.homes.sold} sold, {diagnostics.homes.hidden} hidden, {diagnostics.homes.manual} manual. Area map {diagnostics.areaMap ? "ready" : "unavailable (no ZIP centroid yet)"}{diagnostics.driveTimeChips.length ? `, ${diagnostics.driveTimeChips.join(", ")}` : ""}.</p>}
          {lastRun && <p className="flex items-center gap-1 text-xs text-muted-foreground">{lastRun.status === "ok" ? <CheckCircle2 className="h-3.5 w-3.5 text-gold" /> : lastRun.status === "running" ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5 text-destructive" />} Refresh now: {lastRun.status === "running" && lastRun.detail === "queued" ? "queued (read within ~10 minutes in catalog hours)" : lastRun.status === "running" ? "reading now" : lastRun.status} at {displayDate(lastRun.startedAt)}{lastRun.completedAt ? `, finished ${displayDate(lastRun.completedAt)}` : ""}{lastRun.status !== "running" && lastRun.detail && /^(held|not refreshed|failed|interrupted):/.test(lastRun.detail) ? ` (${lastRun.detail.slice(0, 160)})` : ""}</p>}
          {diagnostics?.dismissedCatalogHold && !diagnostics.catalogHold && <p className="text-xs text-muted-foreground">Dismissed hold: {diagnostics.dismissedCatalogHold.replaceAll("_", " ")} (no repeat email until the parse result changes).</p>}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {!manual && (community.active || community.awaitingFirstSync) && <Button type="button" variant="outline" className={TAP} disabled={refreshNow.isPending} onClick={() => refreshNow.mutate({ id: community.id })}><RefreshCw className={`mr-1 h-4 w-4 ${refreshNow.isPending ? "animate-spin" : ""}`} /> Refresh now</Button>}
          {!manual && <Button type="button" variant="outline" className={TAP} disabled={testSource.isPending} onClick={() => testSource.mutate({ id: community.id })}>{testSource.isPending ? "Testing..." : "Test source"}</Button>}
          <Button type="button" variant="outline" className={TAP} disabled={saveState.isPending} onClick={() => saveState.mutate({ id: community.id, paused: !community.paused })}>{community.paused ? "Resume" : "Pause"}</Button>
          {community.builder !== MANUAL_BUILDER && <Button type="button" variant="outline" className={TAP} disabled={saveState.isPending} onClick={() => saveState.mutate({ id: community.id, manualMode: !community.manualMode })}>{community.manualMode ? "Manual off" : "Manual on"}</Button>}
          <Button type="button" variant="outline" className={TAP} onClick={() => setEditing((value) => !value)}>{editing ? "Close edit" : "Edit"}</Button>
          <Button type="button" variant="outline" className={TAP} onClick={() => setShowIncentive((value) => !value)}>{showIncentive ? "Close incentive" : "Incentive"}</Button>
          {community.active || community.awaitingFirstSync ? <Button type="button" variant="destructive" className={TAP} onClick={() => setConfirmRemove(true)}>Remove</Button> : <Button type="button" className={`${TAP} ${GOLD_BUTTON}`} disabled={saveState.isPending} onClick={() => saveState.mutate({ id: community.id, active: true, paused: false })}>Restore</Button>}
        </div>
      </div>
      {diagnostics && <HoldBanner community={community} diagnostics={diagnostics} />}
      {diagnostics?.incentive?.status && (
        <div className="space-y-1 border border-border bg-secondary/40 p-3" data-deals-auto-accepted="true">
          <p className="flex items-start gap-2 text-sm font-medium"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-gold" /> {diagnostics.incentive.status}</p>
          <p className="break-words text-sm">{diagnostics.incentive.publicText}</p>
          <p className="text-xs text-muted-foreground">{diagnostics.incentive.expiresAt ? `It comes off by its dated deadline (${displayDate(diagnostics.incentive.expiresAt)}).` : "It shows with no dates and comes off by the lapse rule once the builder stops showing it."} To add a date, open Incentive and save it.</p>
        </div>
      )}
      {showIncentive && <IncentiveEditor key={activeIncentive?.id ?? "none"} community={community} active={activeIncentive} />}
      {editing && <CommunityForm id={community.id} initial={draftFromCommunity(community, diagnostics)} builders={builders} onDone={() => setEditing(false)} />}
      <ConfirmDialog open={confirmRemove} title="Remove this community?" description="The community is archived: it leaves the public and gated pages immediately, while its homes, photos and lead history stay in admin. You can restore it later." confirmLabel="Remove community" pending={remove.isPending} onCancel={() => setConfirmRemove(false)} onConfirm={() => remove.mutate({ id: community.id, confirm: true })} />
    </div>
  );
}

export function CommunitiesSection({ overview }: { overview: Overview }) {
  const [adding, setAdding] = useState(false);
  const diagnosticsQuery = trpc.deals.admin.communityDiagnostics.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const buildersQuery = trpc.deals.admin.builders.useQuery(undefined, { retry: false, refetchOnWindowFocus: false, staleTime: Number.POSITIVE_INFINITY });
  const builders: BuilderOption[] = buildersQuery.data ?? [];
  const byId = new Map((diagnosticsQuery.data ?? []).map((row) => [row.id, row]));
  const activeIncentive = (communityId: number) => overview.incentives.find((row) => row.communityId === communityId && row.active && !row.held) ?? null;
  const utils = trpc.useUtils();
  const refresh = () => { void utils.deals.admin.overview.invalidate(); void utils.deals.admin.communityDiagnostics.invalidate(); };
  const importResearch = trpc.deals.admin.importResearchCommunities.useMutation({ onSuccess: (result) => { refresh(); toast.success(`Research list loaded: ${result.created} new, ${result.existing} already here, ${result.skipped} skipped (${result.builders} builders).`); }, onError: (error) => toast.error(error.message) });
  const discover = trpc.deals.admin.discoverCommunities.useMutation({ onSuccess: () => toast.success("Looking for new communities on every builder's site. New ones are emailed to you and appear here hidden until their first clean update."), onError: (error) => toast.error(error.message) });
  const waiting = overview.communities.filter((community) => community.awaitingFirstSync).length;
  return (
    <Section
      id="communities"
      title="Communities"
      icon={Building2}
      description="Add a community, edit its mapping and names-to-hide lists, pause it (hidden from public), or remove it. Refresh now runs that community's adapter as a background job. The private builder mapping appears only in this role-gated panel."
      action={<div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto"><Button type="button" variant="outline" className={`${TAP} w-full sm:w-auto`} disabled={importResearch.isPending} onClick={() => importResearch.mutate()}>{importResearch.isPending ? "Loading..." : "Load research list"}</Button><Button type="button" variant="outline" className={`${TAP} w-full sm:w-auto`} disabled={discover.isPending} onClick={() => discover.mutate()}><RefreshCw className={`mr-1 h-4 w-4 ${discover.isPending ? "animate-spin" : ""}`} /> Find new communities</Button><Button type="button" className={`${TAP} ${GOLD_BUTTON} w-full sm:w-auto`} onClick={() => setAdding((value) => !value)}><Plus className="mr-1 h-4 w-4" /> {adding ? "Close form" : "Add community"}</Button></div>}
    >
      <div className="space-y-4">
        {waiting > 0 && <p className="text-xs text-muted-foreground" data-deals-waiting-count="true">{waiting} communit{waiting === 1 ? "y was" : "ies were"} added automatically and go{waiting === 1 ? "es" : ""} live after {waiting === 1 ? "its" : "their"} first clean update. Builders are checked every Monday, or now with Find new communities.</p>}
        {adding && (builders.length ? <CommunityForm initial={EMPTY_COMMUNITY} builders={builders} onDone={() => setAdding(false)} /> : <p className="text-xs text-muted-foreground">{buildersQuery.isError ? `Builder list could not be loaded: ${buildersQuery.error.message}` : "Loading builder list..."}</p>)}
        {diagnosticsQuery.isError && <Warning>Community diagnostics could not be loaded ({diagnosticsQuery.error.message}). Holds and refresh history are hidden until it loads.</Warning>}
        {overview.communities.map((community) => <CommunityCard key={community.id} community={community} diagnostics={byId.get(community.id)} activeIncentive={activeIncentive(community.id)} builders={builders} />)}
        {overview.communities.length === 0 && <EmptyRow>No Builder Deals communities are configured. Add the first one above.</EmptyRow>}
      </div>
    </Section>
  );
}
