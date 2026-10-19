# Builder Deals adapter fixtures (SYNTHETIC)

Every file in this directory is synthetic. The markup and JSON are composed to
match the shapes the adapters parse (M/I PlansQmi `{TotalItems, Html}` pages
with `.home-card` cards and one `application/ld+json` Product per card; the M/I
promotion page with `.single-incentive__headline` inside
`.content-inner-content`; Chesmar plan and inventory pages with an h1 stat
block and a slider/gallery container; Chesmar sitemap index plus url sets) as
described in the Manus round-2 reply (A3/A4), but every community, plan, street,
address, GUID, price and photo URL is a placeholder, never a capture of a real
listing. The Chesmar incentive wording is the public campaign text quoted in
that reply.

Replace a file with a real capture of the same page type when one is available;
the tests in `server/dealsAdapters.fixtures.test.ts` and `server/dealsSync.test.ts`
read these files by name.

| File | Page type |
| --- | --- |
| mi-community.html | M/I community page (GUID marker, homes container, incentive link) |
| mi-plansqmi-homes-items-0.json | PlansQmi type=homes items=0 (first five cards) |
| mi-plansqmi-homes-items-5.json | PlansQmi type=homes items=5 (next three cards, one boundary repeat) |
| mi-plansqmi-plans-items-0.json | PlansQmi type=plans items=0 (three plans) |
| mi-plansqmi-plans-items-0-empty.json | PlansQmi type=plans with zero plans |
| mi-home-page.html | M/I home page (gallery modal) |
| mi-plan-page.html | M/I plan page (gallery modal) |
| mi-promotion-page.html | M/I promotion page |
| chesmar-community.html | Chesmar community page (floorplans container, nav range) |
| chesmar-sitemap-index.xml, chesmar-sitemap-pages.xml, chesmar-sitemap-homes.xml | Chesmar sitemap index and url sets |
| chesmar-plan-page.html | Chesmar plan page |
| chesmar-inventory-page.html | Chesmar quick move-in home page |
| chesmar-model-page.html | Chesmar model home page (never a QMI) |
| chesmar-incentives.html | Chesmar /incentives/ page |

## Live-structure Chesmar fixtures (October 2026)

`chesmar-community-live.html`, `chesmar-plan-page-live.html`, `chesmar-home-page-live.html` and the
`chesmar-sitemap-live-*.xml` files mirror the markup the official site served in October 2026 (Blazor server
pages with synthetic names, prices and photo ids): the community page renders its floor-plan list client-side,
so the served HTML only carries an empty results container; plan and home pages keep their photos in a
`#heroSlider` carousel of `<picture>` elements with `.webp` and `.jpg` sources, their facts in a labelled
Overview list and icon tiles, the plan name in `.f-title`, the lot address in the breadcrumb, and the sale
status in the document title ("... | Model For Tour in ..."). `server/dealsAdapters.live.test.ts` covers them.
