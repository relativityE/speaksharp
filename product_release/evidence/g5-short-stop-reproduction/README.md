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
too). Once it is settled, its "couldn't finish clearing it" warning is replaced by the
message a settled discard shows, and a status published after the warning is left alone.
The no-speech discard shares that branch and gets the same handling.

The unsettled row is also recorded on this device for its owner (session id, owner and
the fixed reason; no content). A reload or hard reset drops the in-memory Try again; the
same owner's return re-arms it for the same row, and no other account sees it. A
sign-out followed by another account's sign-in on the same page keeps it too (the record
is written again on release). A confirmed retry or Discard clears the record.

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
  row; a confirmed Discard settles it; a settled retry replaces only its own warning;
  after a hard reset the owner's return re-arms Try again for the same row and another
  account's does not; the owner recorded is the take's own, never a successor's that
  starts during the stop; a failed Try again keeps the record; another account's live
  live slot is released on sign-in together with its lock, as a reload would release it,
  and its owner's record is written first; a superseded stop still records the row for its owner; a
  confirmed mark or Discard leaves no record and an ownerless take writes none; an
  account change retires the departing owner's re-armed slot and keeps the record;
  positive control without the verdict completes.
- `frontend/src/components/session/__tests__/UnresolvedRecoveryBanner.test.tsx`: the
  unsettled-discard banner offers only Try again.
- `frontend/src/services/__tests__/pendingColdStartReturn.aht04.test.ts`: its
  record-and-save journey stopped after about 60 ms and expected a completed save,
  i.e. it asserted the defect. Its live clock is now moved past the minimum before
  Stop; the minimum itself is not lowered.
- `frontend/src/hooks/__tests__/useSessionLifecycle.recordingIntent.test.tsx`: the
  short branch passes the verdict, a 5.3 s take does not.
- `tests/e2e/signal-contract.e2e.spec.ts`: its saved-take contract stopped at once and
  waited for a saved session, relying on the defect; it now records past the minimum.

## Queued Stop race (#1880, fixed)

Before: a Stop without the verdict (a lease revocation, a page leave) queued just
before the user's short Stop completed the take; the user's Stop then found the take
already stopped, and the page still said "Session too short" about a saved take.

After: the user's verdict is registered when its Stop is called, before any queued turn
runs, and an earlier Stop for the same take reads it at its save decision, so the take
the page calls too short is discarded. Every Stop call is told how its take was
actually resolved (`discarded`, `discard_unsettled`, `completed` or `unknown`); the page
reports too short only when the take was not completed. The verdict is cleared once
the take is decided and on hard reset, and a verdict for one take never applies to the
next (recording ids are unique). A Stop pressed while the take is already STOPPING is
still suppressed by the page, as before (#1258 R1).

Tests (each fails when its guard is removed):
- `frontend/src/services/__tests__/SpeechRuntimeController.queuedShortStop.test.ts`: a
  short Stop while the earlier Stop is finalizing discards the take and both calls see
  `discarded`; a short Stop after the earlier Stop decided to save is told `completed`
  and nothing is marked failed; an unconfirmed discard is reported `discard_unsettled`
  with Try again armed; a verdict for an earlier take does not discard the next take; a
  Stop with nothing recording reports `unknown`.
- `frontend/src/hooks/__tests__/useSessionLifecycle.shortStopIntegration.test.tsx`: the
  page's short Stop pressed just after an unverdicted Stop was queued discards the take
  (nothing completed, too short shown); a take the controller reports `completed` is
  never reported too short.

## Known gaps (not fixed here, for review)

- Leaving the page ("Stop and save this session before leaving?"), route-exit
  teardown and a revoked lease call the controller's Stop with no verdict, so a take
  under five seconds still completes on those paths when the user has not pressed Stop.
  The Product Owner's rule covers a manual Stop under five seconds; whether these
  non-manual stops should also discard is for Sam to confirm or defer. No test covers these paths yet;
  the integration suite carries a KNOWN GAP comment instead of a pending test, because
  the changed-test execution evidence accepts only tests that run.
- An explicit sign-out clears all site storage (`AuthProvider.signOut` calls
  `localStorage.clear()`), so a sign-out followed by a reload or closed tab loses the
  record and the owner's Try again, as it already loses the recovery draft. Keeping the
  key through sign-out is a separate decision about what sign-out clears.
- The record of an unsettled discard lives on the device that recorded the take. The
  owner signing in on another device, or clearing site data, does not see Try again
  there; the row's obligation then stays unsettled until it is retried on the original
  device. A take with no known owner is not recorded. The record is re-armed for 24 hours
  at most, so a failure that can never succeed (the row or profile is gone, or the trial
  has lapsed) cannot lock the owner on that browser indefinitely. Past that bound the
  row's admitted save obligation stays unsettled with no client path to settle it (no
  timer or lease delete settles a save, per the #1643 journal), which blocks account
  completion. The bound trades an indefinite lock for that; Sam to decide whether to keep
  it, lengthen it, or keep the record without locking Start.

No live database write, AHT run or probe-duration claim for AHT-03 run 43585559387 is
made here. Fixture text is synthetic.
