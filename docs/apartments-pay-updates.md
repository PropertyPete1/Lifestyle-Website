# Apartment pay updates (keyed web address)

Not live yet: the apartment site is on the `apartment-locator` branch and its
database tables (migration 0029) are not applied anywhere.

One web address takes "what a community pays locators" from an outside tool
and updates the pay every locator sees on /apartments/team. It changes pay and
nothing else, never adds a community, and never guesses which community a line
means.

## Call

    POST https://lifestyledesignrealty.com/api/apartments/pay
    Authorization: Bearer ldrapt_...        (Admin makes the key; shown once)
    Content-Type: application/json

    { "updates": [
      { "name": "Community name", "address": "100 Street Rd, San Antonio, TX 78216",
        "sendPercent": 50, "escortPercent": 100, "flatFee": null,
        "bonusAmount": 250, "bonusNote": "Look and lease", "bonusExpiresOn": "2026-12-31",
        "confirmedOn": "2026-11-18" }
    ] }

- `name` and `confirmedOn` (YYYY-MM-DD, today or earlier) are required, plus at
  least one pay figure. Percent is of one month's rent (100 = one month).
- Leave a figure out to keep the stored one; send `null` to clear it.
- Send the `address` whenever you have it: it is what tells apart two
  communities with the same name.
- Up to 1,000 lines a call, 30 calls an hour. No other field is accepted.

## Answer

    { "ok": true, "updated": 41, "unchanged": 310, "skipped": 0, "notApplied": [] }

`notApplied` lists each line that was not used, with why:
`no_community_with_this_name`, `more_than_one_community_matches_send_the_address`,
`name_matches_but_address_does_not`, a line older than the stored pay, a
community named twice in one call, or a line that is not valid. Fix those lines
and send them again; sending the same line twice changes nothing.

401 = wrong or missing key. 429 = too many calls this hour. 400 = the body is
not `{ "updates": [...] }`.

## Key

Admin only: `apartments.admin.newPayKey` makes a key (any earlier one stops
working), `apartments.admin.revokePayKey` turns it off, and
`apartments.admin.payKey` shows whether one exists and when it was last used.
Only a hash of the key is stored.
