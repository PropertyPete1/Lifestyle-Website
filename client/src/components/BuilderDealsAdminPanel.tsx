import { useEffect, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  Ban,
  Building2,
  CheckCircle2,
  Eye,
  FilePenLine,
  Home,
  Image,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  Users,
} from "lucide-react";

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
        <Loader2 className="h-4 w-4 animate-spin text-gold" /> Loading admin workspace…
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

type SettingsDraft = {
  allowCanada: boolean;
  commentKeyword: string;
  textLine: string;
  expiryHours: number;
  hasAgentBlockDays: number;
  incentiveLapseDays: number;
  dailyVerificationCap: number;
  phoneLimitPerHour: number;
  ipLimitPerHour: number;
  testPhoneLimitPerHour: number;
  skipTwilioForTestNumbers: boolean;
  testNumbersSkipChecks: boolean;
  testModeFullPipeline: boolean;
  testNumbers: string[];
  activeReelCodes: string[];
  brokerageDomains: string[];
  fubRealtorTags: string[];
  fubRealtorSources: string[];
  handleKeywords: string[];
  trecCounties: string[];
  alertMode: "instant" | "hourly_digest";
};

type SettingsInput = Partial<SettingsDraft> | undefined;

type BlockForm = {
  phone: string;
  email: string;
  deviceHash: string;
  reason: string;
};

type KnownAgentForm = {
  name: string;
  phoneE164: string;
  email: string;
  source: "csv" | "fub_recruit" | "manual";
};

type TeamForm = {
  name: string;
  phoneE164: string;
  email: string;
  source: "fub" | "manual" | "test";
};

type ManualHomeForm = {
  communityId: string;
  sourceUrl: string;
  privateAddress: string;
  privatePlanName: string;
  kind: "quick_move_in" | "to_be_built";
  beds: string;
  baths: string;
  sqft: string;
  price: string;
};

const DEFAULT_SETTINGS: SettingsDraft = {
  allowCanada: false,
  commentKeyword: "HOME",
  textLine: "",
  expiryHours: 24,
  hasAgentBlockDays: 60,
  incentiveLapseDays: 14,
  dailyVerificationCap: 1500,
  phoneLimitPerHour: 3,
  ipLimitPerHour: 100,
  testPhoneLimitPerHour: 10,
  skipTwilioForTestNumbers: true,
  testNumbersSkipChecks: true,
  testModeFullPipeline: false,
  testNumbers: [],
  activeReelCodes: [],
  brokerageDomains: [],
  fubRealtorTags: [],
  fubRealtorSources: [],
  handleKeywords: [],
  trecCounties: [],
  alertMode: "instant",
};

const EMPTY_BLOCK: BlockForm = { phone: "", email: "", deviceHash: "", reason: "" };
const EMPTY_KNOWN_AGENT: KnownAgentForm = { name: "", phoneE164: "", email: "", source: "manual" };
const EMPTY_TEAM: TeamForm = { name: "", phoneE164: "", email: "", source: "manual" };
const EMPTY_MANUAL_HOME: ManualHomeForm = {
  communityId: "",
  sourceUrl: "",
  privateAddress: "",
  privatePlanName: "",
  kind: "quick_move_in",
  beds: "",
  baths: "",
  sqft: "",
  price: "",
};

function toDraft(settings: SettingsInput): SettingsDraft {
  return { ...DEFAULT_SETTINGS, ...settings };
}

