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
          <p>
            We do not sell or share your SMS opt-in data or personal information with third parties for marketing purposes. Mobile information will not be shared with third parties or affiliates for marketing or promotional purposes.
          </p>
          <h2 className="font-serif text-2xl text-foreground">SMS Messaging</h2>
          <p>
            Lifestyle Design Realty sends text messages only to people who opt in by checking the consent box on our website forms. Messages may include replies to your real estate inquiry, property listings, showing and appointment reminders, and career opportunity information for licensed real estate agents. Message frequency varies. Message and data rates may apply. Reply STOP to opt out at any time or HELP for help. Text messaging originator opt-in data and consent will not be shared with any third parties.
          </p>
          <h2 className="font-serif text-2xl text-foreground">Data Storage and Your Rights</h2>
          <p>
            Your information is stored securely in our customer relationship management system and kept only as long as needed to provide our services. You may request access to or deletion of your information by emailing team@lifestyledesignrealty.com.
          </p>
          <h2 className="font-serif text-2xl text-foreground">Platform &amp; Analytics</h2>
          <p>
            We measure how our website is used so we can improve it. Our own analytics are
            first-party and cookieless: an anonymous identifier is stored in your browser's
            local storage to count page views and clicks. It contains no personal
            information, is never linked to your identity, and we do not log IP addresses or
            use fingerprinting.
          </p>
          <p>
            Our website is built and hosted on the Manus platform, which currently loads a
            small number of its own services alongside our site: Umami (served via
            manus-analytics.com), a cookieless, privacy-focused analytics tool;{" "}
            <a
              href="https://plausible.io/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gold hover:underline"
            >
              Plausible Analytics
            </a>
            , a cookieless analytics script added at the hosting layer; and a Manus platform
            bundle that may include{" "}
            <a
              href="https://amplitude.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gold hover:underline"
            >
              Amplitude
            </a>{" "}
            telemetry while present. These services operate anonymously and without
            advertising cookies. The third-party services our hosting platform loads may
            change over time; please refer to the linked policies of those providers for
            details on their data practices.
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
