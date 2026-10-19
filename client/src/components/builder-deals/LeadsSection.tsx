import { useEffect, useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Ban, ExternalLink, RotateCcw, Search, UserRoundCheck, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog, EmptyRow, Field, Section, TAP, inputClass } from "./shared";
import { displayDate, flagValues, fubPersonLink, leadIdFromSearch, pageCount } from "./helpers";
import type { LeadRow, Overview } from "./types";

type StatusFilter = "all" | "verified" | "blocked" | "expired" | "team";
type FubFilter = "all" | "pending" | "synced" | "failed";

function FubLink({ fubPersonId }: { fubPersonId: string | null }) {
  const href = fubPersonLink(fubPersonId);
  if (!href) return <span className="text-xs text-muted-foreground">Not in FUB yet</span>;
  return <a href={href} target="_blank" rel="noreferrer" className={`inline-flex ${TAP} items-center gap-1 text-xs text-gold underline-offset-4 hover:underline`}><ExternalLink className="h-3.5 w-3.5" /> Open in FUB</a>;
}

/** Viewed communities, tour requests with the home named, FUB jobs with a per-job retry. */
export function LeadDetailView({ leadId }: { leadId: number }) {
  const utils = trpc.useUtils();
  const detail = trpc.deals.admin.leadDetail.useQuery({ id: leadId }, { retry: false, refetchOnWindowFocus: false });
  const retry = trpc.deals.admin.retryFub.useMutation({
    onSuccess: (result) => { void utils.deals.admin.leadDetail.invalidate({ id: leadId }); void utils.deals.admin.leads.invalidate(); void utils.deals.admin.overview.invalidate(); toast.success(`CRM retry complete: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped.`); },
    onError: (error) => toast.error(error.message || "Could not retry the FUB job"),
  });
  if (detail.isLoading) return <p className="text-xs text-muted-foreground">Loading lead details...</p>;
  if (detail.isError || !detail.data) return <p role="alert" className="text-xs text-destructive">{detail.error?.message ?? "Lead details could not be loaded."}</p>;
  const { lead, views, tours, jobs } = detail.data;
  return (
    <div className="grid gap-4 text-xs lg:grid-cols-3">
      <div>
        <p className="font-medium text-foreground">Lead #{lead.id}</p>
        <p className="text-muted-foreground">Consent {displayDate(lead.consentAt)} from {lead.consentIp}. Device {lead.deviceHash.slice(0, 8)}... Revoked {displayDate(lead.revokedAt)}.</p>
        <p className="mt-2 font-medium text-foreground">Viewed communities</p>
        {views.length ? <ul className="mt-1 space-y-1">{views.map((view, index) => <li key={`${view.communityId}-${index}`}>{view.publicLabel ?? `Community #${view.communityId}`} at {displayDate(view.viewedAt)}</li>)}</ul> : <p className="text-muted-foreground">None recorded.</p>}
      </div>
      <div>
        <p className="font-medium text-foreground">Tour requests and questions</p>
        {tours.length ? <ul className="mt-1 space-y-1">{tours.map((tour) => <li key={tour.id}>{tour.requestType === "tour" ? "Tour" : "Ask"}: {tour.privateAddress || tour.privatePlanName || "home removed"}, preferred {displayDate(tour.preferredAt)}{tour.fubTaskId ? ", FUB task created" : ", FUB task pending"}</li>)}</ul> : <p className="text-muted-foreground">None yet.</p>}
      </div>
      <div>
        <p className="font-medium text-foreground">FUB jobs</p>
        {jobs.length ? (
          <ul className="mt-1 space-y-2">
            {jobs.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 border border-border p-2">
                <span className="min-w-0"><Badge variant={job.status === "synced" ? "default" : job.status === "failed" ? "destructive" : "secondary"}>{job.status}</Badge> <span className="ml-1">{job.operation.replaceAll("_", " ")}</span>, {job.attempts} attempt{job.attempts === 1 ? "" : "s"}{job.lastError ? <span className="block break-words text-destructive">{job.lastError}</span> : null}</span>
                {job.status === "failed" && <Button type="button" size="sm" variant="outline" className={TAP} disabled={retry.isPending} onClick={() => retry.mutate({ id: job.id })}><RotateCcw className="mr-1 h-3.5 w-3.5" /> Retry</Button>}
              </li>
            ))}
          </ul>
        ) : <p className="text-muted-foreground">No FUB jobs (team previews and blocked leads create none).</p>}
      </div>
    </div>
  );
}

