import type { BioLink } from "../drizzle/schema";

/**
 * Build-time snapshot of the bio_links rows, used as react-query
 * `placeholderData` on /links so the whole button stack paints in the first
 * frame instead of popping in a network round-trip after the hardcoded
 * MEET PRIMARY row. The live query still runs and wins: if an admin edits
 * links, the page updates the moment the fetch lands — this data is only
 * what the visitor sees during that window, so staleness costs at most one
 * brief swap on the rare day the links actually changed.
 *
 * Regenerate after editing links in Admin → Bio Links (only active rows,
 * in sortOrder):
 *
 *   curl -s "https://lifestyledesignrealty.com/api/trpc/links.list?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D" \
 *     | jq '.[0].result.data.json'
 */
export const BIO_LINKS_SNAPSHOT: BioLink[] = [
  {
    id: 30005,
    label: "New Construction Search",
    url: "https://a.nhb.app/u/peter-allen",
    sortOrder: 1,
    active: true,
  },
  {
    id: 30003,
    label: "Find Your Texas City",
    url: "/city-finder",
    sortOrder: 2,
    active: true,
  },
  {
    id: 90002,
    label: "Explore Our Full Website",
    url: "/",
    sortOrder: 6,
    active: true,
  },
  {
    id: 150001,
    label: "Top Recommended Cleaning Service",
    url: "https://grapeclean-skvabkkr.manus.space/en?utm_source=ig&utm_medium=social&utm_content=link_in_bio&fbclid=PAZnRzaAT6pxhwZG9mAmZkaWQWUNLhDPKFG6GNRiY9UzUmgzQNGPBJ82V4dG4DYWVtAjExAHNydGMGYXBwX2lkDzEyNDAyNDU3NDI4NzQxNAABpw_2VDQSUP7GkWE3S6RwduVTSiNGdAShnEDZFbJot-oZ3KmgfTVo_zXgd9Nk_aem_NDVPbeKodiU7m69c36oGgA&utm_id=97760_v0_s00_e0_tv3",
    sortOrder: 11,
    active: true,
  },
];
