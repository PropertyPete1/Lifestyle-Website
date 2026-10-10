import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fromProject = (...parts: string[]) => readFile(path.join(projectRoot, ...parts), "utf8");

describe("public legal pages", () => {
  it("keeps the required SMS privacy disclosures and data rights", async () => {
    const privacy = await fromProject("client/src/pages/Privacy.tsx");

    expect(privacy).toContain("Privacy Policy");
    expect(privacy).toContain(
      "We do not sell or share your SMS opt-in data or personal information with third parties for marketing purposes. Mobile information will not be shared with third parties or affiliates for marketing or promotional purposes."
    );
    expect(privacy).toContain("SMS Messaging");
    expect(privacy).toContain(
      "Text messaging originator opt-in data and consent will not be shared with any third parties."
    );
    expect(privacy).toContain("Data Storage and Your Rights");
    expect(privacy).toContain("team@lifestyledesignrealty.com");
  });

  it("registers a public Terms page with each required section", async () => {
    const [app, terms] = await Promise.all([
      fromProject("client/src/App.tsx"),
      fromProject("client/src/pages/Terms.tsx"),
    ]);

    expect(app).toContain('path={"/terms"} component={Terms}');
    for (const heading of [
      "Terms and Conditions",
      "Use of This Website",
      "SMS Terms",
      "User Obligations",
      "Disclaimers and Limitation of Liability",
      "Governing Law",
      "Contact",
    ]) {
      expect(terms).toContain(heading);
    }
    expect(terms).toContain("Lifestyle Design Realty Texts");
    expect(terms).toContain("Reply STOP");
    expect(terms).toContain("Reply HELP");
    expect(terms).toContain("State of Texas");
    expect(terms).toContain('href="/privacy"');
  });

  it("places a Terms link beside Privacy across footer and every consent component", async () => {
    const files = [
      "client/src/components/SiteFooter.tsx",
      "client/src/components/LeadForm.tsx",
      "client/src/components/GetStartedForm.tsx",
      "client/src/components/RecruitForm.tsx",
      "client/src/components/WebsiteInquiryModal.tsx",
      "client/src/components/NewsletterForm.tsx",
      "client/index.html",
    ];

    const contents = await Promise.all(files.map((file) => fromProject(file)));
    for (let index = 0; index < files.length; index += 1) {
      expect(contents[index], files[index]).toContain("/terms");
      expect(contents[index], files[index]).toContain("Privacy");
    }
  });
});
