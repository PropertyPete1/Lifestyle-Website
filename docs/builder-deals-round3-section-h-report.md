# Builder Deals — Round 3 Section H Report

**Review branch:** `builder-deals-preview`  
**Current report revision:** included in the latest `builder-deals-preview` commit
**Production checkpoint / deployment / public publication:** **none**. This report concerns only the private review branch and the sandbox review server.

## Current validation evidence

- `npx tsc --noEmit` passed on the review branch after the current source changes.
- Full Vitest with `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY`, `FUB_API_KEY`, all Twilio variables, and `RESEND_API_KEY` deliberately removed: **57 files passed, 1 explicit runtime-target suite skipped; 662 tests passed, 5 skipped (667 total)**. The skipped runtime tests require an explicitly supplied browser target; no skip is a success exit code.
- 375px real-browser **synthetic-fixture** transcript passed: pending-code reload (one start only), fixture exchange, active-session bypass, other-device rejection, gallery controls/missing-map fallback, and team-preview request fencing. It makes no DB, CRM, OTP, or real-session writes.
- Official-source reachability from the review runtime environment: **www.mihomes.com — HTTP 200, 216,729 bytes; www.chesmar.com — HTTP 200, 60,789 bytes**. An admin-only `testCommunitySource` diagnostic was added; it accepts only an existing configured community ID and does not accept arbitrary URLs.
- Current private catalog data: Chesmar has **10 To Be Built cards**; M/I has **15 quick move-in cards and 16 To Be Built cards**. The two seeded rate records are the reviewed Chesmar 4.999% / 5.737% APR card and M/I 4.25% first-year / 5.25% thereafter / 6.051% APR card; they are stored only after the required loan terms are present.
- The authorized `notifyOwner` test alert, titled **“Builder Deals test alert,”** completed successfully at `2026-10-18T22:29:00Z`. It contained no buyer data or credentials.

## A. Crash, security, and funnel bugs

| Item | Status | Final status / reason |
|---|---|---|
| A1 | **DONE** | Phone/IP attempt reservations use normalized phone/IP keys; code-send events retain the indexed phone field and tests cover the phone cap plus the separate test-number cap. |
| A2 | **DONE** | Completion locks the pending row in a transaction; duplicate phone insertion re-reads the winning lead instead of surfacing an Express error. Async route wrappers return controlled errors. |
| A3 | **DONE** | Pending verification state resumes the code view without a second send; the browser fixture asserts it. |
| A4 | **DONE** | CSP allows only the required Google Fonts and Instagram origins while private routes retain no-store/noindex/frame-deny headers. |
| A5 | **DONE** | The Instagram wrapper ref detects a mounted iframe; fallback occurs only if the wrapper never receives an iframe. |
| A6 | **DONE** | Wrong-code, expired, blocked, and cookie-blocked responses render server guidance instead of a generic blank gate. |
| A7 | **DONE** | Central-time helpers are shared by the service, request, and scheduler paths; threshold notification claiming is atomic. |
| A8 | **DONE (implementation)** | Twilio attempt outcomes record terminal API failures and evaluate three consecutive failures / elevated-error-rate alert thresholds. No intentional live Twilio outage was created. |
| A9 | **DONE** | Exchange and session token kinds are isolated; exchange replay is device-bound and pre-existing rows default to `exchange` (review-preview sessions therefore require re-verification after migration). |
| A10 | **DONE** | Gate submissions are reserved before any external screening or CRM write. |
| A11 | **DONE** | Configured test-team and team identities are evaluated before agent blocking; team sessions receive a non-buyer preview. |
| A12 | **DONE (implementation)** | The ordered classification includes self-declaration, team/test precedence, identity blocklist, FUB/recruiter data, brokerage domains, configured handle/name keywords, TREC, then deferred FUB outcomes. FUB annotation is best-effort and cannot alter a completed buyer response. |
| A13 | **DONE** | Handle and Google-profile-name keyword screening use token boundaries, avoiding substring false positives. |
| A14 | **DONE** | A second verified phone using an existing forwarded-DM handle is persisted with a null handle, preventing watermark/profile collision. |
| A15 | **DONE** | Consent copy, timestamp, IP context, and a Continue event are retained through verification. |
| A16 | **DONE** | IPv6 addresses normalize to their real `/64` key before rate limiting. |
| A17 | **DONE** | Rate-limit/blocked/expired paths include the configured text guidance; start success keeps the server-provided display phone; APR values are stored as numbers and labeled once. |
| A18 | **DONE (implementation)** | Listing/community view events dedupe per lead/community/hour; daily activity work is queued through the durable CRM job path. |
| A19 | **DONE** | The 375px browser fixture asserts document `scrollWidth` and every relevant card/input/gallery width; page/card shells use `min-w-0` and overflow containment. |
| A20 | **DONE** | Team preview suppresses tour/ask controls client-side and `requestHome` rejects team sessions server-side. |

