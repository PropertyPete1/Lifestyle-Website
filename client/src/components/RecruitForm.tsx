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

/**
 * Nov 3, 2026 (Peter: zero agents filled out the five-question application in 30 days; every recruit came from a DM
 * or a text, "a form feels like applying for a job"). The application is now one box: an agent drops their number
 * and gets the offer by text a few minutes later, written as Steven. The text itself is sent by Follow Up Boss (an
 * action plan on the "Recruit - Website" tag), so this form's whole job is to file the agent under Steven with that
 * tag and the note that they asked for the offer by text.
 */
/** Recruits sent from Builder Deals carry their own FUB tag, so recruiting knows which track they came in on. */
export const BUILDER_DEALS_RECRUIT_SOURCE = "Recruit - Builder Deals";
/** What the FUB note says, so Steven sees at a glance why the agent is there. */
export const RECRUIT_TEXT_ME_ANSWER = "Yes - asked for the offer by text from the website";
/** A recruit who gave only a number is still a person in FUB; the first name is replaced when they reply. */
export const RECRUIT_FALLBACK_NAME = "Agent";

export default function RecruitForm({ sourceTag = "Recruit - Website", initialPhone = "", initialName = "", initialEmail = "" }: { sourceTag?: string; initialPhone?: string; initialName?: string; initialEmail?: string } = {}) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
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
        <p className="text-sm text-muted-foreground max-w-sm">Steven will text you what we offer in the next few minutes. Reply to that text with any questions.</p>
      </div>
    );
  }

  /** Extracted so the failure banner's "Try again" can re-send the same data. */
  const doSubmit = () => {
    // See LeadForm: one application per submission, enforced here rather than
    // relying on the disabled button alone.
    if (submit.isPending) return;
    setSubmitError(null);
    submit.mutate({
      name: name.trim() || RECRUIT_FALLBACK_NAME,
      email: initialEmail.trim(),
      phone,
      sourceTag,
      visitorId: getVisitorId() || undefined,
      answers: { textMeTheOffer: RECRUIT_TEXT_ME_ANSWER },
      tcpaConsent: true,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setFieldError(null);
    if (!isUsablePhone(phone)) {
      setFieldError(PHONE_HINT);
      return;
    }
    doSubmit();
  };

  return (
    <form onSubmit={handleSubmit} data-recruit-text-me="true" className="space-y-4 text-left">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-1.5">
          <Label htmlFor="rc-phone" className="text-xs uppercase tracking-widest text-muted-foreground">Your mobile number *</Label>
          <Input
            id="rc-phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            placeholder="(210) 555-0123"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            aria-invalid={fieldError === PHONE_HINT || undefined}
            aria-describedby={fieldError === PHONE_HINT ? "rc-phone-error" : undefined}
            className="h-12 bg-secondary/60 border-border text-base"
          />
          {fieldError === PHONE_HINT && (
            <p id="rc-phone-error" role="alert" className="text-[11px] text-destructive">{PHONE_HINT}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rc-name" className="text-xs uppercase tracking-widest text-muted-foreground">First name <span className="normal-case tracking-normal">(optional)</span></Label>
          <Input id="rc-name" autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} className="h-12 bg-secondary/60 border-border text-base" />
        </div>
      </div>

      {submitError && (
        <FormError message={submitError} onRetry={doSubmit} retrying={submit.isPending} />
      )}

      <Button
        type="submit"
        disabled={submit.isPending}
        className="w-full bg-gold text-primary-foreground hover:bg-gold/90 uppercase tracking-[0.2em] text-xs px-10 py-6 rounded-none sm:w-auto">
        {submit.isPending ? "Sending..." : "Text me what you offer"}
      </Button>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        By tapping the button you agree to get a text from Lifestyle Design Realty at this number about joining the team. Message and data rates may apply.
        Reply STOP anytime. See our{" "}
        <Link href="/privacy" className="underline underline-offset-2 hover:text-gold">Privacy Policy</Link>{" "}
        and <Link href="/terms" className="underline underline-offset-2 hover:text-gold">Terms</Link>.
      </p>
    </form>
  );
}
