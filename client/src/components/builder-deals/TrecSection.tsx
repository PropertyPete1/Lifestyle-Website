import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, GOLD_BUTTON, Metric, Section, TAP, inputClass } from "./shared";
import { ageHours, ageLabel, displayDate } from "./helpers";
import type { Overview } from "./types";

/** Latest TREC import: distinct license types and statuses to check against the matching rule, fake-row count, file age, and the fake test row insert. */
export function TrecSection({ overview, counties }: { overview: Overview; counties: readonly string[] }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState(false);
  const add = trpc.deals.admin.addTrecFakeRow.useMutation({
    onSuccess: (result) => { void utils.deals.admin.overview.invalidate(); setName(""); setConfirm(false); toast.success(`Fake TREC row saved: ${result.fullName} (test). It survives the nightly reload.`); },
    onError: (error) => toast.error(error.message || "Could not add the fake TREC row"),
  });
  const summary = overview.trecSummary;
  const current = summary?.import ?? overview.import;
  const hours = ageHours(current?.completedAt ?? null);
  return (
    <Section id="trec" title="TREC license file" icon={CheckCircle2} description="The nightly Texas license download feeds the name flag (never a block). Check the distinct license types and statuses against the matching rule: license_type containing Sales Agent or Broker, status containing Active and not Inactive.">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Latest import" value={current?.completedAt ? ageLabel(hours) : "none"} detail={current?.completedAt ? `${displayDate(current.completedAt)}${hours !== null && hours > 36 ? ", older than 36h" : ""}` : "No import has completed"} tone={hours === null || hours > 36 ? "warning" : "gold"} />
        <Metric label="Rows" value={current?.rowCount?.toLocaleString() ?? "0"} detail={current?.current ? "Current file" : "Not current"} tone="default" />
        <Metric label="Fake test rows" value={summary?.fakeRowCount ?? 0} detail="Matched in every environment, shown as (test)" tone="default" />
        <Metric label="Counties matched" value={counties.length} detail={counties.length ? counties.join(", ") : "Edited in Settings (TREC counties)"} tone="default" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="border border-border p-4">
          <p className="text-sm font-medium">Distinct license types in the file</p>
          <div className="mt-2 flex flex-wrap gap-1">{summary?.licenseTypes.length ? summary.licenseTypes.map((value) => <Badge key={value} variant={/sales\s*agent|broker/i.test(value) ? "default" : "secondary"}>{value}</Badge>) : <span className="text-xs text-muted-foreground">No import yet.</span>}</div>
          <p className="mt-3 text-sm font-medium">Distinct statuses in the file</p>
          <div className="mt-2 flex flex-wrap gap-1">{summary?.statuses.length ? summary.statuses.map((value) => <Badge key={value} variant={/active/i.test(value) && !/inactive/i.test(value) ? "default" : "secondary"}>{value}</Badge>) : <span className="text-xs text-muted-foreground">No import yet.</span>}</div>
          <p className="mt-2 text-[11px] text-muted-foreground">Gold badges are the values the matching rule counts.</p>
        </div>
        <div className="border border-border p-4">
          <p className="text-sm font-medium">Insert a fake TREC test row</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Name only; the system fills license type Sales Agent, status Active, county Bexar. The name must start with TEST, for example TEST JANE BUYER. Enter it later at the name prompt to see the Possible Agent - TREC Name Match flag and the one alert email.</p>
          <Field id="trec-fake-name" label="Full name (TEST first)" className="mt-3">
            <Input id="trec-fake-name" className={inputClass} value={name} onChange={(event) => setName(event.target.value.toUpperCase())} placeholder="TEST JANE BUYER" />
          </Field>
          <label className={`mt-3 flex ${TAP} items-start gap-2 text-sm`}><input type="checkbox" className="mt-0.5 h-5 w-5 accent-[oklch(0.75_0.09_85)]" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} /><span>This is a test fixture; the name must never be a real person.</span></label>
          <Button type="button" className={`${TAP} ${GOLD_BUTTON} mt-3 w-full sm:w-auto`} disabled={!confirm || add.isPending || name.trim().length < 3} onClick={() => add.mutate({ fullName: name.trim(), confirm: true })}>{add.isPending ? "Saving..." : "Insert fake TREC row"}</Button>
        </div>
      </div>
    </Section>
  );
}
