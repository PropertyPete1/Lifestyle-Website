# Builder Deals: adding every community automatically

How a community a builder reader finds on a builder's own site becomes a card on
`/deals`, and what keeps it private until it is ready.

## From discovery to live

1. A builder reader lists the builder's San Antonio area communities and calls
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

## Refresh cadence

Each builder page is checked daily by default. Admin, "Check each builder page
every (days)" (`catalogRefreshDays`, 1 to 30), slows that down if a builder's
site needs it. "Refresh due" in Admin follows the same setting.
