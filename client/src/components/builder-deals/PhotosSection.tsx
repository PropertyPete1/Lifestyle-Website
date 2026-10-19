import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Image, RotateCcw, ShieldAlert } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyRow, Field, GOLD_BUTTON, ListField, Metric, Section, SwitchRow, TAP, Warning, inputClass } from "./shared";
import { displayDate, ocrMatchTerms, parseRegionDraft, photoStateLabel, regionOverlayStyle, regionToDraft, sourceHost, type PhotoRegion, type RegionDraft } from "./helpers";
import type { BuilderPhotoSettingsView, Overview, PhotoRow } from "./types";

const PRESETS: Array<{ label: string; region: PhotoRegion }> = [
  { label: "Bottom band 12%", region: { x: 0, y: 88, width: 100, height: 12 } },
  { label: "Top band 12%", region: { x: 0, y: 0, width: 100, height: 12 } },
  { label: "Bottom-right corner", region: { x: 65, y: 85, width: 35, height: 15 } },
  { label: "Bottom-left corner", region: { x: 0, y: 85, width: 35, height: 15 } },
];

/** Up to 5 stored originals with the region rectangle drawn over them so the admin sees what will be covered. */
function RegionSamples({ builder, region }: { builder: string; region: PhotoRegion | null }) {
  const samples = trpc.deals.admin.builderPhotoSamples.useQuery({ builder }, { retry: false, refetchOnWindowFocus: false, staleTime: 60_000 });
  if (samples.isLoading) return <p className="text-xs text-muted-foreground">Loading sample photos...</p>;
  if (samples.isError) return <Warning>Sample photos could not be loaded: {samples.error.message}</Warning>;
  if (!samples.data?.length) return <p className="text-xs text-muted-foreground">No stored originals for this builder yet. Samples appear after the first import (photos park at awaiting region until you save one).</p>;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {samples.data.map((sample) => (
        <figure key={sample.photoId} className="min-w-0">
          <div className="relative overflow-hidden border border-border bg-black/40">
            <img src={sample.dataUrl} alt={`Sample photo ${sample.photoId}`} className="block h-auto w-full select-none" draggable={false} />
            {region && <div aria-hidden="true" className="pointer-events-none absolute border-2 border-gold bg-gold/35" style={regionOverlayStyle(region)} />}
          </div>
          <figcaption className="mt-1 truncate text-[10px] text-muted-foreground">Photo #{sample.photoId}, {sample.width}x{sample.height}</figcaption>
        </figure>
      ))}
    </div>
  );
}

