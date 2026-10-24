# Builder Deals: supplied source import

Some builders refuse our reader. Legend Homes (livelegendhomes.com) answers
HTTP 403 to any non-browser client (an AWS WAF rule), so its communities hold
`source_access_refused`. The reader is **not** changed to get around that.
Instead the owner's own browser agent (Manus) visits the builder's public pages
once a day and posts what it saw to our app. This document is the contract for
that agent.

The posted data goes through the **same pipeline and safety rules as a normal
read**: holds, sold sweeps, price-drop history, incentive parsing
(`parsePromotionalRate`, unchanged) and incentive holds, featured ranking,
private-name scrubbing and the digest e-mails.

Code: `server/dealsAdapters.supplied.ts` (schema and rules),
`server/dealsSuppliedStore.ts` (keys and storage), `server/dealsSuppliedImport.ts`
(the route), `server/dealsSync.ts` (`refreshCommunity` reads the stored import
for a builder that takes imports; `refreshSuppliedCommunities`). Migration
`drizzle/0023_supplied_import.sql`.

## How a builder goes live on imports

1. Apply migration 0023 (`pnpm db:push`), then deploy.
2. Admin, Builder Deals, **Supplied imports**: choose the builder (Legend Homes)
   and **Generate import key**. The key (`ldrimp_` + 43 characters) is shown
   **once**; only its SHA-256 is stored. Give it to the agent. **Regenerate**
   replaces it at once; **Revoke** removes it.
3. From the moment a key exists the builder is "supplied": its communities are
   never fetched again; each refresh reads the latest stored import instead. A
   community with no import yet holds `supplied_import_missing` (one e-mail).
   Revoking the key switches the builder back to being read from its site.
4. The communities must already exist in Admin, Communities (imports never
   create one), be active, not paused and **not in Manual mode** (a Manual
   community ignores imports and is reported as `skipped`). The Supplied imports
   section lists each community's page link (tap to copy) and its last import:
   give the agent exactly those links.
5. The agent posts. Each community it sends is refreshed before the response
   comes back; `source_access_refused` clears on the first good import.

The scheduled builder check (every 10 minutes from 4 AM to 10 PM Central) also
re-reads the stored import each day, so an agent that stops posting is noticed:
after 36 hours the community holds `supplied_import_stale` and the last good
data stays as it was.

## Endpoint

```
POST https://lifestyledesignrealty.com/api/deals/import
Authorization: Bearer ldrimp_...
Content-Type: application/json
```

- Body at most 2 MB (413 above that).
- At most 30 calls an hour per builder (429 with `Retry-After: 3600` above that;
  every authenticated call counts, valid or not). One call a day with every
  community is the intended use.
- 20 failed key checks an hour from one address get 429.
- The key and the payload are never logged.
- Send it from the agent's own code or terminal (curl, Python), not from a
  script inside the builder's page: the route sends no CORS headers, so a
  browser page on another site cannot call it.

## Payload

Strict: unknown fields anywhere are refused (400).

```ts
{
  builder: "Legend Homes",            // must be the builder the key belongs to (else 403)
  capturedAt: string,                 // ISO 8601 with offset, when the pages were read, e.g. "2026-10-21T13:05:00Z"
  communities: Array<{                // 1 to 50
    communityUrl: string,             // the community page exactly as listed in Admin (https, official host)
    pageComplete: boolean,            // true only if every home card was read (all pages, every "load more")
    homesShownCount: integer,         // homes for sale the page itself shows (its count, or the cards counted), sold excluded
    incentiveText?: string | null,    // the offer text as shown; null = the page shows no offer; omit = offer not looked at
    homes: Array<{                    // up to 500
      url: string,                    // the home's own page, https on the builder's site
      address: string,                // as shown, starting with the house number: "1234 Example Way, Cibolo, TX 78108"
      plan?: string | null,           // plan name
      price: number | null,           // whole dollars; null when the page shows none
      beds?: number | null,           // whole number
      baths?: number | null,          // 2.5 for two full and one half
      sqft?: number | null,           // whole number
      status: "available" | "under_construction" | "sold",
      moveIn?: "ready now" | "Month YYYY" | null,   // e.g. "December 2026"
      photos?: string[]               // optional, up to 40, https on the builder's site or image host (Legend: assets.livelegendhomes.com)
    }>
  }>
}
```

