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
- [x] Checkpoint fd197150 saved and auto-published
- [x] Verified /links live: links.list returns exactly 6 active buttons in order (NC Search, Find Your Texas City, Convince Your Partner, Schedule a Consultation, Own a Rental? List It With Us, Explore Our Full Website). NC Search renders with the gold-emphasized treatment first, Explore Our Full Website last, and Join Our Team + Home Valuation no longer appear
- [x] Verified the gold promise strip: sits at 350-401px from document top (bottom edge 401px), so fully above the fold even on the smallest common mobile viewport (568px tall) — comfortably above the fold at 375x812. Tapping it smooth-scrolls to the capture card (scrolled 0 -> 585, card centered in view) and applies the `form-flash` class with computed animation `form-flash 1.6s`, cleared after 1800ms so a re-tap restarts it. Reduced-motion users get the scroll without the pulse (the keyframes live inside a prefers-reduced-motion: no-preference block)
- [x] Verified the live homepage Get Started form: "I'm Looking To" now offers Buy / Sell / Buy & Sell / **List for Lease**
- [x] Verified the desktop Properties dropdown on the live site: New Construction Search -> a.nhb.app, Sell With Us -> /sell, **List for Lease -> /lease**
- [x] Verified no layout shift: homepage CLS 0, /links CLS 0.057 (from the Living Logo canvas settling; strip/buttons hold their space). No horizontal overflow on either page once the nav dropdown is closed. Existing features intact — /links banner, 6 buttons, capture form with Buying/Selling/Leasing/Joining, socials, phone, TREC links, LDT credit; homepage hero CTAs, Get Started form, markets, team, testimonials, footer. Landlord FUB routing covered by 5 tests: /lease form, /links "Leasing" interest, Get Started "List for Lease" goal, buyers/sellers NOT tagged Landlord, and no duplicate tag
- [x] Pushed merged state and verification notes to GitHub main (88f9495)

## Batch 22 — bug: ResizeObserver loop error on homepage

- [x] Investigated: NowHiringBanner was the only ResizeObserver in app code. Its callback read `el.offsetHeight` (forcing synchronous layout) and wrote `--hiring-banner-h` on <html>. SiteNav's `top`, the homepage hero's padding-top, and the /links header padding all lay out against that var, so the write re-triggered the observer inside the same delivery cycle — the textbook cause of this error. 38 occurrences were logged in one session
- [x] Fixed at the source with three guards: read the size off the ResizeObserverEntry (`borderBoxSize`, `contentRect` fallback) instead of offsetHeight; round to whole pixels so subpixel jitter can't re-arm the loop; apply the write inside requestAnimationFrame and skip it entirely when the value is unchanged, so a settled banner writes nothing. Pending frame is cancelled on cleanup
- [x] Added server/bannerResizeObserver.test.ts (7 tests): no offsetHeight in the callback, entry-based measurement, rAF defer + cancel, Math.round, unchanged-value early return, cleanup intact, and a filesystem scan asserting NowHiringBanner stays the only app-level ResizeObserver so this bug class can't reappear elsewhere
- [x] Verified: cleared browserConsole.log, then reloaded / and /links at 375px, 640px and desktop plus a stress test cycling the layout through 15 widths (1280 -> 320 -> 1280) across the banner's wrap breakpoints. Zero ResizeObserver errors, zero console errors of any kind. The var still tracks correctly (42px = real banner height) and the nav sits flush below the banner with no overlap

## Batch 23 — guide-trail chip restyle + orb fidelity

