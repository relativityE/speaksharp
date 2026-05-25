# Native Browser STT Second-Opinion Packet - 2026-05-25

## Current Verdict

Native Browser STT is still RC-red and launch-critical. It is the low-friction onboarding STT path that trial users are likely to try first, so it cannot be scoped out or labeled as merely experimental for this release. The implementation now has the recommended non-continuous Chrome/Edge strategy and detailed trace logging, but the latest browser proof did not produce a useful transcript.

## Evidence Artifact

- Synthetic browser artifact: `/private/tmp/speaksharp-native-say-trace-1779704244115.json`
- Environment: local `4173`, Chrome CDP on `9222`, live backend flags, macOS `say` as synthetic speaker.
- Spoken phrase:
  > um the stale smell of old beer like lingers. uh a dash of pepper spoils beef stew. like the box was thrown beside the parked truck.

## Observed Result

| Metric | Value |
|---|---:|
| First visible text | `8.655s` |
| Transcript before stop | `on the` |
| Console errors | `0` |
| Page exceptions | `0` |
| Network failures | `0` |

The code path is no longer failing noisily, but the provider result is not release-quality.

## Current Implementation Facts

- `frontend/src/services/transcription/sttConstants.ts`
  - `NATIVE_STT.CONTINUOUS = false`
  - `NATIVE_STT.RESTART_DEBOUNCE_MS = 300`
  - `NATIVE_STT.INTERIM_RESULTS = true`
- `frontend/src/services/transcription/modes/nativeBrowserStrategies.ts`
  - Chrome and Edge resolve to the verified strategy.
  - Safari and generic browsers receive explicit user-facing fallback copy.
  - Result extraction deduplicates finalized result indexes and respects `event.resultIndex`.
- `frontend/src/services/transcription/modes/NativeBrowser.ts`
  - Traces `onstart`, `onaudiostart`, `onspeechstart`, `onresult`, `onerror`, `onend`, restart attempts, and parallel mic capture.
  - Treats `no-speech` as recoverable warning/trace instead of an unrecovered fatal error.
  - Restarts after `onend` only while `isListening` and not already restarting.
  - Guards `recognition.start()` and restart failures with actionable logs.

## Key Question For Review

Given the current non-continuous Web Speech strategy, is there an implementation bug left that could explain the poor Chrome result, or is this now a provider/environment limitation that should be handled as product positioning?

Specific areas to inspect:

1. Readiness signal:
   - Current code calls `onReady` from the first of `onaudiostart` or `onspeechstart`.
   - If UX must mean "speak now," should readiness be gated to `onspeechstart` only?

2. Restart timing:
   - Current debounce is `300ms`.
   - Confirm whether Chrome drops audio during the restart gap in realistic speech.

3. Result extraction:
   - Current logic ignores result indexes below `event.resultIndex` and deduplicates final indexes.
   - Confirm whether this is correct for Chrome with `continuous=false`.

4. Release posture:
   - If a real human Chrome pass also fails, launch remains blocked until Native is fixed or a replacement low-friction onboarding STT path is proven.

## Required Next Artifact

Native can only move out of red with a real human Chrome artifact:

- Real Chrome, real mic, no fake audio, no macOS `say`.
- Spoken phrase contains known Harvard sentence words.
- Pass criteria:
  - First result contains recognizable words from the spoken phrase.
  - No repeated 4-word sequence.
  - No unrecovered `onerror`.
  - Session saves and appears in History.