## B. FUB, alerts, schedules, team, known agents, and TREC

| Item | Status | Final status / reason |
|---|---|---|
| B1 | **DONE** | Startup idempotently reconciles every Builder Deals heartbeat definition and callback payload. Scheduler jobs use hour-wide Central-time predicates and daily `once` leases. |
| B2 | **DONE (implementation)** | Recipient-aware alerts support immediate/hourly-digest policy, Resend delivery logging, and `notifyOwner` fallback. A real owner fallback test was authorized and completed; no Resend credential is configured for a second-recipient delivery test. |
| B3 | **DONE** | Durable CRM jobs use leased rows, stale-lease recovery, bounded backoff, occurrence-specific reverify markers, and re-read payloads before completion. |
| B4 | **DONE** | CRM writes preserve existing phone/email object metadata, normalize comparison values, union tags, and use opaque ownership markers. |
| B5 | **DONE (implementation)** | FUB user paging continues until an empty page, then caches exact allowed-email matches. A real redacted response-shape probe was run earlier; IDs/emails were not retained in this report. |
| B6 | **DONE (implementation)** | Team allowlist sync mirrors active FUB users, supports multiple phones, and applies reverse cascades/revocations for removed identities. |
| B7 | **DONE (implementation)** | Block, unblock, promotion, and removal operations cascade to links/records consistently; manual identity suppression is retained to avoid re-importing a deliberately removed record. |
| B8 | **DONE (implementation)** | Known-agent sync accepts configured tags/sources, pages FUB, observes five skip/suppression lists, and normalizes phone/email/name identity. |
| B9 | **DONE (implementation)** | The protected health report covers source freshness, incentives/holds, photo queue, FUB jobs, TREC age, verification caps, Twilio availability, and email-delivery state; Monday’s report composes the seven checks. |
| B10 | **DONE** | Tour/ask persists first and schedules a Chicago-day task/note/alert; failures do not block the visitor response. |
| B11 | **DONE (with documented API constraint)** | Every externally created ID is recorded in `deal_fub_records`. Cleanup deletes people created by Builder Deals (thereby removing their events); for found people it removes only Builder Deals notes/tasks and strips the TEST tag. FUB offers no event-delete endpoint, so no event-delete call is attempted. |
| B12 | **DONE (implementation)** | TREC uses a streamed cached official import, current-import isolation, distinct type/status summaries, test-only fake rows outside production, and import-age health reporting. |
| B13 | **NOT DONE — configuration limitation** | Recipient addresses are admin-configured and seeded for Peter/Steven. Without `RESEND_API_KEY`, fallback can only reach the project owner through `notifyOwner`; the authorized test proved that owner fallback, not delivery to Steven. Add `RESEND_API_KEY` to prove the explicit multi-recipient route. |

## C. Adapters, sync, and incentives

| Item | Status | Final status / reason |
|---|---|---|
| C1 | **DONE** | Catalog candidate runs at 6:00 AM Central, but calls official sources only if an active, non-manual community is at least three days stale. The 6:15 PM job is a no-network lapse/expiry pass. |
| C2 | **DONE (implementation)** | Held/manual/accepted/dismissed incentive states persist; dated expiry and configurable undated lapse retire stale cards before later official refresh. |
| C3 | **DONE (implementation)** | Public incentive text is scrubbed against categorized private terms before persistence; residual private text holds the community rather than publishing. |
| C4 | **DONE (implementation)** | M/I and Chesmar adapters use explicit official hosts, promotion guards, dates/terms parsing, and failure holds. Live host reachability is recorded above. |
| C5 | **DONE (implementation)** | Sitemap/detail limits, declared M/I pagination, source-key normalization, and incomplete-inventory holds prevent destructive catalog inference. |
| C6 | **DONE (implementation)** | Price history records real old prices only; current prior-price badge derives from observed history without manufacture. |
| C7 | **DONE (implementation)** | M/I complete discovery may mark missing official QMI sold; incomplete Chesmar discovery cannot. Reappearing keys reactivate rather than duplicate. |
| C8 | **DONE** | If no QMI is confirmed, buyers receive only To Be Built cards; stale QMI cards are not inferred available. |
| C9 | **DONE** | Canonical source/incentive keys strip trailing punctuation and preserve legacy convergence. |
| C10 | **DONE (implementation)** | Categorized builder/lender/community scrub lists are editable in protected Admin and applied to every buyer-facing response. |
| C11 | **NOT DONE — launch scope** | The branch supports persisted, admin-managed launch communities, but the official automated sync remains intentionally restricted to the reviewed M/I/Chesmar configurations rather than arbitrary new builder mappings. |
| C12 | **NOT DONE — launch scope** | The protected operator diagnostic exists, but the background worker deliberately refreshes the reviewed catalog as a bounded batch rather than exposing unbounded per-community scraping. |
| C13 | **DONE** | Runtime source probe results are above, and an admin-only configured-community test-fetch procedure is on the branch. |
| C14 | **DONE (implementation)** | Official redirect/host handling and gallery extraction are guarded; raw source mappings remain outside public DTOs. |

