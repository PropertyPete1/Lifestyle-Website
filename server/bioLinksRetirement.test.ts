import { describe, expect, it, vi } from "vitest";
import {
  RETIRED_BIO_LINKS,
  bootstrapRetiredBioLinks,
} from "../scripts-reorder-bio-links.mjs";

const PRIMARY = RETIRED_BIO_LINKS[0];

describe("scripts-reorder-bio-links", () => {
  it("adds the formerly hardcoded PRIMARY CTA as a deactivated recoverable row", async () => {
    const execute = vi.fn().mockResolvedValue([{ insertId: 150002 }]);
    const conn = {
      query: vi.fn().mockResolvedValue([
        [
          {
            id: 30005,
            label: "New Construction Search",
            url: "https://a.nhb.app/u/peter-allen",
            sortOrder: 1,
            active: true,
          },
        ],
      ]),
      execute,
    };

    const result = await bootstrapRetiredBioLinks(conn as never, vi.fn());

    expect(result.inserted).toEqual([PRIMARY]);
    expect(execute).toHaveBeenCalledWith(
      "INSERT INTO bio_links (label, url, sortOrder, active) VALUES (?,?,?,false)",
      [PRIMARY.label, PRIMARY.url, PRIMARY.sortOrder]
    );
  });

  it("never changes an existing row, even if an admin later reactivates it", async () => {
    const execute = vi.fn();
    const existingPrimary = {
      id: 150002,
      ...PRIMARY,
      active: true,
    };
    const conn = {
      query: vi.fn().mockResolvedValue([[existingPrimary]]),
      execute,
    };

    const result = await bootstrapRetiredBioLinks(conn as never, vi.fn());

    expect(result.inserted).toEqual([]);
    expect(result.preserved).toEqual([existingPrimary]);
    expect(execute).not.toHaveBeenCalled();
  });
});
