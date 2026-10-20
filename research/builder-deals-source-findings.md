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
- **Status words seen:** Under Construction, Move-In Ready. The reader knows a closed list (ready words, Under Construction, sold words, Model); any other word, a home with no card, or two badges that disagree next to one home's links is a layout change (`unlabelled_home_status`). A home record of another community on the host ("nearby homes") holds `invalid_inventory_response`. Cards are counted once per set of home links, and only where the block holds one status element, so a featured strip or a community "Now Selling" badge is not a card.
- **Discovery:** First America: `/sitemap.xml` (1,200 URLs), community pages at `/new-homes/tx/san-antonio-metro/<city>/<slug>/`, plans at `.../san-antonio-metro/floorplans/…` (skipped). Coventry: the sitemap lists 270 Texas community pages with no market in the path, so the San Antonio market page `/new-homes/tx/san-antonio/` is the index (34 links, including `available-homes` and `build-on-your-lot-*` pages, which are skipped).
- **Incentives:** Coventry shows a site-wide banner ("Interest Rates Starting at 3.99% (5.899% APR)") whose "Details" page (`/sales-event/`) publishes no terms; First America mentions "$0 down available". Neither is read as a community incentive.
- **Bot protection:** none seen.

## CastleRock Communities (c-rock.com): deferred

- Community pages are a React Router app whose data loader returns only page metadata; homes and plans are fetched by the browser from `qrb.c-rock.com/rest/v1/specs_search_view` / `plans_search_view` / `locations` (PostgREST), which answers 401 "No API key found" without the anon key embedded in the site's JavaScript bundle. Reading it would mean using the builder's own frontend credential, so this builder stays on the research list (hidden) until there is a page or feed that needs no key.

## Davidson Homes reader (added 2026-10-20)