## D. Photos

| Item | Status | Final status / reason |
|---|---|---|
| D1 | **DONE (implementation)** | Per-builder settings and bottom-crop values persist; source-specific outer-band crop is applied before derivative render. |
| D2 | **DONE (implementation)** | Word-level OCR uses configured keyword sequences, confidence/bounding boxes, and hides suspect assets before buyer output. |
| D3 | **DONE** | Watermark identity now uses the shared `displayForLead` precedence, and spacing derives from measured label dimensions to avoid label overlap. |
| D4 | **DONE (implementation)** | Pending/processing/failed/processed queue states have retries, leases, requeue, admin crop changes, and reprocess controls. |
| D5 | **DONE** | Originals are oriented, stripped, and capped at **1600px** before OCR/master processing. |
| D6 | **DONE (documented storage limitation)** | Stable keys overwrite rerenders and expired render rows are pruned. The installed private-storage API exposes no verified delete operation, so remote object deletion is intentionally not attempted; the health panel states this. |
| D7 | **DONE** | The fast English OCR model is committed under `server/ocr`; local `langPath`/`cachePath` prevent runtime model download and workers have bounded cleanup. |
| D8 | **DONE (implementation)** | Photo queue and OCR use bounded serialized work; gated gallery images are lazy loaded and session render keys are stable. |
| D9 | **DONE** | M/I DAM host is allowlisted and its gallery pipeline processed approved official hosts only. |
| D10 | **NOT DONE — source limitation** | Chesmar’s official page was reachable but did not expose an approved plan-gallery payload during review. The adapter holds rather than synthesizes images. |
| D11 | **DONE** | Missing gallery state reads: “Photos on request — ask us for the latest gallery.” |
| D12 | **NOT DONE — intentionally omitted** | The requested repeating photo-page background identity treatment was not added because it risks revealing private gallery content outside the session-bound image routes. |
| D13 | **DONE (implementation)** | Admin has a protected thumbnail/data URL preview, state/crop controls, and manual records; browser-facing images remain session-bound. |
| D14 | **DONE** | Private storage path normalization/traversal prevention and byte-only session routes are enforced. |

## E. Admin

| Item | Status | Final status / reason |
|---|---|---|
| E1 | **DONE (reviewed implementation)** | Protected panel manages pause/manual/reel/configured source state and controlled refresh diagnostics. |
| E2 | **DONE (reviewed implementation)** | Incentive accept/dismiss/manual state is protected and validates required rate terms before publication. |
| E3 | **DONE (reviewed implementation)** | Protected photo preview, visibility state, crop, and requeue controls are provided. |
| E4 | **DONE (reviewed implementation)** | Manual-home create/list/remove controls keep private mappings and catalog timestamps inside admin. |
| E5 | **DONE (reviewed implementation)** | Lead/request operational data is paged/limited within the admin-only panel. |
| E6 | **NOT DONE — analytics scope** | The data captures source/reel code, but a dedicated per-reel conversion chart was not added. |
| E7 | **DONE (reviewed implementation)** | Team/test controls and link cascade actions are in protected admin. |
| E8 | **DONE (reviewed implementation)** | CSV known-agent import plus do-not-auto-import controls exist; rows are normalized at the trust boundary. |
| E9 | **DONE (reviewed implementation)** | Multi-identity blocking/revocation is exposed with confirmation and server cascades. |
| E10 | **DONE (reviewed implementation)** | Health, caps, retries, recipient settings, responsive controls, and clear safe-state descriptions are present. |
| E11 | **DONE (reviewed implementation)** | TREC current-import summary, test fixture control, type/status information, row counts, and age are protected. |
| E12 | **DONE (implementation only)** | Use the private review URL below and an allowlisted company Google account for your signed-in visual review. |

## F. Tests

