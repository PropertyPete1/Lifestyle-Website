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

## Footer credit v2: real inquiry form instead of mailto (user request Jul 20)
- [x] Replace mailto with modal inquiry form: Name, Email, Phone, Business Name/Type (optional), short message (WebsiteInquiryModal opened from footer credit)
- [x] Backend: websiteInquiry.submit tRPC procedure → FUB lead tagged "Wants Us to Build Their Website" + source "Website - Custom Website Inquiry" (verified live: FUB person created with exactly that tag/source/phone, then cleaned up)
- [x] Email copy of every inquiry to peter@lifestyledesignrealty.com via owner-notification service (email-style formatted copy; failure fallback alerts owner; inquiry always saved in admin Lead Log)
- [x] "Thanks! I'll be in touch soon." confirmation state in the modal — no email-client dependency (verified in browser E2E)
- [x] Vitest coverage (7 new tests, 79/79 total); visual verification; checkpoint; GitHub push

## Rate banner clarity fix (user request Jul 20)
- [x] Make "mortgage rates" explicit next to 3.99% everywhere it appears — single-source FinancingBanner (used by homepage banner + Convince financing line) now reads "we've gotten clients mortgage rates as low as 3.99%"; disclosure updated to "Mortgage rate shown reflects…"; grep sweep confirms no other 3.99% occurrence exists
- [x] Verify visually (homepage banner), tests 79/79 (one flaky live-network test passed on re-run), checkpoint, GitHub push

## Pull external GitHub changes + verification (user request Jul 20)
- [x] Pull latest GitHub main (commit 7996c6b): ListingsMap by-city location overview, registerCron.ts stats-sync registration on production boot, footer Privacy Policy link + /privacy page
- [x] Verify Map toggle on search results shows by-city grouped list (58 homes across 7 markets rendered, no blank box) — verified interactively in browser
- [x] Stats strip: cron registers on production boot (09:00 UTC daily, idempotent); strip itself has no visible timestamp — cron activity confirmable via Settings → Schedules and boot logs (noted to user)
- [x] DECISION RECORDED: NO Google Maps API key will be purchased. Map toggle permanently uses the by-city location overview; live property maps arrive via the IDX/MLS vendor widget in Phase 2. Maps question CLOSED.
- [x] Tests 81/81 (incl. 2 new registerCron tests), checkpoint (auto-publish), confirmed live

## Urgent homepage pivot — recruiting + new construction first (user request Jul 21)
- [x] Hide featured listings showcase from homepage via a simple re-enable-able visibility toggle (FEATURES.SHOW_PLACEHOLDER_LISTINGS in shared/site.ts; components, data model, admin CMS fully intact)
- [x] Add eye-catching Now Hiring top banner above the hero, whole banner clickable → /join; fits fully at 375px and desktop (self-measuring fixed banner + nav offset via --hiring-banner-h CSS var, ResizeObserver-safe)
- [x] Update wording to "up to $6,000" — banner ("Lease commissions up to $6,000/deal") + /join Warm & Hot Transfer Leads pillar
- [x] Homepage order: banner → hero + CTAs (Get Started, New Construction Search) → City Finder → Convince Your Partner teaser → AI search/tech → New Construction → markets → stats strip → team/testimonials → footer
- [x] City pages: placeholder listings hidden behind the same flag; New Construction CTA + area content lead the page
- [x] Convince Your Partner quiz: 3-step flow with "What's their biggest hesitation?" (6 multi-select) and "What do you do for work?" (4 quick-select) questions
- [x] AI pitch prompt factors in hesitation + work situation tactfully (buildUserPrompt); compliance guard unchanged; back-compat for old cached share links
- [x] Verify: 375px + desktop screenshots, /join unchanged except wording, listing model/CMS/AI search intact, browser E2E of full quiz → AI letter (hesitation + remote work reflected in output), 87/87 tests pass
- [x] Checkpoint 362a3da4 (auto-published); production bundle verified serving banner + hesitation quiz + $6,000 wording; pushed to GitHub Lifestyle-Website main

