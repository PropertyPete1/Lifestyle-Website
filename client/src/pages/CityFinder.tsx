import { useMemo, useState } from "react";
import PageShell from "@/components/PageShell";
import LeadForm from "@/components/LeadForm";
import AIStatusSequence from "@/components/AIStatusSequence";
import RevealText from "@/components/RevealText";
import { useActivity } from "@/hooks/useActivity";
import { useCityFinderGenerateTracking, useNcClickTracking } from "@/hooks/usePageTracking";
import { SITE, FEATURES } from "@shared/site";
import { selectCityImage } from "@shared/cityImagery";
import { IMG } from "@/lib/assets";
import { cn } from "@/lib/utils";
import { Link, useRoute, useLocation } from "wouter";
import { ArrowLeft, ArrowRight, Copy, ExternalLink, MapPin, MessageCircle, Share2, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

/* ---------- Quiz definition ---------- */
interface Question {
  key: string;
  title: string;
  subtitle?: string;
  options: { value: string; label: string }[];
}

const QUESTIONS: Question[] = [
  {
    key: "budget",
    title: "What's your budget range?",
    options: [
      { value: "under-300k", label: "Under $300K" },
      { value: "300-500k", label: "$300K – $500K" },
      { value: "500-800k", label: "$500K – $800K" },
      { value: "800k-plus", label: "$800K+" },
    ],
  },
  {
    key: "monthlyComfort",
    title: "What monthly payment feels comfortable?",
    options: [
      { value: "under-2000", label: "Under $2,000" },
      { value: "2000-3000", label: "$2,000 – $3,000" },
      { value: "3000-4500", label: "$3,000 – $4,500" },
      { value: "4500-plus", label: "$4,500+" },
    ],
  },
  {
    key: "buildType",
    title: "New build or resale?",
    options: [
      { value: "new-build", label: "New construction" },
      { value: "resale", label: "Resale / established" },
      { value: "either", label: "Open to either" },
    ],
  },
  {
    key: "lifestyle",
    title: "What matters most to your lifestyle?",
    subtitle: "Pick the one that fits best.",
    options: [
      { value: "schools", label: "Top schools & family life" },
      { value: "nightlife", label: "Nightlife, dining & culture" },
      { value: "land", label: "Land, space & privacy" },
      { value: "commute", label: "Short commute / big-city jobs" },
      { value: "military", label: "Near military bases" },
      { value: "lake-hill", label: "Lake & Hill Country living" },
    ],
  },
  {
    key: "household",
    title: "How large is your household?",
    options: [
      { value: "1-2", label: "1–2 people" },
      { value: "3-4", label: "3–4 people" },
      { value: "5-plus", label: "5+ people" },
    ],
  },
  {
    key: "timeline",
    title: "When are you looking to buy?",
    options: [
      { value: "ASAP", label: "ASAP" },
      { value: "3-6 months", label: "3–6 months" },
      { value: "Just browsing", label: "Just browsing" },
    ],
  },
];

/* ---------- Matching logic ---------- */
interface CityProfile {
  name: string;
  slug: string;
  img: string;
  medianPrice: string;
  vibe: string;
  score: (a: Record<string, string>) => number;
  why: (a: Record<string, string>) => string;
}

const CITY_PROFILES: CityProfile[] = [
  {
    name: "San Antonio",
    slug: "san-antonio",
    img: IMG.citySanAntonio,
    medianPrice: "$310K",
    vibe: "Historic soul, big-city amenities, and Texas's best value for space.",
    score: (a) =>
      (a.budget === "under-300k" || a.budget === "300-500k" ? 3 : 1) +
      (a.lifestyle === "military" ? 4 : 0) +
      (a.lifestyle === "schools" ? 2 : 0) +
      (a.household === "5-plus" ? 2 : 0) +
      (a.buildType === "new-build" ? 2 : 1),
    why: (a) =>
      a.lifestyle === "military"
        ? "Home to Joint Base San Antonio with strong military communities, plus affordable new-build corridors like Alamo Ranch."
        : "Exceptional affordability, established neighborhoods, and booming new-construction suburbs on every side of the city.",
  },
  {
    name: "New Braunfels",
    slug: "new-braunfels",
    img: IMG.cityNewBraunfels,
    medianPrice: "$375K",
    vibe: "River-town charm between two metros — Hill Country weekends, every weekend.",
    score: (a) =>
      (a.lifestyle === "lake-hill" ? 4 : 0) +
      (a.lifestyle === "land" ? 2 : 0) +
      (a.budget === "300-500k" ? 3 : 1) +
      (a.buildType === "new-build" ? 2 : 1) +
      (a.household === "3-4" ? 1 : 0),
    why: () =>
      "Fast-growing river town on the I-35 corridor with strong new-build inventory, Gruene's charm, and easy access to both San Antonio and Austin.",
  },
  {
    name: "Austin",
    slug: "austin",
    img: IMG.cityAustin,
    medianPrice: "$540K",
    vibe: "Tech energy, live music, and a food scene that never slows down.",
    score: (a) =>
      (a.lifestyle === "nightlife" ? 4 : 0) +
      (a.lifestyle === "commute" ? 3 : 0) +
      (a.budget === "500-800k" || a.budget === "800k-plus" ? 3 : 0) +
      (a.household === "1-2" ? 2 : 0),
    why: () =>
      "The center of Texas tech and culture — walkable urban cores, major employers, and suburbs like Kyle offering value minutes from downtown.",
  },
  {
    name: "DFW",
    slug: "dfw",
    img: IMG.cityDfw,
    medianPrice: "$420K",
    vibe: "Corporate powerhouse with endless suburbs — something for every lifestyle.",
    score: (a) =>
      (a.lifestyle === "commute" ? 4 : 0) +
      (a.lifestyle === "schools" ? 3 : 0) +
      (a.buildType === "new-build" ? 3 : 1) +
      (a.budget === "300-500k" || a.budget === "500-800k" ? 2 : 0),
    why: () =>
      "The largest job market in Texas with master-planned communities, elite school districts, and the deepest new-construction inventory in the state.",
  },
  {
    name: "Houston",
    slug: "houston",
    img: IMG.cityHouston,
    medianPrice: "$345K",
    vibe: "Global city, unbeatable diversity, and serious square footage for the money.",
    score: (a) =>
      (a.lifestyle === "nightlife" ? 2 : 0) +
      (a.lifestyle === "commute" ? 2 : 0) +
      (a.budget === "under-300k" || a.budget === "300-500k" ? 3 : 1) +
      (a.household === "5-plus" ? 2 : 0) +
      (a.buildType === "new-build" ? 2 : 1),
    why: () =>
      "World-class dining and energy-sector careers with some of the best price-per-square-foot in any major U.S. metro.",
  },
];

/* ---------- City data for hard facts (non-AI) ---------- */
const CITY_HARD_DATA: Record<string, { priceRange: string; facts: string[] }> = {
  "San Antonio": {
    priceRange: "$180K–$600K",
    facts: ["No state income tax", "Home to Joint Base San Antonio", "Booming new-construction suburbs"],
  },
  "New Braunfels": {
    priceRange: "$250K–$700K",
    facts: ["Comal & Guadalupe Rivers", "One of the fastest-growing cities in TX", "Strong new-build inventory"],
  },
  Austin: {
    priceRange: "$300K–$1.2M",
    facts: ["Major tech employers (Tesla, Apple, Google)", "Nationally ranked food & music scene", "Lake Travis & Barton Springs"],
  },
  DFW: {
    priceRange: "$250K–$900K",
    facts: ["Largest TX job market", "Elite school districts (Prosper, Southlake, Frisco)", "Deepest new-construction inventory"],
  },
  Houston: {
    priceRange: "$200K–$800K",
    facts: ["World-class dining & culture", "Energy & medical career hubs", "Best price-per-sqft of any major metro"],
  },
};

/* ---------- Shared result rendering component ---------- */
function CityMatchResults({
  matches,
  narratives,
  slug,
  answers,
  animate = false,
}: {
  matches: { name: string; slug: string; img: string; medianPrice: string; vibe: string; why: (a: Record<string, string>) => string }[];
  narratives: Record<string, { cityPitch: string; ldrPitch: string }> | null;
  slug: string | null;
  answers: Record<string, string>;
  /** True only for a just-generated result. Shared links / reloads render instantly. */
  animate?: boolean;
}) {
  const logNcClick = useNcClickTracking();

  const shareUrl = slug ? `${window.location.origin}/city-finder/${slug}` : "";
  const shareText = "I just found my Texas city match — check this out:";

  const nativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "My Texas City Match", text: shareText, url: shareUrl });
        return;
      } catch { /* user cancelled */ }
    }
    copyLink();
  };
  const copyLink = () => {
    navigator.clipboard.writeText(shareUrl).then(
      () => toast.success("Link copied!"),
      () => toast.error("Couldn't copy — try long-pressing the URL.")
    );
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <p className="inline-flex items-center gap-2 eyebrow text-gold">
          <Sparkles className="h-3.5 w-3.5" /> Here's what we found for you
        </p>
        <h2 className="font-serif text-3xl md:text-4xl mt-3">Your Texas City Report</h2>
        <p className="mt-3 text-sm text-muted-foreground max-w-md mx-auto">
          Based on your budget, lifestyle, and timeline — ranked for you.
        </p>
      </div>

      {/* City cards */}
      {matches.map((c, i) => {
        const narrative = narratives?.[c.name];
        const hardData = CITY_HARD_DATA[c.name];
        // Vibe-matched imagery: picks the slot fitting the visitor's answers,
        // falling back to the city's landing-page hero.
        const image = selectCityImage(c.name, answers);
        return (
          <div key={c.slug} className="border border-border bg-card overflow-hidden">
            {/* Image + badge */}
            <div className="relative aspect-[16/9] md:aspect-[16/5]">
              <img src={image.src} alt={image.alt} className="h-full w-full object-cover" />
              {/* Bottom scrim: keeps the vibe caption legible on any photo */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/40" />
              <span className="absolute top-4 left-4 bg-gold text-primary-foreground px-3 py-1 text-[10px] uppercase tracking-[0.2em]">
                Match #{i + 1}
              </span>
              {image.label && (
                <span className="absolute bottom-3 left-4 right-4 text-[10px] uppercase tracking-[0.18em] text-gold/90">
                  {image.label}
                </span>
              )}
            </div>
            <div className="p-6 lg:p-8">
              {/* City name + hard data */}
              <div className="flex items-center gap-2 text-gold">
                <MapPin className="h-4 w-4" />
                <h3 className="font-serif text-2xl">{c.name}</h3>
              </div>
              <p className="mt-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Median price {c.medianPrice} · Range {hardData?.priceRange ?? "varies"}
              </p>
              <p className="mt-4 font-serif italic text-foreground/90">{c.vibe}</p>

              {/* Hard facts (non-AI) */}
              {hardData && (
                <ul className="mt-4 space-y-1">
                  {hardData.facts.map((f) => (
                    <li key={f} className="text-sm text-muted-foreground flex items-start gap-2">
                      <span className="text-gold mt-0.5">•</span> {f}
                    </li>
                  ))}
                </ul>
              )}

              {/* AI-generated personalized narrative */}
              {narrative ? (
                <div className="mt-6 border-t border-border pt-6 space-y-4">
                  {/* Progressive reveal on a fresh generation only — shared
                      links and reloads render instantly (see RevealText). */}
                  <RevealText
                    text={narrative.cityPitch}
                    instant={!animate}
                    startDelay={120 + i * 450}
                    className="text-sm leading-relaxed text-foreground/90"
                  />
                  <RevealText
                    text={narrative.ldrPitch}
                    instant={!animate}
                    startDelay={320 + i * 450}
                    className="text-sm leading-relaxed text-muted-foreground italic"
                  />
                </div>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground leading-relaxed">{c.why(answers)}</p>
              )}

              {/* CTAs */}
              <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
                {FEATURES.SHOW_PROPERTY_SEARCH && (
                  <Link
                    href={`/search?city=${encodeURIComponent(c.name)}`}
                    className="text-cta inline-flex items-center gap-2">
                    Browse {c.name} Listings <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                )}
                <Link
                  href={`/${c.slug}`}
                  className="text-cta inline-flex items-center gap-2">
                  Explore {c.name} <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <a
                  href={SITE.newConstructionUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={logNcClick}
                  className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.15em] text-muted-foreground hover:text-gold transition-colors">
                  See New Construction in {c.name} <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>
        );
      })}

      {/* Get Started CTA — the conversion moment */}
      <div className="border-t border-border pt-10 text-center">
        <h3 className="font-serif text-2xl md:text-3xl">Ready to make it happen?</h3>
        <p className="mt-3 text-sm text-muted-foreground max-w-md mx-auto">
          Tell us a little about yourself and we'll build your personalized moving plan — we typically respond within 30 minutes.
        </p>
        <div className="mt-6 text-left max-w-lg mx-auto">
          <LeadForm
            sourceTag="Website - City Finder"
            submitLabel="Get Started"
            compact
            extraAnswers={{ ...answers, matchedCity: matches[0]?.name ?? "", cityFinderSlug: slug ?? "" }}
          />
        </div>
      </div>

      {/* Share Your Match */}
      {slug && (
        <div className="pt-6 text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-4">Share Your Match</p>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              onClick={nativeShare}
              className="inline-flex items-center gap-2 bg-gold text-primary-foreground px-6 py-3 text-[11px] uppercase tracking-[0.2em] hover:bg-gold/90 transition-colors active:scale-[0.97]">
              <Share2 className="h-4 w-4" /> Share
            </button>
            <button
              onClick={copyLink}
              className="inline-flex items-center gap-2 border border-border px-6 py-3 text-[11px] uppercase tracking-[0.2em] hover:border-gold hover:text-gold transition-colors active:scale-[0.97]">
              <Copy className="h-4 w-4" /> Copy Link
            </button>
            <a
              href={`sms:?&body=${encodeURIComponent(`${shareText} ${shareUrl}`)}`}
              className="inline-flex items-center gap-2 border border-border px-6 py-3 text-[11px] uppercase tracking-[0.2em] hover:border-gold hover:text-gold transition-colors active:scale-[0.97]">
              <MessageCircle className="h-4 w-4" /> Text It
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Shared-link page: /city-finder/:slug ---------- */
export function CityFinderShared() {
  const [, params] = useRoute("/city-finder/:slug");
  const slug = params?.slug ?? "";
  const { data, isLoading } = trpc.cityFinder.getBySlug.useQuery({ slug }, { enabled: !!slug });
  const [, navigate] = useLocation();

  // Reconstruct matches from cached data
  const matches = useMemo(() => {
    if (!data) return [];
    return data.rankedCities.map((name) => {
      const profile = CITY_PROFILES.find((p) => p.name === name);
      return profile ?? { name, slug: name.toLowerCase().replace(/\s+/g, "-"), img: "", medianPrice: "—", vibe: "", why: () => "" };
    });
  }, [data]);

  return (
    <PageShell solidNav>
      <div className="ambient-section mx-auto max-w-3xl px-5 lg:px-8 pt-28 lg:pt-36 pb-24">
        {isLoading ? (
          <p className="text-center text-muted-foreground animate-pulse py-20">Loading your city match…</p>
        ) : data ? (
          <>
            <p className="eyebrow text-gold text-center">Signature Tool</p>
            <h1 className="display-serif hero-glow text-4xl md:text-5xl mt-3 text-center">Find Your Texas City</h1>
            <div className="mt-12">
              <CityMatchResults
                matches={matches}
                narratives={data.narratives}
                slug={data.slug}
                answers={data.answers}
              />
            </div>
            <div className="mt-12 text-center">
              <button
                onClick={() => navigate("/city-finder")}
                className="text-cta inline-flex items-center gap-2">
                Take the Quiz Yourself <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </>
        ) : (
          <div className="text-center py-20">
            <p className="font-serif text-2xl">This link has expired or doesn't exist</p>
            <button
              onClick={() => navigate("/city-finder")}
              className="text-cta mt-6 inline-flex items-center gap-2">
              Take the Quiz <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </PageShell>
  );
}

/* ---------- Main quiz page ---------- */
export default function CityFinder() {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [unlocked, setUnlocked] = useState(false);
  const [aiNarratives, setAiNarratives] = useState<Record<string, { cityPitch: string; ldrPitch: string }> | null>(null);
  const [aiSlug, setAiSlug] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  /** True only for the AI result produced in this session — drives the reveal. */
  const [justGenerated, setJustGenerated] = useState(false);
  const logActivity = useActivity();
  const logCityFinderGenerate = useCityFinderGenerateTracking();

  const total = QUESTIONS.length;
  const atGate = step >= total;

  const matches = useMemo(() => {
    return [...CITY_PROFILES]
      .map((c) => ({ ...c, points: c.score(answers) }))
      .sort((a, b) => b.points - a.points)
      .slice(0, 3);
  }, [answers]);

  const generateMutation = trpc.cityFinder.generate.useMutation({
    onSuccess: (data) => {
      setAiNarratives(data.narratives);
      setAiSlug(data.slug);
      setJustGenerated(true);
      setGenerating(false);
      // One event per real AI generation (never on shared-link reads).
      logCityFinderGenerate();
    },
    onError: () => {
      // Graceful fallback: show templated results without AI
      setJustGenerated(false);
      setGenerating(false);
    },
  });

  const handleUnlock = () => {
    logActivity("city_finder", { city: matches[0]?.name, runnerUp: matches[1]?.name });
    setUnlocked(true);
    setGenerating(true);
    generateMutation.mutate({
      answers,
      rankedCities: matches.map((m) => m.name),
    });
  };

  const select = (key: string, value: string) => {
    setAnswers((a) => ({ ...a, [key]: value }));
    setTimeout(() => setStep((s) => s + 1), 220);
  };

  return (
    <PageShell solidNav>
      <div className="ambient-section mx-auto max-w-3xl px-5 lg:px-8 pt-28 lg:pt-36 pb-24">
        <p className="eyebrow text-gold text-center">Signature Tool</p>
        <h1 className="display-serif hero-glow text-4xl md:text-5xl mt-3 text-center">Find Your Texas City</h1>

        {/* Progress */}
        <div className="mt-10 h-px bg-border relative">
          <div
            className="absolute left-0 top-0 h-px bg-gold transition-all duration-500"
            style={{ width: `${Math.min(100, (step / total) * 100)}%` }}
          />
        </div>
        <p className="mt-3 text-[10px] uppercase tracking-[0.25em] text-muted-foreground text-center">
          {atGate
            ? unlocked
              ? generating
                ? "Generating Your Report…"
                : "Your Matches"
              : "One Last Step"
            : `Question ${step + 1} of ${total}`}
        </p>

        {/* Question steps */}
        {!atGate && (
          <div className="mt-12 text-center">
            <h2 className="font-serif text-2xl md:text-3xl">{QUESTIONS[step].title}</h2>
            {QUESTIONS[step].subtitle && (
              <p className="mt-2 text-sm text-muted-foreground">{QUESTIONS[step].subtitle}</p>
            )}
            <div className="mt-8 grid sm:grid-cols-2 gap-3">
              {QUESTIONS[step].options.map((o) => (
                <button
                  key={o.value}
                  onClick={() => select(QUESTIONS[step].key, o.value)}
                  className={cn(
                    "border px-6 py-5 text-sm uppercase tracking-[0.12em] transition-colors text-left",
                    answers[QUESTIONS[step].key] === o.value
                      ? "border-gold text-gold"
                      : "border-border hover:border-gold/70 hover:text-gold"
                  )}>
                  {o.label}
                </button>
              ))}
            </div>
            {step > 0 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="mt-8 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground hover:text-gold">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
            )}
          </div>
        )}

        {/* Gate: lead capture before full results */}
        {atGate && !unlocked && (
          <div className="mt-12">
            <div className="text-center mb-8">
              <h2 className="font-serif text-2xl md:text-3xl">Your matches are ready</h2>
              <p className="mt-3 text-sm text-muted-foreground max-w-md mx-auto">
                Tell us where to send your personalized city report and we'll unlock your top
                matches instantly.
              </p>
            </div>
            <div className="bg-card border border-border p-6 lg:p-8">
              <LeadForm
                sourceTag="Website - City Finder"
                submitLabel="Unlock My Matches"
                compact
                extraAnswers={answers}
                onSuccess={handleUnlock}
              />
            </div>
            <button
              onClick={() => setStep(total - 1)}
              className="mt-6 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground hover:text-gold">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to questions
            </button>
          </div>
        )}

        {/* Generating state — staged status in the site's typography, no spinner */}
        {atGate && unlocked && generating && (
          <div className="mt-12 text-center py-16">
            <p className="eyebrow text-gold">One moment</p>
            <h2 className="font-serif text-3xl md:text-4xl mt-3 mb-8">
              Building your city report…
            </h2>
            <AIStatusSequence
              stages={[
                "Analyzing your priorities…",
                "Comparing 5 Texas markets…",
                "Writing your personalized match…",
              ]}
              interval={1800}
            />
          </div>
        )}

        {/* Results */}
        {atGate && unlocked && !generating && (
          <div className="mt-12">
            <CityMatchResults
              matches={matches}
              narratives={aiNarratives}
              slug={aiSlug}
              answers={answers}
              animate={justGenerated}
            />
          </div>
        )}
      </div>
    </PageShell>
  );
}