| Item | Status | Final status / reason |
|---|---|---|
| F1 | **NOT DONE — no isolated deployed runtime** | Runtime privacy tests require `DEALS_E2E_BASE_URL`; they correctly skip rather than silently pass when it is unavailable. The sandbox review server is not a deployed isolated production runtime. |
| F2 | **DONE** | Unit coverage includes caps, token separation, pending reload, FUB unions, photo/OCR safety, scheduler reconciliation, adapter limits, and key public boundary protections. |
| F3 | **DONE** | Browser scripts are configurable, fixture-only, use a fictional 555 number, never call real OTP/CRM routes, and return exit code 2 on missing target. |
| F4 | **DONE** | The full environment-cleared run is documented above: 662 passed / 5 explicit skips. |

## G. Area map

| Item | Status | Final status / reason |
|---|---|---|
| G1 | **DONE (privacy-preserving alternative)** | The gated page presents a static, coordinate-free approximate-area treatment. If a valid same-origin static map asset exists, it states a ZIP-centroid radius with no exact pin; otherwise it fails closed with the area-details message. |

## X. Round 3 addendum

| Item | Status | Final status / reason |
|---|---|---|
| X1 | **DONE** | The trailing Drizzle statement marker was removed and the already-applied `0014` ledger row was repaired without rerunning DDL. |
| X2 | **DONE** | Instagram iframe detection is wrapper-based; a successful embed is not replaced at five seconds. |
| X3 | **DONE** | Reverify markers include occurrence identity; leased jobs re-read changed payloads before terminal completion. |
| X4 | **DONE** | Shared lead display precedence now drives watermark identity; tile gap derives from the measured label. |
| X5 | **DONE** | `MAX_ORIGINAL_EDGE` and tests use 1600px. |
| X6 | **DONE** | Notification tests mock environment at module-load boundary; environment-cleared suite passed. |
| X7 | **DONE** | Guidance, APR single-label, Deals telemetry stripping, formatted pending phone, blocked copy, wrong-code feedback, and fresh fixture capture behavior are repaired. |
| X8 | **DONE** | Google profile name is included in tokenized agent-keyword screening. |
| X9 | **DONE** | Phone and test-number hourly-cap regression coverage is included. |
| X10 | **DONE** | Threshold alert claim is atomic and clock helpers are shared. |
| X11 | **DONE** | Scheduler definitions/callback reconciliation and hour-wide `once` behavior are tested; all-failure catalog arrays are failures. |
| X12 | **DONE** | FUB tag/phone/email object preservation and normalized unions are covered. |
| X13 | **DONE** | Same-day request aggregation and duplicate request response are protected by durable job/unique handling. |
| X14 | **DONE (implementation evidence)** | `/users` pagination continues to an empty page; the redacted live response probe observed only identifier/email shape and retained neither. |
| X15 | **DONE** | Source-key punctuation normalization is in shared code. |
| X16 | **DONE** | Browser target is environment-configured and missing-target exit is 2; current passing transcript is above. |
| X17 | **DONE — documented behavior** | Existing access-token rows default to exchange after migration, requiring preview re-verification; accepted for review state. |
| X18 | **DONE** | The previously confirmed core items remain covered by the current branch/tests. |

## H. Final evidence and review link

| Requirement | Status | Evidence |
|---|---|---|
| TypeScript | **DONE** | `npx tsc --noEmit` passed. |
| Full environment-cleared Vitest | **DONE** | 57 passed files, 1 explicit skipped file; 662 passed, 5 skipped. |
| Browser transcript | **DONE** | Six 375px synthetic-fixture checks passed; transcript is quoted above. |
| Official host reachability | **DONE** | M/I HTTP 200 / 216,729 bytes; Chesmar HTTP 200 / 60,789 bytes. |
| Live M/I count | **DONE** | 15 confirmed QMI and 16 To Be Built private cards after current refresh. |
| Incentive records | **DONE** | Reviewed Chesmar and M/I records described above; display is subject to held/expiry controls. |
| Owner alert | **DONE** | Authorized `notifyOwner` test alert awaited successfully. |
| Admin visual sign-in review | **NOT DONE — user action requested** | Signed-in admin review remains for you, as requested. Preview URL: `https://3000-ikqecsvrip83yuk510r73-be8e0622.us1.manus.computer/admin/deals` |

### Review status

The branch is **not checkpointed, deployed, merged, or publicly published**. The remaining deliberate limitations are B13 (no Resend credential to verify a second-recipient email), C11–C12 (bounded reviewed-source scope rather than arbitrary builder scraping), D10 (no approved Chesmar gallery payload), D12 (repeating background treatment intentionally omitted to avoid private-media leakage), E6 (no dedicated per-reel conversion chart), F1 (no isolated deployed runtime privacy run), and the requested signed-in E12 visual admin review. All other numbered A–H/X items are marked done at implementation/test level above.