/** Per-builder watermark card: toggle, four percent inputs, sample overlay, keyword list, Save and reprocess. */
function BuilderPhotoCard({ view }: { view: BuilderPhotoSettingsView }) {
  const utils = trpc.useUtils();
  const [enabled, setEnabled] = useState(view.enabled);
  const [region, setRegion] = useState<RegionDraft>(() => regionToDraft(view.region));
  const [keywords, setKeywords] = useState<string[]>(view.keywords);
  const [showSamples, setShowSamples] = useState(view.needsRegion);
  const prefix = `builder-photo-${view.builder.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  const refresh = () => { void utils.deals.admin.builderPhotoSettings.invalidate(); void utils.deals.admin.overview.invalidate(); };
  const onError = (error: { message: string }) => toast.error(error.message || "Could not save the builder photo settings");
  const reprocess = trpc.deals.admin.reprocessBuilderPhotos.useMutation({ onSuccess: (result) => { refresh(); toast.success(`${result.requeued} photo${result.requeued === 1 ? "" : "s"} queued for reprocessing.`); }, onError });
  const save = trpc.deals.admin.saveBuilderPhotoSettings.useMutation({
    onSuccess: (result) => {
      refresh();
      if (result.changed) toast.success(`Settings saved. ${result.requeued} photo${result.requeued === 1 ? "" : "s"} queued for reprocessing.`);
      else reprocess.mutate({ builder: view.builder });
    },
    onError,
  });
  const parsed = parseRegionDraft(region);
  const previewRegion = "region" in parsed ? parsed.region : null;
  const submit = () => {
    if ("error" in parsed) { toast.error(parsed.error); return; }
    if (enabled && !parsed.region && !window.confirm("No region is set: every photo of this builder parks at awaiting region until one is saved. Save anyway?")) return;
    save.mutate({ builder: view.builder, enabled, region: parsed.region, keywords });
  };
  const pending = save.isPending || reprocess.isPending;
  return (
    <div className="space-y-4 border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{view.builder}</p>
          {view.needsRegion && <Badge variant="destructive">Set watermark region</Badge>}
          {!view.enabled && <Badge variant="secondary">Removal off: any watermark text hides the photo</Badge>}
        </div>
        <p className="text-[11px] text-muted-foreground">{view.photos.total} photos: {view.photos.processed} processed, {view.photos.pending} pending, {view.photos.awaitingRegion} awaiting region, {view.photos.failed} failed, {view.photos.autoHidden} auto-hidden</p>
      </div>
      <SwitchRow id={`${prefix}-enabled`} label="Watermark removal approved" note="ON for the two launch builders (they gave permission), OFF by default for any new builder. OFF hides every photo where OCR finds watermark text." checked={enabled} onCheckedChange={setEnabled} />
      <div>
        <p className="text-sm font-medium">Fixed watermark region (percent of the photo)</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Cropped off when it is a full-width band at the top or bottom, otherwise covered. Leave all four blank to clear it (enabled builders then park at awaiting region).</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(["x", "y", "width", "height"] as const).map((key) => (
            <Field key={key} id={`${prefix}-${key}`} label={`${key[0].toUpperCase()}${key.slice(1)} %`}>
              <Input id={`${prefix}-${key}`} className={inputClass} type="number" inputMode="decimal" min={0} max={100} step="0.5" value={region[key]} onChange={(event) => setRegion({ ...region, [key]: event.target.value })} />
            </Field>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {PRESETS.map((preset) => <Button key={preset.label} type="button" size="sm" variant="outline" className="min-h-10" onClick={() => setRegion(regionToDraft(preset.region))}>{preset.label}</Button>)}
          <Button type="button" size="sm" variant="ghost" className="min-h-10" onClick={() => setRegion(regionToDraft(null))}>Clear</Button>
        </div>
        {"error" in parsed && <p role="alert" className="mt-2 text-xs text-destructive">{parsed.error}</p>}
      </div>
      <div>
        <Button type="button" variant="outline" className={`${TAP} w-full sm:w-auto`} onClick={() => setShowSamples((value) => !value)}>{showSamples ? "Hide sample photos" : "Show 5 sample photos with the region drawn"}</Button>
        {showSamples && <div className="mt-3"><RegionSamples builder={view.builder} region={previewRegion} /></div>}
      </div>
      <ListField label="OCR keyword list (hides a photo when found, besides the private scrub list)" value={keywords} onChange={setKeywords} rows={3} hint="Whole words at OCR confidence 70 or higher. Realty, Realtors, Real Estate, MLS, Photography, Copyright and Homes are always kept." />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button type="button" className={`${TAP} ${GOLD_BUTTON} w-full sm:w-auto`} disabled={pending} onClick={submit}><RotateCcw className={`mr-1 h-4 w-4 ${pending ? "animate-spin" : ""}`} /> {pending ? "Saving..." : "Save and reprocess"}</Button>
        <p className="text-[11px] text-muted-foreground">Re-runs steps 3 to 6 on every stored original for this builder; photos are served again once processed. Revision {view.revision}.</p>
      </div>
    </div>
  );
}

function PhotoPreview({ id }: { id: number }) {
  const preview = trpc.deals.admin.photoPreview.useQuery({ id }, { retry: false, refetchOnWindowFocus: false, staleTime: 60_000 });
  if (preview.isLoading) return <p className="text-xs text-muted-foreground">Loading preview...</p>;
  if (preview.isError) return <p role="alert" className="text-xs text-destructive">{preview.error.message}</p>;
  if (!preview.data) return null;
  const terms = ocrMatchTerms(preview.data.ocrMatches);
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <img src={preview.data.dataUrl} alt={`Photo ${id} ${preview.data.source}`} className="h-auto w-full max-w-xs select-none border border-border" draggable={false} />
      <dl className="space-y-1 text-xs text-muted-foreground">
        <div><dt className="inline font-medium text-foreground">Showing: </dt><dd className="inline">{preview.data.source === "master" ? "processed master (what buyers see, before their watermark)" : "stored original (not yet processed)"}</dd></div>
        <div><dt className="inline font-medium text-foreground">Size: </dt><dd className="inline">{preview.data.width}x{preview.data.height}</dd></div>
        {terms.length > 0 && <div><dt className="inline font-medium text-foreground">OCR found: </dt><dd className="inline">{terms.join(", ")}</dd></div>}
        {preview.data.lastProcessingError && <div><dt className="inline font-medium text-foreground">Last error: </dt><dd className="inline">{preview.data.lastProcessingError.replaceAll("_", " ")}</dd></div>}
      </dl>
    </div>
  );
}

type Filter = "all" | "awaiting" | "hidden" | "failed" | "served" | "pending";

function matchesFilter(photo: PhotoRow, filter: Filter) {
  const state = photoStateLabel(photo);
  if (filter === "all") return true;
  if (filter === "awaiting") return state.tone === "waiting";
  if (filter === "hidden") return state.tone === "hidden";
  if (filter === "failed") return state.tone === "failed";
  if (filter === "served") return state.tone === "ready";
  return state.tone === "pending";
}

function PhotoRowView({ photo, home, community }: { photo: PhotoRow; home: Overview["homes"][number] | undefined; community: Overview["communities"][number] | undefined }) {
  const utils = trpc.useUtils();
  const [expanded, setExpanded] = useState(false);
  const [crop, setCrop] = useState(String(photo.bottomCrop));
  const refresh = () => { void utils.deals.admin.overview.invalidate(); void utils.deals.admin.builderPhotoSettings.invalidate(); };
  const onError = (error: { message: string }) => toast.error(error.message || "Could not update the photo");
  const setState = trpc.deals.admin.setPhotoState.useMutation({ onSuccess: (result) => { refresh(); toast.success(result.queued ? "Saved. The photo is queued for reprocessing." : "Photo state saved"); }, onError });
  const reprocess = trpc.deals.admin.reprocessPhoto.useMutation({ onSuccess: () => { refresh(); toast.success("Photo queued for reprocessing"); }, onError });
  const state = photoStateLabel(photo);
  const toneClass = state.tone === "ready" ? "text-gold" : state.tone === "failed" || state.tone === "hidden" ? "text-destructive" : "text-muted-foreground";
  const pending = setState.isPending || reprocess.isPending;
  const saveCrop = () => {
    const bottomCrop = Number(crop);
    if (!Number.isInteger(bottomCrop) || bottomCrop < 0 || bottomCrop > 10000) { toast.error("Bottom crop must be a whole number of pixels from 0 to 10,000."); return; }
    setState.mutate({ id: photo.id, bottomCrop });
  };
  return (
    <>
      <TableRow>
        <TableCell className="align-top">
          <p className="font-medium">Photo #{photo.id}</p>
          <p className="max-w-44 truncate text-xs text-muted-foreground" title={sourceHost(photo.sourceUrl)}>{sourceHost(photo.sourceUrl)}</p>
          <p className="text-[10px] text-muted-foreground">Processed {displayDate(photo.processedAt)}</p>
        </TableCell>
        <TableCell className="align-top text-xs">
          <p>{home ? (home.privateAddress || home.privatePlanName || `Home #${home.id}`) : `Home #${photo.homeId}`}</p>
          <p className="text-muted-foreground">{community ? `${community.builder} / ${community.privateName}` : "community not loaded"}{home?.status && home.status !== "available" ? `, home ${home.status}` : ""}</p>
        </TableCell>
        <TableCell className="align-top">
          <p className={`flex items-start gap-1 text-xs ${toneClass}`}>{state.tone === "ready" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />}<span className="max-w-56 break-words">{state.label}</span></p>
          <p className="mt-1 text-[10px] text-muted-foreground">{photo.processingState}{photo.processedVersion ? ` v${photo.processedVersion.slice(0, 8)}` : ""}</p>
        </TableCell>
        <TableCell className="align-top">
          <label className={`flex ${TAP} items-center gap-2 text-xs`}><Switch checked={!photo.adminHidden} onCheckedChange={(visible) => setState.mutate({ id: photo.id, adminHidden: !visible })} disabled={pending} aria-label={`Photo ${photo.id} visible`} />{photo.adminHidden ? "Hidden by admin" : "Not hidden by admin"}</label>
        </TableCell>
        <TableCell className="align-top">
          <div className="flex items-center gap-2">
            <Input className={`${TAP} w-24`} type="number" inputMode="numeric" min={0} max={10000} value={crop} onChange={(event) => setCrop(event.target.value)} aria-label={`Bottom crop in pixels for photo ${photo.id}`} />
            <Button type="button" size="sm" variant="outline" className={TAP} disabled={pending || Number(crop) === photo.bottomCrop} onClick={saveCrop}>Save</Button>
          </div>
        </TableCell>
        <TableCell className="align-top text-right">
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:justify-end">
            <Button type="button" size="sm" variant="outline" className={TAP} onClick={() => setExpanded((value) => !value)}>{expanded ? "Hide preview" : "Preview"}</Button>
            <Button type="button" size="sm" variant="outline" className={TAP} disabled={pending} onClick={() => reprocess.mutate({ id: photo.id })}><RotateCcw className="mr-1 h-3.5 w-3.5" /> Reprocess</Button>
          </div>
        </TableCell>
      </TableRow>
      {expanded && <TableRow><TableCell colSpan={6} className="bg-muted/10"><PhotoPreview id={photo.id} /></TableCell></TableRow>}
    </>
  );
}

