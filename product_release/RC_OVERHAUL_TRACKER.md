# RC Overhaul Tracker

**Last updated:** 2026-05-25

This tracker is the working board for converting the current test estate into a contract-based RC evidence system. A row is closed only when the implementation, documentation, and evidence expectation are all clear.

Status values:

- **Done**: implemented and ready to rely on.
- **In progress**: actively being changed.
- **Open**: known work remains.
- **Red**: release-blocking evidence is missing or failing.
- **Advisory**: useful but not a release blocker by default.

## Governance Work

| ID | Area | Gate | Status | Required Outcome | Evidence / Notes |
|---|---|---|---|---|---|
| RC-01 | Artifact staleness | All | Done | `RC_GATES.md` states stale artifacts do not count when gate dependency surface changed after capture. | Prevents old traces/logs from closing new code. |
| RC-02 | Named counted tests | All | In progress | Replace vague "counts selectively" with named counted files/workflows per gate. | Inventory now has gate maps; still needs full ledger rows. |
| RC-03 | SQM caveat | All | Done | Document SQM as advisory/trend, never ship/no-ship. | Raw RC gates remain authority. |
| RC-06 | Contract source policy | All | Done | RC-counted tests must map to math, state machine, message protocol, security/product rule, or human journey. | Added to `RC_GATES.md` and inventory. |
| RC-04 | Manual check ownership | Gate 5 | Open | Browser wording/manual checks need owner, artifact, pass criteria, freshness rule. | Prevents silent skip under release pressure. |
| RC-05 | Paid-Pro test account policy | Gate 3 | Open | Define known-good Pro account owner, refresh process, and secret update path. | Prevents operational failure being confused with product regression. |

## Product / Test Gaps

| ID | Area | Gate | Status | Required Outcome | Evidence / Notes |
|---|---|---|---|---|---|
| RC-10 | Native Chrome proof | Gate 1 / Gate 5 | Red | Real Chrome + real mic artifact with coherent transcript, no repetition, no unrecovered `onerror`. | Existing evidence is not green enough to close the Native item. |
| RC-11 | Private STT worker contract tests | Gate 1 | In progress | Worker message tests for init/transcribe success, pre-init failure, timeout/error response, and destroy acknowledgement. | Found and patched no-timeout hang risk in main-thread worker boundary. Added engine-boundary timeout tests and direct `transformers-js.worker.ts` protocol tests for E2E init, pre-init transcribe error, initialized transcribe result, and destroy acknowledgement. Pipeline failure branch still needs explicit worker-script coverage. |
| RC-12 | Audio math contract tests | Gate 1 | In progress | Deterministic RMS, peak, sample duration, concatenation, WAV-shape tests from math definitions. | Found and patched audio worker no-timeout hang risk, Float32-to-Int16 signed PCM mismatch, and worker upsampling mismatch. More RMS/Native duplicate helper consolidation still needed. |
| RC-13 | ModelManager decision table | Gate 1 | In progress | Cached/missing/incomplete/bad model states produce expected Private availability/setup behavior. | Found and patched false-positive cache bug: unrelated/partial Transformers cache no longer marks Private v2 available. Added focused contract tests. |
| RC-14 | Private engine decision table | Gate 1 | Open | v2 default, v4 experimental, unavailable/bad dtype/fallback behavior explicitly tested. | Protects default Private path and experimental isolation. |
| RC-15 | Analytics usefulness artifact | Gate 1 / Gate 5 | Open | Known transcript produces exact filler/WPM and user-readable guidance. | Use Cloud-clean transcript as baseline evidence. |

## Coverage Policy Work

| ID | Area | Gate | Status | Required Outcome | Evidence / Notes |
|---|---|---|---|---|---|
| RC-20 | Targeted coverage floors | Gate 1 | Open | Add per-module floors only after contract tests land. | Candidate floors: audio utils 80%, analytics math 85%, STT worker 70%, transcription services 70%, NativeBrowser branch floor. |
| RC-21 | Coverage source of truth | All | Open | Clarify raw coverage artifact is source; generated PRD/SQM can lag or report null Lighthouse. | Prevents report aggregator bugs from misleading release status. |

## Advisory / Non-Blocking Buckets

| ID | Area | Gate | Status | Required Outcome | Evidence / Notes |
|---|---|---|---|---|---|
| RC-30 | Benchmarks | Advisory | Advisory | Run when STT engine/model/provider changes or performance SLA changes. | Not part of normal RC green. |
| RC-31 | Soak | Advisory | Advisory | Run before broad public launch or when stability is active risk. | Not part of normal controlled tester RC green. |
| RC-32 | Dump-ground diagnostics | Diagnostic | Advisory | Keep as probes; promote only if they become maintained regression tests. | Must not inflate RC confidence. |

## Stale Code / Script Cleanup

| ID | Area | Gate | Status | Required Outcome | Evidence / Notes |
|---|---|---|---|---|---|
| RC-40 | Untracked STT scratch artifacts | Hygiene | Done | Remove root/frontend scratch scripts, logs, and screenshots that are not maintained product code, workflow utility, or RC evidence. | Deleted stale untracked artifacts: `scratch_capture_run.js`, `test_private_stt_browser.mjs`, `frontend/scratch_transcribe_native_parallel.*`, `test_run.log`, `frontend/test_run.log`, and stale screenshots. |
| RC-41 | Script inventory | All | Open | Classify scripts as gate, workflow utility, advisory benchmark, diagnostic, or retirement candidate. | Prevents stale scripts from becoming accidental release process. |

## Operating Rule

RC is green only when every blocking row for the current release scope is **Done** with a fresh artifact, or intentionally downgraded with matching product copy and release notes. Advisory rows can remain open without blocking, but they must not be represented as release proof.
