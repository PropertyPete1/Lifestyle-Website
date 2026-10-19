import { useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, UserRoundCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog, EmptyRow, Field, GOLD_BUTTON, Section, TAP, Warning, inputClass } from "./shared";
import { displayDate, pageCount } from "./helpers";
import type { Settings, TeamRow } from "./types";

type TeamForm = { name: string; phoneE164: string; email: string };
const EMPTY_TEAM: TeamForm = { name: "", phoneE164: "", email: "" };

/** Inline "enter their number" for a FUB user the mirror imported without a phone. */
function NeedsPhoneRow({ row }: { row: { id: number; name: string | null; email: string | null; fubUserId: string | null } }) {
  const utils = trpc.useUtils();
  const [phone, setPhone] = useState("");
  const add = trpc.deals.admin.addTeamPhone.useMutation({
    onSuccess: () => { void utils.deals.admin.teamNeedsPhone.invalidate(); void utils.deals.admin.identityList.invalidate(); void utils.deals.admin.overview.invalidate(); toast.success(`${row.name || row.email || "Team member"} can now verify with that number.`); },
    onError: (error) => toast.error(error.message || "Could not save the number"),
  });
  const id = `needs-phone-${row.id}`;
  return (
    <li className="flex flex-col gap-2 border border-border p-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 text-sm"><p className="font-medium">{row.name || "Unnamed FUB user"}</p><p className="truncate text-xs text-muted-foreground">{row.email || "no email"}{row.fubUserId ? `, FUB user ${row.fubUserId}` : ""}</p></div>
      <div className="flex gap-2">
        <Field id={id} label="Mobile number" className="flex-1 sm:w-48">
          <Input id={id} className={inputClass} type="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(210) 555-0123" />
        </Field>
        <Button type="button" className={`${TAP} ${GOLD_BUTTON} self-end`} disabled={add.isPending || !phone.trim()} onClick={() => add.mutate({ id: row.id, phoneE164: phone.trim() })}>{add.isPending ? "Saving..." : "Add"}</Button>
      </div>
    </li>
  );
}

