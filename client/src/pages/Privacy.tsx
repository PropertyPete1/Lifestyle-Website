import PageShell from "@/components/PageShell";
import { SITE } from "@shared/site";

export default function Privacy() {
  return (
    <PageShell solidNav>
      <div className="mx-auto max-w-3xl px-5 lg:px-8 pt-28 lg:pt-36 pb-24">
        <h1 className="display-serif text-4xl md:text-5xl">Privacy Policy</h1>
        <div className="mt-8 space-y-6 text-sm text-muted-foreground leading-relaxed">
          <p>
            Lifestyle Design Realty ("we," "us," or "our") respects your privacy. This policy
            describes how we collect, use, and protect the personal information you provide
            through lifestyledesignrealty.com.
          </p>
          <h2 className="font-serif text-2xl text-foreground">Information We Collect</h2>
          <p>
            When you submit a form on our site, we collect the information you provide — such as
            your name, email address, phone number, and any preferences or messages you share
            (for example, quiz answers or property interests).
          </p>
          <h2 className="font-serif text-2xl text-foreground">How We Use Your Information</h2>
          <p>
            We use your information to respond to your inquiries, provide real estate services,
            send property updates and market information you request, and improve our website.
            Lead information is stored securely in our customer relationship management system.
          </p>
          <h2 className="font-serif text-2xl text-foreground">Communications Consent</h2>
          <p>{SITE.tcpaConsent}</p>
          <h2 className="font-serif text-2xl text-foreground">Sharing</h2>
          <p>
            We do not sell your personal information. We may share information with service
            providers who assist in operating our website and business, subject to
            confidentiality obligations, or when required by law.
          </p>
          <h2 className="font-serif text-2xl text-foreground">Contact</h2>
          <p>
            Questions about this policy? Contact us at {SITE.email} or {SITE.phone}, or write to
            us at {SITE.address}.
          </p>
        </div>
      </div>
    </PageShell>
  );
}