- [x] Pulled GitHub main: c6b6f6c (promise chip restyle + guided gold trail) and 3e9c421 (orb fidelity — every iPhone was rendering 240 of 1150 particles); 386 tests passing
- [x] Checkpoint e054ca14 saved and auto-published
- [x] Verified at 375px: the promise is now a soft-filled gold pill (fully rounded, no border) with the underlined "Tap here" affordance, visually distinct from the hard-cornered bordered link buttons below it, and sitting above the fold in the header
- [x] Verified the tap sequence on the live page. The gold line draws down the gutter (x=453, left of the 465px content edge) as the page smooth-scrolls: head travelled y1 410 -> 0 -> 134 over 11 sampled frames while scrollY went 0 -> 724, so line and scroll move together rather than one after the other. Trail holds full opacity through the 850ms draw then fades to 0 and self-hides (visibility hidden, opacity 0). The capture card's glow fires at ~962ms — right as the head arrives — and clears at ~2650ms (850 draw + 1800 flash), so a re-tap restarts it. Overlay is fixed/pointer-events-none/aria-hidden, so it never intercepts a button tap and adds no layout
- [x] Read /links?orbDebug=1 on the live site. Fresh mount reports: **tier medium, particles 620, halo 95, fps 30, 6 cores / 4GB / 1x DPR**. The sandbox browser is capped at 30fps, so the adaptive ladder then steps medium -> low (240 particles, ~1.76s) -> static (~5s), leaving a lit static mark (7,242 lit pixels on the 168x168 canvas) rather than a blank canvas. The 30fps cap is a headless-environment artifact, not a device signal — a real 60fps phone holds its tier. Note the sandbox lands on medium (not high) only because it is Chromium and REPORTS deviceMemory 4GB; a real iPhone reports no deviceMemory at all, which under the new policy means "no signal" -> 4-6 cores with unknown memory -> **high (1150 particles)**. That is exactly the 240 -> 1150 fix in 3e9c421, and the orbDebug flag is confirmed present in the deployed bundle
- [x] Pushed merged state and verification notes to GitHub main (d6acf82)

## Batch 23 — /links promise strip: visual disambiguation + guided connection (user request Jul 31)

- [x] **Restyled the strip as a chip.** It was a gold-bordered rectangle with a ↓ arrow sitting directly above the gold-bordered NC Search button — two gold boxes stacked, so they read as one control with a secondary row. Now a pill (`rounded-full`, soft `bg-gold/[0.09]` fill, **no border**) so it no longer shares the buttons' visual vocabulary. Arrow removed; the affordance is an underlined gold "Tap here" ending the copy: "⚡ Skip the browsing — tell us what you need and we'll reach out *within 30 minutes*. **Tap here**"
- [x] **Animated gold connection line on tap.** New `GuideTrail` component + `shared/guideTrail.ts` (geometry/timing). A thin gold line with a bright 72px head draws itself down the page gutter from the chip to the capture form over 850ms, timed with the smooth scroll, then fades over 450ms — 1300ms total life. Endpoints are re-measured every frame from `getBoundingClientRect()`, so the line tracks the scroll instead of being baked in at tap time; both ends clip to the viewport, so it runs to the bottom edge while the form is still off-screen and then lands on the form as the scroll brings it into view. The existing `form-flash` gold pulse is now delayed to the head's arrival (850ms) so the line terminates *in* the glow rather than racing it
- [x] **The line is drawn beside the buttons, never across them.** `guideLineX()` centres it in a tight mobile gutter (x=10 at 375px, buttons start at x=20) and hugs the column on desktop (x=404 with the column at 416). The invariant `x <= contentLeft` is tested across mobile/desktop/pathological viewports
- [x] **Zero CLS, zero tap interference.** The overlay is a `fixed inset-0 pointer-events-none aria-hidden z-40` SVG (under the z-[60] banner and z-50 dialogs), always mounted but hidden, driven imperatively from rAF so there is no per-frame React render. A wall-clock backstop timer stops it even if rAF is throttled to a standstill in a hidden tab
- [x] **Reduced motion:** no trail at all, instant scroll, and the form highlight lands immediately. Added a `prefers-reduced-motion: reduce` rule so those users get a *static* held gold outline — before this they got the scroll and no destination cue at all, because the `form-flash` keyframes live inside a `no-preference` block
- [x] **More air between the chip and the first button** — the link stack went `mt-6` → `mt-9`
- [x] Kept: same promise copy word for word, `links_promise_click` tracking (verified firing on tap with the correct payload), above-the-fold at 375px
- [x] 32 new tests in `server/guideTrail.test.ts` (timing budget, opacity envelope, easing monotonicity, gutter invariant, segment clipping/landing, plus source contracts: chip is a borderless pill, no `ArrowDown` anywhere, underlined "Tap here", promise copy intact, tracking wired, `mt-9` gap, overlay is pointer-events-none/fixed/z-40 with full teardown, reduced-motion branches). 334 total, `tsc --noEmit` clean, `vite build` clean. The only 2 failing tests are the pre-existing live-credential checks (`FUB_API_KEY`, `ANTHROPIC_API_KEY`) that need env vars not present locally
- [x] Verified in a local 375×667 preview: **chip bottom sits 500px from the document top with the real 3-line mobile banner (70px) — above the fold on 667px and on the 568px smallest common viewport**; CLS = 0 (no layout-shift entries at all on load); no horizontal overflow (scrollWidth 375); taps reach both the chip and the first button with the overlay forced visible (`elementFromPoint` returns the target, never the SVG); frame-stepped the trail through its full life and confirmed x=10 throughout, head travelling 499.6 → 667 on the eased curve with the tail 72px behind, opacity 1 → 0.06 by t=1300. NOTE: the sandbox browser throttles rAF to ~2fps while scripted, so the animation was verified by driving its frame callbacks on a fake clock rather than by wall-clock sampling — same class of sandbox limitation recorded in batches 18/19
- [x] Manus: pulled c6b6f6c, checkpointed (e054ca14 / 76c9cc69) and re-verified the chip and trail on the live /links — see the Batch 23 findings below

