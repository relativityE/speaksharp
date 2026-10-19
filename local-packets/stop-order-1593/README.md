# Cases 2/3: integrated Stop/evaluation ordering regression

Baseline: main `ecce3e8d9e154ddb12f7238a514f0ec85d4b75b4` (19 October 2026 UTC). Test-only packet; App owns the correction.

Run:

```text
pnpm exec vitest run --config frontend/vitest.config.mjs --coverage.enabled=false --reporter=dot frontend/src/services/__tests__/SpeechRuntimeController.test.ts -t '#1593 integrated Stop ordering'
```

The full/partial Focus fixtures call the actual `SpeechRuntimeController.stopRecording()` and await its normal completion, persistence, objective-evaluation and teardown path. The engine, storage, attestation and server-evaluation adapters are fakes; this is local integration evidence, not browser/device/server qualification. Only the external user-input `stop_intent` is marked by the harness. It never marks `final_transcript` or calls the private evaluation helper directly.

Actual emitted analytics-buffer rows, in capture order, are:

```text
recording_terminated -> evaluation_complete -> final_transcript
```

Both required-order assertions are RED on the baseline. Before those assertions, controls verify one final/evaluation event each, all stage rows carry the take's minted attempt ID, and completion/objective/Progress adapter calls carry the same session ID. An Open Mic control passes with termination then final transcript and no Focus evaluation. The test holds objective evaluation and engine destruction separately: `isTranscriptFinalizing` stays true during both waits, then clears only at the existing terminal release. No production latch or gate was changed.

Execution on the final test revision: full controller file **152 PASS, 2 expected FAIL** (154 total), exit 1 solely at the two added ordering assertions. Scoped ESLint and frontend TypeScript checks pass. The earlier direct emission test manually marks `final_transcript` before invoking `finalizeObjectiveAndGateProgress`, so its green result cannot establish the integrated ordering.

## Correction boundary for App

The current `useSessionStore.setTranscriptFinalizing(false)` emits `final_transcript` (store line 672). Normal Stop reaches this only at `releaseFinalizingIfOwner('normal_terminal')` after awaited `completeProgressForRecording`; successful owned Focus evaluation already emitted `evaluation_complete` at controller line 6572. This makes the reversal independent of coaching-provider quota behavior in these controls.

Transcript authority and Start admission are separate facts. On the successful owned Stop path, final decode has returned before candidate selection at controller lines 5400–5430; the selected final text is then published to the working store around lines 5669–5670, before completion/evaluation. App should place the take-bound transcript-terminal observation at the authoritative final-selection/publication boundary, with owner/failure guards and without moving the Start-blocking latch, Progress gate, terminal purge, or evaluation itself. Do not manufacture a final transcript for a hung/failed decode. Existing once-per-take and stale-owner rules must remain. This packet recommends the responsible boundary; it contains no product fix or claim of live case closure.