## Banner copy update — remove dollar figure (user request Jul 28)
- [x] Homepage Now Hiring banner: removed "$6,000" figure; new copy "Now Hiring: Licensed Agents · Real leads. Real support. Real growth. · See what we offer →"; placement/styling/clickability/mobile fit unchanged; $6,000 stays on /join only
- [x] Verified 375px + desktop (banner fits fully, no cut-off), 87/87 tests pass, checkpoint (auto-publish), pushed GitHub

## Admin analytics + /join improvements (user request Jul 28)
- [x] Audit: NO page-view/visit tracking existed anywhere — only visitor_activity (favorites/searches/quizzes for FUB context). Analytics built fresh, reusing the same anonymous ldr_visitor_id
- [x] /join "Why Agents Join Us" strip: 3 hooks (leads supplied, $6,000 lease commissions, broker mentorship/veteran-owned) in gold/glass cards inside the hero, visible on first screen at 375px and desktop; full pitch below unchanged
- [x] Track Now Hiring banner clicks as first-party "banner_click" events (anonymous ldr_visitor_id, no IP/fingerprint/personal data)
- [x] Site-wide first-party page-view tracking via usePageTracking in Router (normalized path + visitor id + timestamp; admin paths never counted; fire-and-forget)
- [x] Admin "Analytics" tab: totals (views/uniques/banner clicks/CTR), Now Hiring funnel (saw → clicked → visited /join → applied), views per page, daily table with trend bars, weekly rollup, 7/30/90-day ranges
- [x] Verify: analytics tab renders with live data (7 views / 3 uniques / 1 banner click / 50% CTR), live browser visit + banner click incremented counts correctly in DB, 94/94 tests pass (7 new analytics tests); test rows cleaned up
- [x] Checkpoint 9a4ef424 (auto-published), pushed to GitHub Lifestyle-Website main

## Traffic sources + New Construction outbound tracking (user request Jul 28)
- [x] First-party UTM/referrer tracking: source captured once per session (sessionStorage) — utm_source > referrer domain (www stripped, same-site ignored) > "direct"; utm_medium/utm_campaign kept; no third-party services
- [x] Analytics tab: "Traffic Sources" table (source/medium/campaign/views/uniques) with UTM tagging tip for campaign links
- [x] New Construction Search outbound clicks tracked at every placement: homepage hero CTA + New Construction section, city/neighborhood pages, /search empty state, City Finder results, /links bio link — each logs the page it was clicked from
- [x] NC clicks in Analytics: totals card, clicks-by-placement table, NC Clicks columns in Daily and Weekly
- [x] Verified live: visit with ?utm_source=instagram&utm_medium=bio&utm_campaign=test-verify recorded source correctly, NC CTA click logged nc_click with instagram attribution, Analytics tab rendered both new sections; synthetic test rows cleaned up; 96/96 tests pass

## BUG — top nav overflows off-screen (user report Jul 28)
- [x] Audit nav at 1280 / 1440 / 1512 / 375px — 7 flat items + phone + CTA clipped "Schedule a Consultation" and "Now Hiring" at 1280–1500px
- [x] Restructured: Portfolio/Neighborhoods/Search by Property Type/Home Search consolidated under a "Properties" hover/click dropdown; "Schedule a Consultation" shortened to "Consultation"; desktop row now 4 top-level items + phone + CTA; hamburger threshold moved from xl to lg; phone shows as icon at lg, full number at xl
- [x] "Now Hiring" is a standalone top-level item — guarded by test, gold-highlighted in mobile menu
- [x] Regression tests: server/navOverflow.test.ts — width-budget estimate at 1024px and 1280px (fails before overflow ships), top-level item count cap, Now Hiring presence, no lost links
- [x] Also fixed 375px overlap found during audit: wordmark now stacks two lines on small screens (full TREC brokerage name always visible), mobile controls tightened
- [x] Verified via screenshots at 375 / 1024 / 1280 / 1440 / 1512px + dropdown interaction; 101/101 tests pass

