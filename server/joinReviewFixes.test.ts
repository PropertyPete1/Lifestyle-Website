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

  it("shows the Builder Deals toolkit, the lead tools and the brokers, with no invented numbers", () => {
    for (const hook of ["data-join-toolkit", "data-join-lead-tools", "data-join-brokers"]) expect(join_).toContain(hook);
    for (const title of ["Private client links", "Hand-picked short lists", "See what clients like", "Your own bio link"]) expect(join_).toContain(title);
    for (const href of ['"/city-finder"', '"/valuation"', '"/deals"']) expect(join_).toContain(href);
    expect(join_).toContain('"/team/steven-van-orden.webp"');
    expect(join_).toContain('"/team/peter-allen.webp"');
    // no splits, fees or income promises until Peter supplies real ones
    expect(join_).not.toMatch(/\d+\s*\/\s*\d+\s*split|\d+%/i);
  });

  it("points the phone sticky bar at the application on /join only", () => {
    expect(join_).toContain('<PageShell stickyCta stickyCtaLabel="Apply to Join the Team" stickyCtaHref="#apply">');
    const sticky = read("client/src/components/StickyMobileCta.tsx");
    expect(sticky).toContain('href = "/#get-started"');
    expect(sticky).toContain("href={href}");
  });

  it("says splits and lead delivery in Peter's words, without numbers (Oct 30, 10:20 PM)", () => {
    expect(join_).toContain("data-join-terms");
    expect(join_).toContain("Highly competitive splits on your own business, and fair, competitive splits on the leads we give you.");
    expect(join_).toContain("Leads are given to you through our CRM, Follow Up Boss: hot buyers who are texting us for a buyer's consultation.");
  });
});
