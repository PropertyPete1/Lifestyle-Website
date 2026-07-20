import PageShell from "@/components/PageShell";
import LeadForm from "@/components/LeadForm";
import { SITE } from "@shared/site";
import { Phone, Mail, MapPin } from "lucide-react";

export default function Contact() {
  return (
    <PageShell solidNav>
      <div className="mx-auto max-w-[1400px] px-5 lg:px-8 pt-28 lg:pt-36 pb-20 grid lg:grid-cols-2 gap-14">
        <div>
          <p className="eyebrow text-gold">Get In Touch</p>
          <h1 className="display-serif text-4xl md:text-6xl mt-3">Schedule a Consultation</h1>
          <p className="mt-5 text-muted-foreground max-w-lg leading-relaxed">
            Whether you're buying, selling, or exploring new construction, start with a
            no-pressure conversation with our team.
          </p>
          <div className="mt-10 space-y-4 text-sm">
            <a href={SITE.phoneHref} className="flex items-center gap-3 text-foreground hover:text-gold">
              <Phone className="h-4 w-4 text-gold" /> {SITE.phone}
            </a>
            <a href={`mailto:${SITE.email}`} className="flex items-center gap-3 text-foreground hover:text-gold break-all">
              <Mail className="h-4 w-4 text-gold" /> {SITE.email}
            </a>
            <p className="flex items-start gap-3 text-muted-foreground">
              <MapPin className="h-4 w-4 text-gold mt-0.5" /> 1209 S Saint Marys St #232<br className="hidden" />
              , San Antonio TX 78210
            </p>
          </div>
        </div>
        <div className="bg-card border border-border p-6 lg:p-10">
          <LeadForm
            sourceTag="Website - Contact"
            heading="Submit a Message"
            submitLabel="Submit"
            showMessage
            qualifying={[
              { key: "interest", label: "I'm interested in", options: ["Buying", "Selling", "Both", "Other"] },
              { key: "timeline", label: "Timeline", options: ["ASAP", "3-6 months", "Just browsing"] },
              { key: "workingWithAgent", label: "Already working with an agent?", options: ["Yes", "No"] },
            ]}
          />
        </div>
      </div>
    </PageShell>
  );
}
