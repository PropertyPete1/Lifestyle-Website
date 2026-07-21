import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

/**
 * Custom-website inquiry modal (web design services — NOT a real estate lead).
 * Opened from the footer "Website crafted by…" credit line. Submits through
 * the site's own backend, so it works identically regardless of the visitor's
 * email provider — no mailto / email-client dependency.
 */
export default function WebsiteInquiryModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", business: "", message: "" });
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = trpc.websiteInquiry.submit.useMutation({
    onSuccess: () => setDone(true),
    onError: (e) => setError(e.message || "Something went wrong. Please try again."),
  });

  const canSubmit =
    form.name.trim().length > 0 &&
    /.+@.+\..+/.test(form.email.trim()) &&
    form.phone.trim().length >= 7 &&
    form.message.trim().length > 0 &&
    !submit.isPending;

  const handleOpenChange = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      // Reset for the next open after the close animation.
      setTimeout(() => {
        setDone(false);
        setError(null);
        setForm({ name: "", email: "", phone: "", business: "", message: "" });
      }, 300);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md bg-card border-border">
        {done ? (
          <div className="py-10 text-center">
            <p className="font-serif text-2xl">Thanks! I'll be in touch soon.</p>
            <p className="mt-3 text-sm text-muted-foreground">
              Your inquiry is on its way to Peter at Lifestyle Design Technologies.
            </p>
            <Button
              onClick={() => handleOpenChange(false)}
              className="mt-8 bg-gold text-primary-foreground hover:bg-gold/90 rounded-none uppercase tracking-[0.2em] text-xs px-8">
              Close
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl font-normal">
                Your Own Custom Website
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground -mt-1">
              Tell us a little about your business and we'll reach out about building a website like this one for you.
            </p>
            <div className="grid gap-4 mt-2">
              <div className="space-y-1.5">
                <Label htmlFor="wi-name">Name *</Label>
                <Input id="wi-name" value={form.name} autoComplete="name"
                  onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="wi-email">Email *</Label>
                  <Input id="wi-email" type="email" value={form.email} autoComplete="email"
                    onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wi-phone">Phone *</Label>
                  <Input id="wi-phone" type="tel" value={form.phone} autoComplete="tel"
                    onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wi-business">Business Name / Type <span className="text-muted-foreground">(optional)</span></Label>
                <Input id="wi-business" value={form.business} placeholder="e.g. Van Orden Law, boutique fitness studio…"
                  onChange={(e) => setForm({ ...form, business: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wi-message">What are you looking for? *</Label>
                <Textarea id="wi-message" rows={4} value={form.message}
                  placeholder="I saw your website and I'd love something similar for my business…"
                  onChange={(e) => setForm({ ...form, message: e.target.value })} />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                disabled={!canSubmit}
                onClick={() =>
                  submit.mutate({
                    name: form.name.trim(),
                    email: form.email.trim(),
                    phone: form.phone.trim(),
                    business: form.business.trim() || undefined,
                    message: form.message.trim(),
                  })
                }
                className="bg-gold text-primary-foreground hover:bg-gold/90 rounded-none uppercase tracking-[0.2em] text-xs h-11">
                {submit.isPending ? (
                  <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Sending…</span>
                ) : (
                  "Send Inquiry"
                )}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
