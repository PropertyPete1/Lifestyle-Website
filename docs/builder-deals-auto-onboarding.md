# Builder Deals: adding every community automatically

How a community a builder reader finds on a builder's own site becomes a card on
`/deals`, and what keeps it private until it is ready.

## Finding communities

Every Monday at 5 AM Central (and from Admin, Communities, "Find new
communities"), `runCommunityDiscovery()` (`server/dealsDiscovery.ts`) reads each
builder's own sitemap for its San Antonio market community pages, one page at a
time, and takes the community's schema.org business record from each page:
name, sales address and phone (and a price range when there is one).

- Only pages on the builder's own host are read; a sitemap pointing elsewhere
  stops that builder's run.
- Communities more than 45 miles from downtown (San Marcos, for example) are
  skipped. The page's coordinates are used for that check only, never stored.
  A record without coordinates, from a listing or a page, is skipped too:
  nothing is added on faith. A page with no business record (only a featured
  home's residence record) has no community on it.
- A builder whose sitemap cannot be read adds nothing that week and is named in
  the email; the other builders carry on. So does a builder whose onboarding
  fails part-way (its lease is released all the same).
- Each builder's pages are read under that builder's lease, the same one the
  catalog checks and "Refresh now" take, so a builder's site never sees two
  streams of requests at once. Discovery waits up to 20 minutes for a busy
  lease, then skips that builder for the run ("builder_busy" in the email).
- The run goes to the background and holds one claim across every server (a
  `deal_job_runs` row, `builder-deals-discovery-run`, carrying the run's token);
  a second start while it is in flight is refused, a run that died is taken
  over after three hours, and a run that was taken over cannot close the
  taker's row.
- Discovery never removes a community.
- When something new is added, the sync recipients get one email listing it.

Builders with discovery today: Chesmar, M/I Homes, D.R. Horton, Pulte, Centex,
Del Webb, First America Homes, Coventry Homes, Davidson Homes, Highland Homes,
Century Communities, KB Home, Toll Brothers, David Weekley Homes, Ashton Woods, LGI
Homes, Sitterle Homes and Scott Felder Homes
(Perry Homes has a reader; its communities come from the research list). A builder whose listing carries the community's record (PulteGroup, Toll Brothers, Scott Felder) is
added without reading a page; one whose listing is a map of pins (Ashton Woods) has
each page read for its address, and the page's record takes the pin's coordinates. Each new builder
gets a reader (its community page format) and a discovery entry (its sitemap,
or its own market listing when the sitemap is unusable, plus the community URL
pattern).

## From discovery to live

1. Discovery (or a future builder reader) calls
   `onboardDiscoveredCommunities()` (`server/dealsOnboarding.ts`).
2. Each new community (matched by its source URL) is inserted with
   `active = false` and `awaiting_first_sync = true`. Close-outs, unnamed rows
   and non-HTTPS links are skipped. A community already in the table is left
   alone, so running discovery again is safe.
3. Its ZIP code centroid is looked up, and the area label and headline are set
   from it (see below).
4. The daily sync picks up awaiting rows like active ones. On the first clean
   pull of its homes (no community hold; an incentive hold only keeps the offer
   off), the headline is rebuilt from what the pull found and the community
   goes live (`active = true`, `awaiting_first_sync = false`), unless an admin
   paused it, switched it to manual, or turned it on or off by hand in the
   meantime. A label an admin rewrote is never regenerated.
5. A first pull that fails leaves it hidden; the next run tries again.

Admin shows these rows with "Added automatically, goes live after its first
clean update". "Refresh now" works on them. Turning one on or off by hand
(Restore or Remove) is final: the first sync no longer decides it.

## What a generated label can say

Public labels come from coarse, generic words only (`shared/dealsArea.ts`), so a
label can never carry a builder, community, street or plan name.

**Area** (from the ZIP code centroid, never the community itself):

| Distance from downtown | Label |
| --- | --- |
| Up to 4 miles | Central San Antonio |
| Up to 22 miles | The side of town, e.g. Southeast San Antonio |
| Farther, in a larger town | The town: New Braunfels, Seguin, Boerne, Floresville, Pleasanton, Bulverde, Spring Branch, Canyon Lake |
| Farther, anywhere else | The direction, e.g. South of San Antonio |

A suburb inside the metro (Converse, Schertz) gets the side of town, not its
own name, because its name would point at too few communities.

**Headline**: up to two phrases from a fixed list, joined with "and": lot size
(Acre Lots, Half-Acre Lots, Large Lots), amenities (Lakes, Resort-Style Pool,
Trails, Golf, Hill Country Views, Parks), a price band ("From the $300s",
"Over $1M"), or "Move-In Ready Homes". With nothing to go on, "New Homes".

## Private names start in the scrub list

Every new community's scrub list starts with the builder's known aliases, the
community's name, and the street from its sales address, so the first pull is
already checked against them. The reel code is a private `auto-` hash until
Peter films the community and adds its reel.

## Refresh cadence and the daily email

Each builder page is checked daily by default. Admin, "Check each builder page
every (days)" (`catalogRefreshDays`, 1 to 30), slows that down if a builder's
site needs it. "Refresh due" in Admin follows the same setting.

The scheduled check runs every 10 minutes from 4 AM to 10 PM Central
(`refreshDueCommunitiesBatch`). Each call:

- takes the communities that are due, live ones first and oldest data first;
- checks up to four builders side by side, one community at a time per builder,
  so a builder's site sees one stream of requests per call;
- stops starting new communities after about four minutes; the next call picks
  up the rest;
- holds a lease per builder while reading its pages (so an overlapping call,
  Refresh now, or discovery waits instead of opening a second stream), claims
  each community before checking it (re-reading it, so a community paused or
  archived since the call started is left alone), and does not retry a failed
  one for 90 minutes. A lease carries a token: only the holder releases it, it
  is renewed as pages are read (at most once a minute, so a 150-page community
  never looks dead), and only a lease untouched for two hours is treated as
  dead and taken over.
- records a community whose check itself failed (a network error, a page the
  reader could not parse) as a `refresh_failed` catalog hold, so Admin sees it
  and the digest names it, instead of the failure passing unnoticed.

Communities whose builder has no reader yet are skipped quietly: no hold, no
email.

Each community's changes and new holds are written to the digest the moment
its check finishes. One morning email goes out once every due community has
been tried that day and nothing is still being read, or at 10 AM at the
latest. Anything found later in the day (including incentives the 6:15 PM job
retires) goes out in one 7 PM follow-up, only if there is something new. When a
slot has both changes and holds they go in one email ("Builder Deals update: N
changes, M holds", holds first). The entries are marked sent only after the
email went out, so a failed send is retried by the next call. "Refresh now" in
Admin still emails right away.

## Browsing every community

With every community on the page, both lists change shape once they are long:

- **Order:** the community whose reel brought the visitor (`?src=` on the
  landing page, the buyer's source code on their list) comes first, then the
  communities with Peter's reels, then the rest.
- **Reels:** only the first reel loads by itself; every other reel shows a
  "Watch the video tour" cover and loads when tapped, so the page never opens
  dozens of Instagram embeds.
- **Landing page (more than 6 communities):** filters for area, max price,
  move-in ready, builder rate offer and half-acre+ lots, 12 cards at a time
  with "Show more".
- **Private list (more than 3 communities):** the same filters plus bedrooms,
  applied to homes; communities show as rows with a short summary ("From
  $389,990 · 2 move-in ready") and open on tap. The buyer's reel community
  starts open. A Best Deals tap opens that home's community (clearing filters
  that hide it) and scrolls to the home.
- Short lists (3 communities or fewer) look exactly as before.

## The research list

`research/sa-communities.csv` is the master list of every builder community in
the San Antonio metro (536 rows, 51 builders, read from the builders' own sites
on 2026-10-19). Admin, Communities, "Load research list" imports it through the
same onboarding as discovery: every community not already in the table is
added hidden. Running it again adds only what is new. A community whose builder
has no reader yet shows "Waiting for a <builder> reader" in Admin and is never
checked, held or emailed about until a reader exists.
