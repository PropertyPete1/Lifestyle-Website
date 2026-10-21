import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { CircleAlert, Loader2, LockKeyhole, RefreshCw } from "lucide-react";
import { Metric, TAP } from "@/components/builder-deals/shared";
import { CommunitiesSection } from "@/components/builder-deals/CommunitiesSection";
import { PhotosSection } from "@/components/builder-deals/PhotosSection";
import { ManualHomesSection } from "@/components/builder-deals/ManualHomesSection";
import { LeadsSection } from "@/components/builder-deals/LeadsSection";
import { FunnelSection } from "@/components/builder-deals/FunnelSection";
import { TeamSection } from "@/components/builder-deals/TeamSection";
import { ClientLinksSection } from "@/components/builder-deals/ClientLinksSection";
import { BlocklistSection, KnownAgentsSection } from "@/components/builder-deals/ScreeningSections";
import { SettingsSection } from "@/components/builder-deals/SettingsSection";
import { SuppliedImportSection } from "@/components/builder-deals/SuppliedImportSection";
import { TrecSection } from "@/components/builder-deals/TrecSection";
import { DeliverySection } from "@/components/builder-deals/DeliverySection";

/**
 * This component independently checks the signed-in role before mounting any
 * protected query. It is intentionally safe to import into a route only after
 * the site's normal admin shell, without making private Builder Deals records
 * available to public visitors.
 */
export default function BuilderDealsAdminPanel() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-gold" /> Loading admin workspace...
      </div>
    );
  }

  if (!user || user.role !== "admin") {
    return (
      <div className="border border-border bg-card p-8 text-center">
        <LockKeyhole className="mx-auto h-6 w-6 text-gold" />
        <p className="mt-3 font-serif text-xl">Administrator access required</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Builder Deals operational records are available only to authorized administrators.
        </p>
      </div>
    );
  }

  return <BuilderDealsAdminContent />;
}

const JUMP_LINKS = [
  ["communities", "Communities"],
  ["supplied-imports", "Supplied imports"],
  ["photos", "Photos"],
  ["manual-homes", "Manual homes"],
  ["leads", "Leads"],
  ["funnel", "Funnel"],
  ["team", "Team"],
  ["known-agents", "Known agents"],
  ["blocklist", "Blocklist"],
  ["settings", "Settings"],
  ["trec", "TREC"],
  ["delivery", "CRM and alerts"],
] as const;

function BuilderDealsAdminContent() {
  const overviewQuery = trpc.deals.admin.overview.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const settingsQuery = trpc.deals.admin.settings.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const overview = overviewQuery.data;
  const settings = settingsQuery.data;

  if (overviewQuery.isLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-gold" /> Loading Builder Deals operations...
      </div>
    );
  }

  if (overviewQuery.isError || !overview) {
    return (
      <section role="alert" className="border border-destructive/40 bg-destructive/5 p-5">
        <div className="flex items-start gap-3">
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div>
            <h1 className="font-serif text-2xl">Builder Deals operations unavailable</h1>
            <p className="mt-2 text-sm text-muted-foreground">{overviewQuery.error?.message || "The private operations data could not be loaded. No controls have been shown or changed."}</p>
            <Button className={`${TAP} mt-4 w-full sm:w-auto`} variant="outline" onClick={() => void overviewQuery.refetch()}><RefreshCw className="mr-1 h-4 w-4" /> Try again</Button>
          </div>
        </div>
      </section>
    );
  }

  const activeCommunities = overview.communities.filter((community) => community.active && !community.paused).length;
  const pausedCommunities = overview.communities.filter((community) => community.active && community.paused).length;
  const availableHomes = overview.homes.filter((home) => home.status === "available").length;
  const failedFub = overview.fubJobs.filter((job) => job.status === "failed").length;
  const servedPhotos = overview.photos.filter((photo) => photo.processingState === "processed" && !photo.automaticHidden && !photo.adminHidden).length;

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><LockKeyhole className="h-5 w-5 shrink-0 text-gold" /><h1 className="font-serif text-3xl">Builder Deals</h1></div>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Private buyer-funnel administration. Contact data, the builder mapping, addresses, screening controls and operational records stay inside this role-gated panel.
          </p>
        </div>
        <Button variant="outline" className={`${TAP} w-full sm:w-auto`} onClick={() => void overviewQuery.refetch()} disabled={overviewQuery.isFetching}><RefreshCw className={`mr-1 h-4 w-4 ${overviewQuery.isFetching ? "animate-spin" : ""}`} /> Refresh</Button>
      </header>

      <nav aria-label="Builder Deals sections" className="-mx-5 overflow-x-auto px-5 lg:mx-0 lg:px-0">
        <ul className="flex gap-2 whitespace-nowrap pb-1">
          {JUMP_LINKS.map(([id, label]) => <li key={id}><a href={`#${id}`} className={`inline-flex ${TAP} items-center border border-border px-3 text-xs uppercase tracking-[0.12em] text-muted-foreground hover:border-gold hover:text-gold`}>{label}</a></li>)}
        </ul>
      </nav>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Metric label="Verified leads" value={overview.leadCounts.verified ?? 0} detail={`${overview.leadCounts.team ?? 0} team, ${overview.leadCounts.blocked ?? 0} blocked`} />
        <Metric label="Sends today" value={overview.dailyCount.toLocaleString()} detail={overview.capReached ? "Daily cap reached" : "Under the daily cap"} tone={overview.capReached ? "warning" : "default"} />
        <Metric label="Active communities" value={activeCommunities} detail={`${pausedCommunities} paused`} />
        <Metric label="Available homes" value={availableHomes} detail={`${servedPhotos} photos served`} />
        <Metric label="Failed FUB jobs" value={failedFub} detail={`${overview.blockCount.toLocaleString()} active blocks`} tone={failedFub ? "warning" : "default"} />
      </div>

      <CommunitiesSection overview={overview} />
      <SuppliedImportSection />
      <PhotosSection overview={overview} />
      <ManualHomesSection overview={overview} />
      <LeadsSection overview={overview} />
      <FunnelSection activeReelCodes={settings?.activeReelCodes ?? []} />
      <TeamSection settings={settings} />
      <ClientLinksSection overview={overview} />
      <KnownAgentsSection overview={overview} />
      <BlocklistSection overview={overview} />
      {settingsQuery.isLoading && <section className="border border-border bg-card p-5 text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin text-gold" /> Loading Builder Deals settings...</section>}
      {settingsQuery.isError && <section role="alert" className="border border-destructive/40 bg-destructive/5 p-5"><p className="font-medium text-destructive">Settings are unavailable</p><p className="mt-1 text-sm text-muted-foreground">Settings were not loaded, so nothing can be edited or saved from this panel.</p><Button variant="outline" className={`${TAP} mt-4 w-full sm:w-auto`} onClick={() => void settingsQuery.refetch()}>Try loading settings again</Button></section>}
      {settings && <SettingsSection overview={overview} settings={settings} />}
      <TrecSection overview={overview} counties={settings?.trecCounties ?? []} />
      <DeliverySection overview={overview} />
    </div>
  );
}
