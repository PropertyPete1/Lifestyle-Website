# Builder Deals: Best Deals, area maps, and what an expired buyer sees

Operating reference for three pieces of the `/deals` page.

## Best Deals

A strip near the top of the landing page and of the private list ranks every
available home across every active, unpaused community.

**The number.** Each home gets an estimated monthly principal and interest on a
30-year loan:

- With the community's live builder offer: the offer's rate and its stated down
  payment. For a buydown, the payment uses the long-term rate that follows the
  first-year rate, and the strip shows both ("3.99% first year, then 5.99%").
- Without a usable offer: the Admin market rate (`paymentMarketRate`, default
  7.4%, Freddie Mac's mid-October 2026 average) and the Admin default down
  payment (`paymentDownPercent`, default 5%).

Taxes, insurance and HOA are not included, and the strip says so.

**The winners.**

- Lowest payment: the three lowest, from three different communities.
- Best builder rate: the lowest long-term rate among the builder offers.
- Big lots: the cheapest homes on half an acre or more (read from the lot size
  or the community's lot-size text and public label), one per community.

A community with move-in-ready homes competes on those; plan prices stand in
only when it has none. Builders listed in Admin, "Builders never featured in
Best Deals" (default Lennar), are never ranked but stay listed.

**Who sees what.**

| Viewer | What a featured deal carries |
| --- | --- |
| Landing page (no sign-up) | Public label, area, price, beds, sq ft, payment, rate. Tapping opens the gate. |
| Reel buyer's private list | The same, scrubbed like the catalog, plus the card handle: tapping jumps to the home. |
| Team and agent clients | Plus the community name and the address or plan. |

A deal is only shown on the private list if its home's card is on that list.

## Area maps

Every community with a ZIP code centroid gets a map right under its reel. The
map is centered on the ZIP code's center, never the community, and shows a
shaded circle with no pin.

| Where | Circle | Setting |
| --- | --- | --- |
| Public landing card | about 8 miles | `publicAreaMapRadiusMiles` |
| Private list (after sign-up) | about 5 miles | `areaMapRadiusMiles` |

The zoom follows the radius so the circle always fits. The public image is
served from `/deals/maps/:id.png` without a session and may be cached for an
hour; the private one stays behind the session check at
`/deals/mine/maps/:id.png`. The exact address comes from an agent.

## The sign-up box and an expired list

The Instagram gate says: "These deals are for buyers who want to work with
Lifestyle Design Realty. Add your number to see every home, photo and incentive,
and one of our agents will reach out to help you find your home."

When a reel buyer's 24 hours are up, the screen says "Your list has expired.
Comment HOME on one of our videos again, or reach out to us so we can help you
find your home," with the Instagram account and "Call or text" the text line.
There is no self-serve way back in from that screen.

A buyer's session cookie is kept 30 days past their access (it unlocks nothing),
so a bookmark or history visit lands on that screen. A visit through a DM link
(`?src=`) still opens the gate. Agent clients go back through their agent's
link instead. Team sessions end with their access.