- **Community source:** `https://www.davidsonhomes.com/states/texas/san-antonio-market-area/<city>/<community>/` (research list: 18; the market page lists 18).
- **Site shape:** Next.js (pages router). The community page (about 870 KB) carries everything in `__NEXT_DATA__.props.pageProps`: `community.availableHomes[]` (`title` = street, `slug`, `status` "Active" (the reader publishes only this word and sold words; anything else, or an entry whose title/slug cannot be read, has no status and holds the run), `overrideMls` "moveinready" | "nooverride" (other values hold too), `estCompletionMonth` "2026-10-02", `price`, `oldPrice`, `beds`, `baths`, `halfBaths`, `sqft`, `lotId`, `floorPlanPicker.title`, `propertyImages[].asset._ref` Sanity references), `community.plans[]`, `community.salesOffice` (street, zip), `community.coordinates`, `community.communityPriceRange.lowestPrice`, `community.schools[]`, `community.features[]`, and `community.communityBanner.template.bannerLink` (the region's promotion page). `pageProps.city.title` names the city. No schema.org record on the page.
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

## Century Communities reader (added 2026-10-20)

- **Community source:** `https://www.centurycommunities.com/find-your-new-home/texas/san-antonio-metro/<city>/<community>/` (sitemap lists the metro's community pages and, under each, `lots/<lot>-<address-slug>/` home pages; discovery keeps the community pages only).
- **Site shape:** server-rendered (about 490 KB). One schema.org `ProductGroup` carries the homes for sale as `hasVariant` Products: `name` "9122 OCOTILLO RDG, San Antonio, TX 78222", `description` "3 beds, 2 baths, 1,388 sq ft", `offers.price`, `sku`, `url`, one `image` on the official host. The community's own record is `HomeAndConstructionBusiness` (address, phone, geo). Each home also has a card (`.street-number-text` link, `.est-complete-date` "Est. Completion: Dec. Move In." / "Move-in Ready!", `.title` plan "Easton - 1388", `.wasPrice` for a drop). The reader reads the records and takes completion, plan and the previous price from the card around the home's link; more cards than records holds the run. A completion month without a year is the next such month. Floor plans are not on the page.
- **Incentives:** a header line ("Flexible Tours | Below-Market Rates | Made-for-You Financing Options") with no terms; not read.
- **Scrub:** Century Communities, Century Complete, Century; lender Inspire Home Loans ("Inspire" alone is an ordinary word and is not an alias).

## KB Home reader (added 2026-10-20)

- **Community source:** `https://www.kbhome.com/new-homes-san-antonio/<slug>` (the market page lists 19 communities, New Braunfels included; the sitemap names each with its plan pages a segment deeper).
- **Site shape:** server-rendered (about 1 MB). The inventory is three inline JavaScript arrays in one script: `FloorPlanList` (plans: `name` "Plan 2246", `pricedFrom` "224995" or null, `bedroomsMin`, `bathroomsMin`, `garagesMin`, `size`, `thumbnailImage.image`, `pageUrl`), `LocalQMIs` (move-in ready homes: `address`, `price`, `bedrooms`, `bathrooms`, `garages`, `size`, `homesite`, `floorPlanLink` = plan id, `moveInDateCopy` "Available Now", `moveInDate`, `websitePhotos[].image`, `pageUrl` ".../mir?homesite=<id>", `mlsNumber`) and `LocalMIR` (a copy of the plans). Numbers are strings. The reader parses the arrays by bracket matching and holds when either is missing; an empty `LocalQMIs` is a community with plans only. Only "Available Now" was seen as `moveInDateCopy`; a month-year form is read as a month, other wording has no status (held). Photos sit on `www.kbhome.com/globalassets/...`; exterior photos live in a "floor-plan" folder, so drawings are judged by file name.
- **Community record:** schema.org `Place` with `@id` ending `#community` in a JSON-LD graph (single-quoted `type` attribute): address, phone, geo, nearby schools. Discovery reads it through a reader hook (the generic reader wants a business type).
- **Incentives:** a monthly-payment disclaimer template (KBHS Home Loans, NMLS id) and site-wide banners; no community offer terms on the page. Not read.
- **Scrub:** KB Home, KB Homes, KB; lender KBHS Home Loans, KBHS.

## Toll Brothers reader (added 2026-10-20)

- **Community source:** `https://www.tollbrothers.com/luxury-homes-for-sale/Texas/<slug>[/<Collection>]` (the metro search page `/luxury-homes/San-Antonio-TX` lists 13 entries; master communities such as Regency at Esperanza and Mayfair nest their collections, each a community page of its own).
- **Site shape:** Next.js (pages router). `__NEXT_DATA__.props.pageProps.pageData.communityComponent` carries the community: `homes.models[]` (plans: `name`, `pricedFrom` number, `minBed`, `minBath`, `minHalfBath`, `minSqft`, `minGarage`, `url`, `headShot.media.url`, `elevations[]`), each with `qmis[]` (homes: `street`, `pricedFrom`, `moveInDate` "2026-11-30", `isComingSoon`, `lotNumber`, `url` ".../Quick-Move-In/<id>", `communityId`, `modelName`, photos), `qmiSitePlanLots` (the site plan's count of homes for sale, matched the qmis count on every page seen), `salesOffice` (street, city, zip, phone, lat, lon, sales people — not read), `schoolInfo.schoolDistrict`, `amenities.amenityGroups[].amenities[]`, and `events[]`. Status comes from `moveInDate`: on or before today is ready, later names its month, `isComingSoon` is "Coming Soon" (not published), no date is no status (held). Fewer homes than the site plan counts holds the run. Photos sit on `cdn.tollbrothers.com`; drawings (`floorplans`, `siteplans`, `.svg`, logos) are skipped.
- **Incentives:** `events[]` (those whose `startDate`/`endDate` say they are current) carry the national sales event ("Up to $45,000 to Use Your Way on Build to Order Homes", deposit window in the disclaimer) and a rate banner (`bannerEventNational`: "5.49% (6.27% APR) FHA 30-Year Fixed", paragraphs with the down payment and closing deadline, a disclaimer with the lender's NMLS id). The reader takes the event naming a rate (else the first), strips links, phone numbers and NMLS ids, and hands the text to the promotional-rate parser; on the fixture wording the contract window ("on or after 10/8/26") is not a deadline the parser reads, so the offer waits for an admin look.
- **Listing (discovery):** `searchResults.perfect[]` on the metro page: `CommunitySearchItem` with `streetAddress`, `city`, `zipCode`, `phone`, `lat`, `lon`, `pMin`, `url`; `MasterCommunitySearchItem` with `communities[]` of the same shape. Entries without coordinates are skipped.
- **Scrub:** Toll Brothers, Toll Brothers Inc; lender Toll Brothers Mortgage Company, Toll Brothers Mortgage, TBI Mortgage ("Toll" alone is an ordinary word and is not an alias).

## David Weekley Homes reader (added 2026-10-20)

- **Community source:** `https://www.davidweekleyhomes.com/new-homes/tx/san-antonio/<city>/<slug>` (19 communities on the market list, one of them Build on Your Lot; the sitemap is a stale 2024 crawl and is not used).
- **Site shape:** server-rendered (about 930 KB) with one inline `window.pageData= {...}` object: `floorplans[]` (plans: `Name`, `BasePrice`, `PriceDisplay` "$367,990" or " Call For Information", `HidePlanPrice`, `Bedrooms/FullBaths/HalfBaths/Garages/SquareFootage.Minimum`, `Token`, `Elevations[].Renderings[].Url`, `Community.PhoneNumber`, `Community.HidePricing`), `quickMoveIns[]` (homes: `Address.Line1/City/ZipCode`, `Price`, `HideQmiPrice`, `ReadyLabel` "Ready Now" or "Ready 11/2/2026", `ReadyDate`, `IsCompleted`, `Stage` 1-10, `Hidden`, `Ready`, `LostReadyStatus`, `Name` = plan, `JobNumber`, `Token` "/homes-ready-soon/…/<job>", `ExteriorPhotos[]`, `InteriorPhotos[]`, `Elevation.Renderings[]`, `FloorPlanImages[]`), `salesOffices[0].Address` ("13222 Sweet Acacia<br />San Antonio, TX 78245") and `SearchableAddress` ("lat,lng"), `communityAvailability` ("Active", "Close Out"; a close-out community can carry empty arrays), `amenities` (comma list), `basePrice`, `communityId`. The reader parses the object by brace matching, holds when either array is missing or the availability wording is unknown, drops `Hidden` homes, and gives no status to an entry of another community, without a street or link, or with `Ready` false. Photos sit on the official host and `assetcontentdeliveryapi.davidweekleyhomes.com` (short ids, no extension); floor-plan images and PDFs are skipped.
- **Market list (discovery):** `GET /search/CommunityData?marketId=markets/3` (JSON, no key): `Communities[]` and `NeighborhoodGroups[].Communities[]` with `Token`, `Name`, `CommunityType` (2 = build on your lot), `CommunityStatuses` (1 active, 2 close out, 3 coming soon), `Latitude`/`Longitude`, `City.Name`, `CommunityPhoneNumber`, `BasePrice`, `SchoolDistricts[]`, `ShowcaseCount`; no street, so each page is read for its sales office.
- **Incentives:** `GET /promotion/marketpromotionslist?marketId=markets/3` (JSON): promotions with `Description`, `Disclaimer`, `StartDate`, `EndDate`, `IsSiteWide`, `ShowOnCommunityIds[]`. Read once an hour; the current ones naming the community (or the whole site) become the offer text (links, phone numbers and "Call or visit" sentences stripped). Seen: "$2,000 in flex dollars" for hometown heroes, a 50th-anniversary financing banner, a build-on-your-lot seminar.
- **Scrub:** David Weekley Homes, David Weekley, Weekley Homes, Weekley; lender Priority Home Mortgage.
- **Live check:** `Ready` false and `LostReadyStatus` were never seen set; the reader gives such a home no status (holds). `IsModel` true is a "Model" home the sync leaves out. `Stage` below 10 with "Ready Now" was seen once (4203 Blackhaw Bend) and is read as the label says.
- **Round 12:** the offer is ONE promotion (the community's own naming a rate, else a site-wide one naming a rate, else the community's first), never several joined, so one promotion's deadline or down payment is never read as another's term. The page data's own `url` must be the configured page and every plan token must sit under it (`invalid_inventory_response` otherwise). The market list is read once an hour for the community's `ShowcaseCount`: fewer homes on the page than it counts holds `incomplete_inventory`; with the list unreachable an empty page is not trusted. Coming-soon listing entries (`CommunityStatuses` 3) are not onboarded. Live check: a `ShowcaseCount` that counts hidden or model homes would hold a community every run.

## Ashton Woods reader (added 2026-10-20)

- **Community source:** `https://www.ashtonwoods.com/san-antonio/<slug>` (the division map lists 13 parent communities; a parent's page shows its child communities' homes — Hennersby Hollow shows The Preserve at Hennersby Hollow's — so discovery adds parents only).
- **Site shape:** server-rendered (600-990 KB). One `.js-property-card` per plan (`.property-card--is-series`: title = plan name, `.property-card__price` "From $358,240", link) and per quick move-in home (`data-property-id`, `.property-card__body-title` "Available Now" / "Available Nov 2026", `.property-card__title a` "7419 Hound Crossing<br>San Antonio, TX 78252" linking to the home page under the child's slug, `.property-card__price` with `--strike` and `--red` spans when the price dropped, a feature list with the plan link `/san-antonio/all-home-plans/<plan>-<sqft>`, "4 Beds", "3 Baths", "2165 sq. ft.", "1 Story", "2 Car Garage", photos on `awh.widen.net`). The reader holds when fewer homes read than `data-property-id` cards; a card without its link or with unknown status wording has no status. Community record: JSON-LD `HomeAndConstructionBusiness` with the sales address ("By Appointment Only" is no street) and no coordinates; the division map endpoint `GET /ashton-woods/get-division-community-map/13` (JSON, no key) gives each parent's pin and phone.
- **Incentives:** a seasonal banner ("Fall Savings that Feel Right at Home") opening a form; no terms on the page. Not read.
- **Scrub:** Ashton Woods Homes, Ashton Woods, Starlight Homes (the sister brand); lender Velocio Mortgage, Velocio.
- **Live check:** a sold-out parent page's shape is unknown; with no property card at all the reader holds.

## LGI Homes reader (added 2026-10-20)

- **Community source:** `https://www.lgihomes.com/texas/san-antonio/<slug>` (the market page lists 9 communities: Sunset Oaks in Kyle and TRACE in San Marcos fall to the 45-mile rule or are sold out).
- **Site shape:** Sitecore JSS on Next.js (same platform as Meritage, but here the data is server-rendered into `__NEXT_DATA__`). The community sits in `pageProps.page.layout.sitecore.route.fields`: `CommunityName`, `Address1`, `City`, `ZipCode`, `Phone`, `Latitude`, `Longitude`, `SaleStatus.fields.Key` ("Active", "Sold Out", "Reduced Pricing!", "Immediate Move-in"), `MinListPrice`, `PandIInfo` ("5% Fixed / 5.805% APR, 3.5% Down, FHA 30 Year"), `CommunityAmenities[]`. The floor plans are the `FloorPlanSearch` component's props (found by `componentName` through the route's placeholders, then `componentProps[uid].community.floorplans.results[]`): `floorPlanName`, `listPrice`, `previousListPrice`, `numberofBedrooms/Bathrooms/CarGarage/Stories`, `sizeSqft`, `adStatus.fields.Key`, `url.path`, `primaryImage.src` (edge.sitecorecloud.io/lgihomes…). LGI sells by floor plan: no addressed homes on the pages, so the reader publishes plans only (inactive plans and sold-out or coming-soon communities publish nothing). The financing example becomes the offer text ("Financing example: …"); the rate parser reads the rate, APR, down payment, FHA and 30-year term from it. The market-wide disclaimer (a 4.99% ARM on select inventory, NMLS ids) is not read.
- **Market list (discovery):** the market page's `CommunitySearch` component props: `communities.results[]` with `url.path`, `communityName`, `locationIdentifier` (city), `latitude`, `longitude`, `phone`, `saleStatus`, `minListPrice`; no street, so each page is read for its address.
- **Scrub:** LGI Homes, LGI, Terrata Homes, CompleteHome; lenders LGI Mortgage Solutions, CalCon Mutual Mortgage, One Trust Home Loans.
- **Not read (round 12):** `PandIInfo` ("5% Fixed / 5.805% APR, 3.5% Down, FHA 30 Year") is the payment-example assumption behind the page's monthly figures, not a promotion, and is no longer published as an offer. A leasing community (`FloorPlanSearch` props `isLeasingCommunity`, plans with `floorPlanLeasePrice`) publishes nothing and is not onboarded; a plan with no list price but a lease price is skipped. The route's `name` must be the URL's slug and every plan path must sit under it (a same-host redirect holds `invalid_inventory_response`); a coming-soon or sold-out listing entry is not onboarded.

## Sitterle Homes reader (added 2026-10-20)

- **Community source:** `https://www.sitterlehomes.com/communities/<slug>/` (the communities page lists about 30 communities across Houston, Austin and San Antonio; discovery reads each page and the 45-mile rule keeps the area's — Davis Ranch, Kinder Gale, Sunday Creek, Enchanted Bluff, Cibolo Crossing, Nolte Farms, Lakeview and the like).
- **Site shape:** WordPress with Elementor, server-rendered (about 300 KB). The listing block `#comm--filters-content .comm--listings-container` holds one `.comm--listing-container` per home (`inventory`: "Available Now"; `construction`: "Est. Completion: Fall 2026") and per plan (`plan`). A home card: `a.result--title` (street, link to `/listings/<street>-<plan>-<community>/`), "in <Community>", "Price: $526,730" struck through (`.custom-strikethrough`) with "Reduced Price: $445,000" when reduced, "Plan: <strong>Ozona</strong>", "Estimated Completion: <span class=comm--custom-note>…</span>", mini-stats Beds/Baths/Car Garage/Sq. Ft. A plan card: "<Name> Plan", "Price: $480,000", "From 1,852 Sq. Ft.", Beds/Baths/Car Garage/Stories. The reader holds when fewer homes read than home cards, when a card says "in" another community, or when the name, address block or listing block is missing. Completion wording: "Available Now", seasons ("Fall 2026") and months; a past one is a stale estimate (no date); other wording has no status (held).
- **Community record:** `#community-name` and `.comm-page-address` ("10103 Zimmer, San Antonio, TX 78254, U.S.A."; some lack the ZIP), the map pin from the Google Maps directions link ("…/@29.5371268,-98.7423396,18z"). The communities page's `.single-result-container` cards give name, link and city line only.
- **Incentives:** a payment calculator and no offer terms; nothing read.
- **Scrub:** Sitterle Homes, Sitterle.

## Scott Felder Homes reader (added 2026-10-20)

- Site: `www.scottfelderhomes.com` (canonical; the apex serves the same app). A
  server-rendered React app; every page embeds the builder's whole catalogue
  (all markets, ~3.7 MB) in `window.__PRELOADED_STATE__ = {...}`:
  `cloudData.communities|homes|plans[<builder id>].data[]` (BuilderCloud
  records). Community pages: `/communities/san-antonio-area/<sub-market>/<slug>`
  (sub-markets `san-antonio`, `boerne`, `new-braunfels`, `schertzcibolo`; the
  market page links 11 communities). An unknown path renders the market page
  with HTTP 200, so the reader requires the `<h1>` to name the community.
- Homes: `containedIn` = community id, `status` "Active" | "Under
  Construction" (one blank seen: no status, the run holds), `moveInDate`
  ISO. The page labels a card "Ready Now!" once `moveInDate` has passed and
  "available - <Month>" otherwise, whatever the status; the reader publishes
  Active + passed date as ready now, a future date as its month, and Under
  Construction + passed date as an undated quick move-in. Stale dates are
  common (Mayfair homes dated February 2026 in October). `isLot` rows are
  lots. The page shows at most six cards; the state is complete, and the
  page's "N Quick Move-In Homes" line is checked against it.
- Home URL: `/homes/<metro>/<sub-market>/<community slug>/<street slug>`
  (slug = lower case, non-alphanumerics to one hyphen) — verified against all
  rendered cards in the San Antonio market. Plans: `/plan/<slug>/<plan slug>`,
  priced per community in `communities[].communityModelProperties.price`
  (`hide_price` / `dont_show_price_on_detail` hide it).
- Parent communities (`is_parent_community`, children carry
  `parent_community`): Prominence lists Prominence 55'/60'; the parent page
  renders no cards, the reader publishes the children's homes under their
  own slugs.
- Offer: community `headline` / `custom_banner` / `card_feature_headline`
  ("Rates as Low As 3.99%*", "RATES AS LOW AS 2.99% on SELECT HOMES
  (FHA/VA)!") plus per-home `special_feature_headline`; the fine print (a
  temporary buydown, note rate 5.99%) lives only in a blog post, so the rate
  parser holds the offer (`missing_apr`) for a look. Lender names on the
  page: Southern Lending, First Continental Mortgage.
- Photos: `s3.amazonaws.com/buildercloud/<hash>.jpeg` (the page serves them
  through a CloudFront resizer); the bucket path is pinned. Agents
  (`cloudData.agents`) are private names and never read.
- Discovery: the market page's links with the state's records (sales
  address, pin, phone, price); "BOOK BY APPOINTMENT" (Crown Ridge Manor) is
  not an address, so that page is read and its pin keeps it. Sub-communities
  (`parent_community` set) are never onboarded: the parent publishes their
  homes under their own sub-market and slug.
- Round 13: the builder's `homes` and `plans` collections must be in the
  state as arrays (a missing one holds, never zero homes); the community row
  must match the URL's sub-market as well as its slug; one banner is the
  offer (`headline`, else `custom_banner`, else `card_feature_headline`) and
  the per-home `special_feature_headline` labels are never joined into it; a
  home labelled "Model Home …" is a Model (left out); a blank community
  status holds; a rendered card for a lot is ignored.
- Live checks: the first `<h1>` on the page must be the community's (a site
  header heading before it would hold every run); the first "N Quick Move-In
  Homes" line must be the community's (a market-wide count above it would
  hold every run); the market page's community links must be relative
  (`found: 0` otherwise); S3 must serve `s3.amazonaws.com/buildercloud/…`
  without a cross-host redirect (photos would be `unapproved_source`); a
  plan with no `communityModelProperties.price` falls back to the plan's
  builder-wide price — confirm the page shows that; the state is ~3.9 MB
  against the 8 MB page cap; Avondale's 6023 Calgary Park is labelled "Model
  Home Available" and should sync as a Model.

## DRB Homes reader (added 2026-10-20)

- Site: `www.drbhomes.com` is a client-rendered Angular app (every page is the
  same 72 KB shell, no server-rendered content, no JSON-LD beyond the
  WebSite record). Content comes from the builder's own public JSON API on
  `api.drbhomes.com` (no key, plain GET, CORS-open), which the page calls:
  `public/community/state/region/by-name?state=texas&region=san-antonio&name=<slug>`
  → `{ id }` (HTTP 400 "No community with such name" otherwise);
  `public-drb/community/<id>` (name, address with pin, `salesOfficePhone`,
  `priceFrom`, `communityAvailabilityRef.name` Active | Closeout |
  ComingSoon, `moveInNowHomesCount`, `plansCount`);
  `public/community/<id>/move-in-homes?page=1&limit=1000` (`items[]`,
  `meta.totalItems`); `public/community/<id>/plans?page=1&limit=1000`;
  `public/offers-v2/by-community/<id>`. The San Antonio region lists 19
  communities (17 selling, 2 coming soon: Confluence in Marion, Davis Ranch);
  the separate "New Braunfels" region holds only Confluence. The API rows
  carry staff names, e-mails, `createdBy`/`lastIP` audit fields: never read.
- Homes: `salesStatus` "available" | "sold" (45 rows seen: 44 available, 1
  sold); `availabilityDate` ISO; the page labels "Available Now" once the
  date has passed and "Available <Month YYYY>" otherwise (compared by day,
  so an October 30 home shows "Available October 2026"); `originalPrice` 0
  means no previous price; `isModel`, `displayInventory`. Home page:
  `/…/<community slug>/quick-move-in-homes/<street slug>-<homesite digits>`
  ("151 Red Arrow" + "12.19" → `151-red-arrow-1219`), verified on five cards.
- Slug: lower case, punctuation dropped, each space a hyphen; "Meyer Ranch –
  Premier" and "Meyer Ranch - Enclave" are `meyer-ranch--premier` /
  `meyer-ranch--enclave` (verified against `by-name` for all 19). The adapter
  resolves the slug through `by-name` every run, so a wrong slug holds
  (`expected_community_container_not_found`) rather than reading another
  community.
- Corroboration: the API's `meta.totalItems` against the rows read, and the
  community's `moveInNowHomesCount` against the homes read (fewer → hold
  `incomplete_inventory`); a row filed under another `communityId` holds
  `invalid_inventory_response`.
- Plans: `communityPlanSalesStatus` "available" and `status` "active" only;
  `basePrice`; plan page `/…/home-plans/<plan slug>` ("Palm Plan" →
  `palm-plan`).
- Offers: `offers-v2` was empty for every San Antonio community in October
  2026; the shape (from a Georgia community): `title`, `description`,
  `status`, `displayFrom`, `displayThrough`, `visibilities`,
  `content.disclaimer` (long legal text naming the contract window "signed
  … between October 1, 2026, and December 31, 2026", which the rate parser
  reads as the contract deadline). One current offer is the text (a
  rate-naming one first); links, phones, e-mails and NMLS ids are stripped.
  `marketingDisplayPromotion` / `marketingPromotionDisclaimer` on the
  community row were false/null everywhere and are not read.
- Photos: `assets.drbhomes.com/ndg-cms-prod-assets/image/<id>.jpg`;
  `images[].type` names drawings (`inventory_floorplan`, `plan_floorplan`),
  which are skipped.
- Discovery: the region list on the API host (`DiscoveryReader.index.host`),
  every record complete, no page read; coming-soon rows are left out.
- Scrub: DRB Homes, DRB Group, DRB Elevate, DRB (the 55+ brand "DRB Elevate"
  shares the API; its communities carry `brand: "drbelevate"` and none is in
  the San Antonio region).

## Starlight Homes reader (added 2026-10-20)

- Site: `www.starlighthomes.com` (Ashton Woods' entry-level brand, its own
  site and markup). Market page `/san-antonio` links 7 communities (Cordova
  Trails in Seguin, Hennersby Hollow, Roosevelt Heights, Saddlebrook Ranch in
  Schertz, Sutton Farms, The Wilder in Adkins, Trails at Culebra). Community
  page `/san-antonio/<slug>` (~380 KB, server-rendered).
- Record: schema.org `HomeAndConstructionBusiness` (name "<Community> by
  Starlight Homes", street, city, ZIP, `telephone` "+1-830-…", `geo`); the
  review records on the page carry reviewer names and are never read.
- Homes: `table.qmi-table` rows (price, street, plan link, "3 Beds | 2
  Baths<br>1,402 sq. ft.", availability "Ready Now" | "Available <Month
  YYYY>"), under "N Available Homes In This Neighborhood" (the count is
  checked against the rows; rows without the count, or a count without the
  table, hold). The homes have no pages; each is filed as a fragment of the
  community page keyed by its street (`/<community>/available-homes/<street
  slug>` — a path, since the source key drops fragments and query strings),
  so a row's key does not shift when another row goes. The offer is the one
  element whose own text opens with "Terms are based upon a loan", never the
  page text after it. No photos per home.
- Plans: `.plan-card` with heading link, specs, `awh.widen.net` photos; no
  price (the site sells by monthly payment: "Own your new home from
  $1,427/month*", which is not read).
- Offer: the footer paragraph "*Terms are based upon a loan with the
  following terms…" states the current financing in full per community: a
  2/1 buydown ("2.99% (APR 6.81%) 30-YR Fixed FHA loan 3.5% down … year one
  is 2.99% … year two is 3.99% … Beginning in year three, the fixed rate of
  4.99%", "rate expires on October 31, 2026") or a 5/1 ARM (held
  `adjustable_rate`). The rate parser now reads "year one/two/three" and
  "2/1 Program" wording as a temporary buydown. Lenders named: Velocio
  Mortgage, Trailblazer Mortgage (NMLS ids stripped).
- Discovery: the market page's links; each page is read for its record.
- Scrub: Starlight Homes, Starlight, Ashton Woods; lenders Velocio Mortgage,
  Trailblazer Mortgage.

## Legend Homes reader (added 2026-10-20)

- Site: `www.livelegendhomes.com` (not legendhomes.com, a Portland builder).
  The same NDG platform as DRB Homes: an Angular app (server-rendered shell
  with an Angular transfer state on the market page, none on community
  pages) over the public API `api.livelegendhomes.com` (no key, CORS-open).
  The shared reader lives in `dealsAdapters.ndg.ts`; DRB and Legend are
  brand configurations over it.
- Division list: `public-epcon/community/for-legend?limit=1000&division=san-antonio&barebones=false`
  → 11 communities (10 Active, Blue Ridge Ranch Closeout; 87 homes for sale
  in October 2026). Rows carry `regions[0].label` ("San Antonio", "New
  Braunfels/Seguin", "Elmendorf", "Schertz/Cibolo"), `address.countyName`
  and `address.city`; the page URL is
  `/communities/san-antonio/<region slug>/<county slug>/<city slug>/<name slug>`
  (slug: lower case, punctuation dropped, spaces and slashes hyphens),
  verified against the sitemap for all 11. The page resolves itself with
  `public-epcon/community/state/region/county/city/by-name-v2?state=texas&region=…&county=…&city=…&name=…`
  (HTTP 400 otherwise); `public-drb/community/<id>`,
  `public/community/<id>/move-in-homes`, `…/plans` and
  `public/offers-v2/by-community/<id>` are the same as DRB's.
- Homes: `salesStatus` available | contract_pending | sold seen; a pending
  contract or a reservation is a "Pending" home (left out, not held);
  `originalPrice` carries a previous price (358,419 → 324,990 on one home).
  Photos on `assets.livelegendhomes.com`.
- Offers: the division-wide "Open Door Deal" (`offers-v2`, visibilities
  community/division/region) has a back-office `title`
  ("Open Door Deal_InPage") and `description` (an internal note); the public
  copy is `content.titleOne`/`copyOne`, which the reader uses (the title
  only when there is no content block). Its wording ("low-interest rates")
  names no rate, so it is held for a look. Image-only popups say nothing.
- Scrub: Legend Homes, Legend Home, Camillo Companies (parent), Camillo.

## Drees Custom Homes reader (added 2026-10-20)

- Site: `www.dreeshomes.com`. Community pages are an app shell naming the
  page in an inline script (`var contentId = 309651; var isNeighborhoodPage
  = true;`; a parent community such as Haby Hill says `isCommunityPage=true`
  and `url="/new-homes-san-antonio/san-antonio/comm-haby-hills/"`). The
  content comes from the site's own JSON API with POST search queries, which
  the reader sends as the page does — the only POST in the readers
  (`postJsonDocument`: official host only, no credentials, no redirect, a
  body of `{ contentId, pageSize, pageNumber }`, never a form):
  `GET /api/en/dreeshomes/areas` (San Antonio `pageId` 310095),
  `POST …/community` (the market's 10 neighborhoods: name, `url`, model
  `address`, city, ZIP, `modelPhone`, pin, `priceLow`, `qmiCount`,
  `planCount`, `isCommunity`), `POST …/qmi` (homes: `address`, `url`,
  `planName`, `moveInDate` "Jan 23, 2027", `discountedPrice` = price,
  `actualPrice` = the price before a cut or 0, specs, `isModelHome`,
  `isBoylHome`, `mlsNumber`; `filteredRecords`; the market's `promos`),
  `POST …/plan` (plans with `priceLow`, `suppressPrice`, `isPlanAvailable`).
  A GET to the search paths answers 405.
- Homes: the cards say "Move-in date: Jan 23, 2027" only (49 homes in the
  market in October 2026, dates from Oct 14, 2026 to Apr 2027); a date that
  has passed is an undated quick move-in, never "ready now"; a model is a
  Model (left out); a build-on-your-lot listing is skipped. The home page is
  the row's `url` under the community's path (a parent's under its
  sub-neighborhoods'). No per-home photos (a separate image endpoint; not
  read).
- Corroboration: `filteredRecords` against the rows and the market row's
  `qmiCount` against the homes read; the market row's `url` must be the
  page's (`invalid_inventory_response` otherwise); a row without the model
  address holds. The market list (areas + community query) is read once an
  hour.
- Offers: `promos` on every query ("Save Your Way Up To $50,000!*" with the
  description "… this promotion ends November 22, 2026!"); one promo is the
  offer, a rate-naming one first.
- Discovery: the reader lists the market itself (`DiscoveryReader.index.kind
  "reader"`) and onboards the neighborhoods as their own pages — never a
  parent community (its page shows the sub-neighborhoods' homes a second
  time, and the research list carries the sub-neighborhood URLs: Esperanza
  70s, Ladera 50s), never a row without a model address or captioned "Coming
  Soon" (nothing to read yet; the KB interest-list pattern is not repeated).
  A parent configured by hand still reads (`withParentAddress` gives it the
  first sub-neighborhood's address); keep one of each pair.
- Scrub: Drees Custom Homes, Drees Homes, The Drees Company, Drees; lender
  First Equity Mortgage.

## View Homes reader (added 2026-10-20)

- Site: `yourviewhome.com` (apex; a WordPress site, server-rendered). The
  community page `/communities/<slug>/` has a hero (status badge "Now
  Selling" / "Coming Soon" / "Final Opportunity", `tel:` link, the sales
  address as the text of a Google Maps link, "Starting Price" / "Sq. Ft." /
  "Beds" / "Baths" meta) and the `#floorplans` module
  (`module-community-floorplans-homes`) with one `.home-preview` card per
  home for sale (street title, "Plan: X", `.home-preview__status` "Ready
  Now!" or "Est. Completion- October", `.home-preview__move_in` "Move In:
  Oct 2026", price, Sq. Ft./Beds/Baths/Garage, a link to
  `/communities/<slug>/homes/<street slug>/`, a lazy `data-breeze` photo)
  and one `.floorplan-preview` card per plan ("Starting From $369,990",
  specs, a status label such as "Model", "Inventory Only", "Now Selling",
  "Final Opportunity", "New Floor Plan!", "The Grove Series"). A community
  with no homes for sale has no "Available Homes" tab title
  (`.js-tabs-title[data-slug="homes"]`) and no `#homes` slide at all
  (Weltner Farms 50's in October 2026); a coming-soon page (Ladera, Enclave
  35) has no module cards and Enclave 35 shows only "San Antonio, TX 78240".
- Roster: the region page `/region/texas/` embeds every Texas community as
  JSON (`oceanFloorModules.communitiesMapList.push({ …, regions: [{ …,
  communities: [...], regions: [...] }] })`): `permalink`, `post_title`,
  `status.status.{value,label}` (`now`, `soon`, `final`), `address`
  (`street`, `city`, `zip`, `lat`, `lng`), `phone`, `price_range.PriceLow`
  (0 when unpublished), `specs` and `homes[]` (`permalink`, `post_title`
  street, `plan.name`, `status.text`, `move_in` "Oct 2026", `price`,
  `specs`, `full`/`thumbnail` photo). Horizon City's communities repeat under
  El Paso (nested `regions`); the reader keeps one row per page. The roster
  is the discovery listing (every record; the 45-mile rule leaves El Paso
  and Horizon City out) and the source of the homes; the community page
  corroborates it: the cards' home links and the roster's must be the same
  set (`incomplete_inventory` otherwise), a tab with no cards is a changed
  page. The roster and the promo page are read once per run (10 minutes).
- Statuses: "Ready Now!" is ready; "Est. Completion- <Month>" takes the
  year from the "Move In: Mon YYYY" line (every dated card had one in
  October 2026); without the line the month is this year's and a passed
  month is an undated quick move-in. Other wording holds.
- Offers: the site-wide promotion is an image banner (`.banner-ad__link`)
  to a promo page (`/promo-autumnatic-san-antonio/` in October 2026) whose
  `.promo-overview` states the offer ("Purchase a quick move-in home closing
  by 11/30 and choose a 5.25%* Fixed-Rate or up to $55,000** in flex cash!")
  with the APR footnotes and terms in `.PromoFooter__disclaimer` ("*FHA –
  5.25% (5.993% APR) based on 3.5% down payment", "VA – 5.25% (5.465% APR)
  …", "**… flex cash UP TO 10% of the home's sales price … applied toward
  rate buydown, appliances, closing costs …"); `.promo-info__communities`
  links the participating communities (8 of 11 in October 2026) and the
  offer applies only to a community it links. The page names no repayment
  term, so the offer holds `missing_repayment_term` until accepted. The
  rate parser now reads "closing by 11/30/2026" as the closing deadline,
  does not read "contracts … closing by" as a contract deadline, and does
  not take cash "toward rate buydown" for a buydown rate.
- Photos: `yourviewhome.com/wp-content/uploads/…` only; a card's sized copy
  (`-400x267`) stands for the original.
- Scrub: View Homes, Your View Home, Thoughtful Collection; lender View
  Homes Lending.
- Research list: "View Homes" rows; Weltner Farms is one row (the 50's URL)
  while the site has two pages (50's and 60's, one address) — discovery adds
  the 60's as its own community.

## Texas Homes reader (added 2026-10-20)

- Site: `www.texas-homes.com` (Drupal 10, server-rendered). The community
  page `/<slug>` (Potranco Acres, Trilogy Grove, …) has the h1, the model
  home's address in `.sales-address-link a` (text "241 Stone Loop<br>
  Castroville, TX, 78009"; the Google Maps `query` carries the same), the
  pin in `.field--name-field-geolocation` ("29.4293913, -98.8569532"), the
  sales phone (`a.contact-phone`), one `.plan-teaser` per plan (h2 link
  `/<slug>/plan-2568` or `/<slug>/1592`, "Starting from $657,990",
  `features-single-container` stories/sqft/beds/baths/garage/half-baths
  with "3 to 4" ranges, the main elevation under `/sites/default/files/`)
  and, when homes are for sale, a "Quick Move-In Homes in <name>" link to
  `/move-in-ready?field_neighborhood_target_id=<id>` (the plan teasers'
  `/move-in-ready-plan?neighborhood_id=<id>&plan_id=…` links name the same
  id). The site menu on every page lists the 8 selling communities with a
  "View Quick Move-In Homes" count (`.menu-mir-count`; the two closeouts
  Bent Tree and Vistas of Sonoma are not in the menu, and `/bent-tree`
  answered 403 on 2026-10-20).
- Homes: the filtered list (`.mir-view .views-row`) has the street (h3 link
  to `/move-in-ready/<street slug>`, site-wide paths), specs, an MLS
  number (not read), "Valued at: $739,737" with "Now: $719,737" when cut
  (the cut price is the price, the valued one the previous), "Available"
  + "Move In Ready Now" / "Move In Ready" / "Ready Now!" / "Ready Now" /
  "November 2026" / nothing (an undated quick move-in), photos under
  `/sites/default/files/styles/neighborhood_teaser/public/…` (the reader
  keys the original under `/sites/default/files/…`), and the
  `mir-teaser-sold` class on a sold card (sold rows stay listed for a
  while). 29 homes site-wide in October 2026, no pager; the reader holds on
  a `.pager`. The menu count is a lower bound (sold rows are sometimes
  counted, sometimes not): fewer rows than the count holds
  `incomplete_inventory`.
- Offers: the home page's wysiwyg heading "4.99% 30-year fixed FHA/VA" is
  followed by a "Learn More" link to the campaign page
  (`/choose-it-use-it-flex-cash` in October 2026), whose heading ("4.99%
  fixed rate FHA/VA financing or Up to $50,000 in Customized Incentives*")
  and "*" footnote state the offer (4.99% / 5.75% APR, FHA or VA 30-year
  fixed, CMG Mortgage, "contracts written between September 4 and
  September 30, 2026", "close by October 31, 2026"). The offer is
  site-wide; the footnote names no down payment, so it holds
  `missing_down_payment` until accepted, and its contract window had
  already passed on 2026-10-20 (the sync's expiry handles that). The body
  copy ("lower your monthly payments with a rate buy-down") is left out of
  the offer text so the rate is not read as a buydown. The parser now reads
  "between September 4 and September 30, 2026" (first date without a
  year) as the contract deadline.
- Discovery: the home page's menu links (`a.main-menu-main-link`); each
  page is read for its record; paths such as `/move-in-ready`,
  `/build-on-your-lot`, `/about-…`, `/why-…`, `/choose-…` are not
  community paths.
- Scrub: Texas Homes; lender CMG Mortgage, CMG Home Loans, CMG.

## Hakes Brothers reader (added 2026-10-20)

- Site: `www.hakesbrothers.com` (October CMS "rADMIN", server-rendered,
  Alpine for the calculator only). The community page
  `/san-antonio/<slug>` carries a schema.org `HomeAndConstructionBusiness`
  record ("Hakes Brothers at The Woodlands": sales address, phone, pin,
  own `url`), one `SingleFamilyResidence` record per home for sale (`url`,
  street address, pin, `floorSize`, bedrooms, full/partial bathrooms,
  photo) and the "Find Your New Home Design" tabs (`#home-tabs`):
  `#home-designs` with one `article.card` per plan (`.plan-card__title a`
  → `/san-antonio/<slug>/home-design/<plan>-at-<slug>`, "Pricing starting
  at $259,490", Square Feet / Bedrooms / Bathrooms / Garage cells with
  "2.5 - 3" and "4+" values, slick-slider elevation photos under
  `/storage/app/medialibrary/…/conversions/*-large.jpg`) and, only when
  homes are for sale, `#quick-move-in-homes` with one
  `article.card[data-spec][data-move-in-date][data-price][data-sqft]` per
  home (`.card-title` "Move-In Ready" or "Dec 2026", the street linking to
  `/san-antonio/<slug>/home/<street slug>`, `del.card__original-price`
  and the price, the same cells, "Homesite Number: 4", an "Est. Monthly
  Payment" button). 14 homes across 11 communities on 2026-10-20 (Hickory
  Ridge had no quick move-in tab at all). The reader takes the cards for
  statuses and prices and requires the residence records to name the same
  set of home pages (`incomplete_inventory` otherwise; a tab with no cards,
  or a record with no tab, is a changed page). The hero cells give the
  status ("Now Selling", "Final Opportunities"), the school district and
  the county; the district is read from its own cell (the generic text
  rule would glue "Now Selling" to it).
- Statuses: "Move-In Ready" is ready; "Dec 2026" names a month (a passed
  one undated); without a label the card's `data-move-in-date` decides
  (passed → ready); other wording holds.
- Offers: none on the site in October 2026 (the mortgage calculator's
  "10% down payment … 6.5% interest rate" wording is not an offer and is
  never read).
- Discovery: `/san-antonio` links every community (`/san-antonio/<slug>`,
  11 on 2026-10-20 including La Cima in San Marcos — inside the 45-mile
  rule, so it is onboarded — and the coming-soon Highland Gardens, Mesa Vista and Park Place);
  each page is read for its business record.
- Scrub: Hakes Brothers, Hakes Bros, Hakes (no affiliated lender named).

## Beazer Homes reader (added 2026-10-20)

- Site: `www.beazer.com` (Next.js App Router). The community page
  `/san-antonio-TX/<city>/<slug>` is an app shell (about 590 KB) whose data
  rides in the React Server Components payload: `self.__next_f.push([1,
  "…"])` chunks that join into rows of `<id>:<json>`, `<id>:T<hex
  length>,<text>` (a text row) and `<id>:I[...]` (a module row); a string
  "$<id>" or "$<id>:props:extraData:…" points at another row. The reader
  (`parseBeazerFlight`, `resolveBeazerRef`) reads the rows and follows the
  references it needs. The payload carries the `CommunityDetailPage` row
  (`CommunityName`, `CommunityID`, `Url`, `Latitude/Longitude`,
  `MinimumPrice`, `CommunityStatus` "Active", `HasVIPList`,
  `ProductLines.ProductLinePage.items[]` with the sales office's
  `StreetAddress`, `City`, `PostalCode`, `PhoneNumber` and the counselors'
  names and e-mails — never read — and `Plans.PlanDetailPage.items[]`:
  `PlanName`, `Url`, `Price` (0 when unpriced), size/beds/baths min-max,
  `IsHidden`, `IsActive`, `HasHomes`, `Elevations[]` with `Price`,
  `IsActive` and `Images`), one card grid per product line (`{ title:
  "Quick move-in homes", cards: [{ ContentLink: { Expanded: HomeDetailPage
  } }] }` — Veranda has two product lines and two grids), and the
  community's current offers in `extraData.activeOffersCurrently[]`
  (`OfferBlock`: `Content` HTML, `DisplayStartDate/EndDate`, `IsActive`,
  `Disclaimer[].ContentLink.Expanded.Text` = "$29", a text row).
- Homes (`HomeDetailPage`): `Url` `<community>/<plan>/<homesite>`,
  `StreetAddress`, `City`, `Zip`, `HomesiteNumber`, `MLSNumber` (never
  read), `Beds`, `Baths`, `SquareFoot` (+ overrides), `Availability` (ISO;
  passed → ready now, to come → its month, null → undated quick move-in),
  `IsActive` (false → left out), `IsModel`, `HomePrice`,
  `Elevation.Expanded.Price` (the plan's base price — often below the
  home's, never a previous price), `ElevationImages`/`InteriorImages`/
  `Elevation.Expanded.Images` on `cmp.beazer.com` (DAM) and
  `cms.beazer.com`, `ParentPlanContent…PlanName`. 67 homes across 16
  selling communities on 2026-10-20 (7 at most, Comanche Ridge). A plan
  row's `HasHomes` corroborates the grid: plans that say homes with no
  grid (or an empty one) hold `expected_community_container_not_found`.
  Hidden or inactive plans (`IsHidden`, `IsActive` false, the "LAND JOB"
  placeholders with no figures) are left out; a plan's price is `Price`
  or the lowest active elevation's.
- Offers (October 2026): "Lock In 4.99%! 4.99% Limited Time 5/1 ARM [6.62%
  APR] with Choice Lender!*" with its disclaimer (Cardinal Financial,
  "contracted between 10/07/2026 and 12/07/2026 and close per contract by
  12/07/2026", "FHA 5/1 Adjustable Rate Mortgage … 4.990% (6.619% Annual
  Percentage Rate)") — held `adjustable_rate` as designed; and "Personalized
  savings, your way! Receive up to $35,000 towards design options and
  closing costs!*" (to-be-built homes). Display windows are honoured; the
  rate-naming offer is chosen first. The parser now reads `[6.62% APR]`
  and "(6.619% Annual Percentage Rate)" as the APR form and "close per
  contract by" as a closing deadline.
- Discovery: the site's own community search
  (`/api/get-communities-per-area?skip=0&limit=100&orderBy=FeatureOrder:ASC
  &filters={}&ancestorMainId=55228d07-f388-4656-9b45-c4671017e201`, the San
  Antonio metro page's content id; a plain GET, no key, the call the
  neighborhood pages make themselves) lists the 18 communities with
  `Url`, `CommunityName`, `Latitude/Longitude`, `MinimumPrice`, `HasHomes`,
  `HasVIPList` and the office's city (no street); each page is read for
  the street. Sunday Creek at Kinder Ranch (coming soon) carries a pin in
  Germany (53.1, 8.9) and no office: outside the area, never onboarded.
  The metro id is a constant: if Beazer renumbers it, discovery reports
  `sitemap_unreadable` for the builder.
- Scrub: Beazer Homes, Beazer, Gatherings by Beazer, Gatherings; lenders
  Beazer Mortgage Choice, Mortgage Choice, Cardinal Financial Company,
  Cardinal Financial, Choice Lender.

### Beazer: round-17 corrections (2026-10-20)

- The Flight payload is read as UTF-8 bytes: a `T` row's declared length is
  its text's byte length on the wire (React's `emitTextChunk`; the live
  Veranda page's row 1b is 1,305 characters and 0x520 = 1,312 bytes, and
  the next row's head follows the text directly). The reader used to count
  code units, so one curly quote in an outlined disclaimer would renumber
  the next row. Hint rows have no id (`:HL["/_next/static/media/…woff2",
  "font",…]`, 10 of the Veranda page's 100 rows) and are skipped; any other
  line that is not `<id>:…`, a text row that overruns the payload, or more
  than 5,000 rows holds the page (`expected_community_container_not_found`).
- The page's own row is the `CommunityDetailPage` whose `Url` is the page
  (a nearby-communities list may stream another community's row first); a
  row URL on another host or scheme is another page (`invalid_inventory_
  response`).
- A grid whose `title` or `cards` arrives as a `$<id>` reference (React
  outlines a value referenced twice) is resolved before the grid test.
- An offer whose disclaimer stays a `$<id>` reference (the row is missing
  from the payload) or whose display window is not a date holds the offer
  (`expected_incentive_container_not_found`) instead of publishing "$29" or
  dropping it; windows are compared as dates, so "11/01/2026" reads.
- Photos are taken from `cmp.beazer.com/images/`, `cms.beazer.com/
  contentassets/` or `/globalassets/` (and the same paths on www.) only;
  `dealsPhotos.ts` checks the same, so a `/_next/image` proxy is refused.
- Discovery skips `HasVIPList: true` rows (a VIP-list community has no
  office until it opens; it is listed then), as View Homes skips `soon`.
- Rate parser: "fixed for N years then adjusts", "adjusts annually /
  thereafter", a balloon and "then N%" hold `adjustable_rate`, so a stepped
  rate never publishes as an N-year fixed one.
- Hakes: a card label with a month name the reader does not know ("Early
  2027") gives no status (the card's date decides only without a label); a
  hero cell "Coming Soon" marks a coming-soon page, which discovery leaves
  until it opens and the reader takes as an empty community (no hold).
- Texas Homes: the logo tie compares the file name with Drupal's image-style
  segment (`/styles/<style>/public/`) and a `-WxH` / `-resized` / `-scaled`
  suffix set aside.

### Round-18 corrections (2026-10-20)

- Lennar: the homesite-table heading is required on every page ("No homes
  available" included): a page without it holds rather than reading as an
  empty community; the masterplan row's own URL must be the page on the
  official host (none, another host or scheme holds).
- Empire: a non-blank `unit_sale_status` decides first ("Sold" → sold; any
  other word → no status, the sync holds), as does a "Sold" `move_in_date`;
  `is_rental: "1"` rows are not homes for sale; the plans listing's `total`
  must match its rows; the campaign link is taken from the banner first,
  else from the market's own `/us/texas/san-antonio/` pages only (another
  market's promotions page never supplies the footnote; with no link the
  offer holds); a loan officer named beside the lender ("; A. Person, NMLS
  #…") is removed from the offer text (Beazer too).
- Beazer: an offer's `Content` outlined as a text row is resolved; a `$<id>`
  left unresolved at any hop (Content, the disclaimer list, an entry, its
  link, its block, its text) holds the offer.
- Rate parser: the "and/then/will adjust" guard needs rate wording in the
  same sentence, so "subject to change and adjust at any time" boilerplate
  does not hold a plain fixed rate.
- Hakes, by design: a selling community whose page later shows a
  "Coming Soon" hero without tabs reads as empty and the sync retires its
  homes (the site no longer lists them), as any builder's emptied page does.

### Round-19 corrections (2026-10-20, whole-feature review)

- Sync: an incentive text that returns after being superseded is judged
  again with this scrape's facts; if it was never publishable (missing APR,
  private residue) it goes back on hold (one e-mail) and the other scraped
  promo comes off, instead of being revived as live.
- Admin: "Accept this update" and the manual incentive save refuse a link,
  web address, e-mail, phone number (a leading 1 included) or NMLS id
  (`publicTextResidue`), and a held text carrying one lists `publicText` as
  the field to fix, so the admin sees the text to edit.
- Rate parser: the figure beside the APR is the headline before an "as low
  as" figure; two different rate figures in one fixed offer hold
  `ambiguous_rate` (the admin names the headline rate on Accept);
  "4.99% 30-year fixed FHA", "4.99% FHA/VA" read as a rate (APR required);
  the admin's required-fields rule mirrors it.
- Router: `requestHome` and `saveHome` show the buyer only refusals written
  for the buyer (`DealsRequestError`); anything else is logged and answered
  "Request unavailable" / "Save unavailable".
- Analytics: gate focus is recorded only for a browser carrying the probe
  cookie; landing and gate-focus rows are capped per address per hour.
- Card, community and featured handles are HMACs under the server secret
  (a listing URL's plain hash no longer gives a buyer's card).
- The scrubber matches a private name across any run of whitespace.
- Copy: the landing card says "N quick move-in home(s)", the private list
  "N quick move-in", the filter "Quick move-in" (the count includes homes
  still being built, so never "available now" or "move-in ready").
- Discovery: pages past the 120-per-run cap are listed as `index_truncated`.
- Empire offer text: CTA labels ("View Offers", "Learn More") and the
  leftover parenthesis of a removed loan-officer clause are cleaned.

### Round-20 corrections (2026-10-20): the incentive state machine

- An admin's Accept or save marks the record (`accepted_at`, migration
  0021) and keeps the builder's text as its identity (`normalized_text`);
  only the published wording is the admin's. The next sync of the same
  builder text re-confirms it (no new held copy, no e-mail), and an
  accepted text that returns after being replaced or lapsing comes back as
  accepted.
- A scraped record that is not admin-owned is judged on every run: live,
  superseded or lapsed, if this scrape's rules hold it, it comes off and is
  held (one e-mail); a live one otherwise takes this scrape's figures.
- When the builder shows a held text again, any other scraped promo comes
  off and the community carries the hold again if a run in between cleared
  it; a revived text retires other held records as superseded.
- Rate parser: "rates starting at / from / of N%" and any figure under 20%
  in a sentence about a rate, financing, a loan or a loan program count as a
  rate (APR required), unless the words after it make it a down payment,
  closing costs, a credit or a discount; figures of 20% or more ("100%
  financing") are never a rate figure.
- Residue: a phone number with any or no separators after the area code;
  web addresses on more top-level domains, matched only in lower or all
  upper case so "homes.Homes" (two sentences glued) is not an address.

### Round-21 corrections (2026-10-20)

- Two rules every successful read applies before anything else: a scraped
  promo the builder no longer shows is not live, and a held text the
  builder no longer shows is retired (`superseded`, so it can no longer be
  accepted). They apply on every branch: a dismissed or expired text shown
  again, a held text shown again, a text re-held or revived. A page read
  that shows no incentive takes scraped promos down and retires a held one
  (a fetch failure or missing container still keeps the last good one, as a
  hold). A manual override always stays.
- A hold e-mail goes out once per text: a held text that was retired and
  comes back is held again silently (Admin shows it); the community's hold
  line is reset to the held text's whenever it is read again (so a stale
  "page could not be read" line is replaced).
- A save of the live builder promo (same wording, or new wording without
  the manual override) keeps the builder's text as its identity, so it is
  not undone by the next sync; new non-manual wording on a synced community
  with nothing live is refused ("turn on Manual override"). Migration 0021
  backfills `accepted_at` for manual rows and rows with an admin-entered
  date; other live rows are judged once by the current rules on the first
  sync after deploy.
- Rate parser: "Lock in 3.99% on a 30-year fixed", "Starting at 3.99%*",
  "4.99% … with our preferred lender", "discounted rate", "bonus rate" are
  rates; a percentage after "down payment of", "assistance up to", "closing
  costs", "taxes about", or before "in seller-paid", "in flex cash",
  "required down", "lender-paid", "(whichever …) toward" is not.
- Residue: word-like top-level domains dropped (".live", ".today", …);
  "MiHomes.Com" is caught.
- Saved filter: counts only saved homes still on the list, says how many
  saved homes are gone, turns itself off when none remain, opens the saved
  communities once (each can still be collapsed). "Under $200K" is below
  the cap on both lists.

### Round-22 corrections (2026-10-20)

- `offerRead`: a reader marks the private snapshot when it read the
  builder's offer source for the community this run (found or not). Only
  then does an empty incentive take a scraped promo down. Readers that
  never read offers (Perry, D.R. Horton, Highland, Century, KB, Ashton,
  LGI, Sitterle, Hakes, Lennar, First America, Coventry) and runs that did
  not read one (a PulteGroup closeout using the brand's cached offer, a
  promotion page that failed or held) leave the last promo to the lapse
  rule.
- A live record whose stored values answer every reason its text gives (an
  APR, a date or a term the admin typed before `accepted_at` existed) is
  adopted as accepted by the next sync rather than held again; migration
  0022 (a new file, so databases that ran 0021 still get it) backfills
  manual rows and rows with admin-entered dates.
- A save with an id always keeps the record's identity, with the manual
  override turned on or off.
- The manual-override hold e-mails once per text; the dismissed/expired
  branch writes a change line when it takes the live promo off.
- Rate parser: "lender-paid rate", "5/1 ARM", "3.99% interest", "on a
  30-year", "at 4.99%" are rates; "starting at 3% down", "starting at 2% of
  the purchase price", "receive 2%", "up to 3%", "save 10%", "fixed-price"
  are not.
- Residue: an all-caps top-level domain needs an all-caps name
  ("FIXTURE.COM"), title case only for .Com/.Net/.Org, so "Hwy.US 281" and
  "TX.Us Army" are not addresses.
- Saved: with every saved home gone, the list says so.

## Lennar reader (added 2026-10-20)

- Site: `www.lennar.com` (Next.js pages router). The community page
  `/new-homes/texas/san-antonio/<city>/<slug>` (about 430 KB) carries its
  data in `<script id="__NEXT_DATA__">`: `props.pageProps` has `pageType`
  "MASTER_PLANNED_COMMUNITY", `variables.mpcid` and `initialApolloState`, a
  normalized Apollo cache keyed `<__typename>:<id>` whose objects link with
  `{ __ref }` (`parseLennarNextData`, `resolveLennarRef`). On a community
  page the cache holds the masterplan (`MpcType:m_<mpcid>`: `name`, `url`,
  `latitude/longitude`, `status` "ACTIVE", `customPrice` "$254,999 -
  $313,499" / "From $261k" / "Coming soon", `city` → `CityType` (`name`),
  `consultants.phoneNumber`, `communities[]`), its collections
  (`CommunityType`: `name` "Eventide Collection", `url` `<page>/<slug>`,
  `address` (the sales office's street — an intersection, "Southton Rd and
  Greensfield Wy", for a community without a model yet), `zipCode`,
  `priceRange` [min, max] (`basePrice` on the market page), `status`,
  `soAddress`/`soCityName`/`soZipCode` (a sales office elsewhere; null
  everywhere on 2026-10-20), `hoaFee`, `taxRate`, `plans[]`,
  `homesitesCount` = the lot count, never the homes for sale), the plans
  (`PlanType`: `name`, `url` `<collection>/<plan>`, `beds`, `baths`,
  `halfBaths`, `sqft`, `startingPrice`, `customPrice`, `status`,
  `availableHomesitesCount`, `homesites[]`, `elevationImages({"first":1})
  [].image.url`) and the homes for sale (`HomesiteType`: `url`
  `<plan>/<lot id>`, `address`, `number` (the homesite), `price`,
  `wasPrice` (the previous figure of a cut — the page's "$17K" badge),
  `status` MOVE_IN_READY / UNDER_CONSTRUCTION / COMING_SOON (SOLD is a
  page filter; none in the cache on 2026-10-20), `beds`, `baths`,
  `halfBaths`, `sqft`, `latitude/longitude`, `elevationImage.image.url` on
  `cdn.lennar.com/api/images/…`, `plan` → PlanType, `isHotw`,
  `offerAvailable` (false everywhere), `soldDate`). Every home the cache
  held was reachable through plan → homesites (11 of 11 at Blossom Ranch);
  the reader walks the collections' plans and then reads any cache home no
  plan lists, under the page's path.
- The homesite table heading (`<h3>36<!-- --> homes available</h3>`, "No
  homes available" when empty; `lennarHomesAvailable`) corroborates the
  count: it matched the cache's homes on all 41 market pages (0 to 47).
  A page listing homes without the heading holds
  `expected_community_container_not_found`; a count the data does not
  match holds `incomplete_inventory`; more than 150 homes hold.
- Statuses: MOVE_IN_READY → "Quick Move-In (Move-In Ready)" (ready now);
  UNDER_CONSTRUCTION → "Quick Move-In (Under Construction)" (undated; the
  cache has no completion date); COMING_SOON → "Coming Soon" (not
  published); SOLD → "Sold"; anything else → no status (the sync holds
  `unlabelled_home_status`).
- Offer: the only promotion is the corporate banner (`MessageV3Type`,
  "Black Friday" / "Limited-Time Deals on New Homes", link
  `/corporate/corp_bf26`, 2026-10-13 to 2026-11-29) whose page names no
  rate, figure or term ("Current offers and promotions vary by homesite
  and community. See a New Home Consultant"). The reader records no
  incentive; Lennar's deals are the per-home price cuts (`wasPrice` →
  `price`), read into the private row's previous price and drop. The sync
  derives the stored and public "price drop" from its own price history
  (as for every reader), so a cut shows once the sync has seen both prices.
- Discovery: the market page `/new-homes/texas/san-antonio` (about 890 KB,
  same `__NEXT_DATA__`) holds 41 `MpcType` rows for the market with each
  one's collections (`CommunityType` with `address`, `zipCode`,
  `basePrice`) and `CityType` names, so `lennarListingEntries` lists every
  masterplan with its record and no page is read (one whose street is an
  intersection has its page read for the same answer, and is added without a
  street on its pin). A masterplan with no collection carrying an address
  ("Coming soon": Spring Grove) is not listed. Two pairs share a name and a
  pin under different URLs (Grace Valley in Marion and Cibolo, Steelwood
  Trails in New Braunfels and Marion): both are listed, as the site lists
  them. Lubbock's Copper Creek lists under this market; the 45-mile rule
  leaves it out. `communityPath` is `/new-homes/texas/san-antonio/<city>/
  <slug>` (a collection page sits a segment deeper; the masterplan page
  carries all of its collections' homes).
- Scrub: Lennar Homes, Lennar Corporation, Lennar, Everything's Included,
  Next Gen; lenders Lennar Mortgage, Lennar Title.
- Research note: a direct `curl` of a community URL met a Cloudflare
  challenge during the October research pass, while the browser pane read
  every page; whether the cloud fetcher is challenged is a live check (a
  challenge page has no `__NEXT_DATA__` and holds
  `expected_community_container_not_found`; a 403 holds
  `community_fetch_failed`).

## Empire Homes reader (added 2026-10-20)

- Site: `empirehomes.com` (WordPress/Elementor, apex host). The community
  page `/us/texas/san-antonio/[<city>/]<slug>/` (about 650 KB) carries two
  listing widgets (`.apartments-widget[data-detail]`, base64 JSON `{
  items_per_page: "4", display: "quick_delivery_homes" | "new_home_plans",
  endpoint: "https://empirehomes.com//wp-json/custom/v1/
  get_lots_by_community_name", community: "Agave", region, permalink,
  is_rental }`; `parseEmpireWidgets`), the first four home cards
  (`.quick-homes-grid-item[data-community]` with `a[href]` under
  `<page>listing/<slug>/`, a price and a struck previous price, "Load
  More" after), the sales office's static map (`.map-agent-static-container
  img`: `src` `…/maps/api/staticmap?center=<lat>,<lng>…&key=…`, `alt` "Map
  of 8602 Partida, San Antonio, TX 78222" — Willowbrook's caption reads
  "…, New Braunfels, TX, 78130"; `.map-agent-static-label` is the
  community's name), the office phone in a text widget and the address
  again in `.elementor-shortcode`. The static map's URL carries the site's
  own map key: the reader takes the center from it and never keeps the URL
  (the "get directions" link, `daddr=<lat>,<lng>`, is missing on
  Willowbrook, so the map is the pin). No schema.org record names the
  community (the site's record is the Ontario head office).
- Listing: `/wp-json/custom/v1/get_lots_by_community_name?per_page=100&
  page=1&name=<community>&meta_key=apartment_type&meta_value=quick_delivery
  &sort_comminity=collection&orderby=collection&order=DESC` (the page's own
  widget request; `&meta_value=new_home_plan&unit_type=Plan` for the
  plans; plain GET, no key) answers `{ success: true, data: { filter,
  data: [rows], query (the SQL, never read), pagination: { total, per_page,
  current_page, last_page } }, cacheDate }`. A home row: `unit_type`
  "Unit", `permalink`, `unit_address`, `unit_name_single` "Duval A | 4966
  Don Julio" (the plan before the bar), `unit_status` MoveInReady /
  UnderConstruction / Sold (a sold row stays listed with `unit_sale_status`
  "Sold"), `move_in_date` ("Move-in Ready" even under construction) and
  `move_in_date_day` (ISO: a day to come names the month; passed or blank
  → undated), `price`, `previus_price` (sic; "0" when none), `size`,
  `bedrooms`, `bathrooms`, `halfbaths`, `unit_garages`, `lot`, `block`,
  `phase`, `mls`, `custom_banner_presale` ("October Low Pricing", "4.99%
  Fixed Rate Available" — a label with no terms, never read),
  `spcMortPromInterest`/`spcMortPromLoanDuration` (never read),
  `is_active`, `plan_images_details[].url` and `interior_images[]` on
  `empirehomes.com/wp-content/uploads/` (`floorplan_images` are floor
  plans; `button_url` is a self-tour on another host, never read). A plan
  row: `unit_type` "Plan", `permalink` `<page>home-plans/<slug>-<id>/`,
  `unit_name_single`, `price` ("0" sometimes), `size`, beds/baths,
  `elevations[].ElevationPrice` (the price when the row has none;
  `ElevationImage` on empire-portal.com, not a photo host). Agave listed 8
  homes (1 ready, 6 under construction, 1 sold) and 8 plans; Everly
  Estates 8; Willowbrook under 100. The reader holds `incomplete_inventory`
  when `last_page` > 1 or `total` ≠ rows, and when a page card is missing
  from the listing (the cards are the listing's first page, so the two must
  agree); `invalid_inventory_response` when a widget's permalink or a row's
  link is another page's.
- Offer: every community page carries the market's "Smart Move Sales
  Event" banner (`.banner-promotion-single`: "Interest Rates as Low as
  3.99%*", "4.99% Fixed FHA/VA Interest Rate*", "Up to $50,000 in Price
  Reductions", "Up to $10,000 Closing Costs", …) and links the campaign
  page `/us/texas/san-antonio/smart-move-campaign/`, whose text widget
  holds the footnote ("Disclaimer: *Offer valid on select move-in ready
  homes … contracts dated October 1st-December 31st and must close by
  December 31st … Alta Home Lending (NMLS #40561 …)"). The footnote names
  no APR, term or year, so the offer holds for its missing terms (the
  catalog publishes); a banner whose footnote cannot be read holds the
  offer only.
- Discovery: the region page `/us/texas/san-antonio/` links the four
  community pages, the city pages (`/new-braunfels/`, `/bulverde-village/`)
  and the campaign page; `communityPath` is `/us/texas/san-antonio/
  [<city>/]<slug>/` (listing and plan pages sit deeper). Each page is read
  for its record: a city or campaign page has no map and is skipped
  (`no_community_record`), as is a sold-out page (Cibolo Canyons: a map pin
  and no address, no widgets). `empireRecord` needs a street, so a
  coming-soon page without one is not added until it opens.
- Scrub: Empire Homes, Empire Communities, Empire, Smart Move Sales Event;
  lenders Alta Home Lending, Alta.

## Meritage Homes: deferred

- `meritagehomes.com` is a Sitecore/Next.js site whose community pages ("Community Multi-Series Landing Page") render homes and plans in the browser from Sitecore Discover (`discover.sitecorecloud.io`), a search service called with the site's own client key. The page's `__NEXT_DATA__` holds navigation, dictionary strings and promotions only. Using the site's frontend key is not done (same rule as CastleRock). Parked.

## Live checks before launch (fail-safe holds the fixtures cannot settle)

- D.R. Horton: a community with zero quick move-in homes may omit the `#relatedmovein` block; the reader then holds `expected_community_container_not_found` and its plans never publish. Check one such community live; if the block is omitted, relax the hold to "block absent, `#floorplans` present with counts, LocalBusiness record present and no `available-home-card` anywhere" (still holds when the cards are merely renamed).
- Homefiniti: confirm no `.status`/`.status-text` element sits on plan cards or in a block that also links to `/available-homes/`; either would count as a home card and hold every run. A lingering "Sold" card without a Product record holds while it is shown. Coventry width collections (`garden-grove-40`): if home URLs live under the base slug, the community-slug check holds every run.
- Highland: a sold-out community's page shape is unknown; with no `a.homeSpec` card the reader needs the "0 quick move-in homes" sentence, else it holds. Check one live if a community sells out.
- KB Home: interest-list communities (Espino, Espino Trails) have no office address; discovery adds them (the pin places them) and every sync holds `expected_community_container_not_found` until the office opens. The reader reads the last non-empty `LocalQMIs` assignment and holds when an empty list sits beside rendered `mir?homesite=` links or a "Move-in Ready (N)" count.
- Toll Brothers: a coming-soon community has `salesOffice: null` and holds the same way; a nested home whose `communityId` differs from the page's holds `unlabelled_home_status` (right for a sister collection's home; a permanent hold if Toll ever lists master-level homes that way); a listing with relative `url` values drops every entry (visible as `found: 0` in the discovery email).
- KB Home: the page's home links are counted under the community's own path only and the smaller "Move-in Ready (N)" count on the page is the community's; a page that shows only the market-wide count (no community count) would hold every run.
- Ashton Woods, LGI Homes: zero cards or an empty plan list is read as the page says (nothing for sale); neither page carries a count to check it against. Find one on the live page if a sweep to sold is ever seen.
- LGI Homes cards on the landing page say "0 homes" because LGI sells plans only and the card counts quick move-in homes.
- Scott Felder: every San Antonio community row's `area` must slug to the URL's sub-market ("Schertz/Cibolo" → `schertzcibolo`); a blank or differently worded `area` holds every run.
- DRB / Legend: only the by-name lookup's HTTP 400 is "no such community"; a 404, 429, 5xx or a timeout holds `community_fetch_failed`. An offer whose content block carries only a disclaimer says nothing (never published as an offer). Whether `offers-v2` ever carries such a block, and Legend's home page path (`/quick-move-in-homes/<street>-<homesite>` is DRB's shape) and dash rule (`legendSlug` keeps a hyphen; no live name carries one), are live checks.
- Drees: the page's `var url` is read from the script block that declares `contentId` (a tracking snippet's `var url` ahead of it is not the page's); a same-host redirect answer to a search POST holds `community_fetch_failed` (one off the host `unsupported_official_host`). Live checks: whether a build-on-your-lot card is ever counted in `qmiCount` (it would hold `incomplete_inventory` every run), whether a parent community page 404s (a hand-configured parent would hold `community_fetch_failed`), and whether `isPlanAvailable` is false on a coming-soon plan list.
- KB Home: the community's own "Move-in Ready (N)" is read from a heading (a count in a nested span counts too); a "(0)" in another market's navigation beside the community's heading count says nothing, and a "(0)" corroborates an empty list only as a heading or with no positive count anywhere on the page.
- DRB / Legend: if the API's `moveInNowHomesCount` counts hidden (`displayInventory: false`) rows the community holds `incomplete_inventory` every run; a home row with `status` other than "active" and `salesStatus` "available" would publish (row-level `status` is not read); `availabilityDate` is compared in UTC (a one-day skew around midnight is possible for the ready-now label).
- Starlight: the footer's "**Monthly payment" note and `&copy;` line follow the terms paragraph; the reader reads the paragraph's own element (the innermost `p`/`li` that carries the buydown wording, else the longest, so neither a span inside it nor an `li` around it and the footer changes the text; a split paragraph that stops before the page's own "2/1 Program"/"year one" wording — read up to the footer's "**"/"©" — holds the offer as a changed page). Whether the terms are one flat `<p>` on every community page, and a sold-out community's count wording ("0 Available Homes" with no table), are live checks.
- KB Home: a community heading "Move-in Ready (0)" beside the market's count corroborates an empty list; "(0)" beside a list with homes says nothing.
- View Homes: coming-soon roster rows are left out of discovery (as Drees); a badge month without a "Move In" line is the next such month; a promo page with offer text but no participating-communities block holds the offer. Whether the outer `regions:` key is ever quoted (`"regions":[` would hold every community) and whether coming-soon pages carry the `#floorplans` module shell are live checks. If the roster's `homes[]` ever omits a home the page shows (or shows one the page hides) every run holds `incomplete_inventory`; a badge wording other than "Ready Now!" / "Est. Completion- <Month>" (e.g. a sold label) holds through the sync's status rule. The promo banner changes per campaign: a page without `.promo-overview` holds the offer only (`expected_incentive_container_not_found`).
- Lennar: whether the cloud fetcher meets the Cloudflare challenge the research pass saw on `curl` (every page would hold); whether a sold home ever appears in the cache with `status` "SOLD" (it would publish as sold) or another value (the sync would hold the community); whether the market page's `MpcType` rows ever exceed the 8 MB document limit; whether a collection page is ever onboarded on its own (its homes would double the masterplan's — the research list and discovery use masterplan URLs only).
- Empire Homes: whether the listing endpoint answers the cloud fetcher as it answered the browser (a WordPress REST route; a 403 or an HTML answer holds the community); whether a community ever lists more than 100 homes (`per_page` 100; a second page holds); whether the page's first four cards are always the listing's first rows (they were on 2026-10-20; a card the listing lacks holds); whether the campaign page keeps its "Disclaimer:" text widget between campaigns (without it the offer holds).
- Beazer: whether a community with many homes ever carries a "Load more" grid whose payload holds the first page only (the grid had every home on 2026-10-20, 7 at most); whether `extraData.activeOffersCurrently` is present on every community page (a page without it publishes no offer, no hold); whether the metro id changes.
- Texas Homes: the list's rows are tied to the community by the row logo (`.mir-teaser-bottom-right img`, the community page's `.field--name-field-logo img`), by the exposed filter's selected `field_neighborhood_target_id` option and by the two-sided count rule (homes for sale ≤ the menu count ≤ all rows); a community page without a logo loses the first tie. The menu count is read as a lower bound only; a community page without the "Quick Move-In Homes in <name>" link while the menu counts homes for it holds every run (the closeouts Bent Tree and Vistas of Sonoma have no menu row; `/bent-tree` answered 403 on 2026-10-20 — a bot block would hold `community_fetch_failed`). Whether a coming-soon or sold-out page keeps the `.sales-address-link` block is unknown (without it or the pin the page holds).
- Hakes Brothers: a coming-soon page's shape is unknown (Highland Gardens, Mesa Vista, Park Place): without the business record's street, or without `#home-tabs`, the page holds `expected_community_container_not_found` until it opens; if the residence records ever list a home the cards hide (or the reverse), the community holds `incomplete_inventory` every run.
- Century: if the live page renders the card list twice (mobile and desktop) or shows sold or model cards with `.street-number-text`, the card count exceeds the records and every run holds. The sitemap is one 2 MB urlset (8,205 URLs, no index) today.

## Round 24 corrections

- **First-year savings:** "1% first-year savings", "2% year 1 rate reduction" and a figure after "save", "up to" or "lowers … by" are never the first-year rate. A buydown whose follow-on rate is below its first-year rate, or more than three points above it, is held `ambiguous_rate`. Leading incentives, co-ops, minimum down payments and "(APR) is N%" no longer count as the first rate figure. Two regional starting rates with one APR hold `ambiguous_rate`.
- **Amount words:** after "save", "up to", "receive" or "earn", a whole figure is an amount; a figure with decimals is a rate unless "back", "bonus", "cash", "toward" or closing wording follows. "Tax rate of", "co-op rate of" and similar are not rates.
- **Parser:** reads "APR of N%", "Annual Percentage Rate (APR) is N%", "a down payment of N%" and "N% min. down".
- **Legacy acceptance:** a figure the builder's text states beside that field's own label (an APR label, "down", a rate word, "N-year"), within one phrase (a comma, slash or bracket ends it), also counts as evidence: it is right whoever wrote it. "3% down" stored as the rate still does not.
- **Deploy note:** a legacy Accept of an `ambiguous_rate`, `adjustable_rate` or "no deadline" hold carries nothing that shows the admin's Accept, so it is re-held once after deploy (one e-mail each).
- **Residue:** the four-character minimum and the road/state names apply only before .US/.CO/.IO; any name before .COM/.NET/.ORG is an address. An upper-case TLD after a plain lower- or title-case word and before a capitalised word is two glued sentences, and a TLD followed by a hyphen ("Co-op") is a word.
- **Texas Homes:** an unparsed home page is remembered as a hold for two minutes so the batch does not fetch it again.

## Round 25 corrections

- **Legacy acceptance:** the round-24 "labelled figure" evidence is gone. It adopted older parsers' guesses that sat beside the word "rate" (a tax rate, a first-year savings amount). A row is adopted only when its text was edited by an admin or every reason is answered by a figure the builder's text never states. Every other legacy Accept is held once more after deploy, with one e-mail.
- **Relative rates:** a first-year or follow-on rate that equals a figure the text states as a change of rate ("1% first year discount", "1% interest rate reduction", "lowers your rate by 1%") holds `ambiguous_rate`. A buydown whose follow-on rate equals its first-year rate is out of shape. The label-first look stops at discount and savings words.
- **APR beside a down payment:** "a down payment of 3.5% (5.62% APR)" is not an APR-paired rate. A headline equal to the down payment holds `ambiguous_rate`. A fixed headline the text does not state as a rate, while it states another, holds.
- **Amount words:** after "save", "up to", "receive" or "earn", a figure is a rate only with loan wording right after it, or with decimals and at least 2.5%, or with loan wording later in the clause. Incentives, contributions, co-ops and "from the builder" are amounts. "Commission rate", "co-op rate", MUD, PID and millage rates are not loan rates.
- **Regional rates:** a second starting figure after "and", "or", a comma or "&" counts only when it is itself a rate (not a credit, closing costs, an incentive or a co-op), including after "as low as".
- **Residue:** any name before .COM, .NET, .ORG or .BIZ is an address. The glued-sentence skip applies only before TLDs that are also words or codes.

## Round 26 corrections

- **Stepped buydowns:** a figure for a single "year 2" is a follow-on rate only when the period is open ("years 2-30", "years 2 and beyond"). A follow-on read for a later period that equals a year-2 figure holds `ambiguous_rate`.
- **APR layouts:** "4.99% APR 5.62%" (label-first) reads the APR as 5.62%. Any rate equal to its APR, or a fixed APR below the rate, holds `ambiguous_rate`.
- **Reads:** "N% 30-Year Fixed (FHA) Rate (M% APR)", "Interest rate: N%" and "Rate N% / APR M%" give the headline. An APR-paired figure is skipped only after "down payment of". "Incentive rate" and "the builder's preferred lender" are rate wording. Tax, co-op, MUD and PID rates are never the "as low as" headline.
- **Relative rates:** only rate words may stand between the figure and the change word ("1% first-year rate cut", "1% interest rate reduction"), so "4.99% rate for lower monthly payments" is a rate.
- **Hold reasons** are de-duplicated. An all-caps name before a word TLD is a glued sentence only in an all-caps passage.
