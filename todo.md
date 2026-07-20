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
- [x] Seed data: 6 testimonials, team (Peter Allen Broker/Owner, Steven, Stefanie, Abby, Irma, Laila, Tiffany), stats (63 sales, $26M, $200K–$1.7M, $424.4K), neighborhoods (Alamo Ranch, Kyle, Boerne + cities), bio links, sample listings

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