function toList(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function listValue(items: string[] | undefined) {
  return (items ?? []).join("\n");
}

function displayDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function masked(value: string | null | undefined) {
  if (!value) return "—";
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function sourceHost(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

function flagValues(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    const values = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && "flags" in parsed
        ? (parsed as { flags?: unknown }).flags
        : [];
    return Array.isArray(values) ? values.map((flag) => String(flag)) : [];
  } catch {
    return [];
  }
}

function Metric({ label, value, detail, tone = "gold" }: { label: string; value: number; detail?: string; tone?: "gold" | "warning" | "default" }) {
  const valueClass = tone === "warning" ? "text-destructive" : tone === "default" ? "text-foreground" : "text-gold";
  return (
    <div className="border border-border bg-card p-4">
      <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
      <p className={`mt-1 font-serif text-3xl ${valueClass}`}>{value}</p>
      {detail && <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>}
    </div>
  );
}

function Section({ title, description, icon: Icon, children, action }: {
  title: string;
  description?: string;
  icon?: typeof Home;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            {Icon && <Icon className="h-4 w-4 text-gold" />}
            <h2 className="font-serif text-2xl">{title}</h2>
          </div>
          {description && <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function ListField({ label, hint, value, onChange, placeholder }: {
  label: string;
  hint?: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Textarea
        value={listValue(value)}
        onChange={(event) => onChange(toList(event.target.value))}
        placeholder={placeholder ?? "One item per line"}
        rows={4}
      />
      {hint && <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SettingsEditor({ settings }: { settings: SettingsInput }) {
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState<SettingsDraft>(() => toDraft(settings));

  useEffect(() => {
    if (settings) setDraft(toDraft(settings));
  }, [settings]);

  const saveSettings = trpc.deals.admin.saveSettings.useMutation({
    onSuccess: () => {
      void utils.deals.admin.settings.invalidate();
      toast.success("Builder Deals settings saved");
    },
    onError: (error) => toast.error(error.message || "Could not save Builder Deals settings"),
  });

  const submit = () => {
    if (!draft.commentKeyword.trim() || !draft.textLine.trim()) {
      toast.error("A buyer keyword and buyer text line are required.");
      return;
    }

    saveSettings.mutate({
      allowCanada: draft.allowCanada,
      commentKeyword: draft.commentKeyword.trim(),
      textLine: draft.textLine.trim(),
      expiryHours: draft.expiryHours,
      hasAgentBlockDays: draft.hasAgentBlockDays,
      incentiveLapseDays: draft.incentiveLapseDays,
      dailyVerificationCap: draft.dailyVerificationCap,
      phoneLimitPerHour: draft.phoneLimitPerHour,
      ipLimitPerHour: draft.ipLimitPerHour,
      testPhoneLimitPerHour: draft.testPhoneLimitPerHour,
      skipTwilioForTestNumbers: draft.skipTwilioForTestNumbers,
      testNumbersSkipChecks: draft.testNumbersSkipChecks,
      testModeFullPipeline: draft.testModeFullPipeline,
      testNumbers: draft.testNumbers,
      activeReelCodes: draft.activeReelCodes,
      brokerageDomains: draft.brokerageDomains,
      fubRealtorTags: draft.fubRealtorTags,
      fubRealtorSources: draft.fubRealtorSources,
      handleKeywords: draft.handleKeywords,
      trecCounties: draft.trecCounties,
      alertMode: draft.alertMode,
    });
  };

  const numberField = (label: string, key: "expiryHours" | "hasAgentBlockDays" | "incentiveLapseDays" | "dailyVerificationCap" | "phoneLimitPerHour" | "ipLimitPerHour" | "testPhoneLimitPerHour", min: number, max: number) => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        value={draft[key]}
        onChange={(event) => setDraft({ ...draft, [key]: Number(event.target.value) })}
      />
    </div>
  );

  return (
    <Section
      title="Gate, attribution & screening settings"
      icon={FilePenLine}
      description="These controls are applied by the protected Builder Deals funnel. Keep private screening signals and testing controls here; they are not returned by public catalog routes."
      action={<Button onClick={submit} disabled={saveSettings.isPending} className="bg-gold text-primary-foreground hover:bg-gold/90"><Save className="mr-1 h-4 w-4" />{saveSettings.isPending ? "Saving…" : "Save settings"}</Button>}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="builder-deals-keyword">Buyer text keyword</Label>
          <Input id="builder-deals-keyword" maxLength={30} value={draft.commentKeyword} onChange={(event) => setDraft({ ...draft, commentKeyword: event.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="builder-deals-text-line">Buyer text line</Label>
          <Input id="builder-deals-text-line" maxLength={40} value={draft.textLine} onChange={(event) => setDraft({ ...draft, textLine: event.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Alert delivery</Label>
          <Select value={draft.alertMode} onValueChange={(value) => setDraft({ ...draft, alertMode: value as SettingsDraft["alertMode"] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="instant">Instant alerts</SelectItem>
              <SelectItem value="hourly_digest">Hourly digest</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-4 border border-border px-3 py-2.5">
          <div><Label>Allow Canadian phone numbers</Label><p className="text-[11px] text-muted-foreground">US-only remains the default funnel behavior.</p></div>
          <Switch checked={draft.allowCanada} onCheckedChange={(allowCanada) => setDraft({ ...draft, allowCanada })} />
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {numberField("Access expiry (hours)", "expiryHours", 1, 168)}
        {numberField("Has-agent block (days)", "hasAgentBlockDays", 1, 400)}
        {numberField("Incentive lapse (days)", "incentiveLapseDays", 1, 90)}
        {numberField("Daily verification cap", "dailyVerificationCap", 1, 10000)}
        {numberField("Phone requests / hour", "phoneLimitPerHour", 1, 50)}
        {numberField("IP requests / hour", "ipLimitPerHour", 1, 1000)}
        {numberField("Test phone requests / hour", "testPhoneLimitPerHour", 1, 100)}
      </div>

      <div className="mt-6 grid gap-3 lg:grid-cols-3">
        {[
          { key: "skipTwilioForTestNumbers" as const, title: "Skip Twilio for test numbers", note: "Uses the protected test OTP rather than sending a Verify message." },
          { key: "testNumbersSkipChecks" as const, title: "Test numbers skip blocking checks", note: "Does not change the treatment of real visitors." },
          { key: "testModeFullPipeline" as const, title: "Run test records through the full pipeline", note: "Test records are marked for cleanup in downstream operations." },
        ].map((item) => (
          <label key={item.key} className="flex items-start justify-between gap-3 border border-border p-3">
            <span><strong className="text-sm">{item.title}</strong><span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">{item.note}</span></span>
            <Switch checked={draft[item.key]} onCheckedChange={(checked) => setDraft({ ...draft, [item.key]: checked })} />
          </label>
        ))}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <ListField label="Test numbers" value={draft.testNumbers} onChange={(testNumbers) => setDraft({ ...draft, testNumbers })} placeholder="+15125550123" hint="One E.164 number per line. The server normalizes and validates every value." />
        <ListField label="Active reel codes" value={draft.activeReelCodes} onChange={(activeReelCodes) => setDraft({ ...draft, activeReelCodes })} placeholder="sl1" hint="Only these sanitized attribution codes are accepted by the buyer funnel." />
        <ListField label="Brokerage domains" value={draft.brokerageDomains} onChange={(brokerageDomains) => setDraft({ ...draft, brokerageDomains })} placeholder="examplebrokerage.com" hint="Domains used to identify broker/agent identities before link issuance." />
        <ListField label="FUB REALTOR® tags" value={draft.fubRealtorTags} onChange={(fubRealtorTags) => setDraft({ ...draft, fubRealtorTags })} placeholder="Recruit" hint="Follow Up Boss tags that should be screened as real-estate professionals." />
        <ListField label="FUB REALTOR® sources" value={draft.fubRealtorSources} onChange={(fubRealtorSources) => setDraft({ ...draft, fubRealtorSources })} placeholder="Agent Referral" hint="Follow Up Boss sources that trigger the same protected screening." />
        <ListField label="Instagram handle keywords" value={draft.handleKeywords} onChange={(handleKeywords) => setDraft({ ...draft, handleKeywords })} placeholder="realty" hint="Keywords used in the profile-based REALTOR® screening signal." />
        <ListField label="TREC counties" value={draft.trecCounties} onChange={(trecCounties) => setDraft({ ...draft, trecCounties })} placeholder="Bexar" hint="Counties included when checking the official TREC data." />
      </div>
    </Section>
  );
}

function BuilderDealsAdminContent() {
  const utils = trpc.useUtils();
  const { data: overview, isLoading, isFetching, refetch } = trpc.deals.admin.overview.useQuery();
  const { data: settings } = trpc.deals.admin.settings.useQuery();
  const [blockForm, setBlockForm] = useState<BlockForm>(EMPTY_BLOCK);
  const [knownAgentForm, setKnownAgentForm] = useState<KnownAgentForm>(EMPTY_KNOWN_AGENT);
  const [teamForm, setTeamForm] = useState<TeamForm>(EMPTY_TEAM);
  const [manualHomeForm, setManualHomeForm] = useState<ManualHomeForm>(EMPTY_MANUAL_HOME);
  const [reelDrafts, setReelDrafts] = useState<Record<number, string>>({});
  const [photoCrops, setPhotoCrops] = useState<Record<number, string>>({});
  const [leadToBlock, setLeadToBlock] = useState<number | null>(null);
  const [leadBlockReason, setLeadBlockReason] = useState("");

  const refreshOverview = () => void utils.deals.admin.overview.invalidate();
  const mutationError = (error: { message: string }) => toast.error(error.message || "Could not save Builder Deals changes");

  const saveCommunityState = trpc.deals.admin.saveCommunityState.useMutation({
    onSuccess: () => { refreshOverview(); toast.success("Community state saved"); },
    onError: mutationError,
  });
  const addBlock = trpc.deals.admin.addBlock.useMutation({
    onSuccess: () => { refreshOverview(); setBlockForm(EMPTY_BLOCK); toast.success("Blocklist entry added"); },
    onError: mutationError,
  });
  const unblock = trpc.deals.admin.unblock.useMutation({
    onSuccess: () => { refreshOverview(); toast.success("Blocklist entry removed"); },
    onError: mutationError,
  });
  const addKnownAgent = trpc.deals.admin.addKnownAgent.useMutation({
    onSuccess: () => { refreshOverview(); setKnownAgentForm(EMPTY_KNOWN_AGENT); toast.success("Known agent added"); },
    onError: mutationError,
  });
  const addTeam = trpc.deals.admin.addTeam.useMutation({
    onSuccess: () => { refreshOverview(); setTeamForm(EMPTY_TEAM); toast.success("Team allowlist entry added"); },
    onError: mutationError,
  });
  const addManualHome = trpc.deals.admin.addManualHome.useMutation({
    onSuccess: () => { refreshOverview(); setManualHomeForm(EMPTY_MANUAL_HOME); toast.success("Manual home saved"); },
    onError: mutationError,
  });
  const setPhotoState = trpc.deals.admin.setPhotoState.useMutation({
    onSuccess: () => { refreshOverview(); toast.success("Photo state saved"); },
    onError: mutationError,
  });
  const blockLeadAndKillLink = trpc.deals.admin.blockLeadAndKillLink.useMutation({
    onSuccess: () => { refreshOverview(); setLeadToBlock(null); setLeadBlockReason(""); toast.success("Lead blocked and access link revoked"); },
    onError: mutationError,
  });

  if (isLoading || !overview) {
    return (
      <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-gold" /> Loading Builder Deals operations…
      </div>
    );
  }

  const verifiedLeads = overview.leads.filter((lead) => lead.status === "verified").length;
  const blockedLeads = overview.leads.filter((lead) => lead.status === "blocked").length;
  const failedFub = overview.leads.filter((lead) => lead.fubStatus === "failed").length;
  const pausedCommunities = overview.communities.filter((community) => community.paused).length;
  const activeCommunities = overview.communities.filter((community) => community.active && !community.paused).length;
  const availableHomes = overview.homes.filter((home) => home.status === "available").length;
  const visiblePhotos = overview.photos.filter((photo) => photo.processingState === "processed" && !photo.automaticHidden && !photo.adminHidden).length;
  const selectedLead = overview.leads.find((lead) => lead.id === leadToBlock);

  const saveReel = (communityId: number, value: string) => {
    const reelUrl = value.trim();
    if (reelUrl) {
      try {
        new URL(reelUrl);
      } catch {
        toast.error("Enter a complete reel URL, including https://");
        return;
      }
    }
    saveCommunityState.mutate({ id: communityId, reelUrl: reelUrl || null });
  };

  const submitBlock = () => {
    if (!blockForm.phone.trim() && !blockForm.email.trim() && !blockForm.deviceHash.trim()) {
      toast.error("Add a phone, email, or device hash to block.");
      return;
    }
    if (blockForm.reason.trim().length < 3) {
      toast.error("Please provide a block reason of at least three characters.");
      return;
    }
    addBlock.mutate({
      phone: blockForm.phone.trim() || undefined,
      email: blockForm.email.trim().toLowerCase() || undefined,
      deviceHash: blockForm.deviceHash.trim() || undefined,
      reason: blockForm.reason.trim(),
    });
  };

  const submitKnownAgent = () => {
    if (!knownAgentForm.name.trim() && !knownAgentForm.phoneE164.trim() && !knownAgentForm.email.trim()) {
      toast.error("Enter at least one known-agent identifier.");
      return;
    }
    addKnownAgent.mutate({
      name: knownAgentForm.name.trim() || undefined,
      phoneE164: knownAgentForm.phoneE164.trim() || undefined,
      email: knownAgentForm.email.trim().toLowerCase() || undefined,
      source: knownAgentForm.source,
    });
  };

  const submitTeam = () => {
    if (!teamForm.name.trim() && !teamForm.phoneE164.trim() && !teamForm.email.trim()) {
      toast.error("Enter at least one team allowlist identifier.");
      return;
    }
    addTeam.mutate({
      name: teamForm.name.trim() || undefined,
      phoneE164: teamForm.phoneE164.trim() || undefined,
      email: teamForm.email.trim().toLowerCase() || undefined,
      source: teamForm.source,
    });
  };

  const submitManualHome = () => {
    const communityId = Number(manualHomeForm.communityId);
    if (!communityId || !manualHomeForm.sourceUrl.trim()) {
      toast.error("Choose a community and provide the source URL.");
      return;
    }
    try {
      new URL(manualHomeForm.sourceUrl.trim());
    } catch {
      toast.error("Enter a complete source URL, including https://");
      return;
    }
    const optionalInteger = (value: string) => value.trim() === "" ? undefined : Number(value);
    const sqft = optionalInteger(manualHomeForm.sqft);
    const price = optionalInteger(manualHomeForm.price);
    if ((sqft !== undefined && (!Number.isInteger(sqft) || sqft < 0)) || (price !== undefined && (!Number.isInteger(price) || price < 0))) {
      toast.error("Square feet and price must be whole, non-negative numbers.");
      return;
    }
    addManualHome.mutate({
      communityId,
      sourceUrl: manualHomeForm.sourceUrl.trim(),
      privateAddress: manualHomeForm.privateAddress.trim() || undefined,
      privatePlanName: manualHomeForm.privatePlanName.trim() || undefined,
      kind: manualHomeForm.kind,
      beds: manualHomeForm.beds.trim() || undefined,
      baths: manualHomeForm.baths.trim() || undefined,
      sqft,
      price,
    });
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2"><LockKeyhole className="h-5 w-5 text-gold" /><h1 className="font-serif text-3xl">Builder Deals Operations</h1></div>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Private buyer-funnel administration. Contact data, source mappings, address data, screening controls, and operational records remain inside the protected admin surface.
          </p>
        </div>
        <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}><RefreshCw className={`mr-1 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh</Button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Verified buyer leads" value={verifiedLeads} detail={`${overview.leads.length} total leads`} />
        <Metric label="CRM delivery retries" value={failedFub} detail="Failed FUB sync records" tone={failedFub ? "warning" : "default"} />
        <Metric label="Active communities" value={activeCommunities} detail={`${pausedCommunities} paused`} />
        <Metric label="Viewable catalog homes" value={availableHomes} detail="Available home records" />
        <Metric label="Active blocks" value={overview.blocks.length} detail={`${blockedLeads} blocked lead records`} tone={overview.blocks.length ? "warning" : "default"} />
      </div>

      <Section title="Community launch controls" icon={Building2} description="Pause a community to remove it from the buyer catalog. Manual mode prevents scheduled source changes. The private builder mapping below is intentionally rendered only in this role-gated panel.">
        <div className="space-y-4">
          {overview.communities.map((community) => (
            <div key={community.id} className="border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2"><p className="font-medium">{community.publicLabel}</p>{!community.active && <Badge variant="secondary">Inactive</Badge>}{community.paused && <Badge variant="destructive">Paused</Badge>}{community.manualMode && <Badge className="bg-gold text-primary-foreground">Manual</Badge>}</div>
                  <p className="mt-1 text-xs text-muted-foreground">Private mapping: {community.builder} · {community.privateName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Last successful sync: {displayDate(community.lastSuccessfulSyncAt)} · Catalog updated: {displayDate(community.catalogUpdatedAt)}</p>
                  {community.holdReason && <p className="mt-2 flex items-center gap-1 text-xs text-destructive"><AlertTriangle className="h-3.5 w-3.5" /> Hold: {community.holdReason}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant={community.active ? "outline" : "default"} className={!community.active ? "bg-gold text-primary-foreground" : ""} disabled={saveCommunityState.isPending} onClick={() => saveCommunityState.mutate({ id: community.id, active: !community.active })}>{community.active ? "Deactivate" : "Activate"}</Button>
                  <Button size="sm" variant={community.paused ? "default" : "outline"} className={community.paused ? "bg-gold text-primary-foreground" : ""} disabled={saveCommunityState.isPending} onClick={() => saveCommunityState.mutate({ id: community.id, paused: !community.paused })}>{community.paused ? "Resume" : "Pause"}</Button>
                  <Button size="sm" variant={community.manualMode ? "default" : "outline"} className={community.manualMode ? "bg-gold text-primary-foreground" : ""} disabled={saveCommunityState.isPending} onClick={() => saveCommunityState.mutate({ id: community.id, manualMode: !community.manualMode })}>{community.manualMode ? "Manual on" : "Manual off"}</Button>
                </div>
              </div>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-1.5"><Label htmlFor={`reel-${community.id}`}>Instagram reel URL</Label><Input id={`reel-${community.id}`} value={reelDrafts[community.id] ?? community.reelUrl ?? ""} onChange={(event) => setReelDrafts({ ...reelDrafts, [community.id]: event.target.value })} placeholder="https://www.instagram.com/reel/..." /></div>
                <Button size="sm" variant="outline" disabled={saveCommunityState.isPending} onClick={() => saveReel(community.id, reelDrafts[community.id] ?? community.reelUrl ?? "")}>Save reel</Button>
              </div>
            </div>
          ))}
          {overview.communities.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No Builder Deals communities are configured.</p>}
        </div>
      </Section>

      <SettingsEditor settings={settings} />

      <Section title="Manual home entry" icon={Home} description="Add or update a manually curated home record. This form writes the private source and address data to the protected Builder Deals catalog only.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5"><Label>Community</Label><Select value={manualHomeForm.communityId} onValueChange={(communityId) => setManualHomeForm({ ...manualHomeForm, communityId })}><SelectTrigger><SelectValue placeholder="Choose community" /></SelectTrigger><SelectContent>{overview.communities.map((community) => <SelectItem key={community.id} value={String(community.id)}>{community.publicLabel}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5 xl:col-span-2"><Label>Private source URL</Label><Input value={manualHomeForm.sourceUrl} onChange={(event) => setManualHomeForm({ ...manualHomeForm, sourceUrl: event.target.value })} placeholder="https://builder.example/home" /></div>
          <div className="space-y-1.5"><Label>Home kind</Label><Select value={manualHomeForm.kind} onValueChange={(kind) => setManualHomeForm({ ...manualHomeForm, kind: kind as ManualHomeForm["kind"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="quick_move_in">Quick move-in</SelectItem><SelectItem value="to_be_built">To be built</SelectItem></SelectContent></Select></div>
          <div className="space-y-1.5"><Label>Private address</Label><Input value={manualHomeForm.privateAddress} onChange={(event) => setManualHomeForm({ ...manualHomeForm, privateAddress: event.target.value })} /></div>
          <div className="space-y-1.5"><Label>Private plan name</Label><Input value={manualHomeForm.privatePlanName} onChange={(event) => setManualHomeForm({ ...manualHomeForm, privatePlanName: event.target.value })} /></div>
          <div className="space-y-1.5"><Label>Beds</Label><Input value={manualHomeForm.beds} onChange={(event) => setManualHomeForm({ ...manualHomeForm, beds: event.target.value })} placeholder="4" /></div>
          <div className="space-y-1.5"><Label>Baths</Label><Input value={manualHomeForm.baths} onChange={(event) => setManualHomeForm({ ...manualHomeForm, baths: event.target.value })} placeholder="3.5" /></div>
          <div className="space-y-1.5"><Label>Square feet</Label><Input type="number" min="0" value={manualHomeForm.sqft} onChange={(event) => setManualHomeForm({ ...manualHomeForm, sqft: event.target.value })} /></div>
          <div className="space-y-1.5"><Label>Price</Label><Input type="number" min="0" value={manualHomeForm.price} onChange={(event) => setManualHomeForm({ ...manualHomeForm, price: event.target.value })} /></div>
          <div className="flex items-end"><Button onClick={submitManualHome} disabled={addManualHome.isPending} className="w-full bg-gold text-primary-foreground hover:bg-gold/90"><Plus className="mr-1 h-4 w-4" />{addManualHome.isPending ? "Saving…" : "Save manual home"}</Button></div>
        </div>
        <div className="mt-6 overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Home</TableHead><TableHead>Community</TableHead><TableHead>Kind</TableHead><TableHead>Status</TableHead><TableHead>Price</TableHead><TableHead>Origin</TableHead></TableRow></TableHeader>
            <TableBody>
              {overview.homes.filter((home) => home.origin === "manual").map((home) => <TableRow key={home.id}><TableCell><p className="font-medium">{home.privateAddress || "No address"}</p><p className="text-xs text-muted-foreground">{home.privatePlanName || "No plan name"}</p></TableCell><TableCell>{overview.communities.find((community) => community.id === home.communityId)?.publicLabel ?? `#${home.communityId}`}</TableCell><TableCell className="capitalize">{home.kind.replaceAll("_", " ")}</TableCell><TableCell><Badge variant={home.status === "available" ? "default" : "secondary"}>{home.status}</Badge></TableCell><TableCell>{home.price ? `$${home.price.toLocaleString()}` : "—"}</TableCell><TableCell>Manual</TableCell></TableRow>)}
              {!overview.homes.some((home) => home.origin === "manual") && <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">No manually entered homes yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section title="Photo publishing controls" icon={Image} description="Review the processing state and OCR signal for each private source photo. Hiding or setting a bottom crop is an admin-only catalog operation.">
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Metric label="Catalog-ready photos" value={visiblePhotos} detail="Processed and not hidden" /><Metric label="Automatically hidden" value={overview.photos.filter((photo) => photo.automaticHidden).length} detail="System screening state" tone="warning" /><Metric label="Admin-hidden" value={overview.photos.filter((photo) => photo.adminHidden).length} detail="Explicit publication decisions" /></div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Photo / source</TableHead><TableHead>Home</TableHead><TableHead>Processing</TableHead><TableHead>Screening</TableHead><TableHead>Visibility</TableHead><TableHead>Bottom crop (px)</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
            <TableBody>
              {overview.photos.map((photo) => <TableRow key={photo.id}><TableCell><p className="font-medium">Photo #{photo.id}</p><p className="max-w-40 truncate text-xs text-muted-foreground" title={photo.sourceUrl}>{sourceHost(photo.sourceUrl)}</p></TableCell><TableCell>#{photo.homeId}</TableCell><TableCell><Badge variant={photo.processingState === "processed" ? "default" : photo.processingState === "failed" ? "destructive" : "secondary"}>{photo.processingState}</Badge></TableCell><TableCell>{photo.automaticHidden ? <span className="flex items-center gap-1 text-xs text-destructive"><ShieldAlert className="h-3.5 w-3.5" /> Auto-hidden</span> : <span className="flex items-center gap-1 text-xs text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5" /> Clear</span>}</TableCell><TableCell><div className="flex items-center gap-2"><Switch checked={!photo.adminHidden} onCheckedChange={(visible) => setPhotoState.mutate({ id: photo.id, adminHidden: !visible })} disabled={setPhotoState.isPending} /><span className="text-xs">{photo.adminHidden ? "Hidden" : "Visible"}</span></div></TableCell><TableCell><Input className="h-8 w-28" type="number" min="0" max="10000" value={photoCrops[photo.id] ?? String(photo.bottomCrop)} onChange={(event) => setPhotoCrops({ ...photoCrops, [photo.id]: event.target.value })} /></TableCell><TableCell className="text-right"><Button size="sm" variant="outline" disabled={setPhotoState.isPending} onClick={() => { const bottomCrop = Number(photoCrops[photo.id] ?? photo.bottomCrop); if (!Number.isInteger(bottomCrop) || bottomCrop < 0 || bottomCrop > 10000) { toast.error("Bottom crop must be a whole number from 0 to 10,000."); return; } setPhotoState.mutate({ id: photo.id, bottomCrop }); }}>Save crop</Button></TableCell></TableRow>)}
              {overview.photos.length === 0 && <TableRow><TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">No Builder Deals photos have been imported.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section title="Buyer leads & active access" icon={Users} description="Flags, contact details, and FUB delivery state are private operational records. Blocking a lead also revokes every current access link for that lead.">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Lead</TableHead><TableHead>Contact</TableHead><TableHead>Attribution</TableHead><TableHead>Flags</TableHead><TableHead>Access</TableHead><TableHead>FUB</TableHead><TableHead>Created</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
            <TableBody>
              {overview.leads.map((lead) => <TableRow key={lead.id}><TableCell><p className="font-medium">{lead.name || "Unnamed buyer"}</p><p className="text-xs text-muted-foreground">{lead.instagramHandle ? `@${lead.instagramHandle}` : "No Instagram handle"}</p></TableCell><TableCell className="text-xs">{lead.phoneE164}<br />{lead.email || "—"}</TableCell><TableCell><p className="text-xs">{lead.sourceCode}</p><p className="text-xs text-muted-foreground">{lead.timeline || "No timeline"}</p></TableCell><TableCell className="max-w-56"><div className="flex flex-wrap gap-1">{flagValues(lead.flags).length ? flagValues(lead.flags).map((flag, index) => <Badge key={`${flag}-${index}`} variant="secondary" className="max-w-40 truncate text-[10px]">{flag}</Badge>) : <span className="text-xs text-muted-foreground">None</span>}</div></TableCell><TableCell><Badge variant={lead.status === "verified" ? "default" : lead.status === "blocked" ? "destructive" : "secondary"}>{lead.status}</Badge><p className="mt-1 text-[10px] text-muted-foreground">Expires {displayDate(lead.expiresAt)}</p></TableCell><TableCell><Badge variant={lead.fubStatus === "synced" ? "default" : lead.fubStatus === "failed" ? "destructive" : "secondary"}>{lead.fubStatus}</Badge></TableCell><TableCell className="whitespace-nowrap text-xs">{displayDate(lead.createdAt)}</TableCell><TableCell className="text-right">{lead.status !== "blocked" ? <Button size="sm" variant="destructive" onClick={() => { setLeadToBlock(lead.id); setLeadBlockReason(""); }}><Ban className="mr-1 h-3.5 w-3.5" /> Block & revoke</Button> : <span className="text-xs text-muted-foreground">Blocked</span>}</TableCell></TableRow>)}
              {overview.leads.length === 0 && <TableRow><TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">No Builder Deals leads have been recorded.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </Section>

      <div className="grid gap-8 xl:grid-cols-2">
        <Section title="Blocklist" icon={Ban} description="Add a durable phone, email, or device block. Removing a block does not restore a previously revoked link.">
          <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label>Phone</Label><Input value={blockForm.phone} onChange={(event) => setBlockForm({ ...blockForm, phone: event.target.value })} placeholder="+15125550123" /></div><div className="space-y-1.5"><Label>Email</Label><Input type="email" value={blockForm.email} onChange={(event) => setBlockForm({ ...blockForm, email: event.target.value })} placeholder="name@example.com" /></div><div className="space-y-1.5 sm:col-span-2"><Label>Device hash</Label><Input value={blockForm.deviceHash} onChange={(event) => setBlockForm({ ...blockForm, deviceHash: event.target.value })} placeholder="Optional hashed device identifier" /></div><div className="space-y-1.5 sm:col-span-2"><Label>Reason</Label><Textarea rows={2} value={blockForm.reason} onChange={(event) => setBlockForm({ ...blockForm, reason: event.target.value })} placeholder="Required internal reason" /></div><Button className="sm:col-span-2 bg-gold text-primary-foreground hover:bg-gold/90" disabled={addBlock.isPending} onClick={submitBlock}><Plus className="mr-1 h-4 w-4" />{addBlock.isPending ? "Adding…" : "Add block"}</Button></div>
          <div className="mt-6 max-h-96 overflow-auto border border-border"><Table><TableHeader><TableRow><TableHead>Identifier</TableHead><TableHead>Reason</TableHead><TableHead>Added</TableHead><TableHead /></TableRow></TableHeader><TableBody>{overview.blocks.map((block) => <TableRow key={block.id}><TableCell className="text-xs">{block.phoneE164 || block.email || masked(block.deviceHash)}</TableCell><TableCell className="max-w-44 text-xs">{block.reason}</TableCell><TableCell className="whitespace-nowrap text-xs">{displayDate(block.createdAt)}</TableCell><TableCell className="text-right"><Button size="sm" variant="ghost" className="text-destructive" disabled={unblock.isPending} onClick={() => { if (window.confirm("Remove this Builder Deals block?")) unblock.mutate({ id: block.id }); }}>Unblock</Button></TableCell></TableRow>)}{overview.blocks.length === 0 && <TableRow><TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">No active blocks.</TableCell></TableRow>}</TableBody></Table></div>
        </Section>

        <Section title="Eligibility allowlists" icon={ShieldAlert} description="Team members may be recognized separately from buyer screening. Known agents are retained as a protected block/screening source.">
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="border border-border p-4"><h3 className="font-medium">Add known agent</h3><p className="mt-1 text-[11px] text-muted-foreground">CSV, recruiting, or manual identity source.</p><div className="mt-4 space-y-3"><Input value={knownAgentForm.name} onChange={(event) => setKnownAgentForm({ ...knownAgentForm, name: event.target.value })} placeholder="Name" /><Input value={knownAgentForm.phoneE164} onChange={(event) => setKnownAgentForm({ ...knownAgentForm, phoneE164: event.target.value })} placeholder="Phone (E.164)" /><Input type="email" value={knownAgentForm.email} onChange={(event) => setKnownAgentForm({ ...knownAgentForm, email: event.target.value })} placeholder="Email" /><Select value={knownAgentForm.source} onValueChange={(source) => setKnownAgentForm({ ...knownAgentForm, source: source as KnownAgentForm["source"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="manual">Manual</SelectItem><SelectItem value="csv">CSV</SelectItem><SelectItem value="fub_recruit">FUB Recruit</SelectItem></SelectContent></Select><Button className="w-full" variant="outline" disabled={addKnownAgent.isPending} onClick={submitKnownAgent}>Add known agent</Button></div></div>
            <div className="border border-border p-4"><h3 className="font-medium">Add team allowlist</h3><p className="mt-1 text-[11px] text-muted-foreground">Recognized team identities may access the team flow.</p><div className="mt-4 space-y-3"><Input value={teamForm.name} onChange={(event) => setTeamForm({ ...teamForm, name: event.target.value })} placeholder="Name" /><Input value={teamForm.phoneE164} onChange={(event) => setTeamForm({ ...teamForm, phoneE164: event.target.value })} placeholder="Phone (E.164)" /><Input type="email" value={teamForm.email} onChange={(event) => setTeamForm({ ...teamForm, email: event.target.value })} placeholder="Email" /><Select value={teamForm.source} onValueChange={(source) => setTeamForm({ ...teamForm, source: source as TeamForm["source"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="manual">Manual</SelectItem><SelectItem value="fub">FUB</SelectItem><SelectItem value="test">Test</SelectItem></SelectContent></Select><Button className="w-full" variant="outline" disabled={addTeam.isPending} onClick={submitTeam}>Add team allowlist</Button></div></div>
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div className="max-h-64 overflow-auto border border-border"><Table><TableHeader><TableRow><TableHead>Known agent</TableHead><TableHead>Source</TableHead><TableHead>Added</TableHead></TableRow></TableHeader><TableBody>{overview.agents.map((agent) => <TableRow key={agent.id}><TableCell><p className="font-medium text-sm">{agent.name || "Unnamed"}</p><p className="text-xs text-muted-foreground">{agent.phoneE164 || agent.email || "No contact identifier"}</p></TableCell><TableCell><Badge variant="secondary">{agent.source}</Badge></TableCell><TableCell className="whitespace-nowrap text-xs">{displayDate(agent.createdAt)}</TableCell></TableRow>)}{overview.agents.length === 0 && <TableRow><TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">No known agents recorded.</TableCell></TableRow>}</TableBody></Table></div>
            <div className="max-h-64 overflow-auto border border-border"><Table><TableHeader><TableRow><TableHead>Team member</TableHead><TableHead>Source</TableHead><TableHead>Added</TableHead></TableRow></TableHeader><TableBody>{overview.team.map((member) => <TableRow key={member.id}><TableCell><p className="font-medium text-sm">{member.name || "Unnamed"}</p><p className="text-xs text-muted-foreground">{member.phoneE164 || member.email || "No contact identifier"}</p></TableCell><TableCell><Badge variant="secondary">{member.source}</Badge></TableCell><TableCell className="whitespace-nowrap text-xs">{displayDate(member.createdAt)}</TableCell></TableRow>)}{overview.team.length === 0 && <TableRow><TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">No team allowlist entries.</TableCell></TableRow>}</TableBody></Table></div>
          </div>
        </Section>
      </div>

      <div className="grid gap-8 xl:grid-cols-2">
        <Section title="Tour & inquiry activity" icon={Eye} description="Private request activity from verified catalog sessions.">
          <div className="mb-4 grid grid-cols-2 gap-3"><Metric label="Tour requests" value={overview.tours.filter((tour) => tour.requestType === "tour").length} /><Metric label="Questions / asks" value={overview.tours.filter((tour) => tour.requestType === "ask").length} /></div>
          <div className="max-h-[30rem] overflow-auto border border-border"><Table><TableHeader><TableRow><TableHead>Request</TableHead><TableHead>Lead</TableHead><TableHead>Home</TableHead><TableHead>Preferred time</TableHead><TableHead>CRM task</TableHead></TableRow></TableHeader><TableBody>{overview.tours.map((tour) => <TableRow key={tour.id}><TableCell><Badge variant={tour.requestType === "tour" ? "default" : "secondary"}>{tour.requestType}</Badge><p className="mt-1 text-[10px] text-muted-foreground">{displayDate(tour.createdAt)}</p></TableCell><TableCell>#{tour.leadId}</TableCell><TableCell>#{tour.homeId}</TableCell><TableCell className="whitespace-nowrap text-xs">{displayDate(tour.preferredAt)}</TableCell><TableCell>{tour.fubTaskId ? <Badge className="bg-gold text-primary-foreground">Created</Badge> : <Badge variant="secondary">Pending</Badge>}</TableCell></TableRow>)}{overview.tours.length === 0 && <TableRow><TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">No tour or question requests yet.</TableCell></TableRow>}</TableBody></Table></div>
        </Section>

        <Section title="TREC verification status" icon={CheckCircle2} description="Latest official-dataset verification results remain available only to administrators.">
          <div className="mb-4 flex flex-wrap gap-4 text-xs text-muted-foreground"><span>Latest import: <strong className="text-foreground">{overview.import ? displayDate(overview.import.completedAt) : "Not imported"}</strong></span><span>Rows: <strong className="text-foreground">{overview.import?.rowCount?.toLocaleString() ?? "—"}</strong></span><span>Current: <strong className="text-foreground">{overview.import?.current ? "Yes" : "No"}</strong></span></div>
          <div className="max-h-[30rem] overflow-auto border border-border"><Table><TableHeader><TableRow><TableHead>Team member</TableHead><TableHead>License</TableHead><TableHead>Status</TableHead><TableHead>Checked</TableHead></TableRow></TableHeader><TableBody>{overview.checks.map((check) => <TableRow key={check.id}><TableCell className="font-medium">{check.fullName}</TableCell><TableCell>{check.licenseNumber || "—"}</TableCell><TableCell><Badge variant={check.status.toLowerCase().includes("fail") ? "destructive" : "secondary"}>{check.status}</Badge></TableCell><TableCell className="whitespace-nowrap text-xs">{displayDate(check.verifiedAt)}</TableCell></TableRow>)}{overview.checks.length === 0 && <TableRow><TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">No completed TREC checks yet.</TableCell></TableRow>}</TableBody></Table></div>
        </Section>
      </div>

      <Dialog open={leadToBlock !== null} onOpenChange={(open) => { if (!open && !blockLeadAndKillLink.isPending) { setLeadToBlock(null); setLeadBlockReason(""); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Block lead and revoke access</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="border border-destructive/30 bg-destructive/5 p-3 text-sm"><p className="flex items-center gap-2 font-medium text-destructive"><AlertTriangle className="h-4 w-4" /> This immediately revokes the lead’s access links.</p><p className="mt-1 text-muted-foreground">{selectedLead ? `${selectedLead.name || "Unnamed buyer"} · ${selectedLead.phoneE164}` : "Selected buyer"} will be added to the blocklist using their private lead identifiers.</p></div>
            <div className="space-y-1.5"><Label htmlFor="lead-block-reason">Internal reason</Label><Textarea id="lead-block-reason" rows={3} value={leadBlockReason} onChange={(event) => setLeadBlockReason(event.target.value)} placeholder="Required internal reason" /></div>
          </div>
          <DialogFooter><Button variant="outline" disabled={blockLeadAndKillLink.isPending} onClick={() => { setLeadToBlock(null); setLeadBlockReason(""); }}>Cancel</Button><Button variant="destructive" disabled={blockLeadAndKillLink.isPending || leadBlockReason.trim().length < 3} onClick={() => { if (leadToBlock !== null) blockLeadAndKillLink.mutate({ leadId: leadToBlock, reason: leadBlockReason.trim() }); }}><Ban className="mr-1 h-4 w-4" />{blockLeadAndKillLink.isPending ? "Blocking…" : "Block & revoke"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
