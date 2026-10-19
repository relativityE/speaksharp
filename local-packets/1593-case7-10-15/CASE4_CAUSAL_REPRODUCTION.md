# Case 4: repeatable disabled-Start mechanism, including persistent timeout

CLI investigation, 19 October 2026, source based on main `ba1a9f5ad31778460a4ea9e383a08be14b3222f6`. Test-only correction to the earlier “cause unknown” handoff: this packet establishes a concrete recurring mechanism, not merely indistinguishable gate inputs.

## Finding

**Model idle is not completion of Start cancellation.** `TranscriptionService.destroy()` publishes cleanup/termination as model `idle` before awaited engine termination completes. `SpeechRuntimeController.retireEngineForUnmount()` detaches the service but does not transition its own runtime to TERMINATED/IDLE until destruction finishes. During that interval, the real lifecycle hook disables Start while the actual MicCard advertises “Mic ready on this device” and labels the disabled button “Start recording”. `isTranscriptFinalizing` is false.

**A retirement timeout makes this persistent.** If the destruction promise outlasts the bound (production default 10s), `retireEngineForUnmount()` returns `unconfirmed` before the TERMINATED/IDLE transitions. Later successful destruction has no continuation to complete those transitions. The controller/store remain ENGINE_INITIALIZING or DOWNLOAD_REQUIRED even though the service is detached and finished. Return `warmUp()` reuses a resolved infrastructure readiness promise; with no attached service it neither recreates/warm-ups a service nor corrects runtime. The record control stays disabled. This is a missed completion/reconciliation path, not a finalization latch.

## Causal sequence and repetitions

The tests call the real controller and real TranscriptionService, then mount the real `useSessionLifecycle` + MicCard. Only account/query/recognition boundaries and the engine adapter are controlled; no runtime state, model state, finalization latch or button prop is forced to manufacture the failure.

1. Initial `warmUp('private')` establishes the infrastructure promise, as the first page visit does.
2. Actual `startRecording()` enters model initialization or the cold DOWNLOAD_REQUIRED path. Engine initialization/termination promises provide controlled timing; no real inference/download/provider call occurs.
3. Navigate/unmount via the real retirement path. Service cleanup publishes model idle; controller/store retain the preparing state until cleanup returns.
4. Run the return warm-up and mount the actual lifecycle hook/MicCard. Assert all four retained failure fields: model idle, plain Start recording, disabled true, “Mic ready on this device”. Assert finalization false. The state remains through a real 2.1s hold, exceeding the live caller's two-second post-settlement pause.
5. **Early-completion control:** release termination before the bound. Controller/store become IDLE and the same rendered button enables.
6. **Late-completion casualty:** expire the bound, then successfully release termination. Controller/store remain preparing; return warm-up does not recover; the actual button remains disabled. A real hard-reset control changes runtime to IDLE and enables that same button.

Executed: **10/10 early-window repetitions** (5 initialization, 5 cold/download-required) and **2/2 persistent timeout controls**. The timeout controls use the public method's explicit 100ms bound to exercise the same branch quickly; production's default is 10,000ms. No special exception or forced failure is substituted for actual late successful termination.

An initial probe without the first-page warm-up failed to retain the symptom: the first return initialized infrastructure and moved runtime READY. Adding the real first-visit warm-up makes the cached-readiness condition explicit and repeatable. This negative control explains why an incomplete fixture can miss the defect.

## Responsible source boundaries

- `frontend/src/services/transcription/TranscriptionService.ts`, `destroy()` and `handleStateChange()`: CLEANING_UP/TERMINATED project model idle; engine termination is awaited separately.
- `frontend/src/services/SpeechRuntimeController.ts`, `retireEngineForUnmount()`: the timeout/rejection branch returns before its final runtime transitions; no owner-bound late-completion reconciliation follows.
- Same controller, `initializeInfrastructure()` / `warmUp()`: resolved infrastructure readiness survives retirement; null-service warm-up silently performs no recovery.
- `frontend/src/hooks/useSessionLifecycle.ts`: runtime preparation legitimately disables Start; finalization is false in this reproduction.
- `frontend/src/components/session/MicCard.tsx`: model idle selects ordinary ready wording while `disabled` from the runtime gate remains true.
- `tests/live/rwt-pending-start-navigation.live.spec.ts`: treats any readable model status other than loading as settled. That predicate can pass at the beginning of cleanup; its two-second pause is not a controller-retirement proof.

## App correction target

App remains sole product writer. Repair retirement completion as an ownership-bound operation. Preserve a truthful pending/unconfirmed action while cleanup is incomplete. On late successful termination, reconcile only the retiring generation/service/lease; never transition or clear a successor's runtime, finalization, Progress or lease. Rejected or still-hung termination must not claim cleanup succeeded or release recording authority. Ensure a subsequent visit rebuilds missing service/readiness coherently instead of trusting a resolved infrastructure promise with no service.

Keep the existing no-late-recording, actual engine-termination, recoverable Retry Save and successor-isolation controls. Add owned late-success versus rejected/hung/superseded retirement controls. Do not fix this by force-enabling Start, hiding the runtime blocker, blindly hard-resetting on navigation or clearing valid finalization.

The live cancellation oracle should bind the actual retirement/runtime/action state within its approved bound; model idle alone cannot prove cancellation settled. Preserve the original failure and original two-second observation when adding richer evidence.

## Attribution limit and reproduction command

This proves how the same symptom happens repeatedly on current source. Original run `39179780974` has no retained termination timing/runtime snapshot at return, so exact attribution of that historical row still requires the source-bound observation; this packet does not relabel it PASS or claim a new live run.

```sh
pnpm exec vitest run --config frontend/vitest.config.mjs --coverage.enabled=false \
  frontend/src/services/__tests__/unmountEngineRetirement1476.test.ts -t 'case4 causal'
```

The expanded tests are diagnostic characterizations of the failing source, with completion/reset negative controls. App's correction should replace the stuck-state expectations with owned recovery acceptance while preserving all independent safety controls.
