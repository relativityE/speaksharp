# STT Constants Audit

Date: 2026-05-23

Purpose: collect the shared and engine-specific STT audio lifecycle constants in one place before further production changes. This is diagnostic documentation only.

## Desired Shape

STT should have one shared constants contract for values that are truly common, plus explicit mode-specific sections where Private, Native Browser, and Cloud must differ.

Recommended code home: `frontend/src/services/transcription/sttConstants.ts`

## Shared Audio Contract

| Constant | Current source(s) | Current value | Notes |
|---|---|---:|---|
| Target STT sample rate | `frontend/src/config.ts`, `PrivateWhisper.ts`, `CloudAssemblyAI.ts`, `TransformersJSEngine.ts`, audio helpers | `16000` | This should be one shared `STT_AUDIO_SAMPLE_RATE_HZ`. |
| Mic input AudioContext rate | `frontend/src/services/transcription/utils/audioUtils.impl.ts` | `48000` | Browser input is forced to 48 kHz, then downsampled to the target STT rate. This should be named as source rate, not confused with STT rate. |
| Audio worklet render quantum | browser platform / `audio-processor.worklet.ts` comment | `128` source samples per callback | At 48 kHz this is about 2.67ms before downsampling. Tests using giant frames do not mimic this cadence. |
| Default audio frame size option | `frontend/src/config.ts`, `audioUtils.impl.ts` | `1024` | Passed into worklet options but the current worklet interface does not define or use `frameSize`. |
| Pause RMS threshold | `frontend/src/config.ts` | `0.01` | Used by `PauseDetector`; should be validated with real browser RMS logs for quiet speech and room noise. |
| Minimum silence/pause duration | `frontend/src/config.ts` | `500ms` | Wall-clock based. Tests should model realistic frame cadence if this gates transcription. |
| STT strategy init timeout | `frontend/src/config.ts` | `5000ms` | Important for Private warmup and mode readiness. |
| STT heartbeat timeout | `frontend/src/config.ts` | `30000ms` | Shared lifecycle watchdog. |
| Visible failure hold | `frontend/src/config.ts` | `1500ms` failure, `2500ms` visible hold | Shared UI/runtime timing. |

## Private STT Lifecycle

| Constant | Current source | Current value | Notes |
|---|---|---:|---|
| Private sample rate | `PrivateWhisper.ts` | `16000` | Duplicates shared STT sample rate. |
| Minimum transcription window | `PrivateWhisper.ts` | working tree `5s`; committed prior `8s`; older evidence `4.25s` | Highest-risk mismatch. This directly controls visible transcript latency. |
| Minimum transcription samples | `PrivateWhisper.ts` | working tree `80000`; committed prior `128000`; older evidence `68000` | Should be derived only through `secondsToSamples()`. |
| Processing poll interval | `PrivateWhisper.ts` | `250ms` | Tests/comments still refer to `500ms` or `1000ms` in places. |
| Retry retention | `PrivateWhisper.ts` | `12s` / `192000` samples | Empty inference can cause stale audio to be re-fed into later windows. |
| Whisper model window | `TransformersJSEngine.ts` | `30s` | Matches Whisper native mel window. |
| Whisper stride | `TransformersJSEngine.ts` | `0s` when input `<30s`; otherwise `5s` | Should be named and tested. |
| Stop-path force behavior | `PrivateWhisper.ts` | bypasses min window and silence gate | Can still transcribe near-empty/noisy buffers unless explicitly guarded. |
| Trace WAV encoding sample rate | `PrivateWhisper.ts` | `16000` default | Should use shared STT sample rate. |

## Cloud STT Lifecycle

| Constant | Current source | Current value | Notes |
|---|---|---:|---|
| Cloud sample rate | `CloudAssemblyAI.ts`, `STT_CONFIG` | `16000` | Duplicates shared STT sample rate. WebSocket URL also hardcodes `sample_rate: '16000'`. |
| Cloud encoding | `CloudAssemblyAI.ts` | `pcm_s16le` | Should be named with provider contract. |
| Provider speech model | `CloudAssemblyAI.ts` | `universal-streaming-english` | Mode-specific provider constant. |
| Minimum packet duration | `frontend/src/config.ts` | `50ms` | AssemblyAI provider requirement. |
| Maximum packet duration | `frontend/src/config.ts` | `1000ms` | Defined but the implementation currently flushes at minimum packet size. |
| Minimum packet samples | `frontend/src/config.ts`, `CloudAssemblyAI.ts` | `800` at 16 kHz | Should be derived from shared sample rate and packet duration. |
| Maximum packet samples | `frontend/src/config.ts` | `16000` at 16 kHz | Defined, but needs explicit enforcement/audit in queue flushing. |
| Max queued audio frames | `CloudAssemblyAI.ts` | `4000` | Mode-specific backpressure guard. Needs duration equivalent in logs. |
| Reconnect attempts | `CloudAssemblyAI.ts` | `5` | Mode-specific network lifecycle constant. |
| Base reconnect delay | `CloudAssemblyAI.ts` | `1000ms` | Exponential backoff with jitter. |
| Reconnect jitter | `CloudAssemblyAI.ts` | `0-200ms` | Hardcoded. |
| Socket close safety timeout | `CloudAssemblyAI.ts` | `2000ms` | Hardcoded shutdown guard. |

## Native Browser STT Lifecycle

