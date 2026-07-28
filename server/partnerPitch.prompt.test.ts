import { describe, expect, it } from "vitest";
import {
  HESITATION_OPTIONS,
  WORK_OPTIONS,
  buildUserPrompt,
  violatesCompliance,
} from "./partnerPitch";

const nameLine = "No partner name was given — write in inviting second person.";

describe("buildUserPrompt — expanded quiz inputs", () => {
  it("includes hesitations with tactful-handling instructions when provided", () => {
    const prompt = buildUserPrompt(
      {
        selections: ["Lake/Water Life"],
        city: "New Braunfels",
        hesitations: ["Leaving family/friends", "Cost of moving"],
      },
      nameLine
    );
    expect(prompt).toContain("Leaving family/friends, Cost of moving");
    expect(prompt).toContain("Tactfully");
    expect(prompt).toContain("Never dismiss or belittle");
  });

  it("includes the work situation with practical-framing instructions when provided", () => {
    const prompt = buildUserPrompt(
      {
        selections: ["Space & Land"],
        city: "San Antonio",
        workSituation: "Remote/Work From Home",
      },
      nameLine
    );
    expect(prompt).toContain("Remote/Work From Home");
    expect(prompt).toContain("Do not cite statistics or make guarantees about employment");
  });

  it("omits hesitation and work blocks entirely when not provided (back-compat)", () => {
    const prompt = buildUserPrompt(
      { selections: ["Top-Rated Schools"], city: "DFW" },
      nameLine
    );
    expect(prompt).not.toContain("hesitation");
    expect(prompt).not.toContain("work situation");
    expect(prompt).toContain("Their dream-life picks: Top-Rated Schools.");
    expect(prompt).toContain("Write the dream scene now.");
  });

  it("appends the compliance retry suffix when given", () => {
    const prompt = buildUserPrompt(
      { selections: ["Short Commute"], city: "Austin" },
      nameLine,
      " IMPORTANT: absolutely no numbers."
    );
    expect(prompt.endsWith("IMPORTANT: absolutely no numbers.")).toBe(true);
  });

  it("exports exactly the six hesitation options and four work options from the brief", () => {
    expect(HESITATION_OPTIONS).toEqual([
      "Leaving family/friends",
      "Cold weather where we are now",
      "Job/career concerns",
      "Cost of moving",
      "Never lived somewhere new",
      'Not sure Texas is "us"',
    ]);
    expect(WORK_OPTIONS).toEqual([
      "Remote/Work From Home",
      "Hybrid",
      "Would need to find a new job",
      "Business owner",
    ]);
  });
});

describe("compliance guard still applies to expanded flow", () => {
  it("rejects rates/dollar figures regardless of new inputs", () => {
    expect(violatesCompliance("Lock in a 3.99% rate today")).toBe(true);
    expect(violatesCompliance("Save $6,000 when you move")).toBe(true);
    expect(violatesCompliance("Your remote desk faces the Guadalupe River.")).toBe(false);
  });
});
