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
was retired once its assertions moved into the canonical suite below.

## Fix

The page passes its verdict: `stopRecording({ belowMinimumDuration: true })`. The
controller then resolves the take by discard: a row created at Start is marked
`failed` ("shorter than the minimum duration"), no row is created at Stop when none
exists, nothing is completed, and the runtime returns to READY with finalizing
released and no saved marker. The threshold stays where it was decided before: the
page's live clock and `MIN_SESSION_DURATION_SECONDS` (5). External stops (a stop
reason: usage limit, maximum length, inactivity) are unchanged and still save.

## Canonical regressions

- `frontend/src/hooks/__tests__/useSessionLifecycle.shortStopIntegration.test.tsx`:
  real hook and real controller. 3 s and 4.999 s are told too short and complete
  nothing; 5 s completes; a 3 s external stop still completes.
- `frontend/src/services/__tests__/SpeechRuntimeController.shortTake.test.ts`: real
  controller. Marked failed, never completed; words decoded during finalization do
  not change that; no late row at Stop; READY, finalizing released, not saved;
  positive control without the verdict completes.
- `frontend/src/hooks/__tests__/useSessionLifecycle.recordingIntent.test.tsx`: the
  short branch passes the verdict, a 5.3 s take does not.

No live database write, AHT run or probe-duration claim for AHT-03 run 43585559387 is
made here. Fixture text is synthetic.