How it maps onto a reader's result (`DealAdapterResult`): each home becomes a
private home record (`sourceUrl` = `url`, `privateAddress` = `address`,
`privateName` = the street line, `privatePlanName` = `plan`). The status is the
reader's: `sold` is "Sold" (recorded as sold); `available` with `ready now`, or
with a month already past, is "Quick Move-In (Move-In Ready)"; a future month is
"Quick Move-In (Month YYYY)"; no move-in is "Quick Move-In". The offer text is
cleaned exactly as the Legend reader cleans an offer (links, phone numbers,
e-mail addresses and NMLS ids removed) and parsed by `parsePromotionalRate`.
`incentiveText` maps to the reader's "offer read" flag: a string or `null` means
the offer was looked at (`null` takes a scraped offer down, as a page without an
offer does); omitting it leaves the last offer to the lapse rule. Plans
(to-be-built) are not part of an import: a community read from imports shows its
move-in homes only, and plan rows left from an earlier read are swept like any
listing the page no longer shows.

## Rules (any failure holds that community; nothing from it is published or marked sold; the last good data stays live)

| Rule | Outcome |
| --- | --- |
| Key missing, wrong or revoked | 401, nothing stored |
| JSON invalid, unknown field, wrong type | 400 with the paths of the problems (never the values) |
| `builder` differs from the key's builder | 403 |
| `capturedAt` more than 10 minutes in the future | 400 `captured_at_in_future` |
| The same community twice in one payload | 400 `duplicate_community` |
| `communityUrl` not https on the builder's official host | community `rejected`, `unofficial_url` |
| No community with that page in Admin | community `rejected`, `unknown_community` (never created) |
| Older `capturedAt` than the import already stored | community `rejected`, `older_than_stored` |
| `pageComplete` false, or homes for sale sent differ from `homesShownCount` | hold `supplied_import_incomplete` |
| `capturedAt` more than 36 hours before the refresh | hold `supplied_import_stale` |
| Price outside 50,000 to 5,000,000 (or not whole dollars), beds outside 1 to 10 (or not whole), baths outside 1 to 10 or not in steps of 0.5, sqft outside 400 to 15,000 | hold `supplied_import_out_of_bounds` |
| Home link off the builder's site, the community page itself, or a link not under this community's page (a "nearby homes" card from another community), address without a house number and street, unreadable `moveIn`, an under-construction home "ready now", a photo off the builder's hosts | hold `supplied_import_invalid_home` |
| No homes for sale, unless the previous import (captured earlier) also had none: a list that failed to load must not sweep every home to sold | hold `supplied_import_incomplete` (a sold-out community publishes on its second empty import) |
| Two homes with the same link or the same street address | hold `supplied_import_duplicate_home` |
| Community not in the payload | untouched (no sold marking) |
| Offer that cannot be published (no APR, private text left, ...) | homes publish; the offer is held for "Accept this update", exactly as for a read |

A held community is e-mailed once (in the digest) with a plain-language line
for its reason; Admin shows the same wording.

## Response

200 when the import was processed (even if a community is held), 503 with
`Retry-After: 120` when another run was reading the builder at that moment (the
import is stored; post again). Body:

```json
{
  "ok": false,
  "builder": "Legend Homes",
  "capturedAt": "2026-10-21T13:05:00.000Z",
  "communities": [
    { "communityUrl": "https://www.livelegendhomes.com/communities/san-antonio/schertz-cibolo/guadalupe/cibolo/example-ranch", "status": "published", "reasons": [], "problems": [], "homesForSale": 2, "homesSold": 1, "homesShownCount": 2, "incentiveHold": null },
    { "communityUrl": "https://www.livelegendhomes.com/communities/san-antonio/new-braunfels-seguin/comal/new-braunfels/example-crossing", "status": "held", "reasons": ["supplied_import_out_of_bounds"], "problems": ["homes[3]: price 12000 is outside 50,000-5,000,000"], "homesForSale": 5, "homesSold": 0, "homesShownCount": 5, "incentiveHold": null }
  ]
}
```

