import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { SITE } from "@shared/site";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * High-intent buyer/seller form — THE primary site conversion point.
 * Short by design: name, phone, email, buying/selling, timeline.
 * Posts to FUB tagged "Website - Get Started" with intent scoring.
 * Visually distinct (gold-framed) from the lightweight newsletter form.
 */
export default function GetStartedForm({ compact = false }: { compact?: boolean }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [goal, setGoal] = useState("");
  const [timeline, setTimeline] = useState("");
  const [consent, setConsent] = useState(false);
  const [done, setDone] = useState(false);

  const submit = trpc.leads.submit.useMutation({
    onSuccess: () => {
      setDone(true);
      toast.success("Thank you — we'll be in touch shortly.");
    },
    onError: (err) => toast.error(err.message || "Something went wrong. Please try again."),
  });

  if (done) {
    return (
      <div className="flex flex-col items-center text-center py-12 gap-3">
        <CheckCircle2 className="h-10 w-10 text-gold" />
        <h3 className="font-serif text-2xl">Thank You</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          You're on our radar. A Lifestyle Design Realty professional will reach out shortly.
        </p>
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!goal || !timeline) {
      toast.error("Please tell us whether you're buying or selling, and your timeline.");
      return;
    }
    if (!consent) {
      toast.error("Please agree to the consent terms to continue.");
      return;
    }
    submit.mutate({
      name,
      email,
      phone,
      sourceTag: "Website - Get Started",
      answers: { goal, timeline },
      tcpaConsent: true,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-left">
      <div className={cn("gap-4", compact ? "space-y-3" : "grid sm:grid-cols-2")}>
        <div className="space-y-1.5">
          <Label htmlFor="gs-name" className="text-xs uppercase tracking-widest text-muted-foreground">Full Name *</Label>
          <Input id="gs-name" value={name} onChange={(e) => setName(e.target.value)} required className="bg-secondary/60 border-border" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gs-phone" className="text-xs uppercase tracking-widest text-muted-foreground">Phone *</Label>
          <Input id="gs-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required className="bg-secondary/60 border-border" />
        </div>
        <div className={cn("space-y-1.5", !compact && "sm:col-span-2")}>
          <Label htmlFor="gs-email" className="text-xs uppercase tracking-widest text-muted-foreground">Email *</Label>
          <Input id="gs-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="bg-secondary/60 border-border" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-widest text-muted-foreground">I'm Looking To *</Label>
          <Select value={goal} onValueChange={setGoal}>
            <SelectTrigger className="bg-secondary/60 border-border w-full"><SelectValue placeholder="Select..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Buy">Buy</SelectItem>
              <SelectItem value="Sell">Sell</SelectItem>
              <SelectItem value="Buy & Sell">Buy & Sell</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-widest text-muted-foreground">Timeline *</Label>
          <Select value={timeline} onValueChange={setTimeline}>
            <SelectTrigger className="bg-secondary/60 border-border w-full"><SelectValue placeholder="Select..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ASAP">ASAP</SelectItem>
              <SelectItem value="3-6 months">3–6 months</SelectItem>
              <SelectItem value="6-12 months">6–12 months</SelectItem>
              <SelectItem value="Just browsing">Just exploring</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-start gap-3 pt-1">
        <Checkbox id="gs-consent" checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" />
        <label htmlFor="gs-consent" className="text-[11px] leading-relaxed text-muted-foreground cursor-pointer">
          {SITE.tcpaConsent}{" "}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-gold">Privacy Policy</Link>.
        </label>
      </div>

      <Button
        type="submit"
        disabled={submit.isPending}
        className="w-full bg-gold text-primary-foreground hover:bg-gold/90 uppercase tracking-[0.2em] text-xs px-8 py-6 rounded-none">
        {submit.isPending ? "Submitting..." : "Get Started"}
      </Button>
    </form>
  );
}
