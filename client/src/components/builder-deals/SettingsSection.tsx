import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, FilePenLine, HeartPulse, Plus, RotateCcw, Save } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, GOLD_BUTTON, ListField, Metric, Section, SwitchRow, TAP, Warning, inputClass } from "./shared";
import { ageLabel, displayDate, mergeUntouched, touchedKeys, touchedPatch } from "./helpers";
import type { Health, Overview, Settings } from "./types";

type NumberKey = "expiryHours" | "clientLinkExpiryHours" | "clientLinkDays" | "paymentMarketRate" | "paymentDownPercent" | "paymentTaxRate" | "paymentInsuranceRate" | "paymentHoaMonthly" | "paymentMortgageInsuranceRate" | "areaMapRadiusMiles" | "publicAreaMapRadiusMiles" | "catalogRefreshDays" | "hasAgentBlockDays" | "incentiveLapseDays" | "dailyVerificationCap" | "phoneLimitPerHour" | "ipLimitPerHour" | "testPhoneLimitPerHour";
type ToggleKey = "allowCanada" | "skipTwilioForTestNumbers" | "testNumbersSkipChecks" | "testModeFullPipeline";
type ListKey = "testNumbers" | "testTeamNumbers" | "activeReelCodes" | "brokerageDomains" | "fubRealtorTags" | "fubRealtorSources" | "handleKeywords" | "trecCounties" | "alertRecipients" | "syncEmailRecipients" | "driveDestinations" | "featuredExcludedBuilders";

const NUMBER_FIELDS: Array<{ key: NumberKey; label: string; min: number; max: number; step?: number }> = [
  { key: "expiryHours", label: "Link expiry (hours)", min: 1, max: 168 },
  { key: "clientLinkExpiryHours", label: "Agent client access (hours)", min: 1, max: 24 * 90 },
  { key: "clientLinkDays", label: "Agent client link valid (days)", min: 1, max: 365 },
  { key: "paymentMarketRate", label: "Best Deals market rate (%)", min: 1, max: 15, step: 0.01 },
  { key: "paymentTaxRate", label: "Best Deals property tax (% of price a year)", min: 0, max: 6, step: 0.01 },
  { key: "paymentInsuranceRate", label: "Best Deals home insurance (% of price a year)", min: 0, max: 5, step: 0.01 },
  { key: "paymentHoaMonthly", label: "Best Deals HOA ($ a month)", min: 0, max: 2000, step: 1 },
  { key: "paymentMortgageInsuranceRate", label: "Best Deals mortgage insurance under 20% down (% of loan a year)", min: 0, max: 3, step: 0.01 },
  { key: "paymentDownPercent", label: "Best Deals default down payment (%)", min: 0, max: 100, step: 0.5 },
  { key: "areaMapRadiusMiles", label: "Area map circle after sign-up (miles)", min: 1, max: 20, step: 0.5 },
  { key: "publicAreaMapRadiusMiles", label: "Area map circle on the public card (miles)", min: 1, max: 20, step: 0.5 },
  { key: "catalogRefreshDays", label: "Check each builder page every (days)", min: 1, max: 30 },
  { key: "hasAgentBlockDays", label: "Has-agent device block (days)", min: 1, max: 400 },
  { key: "incentiveLapseDays", label: "Incentive lapse with no dates (days)", min: 1, max: 90 },
  { key: "dailyVerificationCap", label: "Daily verification cap", min: 1, max: 10000 },
  { key: "phoneLimitPerHour", label: "Codes per phone per hour", min: 1, max: 50 },
  { key: "ipLimitPerHour", label: "Gate submits per IP per hour", min: 1, max: 1000 },
  { key: "testPhoneLimitPerHour", label: "Codes per test phone per hour", min: 1, max: 100 },
];

const TOGGLES: Array<{ key: ToggleKey; label: string; note: string }> = [
  { key: "skipTwilioForTestNumbers", label: "(a) Skip Twilio for test numbers", note: "Test numbers get no real text and the DEALS_TEST_OTP code is accepted. Turn OFF before handover to test real texts." },
  { key: "testNumbersSkipChecks", label: "(b) Test numbers skip realtor checks and limits", note: "Steps 2 to 5 skipped, never written to the blocklist, not counted toward the daily cap. Device blocks from a test session expire after 10 minutes." },
  { key: "testModeFullPipeline", label: "(c) Test mode: full pipeline", note: "Test numbers also run FUB writes, tasks and alert emails, everything tagged TEST." },
  { key: "allowCanada", label: "Allow Canadian numbers", note: "US-only is the default; a bare +1 is never enough." },
];

