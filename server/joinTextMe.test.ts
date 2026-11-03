import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { buildTag, isRecruitSource } from "./fub";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf-8");

/**
 * Nov 3, 2026 (Peter: zero agents filled out the five-question application in 30 days; every recruit came from a DM
 * or a text). /join is now one box: the agent's number. They are filed under Steven in Follow Up Boss with the
 * "Recruit - Website" tag, and Steven's FUB action plan on that tag texts them the offer a few minutes later.
 */
describe("/join: drop your number, get the offer by text", () => {
  const recruit = read("client/src/components/RecruitForm.tsx");
  const joinPage = read("client/src/pages/Join.tsx");

  it("asks for a mobile number and an optional first name, nothing else", () => {
    expect(recruit).toContain('data-recruit-text-me="true"');
    expect(recruit).toContain('id="rc-phone"');
    expect(recruit).toContain('id="rc-name"');
    for (const gone of ["rc-license", "rc-transactions", "rc-brokerage", "rc-crm", "rc-consent", "Submit Application"]) expect(recruit).not.toContain(gone);
    expect(recruit).toContain('answers: { textMeTheOffer: RECRUIT_TEXT_ME_ANSWER }');
    expect(recruit).toContain('name: name.trim() || RECRUIT_FALLBACK_NAME');
    expect(recruit).toContain("Text me what you offer");
    expect(recruit).toContain("Steven will text you what we offer in the next few minutes.");
  });

  it("says on the page what happens, and the five screening questions are gone", () => {
    expect(joinPage).toContain('data-join-text-me-intro="true"');
    expect(joinPage).toContain("Curious? Drop your number.");
    expect(joinPage).not.toContain("In an effort to find the best fit");
    expect(joinPage).not.toContain("Apply to Join the Team");
    expect(joinPage).toContain('id="apply"');
  });

  it("a recruit is a recruit by source tag or by the /links 'Joining the team' pick, and keeps the FUB tag", () => {
    expect(isRecruitSource("Recruit - Website")).toBe(true);
    expect(isRecruitSource("Recruit - Builder Deals")).toBe(true);
    expect(isRecruitSource("Website - Links Page", { interest: "Joining the team" })).toBe(true);
    expect(isRecruitSource("Website - Get Started")).toBe(false);
    expect(isRecruitSource("Website - Links Page", { interest: "Buying" })).toBe(false);
    expect(buildTag("Recruit - Website", "Unknown", { textMeTheOffer: "Yes" })).toEqual(["Recruit - Website"]);
  });

  it("the lead submit files a recruit under Steven", () => {
    const routers = read("server/routers.ts");
    expect(routers).toContain("const assignedUserId = isRecruitSource(input.sourceTag, input.answers) ? await stevenUserId().catch(() => null) : null;");
    expect(read("server/fub.ts")).toContain("...(input.assignedUserId ? { assignedUserId: Number(input.assignedUserId) } : {}),");
    expect(read("server/dealsFub.ts")).toContain('const STEVEN_EMAIL = "steven@lifestyledesignrealty.com";');
  });
});