## Batch 24 — Orb fidelity investigation: live visitors saw a far weaker orb than dev (user request Jul 31)

### 1. Deployed version — VERIFIED CURRENT, the deploy was never the problem
- [x] lifestyledesignrealty.com and lifestyle-re-6avnvcuv.manus.space serve the **same** bundle (`/assets/index-Disx-g6W.js`) — the apex domain is now pointed at this build
- [x] That bundle contains the full v3 intensity pass from 2b7a103: tier budgets `high:1150,medium:620,low:240`, halo `175/95/36`, swell floor (`return .28+(.5+.25*i+.25*c)*.72`), `ORB_HERO_FRACTION = .015`, v3 band velocity (`.075 + eq*.36 + sin(3φ)*.085`) and the v3 alpha curve (`.06 + d²*.78`). Nothing stale was serving

### 2. ROOT CAUSE — tier assignment, not the renderer. Every iPhone was scored as a budget device
Traced `selectTier` against what browsers actually report:

| device | cores | deviceMemory | dpr | OLD tier | orb particles | NEW tier |
|---|---|---|---|---|---|---|
| iPhone 12/13/14 Safari | 4 | *(unreported)* | 3 | **low** | **240** | high (1150) |
| iPhone 15/16 Pro Safari | 6 | *(unreported)* | 3 | **low** | **240** | high (1150) |
| iPhone SE3 Safari | 4 | *(unreported)* | 2 | **low** | **240** | high (1150) |
| Galaxy S23 Chrome | 8 | 8 | 3 | medium | 620 | high (1150) |
| Android Firefox | 8 | *(unreported)* | 3 | **low** | **240** | high (1150) |
| MacBook Pro (dev screenshots) | 12 | *(unreported)* | 2 | high | 1150 | high (1150) |

Three separate bugs stacked up:
- **`cores <= 4 → low`.** iOS Safari reports hardwareConcurrency 4 on every iPhone through the 14 (6 on the 15/16 Pro). Four Apple cores are not a budget device — but that rule alone put every one of them on 240 particles while the dev machine ran 1150. **That 4.8× is the reported gap.**
- **`memoryGb ?? 4`.** `navigator.deviceMemory` is Chromium-only; Safari and Firefox have never shipped it. Defaulting unknown to 4GB scored every Apple device as a mid-range Android, which is what dropped the 6-core iPhone 15 Pro to medium before the DPR rule finished it off
- **The `dpr >= 3` demotion charged for pixels that are never painted.** Both renderers clamp their backing store to `MAX_DPR = 2`, so a 3x screen fills exactly as many device pixels as a 2x one at the same CSS size (confirmed live: the 1280×839 hero canvas has a 2560×1678 backing store on a 2x display). This is what finished off every remaining 3x phone
- [x] New policy, 4 lines: `cores<=2 || memory<=2 → low`; `cores>=8 → high`; `cores>=4 && memory>=8 → high` (unknown memory reads as no-signal, not as small); else medium. DPR is no longer a tiering input. Genuinely weak hardware still starts at the floor: 2GB → low, dual-core → low, 4-core/4GB budget Android → medium
- [x] NOTE: `selectTier` is shared with the homepage hero swarm, so those devices also move 85 → 280 nanites. Deliberate, and the reason the safety net below was extended to NaniteSwarm rather than only the orb