export function TeamSection({ settings }: { settings: Settings | undefined }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<TeamForm>(EMPTY_TEAM);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const [toRemove, setToRemove] = useState<TeamRow | null>(null);
  const pageSize = 50;
  const list = trpc.deals.admin.identityList.useQuery({ kind: "team", search: applied, page, pageSize }, { retry: false, refetchOnWindowFocus: false, placeholderData: keepPreviousData });
  const needsPhone = trpc.deals.admin.teamNeedsPhone.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const refresh = () => { void utils.deals.admin.identityList.invalidate(); void utils.deals.admin.teamNeedsPhone.invalidate(); void utils.deals.admin.overview.invalidate(); };
  const addTeam = trpc.deals.admin.addTeam.useMutation({ onSuccess: () => { refresh(); setForm(EMPTY_TEAM); toast.success("Team member added. Any block or known-agent record for them was cleared."); }, onError: (error) => toast.error(error.message || "Could not add the team member") });
  const removeTeam = trpc.deals.admin.removeTeam.useMutation({
    onSuccess: (result) => { refresh(); setToRemove(null); toast.success(`Removed. ${result.revoked} team preview link${result.revoked === 1 ? "" : "s"} revoked; they are back under the normal checks.${result.mirrorWarning ? ` ${result.mirrorWarning}` : ""}`); },
    onError: (error) => toast.error(error.message || "Could not remove the team member"),
  });
  const saveSettings = trpc.deals.admin.saveSettings.useMutation({ onSuccess: () => { void utils.deals.admin.settings.invalidate(); toast.success("Test number team flag saved"); }, onError: (error) => toast.error(error.message || "Could not save the test number flag") });
  const submit = () => {
    if (!form.phoneE164.trim() && !form.email.trim()) { toast.error("Enter a phone or an email for the team member."); return; }
    addTeam.mutate({ name: form.name.trim() || undefined, phoneE164: form.phoneE164.trim() || undefined, email: form.email.trim().toLowerCase() || undefined, source: "manual" });
  };
  const toggleTestTeam = (number: string, team: boolean) => {
    if (!settings) return;
    const current = new Set(settings.testTeamNumbers);
    if (team) current.add(number); else current.delete(number);
    saveSettings.mutate({ testTeamNumbers: Array.from(current) });
  };
  const rows = (list.data?.rows ?? []) as TeamRow[];
  const pages = pageCount(list.data?.total ?? 0, pageSize);
  return (
    <Section id="team" title="Team allowlist" icon={UserRoundCheck} description="Our own agents: mirrored nightly from the FUB users list (source fub) plus anyone added by hand (source manual). Team members still verify by code, then skip every realtor check and create no FUB lead, event, task or alert. Adding someone clears their blocks and known-agent rows; removing them reverses that.">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3 border border-border p-4">
          <p className="font-medium">Add a team member by hand</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="team-name" label="Name"><Input id="team-name" className={inputClass} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
            <Field id="team-phone" label="Mobile number"><Input id="team-phone" className={inputClass} type="tel" inputMode="tel" value={form.phoneE164} onChange={(event) => setForm({ ...form, phoneE164: event.target.value })} placeholder="(210) 555-0123" /></Field>
            <Field id="team-email" label="Email" className="sm:col-span-2"><Input id="team-email" className={inputClass} type="email" inputMode="email" autoComplete="off" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="name@lifestyledesignrealty.com" /></Field>
          </div>
          <Button type="button" className={`${TAP} ${GOLD_BUTTON} w-full sm:w-auto`} disabled={addTeam.isPending} onClick={submit}>{addTeam.isPending ? "Adding..." : "Add team member"}</Button>
        </div>
        <div className="space-y-3 border border-border p-4">
          <p className="font-medium">FUB users with no mobile number</p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">Without a number an agent falls through to the realtor checks and is blocked by their own old recruiting record. Enter it here; the number is stored as a manual row the nightly mirror never touches.</p>
          {needsPhone.isError && <Warning>Could not load the list: {needsPhone.error.message}</Warning>}
          {needsPhone.data?.length ? <ul className="space-y-2">{needsPhone.data.map((row) => <NeedsPhoneRow key={row.id} row={row} />)}</ul> : <p className="text-xs text-muted-foreground">{needsPhone.isLoading ? "Loading..." : "Every mirrored FUB user has a phone on file."}</p>}
        </div>
      </div>

      <div className="mt-5 space-y-3 border border-border p-4">
        <p className="font-medium">Test numbers</p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">Test numbers are checked before the team allowlist and follow the test toggles. "Treat as team member" routes a test number through the team branch while still accepting the test code, so the team path can be tested without texting a real agent. The lists themselves are edited in Settings.</p>
        {settings ? (settings.testNumbers.length ? (
          <ul className="divide-y divide-border border border-border">
            {settings.testNumbers.map((number) => {
              const team = settings.testTeamNumbers.includes(number);
              const id = `test-team-${number.replace(/\D/g, "")}`;
              return (
                <li key={number} className={`flex ${TAP} items-center justify-between gap-3 px-3 py-2`}>
                  <label htmlFor={id} className="flex-1 cursor-pointer text-sm">{number}<span className="block text-[11px] text-muted-foreground">{team ? "Treated as a team member" : "Treated as a buyer"}</span></label>
                  <Switch id={id} checked={team} disabled={saveSettings.isPending} onCheckedChange={(checked) => toggleTestTeam(number, checked)} className="scale-125" />
                </li>
              );
            })}
          </ul>
        ) : <p className="text-xs text-muted-foreground">No test numbers saved. Add them in Settings.</p>) : <p className="text-xs text-muted-foreground">Settings are loading.</p>}
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <Field id="team-search" label="Search the allowlist" className="sm:w-80">
          <div className="flex gap-2">
            <Input id="team-search" className={inputClass} value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { setApplied(search.trim()); setPage(1); } }} placeholder="Name, phone or email" />
            <Button type="button" variant="outline" className={TAP} onClick={() => { setApplied(search.trim()); setPage(1); }} aria-label="Search team"><Search className="h-4 w-4" /></Button>
          </div>
        </Field>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" className={TAP} disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
          <span className="text-xs text-muted-foreground">Page {page} of {pages}</span>
          <Button type="button" variant="outline" className={TAP} disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Next</Button>
        </div>
      </div>
      {list.isError && <Warning>The team list could not be loaded: {list.error.message}</Warning>}
      <div className="mt-3 overflow-x-auto">
        <Table className="min-w-[40rem]">
          <TableHeader><TableRow><TableHead>Team member</TableHead><TableHead>Source</TableHead><TableHead>Added</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((member) => (
              <TableRow key={member.id}>
                <TableCell><p className="font-medium text-sm">{member.name || "Unnamed"}</p><p className="text-xs text-muted-foreground">{[member.phoneE164, member.email].filter(Boolean).join(", ") || "No contact identifier"}{!member.active ? " (inactive)" : ""}</p></TableCell>
                <TableCell><Badge variant="secondary">{member.source === "fub" ? "FUB mirror" : member.source}</Badge></TableCell>
                <TableCell className="whitespace-nowrap text-xs">{displayDate(member.createdAt)}</TableCell>
                <TableCell className="text-right"><Button type="button" size="sm" variant="ghost" className={`${TAP} text-destructive`} onClick={() => setToRemove(member)}>Remove</Button></TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={4}><EmptyRow>{list.isLoading ? "Loading..." : applied ? "No team members match." : "No team allowlist entries."}</EmptyRow></TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      <ConfirmDialog open={toRemove !== null} title="Remove from the team allowlist?" description={`${toRemove?.name || toRemove?.phoneE164 || toRemove?.email || "This person"} goes back under the normal realtor checks, any team preview link they hold is revoked, and their do-not-auto-import entry is dropped.${toRemove?.source === "fub" ? " An active FUB user returns on the next nightly mirror; deactivate them in FUB to remove permanently." : ""}`} confirmLabel="Remove team member" pending={removeTeam.isPending} onCancel={() => setToRemove(null)} onConfirm={() => { if (toRemove) removeTeam.mutate({ id: toRemove.id, confirm: true }); }} />
    </Section>
  );
}
