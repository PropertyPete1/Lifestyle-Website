import { useEffect, useId, useState } from "react";
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
  DialogDescription,
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
  CircleAlert,
  Eye,
  FilePenLine,
  HeartPulse,
  Home,
  Image,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldAlert,
  Upload,
  UserRoundCheck,
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
  testTeamNumbers: string[];
  activeReelCodes: string[];
  brokerageDomains: string[];
  fubRealtorTags: string[];
  fubRealtorSources: string[];
  handleKeywords: string[];
  trecCounties: string[];
  alertRecipients: string[];
  alertMode: "immediate" | "hourly_digest";
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
};

type TeamForm = {
  name: string;
  phoneE164: string;
  email: string;
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
  testTeamNumbers: [],
  activeReelCodes: [],
  brokerageDomains: [],
  fubRealtorTags: [],
  fubRealtorSources: [],
  handleKeywords: [],
  trecCounties: [],
  alertRecipients: ["peter@lifestyledesignrealty.com", "steven@lifestyledesignrealty.com"],
  alertMode: "immediate",
};

const EMPTY_BLOCK: BlockForm = { phone: "", email: "", deviceHash: "", reason: "" };
const EMPTY_KNOWN_AGENT: KnownAgentForm = { name: "", phoneE164: "", email: "" };
const EMPTY_TEAM: TeamForm = { name: "", phoneE164: "", email: "" };
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
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
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
      testTeamNumbers: draft.testTeamNumbers,
      activeReelCodes: draft.activeReelCodes,
      brokerageDomains: draft.brokerageDomains,
      fubRealtorTags: draft.fubRealtorTags,
      fubRealtorSources: draft.fubRealtorSources,
      handleKeywords: draft.handleKeywords,
      trecCounties: draft.trecCounties,
      alertRecipients: draft.alertRecipients,
      alertMode: draft.alertMode,
    });
  };

  const numberField = (label: string, key: "expiryHours" | "hasAgentBlockDays" | "incentiveLapseDays" | "dailyVerificationCap" | "phoneLimitPerHour" | "ipLimitPerHour" | "testPhoneLimitPerHour", min: number, max: number) => (
    <div className="space-y-1.5">
      <Label htmlFor={`builder-deals-${key}`}>{label}</Label>
      <Input
        id={`builder-deals-${key}`}
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
      action={<Button onClick={submit} disabled={saveSettings.isPending} className="w-full bg-gold text-primary-foreground hover:bg-gold/90 sm:w-auto"><Save className="mr-1 h-4 w-4" />{saveSettings.isPending ? "Saving…" : "Save settings"}</Button>}
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
          <Label htmlFor="builder-deals-alert-mode">Alert delivery</Label>
          <Select value={draft.alertMode} onValueChange={(value) => setDraft({ ...draft, alertMode: value as SettingsDraft["alertMode"] })}>
            <SelectTrigger id="builder-deals-alert-mode"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="immediate">Immediate alerts</SelectItem>
              <SelectItem value="hourly_digest">Hourly digest</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-4 border border-border px-3 py-2.5">
          <div><Label htmlFor="builder-deals-allow-canada">Allow Canadian phone numbers</Label><p className="text-[11px] text-muted-foreground">US-only remains the default funnel behavior.</p></div>
          <Switch id="builder-deals-allow-canada" checked={draft.allowCanada} onCheckedChange={(allowCanada) => setDraft({ ...draft, allowCanada })} />
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
          <div key={item.key} className="flex items-start justify-between gap-3 border border-border p-3">
            <span><strong className="text-sm">{item.title}</strong><span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">{item.note}</span></span>
            <Switch aria-label={item.title} checked={draft[item.key]} onCheckedChange={(checked) => setDraft({ ...draft, [item.key]: checked })} />
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <ListField label="Test numbers" value={draft.testNumbers} onChange={(testNumbers) => setDraft({ ...draft, testNumbers })} placeholder="+15125550123" hint="One E.164 number per line. The server normalizes and validates every value." />
        <ListField label="Test team numbers" value={draft.testTeamNumbers} onChange={(testTeamNumbers) => setDraft({ ...draft, testTeamNumbers })} placeholder="+15125550123" hint="One E.164 test team number per line. These are recognized by the protected team-preview flow." />
        <ListField label="Active reel codes" value={draft.activeReelCodes} onChange={(activeReelCodes) => setDraft({ ...draft, activeReelCodes })} placeholder="sl1" hint="Only these sanitized attribution codes are accepted by the buyer funnel." />
        <ListField label="Brokerage domains" value={draft.brokerageDomains} onChange={(brokerageDomains) => setDraft({ ...draft, brokerageDomains })} placeholder="examplebrokerage.com" hint="Domains used to identify broker/agent identities before link issuance." />
        <ListField label="FUB REALTOR® tags" value={draft.fubRealtorTags} onChange={(fubRealtorTags) => setDraft({ ...draft, fubRealtorTags })} placeholder="Recruit" hint="Follow Up Boss tags that should be screened as real-estate professionals." />
        <ListField label="FUB REALTOR® sources" value={draft.fubRealtorSources} onChange={(fubRealtorSources) => setDraft({ ...draft, fubRealtorSources })} placeholder="Agent Referral" hint="Follow Up Boss sources that trigger the same protected screening." />
        <ListField label="Instagram handle keywords" value={draft.handleKeywords} onChange={(handleKeywords) => setDraft({ ...draft, handleKeywords })} placeholder="realty" hint="Keywords used in the profile-based REALTOR® screening signal." />
        <ListField label="TREC counties" value={draft.trecCounties} onChange={(trecCounties) => setDraft({ ...draft, trecCounties })} placeholder="Bexar" hint="Counties included when checking the official TREC data." />
        <ListField label="Alert email recipients" value={draft.alertRecipients} onChange={(alertRecipients) => setDraft({ ...draft, alertRecipients })} placeholder="peter@lifestyledesignrealty.com" hint="One mailbox per line. Resend emails every saved recipient when RESEND_API_KEY is configured; otherwise the project-owner fallback is logged." />
      </div>
    </Section>
  );
}

