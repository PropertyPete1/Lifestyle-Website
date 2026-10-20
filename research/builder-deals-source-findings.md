# Builder Deals official-source findings

Collected 2026-10-18 for the two launch communities. This file is internal only. Builder/community names, addresses, source URLs, and plan names remain private and must never be serialized in public Deals HTML, metadata, image bytes, or browser-visible API responses.

## Chesmar adapter

- **Community source:** <https://www.chesmar.com/texas/san-antonio-new-homes/san-antonio/sienna-lakes/>
- **Discovery sources:** <https://www.chesmar.com/sitemap5.xml> for plans and <https://www.chesmar.com/sitemap6.xml> for specific inventory/model pages.
- **Data strategy:** plain unauthenticated `GET` plus server-rendered HTML parsing. The observed Blazor transport is not a stable inventory feed and must not be used as one.
- **Current verified facts:** East Central ISD; from $499,990; 2,340 to 3,834 sq. ft.; half-acre lots, trails, and lakes. Current server-rendered FloorPlans/Model Homes panel showed zero quick move-in results. Treat this as no confirmed quick-move-in inventory, not proof that inventory does not exist.
- **Plans:** sitemap discovery found current plan-detail pages; detail pages expose starting price, beds, baths, square footage, gallery and floorplan assets via plain fetch.
- **Homes:** crawl official sitemap entries matching the private community path, fetch each canonical home/model detail, and use official status text. A current known detail was marked Model For Tour, not a quick move-in, so it must not be relabeled as available.
- **Photos:** extract first-party image links from `picture > source[srcset]` or `picture > img.bg-image[src]`; prefer WebP source with JPEG fallback.

## M/I Homes adapter

- **Community source:** <https://www.mihomes.com/new-homes/texas/greater-san-antonio/southeast-san-antonio/vista-gardens>
- **Promotion source:** <https://www.mihomes.com/new-homes/texas/greater-san-antonio/incentives/fall-into-savings-2026>
- **Data strategy:** plain unauthenticated `GET` plus server-rendered HTML parsing. No stable public catalog JSON/XHR feed was confirmed. Never call the page's POST lead-form endpoints or click-goal URL.
- **Current verified facts:** now selling; 1,530 to 4,099 sq. ft.; East Central ISD; from $354,990; half-acre homesites. Public incentive copy says contracts through 2026-11-08 and qualifying quick-move-ins closing by 2026-11-30. The user supplied the missing follow-on rate: 5.25% for years 2 to 30 on a 30-year fixed FHA 1/0 buydown, 6.051% APR.
- **Plans:** same-community canonical paths ending `-plan` have server-rendered plan details, stats, floorplan assets, and photos. Use only canonical same-community links.
- **Homes:** specific homes follow `/vista-gardens/{plan-slug}-plan/{address-slug}`. Parse the labeled stat/overview block. Related quick-move-in cards seed additional canonical same-community crawls but are not proof of a complete inventory list.
- **Photos:** use gallery elements `[data-gallery="simple-gallery-modal"]` and image `srcset`, preferring largest variant. Asset references are sourced from official page markup.

## Rule reminders

- Revalidate official pages on every refresh and retain last known good data if the homes container disappears or the page fails.
- The public rate copy must never omit APR, a promotional follow-on rate/period, down payment, or repayment terms when required.
- Incentives are held, not published, when a contract/sign date is present but unparsed, when any required pricing disclosure is missing, or when the incentive text changes after a sticky manual deadline.
- All public text must undergo private-name scrubbing before storage and output.

## Perry Homes reader (added 2026-10-20)

- **Community source:** `https://www.perryhomes.com/new-homes/texas/san-antonio/<community>` (the research list has 30).
- **Site shape:** Next.js app router. Pages are served with their data in the React Flight payload (`self.__next_f.push([1,"..."])` script tags); the visible home cards on a collection page are rendered client-side from Algolia, which the reader never calls. The single `sitemap.xml` (about 8,500 URLs) lists every home and plan page; it is read once an hour, not once per community.
- **Pages under a community:** collections (`.../<community>-65`), homes (address slugs such as `119-kramm-trail`), plans (design ids such as `2206h`), and a `sales-center` page (skipped).
- **Home page object:** `"address":{address_1,city,state,zip}`, `"home_details":{baths,bedrooms,...,garage,half_baths,price,price_discounted,sq_ft,story}`, then `move_in_ready_display_status`, `home_title`, `home_url`, `badge` ("Move-In Ready" or "<Month> Move-In"), `design_id`. The sale price is `price_discounted` when present, with `price` as the list price it dropped from. A plan page has `price_discounted: 0` and `badge: "Available to Build"`.
- **Photos:** Cloudinary images whose `metadata.job_number` is the home's `home_details_id`; a home under construction has none yet, so the design's representative exterior stands in (captioned "Representative image"). Floor-plan drawings are never used (they show the plan name).
- **Facts:** the community page text carries the school district ("... ISD"); the from-price is a band ("From the $560s") and is left to the research list / the homes.
- **Incentives:** Perry's offers are site-wide banners with a separate terms page; none is read as a community incentive.
- **Holds:** an unreadable or reshaped page, a sitemap off the official host, or more than 150 pages under one community (never truncated).
