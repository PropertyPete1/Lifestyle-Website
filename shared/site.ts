/** Shared site-wide constants — single source of truth for exact strings. */
export const SITE = {
  name: "Lifestyle Design Realty",
  eyebrow: "EXPERTISE. KNOWLEDGE. EXPERIENCE.",
  headline: "LIFESTYLE DESIGN REALTY",
  subheadline: "CENTRAL TEXAS REAL ESTATE PROFESSIONALS",
  phone: "(210) 981-3830",
  phoneHref: "tel:+12109813830",
  email: "peter@lifestyledesignrealty.com",
  address: "1209 S Saint Marys St #232, San Antonio TX 78210",
  /** New Construction Search — external builder-network tool (vendor name never shown in UI) */
  newConstructionUrl: "https://a.nhb.app/u/peter-allen",
  iabsUrl: "https://drive.google.com/file/d/1DTDRFjzJJS_iD8aaNu8l4Wr3YmmR9zHe/view",
  cpnUrl: "https://www.trec.texas.gov/forms/consumer-protection-notice",
  disclaimer:
    "All information is deemed reliable but not guaranteed and should be independently reviewed and verified.",
  tcpaConsent:
    "I agree to be contacted by Lifestyle Design Realty via call, email, and text for real estate services. To opt out, you can reply 'stop' at any time or reply 'help' for assistance. You can also click the unsubscribe link in the emails. Message and data rates may apply. Message frequency may vary.",
  instagram: "https://www.instagram.com/lifestyledesignrealtytexas",
  facebook: "https://www.facebook.com/p/Lifestyle-Design-Realty-Texas-61578742983077/",
  cities: ["San Antonio", "New Braunfels", "Austin", "DFW", "Houston"] as const,
} as const;

export type IntentLevel = "Hot" | "Warm" | "Cold" | "Unknown";
