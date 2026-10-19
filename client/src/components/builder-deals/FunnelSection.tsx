import { useState } from "react";
import { BarChart3 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyRow, Field, Section, Warning, inputClass } from "./shared";
import { FUNNEL_COLUMNS, funnelTable } from "./helpers";

/** Funnel counts per reel code (src) in gate order; an unknown src is bucketed as "other" by the server. */
export function FunnelSection({ activeReelCodes }: { activeReelCodes: readonly string[] }) {
  const [days, setDays] = useState("30");
  const funnel = trpc.deals.admin.funnel.useQuery({ days: Number(days) }, { retry: false, refetchOnWindowFocus: false });
  const rows = funnelTable(funnel.data ?? []);
  return (
    <Section
      id="funnel"
      title="Funnel by reel code"
      icon={BarChart3}
      description="Landed counts once per device per hour and excludes crawlers. Active reel codes are edited in Settings; anything else lands in other."
      action={
        <Field id="funnel-days" label="Window" className="sm:w-44">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger id="funnel-days" className={inputClass}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="7">Last 7 days</SelectItem><SelectItem value="30">Last 30 days</SelectItem><SelectItem value="90">Last 90 days</SelectItem><SelectItem value="365">Last year</SelectItem></SelectContent>
          </Select>
        </Field>
      }
    >
      <p className="mb-3 text-xs text-muted-foreground">Active reel codes: {activeReelCodes.length ? activeReelCodes.join(", ") : "none"}.</p>
      {funnel.isError && <Warning>Funnel stats could not be loaded: {funnel.error.message}</Warning>}
      <div className="overflow-x-auto">
        <Table className="min-w-[56rem]">
          <TableHeader><TableRow><TableHead>Reel code</TableHead>{FUNNEL_COLUMNS.map((column) => <TableHead key={column.kind} className="text-right">{column.label}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {rows.map((row) => <TableRow key={row.sourceCode}><TableCell className="font-medium">{row.sourceCode}</TableCell>{row.cells.map((cell, index) => <TableCell key={FUNNEL_COLUMNS[index].kind} className="text-right tabular-nums">{cell.toLocaleString()}</TableCell>)}</TableRow>)}
            {rows.length === 0 && <TableRow><TableCell colSpan={FUNNEL_COLUMNS.length + 1}><EmptyRow>{funnel.isLoading ? "Loading funnel..." : "No funnel events in this window."}</EmptyRow></TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </Section>
  );
}