### 3. Permanent downgrade on load jank — FIXED, both directions
- [x] **Warm-up grace.** Frames within `WARMUP_MS = 2500` of loop start are not measured at all (`REBUILD_WARMUP_MS = 600` after a tier change or a resume). Page load is the jankiest window a visitor ever sees and it was exactly the window that decided their tier for the session
- [x] **Recovery.** After a sustained healthy streak the tier steps back UP one level, capped at the tier the hardware was assigned (`tierRank(tier) > tierRank(assignedTier)`). Window is 10s, doubling per attempt to 80s (`recoveryWindowMs`) so the two decisions can never ping-pong
- [x] **Hysteresis band.** Degrade at avg >21ms, recover at avg <18.5ms — a device averaging 18.5-21ms does neither. Recovery budget was 17ms in the first draft and raised to 18.5 after live driving showed a real 60fps device (~16.7ms with jitter) could not reliably clear it
- [x] **Caught during live driving:** the healthy streak was only broken by *stalls*, so a device running steadily at 33fps accrued a "healthy" 10s and could claim a tier back off one brief good patch. Any frame over the degrade budget now restarts the streak — tolerance is the 21ms degrade budget, not the 18.5ms recovery budget, so ordinary 60fps jitter doesn't keep resetting the clock
- [x] Trustworthy-frame stall guard unchanged: a stall (>40ms) still wipes the sample window, and now also breaks the healthy streak, so time spent stalled can never be counted as proof of health

### 4. Debug view — `?orbDebug=1` on /links
- [x] Fixed bottom-left panel: current tier (plus the assigned tier when they differ), particle + halo counts, rolling fps, the device's own cores/memory/dpr, and the tier history (`↓medium ↑high`). Opt-in only, explicitly off for `?orbDebug=0`, `pointer-events-none` + `fixed` so it contributes zero layout, publishes at 4Hz from a ref so the hot loop never triggers a React render, and creates no timer at all when the flag is absent
- [x] Fixed during verification: the give-up path returned before the publish, so the panel reported the last animated tier after the animation had already fallen back to static

### 5. Verification
- [x] 386 tests (was 334): 83 in livingLogo.test.ts including the rewritten tiering suite (asserted against real device profiles, with the three regressions named), plus new server/orbFidelity.test.ts (28) covering what a real phone receives, the DPR cap in both renderers, warm-up/recovery wiring in both components, the debug overlay's opt-in and zero-layout contract, and unchanged fallbacks. `tsc --noEmit` clean, `vite build` clean. The only 2 failures are the pre-existing live-credential checks (FUB_API_KEY, ANTHROPIC_API_KEY) that need env vars not present locally
- [x] **Drove the real component through a full degrade→recover cycle** in a local preview using a synthetic frame clock (the sandbox browser throttles rAF to ~2fps and reports the tab hidden, so wall-clock driving is impossible — same limitation recorded in batches 18/19): steady 60fps → `tier high, 1150 particles` · brief 33fps hitch → `↓medium, 620` · healthy ~5s → still medium (correctly patient, under the 10s window) · healthy streak passes 10s → **`↑high, 1150`** · continues healthy → stays at high, never exceeds the assigned tier
- [x] Confirmed the stall guard in situ: while genuinely throttled the panel reports `fps —` and no samples accumulate, so a throttled environment can never degrade a device
- [x] Fallbacks and perf discipline unchanged: /links CLS **0** with no layout-shift entries at all, orb box reserved at 168×168, no horizontal overflow, static LDR monogram always rendered, debug panel absent without the flag, homepage hero canvas still `pointer-events-none` with a 2x-capped backing store and a legible headline, no console errors beyond the expected local tRPC failures (no backend in the preview)
- [x] Manus: pulled 3e9c421 and checkpointed; read /links?orbDebug=1 on the live site as far as this sandbox allows (reports tier medium · 620 particles, because headless Chromium REPORTS deviceMemory 4GB and is frame-capped at 30fps). Confirming `tier high · particles 1150` requires a real iPhone, which no sandbox browser can stand in for — handed to Peter as the one open check. Traced the policy to show why an iPhone now qualifies: Safari reports no deviceMemory, which is treated as "no signal" rather than 4GB, so 4-6 Apple cores resolve to high

