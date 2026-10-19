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

The FUB mirror writes one row per phone number, so one agent can have several
rows. Everything keyed to an agent (their links, their clients, whether they
are still active) is resolved across every row that carries the same FUB user
id: an agent who changes their mobile number in FUB keeps their links and
clients, and an agent stays active while any of their rows is active.

A team row without a FUB user id (a manual row) still gets the tools; the
contacts and tasks of that agent's clients are assigned to Peter in FUB until
the row carries a FUB user id. Agent tools say so on the page.

When an agent leaves the team (every row inactive), their links stop working,
their clients drop back to the regular buyer view (no builder names or
addresses) on their next page load, and new saves and requests go to Peter.

## What the agent sees

- The full list ("Team view"): builder name, community name and address, the
  builder's sales line, every available home with its address and plan name,
  and a link to the builder's own page for the community and for each home.
  Photos are the same session-bound renders as the buyer's. Sales lines and
  builder page links are for the team only.
- "Send the list to a client": client name (required), client mobile
  (recommended), private note (optional). Creates a link, shows the suggested
  text message with "Text it" (opens Messages) and "Copy link". The list is the
  week's deals, not hand-picked homes, and the suggested text says so.
- "Your clients": every link the agent made, its state (not opened / opened /
  verified with the client's access window / access lapsed / expired / turned
  off / moved to another agent's link), the client's saved homes, tour and
  question requests, and the last time they looked at the list. Activity shows
  only while the client is on this agent's link, and only from the moment they
  connected through it. Turning a link off asks for confirmation first.

## What the client sees

The link is `/deals?c=<token>`. The landing and the gate name the agent
("Shared by Tiffany Agent", "Tiffany Agent shared this week's new-build deals
with you") and skip the "are you a realtor" question: an agent's client is
working with an agent by definition. They verify their own mobile number once.
After that:

- the full list, with builder and community names, addresses and plan names
  (no sales lines, no builder page links);
- a Save button on every home, Tour / Ask buttons as before;
- access for `clientLinkExpiryHours` (default 7 days, Settings) instead of the
  reel buyer's 24 hours. When it lapses, the same link renews it with one code.
  The link keeps the token through every redirect (code errors, an expired
  session on `/deals/mine`), and the browser tab remembers it, so a client who
  comes back to `/deals` in the same tab is still on their agent's link.

### One link, one client

A link belongs to one mobile number: the number the agent typed, or, when the
agent left it blank, the first number that verifies through it. Another number
trying the same link is refused ("This link was sent for a different mobile
number. Ask Tiffany Agent to send a new link to this number"), so a forwarded
link does not hand out the full list. The binding is checked again when the
code is entered, so a link turned off between "send code" and "enter code"
does not get through.

An unused link (nobody has verified through it) stops working after
`clientLinkDays` (default 30). A bound link keeps working for its client until
the agent turns it off or leaves the team. A dead link shows "This link has
expired. Ask Tiffany Agent to send you a new one." instead of the gate.

A team member who opens an agent's link with their own number is signed in as
team, and their open is not counted on the link.

### A client who already had a list

Someone who unlocked the list from a reel and later gets an agent's link sees
"Connect your list with Tiffany Agent?" before anything changes. Connecting
moves them to the full view and the longer access, records the agent on their
lead, adds a note to their FUB contact naming the agent, and emails the agent
(once per link). Their FUB contact keeps its current assignment; reassigning
is done in FUB.

Blocks still apply: an explicit admin block on the phone or device keeps the
client out. The "confirmed working with an agent" device block and the realtor
screening (known agents, FUB recruits, brokerage domains) do not apply to a
vouched-for client.

## What the agent hears about

| Event | FUB | Email |
| --- | --- | --- |
| Client verifies for the first time | Person created/updated through the usual lead event, assigned to the agent's FUB user, tagged `IG Builder Deals` + `Agent Client`, note names the agent | First-unlock alert to the owners **and the agent**, saying who the contact is actually assigned to |
| Existing buyer connects through a link | Note on the existing contact naming the agent; assignment unchanged | "Builder Deals: Tiffany Agent's client is on their list" to the owners and the agent |
| Client saves a home | Its own task, "Builder Deals saved home: …" (type Follow Up), assigned to the agent; the day's request note gets a "Saved:" line | "Tiffany Agent's client: Builder Deals: a buyer saved a home" to the owners and the agent |
| Client asks for a tour / asks a question | Task (Appointment) assigned to the agent; request note | Request email to the owners and the agent |
| Client looks at the list | Nightly activity note (views, requests, saves) | none |

Saves and tour requests never share a FUB task. Saving the same home again
after an unsave does not notify twice, and a home that was unsaved before the
task went out is left off it. Team sessions never write to FUB or send email,
so an agent saving homes on their own list only records the mark.

The first-unlock alert's assignment line is truthful about what happened: "The
FUB contact is assigned to Tiffany Agent", "Tiffany Agent has no Follow Up Boss
user yet, so the FUB contact is assigned to Peter", "The FUB contact was
already assigned to Jane Agent; the assignment was left alone", or "not synced
yet".

Emails go through the Builder Deals transport (Resend when `RESEND_API_KEY`
and `RESEND_FROM_EMAIL` are set; otherwise the owner-only fallback, which does
not reach the agent).

## Admin

Admin, Builder Deals, "Agent client links": a read-only table of every link
(client, agent, state, opens, created, valid until). The token itself never
reaches admin. Settings gained "Agent client access (hours)" and "Agent client
link valid (days)". A lead's requests label saves as "Saved" or "Saved, then
removed", and tour counts leave saves out.

## Data

- `deal_client_links`: the link (token in clear, agent team id, client name,
  optional phone, note, opened/verified timestamps, expiry, revocation).
- `deal_leads.agent_team_id`, `deal_leads.client_link_id`: set at verification
  (or when an existing buyer connects). A link attaches to one lead only.
- `deal_tour_requests.request_type` gained `save`, plus `removed_at`; the
  unique key is now (lead, home, Chicago day, type) so a save and a tour on the
  same home on the same day both go through.
- Source code for these leads is `agent`; link clients never carry profile
  screening flags.

## Deploying

Migration `0018_agent_client_links.sql` must run before the new build serves
traffic: in the Manus sandbox, `pnpm db:push` (generate is a no-op, migrate
applies 0018), then restart the dev server / publish. The migration adds a
table and nullable columns, changes an enum by appending a value, and swaps
one unique index (the new one is added before the old one is dropped, so the
table always has a unique key); it does not touch existing rows.

Smoke test after publish: verify with a team number, create a link for a test
number, open the link in a private window, verify with the test number and
`DEALS_TEST_OTP`, check the client's list shows names and addresses, save a
home, and confirm the agent's workspace shows the save (and, with full-pipeline
test mode on, the TEST-tagged FUB task and email). Then open the same link with
a second test number and confirm it is refused, and turn the link off from the
workspace and confirm the client's next load shows the regular buyer view.