| Constant / setting | Current source | Current value | Notes |
|---|---|---:|---|
| Native API | `NativeBrowser.ts` | `SpeechRecognition || webkitSpeechRecognition` | Browser-controlled STT, not app PCM chunks. |
| Interim results | `NativeBrowser.ts` | `true` | Should be named in the STT constants contract even though not numeric. |
| Continuous recognition | `sttConstants.ts` / `nativeBrowserStrategies.ts` | `false` for configured strategies | Chrome/Edge now use short Web Speech sessions with app-controlled restart. |
| Restart strategy | `sttConstants.ts` / `NativeBrowser.ts` | `RESTART_DEBOUNCE_MS = 300`, then `retryWithBackoff(0)` on start failure | Backoff constants are named in `NATIVE_STT`. |
| Final result dedupe | `NativeBrowser.ts` | `Set<number>` result indexes | Lifecycle behavior, not a timing constant, but important for duplicated transcript bugs. |
| Stable interim behavior | `NativeBrowser.ts` | `lastInterim` replacement | Covered by NativeBrowser contract tests. |
| Permission check | `NativeBrowser.ts` | `navigator.permissions.query({ name: 'microphone' })` | Browser permission lifecycle belongs in the shared STT readiness contract. |

## Fixtures And Stimulus

| Area | Current source | Current value | Notes |
|---|---|---:|---|
| Harvard fixture generation | `scripts/generate-harvard-audio.mjs` | `say -v Alex`, `LEI16@16000` | Good: fixture sample rate matches STT sample rate. |
| Filler fixture generation | `scripts/generate-fixtures.sh` | `say -r 140 -v Alex`, then `ffmpeg -ar 16000 -ac 1` | Good sample rate, but speaking rate differs from manual Native proof script. |
| Native manual proof script | `scripts/manual-native-chrome-proof.mjs` | `say -v Samantha -r 165` | Different voice/rate from fixtures. Label evidence accordingly. |

## Contradictions Found

1. Sample rate is duplicated across config, Private, Cloud, TransformersJS, and audio helpers.
2. Private STT now has named first-transcript thresholds, but release evidence still needs a fresh real-human browser artifact.
3. Private unit tests and comments still assume older polling windows (`500ms` or `1000ms`) while production polls every `250ms`.
4. Cloud defines both min and max packet sizes, but the implementation visibly derives only the min flush size in the inspected section.
5. Cloud hardcodes `sample_rate: '16000'` in the provider URL instead of deriving from the same sample-rate constant.
6. Native Browser lifecycle settings are now named, but real Web Speech behavior still requires a fresh Chrome mic artifact.
7. PauseDetector's rolling-window comment says about 5 seconds at 100ms updates, but the real worklet can deliver much smaller frames.
8. Private stop-time forced inference bypasses the min-window and silence gate.
9. Private silence skipping clears live audio but does not clearly clear retained retry audio, so stale retry buffers can survive silence.
10. Manual/browser audio stimuli use different voices and rates, so results are not directly comparable unless evidence records stimulus settings.

## Proposed STT Constants Module

Create a single source of truth with this shape:

```ts
export const STT_AUDIO = {
  TARGET_SAMPLE_RATE_HZ: 16_000,
  MIC_CONTEXT_SAMPLE_RATE_HZ: 48_000,
  WORKLET_RENDER_QUANTUM_SOURCE_SAMPLES: 128,
  DEFAULT_FRAME_SIZE_SAMPLES: 1024,
} as const;

export const STT_PAUSE = {
  SILENCE_RMS_THRESHOLD: 0.01,
  MIN_SILENCE_MS: 500,
  ROLLING_RMS_WINDOW_FRAMES: 50,
} as const;

export const PRIVATE_STT = {
  MIN_TRANSCRIPTION_SECONDS: /* choose once */,
  PROCESSING_INTERVAL_MS: 250,
  MAX_RETRY_SECONDS: 12,
  WHISPER_WINDOW_SECONDS: 30,
  WHISPER_STRIDE_SECONDS: 5,
} as const;

export const CLOUD_STT = {
  SAMPLE_RATE_HZ: STT_AUDIO.TARGET_SAMPLE_RATE_HZ,
  ENCODING: 'pcm_s16le',
  SPEECH_MODEL: 'universal-streaming-english',
  MIN_PACKET_MS: 50,
  MAX_PACKET_MS: 1000,
  MAX_QUEUED_AUDIO_FRAMES: 4000,
  MAX_RECONNECT_ATTEMPTS: 5,
  BASE_RECONNECT_DELAY_MS: 1000,
  RECONNECT_JITTER_MS: 200,
  SOCKET_CLOSE_TIMEOUT_MS: 2000,
} as const;

export const NATIVE_STT = {
  INTERIM_RESULTS: true,
  CONTINUOUS: true,
  RESTART_BACKOFF_INITIAL_MS: /* inspect and choose */,
  RESTART_BACKOFF_MAX_MS: /* inspect and choose */,
} as const;

export const secondsToSamples = (seconds: number, sampleRate = STT_AUDIO.TARGET_SAMPLE_RATE_HZ) =>
  Math.round(seconds * sampleRate);

export const samplesToSeconds = (samples: number, sampleRate = STT_AUDIO.TARGET_SAMPLE_RATE_HZ) =>
  samples / sampleRate;
```

## Acceptance Rule

Do not accept further STT timing changes until:

1. Private, Cloud, Native, tests, and scripts import or reference the STT constants contract.
2. No raw `16000`, `48000`, `68000`, `80000`, `128000`, `250`, `500`, `1000`, `5000`, `30000`, `30`, `12`, or `5` remains in STT audio lifecycle code unless it is intentionally local and commented.
3. Unit tests derive sample counts from `secondsToSamples()`.
4. Browser console evidence records mode, target sample rate, source sample rate, frame cadence, chunk duration, retry duration, and transcript latency.
5. Manual visible-Chrome Track B passes with logs for Private and Native; Cloud remains optional/cost-gated but should use the same lifecycle evidence format.