/** Health result from the on-demand check: attention list, Twilio balance, email transport, holds with ages, render prune counts. */
function HealthPanel({ health }: { health: Health }) {
  const twilio = health.twilioVerify;
  const ops = health.operational;
  const row = (label: string, value: string, warn = false) => <div className="flex justify-between gap-3"><dt>{label}</dt><dd className={`text-right ${warn ? "text-destructive" : "text-foreground"}`}>{value}</dd></div>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Badge variant={health.state === "ok" ? "default" : "destructive"}>{health.state === "ok" ? "All checks OK" : `${health.attention.length} need attention`}</Badge><span>Checked {displayDate(health.checkedAt)}</span></div>
      {health.attention.length > 0 && <ul className="space-y-1">{health.attention.map((item) => <li key={item} className="flex items-start gap-2 text-sm text-destructive"><span aria-hidden="true">-</span><span className="min-w-0 break-words">{item}</span></li>)}</ul>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="border border-border p-3"><p className="text-xs font-medium">Twilio Verify</p><dl className="mt-2 space-y-1 text-xs text-muted-foreground">{row("Credentials", [twilio.accountSid, twilio.authToken, twilio.serviceSid].every((value) => value === "configured") ? "configured" : "missing", ![twilio.accountSid, twilio.authToken, twilio.serviceSid].every((value) => value === "configured"))}{row("Account", twilio.accountStatus ?? twilio.account, twilio.account !== "active")}{row("Balance", twilio.balanceUsd === null ? twilio.balance : `$${twilio.balanceUsd.toFixed(2)}${twilio.currency && twilio.currency !== "USD" ? ` ${twilio.currency}` : ""}`, twilio.balance === "low" || twilio.balance === "unavailable")}</dl></div>
        <div className="border border-border p-3"><p className="text-xs font-medium">Follow Up Boss and email</p><dl className="mt-2 space-y-1 text-xs text-muted-foreground">{row("FUB", health.fub.availability, health.fub.availability !== "available")}{row("Email provider", health.email.provider === "resend" ? "Resend" : "Owner notification fallback", health.email.provider !== "resend")}{row("From address", health.email.fromConfigured ? "configured" : "RESEND_FROM_EMAIL missing", !health.email.fromConfigured)}</dl></div>
        <div className="border border-border p-3"><p className="text-xs font-medium">Operations</p><dl className="mt-2 space-y-1 text-xs text-muted-foreground">{row("TREC file", ops.trecImport.completedAt ? `${ops.trecImport.ageHours ?? "?"}h old` : "never imported", ops.trecImport.state !== "ok")}{row("Builder updates", `${ops.sourceUpdates.staleCommunities} stale, ${ops.sourceUpdates.heldCommunities} held of ${ops.sourceUpdates.activeCommunities}`, ops.sourceUpdates.state !== "ok")}{row("Photo queue", `${ops.photos.pending} pending, ${ops.photos.awaitingRegion} awaiting region, ${ops.photos.failed} failed`, ops.photos.state !== "ok")}{row("Last photo run", ops.photos.lastDrain ? `processed ${ops.photos.lastDrain.processed}${ops.photos.lastDrain.partial ? " (answered early)" : ""}${ops.photos.lastDrain.coalesced ? " (another run busy)" : ""}${ops.photos.lastDrain.msPerPhoto ? `; ~${(ops.photos.lastDrain.msPerPhoto / 1000).toFixed(1)} s per photo` : ""}; ${ops.photos.leaseExpiredLastHour} cut off in the last hour` : "none recorded", ops.photos.leaseExpiredLastHour > 50 || ops.photos.drainStalledMinutes !== null)}{row("FUB writes", `${ops.fubFailures.jobs} failed jobs, ${ops.fubFailures.failingOverAnHour} over an hour`, ops.fubFailures.state !== "ok")}{row("Alert emails failed (24h)", String(ops.emailFailures.failed), ops.emailFailures.state !== "ok")}{row("Scheduled job failures (24h)", ops.jobFailures.failed ? `${ops.jobFailures.failed}: ${ops.jobFailures.jobs.join(", ")}` : "0", ops.jobFailures.state !== "ok")}</dl></div>
        <div className="border border-border p-3"><p className="text-xs font-medium">Holds and cached renders</p>
          {ops.holds.items.length ? <ul className="mt-2 space-y-1 text-xs">{ops.holds.items.map((item, index) => <li key={`${item.kind}-${item.communityId}-${index}`} className="text-destructive">{item.kind === "community" ? "Update hold" : "Incentive hold"}, {item.label}: {item.reason || "no reason recorded"} ({ageLabel(item.ageHours)})</li>)}</ul> : <p className="mt-2 text-xs text-muted-foreground">No holds.</p>}
          <p className="mt-2 text-xs text-muted-foreground">Render prune: {health.renderPrune ? `${health.renderPrune.rowsDeleted} rows and ${health.renderPrune.objectsDeleted} objects deleted, ${health.renderPrune.staleRows} stale, ${health.renderPrune.expiredRows} expired, ${health.renderPrune.objectsFailed} delete failures` : "not run"}.</p>
        </div>
      </div>
    </div>
  );
}

