# RC Overhaul Tracker

**Last updated:** 2026-05-25

This tracker is the working board for converting the current test estate into a contract-based RC evidence system. These are work items that support the five RC gates, not additional release gates. A work item is closed only when the implementation, documentation, and evidence expectation are all clear.

Status values:

- **Done**: implemented and ready to rely on.
- **In progress**: actively being changed.
- **Open**: known work remains.
- **Red**: release-blocking evidence is missing or failing.
- **Advisory**: useful but not a release blocker by default.

## Governance Work

| Work Item | Area | Gate | Status | Required Outcome | Evidence / Notes |
|---|---|---|---|---|---|
| WI-01 | Artifact staleness | All | Done | `RC_GATES.md` states stale artifacts do not count when gate dependency surface changed after capture. | Prevents old traces/logs from closing new code. |
| WI-02 | Named counted tests | All | In progress | Replace vague "counts selectively" with named counted files/workflows per gate. | Inventory now has gate maps; still needs full ledger rows. |
| WI-03 | SQM caveat | All | Done | Document SQM as advisory/trend, never ship/no-ship. | Raw RC gates remain authority. |
| WI-06 | Contract source policy | All | Done | RC-counted tests must map to math, state machine, message protocol, security/product rule, or human journey. | Added to `RC_GATES.md` and inventory. |
| WI-22 | Existing test contract audit | All | In progress | Existing unit, integration, e2e, live, and workflow checks must either name their independent contract source or be marked advisory/diagnostic. | Prevents tests from defending current implementation behavior instead of product requirements. |
| WI-23 | Actionable error diagnostics | All | In progress | RC-counted tests, browser harnesses, and STT code paths must log caught exceptions with context and severity; no silent catch blocks or cryptic failures. | Found swallowed CI cleanup/telemetry exceptions and patched them to warn with command/path context. STT shutdown/restart/token diagnostics are being tightened. |
| WI-04 | Manual check ownership | Gate 5 | Open | Browser wording/manual checks need owner, artifact, pass criteria, freshness rule. | Prevents silent skip under release pressure. |
| WI-05 | Pro cloud-entitled test account policy | Gate 3 | Open | Define known-good Pro account owner, refresh process, and secret update path. | Prevents operational failure being confused with product regression. |

## Product / Test Gaps

| Work Item | Area | Gate | Status | Required Outcome | Evidence / Notes |
|---|---|---|---|---|---|
| WI-10 | Native Chrome proof | Gate 1 / Gate 5 | Red | Real Chrome + real mic artifact with coherent transcript, no repetition, no unrecovered `onerror`. | Latest synthetic `say` artifact `/private/tmp/speaksharp-native-say-trace-1779704244115.json` is technically clean but functionally red: first visible `8.655s`, transcript only `on the`. |
| WI-11 | Private STT worker contract tests | Gate 1 | Done | Worker message tests for init/transcribe success, pre-init failure, timeout/error response, pipeline-load failure, and destroy acknowledgement. | Found and patched no-timeout hang risk in main-thread worker boundary. Added engine-boundary timeout tests and direct `transformers-js.worker.ts` protocol tests for E2E init, pre-init transcribe error, initialized transcribe result, model-load failure error response, and destroy acknowledgement. |
| WI-12 | Audio math contract tests | Gate 1 | In progress | Deterministic RMS, peak, sample duration, concatenation, WAV-shape tests from math definitions. | Found and patched audio worker no-timeout hang risk, Float32-to-Int16 signed PCM mismatch, and worker upsampling mismatch. More RMS/Native duplicate helper consolidation still needed. |
| WI-13 | ModelManager decision table | Gate 1 | In progress | Cached/missing/incomplete/bad model states produce expected Private availability/setup behavior. | Found and patched false-positive cache bug: unrelated/partial Transformers cache no longer marks Private v2 available. Added focused contract tests. |
| WI-14 | Private engine decision table | Gate 1 | Done | v2 default, v4 experimental, unavailable/bad dtype/fallback behavior explicitly tested. | Added contract coverage for registry fallback reporting the actual instantiated engine, explicit v4-only selection, failed v4 init not falling back to v2, and v4 availability reporting q4 split download size. Found and fixed bug where fallback `whisper-turbo`/`mock` engines could be reported as `transformers-js`. |
| WI-15 | Analytics usefulness artifact | Gate 1 / Gate 5 | Open | Known transcript produces exact filler/WPM and user-readable guidance. | Use Cloud-clean transcript as baseline evidence. |

## Coverage Policy Work

| Work Item | Area | Gate | Status | Required Outcome | Evidence / Notes |
|---|---|---|---|---|---|
| WI-20 | Targeted coverage floors | Gate 1 | Open | Add per-module floors only after contract tests land. | Candidate floors: audio utils 80%, analytics math 85%, STT worker 70%, transcription services 70%, NativeBrowser branch floor. |
| WI-21 | Coverage source of truth | All | Open | Clarify raw coverage artifact is source; generated PRD/SQM can lag or report null Lighthouse. | Prevents report aggregator bugs from misleading release status. |

## Advisory / Non-Blocking Buckets

| Work Item | Area | Gate | Status | Required Outcome | Evidence / Notes |
|---|---|---|---|---|---|
| WI-30 | Benchmarks | Advisory | Advisory | Run when STT engine/model/provider changes or performance SLA changes. | Not part of normal RC green. |
| WI-31 | Soak | Advisory | Advisory | Run before broad public launch or when stability is active risk. | Not part of normal controlled tester RC green. |
| WI-32 | Dump-ground diagnostics | Diagnostic | Advisory | Keep as probes; promote only if they become maintained regression tests. | Must not inflate RC confidence. |

## Stale Code / Script Cleanup

| Work Item | Area | Gate | Status | Required Outcome | Evidence / Notes |
|---|---|---|---|---|---|
| WI-40 | Untracked STT scratch artifacts | Hygiene | Done | Remove root/frontend scratch scripts, logs, and screenshots that are not maintained product code, workflow utility, or RC evidence. | Deleted stale untracked artifacts: `scratch_capture_run.js`, `test_private_stt_browser.mjs`, `frontend/scratch_transcribe_native_parallel.*`, `test_run.log`, `frontend/test_run.log`, and stale screenshots. |
| WI-41 | Script inventory | All | Done | Classify scripts as gate, workflow utility, advisory benchmark, diagnostic, or retirement candidate. | Added script inventory to `RC_TEST_INVENTORY.md`. Retired unreferenced/broken/stale scripts and local debug log so they cannot masquerade as release process. |

## Operating Rule

RC is green only when every blocking row for the current release scope is **Done** with a fresh artifact, or intentionally downgraded with matching product copy and release notes. Advisory rows can remain open without blocking, but they must not be represented as release proof.
