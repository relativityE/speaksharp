# Nightly AHT suite: implementation plan

Date: 14 November 2026. Base: main `897117b` (#1858). Design source: draft PR #1864 (`docs/aht-nightly/design-2026-11-14.md`, `coverage-map.v1.json`, head `2ce3c96` when this plan was written). This PR implements that design; where the two disagree, #1864 wins and this plan is corrected.

This commit holds the plan only. No product, harness or test code.

## Ground rules

- **Offline only.** Nothing in this PR deploys, applies a migration, touches Stripe live mode or production, or runs a live AHT. Nightly activation is not part of this PR.
- **No shared harness edits.** Every file this PR adds is new. It edits no existing file. Shared harness changes (case catalog, case costs, dispatch, schedule) are written up as an exact-file handoff for a separate reviewed PR (phase 5).
- **Existing live AHT rows stay.** The 15 cases and their 204 rows stay live and unchanged. A row moves to the nightly suite only once its replacement is independently proven to fail on the same break and pass when restored.
- **Every new or strengthened row has a negative control.** A seeded break makes it fail; restoring the behaviour makes it pass. Both results are recorded.
- **NOT RUN and HOLD are never PASS.** A run with any NOT RUN or HOLD leg can't be green.
- **#1857 is left alone.**

## Files this PR adds (all new)

| Path | What |
|---|---|
| `docs/aht-nightly/implementation-plan-2026-11-14.md` | This plan |
| `tests/live/nightly/lib/journeyPlan.ts` | J1 to J9: legs, rows (the 204 catalog rows plus the 16 new ones), leg dependencies, per-journey coaching maxima, account kind, browser context per leg |
| `tests/live/nightly/lib/legOutcome.ts` | PASS / FAIL / HOLD / NOT RUN per leg; dependent legs NOT RUN when their parent did not pass; journey and run verdicts |
| `tests/live/nightly/lib/runBudget.ts` | Run-wide coaching hard stop (configurable, default 31) and per-journey maxima; past the cap no request is sent and the leg is NOT RUN |
| `tests/live/nightly/lib/trialWindow.ts` | `trial-length-thirty-days` oracle, read with the account's own token |
| `tests/live/nightly/lib/canaryTrialEnd.ts` | Tagged, fail-closed trial-ending write: refuses without the server-issued canary claim, checks the exact account id, writes only `trial_expires_at` |
| `tests/live/nightly/lib/signOutOracle.ts` | Asserts no unauthorized successful read and no data leak after sign-out. It does not assert the absence of 403s |
| `tests/live/nightly/lib/wallOracle.ts` | Payment wall rows: offers deletion without promoting it, no History, PDF or export first |
| `tests/live/nightly/lib/billingPortalSession.ts` | J9 portal check: bounded wait, the portal address never logged, stored or attached; cleanup reconciliation that reports billing rows rather than promising zero |
| `tests/live/nightly/lib/paidAccountFixture.ts` | J9 fixture interface for the long-lived paid account. Creation is not implemented and is flagged |
| `tests/live/nightly/j1-new-user-first-30-days.nightly.spec.ts` … `j9-paying-customer-after-upgrade.nightly.spec.ts` | One spec per journey, composing existing helpers by import |
| `tests/live/nightly/negative-controls/breaks.json`, `run.mjs` | Seeded breaks, one per new or strengthened row, and the runner that proves fail-on-break, pass-on-restore |
| `tests/unit/nightly/*.test.ts` | Offline unit tests for every module above, plus the coverage drift test |
| `playwright.nightly.config.ts` | Its own config. Specs are named `*.nightly.spec.ts`, so `playwright.live.config.ts` (which matches `*.live.spec.ts`) never collects them. No workflow references it |

The specs are typechecked by the existing `tsconfig.live.json`, whose include already covers `tests/live/**/*.ts`; that file isn't edited.

## Overlap with #1859 and #1860

No file this PR adds or edits is touched by #1859 (24 files) or #1860 (37 files).

Read-only dependencies (imported, never edited) that #1860 changes:

| File | Changed by | Used by |
|---|---|---|
| `tests/live/helpers/runOwnedCleanup.ts` | #1860 | Every journey's cleanup |
| `tests/live/helpers/rwtFocusPointsJourney.ts` | #1860 | J3 |
| `tests/live/helpers/feedbackNoSessionCleanup.ts` | #1860 | J8.a |
| `tests/live/helpers/feedbackFence.ts` | new in #1860 | J8 |
| `tests/live/helpers/rwtInterruptedRunRecovery.ts` | #1860 | J4, J5 resets |

So: J1 to J7 are written against main and rebased once #1860 merges. J8 can't compile until `feedbackFence.ts` is on main; it is written last and stays out of the review package until #1860 merges.

## Phases

Each phase ends with its unit tests and negative controls green locally, and nothing is pushed until it has passed an independent reviewer, then Codex code and security review.

1. **Core (offline).** `journeyPlan`, `legOutcome`, `runBudget`; coverage drift test (every one of the 204 catalog rows in `tools/cloud-test/config/assertion-catalog.json` has exactly one home, and every planned row is a catalog row or one of the 16 new rows; once #1864 merges, the plan must also match its `coverage-map.v1.json`). Negative controls: a row with no home, a dependent leg reported PASS after its parent failed, a NOT RUN leg counted green, a request sent past the cap.
2. **Oracles for the new rows (offline).** `trialWindow`, `canaryTrialEnd`, `signOutOracle`, `wallOracle`, `billingPortalSession`, short Stop. Each tested against recorded or synthetic inputs and a fake admin client, with a seeded break per row (29-day trial, write without the canary claim, write to another account id, a successful read after sign-out, a portal URL in a log line, a wall that shows History first, a short Stop that saves).
3. **Journeys J1, J3 to J7.** Specs composing existing helpers: fresh context per leg where the design says so, verified lease release and interceptor and draft resets between legs, the four invariants in every leg, budget wiring. Typecheck and dry collection only (`--list`); no live run.
4. **J2, J8, J9.** J2 is built but disabled until a reviewed cleanup step expires the Checkout Session and settles the checkout operation (the design's own condition). J8 after #1860 merges. J9 against the fixture interface; its legs report NOT RUN with "paid account not approved" until a paid account is approved.
5. **Shared harness handoff (separate PR).** Exact-file diffs for the case catalog (`harness/draft-adapters/contracts.json` and its hash file and catalog history), `config/aggregate/case-costs.json`, the dispatch in `rc-gates.yml` / `cloud-test-live.yml`, and the nightly schedule. Written for Sam to review; nothing activated.

## Approvals this plan relies on

- Approved: 30-day trial; no export before deletion; early trial end only on test-created, tagged accounts.
- Not approved, so not built: a production charge or a $10/month production subscription for J9's account.
- Proposed only: the 31-request coaching cap, implemented as a configurable hard stop.
- Not authorized: nightly activation, live runs, production writes.
