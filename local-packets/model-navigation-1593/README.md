# Browser PM: case13 presentation and navigation cancellation counterexamples

Parent: #1593 / #1258. Review-only, test-only packet for App Dev, the product-fix writer.
Base application head: `ecce3e8d9e154ddb12f7238a514f0ec85d4b75b4`.
Branch: `browser-pm/1593-model-failure-probes-20261019`.

## Executed results

| Probe group | Result | Evidence scope |
|---|---|---|
| Case13 service / rendered view | 6 PASS, 3 intentional RED; exit1; 9.28s | Actual public TranscriptionService operations, its FSM/store/DOM projection, real SessionOverhaulView / MicCard. Engine availability/init/termination are fakes. The small React fixture follows the DOM projection seam; it does **not** run useSessionLifecycle. |
| Navigation hook file, including four added controls | 21 PASS, 2 intentional RED; exit1; 15.56s | Actual useSessionLifecycle; existing controller, lease, profile and persistence test doubles. Nineteen pre-existing tests pass. Four added controls: two counterexamples RED, genuine setup failure and unconfirmed-shutdown controls PASS. |

The preliminary component run failed before assertions because the fixture omitted providers; it is not product evidence. The subsequent run uses the repository's normal provider wrapper. Preliminary navigation fixture contamination was corrected with explicit mock defaults and shutdown state applied after the pending Start was reached. Only results above are the final executed results.

## Case13: precise conclusions

Positive controls establish that unavailable-engine rejection never calls initialization, while returned initialization errors and rejected initialization promises reach INIT_FAILED with a visible enabled Retry. Clicking the real Retry invokes a second initialization and reaches READY. A cache miss renders the download action; ordinary successful teardown returns to idle.

Counterexamples:

1. After an actual initialization failure, public `destroy()` changes the DOM model status from `init-failed` to `idle`; the Retry presentation is lost.
2. Public `reset()` after that failure also removes Retry, without an explicit successful recovery.
3. When successor service B is observably loading, late destruction of old service A projects `idle` into the shared DOM status. B's initialization is settled before the test completes, so no deferred promise is abandoned.

Responsible projection boundaries to inspect are TranscriptionService.handleStateChange (TERMINATED -> idle), destroy's reset and reset's unconditional foreground store status. These are demonstrated sequences, not proof that all are normally reachable through the singleton service factory. In particular, the A/B projection counterexample does not establish production concurrent-service creation. No original case13 trace or case4/case12 cause is inferred from it. Initialization failure itself is not universally invisible: the pre-teardown positive controls prove the narrower distinction.

An App correction should preserve unresolved failure and actionable Retry until explicit owned recovery, fence old-instance DOM/store publication, and keep the ordinary-success-teardown control passing. Do not globally map every TERMINATED state to a permanent failure.

## Navigation: precise conclusions

The new probes invoke the real hook Start, hold the controller Start promise, and unmount the hook without adding a Try-again cancellation marker. A late `RECORDING_INTENT_RETIRED:*` rejection is wrongly treated as a new setup failure.

* Pending Start -> leave -> retired rejection calls `reset('start_failed')`.
* A leaves; B starts under a new attempt; A's late retired rejection causes one reset, one recording_start_failed event and an error status in B's shared store. This test observed **zero lease releases** with B's shutdown unconfirmed. It does not claim an actual engine destruction or production lease release was executed: those boundaries are fakes. The defect is the real hook's unsafe reset/error request and owner confusion.
* A genuine current setup error still reports error and requests reset (PASS).
* If shutdown remains unconfirmed on unmount/late rejection, the lease is not released (PASS).
* Existing Try-again-marked late-cancellation and remount controls remain PASS; navigation lacks that marker and must be handled using originating mount/attempt ownership.

App must reconcile **both catch layers** in useSessionLifecycle: the inner start catch settles failed latency and invokes releaseTakeLeaseOnProof before the outer catch handles reset/telemetry/status. An old/cancelled attempt must not query/release a successor's current lease or reset its engine. Preserve genuine current failure reporting, finalization fences, and unconfirmed-shutdown protection. This packet supplies regression evidence, not a product patch or operational authorization.

## Reproduce

Use repository pnpm10.29.1 and existing dependencies. No model download, microphone, Auth mutation, provider call, live run, migration or deployment is needed.

```bash
node scripts/host-interlock.mjs hold local -- pnpm exec vitest run \
  --config frontend/vitest.config.mjs --coverage.enabled=false --maxWorkers=1 \
  frontend/src/components/session/__tests__/BrowserPm.modelFailure1593.test.tsx

node scripts/host-interlock.mjs hold local -- pnpm exec vitest run \
  --config frontend/vitest.config.mjs --coverage.enabled=false --maxWorkers=1 \
  frontend/src/hooks/__tests__/useSessionLifecycle.recordingIntent.test.tsx
```

Expected baseline: three RED assertions in the first command and two in the second. These are intentionally failing acceptance regressions on unchanged product code; this evidence branch is not a green merge candidate. After App publishes its exact correction, rerun the unchanged controls against that head and record whether the specific counterexamples close. Source acceptance, live case acceptance and human/device observations remain separate.