/** "Block and kill link": revokes every live link and adds the lead's identifiers to the permanent blocklist after the confirm. */
function BlockLeadDialog({ leadId, label, onClose }: { leadId: number | null; label: string | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [reason, setReason] = useState("");
  const detail = trpc.deals.admin.leadDetail.useQuery({ id: leadId ?? 0 }, { enabled: leadId !== null && label === null, retry: false });
  const block = trpc.deals.admin.blockLeadAndKillLink.useMutation({
    onSuccess: () => { void utils.deals.admin.leads.invalidate(); void utils.deals.admin.overview.invalidate(); void utils.deals.admin.leadDetail.invalidate(); setReason(""); onClose(); toast.success("Lead blocked and access link revoked"); },
    onError: (error) => toast.error(error.message || "Could not block the lead"),
  });
  const who = label ?? (detail.data ? `${detail.data.lead.name || "Unnamed buyer"}, ${detail.data.lead.phoneE164}` : `Lead #${leadId ?? ""}`);
  return (
    <Dialog open={leadId !== null} onOpenChange={(open) => { if (!open && !block.isPending) { setReason(""); onClose(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Block and kill link</DialogTitle><DialogDescription>This immediately revokes every active Builder Deals link for this lead and adds their phone, email and device to the permanent blocklist.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="border border-destructive/30 bg-destructive/5 p-3 text-sm"><p className="flex items-center gap-2 font-medium text-destructive"><AlertTriangle className="h-4 w-4" /> Nothing changes until you tap Block and kill link.</p><p className="mt-1 break-words text-muted-foreground">{who}</p></div>
          <div className="space-y-1.5"><Label htmlFor="lead-block-reason">Internal reason</Label><Textarea id="lead-block-reason" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Required internal reason (at least 3 characters)" /></div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className={TAP} disabled={block.isPending} onClick={() => { setReason(""); onClose(); }}>Cancel</Button>
          <Button variant="destructive" className={TAP} disabled={block.isPending || reason.trim().length < 3} onClick={() => { if (leadId !== null) block.mutate({ leadId, reason: reason.trim() }); }}><Ban className="mr-1 h-4 w-4" />{block.isPending ? "Blocking..." : "Block and kill link"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function statusVariant(status: string) {
  return status === "verified" ? "default" : status === "blocked" ? "destructive" : "secondary";
}

export function LeadsSection({ overview }: { overview: Overview }) {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [fubStatus, setFubStatus] = useState<FubFilter>("all");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const [leadToBlock, setLeadToBlock] = useState<{ id: number; label: string | null } | null>(null);
  const [leadToMakeTeam, setLeadToMakeTeam] = useState<LeadRow | null>(null);
  const pageSize = 25;
  const leads = trpc.deals.admin.leads.useQuery({ search: applied, status, fubStatus, page, pageSize }, { retry: false, refetchOnWindowFocus: false, placeholderData: keepPreviousData });
  const makeLeadTeam = trpc.deals.admin.makeLeadTeam.useMutation({
    onSuccess: () => { void utils.deals.admin.leads.invalidate(); void utils.deals.admin.overview.invalidate(); setLeadToMakeTeam(null); toast.success("Lead added to team preview"); },
    onError: (error) => toast.error(error.message || "Could not enable team preview"),
  });

  // /admin/deals?lead={id} (from the unlock alert email) opens that lead's details and the Block and kill link dialog.
  useEffect(() => {
    const id = leadIdFromSearch(window.location.search);
    if (id === null) return;
    setPinned(id);
    setExpanded(id);
    setLeadToBlock({ id, label: null });
    const url = new URL(window.location.href);
    url.searchParams.delete("lead");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    window.setTimeout(() => document.getElementById("leads")?.scrollIntoView({ block: "start" }), 50);
  }, []);

  const rows = leads.data?.rows ?? [];
  const total = leads.data?.total ?? 0;
  const pages = pageCount(total, pageSize);
  const counts = overview.leadCounts;
  const applySearch = () => { setApplied(search.trim()); setPage(1); };
  return (
    <Section id="leads" title="Leads" icon={Users} description="Handle, name, phone, status, tags, flags, src, viewed communities, tour requests and FUB sync state. Blocking a lead revokes every current link; team preview changes the lead status and allowlists that identity.">
      <div className="mb-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
        <Badge variant="default">{counts.verified ?? 0} verified</Badge>
        <Badge variant="secondary">{counts.team ?? 0} team</Badge>
        <Badge variant="secondary">{counts.expired ?? 0} expired</Badge>
        <Badge variant="destructive">{counts.blocked ?? 0} blocked</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <Field id="lead-search" label="Search (name, phone, email, handle, src)">
          <div className="flex gap-2">
            <Input id="lead-search" className={inputClass} value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") applySearch(); }} placeholder="+1210 or @handle" />
            <Button type="button" variant="outline" className={TAP} onClick={applySearch} aria-label="Search leads"><Search className="h-4 w-4" /></Button>
          </div>
        </Field>
        <Field id="lead-status" label="Status">
          <Select value={status} onValueChange={(value) => { setStatus(value as StatusFilter); setPage(1); }}>
            <SelectTrigger id="lead-status" className={inputClass}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="verified">Verified</SelectItem><SelectItem value="team">Team</SelectItem><SelectItem value="expired">Expired</SelectItem><SelectItem value="blocked">Blocked</SelectItem></SelectContent>
          </Select>
        </Field>
        <Field id="lead-fub-status" label="FUB sync">
          <Select value={fubStatus} onValueChange={(value) => { setFubStatus(value as FubFilter); setPage(1); }}>
            <SelectTrigger id="lead-fub-status" className={inputClass}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="synced">Synced</SelectItem><SelectItem value="failed">Failed</SelectItem></SelectContent>
          </Select>
        </Field>
        <div className="flex items-end gap-2">
          <Button type="button" variant="outline" className={TAP} disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button>
          <span className="text-xs text-muted-foreground">Page {page} of {pages}</span>
          <Button type="button" variant="outline" className={TAP} disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Next</Button>
        </div>
      </div>
      {pinned !== null && (
        <div className="mt-4 border border-gold/40 bg-gold/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">Lead #{pinned} from the alert link</p><Button type="button" size="sm" variant="ghost" className={TAP} onClick={() => setPinned(null)}>Dismiss</Button></div>
          <div className="mt-3"><LeadDetailView leadId={pinned} /></div>
          <div className="mt-3"><Button type="button" variant="destructive" className={TAP} onClick={() => setLeadToBlock({ id: pinned, label: null })}><Ban className="mr-1 h-3.5 w-3.5" /> Block and kill link</Button></div>
        </div>
      )}
      {leads.isError && <p role="alert" className="mt-4 text-sm text-destructive">Leads could not be loaded: {leads.error.message}</p>}
      <div className="mt-4 overflow-x-auto">
        <Table className="min-w-[64rem]">
          <TableHeader><TableRow><TableHead>Lead</TableHead><TableHead>Contact</TableHead><TableHead>Attribution</TableHead><TableHead>Flags</TableHead><TableHead>Access</TableHead><TableHead>FUB</TableHead><TableHead>Created</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((lead) => {
              const flags = flagValues(lead.flags);
              const label = `${lead.name || "Unnamed buyer"}, ${lead.phoneE164}`;
              return (
                <LeadRows key={lead.id} lead={lead} flags={flags} expanded={expanded === lead.id} onToggle={() => setExpanded(expanded === lead.id ? null : lead.id)} onBlock={() => setLeadToBlock({ id: lead.id, label })} onTeam={() => setLeadToMakeTeam(lead)} />
              );
            })}
            {rows.length === 0 && !leads.isLoading && <TableRow><TableCell colSpan={8}><EmptyRow>{applied || status !== "all" || fubStatus !== "all" ? "No leads match these filters." : "No Builder Deals leads have been recorded."}</EmptyRow></TableCell></TableRow>}
            {leads.isLoading && <TableRow><TableCell colSpan={8}><EmptyRow>Loading leads...</EmptyRow></TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">{total.toLocaleString()} lead{total === 1 ? "" : "s"} match.</p>

      <BlockLeadDialog leadId={leadToBlock?.id ?? null} label={leadToBlock?.label ?? null} onClose={() => setLeadToBlock(null)} />
      <ConfirmDialog
        open={leadToMakeTeam !== null}
        title="Enable team preview"
        description="This changes the verified lead to team status and adds their identifiers to the team allowlist. Team previews never create FUB records, tour requests or alerts."
        confirmLabel="Enable team preview"
        destructive={false}
        pending={makeLeadTeam.isPending}
        onCancel={() => setLeadToMakeTeam(null)}
        onConfirm={() => { if (leadToMakeTeam) makeLeadTeam.mutate({ leadId: leadToMakeTeam.id }); }}
      >
        {leadToMakeTeam && <p className="flex items-center gap-2 border border-gold/30 bg-gold/5 p-3 text-sm"><UserRoundCheck className="h-4 w-4 text-gold" /> {leadToMakeTeam.name || "Unnamed buyer"}, {leadToMakeTeam.phoneE164}</p>}
      </ConfirmDialog>
    </Section>
  );
}

function LeadRows({ lead, flags, expanded, onToggle, onBlock, onTeam }: { lead: LeadRow; flags: string[]; expanded: boolean; onToggle: () => void; onBlock: () => void; onTeam: () => void }) {
  return (
    <>
      <TableRow>
        <TableCell className="align-top"><p className="font-medium">{lead.name || "Unnamed buyer"}</p><p className="text-xs text-muted-foreground">{lead.instagramHandle ? `@${lead.instagramHandle}` : "No Instagram handle"} / #{lead.id}</p></TableCell>
        <TableCell className="align-top text-xs">{lead.phoneE164}<br />{lead.email || "no email"}</TableCell>
        <TableCell className="align-top"><p className="text-xs">src {lead.sourceCode}</p><p className="text-xs text-muted-foreground">{lead.timeline || "No timeline"}</p></TableCell>
        <TableCell className="max-w-56 align-top"><div className="flex flex-wrap gap-1">{flags.length ? flags.map((flag, index) => <Badge key={`${flag}-${index}`} variant="secondary" className="max-w-44 truncate text-[10px]">{flag}</Badge>) : <span className="text-xs text-muted-foreground">None</span>}</div></TableCell>
        <TableCell className="align-top"><Badge variant={statusVariant(lead.status)}>{lead.status}</Badge><p className="mt-1 text-[10px] text-muted-foreground">Expires {displayDate(lead.expiresAt)}</p></TableCell>
        <TableCell className="align-top"><Badge variant={lead.fubStatus === "synced" ? "default" : lead.fubStatus === "failed" ? "destructive" : "secondary"}>{lead.fubStatus}</Badge><div className="mt-1"><FubLink fubPersonId={lead.fubPersonId} /></div></TableCell>
        <TableCell className="whitespace-nowrap align-top text-xs">{displayDate(lead.createdAt)}</TableCell>
        <TableCell className="align-top">
          <div className="flex min-w-44 flex-col gap-2 sm:items-end">
            <Button type="button" size="sm" variant="outline" className={`${TAP} w-full sm:w-auto`} onClick={onToggle}>{expanded ? "Hide details" : "Details"}</Button>
            {lead.status === "verified" && <Button type="button" size="sm" variant="outline" className={`${TAP} w-full sm:w-auto`} onClick={onTeam}><UserRoundCheck className="mr-1 h-3.5 w-3.5" /> Team preview</Button>}
            {lead.status !== "blocked" ? <Button type="button" size="sm" variant="destructive" className={`${TAP} w-full sm:w-auto`} onClick={onBlock}><Ban className="mr-1 h-3.5 w-3.5" /> Block and kill link</Button> : <span className="text-xs text-muted-foreground">Blocked</span>}
          </div>
        </TableCell>
      </TableRow>
      {expanded && <TableRow><TableCell colSpan={8} className="bg-muted/10"><LeadDetailView leadId={lead.id} /></TableCell></TableRow>}
    </>
  );
}