export function PhotosSection({ overview }: { overview: Overview }) {
  const [filter, setFilter] = useState<Filter>("all");
  const builderSettings = trpc.deals.admin.builderPhotoSettings.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const homes = new Map(overview.homes.map((home) => [home.id, home]));
  const communities = new Map(overview.communities.map((community) => [community.id, community]));
  const visible = overview.photos.filter((photo) => photoStateLabel(photo).tone === "ready").length;
  const awaiting = overview.photos.filter((photo) => photo.lastProcessingError === "awaiting_region").length;
  const rows = overview.photos.filter((photo) => matchesFilter(photo, filter));
  return (
    <Section id="photos" title="Photos" icon={Image} description="Per builder: the watermark removal toggle, the fixed region picked from sample photos, and the OCR keyword list. Per photo: what buyers would see, the hide switch (separate from the automatic flag), a bottom crop and Reprocess. A photo is served only when both flags are clear.">
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Served" value={visible} detail="Processed, not hidden" />
        <Metric label="Awaiting region" value={awaiting} detail="Set watermark region" tone={awaiting ? "warning" : "default"} />
        <Metric label="Auto-hidden" value={overview.photos.filter((photo) => photo.processingState === "processed" && photo.automaticHidden).length} detail="OCR found a private term" tone="warning" />
        <Metric label="Admin-hidden" value={overview.photos.filter((photo) => photo.adminHidden).length} detail="Your publication decisions" tone="default" />
      </div>
      <div className="space-y-4">
        {builderSettings.isLoading && <p className="text-xs text-muted-foreground">Loading builder photo settings...</p>}
        {builderSettings.isError && <Warning>Builder photo settings could not be loaded: {builderSettings.error.message}</Warning>}
        {builderSettings.data?.map((view) => <BuilderPhotoCard key={`${view.builder}-${view.revision}`} view={view} />)}
      </div>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-medium">Latest {overview.photos.length} photos{overview.photos.length >= overview.limits.photos ? ` (first ${overview.limits.photos})` : ""}</p>
        <Field id="photo-filter" label="Show" className="sm:w-56">
          <Select value={filter} onValueChange={(value) => setFilter(value as Filter)}>
            <SelectTrigger id="photo-filter" className={inputClass}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="served">Served</SelectItem><SelectItem value="awaiting">Awaiting region</SelectItem><SelectItem value="hidden">Hidden</SelectItem><SelectItem value="failed">Failed</SelectItem><SelectItem value="pending">Pending</SelectItem></SelectContent>
          </Select>
        </Field>
      </div>
      <div className="mt-3 overflow-x-auto">
        <Table className="min-w-[52rem]">
          <TableHeader><TableRow><TableHead>Photo</TableHead><TableHead>Home (private)</TableHead><TableHead>State</TableHead><TableHead>Admin hide</TableHead><TableHead>Bottom crop (px)</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((photo) => { const home = homes.get(photo.homeId); return <PhotoRowView key={`${photo.id}-${photo.bottomCrop}`} photo={photo} home={home} community={home ? communities.get(home.communityId) : undefined} />; })}
            {rows.length === 0 && <TableRow><TableCell colSpan={6}><EmptyRow>{overview.photos.length ? "No photos match this filter." : "No Builder Deals photos have been imported."}</EmptyRow></TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </Section>
  );
}
