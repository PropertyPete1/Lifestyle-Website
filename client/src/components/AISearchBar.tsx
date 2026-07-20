import { useState } from "react";
import { useLocation } from "wouter";
import { Sparkles, Search, HelpCircle, ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const EXAMPLE_QUERIES = [
  "3 bedroom home under $400K with a pool in San Antonio",
  "Single story new construction under $500K",
  "4 bedroom with primary bedroom on the first floor",
  "Townhome or condo in Austin under $450K",
];

/**
 * AI natural-language property search entry.
 * Visitor describes what they want in plain English; we route to /search
 * with the query — the Search page runs it through the AI matcher.
 * Complements (does not replace) filters, City Finder, and Featured Listings.
 */
export default function AISearchBar({ autoFocus = false }: { autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [, navigate] = useLocation();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = q.trim();
    if (!trimmed) return;
    navigate(`/search?q=${encodeURIComponent(trimmed)}`);
  };

  const runExample = (example: string) => {
    setHelpOpen(false);
    navigate(`/search?q=${encodeURIComponent(example)}`);
  };

  return (
    <form onSubmit={submit} className="w-full">
      <div className="eyebrow text-gold text-center mb-4 flex items-center justify-center gap-2">
        <Sparkles className="h-3.5 w-3.5" /> Describe Your Dream Home
        <Popover open={helpOpen} onOpenChange={setHelpOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="How the AI search works"
              className="text-muted-foreground hover:text-gold transition-colors -my-1 p-1">
              <HelpCircle className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="center"
            sideOffset={8}
            className="w-[340px] sm:w-[400px] bg-card border-border rounded-none p-5 text-left">
            <p className="text-[10px] uppercase tracking-[0.25em] text-gold">How it works</p>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed normal-case tracking-normal">
              Just type what you're looking for the way you'd say it out loud — price,
              beds, city, pool, single story, anything. Our AI reads your sentence,
              turns it into search filters, and shows you the homes that match.
            </p>
            <p className="mt-4 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              Try one of these
            </p>
            <ul className="mt-2 space-y-1.5">
              {EXAMPLE_QUERIES.map((ex) => (
                <li key={ex}>
                  <button
                    type="button"
                    onClick={() => runExample(ex)}
                    className="group flex w-full items-start gap-2 text-left text-sm text-foreground/90 hover:text-gold transition-colors normal-case tracking-normal">
                    <ArrowRight className="h-3.5 w-3.5 mt-0.5 shrink-0 text-gold opacity-60 group-hover:opacity-100" />
                    <span className="italic">"{ex}"</span>
                  </button>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus={autoFocus}
            placeholder={'Try "3 bedroom home under $400K with a pool in San Antonio"'}
            className="bg-secondary/60 border-border pl-11 h-12 text-sm rounded-none"
          />
        </div>
        <Button
          type="submit"
          className="bg-gold text-primary-foreground hover:bg-gold/90 uppercase tracking-[0.18em] text-[11px] h-12 px-6 rounded-none shrink-0">
          Search
        </Button>
      </div>
    </form>
  );
}
