import { useState } from "react";
import { Link } from "wouter";
import FormError from "@/components/FormError";
import { humanizeSubmitError, isUsablePhone, PHONE_HINT } from "@shared/formErrors";
import { trpc } from "@/lib/trpc";
import { getVisitorId } from "@/lib/visitor";
import { markLeadCaptured } from "@/lib/leadSession";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MessageSquareText } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * THE primary site conversion point. Nov 3, 2026 (Peter: "make it so they put their number and we text them in two
 * or three minutes"): one box, the buyer's mobile number (first name optional). The buying/selling and timeline
 * questions moved into that text conversation (Peter: name and number, so the text can say their name). Posts to FUB tagged "Website - Get Started"; Pete's FUB action
 * plan on that tag sends the text a few minutes later.
 */
/** What the FUB note says, so the agent sees why the person is there. */
export const GET_STARTED_TEXT_ME_ANSWER = "Yes - asked to be texted from the website";

export default function GetStartedForm({ compact = false }: { compact?: boolean }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [done, setDone] = useState(false);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const submit = trpc.leads.submit.useMutation({
    onSuccess: () => {
      setDone(true);
      markLeadCaptured(); // suppresses the exit-intent nudge for the rest of the session
    },
    onError: (err) => setSubmitError(humanizeSubmitError(err)),
  });

  if (done) {
    return (
      <div data-lead-converted className="flex flex-col items-center text-center py-12 gap-3">
        <MessageSquareText className="h-10 w-10 text-gold" />
        <h3 className="font-serif text-2xl">Check your texts.</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          We'll text you in the next few minutes to hear what you're looking for — we typically respond within 30 minutes.
        </p>
      </div>
    );
  }

  /** Extracted so the failure banner's "Try again" can re-send the same data. */
  const doSubmit = () => {
    // See LeadForm: one lead per submission is enforced here, not just by the
    // disabled button, so a duplicate can't reach FUB.
    if (submit.isPending) return;
    setSubmitError(null);
    submit.mutate({
      name: name.trim(),
      email: "",
      phone,
      sourceTag: "Website - Get Started",
      answers: { textMe: GET_STARTED_TEXT_ME_ANSWER },
      tcpaConsent: true,
      visitorId: getVisitorId() || undefined,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setFieldError(null);
    if (!name.trim()) {
      setFieldError("Please add your first name so we know who to text.");
      return;
    }
    if (!isUsablePhone(phone)) {
      setFieldError(PHONE_HINT);
      return;
    }
    doSubmit();
  };

  return (
    <form onSubmit={handleSubmit} data-get-started-text-me="true" className="space-y-4 text-left">
      <div className={cn("gap-4", compact ? "space-y-3" : "grid sm:grid-cols-2")}>
        <div className="space-y-1.5">
          <Label htmlFor="gs-phone" className="text-xs uppercase tracking-widest text-muted-foreground">Your mobile number *</Label>
          <Input
            id="gs-phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            placeholder="(210) 555-0123"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            aria-invalid={fieldError === PHONE_HINT || undefined}
            aria-describedby={fieldError === PHONE_HINT ? "gs-phone-error" : undefined}
            className="h-12 bg-secondary/60 border-border text-base"
          />
          {fieldError === PHONE_HINT && (
            <p id="gs-phone-error" role="alert" className="text-[11px] text-destructive">{PHONE_HINT}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gs-name" className="text-xs uppercase tracking-widest text-muted-foreground">First name *</Label>
          <Input id="gs-name" autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} required className="h-12 bg-secondary/60 border-border text-base" />
        </div>
      </div>

      {fieldError && fieldError !== PHONE_HINT && (
        <p role="alert" className="text-[11px] text-destructive">{fieldError}</p>
      )}
      {submitError && (
        <FormError message={submitError} onRetry={doSubmit} retrying={submit.isPending} />
      )}

      <Button
        type="submit"
        disabled={submit.isPending}
        className="glow-gold min-h-12 w-full bg-gold text-primary-foreground hover:bg-gold/90 font-serif text-[19px] font-normal normal-case tracking-normal px-8 py-6 rounded-none">
        {submit.isPending ? "Sending..." : "Text me about homes"}
      </Button>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        By tapping the button you agree to get a text from Lifestyle Design Realty at this number about buying or selling a home. Message and data rates may apply.
        Reply STOP anytime. See our{" "}
        <Link href="/privacy" className="underline underline-offset-2 hover:text-gold">Privacy Policy</Link>{" "}
        and <Link href="/terms" className="underline underline-offset-2 hover:text-gold">Terms</Link>.
      </p>
    </form>
  );
}
