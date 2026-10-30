import { useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { ExternalLink, Mail, Search } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyRow, Section, TAP, inputClass } from "./shared";
import { displayDate, pageCount } from "./helpers";

const PAGE_SIZE = 25;

/**
 * Oct 30, 2026 (Peter: "a page on our end that sees who they are"): everyone who signed up for first dibs on the
 * public page. Email and area only; once they add a number through the sign-up they also show under Leads.
 */
export function FirstDibsSection() {
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const list = trpc.deals.admin.firstDibs.useQuery({ search: applied, page, pageSize: PAGE_SIZE }, { placeholderData: keepPreviousData });
  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const pages = pageCount(total, PAGE_SIZE);
  return <Section id="first-dibs" title="First dibs sign-ups" description="Email and area only, from the public page. They get the area's homes right away and then weekly when there are new homes or price drops. Every email asks them to add their number." icon={Mail}>
    <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); setApplied(search.trim()); setPage(1); }}>
      <Input aria-label="Search first-dibs emails" placeholder="Search email" value={search} onChange={(event) => setSearch(event.target.value)} className={`${inputClass} max-w-xs`} />
      <Button type="submit" variant="outline" className={TAP}><Search className="mr-1 h-4 w-4" /> Search</Button>
    </form>
    {list.isError && <p role="alert" className="mt-4 text-sm text-destructive">First-dibs sign-ups could not be loaded: {list.error.message}</p>}
    <div className="mt-4 overflow-x-auto">
      <Table className="min-w-[44rem]">
        <TableHeader><TableRow><TableHead>Email</TableHead><TableHead>Area</TableHead><TableHead>Status</TableHead><TableHead>Signed up</TableHead><TableHead>Last emailed</TableHead><TableHead>FUB</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.map((row) => <TableRow key={row.id} data-first-dibs-row={row.id}>
            <TableCell className="font-medium">{row.email}</TableCell>
            <TableCell>{row.area || "Any area"}</TableCell>
            <TableCell><Badge variant={row.status === "active" ? "default" : "secondary"}>{row.status === "active" ? "Getting emails" : "Unsubscribed"}</Badge></TableCell>
            <TableCell className="text-xs">{displayDate(row.createdAt)}</TableCell>
            <TableCell className="text-xs">{row.lastEmailedAt ? displayDate(row.lastEmailedAt) : "Not yet"}</TableCell>
            <TableCell>{row.fubUrl ? <a href={row.fubUrl} target="_blank" rel="noreferrer" className={`inline-flex ${TAP} items-center gap-1 text-xs text-gold underline-offset-4 hover:underline`}><ExternalLink className="h-3.5 w-3.5" /> Open in FUB</a> : <span className="text-xs text-muted-foreground">Not in FUB yet</span>}</TableCell>
          </TableRow>)}
          {rows.length === 0 && !list.isLoading && <TableRow><TableCell colSpan={6}><EmptyRow>{applied ? "No sign-ups match." : "No first-dibs sign-ups yet."}</EmptyRow></TableCell></TableRow>}
          {list.isLoading && <TableRow><TableCell colSpan={6}><EmptyRow>Loading sign-ups...</EmptyRow></TableCell></TableRow>}
        </TableBody>
      </Table>
    </div>
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
      <p>{total.toLocaleString()} sign-up{total === 1 ? "" : "s"}.</p>
      {pages > 1 && <div className="flex items-center gap-2"><Button type="button" variant="ghost" className={TAP} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page} of {pages}</span><Button type="button" variant="ghost" className={TAP} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div>}
    </div>
  </Section>;
}
