# G5: short Stop requests completed persistence

## Defect (reproduced, now fixed)

On `adc70cd23765f13c7a2c7ce04e6e80a30abb7009`, the page measured a take on the live
clock, found it under the five-second minimum and told the user "Session too short",
but stopped it with the ordinary controller Stop (`useSessionLifecycle.ts`, the
minimum-duration branch). The real `SpeechRuntimeController.stopRecording()` had only
an empty/non-speech guard, so a three-second take with meaningful words reached the
storage boundary as:

```json
[{"status":"completed","duration":3}]
```

The standalone diagnostic that showed this (expected 0 completed calls, received 1)
was retired once its assertions moved into the canonical suite below. This is a local
real-controller reproduction; the live AHT-03 run proves a persisted probe row after a
short Stop, not that row's duration.

## Fix

The page passes its verdict: `stopRecording({ belowMinimumDuration: true })`. The
controller then resolves the take by discard: its row (created at Start, or late at
Stop like any take without one) is marked `failed` ("shorter than the minimum
duration"), which also settles the lease's save obligation; nothing is completed,
and the runtime returns to READY with finalizing released and no saved marker. The
page shows its own "Session too short" message. The threshold stays where it was decided before: the
page's live clock and `MIN_SESSION_DURATION_SECONDS` (5). External stops (a stop
reason: usage limit, maximum length, inactivity) are unchanged and still save.

A discard counts only when its `failed` mark is confirmed. If storage returns
`{ success: false }` or throws, the take was not saved but its row and lease obligation
are not confirmed settled: the take stays unresolved and locked, the page says so, and
Try again re-runs the same `failed` mark on the same row (a confirmed Discard settles it
too). The no-speech discard shares that branch and gets the same handling.

## Canonical regressions

- `frontend/src/hooks/__tests__/useSessionLifecycle.shortStopIntegration.test.tsx`:
  real hook and real controller. 3 s and 4.999 s are told too short and complete
  nothing; an unconfirmed `failed` mark is not reported discarded and offers Try
  again; 5 s completes; a 3 s external stop still completes.
- `frontend/src/services/__tests__/SpeechRuntimeController.shortTake.test.ts`: real
  controller. Marked failed, never completed; words decoded during finalization do
  not change that; a take with no row gets one at Stop only to mark it failed;
  READY, finalizing released, not saved; `{ success: false }` and a throw each leave
  the take unresolved, a repeat failure stays retryable and Try again settles the same
  row; a confirmed Discard settles it; positive control without the verdict completes.
- `frontend/src/components/session/__tests__/UnresolvedRecoveryBanner.test.tsx`: the
  unsettled-discard banner offers only Try again.
- `frontend/src/services/__tests__/pendingColdStartReturn.aht04.test.ts`: its
  record-and-save journey stopped after about 60 ms and expected a completed save,
  i.e. it asserted the defect. Its live clock is now moved past the minimum before
  Stop; the minimum itself is not lowered.
- `frontend/src/hooks/__tests__/useSessionLifecycle.recordingIntent.test.tsx`: the
  short branch passes the verdict, a 5.3 s take does not.

## Known gaps (not fixed here, for review)

- Leaving the page ("Stop and save this session before leaving?"), route-exit
  teardown and a revoked lease call the controller's Stop with no verdict, so a take
  under five seconds still completes on those paths. Pending test:
  "KNOWN GAP: leaving the page during a take under the minimum saves no completed
  session" in the integration suite.
- A stop without the verdict that is queued just before the user's short Stop (for
  example a lease revocation) can complete the take; the user's Stop then finds
  READY and the page still says "Session too short". Pre-existing and narrow.
- An unsettled discard is held in memory only: a reload or hard reset drops Try again
  and the row's save obligation stays unsettled.

No live database write, AHT run or probe-duration claim for AHT-03 run 43585559387 is
made here. Fixture text is synthetic.