## Two quick updates (user request Jul 28)
- [x] Added "Sell With Us" to the Properties dropdown (5 items); nav overflow regression tests pass (dropdown items don't consume top-level width)
- [x] Updated ALL response-time messaging to "typically respond within 30 minutes": GetStartedForm (toast + confirmation), LeadForm (toast + confirmation — covers City Finder, Valuation, Contact, all lead forms), RecruitForm confirmation (/join), WebsiteInquiryModal confirmation, GetStarted page + Home trust bullets ("within one business day" → "within 30 minutes"), CityFinder results follow-up line. Newsletter unchanged (no response promise — just "You're subscribed"). Convince result screen untouched. 101/101 tests pass

## Three updates (user request Jul 28, batch 2)
- [x] /join closing: tagline "Lifestyle Design Realty. We built the brokerage we never had." + Team@lifestyledesignrealty.com email link added after the recruiting content; no DM language; form remains primary path
- [x] Public email swapped via SITE.email (single source): footer, /contact, /privacy → team@lifestyledesignrealty.com. Notification recipient updated: INQUIRY_COPY_RECIPIENT (website-inquiry email copy) → team@. Other lead forms notify via FUB assignment + owner notification (no hardcoded peter@). Peter's personal bio email on /team card left as-is (personal contact, not brokerage contact)
- [x] Homepage newsletter section hidden behind FEATURES.SHOW_NEWSLETTER=false (same pattern as listings flag); NewsletterForm code, FUB "Website - Newsletter" tagging, and subscriber data untouched. 101/101 tests pass

## Pull 858c3c3 + platform questions (user request Jul 28, batch 3)
- [x] Pulled 858c3c3 cleanly; 104/104 tests pass (3 new consent tests)
- [x] Checkpoint f5d0a3aa deployed; production bundle index-DeUvz1lL.js contains the web-design consent copy; live browser check confirmed checkbox + Privacy link render in the modal on the live site
- [x] Q1 answered: umami (repo template, powers Manus dashboard analytics), plausible.io + spaceEditor/Amplitude injected at platform hosting level — all persist on custom domain; disclosure list provided
- [x] Q2 answered: badge controlled by per-site hideBadge flag (currently false); no self-serve toggle found; recommend Settings → General check or help.manus.im request

## Hide ALL non-new-build property search until IDX (user request Jul 28, batch 4)
- [x] Audit every customer entry point to placeholder search/browse/listing experiences (nav, footer, homepage, city pages, links page, CTAs, direct URLs)
- [x] Gate nav Properties dropdown entries behind FEATURES.SHOW_PROPERTY_SEARCH; dropdown now = New Construction Search + Sell With Us; navOverflow tests flag-aware and passing
- [x] /search, /portfolio, /neighborhoods, /listing/:slug all render "Live MLS Search Coming Soon" screen with NC Search CTA when flag off (no fake results, no map panel)
- [x] Hidden all Browse Properties links: homepage hero, footer Explore (Portfolio/Home Search/Neighborhoods), TechShowcase AI-search card, City Finder results "Browse {city} Listings", /sell Recent Results grid + Full Portfolio link
- [x] Direct listing detail URLs render coming-soon treatment (no fake homes)
- [x] City pages verified clean: area info + NC CTA + lead form only
- [x] Zero deletion — all components, AI search backend, ListingsMap, seeds, admin Listings tab intact behind flag
- [x] Live customer click-through verified (8-page screenshots + live DOM dropdown check); 104/104 tests pass

## Analytics data hygiene + Site Stats source check (user request Jul 28, batch 5)
- [x] Inspected page_events: zero __test-*/test-src/test-verify rows existed (guard already cleans them); found other synthetic artifacts instead
- [x] Purged 108 synthetic rows: prelaunch_audit UTM session (5), /listing/anything check (1), manus.im preview-iframe sessions (87), pre-source dev rows (13), my two verification visitor sessions (10 more incl. the banner_click); 47 genuine direct-visit rows remain
- [x] Guard verified live: ran analytics suite, re-checked DB — zero test rows left behind (finally-block DELETE works)
- [x] Site Stats confirmed real FUB-synced values (68 sales / $16.7M / $161K–$885K / $360K — matches the last daily-stats-sync run, not the 63/$26M seed)

## Pre-domain final batch (user request Jul 28, batch 6)
- [x] Pulled GitHub main 7ceffb5 (Links.tsx isLinkVisible filter + linkVisibility tests); 126/126 tests pass
- [x] Added "Platform & Analytics" disclosure to /privacy (first-party cookieless analytics, Umami, Plausible, Manus bundle/Amplitude, provider policy links, change notice)
- [x] Checkpointed + deployed (bundle index-CbeE6JHy.js); live /links verified — 7 buttons, no Home Search, no placeholder-search routes; /privacy Platform & Analytics disclosure renders with policy links
- [x] Deployed state confirmed stable for immediate lifestyledesignrealty.com binding (126/126 tests, checkpoint 0528fd69 live, pushed to GitHub)

## Address update (user request Jul 28, batch 7)
- [x] Changed office address site-wide to 1212 Chicon St Unit 101, Austin TX 78702 (SITE.address, footer, Contact page now reads from SITE.address; /links + /privacy auto-inherit; grep confirms zero old-address references; verified rendering)

## Steven admin + Lease page (user request Jul 28, batch 8)
- [x] Steven admin access via Google sign-in (steven@lifestyledesignrealty.com promoted to admin in DB; both accounts use Google login via Manus OAuth); Peter keeps access
- [x] Restrict admin to ONLY peter@ and steven@lifestyledesignrealty.com — ADMIN_EMAILS allowlist in shared/site.ts, enforced in upsertUser (self-heals on every sign-in) AND in adminProcedure (defense in depth)
- [x] Test: adminAllowlist.test.ts — Steven authorized, random account (even role-tampered) refused, case-insensitive, lookalike domains rejected
- [x] New page "List Your Property for Lease" (/lease) modeled on /sell: leasing headline/copy for landlords
- [x] Kept Strategic Pricing + Professional Photography sections with adapted rental copy
- [x] Replaced Expert Negotiation with Expert Tenant Screening (income verification, rental history, background checks)
- [x] Speed-to-Market timeline: 4 automation-flavored step cards with icons + dashed connectors (Day 1 → Day 2-3 → showings → tenant placed)
- [x] Lease lead form: name, phone, email, monthly rent expectation dropdown, property address field → FUB "Lease Listing Inquiry" + "Landlord" tag (leaseInquiry.test.ts)
- [x] Added to nav: Properties dropdown (both pre-IDX and full menus), mobile menu, footer Explore
- [x] Deploy live; verified on lifestyledesignrealty.com: /lease renders with hero image loading, form submitted end-to-end → DB lead + FUB contact tagged ["Landlord","Lease Listing Inquiry"] (test data cleaned up); admin allowlist live (Steven role=admin in prod DB, allowlist tests cover refusal of other accounts). Live URL: https://lifestyledesignrealty.com/lease

## Homepage hero LIST FOR LEASE button (user request Jul 28, batch 9)
- [x] Add "LIST FOR LEASE" as fourth hero button on homepage, outlined style matching FIND YOUR TEXAS CITY / NEW CONSTRUCTION SEARCH, linking to /lease
- [x] Keep gold GET STARTED as primary CTA; flex-wrap flows 3+1 at 1280px, clean mobile stack verified at 375px
- [x] Verify live at desktop + mobile widths, confirm navigation to /lease (clicked live button → /lease), describe final layout; deployed (bundle index-B6_ZgkST.js live on lifestyledesignrealty.com)

## Post-launch round (user request Jul 28, batch 10 — six items)
- [x] 1. Track LIST FOR LEASE hero clicks as first-party event (lease_click kind) shown in Analytics (totals card + daily/weekly columns; hero + /links tracked)
- [x] 2. Add "Own a Rental? List It With Us" button on /links pointing to /lease (tracked as lease_click)
- [x] 3. Launch-day analytics reset: all page_events purged (0 rows); manus.im/manus.computer-sourced traffic now excluded server-side
- [x] 4. Post-bind sweep on lifestyledesignrealty.com: SSL valid (TLS 1.3, Google Trust, exp Oct 2026, apex+www), all 19 routes 200, live Contact form E2E → FUB synced fubId=6248 (test data cleaned), server rejects phone-less submission (HTTP 400 "A valid phone number is required"), script inspection: custom domain loads only umami + manus-runtime (NO plausible — manus.space-only; NO Made-with-Manus badge on either domain); privacy disclosure covers everything that loads
- [x] 5. Phone REQUIRED on every lead form: server superRefine (≥7 digits, Newsletter exempt); LeadForm now always sends phone (covers City Finder/Valuation/Contact/Convince/Lease); GetStarted+Recruit+WebsiteInquiry already required; Convince "email is enough" copy removed; SearchComingSoon links to /get-started (no separate form)
- [x] 6. Privacy Policy links audited: all five consent texts use relative <Link href="/privacy">; zero absolute dev/sandbox/manus privacy URLs in code (user saw the dev URL because relative links resolve to whatever host serves the page — on the live domain they resolve to lifestyledesignrealty.com/privacy)
- [x] Run full test suite (139/139), checkpoint 60babb63 deployed, live bundle index-CaYSg0AG.js verified on custom domain, pushed to GitHub Lifestyle-Website main

## /links page upgrades (user request Jul 29, batch 11 — four items)
- [x] 1. Now Hiring banner at top of /links: same NowHiringBanner component (identical copy/styling), clickable → /join, above profile header; 375px screenshots confirm fully on-screen
- [x] 2. Lead capture form BELOW the buttons (ungated): "Or skip the browsing — we'll reach out to you"; universal LeadForm (Name/Email/Phone required + interest select); TCPA + relative /privacy; FUB tag "Website - Links Page" + answers-aware routing (Joining the team → "Recruit - Website", Leasing → "Landlord", Buying/Selling → "Interest - X"); server phone validation via leads.submit; 30-minute confirmation; links_form analytics event on success
- [x] 3. Full social icon row: Instagram + Facebook fixed; TikTok (inline SVG) / YouTube / LinkedIn slots via new site_settings table + settings router, editable in Admin → Bio Links → Social Profiles, hidden until URL provided
- [x] 4. LDT credit at very bottom opening WebsiteInquiryModal; "Explore Our Full Website" → / added as final links button; Links Form Submissions card added to admin Analytics totals
- [x] Run full test suite (143/143), deploy checkpoint 0a49a96d, live bundle index-DKnlwcZH.js on lifestyledesignrealty.com verified (all 6 new strings present), pushed to GitHub Lifestyle-Website main (b04d575..0a49a96)

## /links trust signal line (user request Jul 29, batch 12)
- [x] Compact one-line trust signals under "Central Texas Real Estate Professionals" on /links: VeteranBadge (compact, same gold flag as site header) + "4.6★ · 22 Google Reviews", hairline divider between, single line; 375px screenshot confirms clean fit with margin; 143/143 tests; deployed + pushed

## City Finder AI upgrade + shareable results (user request Jul 29, batch 13)
- [x] Use cheapest suitable Anthropic model for ALL AI writing: Convince Your Partner switched claude-sonnet-4-5 → claude-haiku-4-5 ($1/$5 vs $3/$15 per MTok, 3x cheaper; verified HTTP 200 on this key — dated/3.5 variants 404); City Finder will use the same MODEL constant. (aiSearch criteria extraction uses the built-in invokeLLM, not the Anthropic key.)
- [x] Schema: city_matches table (slug, answers JSON, ranked cities, AI narratives per city, createdAt) for cached shareable results — migration 0009_cooing_hiroim.sql applied
- [x] Backend: server/cityNarrative.ts — Anthropic Claude AI narrative generation per matched city (personalized to quiz answers), compliance guard (violatesCompliance + retry), graceful fallback to existing templated copy, cached per unique answer set
- [x] Backend: cityFinder.generate mutation (parallel AI for top 3 cities, caches in city_matches, returns slug + narratives) + cityFinder.getBySlug query (public, returns cached result)
- [x] Frontend: CityFinder.tsx upgraded — after lead gate unlock, calls generate → loading spinner → AI narratives with vivid city case + LDR pitch + prominent Get Started CTA + hard facts (non-AI)
- [x] Frontend: "Share Your Match" button (native share / copy link / text SMS) same mechanism as Convince Your Partner
- [x] Route: /city-finder/:slug renders the cached shared result via CityFinderShared component (same narrative on reload, counts as fresh site visit)
- [x] Hard data (median price, price range, facts) stays non-AI; only narrative connective tissue is AI-written
- [x] Vitest: 9 new tests (cityFinder.test.ts) covering generate, getBySlug, fallback, compliance, edge cases — 152/152 total
- [x] Deploy checkpoint 7f5f9cb4, verified on lifestyledesignrealty.com (new bundle index-BhxZoMxz.js live, cityFinder.getBySlug returns 200, AI generation produces vivid personalized narratives, shared URL reproduces identical cached result — md5 verified, mobile 375px renders clean), pushed to GitHub Lifestyle-Website main (beb58cb..7f5f9cb)

## AI experience polish — pull + verify (user request Jul 29, batch 14)
- [x] Pulled GitHub 8552577 (streaming text reveal, staged AI status, vibe-matched City Finder imagery + OG cards, city_finder_generate analytics), merged, 180/180 tests, checkpoint 32206ffe deployed
- [x] Verified live: City Finder result hero imagery + vibe label, cached/shared results instant, Convince reveal intact, 375px legibility, OG card shows matched city photo (og:image = city-austin jpg), "City Finder Reports" admin analytics card wired; merge pushed to GitHub

## Stefanie admin access (user request Jul 29, batch 15)
- [x] Add stefanie@lifestyledesignrealty.com to ADMIN_EMAILS allowlist in shared/site.ts
- [x] Promote her user row to admin in prod DB + update allowlist tests (181/181 pass)
- [x] Checkpoint a913b173 (auto-published), pushed to GitHub Lifestyle-Website main (32206ff..a913b17)

## Living Logo on /links — pull + verify (user request Jul 29, batch 16)
- [x] Pulled GitHub 6e44a72 (LivingLogo gold particle mark on /links profile header), fast-forward merge, 207/207 tests pass
- [x] Checkpoint cc5c09e4 deployed (bundle index-CYVlnVWI.js live); verified: animated particle orb renders around LDR monogram (168×168 canvas, fixed-size relative wrapper), Now Hiring banner + all 9 buttons + lead form + socials + credit line intact, CLS = 0 (no layout shift on load), mobile 375px clean; pushed to GitHub (6e44a72..cc5c09e)

## Living Logo v2 — pull + verify (user request Jul 29, batch 17)
- [x] Pulled GitHub 6734ae0 (Living Logo v2: dense dimensional particle volume, flow bands, shimmer arcs), fast-forward, 228/228 tests pass
- [x] Checkpoint fdfcbc24 deployed (bundle index-_gEGUC__.js live); verified: v2 particle volume renders around LDR monogram (168×168 canvas, denser dimensional look), banner/9 buttons/form/socials/credit intact, CLS = 0; pushed to GitHub (6734ae0..fdfcbc2)

## Hero nanite swarm animation — pull + verify (user request Jul 30, batch 18)
- [x] Pulled GitHub 2fe2513 (nanite swarm animation layer on homepage hero + adaptive degrade fix + /links orb intensity adjustments), fast-forward, 263/263 tests pass
- [x] Checkpoint f124ab52 deployed; verified live: swarm canvas absolute inset-0 pointer-events-none behind headline (h1 fully legible, CLS = 0), particles confirmed drawing (3,842 lit px at 500ms), hero CTAs work (Find Your Texas City → /city-finder click-through), 375px mobile clean, /links orb intact; pushed to GitHub (2fe2513..f124ab5). NOTE: sandbox headless browser caps rAF at 30fps (~33ms > 21ms budget) so adaptive degrade correctly steps down to static after ~2.5s in that environment only — real 60fps devices sustain the animation by design

## Living Logo v3 intensity pass — pull + verify (user request Jul 30, batch 19)
- [x] Pulled GitHub 2b7a103 (Living Logo v3: brighter, denser, unmistakable circulation + stall-detection fix), fast-forward, 274/274 tests pass
- [x] Checkpoint d7bc4eed deployed (bundle index-Cb8Pgz1Y.js live); verified desktop + 375px: hero swarm particles drift upward (centroid dy=-20px over 350ms, no horizontal streaking pattern), h1/CTAs legible + clickable (pointer-events-none layer), CLS=0, no horizontal overflow; /links v3 logo measurably denser/brighter (772 lit samples, 90 bright accents, 64 warm-white bloom pixels on 168px canvas vs sparse v1), monogram clearly lit; all homepage + /links features intact; pushed to GitHub (2b7a103..d7bc4ee). Sandbox 30fps rAF cap still triggers designed degrade-to-static after sample window (desktop 60fps devices unaffected); v3 degrade leaves the styled static mark rather than clearing

## Form error handling + conversion pass — pull, migrate, verify (user request, batch 20)
- [x] Pulled GitHub a9cdb19 (form error handling, 20s request timeout, /links conversion pass, trust badges, exit-intent, sticky mobile CTA), 285/285 tests pass
- [x] Ran scripts-reorder-bio-links.mjs against production DB — 8 active buttons in intended order. Found the script's url-keyed keep-set spared the duplicate "Contact Us" (shares /contact with "Schedule a Consultation"); hardened the script to key deactivation on claimed row ids and re-ran clean/idempotent
- [x] Checkpoint 3d34d637 auto-published; live bundle index-dmgx3E4F.js; pushed to GitHub (a9cdb19..3d34d63)
- [x] Verified /links live: 8 buttons in intended order (New Construction Search, Find Your Texas City, Convince Your Partner, Schedule a Consultation, Own a Rental?, Join Our Team, Home Valuation, Explore Our Full Website), no Contact Us duplicate, top button gold-emphasized (gold border + warm tint vs plain dark rows)
- [x] Investigated a production serving stall hit during verification: HTML responses returned 200 + partial body then hung (varying 0/1360/2729/5467 bytes, chunked, never terminating) across all routes and both domains, while external sites fetched fine and dev preview served 368KB instantly. Ruled out the OG middleware (only matches /convince + /city-finder, yet / hung too) and app code (same build serves fine locally). Cleared after a service restart + warm-up; now serving complete 370KB documents consistently (5 consecutive warm requests, 2.9-7.9s). Treating as autoscale cold-start/rollout flakiness, not a code regression — worth re-checking under real traffic
- [x] Verified bad-phone submit on live /links: inline persistent message "Please enter a valid phone number so we can reach you." rendered directly under the phone field with the field outlined — no raw JSON, no vanishing toast, request blocked client-side
- [x] Verified trust signals on live /links: "We reply within ~30 minutes" badge plus "4.6★ on Google · 68 homes closed · Veteran-owned" trust line render above the capture form (closed count reading live from site_stats)
- [x] Verified sticky mobile CTA at 375px on live / and /city-finder: gold "Ready? Get Started" bar pinned to the bottom edge with an X dismiss control; `fixed` + `md:hidden` so it is mobile-only and contributes zero CLS, publishes --sticky-cta-h (56px) that PageShell reserves as bottom padding so it never covers page end, auto-hides on focusin / restores on focusout so it can never sit over an input, and dismissal persists for the session (sessionStorage ldr_sticky_cta_dismissed)
- [x] Verified exit-intent on live site: fires on genuine desktop leave-intent (mouseout clientY<=8, no relatedTarget) with copy "Want us to find your perfect Texas home?" and controls Close / Get Started / No thanks; closes via Esc, backdrop click, AND No thanks (all three confirmed); fires only once per session (sessionStorage ldr_exit_intent_seen set on show, retrigger does nothing); mobile hard-excluded via coarse-pointer OR innerWidth<1024 early return and no modal present in 375px captures
- [x] FIXED — exit-intent was permanently suppressed on the homepage: the "already converted" guard scanned document.body.innerText for /we typically respond within 30 minutes/i, but that exact sentence is also a STATIC selling point beside the Get Started form on Home and GetStarted. Confirmed live (guard matched on /, modal never showed; showed correctly on /team). Replaced the text scan with an explicit `data-lead-converted` marker rendered only by real post-submit success states (GetStartedForm, LeadForm, RecruitForm), plus a regression test (server/exitIntentSuppression.test.ts, 6 assertions on comment-stripped source) that locks the contract and asserts the advertising pages are NOT marked converted. 292 tests passing
- [x] Re-verified the fix on the LIVE homepage (bundle index-CKu9bSPq.js): exit-intent now fires on / where it never could before — modal shows "Want us to find your perfect Texas home?", session key set on show, Esc closes; no data-lead-converted marker present pre-submit
- [x] Submitted one valid test lead end-to-end through the live Get Started form ("__TEST Delete Me", test-delete-me@lifestyledesignrealty.com, (210) 981-3830, Buy / Just exploring, consent checked). UI showed the Thank You confirmation; DB row 450001 recorded sourceTag "Website - Get Started", intent Cold, fubStatus **synced**, fubId 4046. Independently confirmed against the live FUB API: person 4046 carries the submitted email + phone and the new tags "Website - Get Started" and "Website - Get Started - Cold", assigned to Steven Van Orden
- [x] Noted for Peter: FUB deduped this submission onto a PRE-EXISTING person (created 2025-05-10, stage "Trash", previously tagged "Bounced" / "Silviano Contreras") instead of creating a new contact — expected FUB behavior when the email/phone already exists. The website->FUB push itself is confirmed working; only that old trashed record picked up the new tags. Leads with fresh contact details create new people normally

## Batch 21 — /links trim to 6 buttons, promise strip, leasing in Get Started (pull e71f7bd)

- [x] Pull GitHub main through e71f7bd (297 tests passing, tsc clean)
- [x] Ran scripts-reorder-bio-links.mjs against production twice (idempotent): 6 active buttons in order, "Home Valuation" and "Join Our Team" deactivated (not deleted, still recoverable from admin)
- [ ] Checkpoint so the changes deploy
- [ ] Verify /links live: exactly 6 buttons in order, NC Search gold-emphasized first, Explore Our Full Website last, Join Our Team + Home Valuation gone
- [ ] Verify gold promise strip is fully above the fold at 375px and taps smooth-scroll to the capture form with a gold glow pulse
- [ ] Verify main Get Started form includes "List for Lease" in the "I'm looking to" select
- [ ] Verify desktop Properties dropdown includes List for Lease
- [ ] Verify no layout shift and existing /links + homepage features intact
- [ ] Push merged state to GitHub
