import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import FormError from "@/components/FormError";
import { humanizeSubmitError, isUsablePhone, PHONE_HINT } from "@shared/formErrors";
import { trpc } from "@/lib/trpc";
import { SITE } from "@shared/site";
import { getVisitorId } from "@/lib/visitor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckCircle2 } from "lucide-react";

/**
 * Lightweight newsletter signup: name + email only.
 * Captures the subscriber into FUB tagged "Website - Newsletter".
 * No email-sending logic here — delivery is handled by a separate internal system.
 * Deliberately understated vs. the high-intent Get Started form.
 */
export default function NewsletterForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [done, setDone] = useState(false);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const submit = trpc.leads.submit.useMutation({
    onSuccess: () => {
      setDone(true);
      toast.success("You're subscribed.");
    },
    onError: (err) => setSubmitError(humanizeSubmitError(err)),
  });

  if (done) {
    return (
      <div className="flex items-center justify-center gap-3 py-6 text-sm text-muted-foreground">
        <CheckCircle2 className="h-5 w-5 text-gold" /> You're subscribed — new listings are on the way.
      </div>
    );
  }

  /** Extracted so the failure banner's "Try again" can re-send the same data. */
  const doSubmit = () => {
    setSubmitError(null);
    submit.mutate({
      name,
      email,
      sourceTag: "Website - Newsletter",
      tcpaConsent: true,
      visitorId: getVisitorId() || undefined,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setFieldError(null);
    if (!consent) {
      setFieldError("Please agree to the consent terms to continue.");
      return;
    }
    doSubmit();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-left">
      <div className="flex flex-col sm:flex-row gap-3">
        <Input
          aria-label="Full name"
          placeholder="Full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="bg-transparent border-0 border-b border-border rounded-none px-0 focus-visible:ring-0 focus-visible:border-gold"
        />
        <Input
          aria-label="Email address"
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="bg-transparent border-0 border-b border-border rounded-none px-0 focus-visible:ring-0 focus-visible:border-gold"
        />
{fieldError && fieldError !== PHONE_HINT && (
        <p role="alert" className="text-[11px] text-destructive">{fieldError}</p>
      )}
      {submitError && (
        <FormError message={submitError} onRetry={doSubmit} retrying={submit.isPending} />
      )}

      <Button
          type="submit"
          disabled={submit.isPending}
          variant="outline"
          className="glow-gold glow-cool border-gold/60 text-gold hover:bg-gold hover:text-primary-foreground uppercase tracking-[0.2em] text-[11px] rounded-none px-8 shrink-0">
          {submit.isPending ? "..." : "Subscribe"}
        </Button>
      </div>
      <div className="flex items-start gap-3">
        <Checkbox id="nl-consent" checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" />
        <label htmlFor="nl-consent" className="text-[10px] leading-relaxed text-muted-foreground/80 cursor-pointer">
          {SITE.tcpaConsent}{" "}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-gold">Privacy Policy</Link>.
        </label>
      </div>
    </form>
  );
}
