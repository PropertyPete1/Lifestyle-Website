import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf-8");

/**
 * Oct 30, 2026: fixes from ChatGPT's recruiting-page review.
 * - On /join the header CTA must lead agents to the application, never to the buyer/seller Get Started page.
 * - The agent application follows Peter's rule for every form: phone required, email optional.
 */
describe("/join review fixes", () => {
  const nav = read("client/src/components/SiteNav.tsx");
  const recruit = read("client/src/components/RecruitForm.tsx");
  const join_ = read("client/src/pages/Join.tsx");

  it("swaps the header CTA to the application on /join (desktop and phone menu)", () => {
    expect(nav).toMatch(/const onJoin = location\.replace\(\/\\\/\+\$\/, ""\) === "\/join";/);
    expect(nav).toContain('document.getElementById("apply")');
    expect(nav.match(/onClick=\{onJoin \? goApply : goGetStarted\}/g)?.length).toBe(2);
    expect(nav).toContain('{onJoin ? "Apply Now" : "Get Started"}');
    expect(nav).toContain('{onJoin ? "Apply to Join the Team" : "Ready to Buy or Sell? Get Started"}');
    // the application anchor the CTA scrolls to still exists
    expect(join_).toContain('id="apply"');
  });

  it("keeps phone required and makes email optional on the agent application", () => {
    expect(recruit).toMatch(/htmlFor="rc-phone"[^>]*>Phone \*</);
    expect(recruit).toContain("(optional)");
    const emailInput = recruit.split("\n").find((line) => line.includes('<Input id="rc-email"')) ?? "";
    expect(emailInput).not.toBe("");
    expect(emailInput).not.toMatch(/\brequired\b/);
  });
});
