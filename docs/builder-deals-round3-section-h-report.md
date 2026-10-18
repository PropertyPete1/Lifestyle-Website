# Builder Deals — Round 3 Section H Report

**Review branch:** `builder-deals-preview`  
**Current pushed commit:** `4b93289fddb5834299b248b28bc164946635d641`  
**Checkpoint/deployment/publish:** none. No production checkpoint or public deployment was created.

## Validation performed

- `npx tsc --noEmit` — passed.
- `pnpm test -- --run` — **53 files passed, 1 explicitly skipped; 652 tests passed, 4 explicitly skipped (656 total)**. The four skips are the remote-runtime privacy checks, which require `DEALS_E2E_BASE_URL`; they are explicit skips, not pass-on-error checks.
- Browser test (with test configuration available) — passed: landing → gate → test OTP → token exchange → gated list, root session cookie present, and reload resumes at the code step without a second send.
- Applied additive preview-database schema work for the durable FUB job/audit fields and photo queue metadata. The migration contains no destructive operations. It did not deploy app code.

## Pushed review commits

| Commit | Scope |
|---|---|
| `663fd75` | Initial Round 3 funnel-invariant work |
| `e38a583` | Funnel blockers: rate event phone column, code resume/UI feedback, team request fencing, Chicago helpers, privacy/IPv6 corrections |
| `5505777` | Browser regression for pending-code reload without duplicate send |
| `8303ef0` | Startup registration and scheduler execution hardening |
| `6e2ecf9` | Durable CRM outbox/retry/audit work |
| `a439016` | Official-source sync and adapter safeguards |
| `eb15bbe` | Protected photo pipeline and storage hardening |
| `c4546ae` | Mobile-focused Builder Deals administration improvements |
| `4b93289` | Behavioral test and configurable browser-script coverage |

## A. Crash, security, and funnel bugs

| Item | Status | Implementation / exact reason |
|---|---|---|
| A1 | **DONE** | `deal_events.phone_e164` is indexed and code-send event writes store the normalized phone independently of detail. Rate queries use that column. |
| A2 | **NOT DONE** | `server/dealsRoutes.ts` now has guarded async route wrappers and `_core/index.ts` logs unhandled rejections, but concurrent lead select-or-insert has not been made fully idempotent under the unique phone constraint. |
| A3 | **DONE** | `Deals.tsx` observes `state.pending`, re-enters the code step, and `scripts/test-deals-browser.mts` proves reload does not trigger a second send. |
| A4 | **DONE** | Deals CSP permits Google Fonts styles/fonts and the required Instagram CDN script/frame origins. |
| A5 | **DONE** | `ReelCard` invokes embed processing after mount and its 5-second fallback looks for a real iframe replacement. |
| A6 | **DONE** | Any nonempty `codeError` displays an error and `blocked=1` maps to the blocked sheet state. |
| A7 | **DONE** | Chicago day start/end helpers use `Intl` wall-clock resolution, the seed/parser dates use them, test sends are excluded from daily caps, and cap-alert sends are event-deduped. |
| A8 | **NOT DONE** | Twilio failure alerting is present but no explicit attempt/outcome model and regression prove exactly three consecutive failures. |
| A9 | **DONE** | `deal_access_tokens.kind` separates exchange/session records; exchange tokens reject replay except for an already-live same-device session. |
| A10 | **DONE** | `reserveGateSubmit` logs and limits the request by IP before FUB screening/blocklist writes. |
| A11 | **DONE** | Test/team eligibility is evaluated before the “has agent” branch; team previews do not take the device block. |
| A12 | **NOT DONE** | The full eight-step FUB/domain/do-not-auto-import order, CRM contact tagging/notes, and deferred FUB recheck/token kill are not all implemented or live-verified. |
| A13 | **DONE** | Instagram keyword matching is tokenized on non-alphanumeric boundaries, avoiding substring false positives. |
| A14 | **NOT DONE** | A forwarded-DM handle collision is not yet nulled when another verified lead owns it. |
| A15 | **DONE** | Consent time/IP are persisted on pending verification, copied to the eventual lead, and a consent event is logged at Continue. |
| A16 | **DONE** | IPv6 addresses expand before their first four hextets are used for the /64 key. |
| A17 | **DONE** | Server messages derive the text-line/keyword guidance from settings, the Continue button requires 10 digits, and Google env aliases are supported. |
| A18 | **NOT DONE** | Community/listing views are not yet deduped per lead/community/hour with a daily batch FUB activity note. |
| A19 | **NOT DONE** | Gallery layout was constrained and image lazy loading added, but the complete required fresh 375px overflow capture/assertion was not completed. |
| A20 | **DONE** | Team leads receive a non-clickable “Team preview” label; `requestHome` rejects team sessions and verification uses a `team` event. |

## B. FUB, alerts, schedules, team, known agents, and TREC

