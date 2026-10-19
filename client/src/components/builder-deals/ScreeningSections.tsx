import { useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, Plus, Search, ShieldAlert, Upload } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog, EmptyRow, Field, GOLD_BUTTON, Section, TAP, Warning, inputClass } from "./shared";
import { displayDate, maskedHash, pageCount } from "./helpers";
import type { Overview } from "./types";

type KnownAgentRow = Overview["agents"][number];
type BlockRow = Overview["blocks"][number];

function SearchBar({ id, label, placeholder, onApply }: { id: string; label: string; placeholder: string; onApply: (value: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <Field id={id} label={label} className="sm:w-80">
      <div className="flex gap-2">
        <Input id={id} className={inputClass} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onApply(value.trim()); }} placeholder={placeholder} />
        <Button type="button" variant="outline" className={TAP} onClick={() => onApply(value.trim())} aria-label={label}><Search className="h-4 w-4" /></Button>
      </div>
    </Field>
  );
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" className={TAP} disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
      <span className="text-xs text-muted-foreground">Page {page} of {pages}</span>
      <Button type="button" variant="outline" className={TAP} disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
    </div>
  );
}

/** Known agents: CSV import, manual add, search, delete; plus the do-not-auto-import list with add and remove. */
export function KnownAgentsSection({ overview }: { overview: Overview }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({ name: "", phoneE164: "", email: "" });
  const [csv, setCsv] = useState("");
  const [csvName, setCsvName] = useState("");
  const [exclusion, setExclusion] = useState({ value: "", kind: "phone" as "phone" | "email" });
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const [toDelete, setToDelete] = useState<KnownAgentRow | null>(null);
  const [exclusionToRemove, setExclusionToRemove] = useState<Overview["doNotAutoImport"][number] | null>(null);
  const pageSize = 50;
  const list = trpc.deals.admin.identityList.useQuery({ kind: "agents", search: applied, page, pageSize }, { retry: false, refetchOnWindowFocus: false, placeholderData: keepPreviousData });
  const refresh = () => { void utils.deals.admin.identityList.invalidate(); void utils.deals.admin.overview.invalidate(); };
  const onError = (error: { message: string }) => toast.error(error.message || "Could not save the screening change");
  const addKnownAgent = trpc.deals.admin.addKnownAgent.useMutation({ onSuccess: () => { refresh(); setForm({ name: "", phoneE164: "", email: "" }); toast.success("Known agent added"); }, onError });
  const importCsv = trpc.deals.admin.importKnownAgentsCsv.useMutation({
    onSuccess: (result) => { refresh(); setCsv(""); setCsvName(""); toast.success(`CSV import complete: ${result.imported} imported, ${result.skipped} skipped, ${result.linksKilled} access link${result.linksKilled === 1 ? "" : "s"} revoked.`); },
    onError,
  });
  const removeKnownAgent = trpc.deals.admin.removeKnownAgent.useMutation({ onSuccess: () => { refresh(); setToDelete(null); toast.success("Known agent deleted and added to do-not-auto-import so the nightly sync does not re-import them."); }, onError });
  const addExclusion = trpc.deals.admin.addDoNotAutoImport.useMutation({ onSuccess: () => { refresh(); setExclusion({ value: "", kind: "phone" }); toast.success("Auto-import exclusion saved"); }, onError });
  const removeExclusion = trpc.deals.admin.removeDoNotAutoImport.useMutation({ onSuccess: () => { refresh(); setExclusionToRemove(null); toast.success("Exclusion removed; the nightly sync may import this value again."); }, onError });
  const readCsv = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2_000_000) { toast.error("CSV files must be 2 MB or smaller."); return; }
    void file.text().then((text) => { setCsv(text); setCsvName(file.name); }).catch(() => toast.error("That CSV could not be read on this device."));
  };
  const rows = (list.data?.rows ?? []) as KnownAgentRow[];
  const pages = pageCount(list.data?.total ?? 0, pageSize);
  return (
    <Section id="known-agents" title="Known agents" icon={ShieldAlert} description="Agents we match by phone or email before any code is sent: a CSV roster import (name, phone, email), the nightly copy of FUB recruiting contacts, and manual entries. An import also kills any live link on the list. Deleting a row adds that value to do-not-auto-import.">
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-3 border border-border p-4">
          <p className="font-medium">Add manually</p>
          <Field id="known-agent-name" label="Name"><Input id="known-agent-name" className={inputClass} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field id="known-agent-phone" label="Phone"><Input id="known-agent-phone" className={inputClass} type="tel" inputMode="tel" value={form.phoneE164} onChange={(event) => setForm({ ...form, phoneE164: event.target.value })} placeholder="(210) 555-0123" /></Field>
          <Field id="known-agent-email" label="Email"><Input id="known-agent-email" className={inputClass} type="email" inputMode="email" autoComplete="off" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="name@example.com" /></Field>
          <Button type="button" variant="outline" className={`${TAP} w-full`} disabled={addKnownAgent.isPending} onClick={() => { if (!form.phoneE164.trim() && !form.email.trim()) { toast.error("Enter a phone or an email."); return; } addKnownAgent.mutate({ name: form.name.trim() || undefined, phoneE164: form.phoneE164.trim() || undefined, email: form.email.trim().toLowerCase() || undefined, source: "manual" }); }}>{addKnownAgent.isPending ? "Adding..." : "Add known agent"}</Button>
        </div>
        <div className="space-y-3 border border-border p-4">
          <p className="font-medium">Import a CSV roster</p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">Headers: name (or full name), phone, email. Up to 2 MB. Rows are normalized server-side and invalid rows are skipped.</p>
          <Field id="known-agent-csv" label="CSV file"><Input id="known-agent-csv" className={inputClass} type="file" accept=".csv,text/csv" onChange={(event) => readCsv(event.target.files?.[0])} /></Field>
          <Field id="known-agent-csv-paste" label="Or paste CSV"><Textarea id="known-agent-csv-paste" rows={3} value={csv} onChange={(event) => { setCsv(event.target.value); setCsvName(""); }} placeholder={"name,phone,email\nJane Doe,+15125550123,jane@example.com"} /></Field>
          {csvName && <p className="text-xs text-muted-foreground">Ready to import: {csvName}</p>}
          <Button type="button" variant="outline" className={`${TAP} w-full`} disabled={importCsv.isPending || csv.trim().length < 2} onClick={() => importCsv.mutate({ csv })}><Upload className="mr-1 h-4 w-4" /> {importCsv.isPending ? "Importing..." : "Import CSV"}</Button>
        </div>
        <div className="space-y-3 border border-border p-4">
          <p className="font-medium">Do not auto-import</p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">The nightly FUB sync and the realtor checks skip these values, so a false positive (a spouse's or referrer's number swept from a recruit's note) is never re-blocked.</p>
          <Field id="do-not-auto-import-kind" label="Type">
            <Select value={exclusion.kind} onValueChange={(kind) => setExclusion({ ...exclusion, kind: kind as "phone" | "email" })}>
              <SelectTrigger id="do-not-auto-import-kind" className={inputClass}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="phone">Phone</SelectItem><SelectItem value="email">Email</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field id="do-not-auto-import-value" label={exclusion.kind === "phone" ? "Phone number" : "Email address"}><Input id="do-not-auto-import-value" className={inputClass} type={exclusion.kind === "email" ? "email" : "tel"} inputMode={exclusion.kind === "email" ? "email" : "tel"} autoComplete="off" value={exclusion.value} onChange={(event) => setExclusion({ ...exclusion, value: event.target.value })} placeholder={exclusion.kind === "email" ? "name@example.com" : "(210) 555-0123"} /></Field>
          <Button type="button" variant="outline" className={`${TAP} w-full`} disabled={addExclusion.isPending || exclusion.value.trim().length < 3} onClick={() => addExclusion.mutate({ value: exclusion.value.trim(), kind: exclusion.kind })}><Plus className="mr-1 h-4 w-4" /> {addExclusion.isPending ? "Saving..." : "Add exclusion"}</Button>
          <ul className="max-h-48 divide-y divide-border overflow-auto border border-border text-xs">
            {overview.doNotAutoImport.map((entry) => <li key={entry.id} className="flex items-center justify-between gap-2 px-3 py-1.5"><span className="min-w-0 truncate font-mono">{entry.value} <Badge variant="secondary" className="ml-1">{entry.kind}</Badge></span><Button type="button" size="sm" variant="ghost" className={`${TAP} text-destructive`} onClick={() => setExclusionToRemove(entry)}>Remove</Button></li>)}
            {overview.doNotAutoImport.length === 0 && <li className="px-3 py-3 text-center text-muted-foreground">No exclusions.</li>}
          </ul>
        </div>
      </div>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <SearchBar id="known-agent-search" label="Search known agents" placeholder="Name, phone or email" onApply={(value) => { setApplied(value); setPage(1); }} />
        <Pager page={page} pages={pages} onPage={setPage} />
      </div>
      {list.isError && <Warning>Known agents could not be loaded: {list.error.message}</Warning>}
      <div className="mt-3 overflow-x-auto">
        <Table className="min-w-[40rem]">
          <TableHeader><TableRow><TableHead>Known agent</TableHead><TableHead>Source</TableHead><TableHead>Added</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((agent) => (
              <TableRow key={agent.id}>
                <TableCell><p className="font-medium text-sm">{agent.name || "Unnamed"}</p><p className="text-xs text-muted-foreground">{[agent.phoneE164, agent.email].filter(Boolean).join(", ") || "No contact identifier"}{!agent.active ? " (inactive)" : ""}</p></TableCell>
                <TableCell><Badge variant="secondary">{agent.source === "fub_recruit" ? "FUB recruit sync" : agent.source}</Badge></TableCell>
                <TableCell className="whitespace-nowrap text-xs">{displayDate(agent.createdAt)}</TableCell>
                <TableCell className="text-right"><Button type="button" size="sm" variant="ghost" className={`${TAP} text-destructive`} onClick={() => setToDelete(agent)}>Delete</Button></TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={4}><EmptyRow>{list.isLoading ? "Loading..." : applied ? "No known agents match." : "No known agents recorded."}</EmptyRow></TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      <ConfirmDialog open={toDelete !== null} title="Delete this known agent?" description={`${toDelete?.name || toDelete?.phoneE164 || toDelete?.email || "This row"} stops matching at the gate, and the value is added to do-not-auto-import so the nightly FUB sync does not bring it back. Existing blocklist rows are not changed.`} confirmLabel="Delete known agent" pending={removeKnownAgent.isPending} onCancel={() => setToDelete(null)} onConfirm={() => { if (toDelete) removeKnownAgent.mutate({ id: toDelete.id, confirm: true }); }} />
      <ConfirmDialog open={exclusionToRemove !== null} title="Remove this exclusion?" description={`${exclusionToRemove?.value ?? "This value"} may be imported again by the nightly FUB sync and matched by the realtor checks.`} confirmLabel="Remove exclusion" pending={removeExclusion.isPending} onCancel={() => setExclusionToRemove(null)} onConfirm={() => { if (exclusionToRemove) removeExclusion.mutate({ id: exclusionToRemove.id, confirm: true }); }} />
    </Section>
  );
}

/** Blocklist: search over phone, email, search_phone (the typed phone from a confirmed Yes) and device, manual add, unblock with confirm. */
export function BlocklistSection({ overview }: { overview: Overview }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({ phone: "", email: "", deviceHash: "", reason: "" });
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const [toUnblock, setToUnblock] = useState<BlockRow | null>(null);
  const pageSize = 50;
  const list = trpc.deals.admin.identityList.useQuery({ kind: "blocks", search: applied, page, pageSize }, { retry: false, refetchOnWindowFocus: false, placeholderData: keepPreviousData });
  const refresh = () => { void utils.deals.admin.identityList.invalidate(); void utils.deals.admin.overview.invalidate(); void utils.deals.admin.leads.invalidate(); };
  const onError = (error: { message: string }) => toast.error(error.message || "Could not update the blocklist");
  const addBlock = trpc.deals.admin.addBlock.useMutation({ onSuccess: () => { refresh(); setForm({ phone: "", email: "", deviceHash: "", reason: "" }); toast.success("Blocklist entry added"); }, onError });
  const unblock = trpc.deals.admin.unblock.useMutation({
    onSuccess: (result) => { refresh(); setToUnblock(null); toast.success(`Unblocked. ${result.fubCleanup.state === "complete" ? "FUB tags and notes cleaned." : result.fubCleanup.state === "failed" ? "FUB cleanup failed; strip the tag in FUB by hand." : "No FUB contact to clean."}`); },
    onError,
  });
  const submit = () => {
    if (!form.phone.trim() && !form.email.trim() && !form.deviceHash.trim()) { toast.error("Add a phone, email, or device hash to block."); return; }
    if (form.reason.trim().length < 3) { toast.error("Give a reason of at least three characters."); return; }
    addBlock.mutate({ phone: form.phone.trim() || undefined, email: form.email.trim().toLowerCase() || undefined, deviceHash: form.deviceHash.trim() || undefined, reason: form.reason.trim() });
  };
  const rows = (list.data?.rows ?? []) as BlockRow[];
  const pages = pageCount(list.data?.total ?? 0, pageSize);
  return (
    <Section id="blocklist" title="Blocklist" icon={Ban} description={`${overview.blockCount.toLocaleString()} active block${overview.blockCount === 1 ? "" : "s"}. A confirmed Yes blocks the device only and stores the typed phone as a search key (never matched). Unblock clears the row, deletes that phone or email from known agents, and adds only the unblocked value to do-not-auto-import.`}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="block-phone" label="Phone"><Input id="block-phone" className={inputClass} type="tel" inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="(210) 555-0123" /></Field>
        <Field id="block-email" label="Email"><Input id="block-email" className={inputClass} type="email" inputMode="email" autoComplete="off" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="name@example.com" /></Field>
        <Field id="block-device" label="Device hash" className="sm:col-span-2"><Input id="block-device" className={inputClass} value={form.deviceHash} onChange={(event) => setForm({ ...form, deviceHash: event.target.value })} placeholder="Optional 64-character device identifier" /></Field>
        <Field id="block-reason" label="Reason" className="sm:col-span-2"><Textarea id="block-reason" rows={2} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Required internal reason" /></Field>
        <Button type="button" className={`${TAP} ${GOLD_BUTTON} sm:col-span-2 sm:w-auto`} disabled={addBlock.isPending} onClick={submit}><Plus className="mr-1 h-4 w-4" />{addBlock.isPending ? "Adding..." : "Add to blocklist"}</Button>
      </div>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <SearchBar id="block-search" label="Search blocks (phone, email, typed phone, device, reason)" placeholder="(210) 555-0123" onApply={(value) => { setApplied(value); setPage(1); }} />
        <Pager page={page} pages={pages} onPage={setPage} />
      </div>
      {list.isError && <Warning>The blocklist could not be loaded: {list.error.message}</Warning>}
      <div className="mt-3 overflow-x-auto">
        <Table className="min-w-[44rem]">
          <TableHeader><TableRow><TableHead>Blocked value</TableHead><TableHead>Typed phone (search key)</TableHead><TableHead>Reason</TableHead><TableHead>Added / expires</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((block) => (
              <TableRow key={block.id}>
                <TableCell className="text-xs">{block.phoneE164 ? <p>Phone {block.phoneE164}</p> : null}{block.email ? <p>Email {block.email}</p> : null}{block.deviceHash ? <p>Device {maskedHash(block.deviceHash)}</p> : null}{!block.phoneE164 && !block.email && !block.deviceHash && <p className="text-muted-foreground">No identifier</p>}</TableCell>
                <TableCell className="text-xs">{block.searchPhone ?? <span className="text-muted-foreground">none</span>}</TableCell>
                <TableCell className="max-w-48 break-words text-xs">{block.reason}</TableCell>
                <TableCell className="whitespace-nowrap text-xs">{displayDate(block.createdAt)}<br />{block.expiresAt ? `expires ${displayDate(block.expiresAt)}` : "permanent"}</TableCell>
                <TableCell className="text-right"><Button type="button" size="sm" variant="ghost" className={`${TAP} text-destructive`} onClick={() => setToUnblock(block)}>Unblock</Button></TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={5}><EmptyRow>{list.isLoading ? "Loading..." : applied ? "No blocks match." : "No active blocks."}</EmptyRow></TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      <ConfirmDialog open={toUnblock !== null} title="Unblock this entry?" description={`${toUnblock?.phoneE164 || toUnblock?.email || (toUnblock?.deviceHash ? "This device" : "This entry")} is removed from the blocklist and from known agents, and only that value is added to do-not-auto-import. Any lead blocked under it is set back to expired so they verify again.`} confirmLabel="Unblock" pending={unblock.isPending} onCancel={() => setToUnblock(null)} onConfirm={() => { if (toUnblock) unblock.mutate({ id: toUnblock.id }); }} />
    </Section>
  );
}
