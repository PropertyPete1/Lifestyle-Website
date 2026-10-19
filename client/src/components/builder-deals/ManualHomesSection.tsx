import { useRef, useState } from "react";
import { toast } from "sonner";
import { Home, Plus, Upload } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog, EmptyRow, Field, GOLD_BUTTON, Section, TAP, inputClass } from "./shared";
import { browserDataUrlReader, formatMoney, optionalInteger, readPhotoFile } from "./helpers";
import type { HomeRow, Overview } from "./types";

type ManualHomeDraft = {
  id?: number;
  communityId: string;
  sourceUrl: string;
  privateAddress: string;
  privatePlanName: string;
  kind: "quick_move_in" | "to_be_built";
  status: "available" | "sold";
  beds: string;
  baths: string;
  sqft: string;
  price: string;
  moveInDate: string;
  lotSize: string;
};

const EMPTY: ManualHomeDraft = { communityId: "", sourceUrl: "", privateAddress: "", privatePlanName: "", kind: "quick_move_in", status: "available", beds: "", baths: "", sqft: "", price: "", moveInDate: "", lotSize: "" };

function draftFromHome(home: HomeRow): ManualHomeDraft {
  return {
    id: home.id, communityId: String(home.communityId), sourceUrl: home.sourceUrl.startsWith("manual:") ? "" : home.sourceUrl, privateAddress: home.privateAddress ?? "", privatePlanName: home.privatePlanName ?? "",
    kind: home.kind, status: home.status === "sold" ? "sold" : "available", beds: home.beds ?? "", baths: home.baths ?? "", sqft: home.sqft === null ? "" : String(home.sqft), price: home.price === null ? "" : String(home.price),
    moveInDate: home.moveInDate ?? "", lotSize: home.lotSize ?? "",
  };
}

/** One file input per manual home: the photo is read on the device, capped at 8 MB, and enters the pipeline at step 1. */
function PhotoUpload({ homeId }: { homeId: number }) {
  const utils = trpc.useUtils();
  const inputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const upload = trpc.deals.admin.uploadHomePhoto.useMutation({
    onSuccess: (result) => { void utils.deals.admin.overview.invalidate(); void utils.deals.admin.builderPhotoSettings.invalidate(); toast.success(`Photo #${result.id} uploaded (${result.width}x${result.height}). It is served once processed.`); },
    onError: (error) => toast.error(error.message || "The photo could not be uploaded"),
  });
  const pick = (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    readPhotoFile(file, browserDataUrlReader())
      .then(({ base64, contentType }) => upload.mutate({ homeId, base64, contentType }))
      .catch((error: Error) => toast.error(error.message))
      .finally(() => { setReading(false); if (inputRef.current) inputRef.current.value = ""; });
  };
  const busy = reading || upload.isPending;
  return (
    <div className="flex items-center gap-2">
      <input ref={inputRef} id={`home-photo-${homeId}`} type="file" accept="image/*" className="sr-only" onChange={(event) => pick(event.target.files?.[0])} disabled={busy} />
      <Button type="button" size="sm" variant="outline" className={TAP} disabled={busy} onClick={() => inputRef.current?.click()}><Upload className="mr-1 h-3.5 w-3.5" /> {busy ? "Uploading..." : "Add photo"}</Button>
    </div>
  );
}

