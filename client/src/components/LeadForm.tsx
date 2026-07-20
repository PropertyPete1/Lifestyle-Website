import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { SITE } from "@shared/site";
import { markLeadCaptured } from "@/lib/leadSession";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2 } from "lucide-react";

export interface QualifyingField {
  key: string;
  label: string;
  options: string[];
}

interface LeadFormProps {
  sourceTag: string;
  heading?: string;
  submitLabel?: string;
  showMessage?: boolean;
  messageLabel?: string;
  qualifying?: QualifyingField[];
  /** extra static answers merged into the payload (e.g. listing address) */
  extraAnswers?: Record<string, unknown>;
  compact?: boolean;
  onSuccess?: () => void;
}

/**
 * Universal lead capture form. Every lead form on the site uses this:
 * TCPA consent (required), qualifying questions, FUB sync via server.
 */
export default function LeadForm({
  sourceTag,
  heading,
  submitLabel = "Submit",
  showMessage = false,
  messageLabel = "Message",
  qualifying = [],
  extraAnswers,
  compact = false,
  onSuccess,
}: LeadFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [done, setDone] = useState(false);

  const submit = trpc.leads.submit.useMutation({
    onSuccess: () => {
      setDone(true);
      markLeadCaptured();
      toast.success("Thank you — we'll be in touch shortly.");
      onSuccess?.();
    },
    onError: (err) => toast.error(err.message || "Something went wrong. Please try again."),
  });

  if (done) {
    return (
      <div className="flex flex-col items-center text-center py-10 gap-3">
        <CheckCircle2 className="h-10 w-10 text-gold" />
        <h3 className="font-serif text-2xl">Thank You</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          Your request has been received. A member of Lifestyle Design Realty will reach out shortly.
        </p>
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!consent) {
      toast.error("Please agree to the consent terms to continue.");
      return;
    }
    submit.mutate({
      name,
      email,
      phone: phone || undefined,
      message: message || undefined,
      sourceTag,
      answers: { ...answers, ...extraAnswers },
      tcpaConsent: true,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-left">
      {heading && <h3 className="font-serif text-2xl md:text-3xl mb-2">{heading}</h3>}
      <div className={compact ? "space-y-3" : "grid sm:grid-cols-2 gap-4"}>
        <div className="space-y-1.5">
          <Label htmlFor={`${sourceTag}-name`} className="text-xs uppercase tracking-widest text-muted-foreground">Full Name *</Label>
          <Input id={`${sourceTag}-name`} value={name} onChange={(e) => setName(e.target.value)} required className="bg-secondary/60 border-border" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${sourceTag}-email`} className="text-xs uppercase tracking-widest text-muted-foreground">Email *</Label>
          <Input id={`${sourceTag}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="bg-secondary/60 border-border" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${sourceTag}-phone`} className="text-xs uppercase tracking-widest text-muted-foreground">Phone *</Label>
          <Input id={`${sourceTag}-phone`} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required className="bg-secondary/60 border-border" />
        </div>
      </div>

      {qualifying.length > 0 && (
        <div className={compact ? "space-y-3" : "grid sm:grid-cols-2 gap-4"}>
          {qualifying.map((q) => (
            <div key={q.key} className="space-y-1.5">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">{q.label}</Label>
              <Select
                value={answers[q.key] ?? ""}
                onValueChange={(v) => setAnswers((a) => ({ ...a, [q.key]: v }))}>
                <SelectTrigger className="bg-secondary/60 border-border w-full">
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {q.options.map((o) => (
                    <SelectItem key={o} value={o}>{o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      )}

      {showMessage && (
        <div className="space-y-1.5">
          <Label htmlFor={`${sourceTag}-msg`} className="text-xs uppercase tracking-widest text-muted-foreground">{messageLabel}</Label>
          <Textarea id={`${sourceTag}-msg`} value={message} onChange={(e) => setMessage(e.target.value)} rows={4} className="bg-secondary/60 border-border" />
        </div>
      )}

      {/* TCPA consent — required on every lead form */}
      <div className="flex items-start gap-3 pt-1">
        <Checkbox
          id={`${sourceTag}-consent`}
          checked={consent}
          onCheckedChange={(v) => setConsent(v === true)}
          className="mt-0.5"
        />
        <label htmlFor={`${sourceTag}-consent`} className="text-[11px] leading-relaxed text-muted-foreground cursor-pointer">
          {SITE.tcpaConsent}{" "}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-gold">Privacy Policy</Link>.
        </label>
      </div>

      <Button
        type="submit"
        disabled={submit.isPending}
        className="w-full sm:w-auto bg-gold text-primary-foreground hover:bg-gold/90 uppercase tracking-[0.2em] text-xs px-8 py-5 rounded-none">
        {submit.isPending ? "Submitting..." : submitLabel}
      </Button>
    </form>
  );
}
