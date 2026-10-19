# #1254: previous-comparable wording review

Browser PM, 19 October 2026. **Wording ACCEPT; whole-issue closure OPEN.** Source review only in this turn; author-reported test totals are not PM-executed results.

Reviewed App's delivered packet [97638983ab03f5d36f7f40d32f0f8cafc96860cb](https://github.com/relativityE/speaksharp/commit/97638983ab03f5d36f7f40d32f0f8cafc96860cb), against [base32bde726](https://github.com/relativityE/speaksharp/compare/32bde726a2c27431c8ba17c1230f62a754859d75...97638983ab03f5d36f7f40d32f0f8cafc96860cb), four changed files. Latest handoff is [App's exact packet receipt](https://github.com/relativityE/speaksharp/issues/1254#issuecomment-6248167647); Sam's bounded wording selection is [6243870280](https://github.com/relativityE/speaksharp/issues/1254#issuecomment-6243870280).

## Source disposition

“Clearer than your previous comparable session” is six words and truthfully names the reference. The change replaces the adjacency claim in `progressPresentation.ts`; the diff does not change eligibility/cohort checks, meaningful-movement threshold, target/reference selection or arithmetic. Its adjacent explanatory comment matches the unchanged guards.

`loadSessionProgress` reads the persisted `previous_comparable_session_id`, checks identity, eligible evidence, cohort and chronology, and constructs disclosure from that reference. It does not independently choose the latest client-side recording. This supports the proposed wording rather than “last session.” The same sentence is already used in the Progress direction disclosure.

The test delta updates positive expectations and strengthens negative assertions to reject any `^Clearer than` claim for sub-threshold, cross-cohort and ineligible-reference cases. The E2E assertion reads the actual rendered `progress-what-worked` element and excludes “last session.” These are appropriate source-level checks for the copy increment.

## Evidence limits and one claim to narrow

The new loader test supplies s2 with both persisted reference IDs set to s0, a comparable s0 evaluation and the pre-existing chronology fixture containing s0/s1/s2. It asserts the returned view/disclosure/10-point movement/new wording. It does **not** supply an ineligible s1 evaluation or execute the server selection that skipped it. The mocked `.in()` also does not check the requested IDs. Therefore this is a persisted-reference/view-assembly regression, not independent proof of server-side intervening-ineligible selection or a mounted component render. Preserve that distinction in the handoff; add an appropriately scoped real selection/three-recording assertion only where the acceptance contract requires that claim. No server-selection defect is established by this test limitation.

The browser spec uses `eligibleProgressTruth(SESSION_ID, REFERENCE_ID)` and asserts visible wording. Its source alone does not establish a deployed run or an intervening-ineligible server-selection history. Author reports of328/328 unit tests,9/9 E2E and quality remain author-local receipts; they were not rerun by PM in this turn.

The live `main` file read during this review still contains “Clearer than your last session.” This is a moving-ref source observation, not a pinned deployment finding or proof of ordinary RWT reachability. The patch must be reconciled with the exact current head before selected landing. Nothing in this disposition closes the cross-surface inventory, desktop/mobile/accessibility/tooltip/PDF/empty-expired/privacy/feedback checks or deployed acceptance in #1254.

## Next action / authority

App may consume this bounded wording acceptance in its selected copy integration, preserve the reference/threshold logic, label the loader evidence accurately, and obtain the required fresh exact-head qualification and affected rendered evidence. Sam retains release sequencing and dispositions. This review does not authorize merge, deployment, migration, live campaign execution or whole-ticket closure. Broader copy issues stay in their owning scopes; no broad copy-refactor PR is requested.