export function SettingsSection({ overview, settings }: { overview: Overview; settings: Settings }) {
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState<Settings>(settings);
  // Keys the admin edited since the last save; only these are sent, so a Save never
  // overwrites what the Team switches or Raise cap changed meanwhile.
  const [touched, setTouched] = useState<Array<keyof Settings>>([]);
  const [seen, setSeen] = useState<Settings>(settings);
  const [confirmCap, setConfirmCap] = useState(false);
  const dirty = touched.length > 0;
  const health = trpc.deals.admin.health.useQuery(undefined, { enabled: false, retry: false });
  const mondayReport = trpc.deals.admin.mondayReport.useQuery(undefined, { enabled: false, retry: false });

  // A refetch (another admin action invalidated settings) never wipes unsaved edits: untouched
  // fields follow the server, the admin's edited fields keep their draft values.
  if (settings !== seen) {
    setSeen(settings);
    setDraft((current) => mergeUntouched(settings, current, touched));
  }

  const save = trpc.deals.admin.saveSettings.useMutation({
    onSuccess: (next) => { setDraft(next); setTouched([]); void utils.deals.admin.settings.invalidate(); void utils.deals.admin.overview.invalidate(); toast.success("Builder Deals settings saved"); },
    onError: (error) => toast.error(error.message || "Could not save the settings"),
  });
  const raiseCap = trpc.deals.admin.raiseDailyVerificationCap.useMutation({
    onSuccess: (next) => { void utils.deals.admin.settings.invalidate(); void utils.deals.admin.overview.invalidate(); setConfirmCap(false); toast.success(`Daily verification cap raised to ${next.dailyVerificationCap.toLocaleString()}`); },
    onError: (error) => toast.error(error.message || "Could not raise the cap"),
  });
  const runFubRetry = trpc.deals.admin.runFubRetry.useMutation({ onSuccess: (result) => { void utils.deals.admin.overview.invalidate(); toast.success(`CRM retry pass complete: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped.`); }, onError: (error) => toast.error(error.message) });
  const runAlerts = trpc.deals.admin.runAlertDelivery.useMutation({ onSuccess: (result) => { void utils.deals.admin.overview.invalidate(); toast.success(`Alert delivery pass complete: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped.`); }, onError: (error) => toast.error(error.message) });

  const update = (patch: Partial<Settings>) => { setDraft((current) => ({ ...current, ...patch })); setTouched((current) => touchedKeys(current, patch)); };
  const submit = () => {
    if (!draft.commentKeyword.trim() || !draft.textLine.trim()) { toast.error("The comment keyword and the text line are required."); return; }
    if (!draft.alertRecipients.length || !draft.syncEmailRecipients.length) { toast.error("Keep at least one alert recipient and one sync email recipient."); return; }
    if (!draft.driveDestinations.length) { toast.error("Keep at least one drive-time destination."); return; }
    save.mutate(touchedPatch({ ...draft, commentKeyword: draft.commentKeyword.trim(), textLine: draft.textLine.trim() }, touched));
  };
  const listField = (key: ListKey, label: string, hint: string, placeholder: string) => <ListField key={key} label={label} value={draft[key]} onChange={(value) => update({ [key]: value } as Partial<Settings>)} placeholder={placeholder} hint={hint} />;
  const capTone = overview.capReached ? "warning" : "gold";
  return (
    <Section
      id="settings"
      title="Settings and health"
      icon={FilePenLine}
      description="Gate copy, limits, test toggles, screening lists and the daily cap. Edits stay in the form until you save, even while other actions refresh the page."
      action={<Button type="button" onClick={submit} disabled={save.isPending || !dirty} className={`${TAP} ${GOLD_BUTTON} w-full sm:w-auto`}><Save className="mr-1 h-4 w-4" />{save.isPending ? "Saving..." : dirty ? "Save settings" : "Settings saved"}</Button>}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Verification sends today" value={overview.dailyCount.toLocaleString()} detail={`Cap ${settings.dailyVerificationCap.toLocaleString()} (test numbers excluded)`} tone={capTone} />
        <Metric label="Cap status" value={overview.capReached ? "Reached" : "Open"} detail={overview.capReached ? "Sends are refused until the cap is raised or the Chicago day rolls over" : `${Math.max(0, settings.dailyVerificationCap - overview.dailyCount).toLocaleString()} left today`} tone={capTone} />
        <div className="border border-border p-4 sm:col-span-2">
          <p className="text-sm font-medium">Raise cap by 1,000</p>
          <label className={`mt-2 flex ${TAP} items-start gap-2 text-sm`}><input type="checkbox" className="mt-0.5 h-5 w-5 accent-[oklch(0.75_0.09_85)]" checked={confirmCap} onChange={(event) => setConfirmCap(event.target.checked)} disabled={raiseCap.isPending} /><span>I understand this immediately raises the daily verification cap to {(settings.dailyVerificationCap + 1000).toLocaleString()}.</span></label>
          <Button type="button" variant="outline" className={`${TAP} mt-2 w-full sm:w-auto`} disabled={!confirmCap || raiseCap.isPending} onClick={() => raiseCap.mutate({ confirm: true })}><Plus className="mr-1 h-4 w-4" /> {raiseCap.isPending ? "Raising..." : "Raise cap by 1,000"}</Button>
        </div>
      </div>

      <div className="mt-5 border border-border p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div><h3 className="font-medium">Health check</h3><p className="mt-1 text-xs text-muted-foreground">The same checks the 7:00 AM Chicago job runs: Twilio credentials, account status and balance, FUB, email transport, TREC age, builder updates, photo queue, FUB writes, failed emails and jobs, holds. Running it here sends no email.</p></div>
          <Button type="button" variant="outline" className={`${TAP} w-full sm:w-auto`} onClick={() => void health.refetch()} disabled={health.isFetching}><HeartPulse className={`mr-1 h-4 w-4 ${health.isFetching ? "animate-spin" : ""}`} /> {health.isFetching ? "Checking..." : "Run health check"}</Button>
        </div>
        {health.isError && <p role="alert" className="mt-3 text-sm text-destructive">The health check could not be completed. Nothing was changed.</p>}
        {health.data && <div className="mt-4"><HealthPanel health={health.data} /></div>}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="border border-border p-3"><p className="text-xs font-medium">Email transport now</p><p className="mt-1 text-xs text-muted-foreground">{overview.email.provider === "resend" ? `Resend, from address configured, ${overview.email.recipients.length} alert recipient${overview.email.recipients.length === 1 ? "" : "s"}.` : "Owner-notification fallback: recipients are NOT emailed."}{overview.email.misconfiguration ? ` ${overview.email.misconfiguration}` : ""}</p></div>
          <div className="border border-border p-3"><p className="text-xs font-medium">CRM retry pass</p><Button type="button" size="sm" variant="outline" className={`${TAP} mt-2 w-full`} disabled={runFubRetry.isPending} onClick={() => runFubRetry.mutate()}><RotateCcw className={`mr-1 h-4 w-4 ${runFubRetry.isPending ? "animate-spin" : ""}`} /> {runFubRetry.isPending ? "Retrying..." : "Run due FUB retries"}</Button></div>
          <div className="border border-border p-3"><p className="text-xs font-medium">Alert delivery</p><Button type="button" size="sm" variant="outline" className={`${TAP} mt-2 w-full`} disabled={runAlerts.isPending} onClick={() => runAlerts.mutate()}><RotateCcw className={`mr-1 h-4 w-4 ${runAlerts.isPending ? "animate-spin" : ""}`} /> {runAlerts.isPending ? "Sending..." : "Send due alerts"}</Button></div>
        </div>
        <div className="mt-4 border border-border p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-medium">Monday System OK report (preview)</p><p className="mt-1 text-xs text-muted-foreground">Generates the report body for review. The scheduled Monday 7:05 AM job sends it by email; this preview does not.</p></div><Button type="button" size="sm" variant="outline" className={`${TAP} w-full sm:w-auto`} onClick={() => void mondayReport.refetch()} disabled={mondayReport.isFetching}>{mondayReport.isFetching ? "Generating..." : "Preview report"}</Button></div>
          {mondayReport.data && <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap border border-border bg-muted/20 p-3 text-xs text-muted-foreground">{mondayReport.data.body}</pre>}
          {mondayReport.isError && <p role="alert" className="mt-3 text-xs text-destructive">The report could not be generated. No message was sent.</p>}
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Field id="builder-deals-keyword" label="Comment keyword" hint="The word buyers comment on a reel and text to the text line. Default HOME.">
          <Input id="builder-deals-keyword" className={inputClass} maxLength={30} value={draft.commentKeyword} onChange={(event) => update({ commentKeyword: event.target.value })} />
        </Field>
        <Field id="builder-deals-text-line" label="Text line" hint="Shown in every blocked, limit and expired message. Default (512) 542-1477.">
          <Input id="builder-deals-text-line" className={inputClass} maxLength={40} value={draft.textLine} onChange={(event) => update({ textLine: event.target.value })} />
        </Field>
        <Field id="builder-deals-alert-mode" label="Unlock and flag alert emails">
          <Select value={draft.alertMode} onValueChange={(value) => update({ alertMode: value as Settings["alertMode"] })}>
            <SelectTrigger id="builder-deals-alert-mode" className={inputClass}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="immediate">Instant (default)</SelectItem><SelectItem value="hourly_digest">Hourly digest</SelectItem></SelectContent>
          </Select>
        </Field>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {NUMBER_FIELDS.map((field) => (
          <Field key={field.key} id={`builder-deals-${field.key}`} label={field.label}>
            <Input id={`builder-deals-${field.key}`} className={inputClass} type="number" inputMode={field.step ? "decimal" : "numeric"} min={field.min} max={field.max} step={field.step ?? 1} value={draft[field.key]} onChange={(event) => update({ [field.key]: Number(event.target.value) } as Partial<Settings>)} />
          </Field>
        ))}
      </div>

      <div className="mt-6 grid gap-3 lg:grid-cols-2">
        {TOGGLES.map((toggle) => <SwitchRow key={toggle.key} id={`builder-deals-${toggle.key}`} label={toggle.label} note={toggle.note} checked={draft[toggle.key]} onCheckedChange={(checked) => update({ [toggle.key]: checked } as Partial<Settings>)} />)}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {listField("testNumbers", "Test numbers", "One number per line; the server normalizes and validates every value. Set the per-number team flag in the Team section.", "(512) 555-0123")}
        {listField("testTeamNumbers", "Test numbers treated as team members", "Also edited by the switches in the Team section.", "(512) 555-0123")}
        {listField("activeReelCodes", "Active reel codes (src)", "Only these codes count in the funnel; anything else lands in other. Seeded sl1 and vg1.", "sl1")}
        {listField("brokerageDomains", "Brokerage email domains", "Google sign-in emails on these domains are blocked and the device blocked for 24 hours.", "exprealty.com")}
        {listField("fubRealtorTags", "FUB realtor tags", "Exact tags, plus any tag starting with Recruit, mark a FUB contact as a licensed agent.", "Recruit - Website")}
        {listField("fubRealtorSources", "FUB realtor sources", "FUB sources that mark a contact as a licensed agent.", "New Agent Inquiry")}
        {listField("handleKeywords", "Instagram handle keywords", "Whole words or clear tokens in the handle or sign-in name set the Possible Agent - Handle flag (never a block).", "realtor")}
        {listField("trecCounties", "TREC counties", "Counties included in the TREC name flag.", "Bexar")}
        {listField("alertRecipients", "Alert email recipients", "Unlock, flag, tour and operational alerts.", "peter@lifestyledesignrealty.com")}
        {listField("syncEmailRecipients", "Builder update email recipients", "Change summaries, holds and incentive expiry notices from every refresh.", "peter@lifestyledesignrealty.com")}
        {listField("featuredExcludedBuilders", "Builders never featured in Best Deals", "Still listed, never ranked in the Best Deals strip. Matches any builder name containing the entry.", "Lennar")}
        {listField("driveDestinations", "Drive-time destinations (up to 8)", "Chips under each area map, measured from the ZIP centroid and rounded to 5 minutes. Re-save a community to recompute its chips.", "downtown San Antonio")}
      </div>
      <p className="mt-4 flex items-center gap-1 text-xs text-muted-foreground">{dirty ? "Unsaved changes." : <><CheckCircle2 className="h-3.5 w-3.5 text-gold" /> Everything shown matches the saved settings.</>}</p>
      {overview.capReached && <div className="mt-3"><Warning>The daily verification cap is reached. Buyers see the traffic message with the keyword and text line until it is raised.</Warning></div>}
    </Section>
  );
}
