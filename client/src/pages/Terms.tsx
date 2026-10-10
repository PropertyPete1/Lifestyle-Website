import PageShell from "@/components/PageShell";
import { Link } from "wouter";
import { SITE } from "@shared/site";

export default function Terms() {
  return (
    <PageShell solidNav>
      <div className="mx-auto max-w-3xl px-5 lg:px-8 pt-28 lg:pt-36 pb-24">
        <h1 className="display-serif text-4xl md:text-5xl">Terms and Conditions</h1>
        <div className="mt-8 space-y-6 text-sm text-muted-foreground leading-relaxed">
          <p>
            These Terms and Conditions govern your use of lifestyledesignrealty.com and the
            services provided by Lifestyle Design Realty.
          </p>

          <h2 className="font-serif text-2xl text-foreground">Use of This Website</h2>
          <p>
            This website provides real estate information and services in Texas. Information is
            provided as is and may change without notice. Property data is not guaranteed and
            should be independently reviewed and verified.
          </p>

          <h2 className="font-serif text-2xl text-foreground">SMS Terms</h2>
          <p>
            The program name is Lifestyle Design Realty Texts. You opt in by checking the consent
            box on our website forms. Messages may include replies to real estate inquiries,
            listings, showing and appointment reminders, and career opportunities for real estate
            agents. Message frequency varies. Message and data rates may apply. Reply STOP to
            cancel at any time; after doing so, you will receive one confirmation message and no
            further texts. Reply HELP for help. Carriers are not liable for delayed or undelivered
            messages. Consent to texts is not a condition of any purchase or service.
          </p>

          <h2 className="font-serif text-2xl text-foreground">User Obligations</h2>
          <p>
            You agree to provide accurate information when using this website and not to misuse
            the site, its forms, or its content.
          </p>

          <h2 className="font-serif text-2xl text-foreground">Disclaimers and Limitation of Liability</h2>
          <p>
            Lifestyle Design Realty is not a lender, and nothing on this website is an offer of
            credit. To the fullest extent permitted by law, Lifestyle Design Realty is not liable
            for damages arising from your use of this website.
          </p>

          <h2 className="font-serif text-2xl text-foreground">Governing Law</h2>
          <p>These Terms and Conditions are governed by the laws of the State of Texas.</p>

          <h2 className="font-serif text-2xl text-foreground">Contact</h2>
          <p>
            Questions about these Terms and Conditions? Contact us at{" "}
            <a href={`mailto:${SITE.email}`} className="text-gold hover:underline">
              {SITE.email}
            </a>
            {", "}
            <a href={SITE.phoneHref} className="text-gold hover:underline">
              {SITE.phone}
            </a>
            {", or write to us at "}
            {SITE.address}.
          </p>

          <p>
            Please also review our{" "}
            <Link href="/privacy" className="text-gold hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </div>
    </PageShell>
  );
}
