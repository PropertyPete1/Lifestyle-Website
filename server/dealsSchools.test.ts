import { describe, expect, it } from "vitest";
import { KNOWN_DISTRICTS, normalizeDistrict, resolveDistrict } from "../shared/dealsSchools";
import { ZIP_DISTRICTS } from "../shared/dealsZipDistricts";
import { scrubPrivateNames } from "../shared/deals";

/**
 * School districts (October 26, 2026): one canonical name however a builder wrote it; the ZIP code's district when
 * the builder names none; never the builder's raw wording on the site.
 */
describe("school district names", () => {
  it("reads every way builders write a district, including typos, page residue and marketing words", () => {
    const cases: Array<[string, string | null]> = [
      ["NEISD", "North East ISD"], ["Northeast ISD", "North East ISD"], ["Northside I.S.D.", "Northside ISD"],
      ["Information Schools Schools Northside ISD", "Northside ISD"], ["this community Gas Community Northside ISD", "Northside ISD"],
      ["Top-rated Shertz-Cibolo-Universal City ISD", "Schertz-Cibolo-Universal City ISD"], ["SCUC ISD", "Schertz-Cibolo-Universal City ISD"],
      ["Schertz-Cibolo-University City Independent School District", "Schertz-Cibolo-Universal City ISD"],
      ["East Central Independent School District", "East Central ISD"], ["Community Highlights East Central School District", "East Central ISD"],
      ["Comal I.S.D. & New Braunfels I.S.D.", "Comal ISD"], ["Hills Golf Course Comal ISD", "Comal ISD"],
      ["Medina Valley", "Medina Valley ISD"], ["Medina ISD", "Medina ISD"], ["Castroville", "Medina Valley ISD"],
      ["Kyle Hays Consolidated ISD", "Hays CISD"], ["Hays ISD", "Hays CISD"], ["San Marcos Consolidated Independent School District", "San Marcos CISD"],
      ["Burnet Consolidated Independent School District", "Burnet CISD"], ["Lake Georgetown Liberty Hill ISD", "Liberty Hill ISD"],
      ["Highly Acclaimed Seguin Independent School District", "Seguin ISD"], ["Round Rock Independent", "Round Rock ISD"],
      ["Schools Austin ISD", "Austin ISD"], ["Leander Independent", "Leander ISD"],
      ["N/A", null], ["Independent School District", null], ["Guadalupe School District", null], ["Keller Independent School District", null], ["", null],
    ];
    for (const [input, expected] of cases) expect(normalizeDistrict(input), input).toBe(expected);
    for (const name of KNOWN_DISTRICTS) expect(normalizeDistrict(name)).toBe(name);
  });

  it("takes the builder's district when it names one, the ZIP code's otherwise, and nothing when neither helps", () => {
    const map = { "78253": "Medina Valley ISD", "78640": "Hays CISD" };
    expect(resolveDistrict("Top-rated Northside ISD", "78253", map)).toEqual({ district: "Northside ISD", source: "builder" });
    expect(resolveDistrict("Information Schools", "78253", map)).toEqual({ district: "Medina Valley ISD", source: "zip" });
    expect(resolveDistrict(null, "78640", map)).toEqual({ district: "Hays CISD", source: "zip" });
    expect(resolveDistrict(null, "99999", map)).toEqual({ district: null, source: null });
    expect(resolveDistrict("N/A", null, map)).toEqual({ district: null, source: null });
  });

  it("maps every ZIP code to a canonical district name", () => {
    const zips = Object.keys(ZIP_DISTRICTS);
    expect(zips.length).toBeGreaterThan(90);
    for (const zip of zips) {
      expect(zip).toMatch(/^7[5-9]\d{3}$/);
      expect(KNOWN_DISTRICTS, `${zip}: ${ZIP_DISTRICTS[zip]}`).toContain(ZIP_DISTRICTS[zip]);
    }
    // Spot checks against known geography.
    expect(ZIP_DISTRICTS["78253"]).toMatch(/Medina Valley ISD|Northside ISD/);
    expect(ZIP_DISTRICTS["78640"]).toBe("Hays CISD");
    expect(ZIP_DISTRICTS["78130"]).toMatch(/Comal ISD|New Braunfels ISD/);
    expect(ZIP_DISTRICTS["78641"]).toBe("Leander ISD");
  });

  it("never lets a community's name through in the district (the scrub runs on the stored name too)", () => {
    // A canonical name never contains a community name, and the public catalog scrubs whatever is stored.
    const scrubbed = scrubPrivateNames("Fixture Lakes ISD", { community: ["Fixture Lakes"], street: [], plan: [], builder: [], lender: [], other: [] } as never);
    expect(scrubbed).not.toContain("Fixture Lakes");
    expect(normalizeDistrict("Fixture Lakes ISD")).toBeNull();
  });
});
