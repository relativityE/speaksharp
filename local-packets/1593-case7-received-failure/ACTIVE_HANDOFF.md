# CLI case 7 active handoff

Checkpoint: 2026-10-19 13:58 UTC. Owner: CLI Dev, Lane B. Sam owns coordination.

Branch: `cli-dev/1593-received-failure-chain-20261019`.
Base: `83029ebb67216b2690eeff59e4ec1730d5f6ffe8` (new main from #1664).
Original baseline and full-quality base: `ba1a9f5ad31778460a4ea9e383a08be14b3222f6`.
PR: https://github.com/relativityE/speaksharp/pull/1665 (non-draft).
This packet is committed with the tested implementation; the publication receipt
in the existing Slack coordination thread identifies its exact successor head.
Worktree: `/private/tmp/speaksharp-cli-case7-integration-20261019`.
Implementation edits now touch the two owned source files and the new integration
test below. This packet and retained Vitest reports are new. `pnpm quality`
completed successfully at 13:23 UTC; no task-owned process remains running.

## Accepted scope

Complete the answered-failure diagnostic/feedback binding through actual adapter,
received diagnostic validator, existing receipt finalization, offline tests and
one reviewable PR. A received failure chain may pass assurance without promoting
the underlying unsuccessful coaching journey. Preserve all original failures.

CLI file ownership acknowledged to Sam/App:
- `tests/live/helpers/coachingFeedbackAdapter.ts`
- `frontend/src/services/telemetry/coachingDiagnosticReceipt.ts`
- `tests/unit/coachingFeedbackAdapter1258.test.ts`
- `tests/unit/rwtCoachingReadback1258.test.ts`
- new `tests/unit/rwtReceivedFailureChain1593.test.ts`
- this local packet directory

App owns #1662 callers and shared harness helpers, product telemetry, Stop-order
repair and case 15 routing candidate. Do not edit those files. Workflow/readback
plumbing and `rwtAcceptance.ts` are read-only unless Sam hands them over.

## Confirmed source finding and next work

The adapter only emits the five binding fields for outcome `success`; the
received validator also only accepts a success expectation. Answered provider
failures can therefore remain unqualified even when their diagnostic was received.
Raw producer terminal outcome is `failure`, whereas adapter normalized outcomes
include `provider_error` and `timeout`; map deliberately rather than comparing
incompatible vocabularies. Unanswered client-network failures lack a provable
configured model: do not invent that identity or qualify them without evidence.

Implemented: answered failures emit raw `failure` in the existing five-field
binding after all original in-run contract requirements pass. The received
validator accepts that binding and requires exact failure release plus coherent
endpoint/provider/source/attempt evidence. Successful requests keep their existing
requirements. No received schema, workflow, shared finalizer, or caller edits.

Executed baseline at 13:13 UTC: 27 failed / 6 passed on unchanged ba1 source,
decisive missing failure binding. `baseline-red.json` retains that result.
First integration attempt: 24 failed / 92 passed; two test-fixture defects were
corrected (closed workflow result projection and duplicate bound-report setup).
`first-integration-attempt.json` retains that result; these are not new product
findings. Final focused run at 13:16 UTC: 274/274 passed across the new integration
tests (38), existing adapter (34), readback/finalization (49), and external-outage
controls (153). See `focused-green.json`. Tests preserve original coaching FAIL,
EXTERNAL/INCOMPLETE and lack of human quality proof; diagnostic PASS is assurance
only. `git diff --check` passed. `pnpm quality` exit 0: product-contract guard,
full bounded lint, frontend/live/evidence TypeScript and eslint-disable guard.
Main moved while the PR was being created. Rebased onto `83029ebb`; the only
intervening main paths are SpeechRuntimeController and its test, with no changes
to the case-7 source/test files. Post-rebase run: all 274 controls plus the merged
154 controller controls passed (428/428); see `rebased-green.json`. Full quality
was not rerun on the new base; its prior result is retained with exact provenance.
Fresh exact-head CI and independent review remain required.

## Returned provider-attempt bound, corrected

Sam and Codex returned the old `7e920bd6` head for permitting fresh failure
provider_attempts above the producer/allowlist maximum of 3 (r4314371067).
Executed reproduction: providerAttempts=4 incorrectly PASSed; 1 FAIL / 38 PASS
(`provider-cap-red.json`). Fresh failure validation now requires 1–3 attempts.
Added 4 and Number.MAX_SAFE_INTEGER negatives plus a valid 3 positive, preserving
valid 1, missing/negative/fraction/string and existing identity/coaching controls.
Corrected run: 281/281 PASS across the four affected case7 suites and the actual
producer cap suite (`provider-cap-green.json`). Changed-source/test ESLint passed
after the cap fix (before the final large-integer test row was added). Full local
quality's provenance above remains unchanged; fresh CI/review of the successor is
required, and no global-quality rerun is fabricated.

## Evidence portability correction

Sam source-accepted `2f10a057` at 13:39; PM independently ran 32 bounded controls.
Its CI then failed only the repository's no-local-machine-paths guard: raw failure
stacks included the author's dependency/home paths. Six published JSON reports
now replace environment prefixes with `<repo>`, `<dependencies>`, `<temporary>`
and `<home>`. Counts, timings, assertions, object keys/array lengths and failure
text outside those path fragments are preserved. Raw byte originals remain in a
private archive outside Git; `normalization.json` records raw/normalized hashes.
The unchanged repository guard over all tracked textual evidence passes 3/3.
No product, adapter, validator or test assertion changed in this packaging fix.

Next: publish the packaging-only successor to #1665, then obtain Sam's exact-head
disposition. Implementation and local verification are complete; CI, independent
review, serial landing and any authorized final-release live proof remain open.
Sam's 12:37:54 receipt confirms App's
explicit clearance for all five paths; there is no remaining file-lease blocker.
No platform-approval blocker is currently observed. No live execution, production writes,
deployment or merge authorized by this checkpoint.

The 12:37 update was missed. Resumed and acknowledged at 13:12; actual test
evidence delivered in Slack at 13:16 (message 1792415801.060089). Next checkpoint
by 2026-10-19 13:26 UTC while actively working, earlier at a material handoff.

Queued after case 7: Sam's bounded case-1 interrupted-repeat completeness-gate
correction. App explicitly released completenessGate.ts and its stage-aware test
in its 13:24 receipt (message 1792416262.663849). Sam retains release,
merge, deploy and live-test authority. No implementation availability is promised
outside an active turn; publish a stopped handoff if this execution ends.

## Approval-reuse diagnostic

User interrupted to address recurring interactive approval stalls. Read-only
policy checks on 2026-10-19 confirmed saved rules return `allow` for direct
`gh api ... --method GET`, `node --test ...`, and `pnpm quality`.
The historical command shape `bash -lc 'gh api ...comments?per_page=10'`
returned no matching rule. These checks did not execute the enclosed commands.
Workspace AGENTS.md now requires direct command shapes, query flags, uncertain
match preflight, and this handoff before prospective blocking operations.
No permission settings or platform enforcement were changed. A local rule-file
match does not prove every runtime/managed policy allows the operation.
