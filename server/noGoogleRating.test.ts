import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { readdirSync } from "fs";

/** Nov 3, 2026 (Peter: "remove the Google reviews everywhere"): no Google star rating on any page or component. */
describe("no Google rating anywhere", () => {
  it("no component or page mentions a star rating on Google", () => {
    const dirs = ["client/src/pages", "client/src/components"];
    for (const dir of dirs) for (const file of readdirSync(join(__dirname, "..", dir))) {
      if (!file.endsWith(".tsx")) continue;
      const src = readFileSync(join(__dirname, "..", dir, file), "utf-8");
      expect(src, `${dir}/${file}`).not.toMatch(/★ on Google|on Google|Google rating|Google reviews?/i);
    }
  });
});
