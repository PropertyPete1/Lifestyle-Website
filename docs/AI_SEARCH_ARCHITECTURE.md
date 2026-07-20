# How the AI Natural-Language Search Works

*Plain-language explanation, written July 2026. Code lives in `server/aiSearch.ts`.*

## (a) Where the listing data lives

Every listing the AI search looks through is stored in this website's own **MySQL
database**, in a table called `listings`. Right now that table holds ~40 placeholder
listings we seeded by hand (via `seed-listings.mjs`). Each row is one property with
structured fields: city, price, beds, baths, square feet, pool (yes/no), new
construction (yes/no), number of stories, primary-bedroom-on-first-floor (yes/no),
property type, status, photos, and map coordinates.

The search never leaves our own database — it does not call Zillow, the MLS, or any
external listing service today.

## (b) How plain English becomes search filters

It is a **two-layer system: an LLM call first, with a rule-based backup**.

1. **LLM extraction (primary).** When a visitor types something like *"4 bedroom
   under $600k new construction with primary bedroom on first floor"*, the server
   sends that one sentence to a large language model (via the platform's built-in
   LLM API) with strict instructions to return **only a structured JSON object** —
   e.g. `{ minBeds: 4, maxPrice: 600000, isNewConstruction: true, primaryBedDown: true }`.
   The model never writes the answer shown to visitors and never touches the
   listings; it only translates English into filters. This is one API call per
   search, typically ~1 second.

2. **Rule-based fallback (backup).** If the LLM is ever slow, down, or returns
   something unusable, a regex-based parser takes over. It recognizes the common
   patterns ("under $500k", "3 bed", "pool", "single story", "primary bedroom
   downstairs", city names) so search keeps working — slightly less flexible, but
   never broken.

3. **Matching.** The extracted filters are then applied to the listings table with
   ordinary comparisons (price <= maxPrice, beds >= minBeds, etc.). The matched
   homes are returned with the criteria chips shown above the results.

## (c) Will this survive the switch to real IDX/MLS data?

**Yes — unchanged.** The architecture is deliberately data-source-agnostic:

- The matching logic operates on the *shape* of a listing (price, beds, city, ...),
  not on where the listing came from. The `listings` table already has a `source`
  column (`cms` today, `idx` in Phase 2) plus reserved fields for broker
  attribution, MLS disclaimers, and feed-update timestamps.
- When the IDX/MLS feed is connected, it writes rows into the **same table with the
  same fields**. The AI extraction step doesn't change at all (it never knew about
  the data source), and the matcher runs the same comparisons over real inventory
  instead of placeholders.
- The only Phase 2 work is the feed itself (ingesting and refreshing MLS rows) and
  displaying the required MLS attribution/disclaimer fields — the search pipeline
  needs zero rework.

## Independence from New Construction Search

The AI search is a complete, self-contained experience on this site, ending in its
own results screen ("X homes match your search"). The New Construction Search
(New Home Buddy) is a plain external link with no handoff, pre-fill, or parameters —
the two features share nothing.
