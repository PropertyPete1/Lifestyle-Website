import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/** Nov 3, 2026: the website texting task files every send and reply on the lead and its FUB contact. */
describe("leads.textingNote", () => {
  it("is an admin mutation that appends to the lead and posts the FUB note when the lead has a contact", () => {
    const src = readFileSync(join(__dirname, "../server/routers.ts"), "utf-8");
    expect(src).toMatch(/textingNote: adminProcedure\.input\(z\.object\(\{ id: z\.number\(\)\.int\(\)\.positive\(\), subject: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(190\), body: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(5000\) \}\)\)\.mutation/);
    expect(src).toContain('await db.updateLead(input.id, { message: [lead.message, `[${stamp}] ${input.subject}: ${input.body}`].filter(Boolean).join("\\n") });');
    expect(src).toContain('const fub = lead.fubId ? await sendFubNote(lead.fubId, input.subject, input.body) : { ok: false as const, error: "no FUB contact on the lead" };');
  });
});
