import { useMemo, useState } from "react";
import { useLocation, useRoute } from "wouter";
import PageShell from "@/components/PageShell";
import LeadForm from "@/components/LeadForm";
import FinancingBanner from "@/components/FinancingBanner";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Heart,
  ArrowRight,
  ArrowLeft,
  Share2,
  Copy,
  MessageCircle,
  Sparkles,
  MapPin,
  Check,
} from "lucide-react";

const LIFESTYLE_OPTIONS = [
  "Lake/Water Life",
  "Nightlife & Food Scene",
  "Space & Land",
  "Top-Rated Schools",
  "Short Commute",
  "Low Taxes & Cost of Living",
  "Outdoor/Hill Country Living",
  "Family-Friendly Community",
] as const;

/** Fixed, compliance-reviewed financing copy — NEVER AI-generated. */
function FinancingLine() {
  return <FinancingBanner />;
}

/** Result screen — used both right after generation and for shared links. */
function PitchResult({
  pitch,
  city,
  stats,
  partnerName,
  slug,
}: {
  pitch: string;
  city: string;
  stats: string[];
  partnerName?: string;
  slug: string;
}) {
  const shareUrl = `${window.location.origin}/convince/${slug}`;
  const shareText = partnerName
    ? `${partnerName}, I found our life in Texas. Read this:`
    : "I found our life in Texas. Read this:";

  const nativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Our Life in Texas", text: shareText, url: shareUrl });
        return;
      } catch {
        /* user cancelled */
      }
    } else {
      copyLink();
    }
  };
  const copyLink = () => {
    navigator.clipboard.writeText(shareUrl).then(
      () => toast.success("Link copied — send it to them!"),
      () => toast.error("Couldn't copy. Long-press the URL to copy manually.")
    );
  };

  return (
    <div className="text-center">
      <p className="inline-flex items-center gap-2 eyebrow text-gold">
        <Sparkles className="h-3.5 w-3.5" />
        {partnerName ? `Written for ${partnerName}` : "Written for you two"}
      </p>
      <div className="mt-6 flex items-center justify-center gap-2 text-gold">
        <MapPin className="h-4 w-4" />
        <p className="text-xs uppercase tracking-[0.3em]">{city}, Texas</p>
      </div>
      <blockquote className="mt-8 font-serif text-2xl md:text-3xl leading-relaxed text-foreground/95 italic">
        {pitch}
      </blockquote>

      {stats.length > 0 && (
        <div className="mt-10 grid sm:grid-cols-2 gap-3 text-left">
          {stats.map((s) => (
            <div key={s} className="flex items-start gap-3 border border-border bg-card px-5 py-4">
              <Check className="h-4 w-4 text-gold mt-0.5 shrink-0" />
              <p className="text-sm text-muted-foreground leading-relaxed">{s}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8">
        <FinancingLine />
      </div>

      {/* One-tap share */}
      <div className="mt-10 flex flex-wrap justify-center gap-3">
        <button
          onClick={nativeShare}
          className="inline-flex items-center gap-2 bg-gold text-primary-foreground px-8 py-4 text-[11px] uppercase tracking-[0.2em] hover:bg-gold/90 transition-colors active:scale-[0.97]">
          <Share2 className="h-4 w-4" /> Share This
        </button>
        <button
          onClick={copyLink}
          className="inline-flex items-center gap-2 border border-border px-8 py-4 text-[11px] uppercase tracking-[0.2em] hover:border-gold hover:text-gold transition-colors active:scale-[0.97]">
          <Copy className="h-4 w-4" /> Copy Link
        </button>
        <a
          href={`sms:?&body=${encodeURIComponent(`${shareText} ${shareUrl}`)}`}
          className="inline-flex items-center gap-2 border border-border px-8 py-4 text-[11px] uppercase tracking-[0.2em] hover:border-gold hover:text-gold transition-colors active:scale-[0.97]">
          <MessageCircle className="h-4 w-4" /> Text It
        </a>
      </div>

      {/* Optional soft CTA — never required */}
      <div className="mt-16 border-t border-border pt-12 max-w-lg mx-auto">
        <h3 className="font-serif text-2xl">Want us to build your full moving plan?</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Totally optional — leave your email and we'll map out what the move actually looks like.
        </p>
        <div className="mt-6 text-left">
          <LeadForm
            sourceTag="Website - Convince Your Partner"
            submitLabel="Build My Moving Plan"
            compact
            extraAnswers={{ matchedCity: city, pitchSlug: slug }}
          />
        </div>
      </div>
    </div>
  );
}

/** Shared-link view: /convince/:slug — reproduces the identical cached result. */
export function ConvinceShared() {
  const [, params] = useRoute("/convince/:slug");
  const slug = params?.slug ?? "";
  const { data, isLoading } = trpc.partnerPitch.getBySlug.useQuery({ slug }, { enabled: !!slug });
  const [, navigate] = useLocation();

  return (
    <PageShell solidNav>
      <div className="mx-auto max-w-3xl px-5 lg:px-8 pt-28 lg:pt-36 pb-24">
        {isLoading ? (
          <p className="text-center text-muted-foreground animate-pulse py-20">
            Opening your letter…
          </p>
        ) : data ? (
          <>
            <PitchResult
              pitch={data.pitch}
              city={data.city}
              stats={data.stats}
              partnerName={data.partnerName}
              slug={data.slug}
            />
            <div className="mt-12 text-center">
              <button
                onClick={() => navigate("/convince")}
                className="text-cta inline-flex items-center gap-2">
                Make Your Own <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </>
        ) : (
          <div className="text-center py-20">
            <p className="font-serif text-2xl">This link has expired or doesn't exist</p>
            <button
              onClick={() => navigate("/convince")}
              className="text-cta mt-6 inline-flex items-center gap-2">
              Start Your Own <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </PageShell>
  );
}

/** Main flow: intro → quiz (multi-select + optional name) → AI result. */
export default function Convince() {
  const [stage, setStage] = useState<"intro" | "quiz" | "result">("intro");
  const [selections, setSelections] = useState<string[]>([]);
  const [partnerName, setPartnerName] = useState("");
  const generate = trpc.partnerPitch.generate.useMutation({
    onSuccess: () => setStage("result"),
    onError: () =>
      toast.error("Something went wrong writing your letter. Please try again in a moment."),
  });

  const toggle = (opt: string) =>
    setSelections((prev) =>
      prev.includes(opt) ? prev.filter((o) => o !== opt) : [...prev, opt]
    );

  const submit = () => {
    if (selections.length === 0) {
      toast.error("Pick at least one — what's the dream?");
      return;
    }
    generate.mutate({
      selections: selections as (typeof LIFESTYLE_OPTIONS)[number][],
      partnerName: partnerName.trim() || undefined,
    });
  };

  const result = generate.data;

  return (
    <PageShell solidNav>
      <div className="mx-auto max-w-3xl px-5 lg:px-8 pt-28 lg:pt-36 pb-24">
        {stage === "intro" && (
          <div className="text-center">
            <p className="inline-flex items-center gap-2 eyebrow text-gold">
              <Heart className="h-3.5 w-3.5" /> Convince Your Partner
            </p>
            <h1 className="display-serif text-4xl md:text-5xl mt-4">
              Moving to Texas, Together
            </h1>
            <p className="mt-8 text-base md:text-lg text-muted-foreground leading-relaxed max-w-xl mx-auto">
              Are you in the situation where you want to move to Texas but need help convincing
              your partner? Let us help. Share this with them and let us handle the convincing —
              and see firsthand how good we are at negotiating, so you know you're getting the
              best possible deal on your new home.
            </p>
            <button
              onClick={() => setStage("quiz")}
              className="mt-10 inline-flex items-center gap-2 bg-gold text-primary-foreground px-10 py-4 text-[11px] uppercase tracking-[0.2em] hover:bg-gold/90 transition-colors active:scale-[0.97]">
              Start <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {stage === "quiz" && (
          <div className="text-center">
            <p className="eyebrow text-gold">Step 1 of 1 — no typing required</p>
            <h2 className="font-serif text-3xl md:text-4xl mt-3">What's your dream life?</h2>
            <p className="mt-3 text-sm text-muted-foreground">Pick everything that applies.</p>
            <div className="mt-8 grid sm:grid-cols-2 gap-3">
              {LIFESTYLE_OPTIONS.map((opt) => {
                const on = selections.includes(opt);
                return (
                  <button
                    key={opt}
                    onClick={() => toggle(opt)}
                    className={cn(
                      "flex items-center justify-between border px-6 py-5 text-sm uppercase tracking-[0.12em] transition-colors text-left",
                      on ? "border-gold text-gold bg-gold/5" : "border-border hover:border-gold/70 hover:text-gold"
                    )}>
                    {opt}
                    {on && <Check className="h-4 w-4 shrink-0" />}
                  </button>
                );
              })}
            </div>
            <div className="mt-8 max-w-sm mx-auto text-left">
              <label className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                What's their name? <span className="normal-case tracking-normal">(optional, first name only)</span>
              </label>
              <input
                value={partnerName}
                onChange={(e) => setPartnerName(e.target.value)}
                maxLength={30}
                placeholder="e.g. Jordan"
                className="mt-2 w-full bg-secondary/60 border border-border px-4 py-3 text-sm outline-none focus:border-gold transition-colors"
              />
            </div>
            <div className="mt-10 flex items-center justify-center gap-6">
              <button
                onClick={() => setStage("intro")}
                className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground hover:text-gold">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
              <button
                onClick={submit}
                disabled={generate.isPending}
                className="inline-flex items-center gap-2 bg-gold text-primary-foreground px-10 py-4 text-[11px] uppercase tracking-[0.2em] hover:bg-gold/90 transition-colors active:scale-[0.97] disabled:opacity-60">
                {generate.isPending ? (
                  <>
                    <Sparkles className="h-4 w-4 animate-pulse" /> Writing your letter…
                  </>
                ) : (
                  <>
                    Write the Case <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {stage === "result" && result && (
          <PitchResult
            pitch={result.pitch}
            city={result.city}
            stats={result.stats}
            partnerName={result.partnerName}
            slug={result.slug}
          />
        )}
      </div>
    </PageShell>
  );
}
