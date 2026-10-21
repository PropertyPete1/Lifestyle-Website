import { useState } from "react";
import { toast } from "sonner";
import { Copy, KeyRound, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyRow, Field, GOLD_BUTTON, Section, TAP, Warning, inputClass } from "./shared";
import { displayDate } from "./helpers";

/**
 * Supplied imports (docs/builder-deals-supplied-import.md): a builder whose site
 * refuses our reader can be fed by the owner's own browser agent. Generating a
 * key switches the builder to imports; the key is shown once and only its hash
 * is stored. Revoking switches the builder back to being read from its site.
 */
export function SuppliedImportSection() {
  const utils = trpc.useUtils();
  const overview = trpc.deals.admin.suppliedImports.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const builders = trpc.deals.admin.builders.useQuery(undefined, { retry: false, refetchOnWindowFocus: false, staleTime: Number.POSITIVE_INFINITY });
  const [builder, setBuilder] = useState("Legend Homes");
  const [shown, setShown] = useState<{ builder: string; key: string } | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const generate = trpc.deals.admin.generateImportKey.useMutation({
    onSuccess: (result) => { setShown({ builder: result.builder, key: result.key }); void utils.deals.admin.suppliedImports.invalidate(); toast.success(`Import key created for ${result.builder}. Copy it now: it is not shown again.`); },
    onError: (error) => toast.error(error.message || "Could not create the key"),
  });
  const revoke = trpc.deals.admin.revokeImportKey.useMutation({
    onSuccess: (_result, input) => { setConfirmRevoke(null); if (shown?.builder === input.builder) setShown(null); void utils.deals.admin.suppliedImports.invalidate(); toast.success(`Import key revoked for ${input.builder}. Its communities are read from the builder's site again.`); },
    onError: (error) => toast.error(error.message || "Could not revoke the key"),
  });
  const choices = (builders.data ?? []).filter((entry) => !entry.manual);
  const existing = new Set((overview.data ?? []).map((entry) => entry.builder));
  const copy = (value: string) => { void navigator.clipboard?.writeText(value).then(() => toast.success("Copied"), () => toast.error("Copy failed; select the text and copy it by hand")); };
  return (
    <Section id="supplied-imports" title="Supplied imports" icon={KeyRound} description="For a builder whose site refuses our reader: the owner's browser agent posts what it sees to /api/deals/import with this builder's key, and the normal update rules (holds, sold homes, price drops, incentive checks, name scrubbing) apply to it. Generating a key switches the builder to imports; revoking switches it back.">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <Field id="supplied-import-builder" label="Builder">
          <Select value={builder} onValueChange={setBuilder}>
            <SelectTrigger id="supplied-import-builder" className={inputClass}><SelectValue /></SelectTrigger>
            <SelectContent>{choices.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Button type="button" className={`${TAP} ${GOLD_BUTTON} w-full sm:w-auto`} disabled={generate.isPending || !builder} onClick={() => generate.mutate({ builder })}><KeyRound className="mr-1 h-4 w-4" />{generate.isPending ? "Creating..." : existing.has(builder) ? "Regenerate import key" : "Generate import key"}</Button>
      </div>
      {existing.has(builder) && <p className="mt-2 text-xs text-muted-foreground">Regenerating replaces the current key at once: the agent must be given the new one.</p>}
      {shown && (
        <div className="mt-4 space-y-2 border border-gold/50 p-3">
          <p className="text-sm font-medium">Import key for {shown.builder}</p>
          <div className="flex flex-col gap-2 sm:flex-row"><Input readOnly aria-label="Import key" className={`${inputClass} font-mono`} value={shown.key} onFocus={(event) => event.currentTarget.select()} /><Button type="button" variant="outline" className={`${TAP} w-full sm:w-auto`} onClick={() => copy(shown.key)}><Copy className="mr-1 h-4 w-4" /> Copy</Button></div>
          <Warning>Shown once. Only its fingerprint is stored, so it cannot be shown again; if it is lost, regenerate. Give it only to the agent, as the header Authorization: Bearer followed by the key.</Warning>
          <Button type="button" variant="ghost" size="sm" className={TAP} onClick={() => setShown(null)}>I have copied it, hide it</Button>
        </div>
      )}
      <div className="mt-5 space-y-4">
        {overview.isError && <Warning>Supplied imports could not be loaded.</Warning>}
        {overview.data && !overview.data.length && <EmptyRow>No builder takes imports. Every community is read from its builder's site.</EmptyRow>}
        {(overview.data ?? []).map((entry) => (
          <div key={entry.builder} className="border border-border p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0"><p className="font-medium">{entry.builder}</p><p className="text-xs text-muted-foreground">Key created {displayDate(entry.keyCreatedAt)}. Pages on {entry.host ?? "?"}.</p></div>
              {confirmRevoke === entry.builder
                ? <div className="flex flex-col gap-2 sm:flex-row"><Button type="button" variant="destructive" className={`${TAP} w-full sm:w-auto`} disabled={revoke.isPending} onClick={() => revoke.mutate({ builder: entry.builder, confirm: true })}>{revoke.isPending ? "Revoking..." : "Yes, revoke"}</Button><Button type="button" variant="outline" className={`${TAP} w-full sm:w-auto`} onClick={() => setConfirmRevoke(null)}>Keep</Button></div>
                : <Button type="button" variant="outline" className={`${TAP} w-full sm:w-auto`} onClick={() => setConfirmRevoke(entry.builder)}><Trash2 className="mr-1 h-4 w-4" /> Revoke</Button>}
            </div>
            {entry.communities.length ? (
              <ul className="mt-3 space-y-2">
                {entry.communities.map((community) => (
                  <li key={community.id} className="border-t border-border pt-2 text-xs">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                      <span className="font-medium text-foreground">{community.privateName}{community.manualMode ? " (Manual mode: imports are not used)" : community.paused ? " (paused)" : !community.active ? " (archived)" : ""}</span>
                      <span className={community.lastCapturedAt ? "text-muted-foreground" : "text-destructive"}>{community.lastCapturedAt ? `Last import captured ${displayDate(community.lastCapturedAt)}` : "No import yet"}</span>
                    </div>
                    <button type="button" className="mt-1 block max-w-full break-all text-left text-muted-foreground underline-offset-2 hover:underline" onClick={() => copy(community.sourceUrl)}>{community.sourceUrl}</button>
                    {community.catalogHoldReason && !community.catalogHoldReason.startsWith("dismissed:") && <p className="mt-1 text-destructive">Hold: {community.catalogHoldReason}</p>}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-xs text-muted-foreground">No communities for this builder yet; add them in Communities first (imports never create one).</p>}
          </div>
        ))}
      </div>
    </Section>
  );
}
