import { useMemo, useState } from "react";
import PageShell from "@/components/PageShell";
import LeadForm from "@/components/LeadForm";
import { SITE } from "@shared/site";
import { IMG } from "@/lib/assets";
import { cn } from "@/lib/utils";
import { ArrowLeft, ArrowRight, MapPin } from "lucide-react";

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

export default function CityFinder() {
  const [step, setStep] = useState(0); // 0..QUESTIONS.length-1, then gate, then results
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [unlocked, setUnlocked] = useState(false);

  const total = QUESTIONS.length;
  const atGate = step >= total;

  const matches = useMemo(() => {
    return [...CITY_PROFILES]
      .map((c) => ({ ...c, points: c.score(answers) }))
      .sort((a, b) => b.points - a.points)
      .slice(0, 3);
  }, [answers]);

  const select = (key: string, value: string) => {
    setAnswers((a) => ({ ...a, [key]: value }));
    setTimeout(() => setStep((s) => s + 1), 220);
  };

  return (
    <PageShell solidNav>
      <div className="mx-auto max-w-3xl px-5 lg:px-8 pt-28 lg:pt-36 pb-24">
        <p className="eyebrow text-gold text-center">Signature Tool</p>
        <h1 className="display-serif text-4xl md:text-5xl mt-3 text-center">Find Your Texas City</h1>

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
              ? "Your Matches"
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
                onSuccess={() => setUnlocked(true)}
              />
            </div>
            <button
              onClick={() => setStep(total - 1)}
              className="mt-6 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground hover:text-gold">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to questions
            </button>
          </div>
        )}

        {/* Results */}
        {atGate && unlocked && (
          <div className="mt-12 space-y-8">
            {matches.map((c, i) => (
              <div key={c.slug} className="border border-border bg-card overflow-hidden md:flex">
                <div className="md:w-2/5 aspect-[4/3] md:aspect-auto relative">
                  <img src={c.img} alt={c.name} className="h-full w-full object-cover" />
                  <span className="absolute top-4 left-4 bg-gold text-primary-foreground px-3 py-1 text-[10px] uppercase tracking-[0.2em]">
                    Match #{i + 1}
                  </span>
                </div>
                <div className="p-6 lg:p-8 md:w-3/5">
                  <div className="flex items-center gap-2 text-gold">
                    <MapPin className="h-4 w-4" />
                    <h3 className="font-serif text-2xl">{c.name}</h3>
                  </div>
                  <p className="mt-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Median price {c.medianPrice}
                  </p>
                  <p className="mt-4 font-serif italic text-foreground/90">{c.vibe}</p>
                  <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{c.why(answers)}</p>
                  <a
                    href={SITE.newConstructionUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-cta mt-6 inline-flex items-center gap-2">
                    Find New Builds in {c.name} <ArrowRight className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            ))}
            <p className="text-center text-xs text-muted-foreground pt-4">
              A Lifestyle Design Realty professional will follow up with your full report.
            </p>
          </div>
        )}
      </div>
    </PageShell>
  );
}