`status` is `published`, `held` (stored; the community holds), `skipped`
(stored; the community is paused, archived or in Manual mode in Admin),
`rejected` (not stored) or `stored_not_processed` (503 case). `ok` is true only
when every community was published. `incentiveHold` is the community's offer
hold after this import, if any (it needs an admin's review, not a new import).

## Example payload

```json
{
  "builder": "Legend Homes",
  "capturedAt": "2026-10-21T13:05:00Z",
  "communities": [
    {
      "communityUrl": "https://www.livelegendhomes.com/communities/san-antonio/schertz-cibolo/guadalupe/cibolo/example-ranch",
      "pageComplete": true,
      "homesShownCount": 2,
      "incentiveText": "Open Door Deal. Get a 4.99% (5.27% APR) 30-year fixed FHA rate with 3.5% down payment on select move-in ready homes. Contracts must be signed by 12/31/2026 and close by 1/31/2027.",
      "homes": [
        {
          "url": "https://www.livelegendhomes.com/communities/san-antonio/schertz-cibolo/guadalupe/cibolo/example-ranch/quick-move-in-homes/1234-example-way-12",
          "address": "1234 Example Way, Cibolo, TX 78108",
          "plan": "Kerrville",
          "price": 329990,
          "beds": 4,
          "baths": 2.5,
          "sqft": 2105,
          "status": "available",
          "moveIn": "ready now",
          "photos": ["https://assets.livelegendhomes.com/legend-cms-prod-assets/image/example-front.jpg"]
        },
        {
          "url": "https://www.livelegendhomes.com/communities/san-antonio/schertz-cibolo/guadalupe/cibolo/example-ranch/quick-move-in-homes/1240-example-way-13",
          "address": "1240 Example Way, Cibolo, TX 78108",
          "plan": "Llano",
          "price": 354990,
          "beds": 4,
          "baths": 3,
          "sqft": 2410,
          "status": "under_construction",
          "moveIn": "December 2026"
        },
        {
          "url": "https://www.livelegendhomes.com/communities/san-antonio/schertz-cibolo/guadalupe/cibolo/example-ranch/quick-move-in-homes/1250-example-way-14",
          "address": "1250 Example Way, Cibolo, TX 78108",
          "plan": "Kerrville",
          "price": null,
          "status": "sold"
        }
      ]
    }
  ]
}
```

## Instruction for the owner's agent

> Once a day, open each Legend Homes community page from this list (exact links)
> in the browser: [paste the links from Admin, Supplied imports]. On each page,
> open the quick move-in / available homes list and load every home (every page,
> every "load more"). Record only this community's own homes: skip model homes
> and any "nearby" or "similar homes" cards from other communities. For each home card record: the home's page link, the full
> address as shown, the plan name, the price in whole dollars (null if none is
> shown), beds, baths (2.5 for two full and one half), square feet, the status
> (`available`, `under_construction` or `sold`) and the move-in wording as
> `ready now` or `Month YYYY` (null if none), and `photos`: every photo link of
> that home (up to 40, in the order the site shows them), exactly as served from
> `https://assets.livelegendhomes.com/...` (the `url` of each entry in the home's
> `images` list in the site's own data; never a floor plan). Note the number of homes for sale
> the page itself states (or the number of cards you counted), sold homes
> excluded, and set `pageComplete` to true only if you are sure you saw every
> card. Copy the community's offer banner text exactly as shown (null if there
> is none). Then send one POST to `https://lifestyledesignrealty.com/api/deals/import`
> with header `Authorization: Bearer <key>` and `Content-Type: application/json`,
> body exactly in the shape above with `capturedAt` the time you read the pages.
> Do not invent or estimate any value: leave an optional field out (or null)
> rather than guess. Read the response: report any community whose `status` is
> not `published`, with its `reasons` and `problems`. On 503, wait two minutes
> and send the same body again. Never send more than a few calls an hour.
