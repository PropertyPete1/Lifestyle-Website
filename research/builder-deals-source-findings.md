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

## D.R. Horton reader (added 2026-10-20)

- **Community source:** `https://www.drhorton.com/texas/san-antonio/<city>/<community>` (the research list has 33; the market listing has 57, a few in other markets' paths such as `/texas/san-marcos/seguin/...`, which the reader accepts on the official host).
- **Site shape:** Sitecore, server-rendered. The community page carries every home for sale and every floor plan as cards (443 KB), so one page is the whole inventory. `#relatedmovein` and `#floorplans` carry `data-currentindex` / `data-totalitems`; when they differ the rest sits behind `moveinreadyapi/getrelated`, which the reader does not call: it holds `incomplete_inventory` instead. Live pages render everything (66 of 66 at the largest community, Redbird Ranch).
- **Home card:** `a.available-home-card` with `href=".../qmis/<address-slug>"`; `h2` price with `<del>was $…</del>` and an estimated-payment widget (ignored), `h3` street, stats "3 Bed | 2 Bath | 2 Garage" and "1 Story | 1,489 Sq. Ft. | Lot 20". A home under contract is the same card with class `disabled`, no href and "Under Contract" in place of the price. D.R. Horton publishes no move-in date; a home for sale is "Quick Move-In (For Sale)".
- **Plan card:** `a.CoveoResultLink[href*="/floor-plans/"]`, `h2` name ("The Alamo"), `h3` "Starting in the $242s" (the band's low end is the plan price).
- **Home page:** `.PropertyGallery img[data-lazy]` under the home's own media folder `…/<lot>-<address-slug>/…`; `fp-*` floor-plan drawings, `interior_features_*` sheets and other homes' folders are skipped; thumbnail sizing (`w=`, `thn=`, `as=`) is removed. The stats line ends "| The Caroline floor plan" (the plan name).
- **Records:** a `Place` record named after the page title with lower-case address keys and top-level `latitude`/`longitude`, then a `LocalBusiness` record with the community name and sales address (city in capitals). Discovery takes the plain-named record and borrows the coordinates.
- **Discovery:** no usable sitemap (`/sitemaps/website.xml` is 17 MB, 42,000 URLs, `http://` scheme); the community finder's `GET /api/comms/direct/texas/san-antonio` (70 KB JSON, `CommunityData[].commPageLink`) lists the market, including communities 50+ miles out (Kyle, Buda, Austin), which the 45-mile check drops.
- **Scrub:** builder names plus the product lines ("Express Series", "Emerald Homes", "Freedom Homes", "Tradition Series"); lender DHI Mortgage.
- **Incentives:** the Red Tag Event is a site-wide banner with its own terms page; none is read as a community incentive.
- **Bot protection:** Cloudflare (Turnstile is loaded on the page); the browser pane reads the pages, the cloud has not been tried. A challenge page comes back as `community_fetch_failed` and holds the run.

## PulteGroup reader: Pulte, Centex, Del Webb (added 2026-10-20)

- **Community source:** `https://www.pulte.com|www.centex.com|www.delwebb.com/homes/texas/san-antonio/<city>/<community>-<id>` (research list: 10 Pulte, 11 Centex, 1 Del Webb; the market listing has 22 across the three brands, often the same community twice, once per brand).
- **Site shape:** one platform behind three hosts, with JSON endpoints the pages themselves call. Community pages are 8.6–8.8 MB (over the 8 MB document cap) and are never read; home pages are about 2.1 MB and plan pages 3.2 MB.
- **Endpoints:** `/API/Community/Search?State=Texas&Region=San Antonio&Brand=<brand>&JsonFormat=true&pageSize=0` (every brand's communities: `id, name, pageURL, brandName, status, address{street1,city,zipCode}, latitude, longitude, salesPhoneNumber, startingFromPrice, schoolDistrictLabel, isCommunityActive`; about 510 KB; read once an hour per host). `/api/plan/qmiplans?communityId=<id>` (homes for sale: `address, price, priceDiscount, finalPrice, dateAvailable` "Available Now" | "Oct 2026", `bedrooms, totalBaths, squareFeet, garages, lotBlock, soldDate, qmiFlagName` "Special Financing Available" | "Builder's Best Price", `images[]`, `mortgagePayment{interestRatePercent, apr, loanType, downPaymentPercentage, forwardCommitmentFlag, forwardCommitmentAPR, forwardCommitmentContractAfterDate, forwardCommitmentCloseByDate}`). `/api/plan/homeplans?communityId=<id>` (plans: `planName, price, bedrooms, maxTotalBaths, squareFeet, garages, isSoldOut, isFutureRelease, isPlanActive, pageURL, images[]`).
- **Photos:** `images[].path` is a Picturepark share URL (`https://pultegroup.cdn.picturepark.com/v/<id>/`) that returns the JPEG directly; ordered by `imageRank`; floor-plan and event images skipped by `imageType`/caption.
- **Offers:** every home and plan page renders the brand's market offers in a `SpecialOffersV2` carousel: slide title, `SpecialOffersV2__description`, and the disclaimer behind the (i) button in the `data-content` attribute. October 2026 Centex slide: "...FHA 30-year fixed rate as low as 4.75% / 5.58% APR ... through October 31" with a disclaimer giving FHA 30 year fixed, 3.5% down payment, 4.75%/5.58% APR, purchase agreements accepted by 10/31/2026, loans locked and closed by 10/31/26. The reader takes the slide that names a rate, drops the licensing/NMLS links and copyright line, and the existing promotional-rate parser reads every fact (publishable without admin edits). The same slides appear on every community of the brand, so one home page an hour per brand is read. The per-home `mortgagePayment.forwardCommitmentFlag` marks the homes the special rate applies to; it is not used as an incentive source (its APR differs from the advertised one).
- **Discovery:** the market listing carries the record (name, sales address, phone, coordinates, starting price), so discovery adds communities without reading a page; inactive (`isCommunityActive: false`) entries and other brands' hosts are left to their own readers.
- **Scrub:** PulteGroup, Pulte Homes, Pulte, Centex Homes, Centex, Del Webb; lender Pulte Mortgage (LLC).
- **Bot protection:** none seen; plain GETs from the browser pane returned JSON and pages.

## Homefiniti reader: First America Homes, Coventry Homes (added 2026-10-20)

- **Community sources:** `https://www.firstamericahomes.com/new-homes/tx/san-antonio-metro/<city>/<community>/` (research list: 21) and `https://www.coventryhomes.com/new-homes/tx/<city>/<community>/` (16, plus width collections such as `garden-grove-40`). Both sites run on the same platform (media host `media.<builder>.com/<id>/…`, SKUs `HF-C<id>-B<builder>-S<home>` / `-P<plan>`); CastleRock's c-rock.com is the same vendor's newer React build and is read differently (see below).
- **Site shape:** server-rendered (190–410 KB). One schema.org record per home for sale, `@type ["Product","SingleFamilyResidence"]`: `name`/`address.streetAddress`, `offers.price` ("326140.00"), `offers.url`/`url` (the home page), `numberOfBedrooms`, `numberOfFullBathrooms` + `numberOfPartialBathrooms`, `floorSize.value`, `image[]` (one of them the floor-plan drawing, named `*Floorplan*`), `model` (the plan page URL), `geo`, `sku`. One per plan, `@type ["ProductModel","SingleFamilyResidence"]`, with QuantitativeValue ranges and `offers.availability: PreSale`. The community's own record is `HomeAndConstructionBusiness` with address, phone and coordinates.
- **Cards:** First America: `.status-text` ("Under Construction", "Move-In Ready") beside three links to the home page. Coventry: `article.card-spec[data-price]` with `.status` in a badge above the photo and, in the card body, the price with `.text-strikethrough` for the price it dropped from ("$650,363") and a "$50K off" badge. The reader takes the status from the card around the home's link and the struck-through price from the same card.
- **Status words seen:** Under Construction, Move-In Ready. A home on the available-homes list with no card is a layout change (`unlabelled_home_status`).
- **Discovery:** First America: `/sitemap.xml` (1,200 URLs), community pages at `/new-homes/tx/san-antonio-metro/<city>/<slug>/`, plans at `.../san-antonio-metro/floorplans/…` (skipped). Coventry: the sitemap lists 270 Texas community pages with no market in the path, so the San Antonio market page `/new-homes/tx/san-antonio/` is the index (34 links, including `available-homes` and `build-on-your-lot-*` pages, which are skipped).
- **Incentives:** Coventry shows a site-wide banner ("Interest Rates Starting at 3.99% (5.899% APR)") whose "Details" page (`/sales-event/`) publishes no terms; First America mentions "$0 down available". Neither is read as a community incentive.
- **Bot protection:** none seen.

## CastleRock Communities (c-rock.com): deferred

- Community pages are a React Router app whose data loader returns only page metadata; homes and plans are fetched by the browser from `qrb.c-rock.com/rest/v1/specs_search_view` / `plans_search_view` / `locations` (PostgREST), which answers 401 "No API key found" without the anon key embedded in the site's JavaScript bundle. Reading it would mean using the builder's own frontend credential, so this builder stays on the research list (hidden) until there is a page or feed that needs no key.

## Davidson Homes reader (added 2026-10-20)

- **Community source:** `https://www.davidsonhomes.com/states/texas/san-antonio-market-area/<city>/<community>/` (research list: 18; the market page lists 18).
- **Site shape:** Next.js (pages router). The community page (about 870 KB) carries everything in `__NEXT_DATA__.props.pageProps`: `community.availableHomes[]` (`title` = street, `slug`, `status` "Active", `overrideMls` "moveinready" | "nooverride", `estCompletionMonth` "2026-10-02", `price`, `oldPrice`, `beds`, `baths`, `halfBaths`, `sqft`, `lotId`, `floorPlanPicker.title`, `propertyImages[].asset._ref` Sanity references), `community.plans[]`, `community.salesOffice` (street, zip), `community.coordinates`, `community.communityPriceRange.lowestPrice`, `community.schools[]`, `community.features[]`, and `community.communityBanner.template.bannerLink` (the region's promotion page). `pageProps.city.title` names the city. No schema.org record on the page.
- **Photos:** Sanity CDN, `https://cdn.sanity.io/images/<project>/<dataset>/<hash>-<w>x<h>.<fmt>`; the project id and dataset are read off the page's own image URLs (`2nureyi3/production` in October 2026). Images whose alt text names a floor plan are skipped.
- **Promotion page:** `/states/texas/san-antonio-market-area/promotions/<slug>/`, `pageProps.promo`: `title`, `content[]` and `finePrint[]` (portable text), `eventEnd`, `incentivePercentage`, `incentiveApr`, `regions[].communities[].title` (the communities the offer applies to). October 2026: "4.5% FHA (6.380% APR) 5/1 ARM on select quick move-in homes when you purchase by October 31, 2026, plus up to $10,000 … with NorthStar Mortgage Advisors"; the fine print gives 3.5% down and the ARM terms. Read once an hour per region; the offer is attached only to the communities the page lists. An ARM holds the incentive (`adjustable_rate`) for the admin's look before it shows.
- **Discovery:** the market page `/states/texas/san-antonio-market-area/` lists the communities in `pageProps.communities[].uri`; the community page's data gives the sales address (a reader-specific record parser, since the page has no schema.org record). The sitemap (900 KB, 3,500 URLs) is not used.
- **Scrub:** Davidson Homes, Davidson; lender NorthStar Mortgage Advisors.
- **Bot protection:** none seen.

## Highland Homes reader (added 2026-10-20)

- **Community source:** `https://www.highlandhomes.com/san-antonio/<city>/<community>` (research list: 16; the sitemap names 18 San Antonio market pages, one of them the `new-home-concierge` page and one in San Marcos, outside the area).
- **Site shape:** server-rendered (about 330 KB), Cloudflare Turnstile loaded on the page but no challenge seen. Quick move-in homes are `a.homeSpec` cards: `.price` ("$649,816"), `.homeIdentifier` (street), `.homeUpgrades` ("216 Plan with 3 upgrades"), `.homeDetailItem` numeral/label pairs (beds, baths as "4/1" = four full and one half, stories, garages), `.homeSqFootage`, one `img[data-src]` on `media.hhomesltd.com`, and a `.home-tag` status ("Complete & Move-in Ready!", "Est. Completion - Nov '26"). The section says "N quick move-in homes"; fewer cards than that holds the run. Floor plans and the community list are rendered in the browser from a search index (Algolia) and are not read.
- **Community line:** `#salesOfficeAddressDirectionsLink` ("13316 Sweet Acacia, San Antonio, TX 78245"), `<h1><strong>Briggs Ranch</strong>`, "O: 210-686-1496", and a `maps.google.com/maps?q=loc:LAT,LNG(` link; no schema.org record. Discovery reads these off the page (reader-specific record).
- **Incentives:** a promotion overlay ("Rates as Low as 4.99% / Or up to $50,000 in savings!") linking to an outside campaign page with no terms; not read.
- **Scrub:** Highland Homes, Highland; lender Highland HomeLoans.
