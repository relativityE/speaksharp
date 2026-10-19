# Case 3 pre-Start marker observation preparation

Parent: #1593. CLI owns the isolated observer/tests. App retains the unmerged Focus finalizer changes in #1662. Sam selected route (a): caller wiring after #1662 lands, with no stacked replacement and no competing writer. This packet is source preparation; it is not an integrated journey or live case closure.

## Cause already established versus unknown

The historical 9.40s first sample cannot distinguish a marker mutation at 8.90s from one at 9.10s against the next-point deadline of 9.02s. The current journey begins its 500ms polling after setup/Start. A separate actual-rendered-view probe established that provisional words can be visible while the rail waits for committed text. Neither observation attributes the original late sample to a particular product boundary.

The new collector closes that measurement gap prospectively. It arms before the first possible activation, captures marker old values and their observation intervals, retains intermediate covered-to-pending changes, and drains undelivered records before its synchronous closing read. A heartbeat advances lower bounds only after draining pending records. If an event-loop stall spans a deadline, the interval remains ambiguous; callback time must not be substituted for exact mutation time.

## API and integration boundary

`armMarkerTimeline(page, points)` returns an opaque window token. Arm it immediately before the first `selectBenchmarkMode` / `preparePrivateModelIfPrompted` sequence, since cold setup may itself start the take. Always pair it with `closeMarkerTimeline(page, token)` in a `finally`, including failed setup. Do not arm after the recorded take has begun.

The realm-local token and retained rail/point identities prevent a same-URL replacement from inheriting observations. `null` close, any `observationFailures`, a non-unique acquisition, replacement or truncation are missing/invalid evidence and must not produce a passing timing row. The collector returns no PASS verdict. Never overwrite the historical FAIL with a newly collected result.

The first received non-pending transition per point contains `earliestMs` and `observedMs` relative to arm. Keep both bounds through any audio-window comparison. Point ordering that cannot be established from non-overlapping intervals remains unknown. Retain the existing fixture windows, 5-second/next-point deadlines and original outcomes; do not widen them to make a result pass.

The collector joins only acquisition candidates appended during this window and retains `armedWallMs` for the request-clock join. The existing counter timestamps getUserMedia **requests**, not independently proven audio onset. `audioOnsetVerified` is therefore explicitly false. A separately verified audio-origin binding is needed before treating these intervals as exact audio-time proof. Clock changes are explicit loss.

Rendered transcript observations contain character counts and timestamps only. They expose no transcript text, point labels or audio. `committedCharacters` is explicitly null: actual LiveTranscript rendering can make a provisional filler and a committed filler byte-identical in the DOM. These observations cannot establish authoritative transcript-commit time or select a product fix on their own. App owns any needed source instrumentation under a separate narrow handoff.

## Executed controls

Actual jsdom MutationObserver controls cover both historical 8.9/9.1 schedules, blocked callback ambiguity, close-before-callback, intermediate transitions, pre-Start capture, document/window mismatch, pagehide/BFCache loss, rail/point/transcript replacement, missing/reset/rewritten mic marks, invalid clocks, unique acquisition, serialization into a separate VM realm and bounded runaway mutation capture. The self-contained page functions execute without Node/module closures; only the Node-side wrapper generates a token.

Initial 20 controls passed, then 23, then 28. `final-collector-bounded.json` is the final isolated control receipt. Quality and repository path checks are recorded in ACTIVE_HANDOFF at the completed checkpoint. Raw JSON bytes are retained privately before portable machine-path normalization. No live/browser/model/provider/account/DB/merge/deployment execution is implied.
