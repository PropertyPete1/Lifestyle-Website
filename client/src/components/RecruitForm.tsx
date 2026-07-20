import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { SITE } from "@shared/site";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2 } from "lucide-react";

/**
 * Agent recruiting screening form (per Stefanie's exact message).
 * Posts to FUB tagged "Recruit - Website"; all five answers saved as notes;
 * intent per rules: active license + full-time + closed transactions = Hot.
 */
export default function RecruitForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [transactionsClosed, setTransactionsClosed] = useState("");
  const [fullTime, setFullTime] = useState("");
  const [crm, setCrm] = useState("");
  const [currentBrokerage, setCurrentBrokerage] = useState("");
  const [consent, setConsent] = useState(false);
  const [done, setDone] = useState(false);

  const submit = trpc.leads.submit.useMutation({
    onSuccess: () => setDone(true),
    onError: (err) => toast.error(err.message || "Something went wrong. Please try again."),
  });

  if (done) {
    return (
      <div className="flex flex-col items-center text-center py-12 gap-3">
        <CheckCircle2 className="h-10 w-10 text-gold" />
        <h3 className="font-serif text-2xl">Thank you!</h3>
        <p className="text-sm text-muted-foreground max-w-sm">Our broker will be reaching out.</p>
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!licenseNumber || !transactionsClosed || !fullTime || !currentBrokerage) {
      toast.error("Please answer all five screening questions.");
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
      sourceTag: "Recruit - Website",
      answers: {
        licenseNumber,
        transactionsClosed,
        fullTimeAgent: fullTime,
        crm: crm || "No CRM",
        currentBrokerage,
        // recruiting intent inputs (server computeIntent):
        licenseStatus: licenseNumber ? "Licensed active" : "Not licensed",
        fullTime,
      },
      tcpaConsent: true,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-left">
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="rc-name" className="text-xs uppercase tracking-widest text-muted-foreground">Full Name *</Label>
          <Input id="rc-name" value={name} onChange={(e) => setName(e.target.value)} required className="bg-secondary/60 border-border" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rc-phone" className="text-xs uppercase tracking-widest text-muted-foreground">Phone *</Label>
          <Input id="rc-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required className="bg-secondary/60 border-border" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="rc-email" className="text-xs uppercase tracking-widest text-muted-foreground">Email *</Label>
          <Input id="rc-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="bg-secondary/60 border-border" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rc-license" className="text-xs uppercase tracking-widest text-muted-foreground">1. License Number *</Label>
          <Input id="rc-license" value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} required className="bg-secondary/60 border-border" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rc-transactions" className="text-xs uppercase tracking-widest text-muted-foreground">2. Transactions Closed This Year *</Label>
          <Input id="rc-transactions" type="number" min="0" value={transactionsClosed} onChange={(e) => setTransactionsClosed(e.target.value)} required className="bg-secondary/60 border-border" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-widest text-muted-foreground">3. Are You a Full-Time Agent? *</Label>
          <Select value={fullTime} onValueChange={setFullTime}>
            <SelectTrigger className="bg-secondary/60 border-border w-full"><SelectValue placeholder="Select..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Yes">Yes</SelectItem>
              <SelectItem value="No">No</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rc-crm" className="text-xs uppercase tracking-widest text-muted-foreground">4. Current CRM (If Any)</Label>
          <Input id="rc-crm" value={crm} onChange={(e) => setCrm(e.target.value)} placeholder="e.g. Follow Up Boss, kvCORE, none" className="bg-secondary/60 border-border" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="rc-brokerage" className="text-xs uppercase tracking-widest text-muted-foreground">5. What Brokerage Are You With? *</Label>
          <Textarea id="rc-brokerage" value={currentBrokerage} onChange={(e) => setCurrentBrokerage(e.target.value)} rows={2} required className="bg-secondary/60 border-border" />
        </div>
      </div>

      <div className="flex items-start gap-3 pt-1">
        <Checkbox id="rc-consent" checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" />
        <label htmlFor="rc-consent" className="text-[11px] leading-relaxed text-muted-foreground cursor-pointer">
          {SITE.tcpaConsent}{" "}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-gold">Privacy Policy</Link>.
        </label>
      </div>

      <Button
        type="submit"
        disabled={submit.isPending}
        className="w-full sm:w-auto bg-gold text-primary-foreground hover:bg-gold/90 uppercase tracking-[0.2em] text-xs px-10 py-6 rounded-none">
        {submit.isPending ? "Submitting..." : "Submit Application"}
      </Button>
    </form>
  );
}
