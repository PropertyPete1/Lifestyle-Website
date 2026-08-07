import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A phone error a visitor cannot hear is a phone error that loses the lead.
 *
 * The inline phone error was announced once via role="alert", and the input
 * was marked aria-invalid — but nothing connected the two. A screen-reader
 * user who tabbed back to the field after the announcement passed heard
 * "Phone, invalid entry" with no explanation of what was wrong with it, on
 * the one required field that gates every lead on the site.
 *
 * These tests pin the association for each form that collects a phone.
 */

const FORMS = [
  { file: "GetStartedForm.tsx", inputId: "gs-phone", errorId: "gs-phone-error", idAttr: `id="gs-phone-error"` },
  { file: "RecruitForm.tsx", inputId: "rc-phone", errorId: "rc-phone-error", idAttr: `id="rc-phone-error"` },
  // LeadForm ids are derived from the sourceTag prop so one component can back
  // several forms on a page without colliding ids.
  { file: "LeadForm.tsx", inputId: "${sourceTag}-phone", errorId: "${sourceTag}-phone-error", idAttr: "id={`${sourceTag}-phone-error`}" },
] as const;

const read = (file: string) =>
  readFileSync(join(process.cwd(), "client/src/components", file), "utf8");

describe("inline phone error is announced and associated", () => {
  for (const form of FORMS) {
    describe(form.file, () => {
      const src = read(form.file);

      it("renders the error text with an id", () => {
        expect(src).toContain(form.idAttr);
      });

      it("points the phone input at that id via aria-describedby", () => {
        // The attribute must be present and reference the same id used above.
        expect(src).toMatch(/aria-describedby=\{fieldError === PHONE_HINT \?/);
        expect(src).toContain(form.errorId);
      });

      it("keeps aria-invalid on the input so the state is exposed too", () => {
        expect(src).toMatch(/aria-invalid=\{fieldError === PHONE_HINT \|\| undefined\}/);
      });

      it("only describes the field while the error is showing", () => {
        // A stale aria-describedby pointing at a removed node is worse than
        // none, so the attribute is conditional on the same predicate that
        // renders the message.
        expect(src).toMatch(/aria-describedby=\{fieldError === PHONE_HINT \? [^:]+ : undefined\}/);
      });

      it("still announces immediately via role=alert", () => {
        expect(src).toMatch(/role="alert"[^>]*>\{PHONE_HINT\}/);
      });
    });
  }
});