## Batch 24 — re-verification of the device-tier fix (already-deployed commit)

- [x] Confirmed 3e9c421 is an ancestor of HEAD and GitHub main has nothing newer, so no pull was needed; the live bundle (index-DFEu24Ui.js) already contains the tier fix, the 1150 budget and the orbDebug overlay
- [x] Verified the /links orb renders on the live site: 168x168 canvas painting 7,269 lit pixels in a fixed 168x168 wrapper
- [x] Verified the homepage swarm renders on the live site: full-bleed 1265x839 canvas, peak 5,587 lit pixels sampled over a fresh mount, pointer-events-none over an absolutely-positioned parent so it takes no layout and cannot block CTAs; headline renders above it in near-white
- [x] Verified no layout shift: homepage CLS 0, /links CLS 0.055 (Living Logo canvas settling). No horizontal overflow on either page. Both pages confirmed at 375px mobile
- [x] Verified /links?orbDebug=1 shows the debug panel (fixed, pointer-events-none, bottom-left, reporting tier/particles/halo/fps/cores/memory/DPR and each degrade step) and that it is absent without the flag, so it costs nothing for real visitors

## Batch 25 — The Crown Branch hero (pull 9e4ba04 + live verification)

- [x] Pulled 9e4ba04 from GitHub main (CrownBranch component + shared geometry module + 54 new tests); tsc clean, 440 tests passing
- [x] Checkpoint af386ef9 saved and auto-published
- [x] Verified ENTRANCE on the live site with the session flag cleared. The draw is symmetric and progressive: lit pixels climb 155 -> 1900 while the leading edge (maxY) descends 22 -> 636 down the page, and the left/right edge columns light up in lockstep (both 0 -> 400), i.e. two heads racing down both edges from top center. The crown band around the headline starts filling at ~1170ms (325 -> 697 px) while the border is still descending, so the branch draws in sync with the border pass rather than after it. Session flag `ldr_crown_seen` is set to 1 by the end of the entrance
- [x] NOT a bug — traced the apparently frozen settled state to the shared adaptive degrade, not a stall. CrownBranch reuses the livingLogo budget (DEGRADE_BUDGET_MS=21, WARMUP_MS=2500, STEADY_CHECK_SAMPLES=45) and this sandbox browser runs at a measured 33.4ms/frame (30fps cap), so once warm it exceeds budget and the loop deliberately paints one settled frame and stops. Confirmed the racers DO glide when sampled inside the pre-degrade window: over 16 samples the lit-pixel centroid advanced monotonically (cx 733 -> 742) with 15 of 16 unique positions, and the bright-pixel count varied 9-21 as the racer heads travelled. On a 60fps device this never trips
- [x] Verified SETTLED state on the live site: faint border + brighter crown persist (settled alphas 0.16 border / 0.30 crown vs 0.55 / 0.70 during the draw) with racers gliding the border and orbiting the crown — two border racers at opposite phases plus one on the crown, motion continuous rather than one-shot
- [x] (duplicate of the settled-state item resolved above) Verified: faint border + brighter crown persist and the racers glide continuously when frames are within budget; the sandbox's 30fps cap trips the shared adaptive degrade, which is why motion appears to stop here but will not on a 60fps device
- [x] Verified NO floating particles/swarm on the homepage hero: exactly one canvas in the DOM (the CrownBranch line layer, 1265x839, pointer-events-none, absolute inset-0), no nanite/Swarm markers anywhere in the live DOM, and Home.tsx no longer imports NaniteSwarm. The component file remains in the repo but is unreferenced by app code
- [x] Verified a same-session reload skips the entrance: with `ldr_crown_seen=1` the full geometry is present from the very first sampled frame (maxY 825 of an 839px canvas, i.e. the border already reaches the bottom) and holds constant across 8 samples, instead of the entrance's 22 -> 636 descent. Confirmed visually too — the reload screenshot shows the completed crown frame around the headline with no draw-in
- [x] Verified mobile: at a true 375px viewport the crown frame encloses the whole wrapped headline block — the headline wraps to two lines ("LIFESTYLE" / "DESIGN REALTY") and the frame brackets both lines rather than only the first. Also confirmed at 320px, where the headline still wraps to two lines and the frame still encloses them. The frame sits clear below the Now Hiring banner and clear above the financing card at both widths. No horizontal overflow: documentElement.scrollWidth 1265 vs innerWidth 1280 at desktop, and zero elements extend past the right edge. (An earlier reading of "overflow" came from faking mobile by setting a CSS width on #root inside a 1280px window, which is a measurement artifact, not a page bug — discarded and re-measured properly.)
- [x] Verified hero legibility and clickability: headline renders at full opacity in near-white (oklch 0.97) above the line layer, and all five hero CTAs (Get Started, Find Your Texas City, New Construction Search, List for Lease, Home Valuation) are visible at opacity 1 with hit-testing confirming each is the topmost element at its own centre, so the canvas never intercepts a click
- [x] Verified ZERO layout shift on a clean fresh load: CLS 0 with no layout-shift entries at all across the entrance. The line layer is `position:absolute; inset:0; pointer-events-none; aria-hidden=true`, so it contributes no layout box. Max horizontal scroll is 0 (the page cannot be scrolled sideways) and no element's right edge passes the content edge; the scrollWidth/clientWidth gap is scrollbar accounting, not overflow
- [x] Verified the /links living logo orb is unchanged by the hero redesign: it still renders the dense gold volume around the LDR monogram on a 168x168 canvas, and the orbDebug overlay reports the same tier medium / 620 particles / halo 95 / 6 cores / 4GB / 1x as before the pull. Confirmed at 375px too. The two animations remain independent — CrownBranch on the homepage, LivingLogo on /links
- [x] Pushed merged state and verification notes to GitHub main (b184dbb)

## Batch 25 — Homepage hero: remove the nanite swarm, build The Crown Branch (user request Jul 31)

### Part 1 — swarm unmounted, not deleted
- [x] `<NaniteSwarm />` removed from the homepage hero. The component file and `shared/naniteSwarm.ts` stay in the codebase — `shared/livingLogo.ts` (tiering, degrade/recovery, stall guard) is imported by the /links orb and by the new hero layer, and the swarm's own 30-test suite still covers its motion module
- [x] The /links living logo orb is untouched — verified live: single 168×168 canvas, 336×336 backing, monogram, promise chip and guide-trail overlay all intact

### Part 2 — The Crown Branch
- [x] `shared/crownBranch.ts` (DOM-free geometry/timing) + `client/src/components/CrownBranch.tsx` (canvas 2D renderer). No new dependencies; production JS went 759.89 kB → 761.33 kB (+1.44 kB raw, +0.16 kB gzipped) with the swarm still bundled
- [x] **One shared speed.** `HEAD_SPEED = 0.62` px/ms drives every head; motion is distance-along-polyline, never a per-path duration. Both halves of each pair are mirror images, so they are exactly the same length and arrive together with no timing correction. Confirmed empirically on the live hero by sweeping the frame clock: the left-edge trail advanced 368px in 600ms and 376px in the next 600ms (0.613 / 0.627 px/ms)
- [x] **The branch is triggered by depth, not by a delay.** `distanceAtDepth()` finds where the border head's y first reaches the crown's top edge; the crown pair is born at that distance ÷ the same speed. Move the headline and the branch moves with it
- [x] **The crown is measured, never hardcoded** — `crownRectFromHeadline()` from live `getBoundingClientRect` of the h1 and the hero, re-measured on resize, orientationchange, `document.fonts.ready` (the serif reflows the headline after load) and on a 250ms cadence in the loop (which also catches the Now Hiring banner changing `--hiring-banner-h` and pushing the hero content down)
- [x] Entrance plays once per session (`ldr_crown_seen`); trails 0.55 border / 0.7 crown; hero content fades in over 900ms at 40% of the border entrance
- [x] Settled state: border 0.16, crown 0.30, two comet racers on the border at opposite phases and one brighter racer orbiting the name forever

### Verification
- [x] 440 tests (was 386), 54 new in server/crownBranch.test.ts. `tsc --noEmit` clean, `vite build` clean. The only 2 failures are the pre-existing live-credential checks (FUB_API_KEY, ANTHROPIC_API_KEY) that need env vars not present locally
- [x] **Desktop 1280×800, pixel-verified:** all four border edges lit at alpha 41/255 = 0.161 and all four crown edges at 77/255 = 0.302 — matching the 0.16/0.30 spec — with the hero interior blank and 20px above the crown blank, i.e. the frame sits exactly on the measured headline rect (30, 204 → 1250, 300). CLS **0**, canvas 1280×839 CSS / 2560×1678 backing (DPR capped at 2), absolute + pointer-events-none + aria-hidden, `elementFromPoint` on the primary CTA reaches the CTA and never the canvas, no horizontal overflow
- [x] **375×667 mobile, pixel-verified:** headline wraps to **2 lines** (335×83 block) and the crown encloses the whole wrapped block (18, 249.6 → 357, 336.3), all four crown edges lit at 77 and all four border edges at 41, canvas re-measured to 750×2270, no horizontal overflow, no collision with the Now Hiring banner above or the financing banner below
- [x] **Froze a real mid-entrance frame at t=1000ms on the live hero** (swept the frame clock to locate it, since the sandbox throttles rAF and reports the tab hidden): both border heads sit at the SAME height on the left and right edges with gold trails behind them, and the crown pair is racing outward across the crown's top edge from its centre — the lockstep the brief asks for, visible in one frame
- [x] Fixed during verification: `onResize` deferred the re-measure into `requestAnimationFrame`, which never fires while the loop is stopped for a hidden tab or an off-screen hero — a resize in that window was silently dropped. It now invalidates the measurement and the next painted frame picks it up; `resume()` forces one too
- [x] Engineering discipline held: reuses the shared trustworthy-frame stall guard and warm-up rather than reimplementing them, no ResizeObserver (that surface stays at NowHiringBanner, locked by batch 22's test), IntersectionObserver + visibilitychange pause the loop, DPR capped at 2, and there are two fallbacks — sustained slow frames stop the motion and leave the settled lines drawn, and a missing 2D context renders CSS lines instead of a blank layer
- [x] Manus: pulled and checkpointed (af386ef9). Confirmed the entrance by clearing the `ldr_crown_seen` session flag and remounting, which is equivalent to a first visit: measured the symmetric two-head descent and the synced crown fill, then confirmed the flag flips to 1 and a same-session reload shows the completed geometry from frame 0. A true private-window first visit on a 60fps device is still worth a look by Peter, since the sandbox degrade cuts the settled motion short here

## Batch 26 — remove the /links arrival pop-up (reported by Peter)

- [x] Audited every overlay that can appear on /links. Exactly one modal is capable of appearing unprompted anywhere on the site: `ExitIntentModal`, mounted globally in App.tsx so it currently covers ALL routes including /links. Its copy is "Before you go / Want us to find your perfect Texas home?" with a Get Started CTA — matching the "asking about finding their Texas city" pop-up Peter saw. No other candidate exists: `WebsiteInquiryModal` is controlled and only opens from the footer credit click, there are no arrival/welcome/firstVisit/autoOpen patterns, no mount-time toasts, and no other role=dialog in app code
- [x] Scoped ExitIntentModal out of /links: it now reads the current route via wouter's `useLocation` and an exported `isExitIntentExcluded()` helper keyed on `EXIT_INTENT_EXCLUDED_PATHS = ["/links"]`. Three layers so nothing leaks — the mouseout listener is never armed on an excluded route (so no `exit_intent_show` event is even tracked), the render bails while excluded, and an effect force-closes the modal if a route change lands on /links while it happens to be open. Matching is exact-or-child (`/links` and `/links/x`) so a future `/linkspage` route would not be caught. Left active on every other page
- [x] Added `server/exitIntentLinksExclusion.test.ts` (10 assertions) locking the exclusion: /links and its children excluded, eight other routes still allowed, no prefix false-positives, listener bail-out present, render guard present, and the exclusion list stays length 1 so it can't silently widen
- [x] Verified live on lifestyledesignrealty.com/links (bundle index-dA1ADcPV.js): the page loads clean with zero dialogs on arrival. Went further than a passive check — cleared the once-per-session flag so the nudge would be fully eligible, then fired five genuine leave-intent mouseout events at a desktop 1280px fine-pointer viewport. Result: 0 dialogs, no "Before you go" copy anywhere, and the session flag stayed null, proving the listener is never armed rather than merely visually suppressed (so no phantom `exit_intent_show` analytics either). Also confirmed clean at 375px, matching Instagram traffic conditions
- [x] Verified the exclusion stays narrow: on a hard load of /team the nudge still fires correctly (dialog with aria-labelledby="exit-intent-title", "Before you go / Want us to find your perfect Texas home?") and sets the session flag. Also confirmed the route-change guard: with the modal open on another route, navigating to /links closes it immediately (1 dialog -> 0)
- [x] Reported to Peter where the modal mounts: `ExitIntentModal` is mounted once globally in `client/src/App.tsx` (line 114), so before this change it covered every route. It is not a per-page component and there is no separate homepage copy of it. Left active everywhere except /links, per instruction. Audit also confirmed no other unprompted overlay exists anywhere on the site

## Batch 27 — Crown Branch entrance speed tune (Peter)

- [x] CONTENT FIRST: added `CONTENT_REVEAL_MAX_MS = 200` as a hard ceiling on the reveal, and `contentRevealMs()` now returns `min(distance milestone, ceiling)`. The distance fraction is kept (0.4) so tiny paths still reveal even earlier, but on every real viewport the ceiling governs — reveal fires at 200ms flat instead of the old 1331ms desktop / 1474ms laptop. The fade itself dropped from 900ms to `CONTENT_FADE_MS = 420`, so content is fully readable by ~620ms while the lines keep drawing around it
- [x] FASTER DRAW: HEAD_SPEED 0.62 -> 1.8, a single shared constant, still distance-based and still consumed by every head (border pair, crown pair, branch birth, entrance duration). Nothing else in the timing model changed
- [x] Tightened the Home.tsx safety timer from 2500ms to 1200ms so the no-rAF backstop is proportionate to the faster entrance rather than leaving a 2.5s worst case
- [x] Confirmed untouched: RACER_SPEED (0.14) and the settled alphas, `shouldPlayEntrance()` session + reduced-motion gate and SESSION_KEY, the four reveal exits including the degrade path, and the crown-from-measured-headline derivation that handles the mobile two-line wrap
- [x] Measured the current timings before changing anything, with a sweep script over five real viewport sizes. At HEAD_SPEED 0.62 the entrance actually ran LONGER than the ~2s Peter estimated on desktop: 3327ms at 1280x839 and 3723ms at 1440x900 (mobile 1824ms), with content reveal not starting until 1331ms/1474ms. Distance-based timing means the constant has to satisfy the longest path, so the target window is set by the widest common laptop, not the average
- [x] Chose HEAD_SPEED 1.8: laptop 1440x900 lands at 1282ms and desktop 1280x839 at 1146ms, both inside the requested 1.1-1.3s. Tablet 964ms, mobile 628ms and small 547ms come in faster, which is correct for shorter paths and still reads as a drawn line rather than a flash (a 375px border head still takes ~250ms to reach the crown). 1.9-2.0 pushed desktop under 1.1s, and 1.5-1.7 left the laptop case above 1.3s
- [x] Keep untouched: verified by the existing suite, which still passes unchanged for racers, session gate, reduced motion, fallbacks and the mobile wrap
- [x] Updated the timing tests: replaced the old "reveals at 40% of the border entrance" assertion with a content-first contract (ceiling <= 250ms, reveal <= ceiling, reveal + fade <= 650ms, reveal still before entrance end), added a desktop window test pinning the total to 1000-1400ms, a mobile test proving shorter paths finish sooner yet still take >120ms to reach the crown, and a short-path test proving the distance milestone wins when it lands before the ceiling. Also updated the hero-wiring tests to assert the markup duration matches CONTENT_FADE_MS and that the backstop timer is between 2x the reveal ceiling and 1500ms, rather than hardcoding 900ms/2500ms
- [x] 460 tests passing, type-check clean
- [x] Pushed to GitHub main (a59bf9d) and checkpointed a59bf9d8, auto-published (live bundle index-BG9jxSE-.js)
- [x] Verified live on lifestyledesignrealty.com. Measured the deployed fade duration as exactly 0.42s (matching CONTENT_FADE_MS), and on a fresh mount with the session flag cleared the hero content began fading at ~354-387ms and reached full opacity at 521ms — inside the ~0.6s brief. Note the reveal reads slightly later than the 200ms constant because the sandbox browser runs rAF at ~33ms/frame and the route remount itself costs a few frames; on a 60fps device the reveal lands at the 200ms mark. Canvas lit-pixel count rose from 0 to 421 over the same window, confirming the line work draws around content that is already visible rather than gating it