| Item | Status | Implementation / exact reason |
|---|---|---|
| B1 | **DONE** | `ensureDealsCron()` idempotently registers every job definition on production startup. Scheduler `once()` keys by job/day, accepts a bounded window, and treats `{ok:false}` as failed. |
| B2 | **NOT DONE** | First-unlock/profile-change alert modes and formatted unlock email have not been fully implemented. |
| B3 | **DONE** | `dealsFubJobs.ts` has due failed-job retries, stale-lease recovery, atomic leases, backoff, duplicate enqueue updates, and opaque marker checks before resend. |
| B4 | **DONE** | CRM writes union tags/phones/emails, use an IG Lead plus last-four fallback, use opaque markers, and search E.164/national formats. |
| B5 | **DONE (not live-API verified)** | Peter is found by paged `/users` exact-email matching with cache and a failure path. Unit coverage uses a representative FUB response; no live API response body was disclosed or pasted. |
| B6 | **NOT DONE** | Team mirror is safer than before but has not completed full paging/active-user/every-phone/reverse-cascade behavior. |
| B7 | **NOT DONE** | Full unblock/team/remove-team cascades and FUB system-tag/note cleanup are not complete. |
| B8 | **NOT DONE** | A single configured-tag/source, full-page, five-skip-list known-agent sync was not completed. |
| B9 | **NOT DONE** | Health still lacks every specified threshold and the required seven-check Monday body. |
| B10 | **DONE** | Tour/ask now persists then queues durable work, uses Chicago request day, tracks task/note/email fields, and avoids blocking the visitor request on CRM/notification I/O. |
| B11 | **NOT DONE** | `deal_fub_records` records ownership and cleanup identifies/cleans supported system records, but FUB event deletion is intentionally not attempted because no verified delete endpoint exists; this needs a documented endpoint/approved manual workflow. |
| B12 | **NOT DONE** | Cached TREC import exists, but fake-row admin entry, SQL-first-name narrowing, old-import deletion, distinct admin summary, and file-age health coverage are incomplete. |
| B13 | **NOT DONE** | `notifyOwner` cannot specify recipient/CC; therefore Steven is not proven to receive the messages. A transactional email/SMTP integration with explicit recipients and delivery logging is required. No test email was sent. |

## C. Adapters, sync, and incentives

| Item | Status | Implementation / exact reason |
|---|---|---|
| C1 | **NOT DONE** | Registered schedule exists, but catalog cadence is not yet the requested 6:00 AM/three-day rule and incentive is not yet a cheap lapse-only pass. |
| C2 | **NOT DONE** | Full incentive lifecycle (held records, accept/dismiss/manual sticky editor, lapse alerts) is incomplete. |
| C3 | **NOT DONE** | Sync now prefers adapter public incentive text and has safer guards, but the required exhaustive residue regression has not been completed. |
| C4 | **NOT DONE** | Parser safeguards improved, but real captured M/I/Chesmar fixtures and all relaxed no-date forms are not complete. |
| C5 | **NOT DONE** | Adapter/source-key/sitemap guards improved, but real page fixtures and all truncation/detail-stat safeguards are not fully covered. |
| C6 | **NOT DONE** | Price history handling was improved but the required behavioral regression suite was not completed. |
| C7 | **NOT DONE** | Sold/reappearance protections improved but require the specified regression coverage before they can be accepted. |
| C8 | **NOT DONE** | The gated catalog is not yet restricted to To Be Built cards only when no quick move-ins exist. |
| C9 | **DONE** | Shared canonical source/incentive normalization was introduced for the adapter/sync path. |
| C10 | **NOT DONE** | Categorized, admin-editable scrub lists and every-response public residue checks are incomplete. |
| C11 | **NOT DONE** | Sync has safer database-row usage but still does not fully scrape/store all community facts or support a full admin-created-community lifecycle. |
| C12 | **NOT DONE** | Per-community background refresh, separate holds, and change/failure email summary are incomplete. |
| C13 | **NOT DONE** | No committed live-page fixture corpus or deployed-runtime Chesmar fetch fallback queue was completed. |
| C14 | **NOT DONE** | Redirect safety and gallery extraction improved; all real-source/fixture documentation requirements remain incomplete. |

## D. Photos

