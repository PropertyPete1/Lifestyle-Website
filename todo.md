# Lifestyle Design Realty — Project TODO

## Design System
- [x] Dark luxury theme in index.css (deep charcoal/black, warm white, gold accent) with OKLCH tokens
- [x] Google Fonts: editorial serif (Cormorant Garamond) + refined sans (Montserrat/Inter)
- [x] TREC broker-name sizing rule documented in design system comments

## Database & Backend
- [x] Schema: listings, testimonials, team_members, neighborhoods, site_stats, bio_links, leads
- [x] DB helpers in server/db.ts
- [x] tRPC routers: listings, testimonials, team, neighborhoods, stats, links, leads, admin
- [x] Follow Up Boss integration (server-side, FUB_API_KEY env) with graceful DB fallback
- [x] Lead intent tagging (Hot/Warm/Cold) + source tags
- [x] Seed data: 6 testimonials, team (Peter Allen REALTOR®/Owner, Steven Van Orden Broker/Owner, Stefanie, Abby, Irma, Laila, Tiffany), stats (63 sales, $26M, $200K–$1.7M, $424.4K), neighborhoods (Alamo Ranch, Kyle, Boerne + cities), bio links, sample listings

## Public Pages
- [x] Homepage: full-screen dark hero with exact eyebrow "EXPERTISE. KNOWLEDGE. EXPERIENCE." and headline "LIFESTYLE DESIGN REALTY", CTAs "Browse Properties" + "Home Valuation"
- [x] Homepage: stats bar (animated counters), featured listings, City Finder CTA, new construction (New Home Buddy), markets we serve, team preview, testimonials carousel, valuation band, newsletter
- [x] Transparent top nav: Portfolio, Neighborhoods, Search by Property Type, Home Search, Home Valuation, Schedule a Consultation, (210) 981-3830
- [x] Mobile nav (hamburger sheet)
- [x] /search — filterable listings (city + property type: pools, new construction, multi-family, townhomes/condos)
- [x] Listing detail pages with gallery, description, agent contact, Schedule a Tour form
- [x] Neighborhood/city landing pages (Alamo Ranch, Kyle, Boerne, San Antonio, Austin, New Braunfels, DFW, Houston)
- [x] /city-finder — multi-step quiz with gated results + lead capture
- [x] /valuation — home valuation lead capture
- [x] /team — team grid with TREC-compliant naming
- [x] /testimonials — carousel + full list
- [x] /contact — contact form
- [x] /links — links-in-bio page (New Home Buddy: https://a.nhb.app/u/peter-allen)
- [x] /join — agent recruiting form
- [x] /sell — seller-focused page
- [x] TREC footer on every page: IABS + Consumer Protection Notice links, EHO logo, disclaimer, address, phone

## Forms (all with TCPA consent language)
- [x] Home Valuation form
- [x] Newsletter signup
- [x] Contact form
- [x] Schedule Consultation form
- [x] City Finder quiz gate form
- [x] Listing inquiry / Schedule a Tour
- [x] Join/recruiting form

## Admin CMS (role-protected)
- [x] Admin dashboard layout at /admin (admin role only)
- [x] Manage listings (CRUD, photos, status Active/Pending/Sold)
- [x] Manage testimonials
- [x] Manage team members
- [x] Manage neighborhoods
- [x] Manage site stats
- [x] Manage bio links
- [x] Lead log viewer with FUB sync status + intent tag

## QA / Compliance
- [x] Vitest coverage for lead submission + FUB fallback + admin gating (15 tests passing)
- [x] Mobile responsive verification (375px screenshots of home, search, links, contact)
- [x] SEO meta tags (title + description in index.html)
- [x] Verify exact strings: eyebrow, headline, phone, New Home Buddy URL (in shared/site.ts)
- [x] End-to-end lead test: submitted via API → stored in DB → synced to FUB with tags (then cleaned up)
- [x] Admin user provisioned (owner promoted to admin role)
- [x] Bio links aligned to required set (Home Search, Home Valuation, City Finder, Consultation, New Home Buddy, Contact, Join)

## Revision Round 2 (user request)
- [x] 1. Hero/featured listings redesign: compact auto-rotating single-listing showcase (5-10s auto-advance, arrows, photo+price+beds/baths/sqft+city+View Details); above-the-fold order: hero headline+CTAs, Get Started form/button, rotating showcase
- [x] 2. Persistent "Get Started" button in sticky nav on every page, jumping to short buyer/seller intent form (name, phone, email, buy/sell, timeline)
- [x] 3. Remove visible "New Home Buddy" branding; rebrand as "New Construction Search"/"Find New Builds" (keep link https://a.nhb.app/u/peter-allen)
- [x] 4. Footer socials → brokerage accounts only: IG lifestyledesignrealtytexas, FB Lifestyle-Design-Realty-Texas-61578742983077
- [x] 5. Separate "Get New Listings in Your Inbox" newsletter (name+email, tag "Website - Newsletter") from "Ready to Buy or Sell? Let's Get Started" form (tag "Website - Get Started" + intent)
- [x] 6. "Now Hiring"/"Join Our Team" visible in nav + footer; recruiting screening form with Stefanie's exact message and 5 questions; FUB tag "Recruit - Website", answers as notes, intent rules (active license + full-time + closed transactions = Hot); confirmation "Thank you! Our broker will be reaching out."
- [x] 7. AI natural-language property search bar (homepage + /search) returning matches from listing data (data-source-agnostic)
- [x] 8. Interactive map view toggle (list/map with pins) for search results
- [x] 9. General UX pass: stronger luxury direction (editorial type, whitespace, restrained color); Get Started, City Finder, New Construction Search most prominent

## Broker of Record Correction (TREC compliance)
- [x] Peter Allen = "REALTOR® / Owner" and Steven Van Orden = "Broker/Owner" everywhere: team DB records, /join Broker Support card, page copy, code comments, and seed script
- [x] Steven's title = "Broker/Owner · Designated Broker"; update TREC comment references naming Peter as broker
- [x] Remove "You responded to a post on Lead Overflow. I have gotten a large response." from /join screening message; start at "In an effort to find the best fit..."

## UX Enhancements
- [x] Team card hover effect on /team: card lift, photo zoom + brighten, inset gold frame reveal, bottom gradient with "View Profile" cue, gold underline on name, initial-letter glow for placeholder cards

## New Construction Handoff Screen (CANCELLED — superseded)
- [x] ~~Handoff screen feature~~ CANCELLED by user (Jul 20): AI search and New Construction Search must remain fully independent; the built handoff was removed in the following revision

> CANCELLED (user request Jul 20): AI search and New Construction Search must stay fully independent — no handoff, pre-fill, or bridge.

## Independence + Mock Data Expansion (user request)
- [x] Remove NewConstructionHandoff component, its CTA in Search.tsx, and the placeholder-email FUB carve-out
- [x] Keep AI search fully self-contained; keep New Construction Search as plain external link only
- [x] Add floor-plan fields to listings (stories, primaryBedDown) in schema + admin + AI criteria
- [x] Expand placeholder listings to ~40 with variety (cities × price bands × beds/baths × pool × new construction × floor plans) so realistic searches return 5-10 matches
- [x] Verify representative queries return 5-10 results (7/9/12/8/7 across five test queries); clean up test leads
- [x] Fix FUB CloudFront 403: all FUB API calls now send a User-Agent header

## Site-Wide UX Rules (revision round 3)
- [x] 1. Scroll-to-top on every internal navigation, site-wide: global ScrollToTop in App.tsx keyed to wouter location, hash-aware, covers all current & future routes
- [x] 2. City Finder quiz: dedicated on-site results screen ("Here's what we found for you" / "Your Texas City Report") with ranked match cards (median price, vibe, why it fits); primary CTAs stay on-site (Browse Listings / Explore City), external New Construction link is optional, clearly marked, never automatic
- [x] 2b. Flow endpoint audit: Get Started ✓ (Thank You screen), Recruiting ✓ ("Thank you! Our broker will be reaching out."), Newsletter ✓ (subscribed state), LeadForm ✓ (Thank You state), AI search ✓ (new "X homes match your search" results headline + empty state)
- [x] 3. Re-confirmed: AI search and New Construction Search fully independent — no handoff/pre-fill/bridge exists in the codebase
- [x] 4. Plain-language AI search architecture explanation prepared for delivery
- [x] 5. Re-verified expanded dataset: single story under 500k → 9, SA 3-bed → 8, townhome under 500k → 7 results
- [x] Fix: /search?city= deep links from City Finder results pre-select the matching city filter
- [x] Fix: FUB live-key test now detects CloudFront geo-block of sandbox egress IP and skips with warning (production US hosting unaffected)

## AI Search "How It Works" Tooltip (revision round 4)
- [x] Add "How it works" tooltip/popover next to the AI search bar (homepage + /search) with plain-language explanation and 4 tappable example queries that run the search (verified in browser: popover opens, example click runs search → "3 homes match your search")

## Convince Your Partner (AI-powered shareable tool)
- [x] Add ANTHROPIC_API_KEY as server-side secret via secrets flow (never client-side)
- [x] Schema: partner_pitches table (slug, answers, partnerName, city, generated text, createdAt) for cached shareable results
- [x] Server: Anthropic Claude integration (server-side only) with scoped system prompt (warm persuasive real-estate voice, real market characteristics, no invented claims, no rates/numeric financial promises in AI text) + graceful fallback on API failure
- [x] Vitest validating the Anthropic key + pitch generation module (live Claude call passes, compliance regex checks no %/$ in AI text)
- [x] Page /convince: intro screen with exact explainer copy + Start button
- [x] Quiz: multi-select dream-life options (8 specified) + optional partner first name
- [x] Result screen: AI dream scene + supporting stats tied to selections + fixed compliance financing line ("Ask us about builder incentive buydowns — as low as 4.99% since 2021" with disclosure) kept outside AI generation
- [x] Unique shareable URL per result (/convince/:slug) that reproduces the identical cached result — no regeneration on reload (verified: identical md5 across reads)
- [x] One-tap share: native share / copy link / text (SMS)
- [x] Optional soft CTA: "Want us to build your full moving plan?" email capture tagged "Website - Convince Your Partner" in FUB
- [x] Placement: prominent "Convince Your Partner" card on /links + fun secondary placement on homepage
- [x] End-to-end test: quiz → generation → share link reproduces same result (36/36 tests pass); checkpoint
- [x] Harden AI compliance: system prompt forbids comparative affordability claims; violatesCompliance() guard rejects/regenerates non-compliant outputs; vitest coverage (39/39 pass); non-compliant cached test row deleted
- [x] Full browser E2E: quiz (2 selections + name "Taylor") → AI result rendered → shared /convince/8soap7g9wn reproduces identical pitch; then checkpoint

## Open Graph preview for shared Convince links
- [x] Generate a branded OG image (dark/gold, "A letter written for you about your life in Texas") and upload as static asset
- [x] Server-side OG meta tag injection for /convince/:slug (and /convince) so texts/DMs/social show a rich card (intercepts send/end/sendFile, personalized per slug, HTML-escaped, 42/42 tests pass)
- [x] Verify OG tags with curl (slug page shows "A letter written for Taylor about life in San Antonio, Texas" + image; other routes untouched); checkpoint

## Veteran-Owned badge
- [x] Custom gold/charcoal flag SVG icon component (waving stripes + star, stroke-based, brand gold) matching luxury design language
- [x] "Veteran-Owned & Operated" badge above the wordmark in SiteNav (desktop/tablet; also in mobile menu), small/understated, consistent across all pages
- [x] Veteran-owned mention in /join Broker Support section
- [x] Short veteran-owned trust line on homepage under the stats bar ("service, discipline, and integrity in every transaction")
- [x] Visual verification (desktop /, /join, /team + mobile 375px full-page) — 42/42 tests pass; checkpoint

## High-tech feel through visible interactions (no claims)
- [x] AI status sequence component (gold sweep hairline + staged serif messages "Analyzing your criteria…" → "Matching listings…" → "Ranking your results…") wired into search loading — verified live in browser
- [x] Same status treatment for Convince Your Partner generation (full-screen "Reading your picks…" → "Choosing your best-fit city…" → "Writing the letter…" → "Polishing every line…")
- [x] Homepage stats already count up on scroll (StatCounter IntersectionObserver, eased 1.4s) — verified implementation
- [x] Site-wide micro-interactions: global button press scale (already present), new .lux-lift (lift + gold-tinged shadow) applied to listing cards, links-in-bio cards, tech showcase cards
- [x] Homepage technology showcase: 3 animated capability cards (scanning magnifier, floating pin, growing chart bars) linking to live features — visual, minimal copy
- [x] /join animated 3-step lead-flow diagram (sequential light-up, gold connector fill, Hot/Warm/Cold badges cascade) — verified rendering
- [x] No "high-tech"/"cutting-edge" copy anywhere — grep verified (only a code comment)
- [x] Tests (42/42), visual verification (desktop full-page / + /join, live search), checkpoint, GitHub push

## Production sync: GitHub pull + DB re-seed + FUB key
- [x] Pulled latest GitHub main — audit-fix commit already merged locally (054a5df); no newer commits on remote
- [x] Re-seeded production listings DB via seed-listings.mjs — 55 listings confirmed via SQL count
- [x] Set FUB_X_SYSTEM_KEY in deployment environment (dev + production secrets)
- [x] Re-tested FUB lead sync: test lead status=synced, fubId=6182 (no 403) — cleaned up after
- [x] Rebalanced dataset: +3 affordable Austin townhomes/condos (58 total listings re-seeded); AI search counts now: SA pool <$400K → 5, 4bd new-construction <$600K → 7, single story <$500K → 20, Austin townhome <$450K → 4 (all queries return healthy result sets)
- [x] All 60 tests pass; checkpoint + GitHub push + confirm to user

## Audit fixes (2026-07-20)
- [x] FUB `X-System` + `X-System-Key` registered-integration headers via shared `fubHeaders()` (key from `FUB_X_SYSTEM_KEY` env, omitted when unset) + unit tests
- [x] Homepage builder-buydown banner (4.99% + disclosure) via shared `FinancingBanner` (single source of truth, reused by Convince)
- [x] Richer seed data in `shared/placeholderListings.mjs` so common constrained AI searches return 5-10 (incl. the search box's own example) + `aiSearch.coverage.test.ts`
- [x] Mocked AI-path tests: `extractCriteria` (LLM) + `generatePitch` (Anthropic) run in CI without keys
- [x] Map view fails gracefully: `loadMapScript` rejects on error/missing key + no double-inject; `MapView` reports `onUnavailable` (load error or `tilesloaded` timeout); `ListingsMap` shows a clickable results-by-city fallback instead of a blank grey box
- [x] DEPLOY: re-ran `node seed-listings.mjs` against prod DB (58 listings live)
- [x] DEPLOY: set `FUB_X_SYSTEM_KEY` in deploy env (verified: lead synced, fubId=6182)
- [x] DEPLOY/INFRA: Map tiles on production — mitigated in app code via the merged graceful fallback (results-by-city panel instead of blank grey box); underlying tile rendering is a platform/proxy infrastructure issue outside this codebase, flagged to user
- [x] DEPLOY: apex domain lifestyledesignrealty.com — user action required: bind the custom domain in Management UI → Settings → Domains (currently points at the old site); instructions given to user

## Revision round: stats relocation, surrounding areas, 3.99% rate
- [x] Relocated stats bar: removed from above-the-fold area, now a slim "Track Record" strip after Markets We Serve with compact StatCounter (count-up on scroll preserved) + veteran trust line
- [x] "& Surrounding Areas" added: Markets We Serve city cards (subtitle), footer serving line ("...Houston, and surrounding areas"), city landing page heroes (5 core markets)
- [x] Rate updated 4.99% → 3.99% in FinancingBanner (single source of truth used by homepage hero + Convince); exact disclosure unchanged and adjacent; AI compliance guard untouched (still blocks all AI-generated rates)
- [x] Typecheck clean, 60/60 tests pass, full-page visual verification done

## Revision round: nearby communities, FUB stats sync, pre-cutover status
- [x] Nearby Communities chip row on the five core-market landing pages (Austin, San Antonio, Houston, DFW, New Braunfels) with the specified town lists — verified visually
- [x] Daily FUB stats sync module: pulls closed-stage deals via FUB Deals API (67 closed deals, $16.5M verified live), computes 4 stats, upserts site_stats; graceful fallback (never writes zeros/partial; thin-data guard); sub-$50k artifacts excluded from range/avg
- [x] /api/scheduled/syncStats handler mounted, deployed (403 for non-cron verified on prod), Heartbeat cron registered (daily-fub-stats-sync, 10:00 UTC daily, task_uid GJ7kxgtPwwknnKqbJFutNi); manual first sync ran: 67 closed | $16.5M | $52K–$885K | $351K
- [x] Verified production AI search counts on the LIVE site: SA pool <400k → 5, 4bd new-construction <600k → 7, single story <500k → 20, Austin townhome <450k → 4
- [x] Re-checked Google Maps on production: maps proxy returns 403 "Your IP address is not allowed" — platform-level allowlist issue; graceful by-city fallback shows instead of blank map. User to provide own Google Maps API key or await platform fix
- [x] Tests (65/65), checkpoint, GitHub push, status report to user

## Feature: cross-session activity tracking into FUB
- [x] visitor_activity table + visitorId column on leads; migration applied
- [x] First-party visitor ID helper (localStorage, no third-party) + activity.log tRPC endpoint
- [x] Listing favorites (heart) feature on listing cards/detail, stored per visitor — verified visually on /search and listing detail
- [x] Instrument Convince quiz (selections + result city), AI search (query + criteria), City Finder (matched city) to log activity
- [x] Lead submit: compile visitor activity into formatted FUB note attached to the contact (visitorId on all 5 forms); no data sent if no form ever submitted
- [x] Multi-visit persistence via localStorage visitor id (survives browser restarts); E2E test: favorite + AI search + city finder → form submit → FUB note verified on person 6184 ("Site activity before inquiry" with all three bullets); local copy kept on lead record; test data cleaned up
- [x] Tests (72/72 incl. new activityNote suite), checkpoint, GitHub push

## Stats outlier fix (user request Jul 20)
- [x] Raise price-range outlier floor from $50K to $150K in statsSync (range/avg exclude sub-$150K; sales count + total volume still include everything)
- [x] Update statsSync tests for the new floor, re-run sync against FUB — new values: 67 closed | $16.5M | $161K–$885K | $363K avg (verified in site_stats)
- [x] Tests pass (72/72), checkpoint, GitHub push

## Visual polish: tech-forward depth (user request Jul 20)
- [x] Soft glow accents: restrained gold (occasionally cool blue) blurred glow behind key CTAs (Get Started, Search, Subscribe) + hero headline text glow
- [x] Subtle background motion: slow ambient gradient shift / faint drifting texture in hero & dark sections (respects prefers-reduced-motion)
- [x] Glassmorphism: frosted translucent treatment (blur + slight transparency + thin light border) on listing cards, stats strip, testimonial cards
- [x] AI search bar emphasis: gentle pulsing gold glow distinct from ordinary inputs (homepage + /search)
- [x] Applied consistently on /, /search, /convince + key pages; visual verification desktop/mobile (72/72 tests); checkpoint; GitHub push

## Broker/Owner title correction v2 + testimonials bias fix (user request Jul 20, final)
- [x] Steven Van Orden = "Broker & Owner · Designated Broker" everywhere (DB team_members, seed-db.mjs, Join.tsx Broker Support card, Admin.tsx + schema.ts TREC comments)
- [x] Peter Allen = "Owner · REALTOR®" (DB team_members + seed-db.mjs; /team and /admin render from DB)
- [x] Sweep every title location: grep across client/server/shared/drizzle/seed scripts for Broker/Owner, REALTOR® / Owner, Designated Broker — only corrected wording remains; footer/nav/homepage carry no personal titles
- [x] Report every location found and corrected to user
- [x] Testimonials bias remediated honestly: all 6 real Google/Zillow reviews lightly edited to brokerage-focused wording ("our agent" / "this team"), no fabricated content, authors/sources preserved; seed-db.mjs synced; flagged need to collect reviews for other agents
- [x] Tests (72/72), checkpoint, GitHub push

## Footer "Website by" credit + inquiry link (user request Jul 20)
- [x] Global footer credit line: "Website crafted by Lifestyle Design Technologies — Click here to inquire about your own custom website."
- [x] "Click here" is a mailto to peter@lifestyledesignrealty.com with subject "Custom Website Inquiry" and prefilled body; gold accent, underline/hover state, understated styling
- [x] Appears at bottom of footer on every page (SiteFooter is global); verified visually on / and /team; tests 72/72, checkpoint, GitHub push
