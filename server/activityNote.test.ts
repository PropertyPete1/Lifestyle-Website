import { describe, expect, it } from "vitest";
import { buildActivityNote } from "./activityNote";

type Row = {
  id: number;
  visitorId: string;
  kind: string;
  data: string | null;
  createdAt: Date;
};

let idSeq = 1;
function row(kind: string, data: Record<string, unknown>): Row {
  return {
    id: idSeq++,
    visitorId: "v-test",
    kind,
    data: JSON.stringify(data),
    createdAt: new Date("2026-07-20T12:00:00Z"),
  };
}

describe("buildActivityNote", () => {
  it("returns null for empty activity", () => {
    expect(buildActivityNote([])).toBeNull();
  });

  it("summarizes favorites with address, price, and city", () => {
    const note = buildActivityNote([
      row("favorite", { slug: "a", address: "1210 Canyon Ridge", city: "San Antonio", price: 525000 }),
    ]);
    expect(note).toContain("Favorited");
    expect(note).toContain("1210 Canyon Ridge");
    expect(note).toContain("$525K");
    expect(note).toContain("San Antonio");
  });

  it("nets out unfavorited listings", () => {
    const note = buildActivityNote([
      row("favorite", { slug: "a", address: "1210 Canyon Ridge", city: "San Antonio", price: 525000 }),
      row("unfavorite", { slug: "a", address: "1210 Canyon Ridge", city: "San Antonio", price: 525000 }),
    ]);
    // Only activity was a net-zero favorite → no meaningful note
    expect(note ?? "").not.toContain("1210 Canyon Ridge");
  });

  it("includes AI searches with query and criteria", () => {
    const note = buildActivityNote([
      row("ai_search", { query: "4 bed pool under 600k", criteria: "4+ beds, under $600K, pool", resultCount: 6 }),
    ]);
    expect(note).toContain('"4 bed pool under 600k"');
    expect(note).toContain("4+ beds");
  });

  it("includes Convince quiz picks and matched city", () => {
    const note = buildActivityNote([
      row("convince_quiz", { selections: ["Lake/Water Life", "Low Taxes & Cost of Living"], city: "New Braunfels" }),
    ]);
    expect(note).toContain("Convince Your Partner");
    expect(note).toContain("Lake/Water Life");
    expect(note).toContain("New Braunfels");
  });

  it("includes City Finder match and runner-up", () => {
    const note = buildActivityNote([
      row("city_finder", { city: "New Braunfels", runnerUp: "San Antonio" }),
    ]);
    expect(note).toContain("City Finder");
    expect(note).toContain("New Braunfels");
    expect(note).toContain("San Antonio");
  });

  it("combines multiple activity kinds into one note", () => {
    const note = buildActivityNote([
      row("favorite", { slug: "a", address: "1210 Canyon Ridge", city: "San Antonio", price: 525000 }),
      row("ai_search", { query: "pool homes", criteria: "pool", resultCount: 9 }),
      row("city_finder", { city: "DFW" }),
    ]);
    expect(note).toContain("Site activity before inquiry");
    expect(note).toContain("Favorited");
    expect(note).toContain("pool homes");
    expect(note).toContain("DFW");
  });
});
