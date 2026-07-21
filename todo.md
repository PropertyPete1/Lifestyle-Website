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