| Item | Status | Implementation / exact reason |
|---|---|---|
| D1 | **NOT DONE** | The deterministic pipeline is stronger, but per-builder percentage-region picker/toggle/seeding/outer-band crop lifecycle is not complete. |
| D2 | **NOT DONE** | OCR now uses stricter whole-word/confidence logic, but complete keyword admin editing and every specified hide rule are not complete. |
| D3 | **DONE** | Photo renders use tiled per-lead watermarking across the image and include the selected identity/version in the cache key. |
| D4 | **NOT DONE** | Pending/processing/processed/failed queue, retries and requeue support exist, but every setting-change/admin reprocess trigger is not complete. |
| D5 | **DONE** | Originals are EXIF/XMP-free, oriented and bounded before master/OCR work. |
| D6 | **NOT DONE** | Deterministic keys and metadata pruning exist; safe remote object deletion is unavailable in the installed storage API and was not attempted. |
| D7 | **NOT DONE** | Worker reset/timeout work exists, but a repository-shipped language model/langPath and full shutdown integration are not complete. |
| D8 | **NOT DONE** | Processing and gallery loading are bounded/lazy, but the required render LRU and complete concurrency proof are not complete. |
| D9 | **NOT DONE** | Allowlist/redirect handling improved, but the required live M/I host confirmation was not recorded. |
| D10 | **NOT DONE** | Chesmar extraction work improved but cannot be accepted without reachable/live fixture coverage. |
| D11 | **DONE** | Gated missing-image state now reads “Photos on request — ask us for the latest gallery.” |
| D12 | **NOT DONE** | A repeating page-background identity treatment is not implemented. |
| D13 | **NOT DONE** | Admin photo thumbnail/preview route and manual upload tooling are incomplete. |
| D14 | **DONE** | Storage proxy path normalization/traversal protection and safe photo processing checks were hardened. |

## E. Admin

| Item | Status | Implementation / exact reason |
|---|---|---|
| E1 | **NOT DONE** | The panel has safer configured-source refresh and existing controls but not complete community add/pause/remove/per-community job UI. |
| E2 | **NOT DONE** | Incentive editor/hold workflow is incomplete. |
| E3 | **NOT DONE** | Photo-region picker, thumbnails and reprocess controls are incomplete. |
| E4 | **NOT DONE** | Full manual-home CRUD/upload/catalog-time updates are incomplete. |
| E5 | **NOT DONE** | Admin operations improved, but indexed paging/search and complete private mapping/tour request lead detail are incomplete. |
| E6 | **NOT DONE** | Complete per-reel funnel-stat procedure/table is incomplete. |
| E7 | **NOT DONE** | Existing team/test controls improved, but complete mirror/manual/reverse-cascade/no-mobile UI is incomplete. |
| E8 | **NOT DONE** | CSV import and do-not-auto-import controls are exposed; search/delete and complete behavior remain incomplete. |
| E9 | **NOT DONE** | Existing block controls improved but full multi-field search/cascade review is incomplete. |
| E10 | **NOT DONE** | Safe settings query states, health/cap/retry and responsive/a11y controls were added, but all list editors/status semantics are not complete. |
| E11 | **NOT DONE** | TREC admin distinct types/status, fake-row input, ages and counts are incomplete. |
| E12 | **DONE (implementation only)** | Admin controls are responsive/a11y-hardened. Sign in at the preview’s `/admin/deals` route using an allowed company Google account; no authenticated visual review was performed. |

## F. Tests

| Item | Status | Implementation / exact reason |
|---|---|---|
| F1 | **NOT DONE** | Runtime privacy tests now use `DEALS_E2E_BASE_URL` and fail if a configured target is unreachable; they still do not boot an isolated server and were skipped because that URL was not configured. |
| F2 | **NOT DONE** | New behavioral tests cover core boundaries/cookies/Google tamper/reload and CRM unions, but not every listed acceptance scenario. |
| F3 | **NOT DONE** | Browser/capture scripts are configurable, have secret-sensitive clear skips and clean temporary records; they do not yet cover all requested other-device/session scenarios. |
| F4 | **DONE** | The full suite is green without environment configuration: 652 passed, 4 clearly skipped runtime checks. |

## G. Area map

| Item | Status | Implementation / exact reason |
|---|---|---|
| G1 | **NOT DONE** | The gated static area treatment remains coordinate-free. ZIP centroid/tile/radius/destination-derived “about” chips are not complete. |

## H. Screenshot/report evidence

| Requirement | Status | Exact reason |
|---|---|---|
| Fresh required 375px captures | **NOT DONE** | Not all specified captures were regenerated after the final A19 state; stale captures were not removed. |
| Current catalog/incentive public-text evidence | **NOT DONE** | No final live official-source evidence was captured because all source/lifecycle acceptance items are not complete. |
| Browser/full test/tsc evidence | **DONE** | Captured above: browser funnel passed; TypeScript passed; 652 passed and 4 explicit skips. |
| Unlock/tour/health email proof | **NOT DONE** | No live message was sent. `notifyOwner` does not provide an explicit two-recipient email mechanism. |
| Every numbered item status | **DONE** | This document lists every Round 3 item as DONE or NOT DONE with exact scope/reason. |

## Required next work before approval

The remaining launch blockers are: A2, A8, A12, A14, A18–A19; B2, B6–B9, B11–B13; C1–C8 and C10–C14; D1–D2, D4, D6–D10, D12–D13; E1–E11; F1–F3; and G1. This branch is therefore **not ready for approval, merge, checkpoint, or deployment**.
