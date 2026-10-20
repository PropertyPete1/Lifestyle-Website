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
  not an address, so that page is read and its pin keeps it.

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
  community page. No photos per home.
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
- Century: if the live page renders the card list twice (mobile and desktop) or shows sold or model cards with `.street-number-text`, the card count exceeds the records and every run holds. The sitemap is one 2 MB urlset (8,205 URLs, no index) today.
