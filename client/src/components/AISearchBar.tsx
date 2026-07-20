import { useState } from "react";
import { useLocation } from "wouter";
import { Sparkles, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * AI natural-language property search entry.
 * Visitor describes what they want in plain English; we route to /search
 * with the query — the Search page runs it through the AI matcher.
 * Complements (does not replace) filters, City Finder, and Featured Listings.
 */
export default function AISearchBar({ autoFocus = false }: { autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [, navigate] = useLocation();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = q.trim();
    if (!trimmed) return;
    navigate(`/search?q=${encodeURIComponent(trimmed)}`);
  };

  return (
    <form onSubmit={submit} className="w-full">
      <p className="eyebrow text-gold text-center mb-4 flex items-center justify-center gap-2">
        <Sparkles className="h-3.5 w-3.5" /> Describe Your Dream Home
      </p>
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