function BuilderDealsAdminContent() {
  const utils = trpc.useUtils();
  const overviewQuery = trpc.deals.admin.overview.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const settingsQuery = trpc.deals.admin.settings.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  // Health performs credential availability checks, so run it only when an
  // administrator explicitly asks instead of on every admin-page visit.
  const healthQuery = trpc.deals.admin.health.useQuery(undefined, { enabled: false, retry: false });
  const overview = overviewQuery.data;
  const settings = settingsQuery.data;
  const [blockForm, setBlockForm] = useState<BlockForm>(EMPTY_BLOCK);
  const [knownAgentForm, setKnownAgentForm] = useState<KnownAgentForm>(EMPTY_KNOWN_AGENT);
  const [teamForm, setTeamForm] = useState<TeamForm>(EMPTY_TEAM);
  const [doNotAutoImport, setDoNotAutoImport] = useState({ value: "", kind: "phone" as "phone" | "email" });
  const [knownAgentsCsv, setKnownAgentsCsv] = useState("");
  const [knownAgentsCsvName, setKnownAgentsCsvName] = useState("");
  const [manualHomeForm, setManualHomeForm] = useState<ManualHomeForm>(EMPTY_MANUAL_HOME);
  const [reelDrafts, setReelDrafts] = useState<Record<number, string>>({});
  const [photoCrops, setPhotoCrops] = useState<Record<number, string>>({});
  const [leadToBlock, setLeadToBlock] = useState<number | null>(null);
  const [leadToMakeTeam, setLeadToMakeTeam] = useState<number | null>(null);
  const [leadBlockReason, setLeadBlockReason] = useState("");
  const [confirmCapIncrease, setConfirmCapIncrease] = useState(false);
  const [trecFakeName, setTrecFakeName] = useState("");
  const [confirmTrecFake, setConfirmTrecFake] = useState(false);

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
  const importKnownAgentsCsv = trpc.deals.admin.importKnownAgentsCsv.useMutation({
    onSuccess: (result) => {
      refreshOverview();
      setKnownAgentsCsv("");
      setKnownAgentsCsvName("");
      toast.success(`CSV import complete: ${result.imported} imported, ${result.skipped} skipped, ${result.linksKilled} access link${result.linksKilled === 1 ? "" : "s"} revoked.`);
    },
    onError: mutationError,
  });
  const addDoNotAutoImport = trpc.deals.admin.addDoNotAutoImport.useMutation({
    onSuccess: () => {
      refreshOverview();
      setDoNotAutoImport({ value: "", kind: "phone" });
      toast.success("Auto-import exclusion saved");
    },
    onError: mutationError,
  });
  const addTeam = trpc.deals.admin.addTeam.useMutation({
    onSuccess: () => { refreshOverview(); setTeamForm(EMPTY_TEAM); toast.success("Team allowlist entry added"); },
    onError: mutationError,
  });
  const makeLeadTeam = trpc.deals.admin.makeLeadTeam.useMutation({
    onSuccess: () => { refreshOverview(); setLeadToMakeTeam(null); toast.success("Lead added to team preview"); },
    onError: mutationError,
  });
  const raiseDailyVerificationCap = trpc.deals.admin.raiseDailyVerificationCap.useMutation({
    onSuccess: (nextSettings) => {
      void utils.deals.admin.settings.invalidate();
      setConfirmCapIncrease(false);
      toast.success(`Daily verification cap raised to ${nextSettings.dailyVerificationCap.toLocaleString()}`);
    },
    onError: mutationError,
  });
  const runFubRetry = trpc.deals.admin.runFubRetry.useMutation({
    onSuccess: (result) => {
      refreshOverview();
      toast.success(`CRM retry pass complete: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped.`);
    },
    onError: mutationError,
  });
  const runAlertDelivery = trpc.deals.admin.runAlertDelivery.useMutation({
    onSuccess: (result) => {
      refreshOverview();
      toast.success(`Alert delivery pass complete: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped.`);
    },
    onError: mutationError,
  });
  const retryFub = trpc.deals.admin.retryFub.useMutation({
    onSuccess: (result) => {
      refreshOverview();
      toast.success(`CRM retry complete: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped.`);
    },
    onError: mutationError,
  });
  const refreshOfficialSources = trpc.deals.admin.refreshCommunity.useMutation({
    onSuccess: () => { refreshOverview(); toast.success("Official source refresh completed"); },
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
  const addTrecFakeRow = trpc.deals.admin.addTrecFakeRow.useMutation({
    onSuccess: (result) => { refreshOverview(); setTrecFakeName(""); setConfirmTrecFake(false); toast.success(`Test-only TREC fixture saved: ${result.fullName}`); },
    onError: mutationError,
  });
  const mondayReport = trpc.deals.admin.mondayReport.useQuery(undefined, { enabled: false, retry: false });
  const blockLeadAndKillLink = trpc.deals.admin.blockLeadAndKillLink.useMutation({
    onSuccess: () => { refreshOverview(); setLeadToBlock(null); setLeadBlockReason(""); toast.success("Lead blocked and access link revoked"); },
    onError: mutationError,
  });

  if (overviewQuery.isLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-gold" /> Loading Builder Deals operations…
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
            <Button className="mt-4 w-full sm:w-auto" variant="outline" onClick={() => void overviewQuery.refetch()}><RefreshCw className="mr-1 h-4 w-4" /> Try again</Button>
          </div>
        </div>
      </section>
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
  const selectedTeamLead = overview.leads.find((lead) => lead.id === leadToMakeTeam);

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
      source: "manual",
    });
  };

  const submitKnownAgentsCsv = () => {
    if (knownAgentsCsv.trim().length < 2) {
      toast.error("Choose or paste a CSV with at least a header row.");
      return;
    }
    importKnownAgentsCsv.mutate({ csv: knownAgentsCsv });
  };

  const readKnownAgentsCsv = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2_000_000) {
      toast.error("CSV files must be 2 MB or smaller.");
      return;
    }
    void file.text().then((csv) => {
      setKnownAgentsCsv(csv);
      setKnownAgentsCsvName(file.name);
    }).catch(() => toast.error("That CSV could not be read on this device."));
  };

  const submitDoNotAutoImport = () => {
    if (doNotAutoImport.value.trim().length < 3) {
      toast.error("Enter a phone number or email address with at least three characters.");
      return;
    }
    addDoNotAutoImport.mutate({ value: doNotAutoImport.value.trim(), kind: doNotAutoImport.kind });
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
      source: "manual",
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
        <Button variant="outline" className="w-full sm:w-auto" onClick={() => void overviewQuery.refetch()} disabled={overviewQuery.isFetching}><RefreshCw className={`mr-1 h-4 w-4 ${overviewQuery.isFetching ? "animate-spin" : ""}`} /> Refresh</Button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Verified buyer leads" value={verifiedLeads} detail={`${overview.leads.length} total leads`} />
        <Metric label="CRM delivery retries" value={failedFub} detail="Failed FUB sync records" tone={failedFub ? "warning" : "default"} />
        <Metric label="Active communities" value={activeCommunities} detail={`${pausedCommunities} paused`} />
        <Metric label="Viewable catalog homes" value={availableHomes} detail="Available home records" />
        <Metric label="Active blocks" value={overview.blocks.length} detail={`${blockedLeads} blocked lead records`} tone={overview.blocks.length ? "warning" : "default"} />
      </div>

      <Section title="Service health & recovery" icon={HeartPulse} description="Checks expose credential and service availability only; no credentials or balance amounts are returned. CRM retries run the already queued work only.">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <div className="border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-medium">Credential and service check</h3>
                <p className="mt-1 text-xs text-muted-foreground">Run on demand. It checks Twilio Verify configuration and service reachability, plus FUB configuration and reachability.</p>
              </div>
              <Button type="button" size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => void healthQuery.refetch()} disabled={healthQuery.isFetching}>
                <HeartPulse className={`mr-1 h-4 w-4 ${healthQuery.isFetching ? "animate-spin" : ""}`} /> {healthQuery.isFetching ? "Checking…" : "Check health"}
              </Button>
            </div>
            {healthQuery.isError && <p role="alert" className="mt-3 text-sm text-destructive">Health check could not be completed. Try again; no settings were changed.</p>}
            {healthQuery.data && <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="border border-border p-3"><p className="text-xs font-medium">Twilio Verify</p><dl className="mt-2 space-y-1 text-xs text-muted-foreground"><div className="flex justify-between gap-3"><dt>Account SID</dt><dd className="text-foreground">{healthQuery.data.twilioVerify.accountSid}</dd></div><div className="flex justify-between gap-3"><dt>Auth token</dt><dd className="text-foreground">{healthQuery.data.twilioVerify.authToken}</dd></div><div className="flex justify-between gap-3"><dt>Service SID</dt><dd className="text-foreground">{healthQuery.data.twilioVerify.serviceSid}</dd></div><div className="flex justify-between gap-3"><dt>Account</dt><dd className="text-foreground">{healthQuery.data.twilioVerify.account}</dd></div><div className="flex justify-between gap-3"><dt>Balance threshold</dt><dd className="text-foreground">{healthQuery.data.twilioVerify.balance}</dd></div></dl></div>
              <div className="border border-border p-3"><p className="text-xs font-medium">Operations</p><dl className="mt-2 space-y-1 text-xs text-muted-foreground"><div className="flex justify-between gap-3"><dt>Follow Up Boss</dt><dd className="text-foreground">{healthQuery.data.fub.availability}</dd></div><div className="flex justify-between gap-3"><dt>TREC freshness</dt><dd className="text-foreground">{healthQuery.data.operational.trecImport.state} · {healthQuery.data.operational.trecImport.ageHours ?? "—"}h</dd></div><div className="flex justify-between gap-3"><dt>Source updates</dt><dd className="text-foreground">{healthQuery.data.operational.sourceUpdates.state} · {healthQuery.data.operational.sourceUpdates.staleCommunities} stale</dd></div><div className="flex justify-between gap-3"><dt>Photo queue</dt><dd className="text-foreground">{healthQuery.data.operational.photos.state} · {healthQuery.data.operational.photos.pending} pending / {healthQuery.data.operational.photos.failed} failed</dd></div><div className="flex justify-between gap-3"><dt>CRM failures</dt><dd className="text-foreground">{healthQuery.data.operational.fubFailures.jobs} jobs / {healthQuery.data.operational.fubFailures.leads} leads</dd></div><div className="flex justify-between gap-3"><dt>Holds</dt><dd className="text-foreground">{healthQuery.data.operational.holds.communities} communities / {healthQuery.data.operational.holds.incentives} incentives</dd></div></dl></div>
            </div>}
            <div className="mt-4 border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-medium">Monday operational report</p><p className="mt-1 text-xs text-muted-foreground">Generates the current seven-check report for review only. It never sends an email or alert.</p></div><Button type="button" size="sm" variant="outline" onClick={() => void mondayReport.refetch()} disabled={mondayReport.isFetching}>{mondayReport.isFetching ? "Generating…" : "Generate no-send report"}</Button></div>
              {mondayReport.data && <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap border border-border bg-muted/20 p-3 text-xs text-muted-foreground">{mondayReport.data.body}</pre>}
              {mondayReport.isError && <p role="alert" className="mt-3 text-xs text-destructive">The report could not be generated. No message was sent.</p>}
            </div>
          </div>
          <div className="border border-border p-4">
            <h3 className="font-medium">Verification capacity</h3>
            <p className="mt-1 text-xs text-muted-foreground">Current daily cap: <strong className="text-foreground">{settings?.dailyVerificationCap?.toLocaleString() ?? "Loading…"}</strong>. The emergency action raises the saved cap by exactly 1,000.</p>
            <label className="mt-4 flex items-start gap-2 text-sm">
              <input type="checkbox" checked={confirmCapIncrease} onChange={(event) => setConfirmCapIncrease(event.target.checked)} disabled={!settings || raiseDailyVerificationCap.isPending} className="mt-0.5 h-4 w-4 accent-[oklch(0.75_0.09_85)]" />
              <span>I understand this immediately increases the daily verification cap by 1,000.</span>
            </label>
            <Button type="button" size="sm" variant="outline" className="mt-4 w-full sm:w-auto" disabled={!settings || !confirmCapIncrease || raiseDailyVerificationCap.isPending} onClick={() => raiseDailyVerificationCap.mutate({ confirm: true })}>
              <Plus className="mr-1 h-4 w-4" /> {raiseDailyVerificationCap.isPending ? "Raising…" : "Raise cap by 1,000"}
            </Button>
          </div>
          <div className="border border-border p-4 lg:max-w-64">
            <h3 className="font-medium">CRM retry pass</h3>
            <p className="mt-1 text-xs text-muted-foreground">Attempts queued FUB work that is due now. It does not create new leads.</p>
            <Button type="button" size="sm" variant="outline" className="mt-4 w-full" disabled={runFubRetry.isPending} onClick={() => runFubRetry.mutate()}>
              <RotateCcw className={`mr-1 h-4 w-4 ${runFubRetry.isPending ? "animate-spin" : ""}`} /> {runFubRetry.isPending ? "Retrying…" : "Run due retries"}
            </Button>
            <div className="mt-5 border-t border-border pt-4">
              <h3 className="font-medium">Alert delivery</h3>
              <p className="mt-1 text-xs text-muted-foreground">{overview.email.provider === "resend" ? `Resend routes alerts to ${overview.email.recipients.length} saved recipient${overview.email.recipients.length === 1 ? "" : "s"}.` : "Resend is unavailable; every fallback is logged for review."}</p>
              <Button type="button" size="sm" variant="outline" className="mt-4 w-full" disabled={runAlertDelivery.isPending} onClick={() => runAlertDelivery.mutate()}>
                <RotateCcw className={`mr-1 h-4 w-4 ${runAlertDelivery.isPending ? "animate-spin" : ""}`} /> {runAlertDelivery.isPending ? "Sending…" : "Send due alerts"}
              </Button>
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="Community launch controls"
        icon={Building2}
        description="Pause a community to remove it from the buyer catalog. Manual mode prevents scheduled source changes. The private builder mapping below is intentionally rendered only in this role-gated panel. Official source refresh runs every configured official source, not only the selected row."
        action={overview.communities.length > 0 ? <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={refreshOfficialSources.isPending} onClick={() => refreshOfficialSources.mutate({ id: overview.communities[0].id })}><RefreshCw className={`mr-1 h-4 w-4 ${refreshOfficialSources.isPending ? "animate-spin" : ""}`} /> {refreshOfficialSources.isPending ? "Refreshing…" : "Refresh official sources"}</Button> : undefined}
      >
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

      {settingsQuery.isLoading && <section className="border border-border bg-card p-5 text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin text-gold" /> Loading Builder Deals settings…</section>}
      {settingsQuery.isError && <section role="alert" className="border border-destructive/40 bg-destructive/5 p-5"><p className="font-medium text-destructive">Settings are unavailable</p><p className="mt-1 text-sm text-muted-foreground">Settings were not loaded, so no default values are available to save.</p><Button variant="outline" className="mt-4 w-full sm:w-auto" onClick={() => void settingsQuery.refetch()}>Try loading settings again</Button></section>}
      {settings && <SettingsEditor settings={settings} />}

      <Section title="Manual home entry" icon={Home} description="Add or update a manually curated home record. This form writes the private source and address data to the protected Builder Deals catalog only.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5"><Label htmlFor="manual-home-community">Community</Label><Select value={manualHomeForm.communityId} onValueChange={(communityId) => setManualHomeForm({ ...manualHomeForm, communityId })}><SelectTrigger id="manual-home-community"><SelectValue placeholder="Choose community" /></SelectTrigger><SelectContent>{overview.communities.map((community) => <SelectItem key={community.id} value={String(community.id)}>{community.publicLabel}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5 xl:col-span-2"><Label htmlFor="manual-home-source-url">Private source URL</Label><Input id="manual-home-source-url" type="url" value={manualHomeForm.sourceUrl} onChange={(event) => setManualHomeForm({ ...manualHomeForm, sourceUrl: event.target.value })} placeholder="https://builder.example/home" /></div>
          <div className="space-y-1.5"><Label htmlFor="manual-home-kind">Home kind</Label><Select value={manualHomeForm.kind} onValueChange={(kind) => setManualHomeForm({ ...manualHomeForm, kind: kind as ManualHomeForm["kind"] })}><SelectTrigger id="manual-home-kind"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="quick_move_in">Quick move-in</SelectItem><SelectItem value="to_be_built">To be built</SelectItem></SelectContent></Select></div>
          <div className="space-y-1.5"><Label htmlFor="manual-home-address">Private address</Label><Input id="manual-home-address" value={manualHomeForm.privateAddress} onChange={(event) => setManualHomeForm({ ...manualHomeForm, privateAddress: event.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="manual-home-plan">Private plan name</Label><Input id="manual-home-plan" value={manualHomeForm.privatePlanName} onChange={(event) => setManualHomeForm({ ...manualHomeForm, privatePlanName: event.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="manual-home-beds">Beds</Label><Input id="manual-home-beds" inputMode="decimal" value={manualHomeForm.beds} onChange={(event) => setManualHomeForm({ ...manualHomeForm, beds: event.target.value })} placeholder="4" /></div>
          <div className="space-y-1.5"><Label htmlFor="manual-home-baths">Baths</Label><Input id="manual-home-baths" inputMode="decimal" value={manualHomeForm.baths} onChange={(event) => setManualHomeForm({ ...manualHomeForm, baths: event.target.value })} placeholder="3.5" /></div>
          <div className="space-y-1.5"><Label htmlFor="manual-home-sqft">Square feet</Label><Input id="manual-home-sqft" type="number" inputMode="numeric" min="0" value={manualHomeForm.sqft} onChange={(event) => setManualHomeForm({ ...manualHomeForm, sqft: event.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="manual-home-price">Price</Label><Input id="manual-home-price" type="number" inputMode="numeric" min="0" value={manualHomeForm.price} onChange={(event) => setManualHomeForm({ ...manualHomeForm, price: event.target.value })} /></div>
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

      <Section title="Buyer leads & active access" icon={Users} description="Flags, contact details, and FUB delivery state are private operational records. Blocking a lead revokes every current access link; adding a lead to team preview changes the lead status and allowlists that identity.">
        <div className="overflow-x-auto">
          <Table className="min-w-[56rem]">
            <TableHeader><TableRow><TableHead>Lead</TableHead><TableHead>Contact</TableHead><TableHead>Attribution</TableHead><TableHead>Flags</TableHead><TableHead>Access</TableHead><TableHead>FUB</TableHead><TableHead>Created</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
            <TableBody>
              {overview.leads.map((lead) => <TableRow key={lead.id}><TableCell><p className="font-medium">{lead.name || "Unnamed buyer"}</p><p className="text-xs text-muted-foreground">{lead.instagramHandle ? `@${lead.instagramHandle}` : "No Instagram handle"}</p></TableCell><TableCell className="text-xs">{lead.phoneE164}<br />{lead.email || "—"}</TableCell><TableCell><p className="text-xs">{lead.sourceCode}</p><p className="text-xs text-muted-foreground">{lead.timeline || "No timeline"}</p></TableCell><TableCell className="max-w-56"><div className="flex flex-wrap gap-1">{flagValues(lead.flags).length ? flagValues(lead.flags).map((flag, index) => <Badge key={`${flag}-${index}`} variant="secondary" className="max-w-40 truncate text-[10px]">{flag}</Badge>) : <span className="text-xs text-muted-foreground">None</span>}</div></TableCell><TableCell><Badge variant={lead.status === "verified" ? "default" : lead.status === "blocked" ? "destructive" : "secondary"}>{lead.status}</Badge><p className="mt-1 text-[10px] text-muted-foreground">Expires {displayDate(lead.expiresAt)}</p></TableCell><TableCell><Badge variant={lead.fubStatus === "synced" ? "default" : lead.fubStatus === "failed" ? "destructive" : "secondary"}>{lead.fubStatus}</Badge></TableCell><TableCell className="whitespace-nowrap text-xs">{displayDate(lead.createdAt)}</TableCell><TableCell><div className="flex min-w-40 flex-col gap-2 sm:items-end">{lead.status === "verified" && <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => setLeadToMakeTeam(lead.id)}><UserRoundCheck className="mr-1 h-3.5 w-3.5" /> Team preview</Button>}{lead.status !== "blocked" ? <Button size="sm" variant="destructive" className="w-full sm:w-auto" onClick={() => { setLeadToBlock(lead.id); setLeadBlockReason(""); }}><Ban className="mr-1 h-3.5 w-3.5" /> Block & revoke</Button> : <span className="text-xs text-muted-foreground">Blocked</span>}</div></TableCell></TableRow>)}
              {overview.leads.length === 0 && <TableRow><TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">No Builder Deals leads have been recorded.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section title="CRM delivery queue" icon={RotateCcw} description="Shows durable Follow Up Boss delivery jobs. A manual retry is available only for failed jobs; it requeues and runs that existing job once.">
        <div className="overflow-x-auto">
          <Table className="min-w-[48rem]">
            <TableHeader><TableRow><TableHead>Lead</TableHead><TableHead>Operation</TableHead><TableHead>Status</TableHead><TableHead>Attempts</TableHead><TableHead>Next attempt</TableHead><TableHead>Last error</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
            <TableBody>
              {overview.fubJobs.map((job) => <TableRow key={job.id}><TableCell>#{job.leadId}</TableCell><TableCell className="text-xs">{job.operation.replaceAll("_", " ")}</TableCell><TableCell><Badge variant={job.status === "synced" ? "default" : job.status === "failed" ? "destructive" : "secondary"}>{job.status}</Badge></TableCell><TableCell>{job.attempts}</TableCell><TableCell className="whitespace-nowrap text-xs">{displayDate(job.nextAttemptAt)}</TableCell><TableCell className="max-w-64 text-xs">{job.lastError || "—"}</TableCell><TableCell className="text-right">{job.status === "failed" ? <Button size="sm" variant="outline" className="w-full sm:w-auto" disabled={retryFub.isPending} onClick={() => retryFub.mutate({ id: job.id })}><RotateCcw className="mr-1 h-3.5 w-3.5" /> {retryFub.isPending ? "Retrying…" : "Retry once"}</Button> : <span className="text-xs text-muted-foreground">—</span>}</TableCell></TableRow>)}
              {overview.fubJobs.length === 0 && <TableRow><TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">No CRM delivery jobs have been created.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section title="Buyer alert delivery" icon={CircleAlert} description="First unlocks and newly discovered profile screening flags are queued durably. Immediate mode sends independently; hourly mode combines due alerts into one email per recipient set.">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Badge variant={overview.email.provider === "resend" ? "default" : "secondary"}>{overview.email.provider === "resend" ? "Resend configured" : "Owner-only fallback"}</Badge><span>{overview.email.recipients.length ? overview.email.recipients.join(", ") : "No alert recipients configured"}</span></div>
        <div className="overflow-x-auto">
          <Table className="min-w-[54rem]">
            <TableHeader><TableRow><TableHead>Alert</TableHead><TableHead>Lead</TableHead><TableHead>Mode</TableHead><TableHead>Status</TableHead><TableHead>Scheduled</TableHead><TableHead>Delivery</TableHead><TableHead>Attempts</TableHead></TableRow></TableHeader>
            <TableBody>
              {overview.alerts.map((alert) => <TableRow key={alert.id}><TableCell><p className="font-medium text-sm">{alert.kind.replaceAll("_", " ")}</p><p className="max-w-64 truncate text-xs text-muted-foreground" title={alert.subject}>{alert.subject}</p></TableCell><TableCell>#{alert.leadId}</TableCell><TableCell><Badge variant="secondary">{alert.deliveryMode === "immediate" ? "Immediate" : "Hourly digest"}</Badge></TableCell><TableCell><Badge variant={alert.status === "sent" ? "default" : alert.status === "failed" ? "destructive" : "secondary"}>{alert.status}</Badge></TableCell><TableCell className="whitespace-nowrap text-xs">{displayDate(alert.scheduledFor)}</TableCell><TableCell className="max-w-52 text-xs">{alert.deliveryLog || alert.lastError || "Pending"}</TableCell><TableCell>{alert.attempts}</TableCell></TableRow>)}
              {overview.alerts.length === 0 && <TableRow><TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">No first-unlock or profile-flag alerts have been queued.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
        <div className="mt-5 overflow-x-auto">
          <Table className="min-w-[54rem]">
            <TableHeader><TableRow><TableHead>Sent / attempted</TableHead><TableHead>Category</TableHead><TableHead>Provider</TableHead><TableHead>Recipients</TableHead><TableHead>Outcome</TableHead><TableHead>Log</TableHead></TableRow></TableHeader>
            <TableBody>
              {overview.emailLogs.map((log) => <TableRow key={log.id}><TableCell className="whitespace-nowrap text-xs">{displayDate(log.createdAt)}</TableCell><TableCell>{log.category.replaceAll("_", " ")}</TableCell><TableCell>{log.provider === "resend" ? "Resend" : "Owner notification"}</TableCell><TableCell className="max-w-56 truncate text-xs" title={log.recipients}>{log.recipients}</TableCell><TableCell><Badge variant={log.deliveryStatus === "sent" ? "default" : log.deliveryStatus === "failed" ? "destructive" : "secondary"}>{log.deliveryStatus.replaceAll("_", " ")}</Badge></TableCell><TableCell className="text-xs">{log.deliveryLog}</TableCell></TableRow>)}
              {overview.emailLogs.length === 0 && <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">No email delivery attempts have been recorded.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </Section>

      <div className="grid gap-8 xl:grid-cols-2">
        <Section title="Blocklist" icon={Ban} description="Add a durable phone, email, or device block. Removing a block does not restore a previously revoked link.">
          <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label>Phone</Label><Input value={blockForm.phone} onChange={(event) => setBlockForm({ ...blockForm, phone: event.target.value })} placeholder="+15125550123" /></div><div className="space-y-1.5"><Label>Email</Label><Input type="email" value={blockForm.email} onChange={(event) => setBlockForm({ ...blockForm, email: event.target.value })} placeholder="name@example.com" /></div><div className="space-y-1.5 sm:col-span-2"><Label>Device hash</Label><Input value={blockForm.deviceHash} onChange={(event) => setBlockForm({ ...blockForm, deviceHash: event.target.value })} placeholder="Optional hashed device identifier" /></div><div className="space-y-1.5 sm:col-span-2"><Label>Reason</Label><Textarea rows={2} value={blockForm.reason} onChange={(event) => setBlockForm({ ...blockForm, reason: event.target.value })} placeholder="Required internal reason" /></div><Button className="sm:col-span-2 bg-gold text-primary-foreground hover:bg-gold/90" disabled={addBlock.isPending} onClick={submitBlock}><Plus className="mr-1 h-4 w-4" />{addBlock.isPending ? "Adding…" : "Add block"}</Button></div>
          <div className="mt-6 max-h-96 overflow-auto border border-border"><Table><TableHeader><TableRow><TableHead>Identifier</TableHead><TableHead>Reason</TableHead><TableHead>Added</TableHead><TableHead /></TableRow></TableHeader><TableBody>{overview.blocks.map((block) => <TableRow key={block.id}><TableCell className="text-xs">{block.phoneE164 || block.email || masked(block.deviceHash)}</TableCell><TableCell className="max-w-44 text-xs">{block.reason}</TableCell><TableCell className="whitespace-nowrap text-xs">{displayDate(block.createdAt)}</TableCell><TableCell className="text-right"><Button size="sm" variant="ghost" className="text-destructive" disabled={unblock.isPending} onClick={() => { if (window.confirm("Remove this Builder Deals block?")) unblock.mutate({ id: block.id }); }}>Unblock</Button></TableCell></TableRow>)}{overview.blocks.length === 0 && <TableRow><TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">No active blocks.</TableCell></TableRow>}</TableBody></Table></div>
        </Section>

        <Section title="Screening & team controls" icon={ShieldAlert} description="Manual entries are stored with their actual source. Use CSV import for CSV source records. Exclusions keep a phone or email out of automatic known-agent imports.">
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-5 border border-border p-4"><div><h3 className="font-medium">Add known agent manually</h3><p className="mt-1 text-[11px] text-muted-foreground">Add at least one identifier. This creates a manual record and can revoke matching active buyer links.</p></div><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="known-agent-name">Name</Label><Input id="known-agent-name" value={knownAgentForm.name} onChange={(event) => setKnownAgentForm({ ...knownAgentForm, name: event.target.value })} /></div><div className="space-y-1.5"><Label htmlFor="known-agent-phone">Phone (E.164)</Label><Input id="known-agent-phone" inputMode="tel" value={knownAgentForm.phoneE164} onChange={(event) => setKnownAgentForm({ ...knownAgentForm, phoneE164: event.target.value })} placeholder="+15125550123" /></div><div className="space-y-1.5 sm:col-span-2"><Label htmlFor="known-agent-email">Email</Label><Input id="known-agent-email" type="email" autoComplete="email" value={knownAgentForm.email} onChange={(event) => setKnownAgentForm({ ...knownAgentForm, email: event.target.value })} placeholder="name@example.com" /></div></div><Button className="w-full" variant="outline" disabled={addKnownAgent.isPending} onClick={submitKnownAgent}>{addKnownAgent.isPending ? "Adding…" : "Add known agent"}</Button></div>
            <div className="space-y-5 border border-border p-4"><div><h3 className="font-medium">Import known-agent CSV</h3><p className="mt-1 text-[11px] text-muted-foreground">Accepted headers: name or full name, phone, and email. Up to 2 MB. Records are normalized and invalid rows are skipped server-side.</p></div><div className="space-y-1.5"><Label htmlFor="known-agent-csv">CSV file</Label><Input id="known-agent-csv" type="file" accept=".csv,text/csv" onChange={(event) => readKnownAgentsCsv(event.target.files?.[0])} /></div><div className="space-y-1.5"><Label htmlFor="known-agent-csv-paste">Or paste CSV</Label><Textarea id="known-agent-csv-paste" rows={4} value={knownAgentsCsv} onChange={(event) => { setKnownAgentsCsv(event.target.value); setKnownAgentsCsvName(""); }} placeholder={'name,phone,email\nJane Doe,+15125550123,jane@example.com'} /></div>{knownAgentsCsvName && <p className="text-xs text-muted-foreground">Ready to import: {knownAgentsCsvName}</p>}<Button className="w-full" variant="outline" disabled={importKnownAgentsCsv.isPending || knownAgentsCsv.trim().length < 2} onClick={submitKnownAgentsCsv}><Upload className="mr-1 h-4 w-4" /> {importKnownAgentsCsv.isPending ? "Importing…" : "Import CSV"}</Button></div>
            <div className="space-y-5 border border-border p-4"><div><h3 className="font-medium">Add team allowlist manually</h3><p className="mt-1 text-[11px] text-muted-foreground">Recognized team identities may use the team-preview flow. Add at least one identifier.</p></div><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="team-name">Name</Label><Input id="team-name" value={teamForm.name} onChange={(event) => setTeamForm({ ...teamForm, name: event.target.value })} /></div><div className="space-y-1.5"><Label htmlFor="team-phone">Phone (E.164)</Label><Input id="team-phone" inputMode="tel" value={teamForm.phoneE164} onChange={(event) => setTeamForm({ ...teamForm, phoneE164: event.target.value })} placeholder="+15125550123" /></div><div className="space-y-1.5 sm:col-span-2"><Label htmlFor="team-email">Email</Label><Input id="team-email" type="email" autoComplete="email" value={teamForm.email} onChange={(event) => setTeamForm({ ...teamForm, email: event.target.value })} placeholder="name@example.com" /></div></div><Button className="w-full" variant="outline" disabled={addTeam.isPending} onClick={submitTeam}>{addTeam.isPending ? "Adding…" : "Add team allowlist"}</Button></div>
            <div className="space-y-5 border border-border p-4"><div><h3 className="font-medium">Prevent automatic known-agent import</h3><p className="mt-1 text-[11px] text-muted-foreground">This exclusion applies to automatic known-agent imports. It does not remove an existing record or block visitor access.</p></div><div className="space-y-1.5"><Label htmlFor="do-not-auto-import-kind">Identifier type</Label><Select value={doNotAutoImport.kind} onValueChange={(kind) => setDoNotAutoImport({ ...doNotAutoImport, kind: kind as "phone" | "email" })}><SelectTrigger id="do-not-auto-import-kind"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="phone">Phone</SelectItem><SelectItem value="email">Email</SelectItem></SelectContent></Select></div><div className="space-y-1.5"><Label htmlFor="do-not-auto-import-value">{doNotAutoImport.kind === "phone" ? "Phone number" : "Email address"}</Label><Input id="do-not-auto-import-value" type={doNotAutoImport.kind === "email" ? "email" : "tel"} inputMode={doNotAutoImport.kind === "email" ? "email" : "tel"} autoComplete="off" value={doNotAutoImport.value} onChange={(event) => setDoNotAutoImport({ ...doNotAutoImport, value: event.target.value })} placeholder={doNotAutoImport.kind === "email" ? "name@example.com" : "+15125550123"} /></div><Button className="w-full" variant="outline" disabled={addDoNotAutoImport.isPending} onClick={submitDoNotAutoImport}>{addDoNotAutoImport.isPending ? "Saving…" : "Save exclusion"}</Button></div>
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div className="max-h-64 overflow-auto border border-border"><Table><TableHeader><TableRow><TableHead>Known agent</TableHead><TableHead>Source</TableHead><TableHead>Added</TableHead></TableRow></TableHeader><TableBody>{overview.agents.map((agent) => <TableRow key={agent.id}><TableCell><p className="font-medium text-sm">{agent.name || "Unnamed"}</p><p className="text-xs text-muted-foreground">{agent.phoneE164 || agent.email || "No contact identifier"}</p></TableCell><TableCell><Badge variant="secondary">{agent.source}</Badge></TableCell><TableCell className="whitespace-nowrap text-xs">{displayDate(agent.createdAt)}</TableCell></TableRow>)}{overview.agents.length === 0 && <TableRow><TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">No known agents recorded.</TableCell></TableRow>}</TableBody></Table></div>
            <div className="max-h-64 overflow-auto border border-border"><Table><TableHeader><TableRow><TableHead>Team member</TableHead><TableHead>Source</TableHead><TableHead>Added</TableHead></TableRow></TableHeader><TableBody>{overview.team.map((member) => <TableRow key={member.id}><TableCell><p className="font-medium text-sm">{member.name || "Unnamed"}</p><p className="text-xs text-muted-foreground">{member.phoneE164 || member.email || "No contact identifier"}</p></TableCell><TableCell><Badge variant="secondary">{member.source}</Badge></TableCell><TableCell className="whitespace-nowrap text-xs">{displayDate(member.createdAt)}</TableCell></TableRow>)}{overview.team.length === 0 && <TableRow><TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">No team allowlist entries.</TableCell></TableRow>}</TableBody></Table></div>
          </div>
          <div className="mt-5 max-h-64 overflow-auto border border-border"><Table><TableHeader><TableRow><TableHead>Auto-import exclusion</TableHead><TableHead>Type</TableHead><TableHead>Added</TableHead></TableRow></TableHeader><TableBody>{overview.doNotAutoImport.map((entry) => <TableRow key={entry.id}><TableCell className="font-mono text-xs">{entry.value}</TableCell><TableCell><Badge variant="secondary">{entry.kind}</Badge></TableCell><TableCell className="whitespace-nowrap text-xs">{displayDate(entry.createdAt)}</TableCell></TableRow>)}{overview.doNotAutoImport.length === 0 && <TableRow><TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">No automatic-import exclusions.</TableCell></TableRow>}</TableBody></Table></div>
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
          <DialogHeader><DialogTitle>Block lead and revoke access</DialogTitle><DialogDescription>This operation immediately blocks the selected buyer identity and revokes all of that lead’s active Builder Deals access links.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="border border-destructive/30 bg-destructive/5 p-3 text-sm"><p className="flex items-center gap-2 font-medium text-destructive"><AlertTriangle className="h-4 w-4" /> This immediately revokes the lead’s access links.</p><p className="mt-1 text-muted-foreground">{selectedLead ? `${selectedLead.name || "Unnamed buyer"} · ${selectedLead.phoneE164}` : "Selected buyer"} will be added to the blocklist using their private lead identifiers.</p></div>
            <div className="space-y-1.5"><Label htmlFor="lead-block-reason">Internal reason</Label><Textarea id="lead-block-reason" rows={3} value={leadBlockReason} onChange={(event) => setLeadBlockReason(event.target.value)} placeholder="Required internal reason" /></div>
          </div>
          <DialogFooter><Button variant="outline" disabled={blockLeadAndKillLink.isPending} onClick={() => { setLeadToBlock(null); setLeadBlockReason(""); }}>Cancel</Button><Button variant="destructive" disabled={blockLeadAndKillLink.isPending || leadBlockReason.trim().length < 3} onClick={() => { if (leadToBlock !== null) blockLeadAndKillLink.mutate({ leadId: leadToBlock, reason: leadBlockReason.trim() }); }}><Ban className="mr-1 h-4 w-4" />{blockLeadAndKillLink.isPending ? "Blocking…" : "Block & revoke"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={leadToMakeTeam !== null} onOpenChange={(open) => { if (!open && !makeLeadTeam.isPending) setLeadToMakeTeam(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Enable team preview</DialogTitle><DialogDescription>This changes the selected verified lead to team status and adds their identifiers to the team allowlist.</DialogDescription></DialogHeader>
          <div className="border border-gold/30 bg-gold/5 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium"><UserRoundCheck className="h-4 w-4 text-gold" /> Team preview does not create buyer tour requests.</p>
            <p className="mt-1 text-muted-foreground">{selectedTeamLead ? `${selectedTeamLead.name || "Unnamed buyer"} · ${selectedTeamLead.phoneE164}` : "Selected lead"} will be able to use the protected team-preview flow.</p>
          </div>
          <DialogFooter><Button variant="outline" disabled={makeLeadTeam.isPending} onClick={() => setLeadToMakeTeam(null)}>Cancel</Button><Button disabled={makeLeadTeam.isPending} className="bg-gold text-primary-foreground hover:bg-gold/90" onClick={() => { if (leadToMakeTeam !== null) makeLeadTeam.mutate({ leadId: leadToMakeTeam }); }}><UserRoundCheck className="mr-1 h-4 w-4" />{makeLeadTeam.isPending ? "Enabling…" : "Enable team preview"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