export function ManualHomesSection({ overview }: { overview: Overview }) {
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState<ManualHomeDraft>(EMPTY);
  const [toDelete, setToDelete] = useState<HomeRow | null>(null);
  const refresh = () => { void utils.deals.admin.overview.invalidate(); void utils.deals.admin.communityDiagnostics.invalidate(); };
  const save = trpc.deals.admin.addManualHome.useMutation({
    onSuccess: () => { refresh(); toast.success(draft.id ? "Manual home updated" : "Manual home added"); setDraft(EMPTY); },
    onError: (error) => toast.error(error.message || "Could not save the manual home"),
  });
  const remove = trpc.deals.admin.removeManualHome.useMutation({
    onSuccess: () => { refresh(); setToDelete(null); toast.success("Manual home removed from the catalog"); },
    onError: (error) => toast.error(error.message || "Could not remove the manual home"),
  });
  const set = (patch: Partial<ManualHomeDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const submit = () => {
    const communityId = Number(draft.communityId);
    if (!communityId) { toast.error("Choose a community."); return; }
    if (draft.sourceUrl.trim()) { try { new URL(draft.sourceUrl.trim()); } catch { toast.error("Enter a complete source URL, including https://, or leave it blank."); return; } }
    const sqft = optionalInteger(draft.sqft);
    const price = optionalInteger(draft.price);
    if (Number.isNaN(sqft) || Number.isNaN(price)) { toast.error("Square feet and price must be whole, non-negative numbers."); return; }
    save.mutate({
      id: draft.id, communityId, sourceUrl: draft.sourceUrl.trim() || undefined, privateAddress: draft.privateAddress.trim() || undefined, privatePlanName: draft.privatePlanName.trim() || undefined,
      kind: draft.kind, status: draft.status, beds: draft.beds.trim() || undefined, baths: draft.baths.trim() || undefined, sqft, price, moveInDate: draft.moveInDate.trim() || undefined, lotSize: draft.lotSize.trim() || undefined,
    });
  };
  const manualHomes = overview.homes.filter((home) => home.origin === "manual" && home.status !== "hidden");
  const photoCount = (homeId: number) => overview.photos.filter((photo) => photo.homeId === homeId).length;
  const communityLabel = (communityId: number) => overview.communities.find((community) => community.id === communityId)?.publicLabel ?? `Community #${communityId}`;
  return (
    <Section id="manual-homes" title="Manual homes" icon={Home} description="Add and edit homes by hand so the page stays fully runnable if a scraper is ever blocked: photos, beds, baths, square feet, price, move-in date, lot size, and the available/sold switch. Private address and plan name never reach buyers.">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="manual-home-community" label="Community">
          <Select value={draft.communityId} onValueChange={(communityId) => set({ communityId })}>
            <SelectTrigger id="manual-home-community" className={inputClass}><SelectValue placeholder="Choose community" /></SelectTrigger>
            <SelectContent>{overview.communities.map((community) => <SelectItem key={community.id} value={String(community.id)}>{community.publicLabel}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field id="manual-home-kind" label="Card type">
          <Select value={draft.kind} onValueChange={(kind) => set({ kind: kind as ManualHomeDraft["kind"] })}>
            <SelectTrigger id="manual-home-kind" className={inputClass}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="quick_move_in">Available now (quick move-in)</SelectItem><SelectItem value="to_be_built">To be built (floor plan)</SelectItem></SelectContent>
          </Select>
        </Field>
        <Field id="manual-home-status" label="Availability">
          <Select value={draft.status} onValueChange={(status) => set({ status: status as ManualHomeDraft["status"] })}>
            <SelectTrigger id="manual-home-status" className={inputClass}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="available">Available</SelectItem><SelectItem value="sold">Sold (off the page, kept in history)</SelectItem></SelectContent>
          </Select>
        </Field>
        <Field id="manual-home-source-url" label="Builder listing URL (optional, private)">
          <Input id="manual-home-source-url" className={inputClass} type="url" inputMode="url" value={draft.sourceUrl} onChange={(event) => set({ sourceUrl: event.target.value })} placeholder="https://" />
        </Field>
        <Field id="manual-home-address" label="Private address"><Input id="manual-home-address" className={inputClass} value={draft.privateAddress} onChange={(event) => set({ privateAddress: event.target.value })} /></Field>
        <Field id="manual-home-plan" label="Private plan name"><Input id="manual-home-plan" className={inputClass} value={draft.privatePlanName} onChange={(event) => set({ privatePlanName: event.target.value })} /></Field>
        <Field id="manual-home-beds" label="Beds"><Input id="manual-home-beds" className={inputClass} inputMode="decimal" value={draft.beds} onChange={(event) => set({ beds: event.target.value })} placeholder="4" /></Field>
        <Field id="manual-home-baths" label="Baths"><Input id="manual-home-baths" className={inputClass} inputMode="decimal" value={draft.baths} onChange={(event) => set({ baths: event.target.value })} placeholder="3.5" /></Field>
        <Field id="manual-home-sqft" label="Square feet"><Input id="manual-home-sqft" className={inputClass} type="number" inputMode="numeric" min={0} value={draft.sqft} onChange={(event) => set({ sqft: event.target.value })} /></Field>
        <Field id="manual-home-price" label="Price (USD)"><Input id="manual-home-price" className={inputClass} type="number" inputMode="numeric" min={0} value={draft.price} onChange={(event) => set({ price: event.target.value })} /></Field>
        <Field id="manual-home-move-in" label="Est. move-in"><Input id="manual-home-move-in" className={inputClass} value={draft.moveInDate} onChange={(event) => set({ moveInDate: event.target.value })} placeholder="December 2026" /></Field>
        <Field id="manual-home-lot" label="Lot size"><Input id="manual-home-lot" className={inputClass} value={draft.lotSize} onChange={(event) => set({ lotSize: event.target.value })} placeholder="Half acre" /></Field>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button type="button" className={`${TAP} ${GOLD_BUTTON} w-full sm:w-auto`} disabled={save.isPending} onClick={submit}><Plus className="mr-1 h-4 w-4" />{save.isPending ? "Saving..." : draft.id ? `Save changes to home #${draft.id}` : "Add manual home"}</Button>
        {draft.id && <Button type="button" variant="outline" className={`${TAP} w-full sm:w-auto`} onClick={() => setDraft(EMPTY)}>Cancel edit</Button>}
      </div>
      <div className="mt-6 overflow-x-auto">
        <Table className="min-w-[48rem]">
          <TableHeader><TableRow><TableHead>Home (private)</TableHead><TableHead>Community</TableHead><TableHead>Details</TableHead><TableHead>Status</TableHead><TableHead>Photos</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {manualHomes.map((home) => (
              <TableRow key={home.id}>
                <TableCell className="align-top"><p className="font-medium">{home.privateAddress || "No address"}</p><p className="text-xs text-muted-foreground">{home.privatePlanName || "No plan name"} / #{home.id}</p></TableCell>
                <TableCell className="align-top text-xs">{communityLabel(home.communityId)}</TableCell>
                <TableCell className="align-top text-xs"><p>{home.kind === "to_be_built" ? "To be built" : "Available now"}, {formatMoney(home.price)}</p><p className="text-muted-foreground">{[home.beds && `${home.beds} bd`, home.baths && `${home.baths} ba`, home.sqft && `${home.sqft.toLocaleString()} sq ft`, home.moveInDate && `move-in ${home.moveInDate}`, home.lotSize && `lot ${home.lotSize}`].filter(Boolean).join(", ") || "no details"}</p></TableCell>
                <TableCell className="align-top"><Badge variant={home.status === "available" ? "default" : "secondary"}>{home.status}</Badge></TableCell>
                <TableCell className="align-top"><p className="text-xs">{photoCount(home.id)} stored</p><div className="mt-1"><PhotoUpload homeId={home.id} /></div></TableCell>
                <TableCell className="align-top text-right">
                  <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:justify-end">
                    <Button type="button" size="sm" variant="outline" className={TAP} onClick={() => { setDraft(draftFromHome(home)); document.getElementById("manual-home-community")?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>Edit</Button>
                    <Button type="button" size="sm" variant="destructive" className={TAP} onClick={() => setToDelete(home)}>Delete</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {manualHomes.length === 0 && <TableRow><TableCell colSpan={6}><EmptyRow>No manually entered homes yet.</EmptyRow></TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      <ConfirmDialog open={toDelete !== null} title="Delete this manual home?" description={`${toDelete?.privateAddress || toDelete?.privatePlanName || `Home #${toDelete?.id ?? ""}`} leaves the buyer page immediately. Its photos stay stored privately and its request history is kept.`} confirmLabel="Delete home" pending={remove.isPending} onCancel={() => setToDelete(null)} onConfirm={() => { if (toDelete) remove.mutate({ id: toDelete.id, confirm: true }); }} />
    </Section>
  );
}
