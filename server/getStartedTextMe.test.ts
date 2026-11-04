import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf-8");

/**
 * Nov 3, 2026 (Peter: "make it so they put their number and we text them in two or three minutes"). Get Started is
 * one box: the buyer's mobile number. They are filed in Follow Up Boss under "Website - Get Started" as before, and
 * Pete's FUB action plan on that tag texts them a few minutes later; buying/selling and timeline move to that text.
 */
describe("Get Started: drop your number, we text you", () => {
  const form = read("client/src/components/GetStartedForm.tsx");

  it("asks for a first name and a mobile number, nothing else", () => {
    expect(form).toContain('data-get-started-text-me="true"');
    expect(form).toContain('id="gs-phone"');
    expect(form).toContain('id="gs-name"');
    for (const gone of ["gs-email", "gs-consent", "I'm Looking To", "Timeline *", "<Select"]) expect(form).not.toContain(gone);
    expect(form).toContain('sourceTag: "Website - Get Started"');
    expect(form).toContain("answers: { textMe: GET_STARTED_TEXT_ME_ANSWER }");
    expect(form).toContain("name: name.trim(),");
    const nameInput = form.split("\n").find((line) => line.includes('<Input id="gs-name"')) ?? "";
    expect(nameInput).toMatch(/\brequired\b/);
    expect(form).toContain("Text me about homes");
  });

  it("the home page and /get-started say what happens", () => {
    for (const page of ["client/src/pages/Home.tsx", "client/src/pages/GetStarted.tsx"]) {
      expect(read(page)).toContain("Drop your number and we'll text you in a few minutes");
      expect(read(page)).toContain("<GetStartedForm />");
      expect(read(page)).toContain("One of our agents will be reaching out."); // Nov 3 (Peter): above the 30-minute badge
    }
  });
});
