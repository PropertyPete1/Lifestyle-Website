# Builder Deals: agent client links

Lifestyle Design Realty agents share the Builder Deals list with their own
clients from `/deals/team`. This document is the operating reference for that
feature: who gets in, what each side sees, what fires in Follow Up Boss and by
email, and what to run when deploying it.

## Who is an agent

Every active row of the team allowlist (`deal_team_allowlist`): the nightly FUB
users mirror plus anyone added by hand in Admin, Builder Deals, Team allowlist.
An agent signs in exactly like a buyer: phone number, one code. Because the
number is on the allowlist the session is a `team` session and the verify
redirect lands on `/deals/team` instead of `/deals/mine`.

A team row without a FUB user id (a manual row) still gets the tools; the
contacts and tasks of that agent's clients are assigned to Peter in FUB until
the row carries a FUB user id. Agent tools say so on the page.

## What the agent sees

- The full list: builder name, community name and address, sales line, every
  available home with its address and plan name, and a link to the builder's
  own page for the community and for each home. Photos are the same
  session-bound renders as the buyer's.
- "Send homes to a client": client name (required), client mobile (optional,
  only used to pre-address the text), private note (optional). Creates a link,
  shows the suggested text message with "Text it" (opens Messages) and "Copy link".
- "Your clients": every link the agent made, its state (not opened / opened /
  verified with the client's access window / expired / turned off), the
  client's saved homes, tour and question requests, and the last time they
  looked at the list. The X turns a link off.

## What the client sees

The link is `/deals?c=<token>`. The landing and the gate name the agent
("Shared by Tiffany Agent") and skip the "are you a realtor" question: an
agent's client is working with an agent by definition. They verify their own
mobile number once. After that:

- the full list, with builder and community names, addresses and plan names
  (no builder page links);
- a Save heart on every home, Tour / Ask buttons as before;
- access for `clientLinkExpiryHours` (default 7 days, Settings) instead of the
  reel buyer's 24 hours. When it lapses, the same link renews it with one code
  while the link itself is valid (`clientLinkDays`, default 30).

Blocks still apply: an explicit admin block on the phone or device keeps the
client out. The "confirmed working with an agent" device block and the realtor
screening (known agents, FUB recruits, brokerage domains) do not apply to a
vouched-for client.

## What the agent hears about

| Event | FUB | Email |
| --- | --- | --- |
| Client verifies for the first time | Person created/updated through the usual lead event, assigned to the agent's FUB user, tagged `IG Builder Deals` + `Agent Client`, note names the agent | First-unlock alert to the owners **and the agent** |
| Client saves a home | Task (type Follow Up) assigned to the agent; the day's request note gets a "Saved:" line | "Tiffany Agent's client: Builder Deals: a buyer saved a home" to the owners and the agent |
| Client asks for a tour / asks a question | Task (Appointment) assigned to the agent; request note | Request email to the owners and the agent |
| Client looks at the list | Nightly activity note (views, requests, saves) | none |

Saving the same home again after an unsave does not notify twice. Team
sessions never write to FUB, so an agent saving homes on their own list only
records the mark.

Emails go through the Builder Deals transport (Resend when `RESEND_API_KEY`
and `RESEND_FROM_EMAIL` are set; otherwise the owner-only fallback, which does
not reach the agent).

## Admin

Admin, Builder Deals, "Agent client links": a read-only table of every link
(client, agent, state, opens, created, valid until). The token itself never
reaches admin. Settings gained "Agent client access (hours)" and "Agent client
link valid (days)".

## Data

- `deal_client_links`: the link (token in clear, agent team id, client name,
  optional phone, note, opened/verified timestamps, expiry, revocation).
- `deal_leads.agent_team_id`, `deal_leads.client_link_id`: set at verification.
- `deal_tour_requests.request_type` gained `save`, plus `removed_at`; the
  unique key is now (lead, home, Chicago day, type) so a save and a tour on the
  same home on the same day both go through.
- Source code for these leads is `agent`.

## Deploying

Migration `0018_agent_client_links.sql` must run before the new build serves
traffic: in the Manus sandbox, `pnpm db:push` (generate is a no-op, migrate
applies 0018), then restart the dev server / publish. The migration adds a
table and nullable columns, changes an enum by appending a value, and swaps
one unique index; it does not touch existing rows.

Smoke test after publish: verify with a team number, create a link for a test
number, open the link in a private window, verify with the test number and
`DEALS_TEST_OTP`, check the client's list shows names and addresses, save a
home, and confirm the agent's workspace shows the save (and, with full-pipeline
test mode on, the TEST-tagged FUB task and email).
