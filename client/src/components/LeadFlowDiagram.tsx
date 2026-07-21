import { useEffect, useRef, useState } from "react";
import { Inbox, Gauge, UserCheck, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Recruiting-focused visual proof of the lead system (real functionality):
 * Lead comes in → AI scores intent (Hot/Warm/Cold) → Routed to the right agent.
 * Steps light up in sequence when scrolled into view; a gold "lead dot"
 * travels along the connector between steps. Show, don't tell.
 */
const STEPS = [
  {
    icon: Inbox,
    title: "Lead Comes In",
    line: "Every form on this site — search, valuation, City Finder, Get Started — feeds one pipeline.",
  },
  {
    icon: Gauge,
    title: "AI Scores Intent",
    line: "Timeline, motivation, and behavior score each lead Hot, Warm, or Cold — instantly.",
  },
  {
    icon: UserCheck,
    title: "Routed to the Right Agent",
    line: "Scored leads land in Follow Up Boss, tagged and assigned — no cherry-picking, no cold lists.",
  },
] as const;

const INTENT_BADGES = ["Hot", "Warm", "Cold"] as const;

export default function LeadFlowDiagram() {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) {
      setActive(2);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          io.disconnect();
          // Light steps up in sequence
          [0, 1, 2].forEach((i) => setTimeout(() => setActive(i), 300 + i * 700));
        }
      },
      { threshold: 0.35 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className="relative">
      <div className="grid md:grid-cols-3 gap-10 md:gap-6">
        {STEPS.map((s, i) => {
          const on = active >= i;
          const Icon = s.icon;
          return (
            <div key={s.title} className="relative flex flex-col items-center text-center px-2">
              {/* Connector to next step (desktop) */}
              {i < 2 && (
                <div className="hidden md:block absolute top-8 left-[calc(50%+3rem)] right-[calc(-50%+3rem)] h-px bg-border overflow-hidden">
                  <div
                    className={cn(
                      "h-full bg-gold transition-transform duration-700 origin-left",
                      active > i ? "scale-x-100" : "scale-x-0"
                    )}
                  />
                </div>
              )}
              <div
                className={cn(
                  "flex h-16 w-16 items-center justify-center border transition-all duration-500",
                  on ? "border-gold text-gold shadow-[0_0_28px_-8px_var(--gold)]" : "border-border text-muted-foreground/50"
                )}>
                <Icon className="h-6 w-6" strokeWidth={1.5} />
              </div>
              <p className={cn("eyebrow mt-5 transition-colors duration-500", on ? "text-gold" : "text-muted-foreground/60")}>
                Step {i + 1}
              </p>
              <h3 className={cn("font-serif text-2xl mt-1 transition-colors duration-500", on ? "text-foreground" : "text-muted-foreground/60")}>
                {s.title}
              </h3>
              {/* Intent badges appear under step 2 */}
              {i === 1 && (
                <div className="flex gap-2 mt-3">
                  {INTENT_BADGES.map((b, bi) => (
                    <span
                      key={b}
                      style={{ transitionDelay: `${bi * 140}ms` }}
                      className={cn(
                        "px-2.5 py-0.5 text-[9px] uppercase tracking-[0.2em] border transition-all duration-500",
                        on ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2",
                        b === "Hot" && "border-gold text-gold",
                        b === "Warm" && "border-foreground/40 text-foreground/70",
                        b === "Cold" && "border-border text-muted-foreground"
                      )}>
                      {b}
                    </span>
                  ))}
                </div>
              )}
              <p className={cn("mt-3 text-sm leading-relaxed transition-colors duration-500", on ? "text-muted-foreground" : "text-muted-foreground/40")}>
                {s.line}
              </p>
              {/* Mobile connector arrow */}
              {i < 2 && (
                <ArrowRight className={cn("md:hidden mt-8 h-4 w-4 rotate-90 transition-colors", active > i ? "text-gold" : "text-border")} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
