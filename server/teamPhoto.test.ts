import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

(globalThis as { React?: typeof React }).React = React;
const { default: TeamPhoto, teamInitials } = await import("../client/src/components/TeamPhoto");

/**
 * Oct 31, 2026 (Peter: "I don't have a photo yet so don't just leave it blank"; "removed designated Broker under Steven").
 */
describe("team cards", () => {
  it("shows a branded card with the initials when there is no headshot", () => {
    const html = renderToStaticMarkup(React.createElement(TeamPhoto, { photo: "", name: "Nicki Pauley", className: "x" }));
    expect(html).toContain('data-team-photo-fallback="true"');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Nicki Pauley"');
    expect(html).toContain(">NP<");
    expect(html).toContain("Lifestyle Design Realty");
    expect(teamInitials("Stefanie Graham")).toBe("SG");
    expect(teamInitials("Cher")).toBe("C");
  });

  it("shows the headshot when there is one", () => {
    const html = renderToStaticMarkup(React.createElement(TeamPhoto, { photo: "/team/laila.webp", name: "Laila Maria", className: "h-full" }));
    expect(html).toContain('src="/team/laila.webp"');
    expect(html).not.toContain("data-team-photo-fallback");
  });

  it("shows a photo stored with #full whole: contained, never cropped or stretched, over a blurred copy of itself (Nov 16)", () => {
    const html = renderToStaticMarkup(React.createElement(TeamPhoto, { photo: "/team/tanya-torres.webp#full", name: "Tanya Torres", className: "h-full w-full object-cover" }));
    expect(html).toContain('data-team-photo-full="true"');
    expect(html).toContain('data-team-photo-backdrop="true"');
    expect(html).toMatch(/alt="Tanya Torres"[^>]*class="relative h-full w-full object-contain"|class="relative h-full w-full object-contain"[^>]*alt="Tanya Torres"/);
    expect(html.match(/src="\/team\/tanya-torres\.webp"/g)).toHaveLength(2);
    expect(html).not.toContain("#full");
    // An ordinary headshot is unchanged.
    expect(renderToStaticMarkup(React.createElement(TeamPhoto, { photo: "/team/laila.webp", name: "Laila Maria", className: "h-full w-full object-cover" }))).not.toContain("object-contain");
  });

  it("frames the card on both team grids and drops 'Designated Broker' on /join", () => {
    const home = readFileSync(join(__dirname, "../client/src/pages/Home.tsx"), "utf-8");
    expect(home).toContain('<div className="relative flex aspect-[3/4] items-center justify-center overflow-hidden bg-secondary">');
    const team = readFileSync(join(__dirname, "../client/src/pages/Team.tsx"), "utf-8");
    expect(team).toContain('<div className="relative aspect-[3/4] bg-secondary overflow-hidden flex items-center justify-center">');
    const joinPage = readFileSync(join(__dirname, "../client/src/pages/Join.tsx"), "utf-8");
    expect(joinPage).toContain('{ name: "Steven Van Orden", title: "Broker & Owner", photo: "/team/steven-van-orden.webp" }');
    expect(joinPage).not.toContain("· Designated Broker");
  });
});
