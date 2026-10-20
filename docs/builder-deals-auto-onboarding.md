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
- A builder whose sitemap cannot be read adds nothing that week and is named in
  the email; the other builders carry on.
- Discovery never removes a community.
- When something new is added, the sync recipients get one email listing it.

Builders with discovery today: Chesmar and M/I Homes. Each new builder gets a
reader (its community page format) and a discovery entry (its sitemap and
community URL pattern).

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
   pull (homes, photos, incentive all read without a hold), the headline is
   rebuilt from what the pull found and the community goes live
   (`active = true`, `awaiting_first_sync = false`).
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
| Farther, in a larger town | The town: New Braunfels, Seguin, Boerne, Castroville, Floresville, Pleasanton, Bulverde, Spring Branch, Canyon Lake, Lytle, Bandera |
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
- claims each community before checking it, so two overlapping calls never
  check the same one, and does not retry a failed one for 90 minutes.

Communities whose builder has no reader yet are skipped quietly: no hold, no
email.

Changes and new holds go into one morning email instead of one per call. It is
sent once every due community has been tried that day, or at 10 AM at the
latest. Anything found later in the day goes out in one 6 PM follow-up, only if
there is something new. "Refresh now" in Admin still emails right away.

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
