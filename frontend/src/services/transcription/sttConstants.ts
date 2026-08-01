import { AUDIO_CONFIG, PAUSE_DETECTION, STT_CONFIG } from '@/config';

function assignBoundedNumber(
  value: number,
  label: string,
  bounds: { min: number; max: number },
): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }

  if (value < bounds.min || value > bounds.max) {
    throw new Error(`${label}=${value} outside supported range ${bounds.min}-${bounds.max}`);
  }

  return value;
}

function assertOrderedBounds(minValue: number, maxValue: number, label: string): void {
  if (minValue > maxValue) {
    throw new Error(`${label} minimum ${minValue} cannot exceed maximum ${maxValue}`);
  }
}

export const PRIV_CLOUD_AUDIO = {
  TARGET_SAMPLE_RATE_HZ: AUDIO_CONFIG.SAMPLE_RATE,
  MIC_CONTEXT_SAMPLE_RATE_HZ: 48_000,
  WORKLET_RENDER_QUANTUM_SOURCE_SAMPLES: 128,
  DEFAULT_FRAME_SIZE_SAMPLES: AUDIO_CONFIG.FRAME_SIZE,
} as const;

export const SESSION_PAUSE = {
  SILENCE_RMS_THRESHOLD: PAUSE_DETECTION.SILENCE_THRESHOLD,
  MIN_SILENCE_MS: PAUSE_DETECTION.MIN_PAUSE_DURATION_MS,
  ROLLING_RMS_WINDOW_FRAMES: 50,
} as const;

export const STT_PROVIDER_REQUIREMENTS = {
  NATIVE: {
    DOCUMENTED_MIN_AUDIO_SECONDS: 0,
    INTERIM_RESULTS_SUPPORTED: true,
  },
  CLOUD_ASSEMBLYAI: {
    SAMPLE_RATE_HZ: 16_000,
    MIN_PACKET_MS: 50,
    MAX_PACKET_MS: 1_000,
    RECOMMENDED_PACKET_MS: 50,
  },
  PRIVATE_TRANSFORMERS_WHISPER: {
    DOCUMENTED_MIN_AUDIO_SECONDS: 0,
    MODEL_CONTEXT_WINDOW_SECONDS: 30,
    DEFAULT_CHUNK_LENGTH_SECONDS: 0,
    DEFAULT_STRIDE_RATIO: 1 / 6,
  },
} as const;

export const PRIV_STT = {
  // Product latency target, not a Transformers.js provider minimum. Whisper can
  // run on shorter Float32Array inputs; waiting longer only delays first text.
  MIN_TRANSCRIPTION_SECONDS: 1.0,
  // Private v2 is the default browser-local engine. It is not fast enough to
  // keep decoding every accumulated live sample while speech continues, so
  // live/provisional decodes use a recent window. Stop/final save still uses
  // the full utterance buffer.
  LIVE_DECODE_WINDOW_SECONDS: 3.0,
  UTTERANCE_SILENCE_TAIL_SECONDS: 1.0,
  // #891 capture-from-start: the final buffer accumulates from mic-start (not from speech-start
  // confirmation), so a hard cap bounds memory on a stuck/overlong recording. On overflow we keep
  // the BEGINNING (the opening) and stop appending, rather than rolling the buffer forward.
  // HARD MEMORY BACKSTOP for the accumulated utterance buffer. It must stay STRICTLY ABOVE
  // MAX_PRIVATE_RECORDING_SECONDS: on hitting it, PrivateWhisper stops ACCUMULATING audio
  // (`utteranceSampleCount >= MAX_UTTERANCE_SAMPLES` -> return) WITHOUT stopping the recording, so if the
  // two were equal a take could silently lose its tail. 900s ≈ 57.6MB at 16kHz float32 — the recording cap
  // is the binding limit; this stays a true backstop that a normal take never reaches.
  MAX_UTTERANCE_SECONDS: 900,
  // #891/#1089 PRODUCT REQUIREMENT: a single Private take may run the full 10 minutes (600s). History:
  // #891 first set this to 5 minutes (300s) — itself a lift from a 90s beta latency control — on the
  // ASSUMPTION that Stop→final decode was slow. That assumption is now measured false: on production
  // multi-threaded WASM (4 threads, #1043) a real 5:03 take finalized in 38.7s (RTF ~0.128), so a full
  // 10-minute take costs only ~77s of Finalizing… and ~19MB of buffer. Segmented finalization was meant
  // to lift the cap but failed on real audio and is parked; we lift the cap directly and make the
  // Finalizing… wait HONEST (shown for the whole Stop→final decode). Stopping a user who believes they
  // are still recording is worse than a longer finalize wait. WebGPU (v4) is a future accelerator, NOT a
  // prerequisite. The 900s MAX_UTTERANCE_SECONDS hard memory backstop (above) stays STRICTLY ABOVE this cap.
  MAX_PRIVATE_RECORDING_SECONDS: 600,
  PRIVATE_RECORDING_CAP_WARNING_SECONDS: 20,
  // #1089 HARD CEILING on post-Stop finalization. Finalizing… now disables the record control for its
  // whole duration, so a decode that never returns would strand the user with no way out but a reload.
  // Bound it instead: on expiry the stop fails into the EXISTING recovery path (FAILED + recovery-draft
  // status), which re-enables the control and keeps the captured transcript.
  //
  // Sizing: measured RTF ~0.128 on production multi-threaded WASM, so the worst legitimate take (the
  // 600s cap) finalizes in ~77s. 240s is ~3x that headroom — high enough that a slow-but-working
  // device is never cut off mid-decode, low enough that a genuine hang surfaces in a bounded time.
  FINALIZE_HARD_TIMEOUT_MS: 240_000,
  PROCESSING_INTERVAL_MS: 250,
  MAX_RETRY_SECONDS: 12,
  WHISPER_WINDOW_SECONDS: STT_PROVIDER_REQUIREMENTS.PRIVATE_TRANSFORMERS_WHISPER.MODEL_CONTEXT_WINDOW_SECONDS,
  WHISPER_STRIDE_SECONDS: 5,
  SPEECH_START_RMS_THRESHOLD: SESSION_PAUSE.SILENCE_RMS_THRESHOLD,
  SPEECH_START_MIN_MS: 100,
  // #891 Fix 1: pre-onset audio retained before speech-start confirms. 300ms could not hold a soft
  // multi-word opening ("My main point is that…" ~1.2-1.5s) when confirmation fired late, so the
  // opening was evicted from the ring before it reached the utterance buffer. 1500ms covers a slow
  // human onset; cost is ~1.2s extra retained audio per session (negligible).
  SPEECH_START_PREROLL_MS: 1500,
  SPEECH_START_RESET_TOLERANCE_MS: 300,
  // #891 immediate-start readiness gate. Proven cause of the residual opening loss: when a user
  // hits Record and speaks instantly, getUserMedia/AudioContext/worklet warmup (~0.5-0.7s) has not
  // yet delivered stable frames, so the first words ("My main…") never reach the capture buffer.
  // The "Speak now" cue is QUALITY-gated, not a timer: it requires N consecutive CLEAN frames (proves
  // frames are flowing), and releases when the frame RMS SETTLES (AGC/noise floor converged), bounded
  // by [MIN, MAX] warmup so a mistuned band can never fire too early nor hang. Frames are ~64ms
  // (1024 @ 16kHz). Gates the user CUE only — capture-from-start keeps buffering from frame 1. The
  // band/bounds are tuned from the on-device `mic_ready_to_speak` telemetry (timeToFirstFrame, RMS).
  MIC_READY_MIN_CONSECUTIVE_FRAMES: 6,
  MIC_READY_MIN_WARMUP_MS: 250,
  MIC_READY_MAX_WARMUP_MS: 800,
  MIC_READY_STABILITY_WINDOW_FRAMES: 6,
  MIC_READY_RMS_STABILITY_BAND: 0.005,
  POST_TRANSCRIPT_PAINT_GRACE_MS: 600,
  PRE_TRANSCRIPT_METADATA_RETRY_LIMIT: 2,
  FIRST_TRANSCRIPT_LOCAL_AGREEMENT_ROUNDS: 2,
  FIRST_TRANSCRIPT_MIN_WORDS: 4,
  FIRST_TRANSCRIPT_PARTIAL_MIN_RMS: 0.04,
  // #891 capture-from-start leading trim: a FIXED pure-silence floor used ONLY to drop true leading
  // near-silence at finalize. Deliberately ~10x below FIRST_TRANSCRIPT_PARTIAL_MIN_RMS and below soft
  // speech (~0.005) and the speech-start threshold, so opening WORDS are never trimmed (under-trim
  // bias). This is NOT the dynamic speech-start threshold that caused the original miss.
  LEADING_SILENCE_TRIM_RMS: 0.003,
  LEADING_TRIM_KEEP_MARGIN_SECONDS: 0.5,
  // #891 capture-from-start: a long quiet lead-in ABOVE the pure-silence floor (room tone ~0.004) is
  // kept by the floor trim, and Whisper hallucinates a prefix on extended low-energy audio
  // ("(crowd murmuring)" etc.). If the quiet run BEFORE the first loud-speech frame exceeds
  // LEADING_MAX_QUIET_SECONDS (set well beyond the longest observed soft onset ~7.9s so real soft
  // openings are NEVER trimmed), trim it down to LEADING_QUIET_KEEP_SECONDS before that loud onset.
  // Verified: 30s room tone -> hallucinated "(crowd murmuring)"; trimmed to ~1s -> clean opening.
  LEADING_MAX_QUIET_SECONDS: 12,
  LEADING_QUIET_KEEP_SECONDS: 1,
  // Path C (first-paint): the previous 5.0s threshold held the first transcript
  // for so long that slow CPU decodes produced no visible live text during short
  // utterances (the "Holding first transcript until it has speech-like substance"
  // symptom). The whole-utterance stop-commit is now the saved-accuracy authority,
  // so the provisional first-paint can promote sooner without risking saved quality.
  FIRST_TRANSCRIPT_MIN_DURATION_SECONDS: 2.0,
  FIRST_TRANSCRIPT_MIN_RMS: 0.05,
  FORCE_FINAL_MIN_SECONDS: 2,
  // Default local Private model (PRIVATE-BASE-DEFAULT: now whisper-base.en via transformers.js v2)
  // download size. Surfaced in the setup CTA so users see the cost before downloading. The live CTA
  // derives the exact size from CANDIDATES[resolvePrivateModel()].approxMB; keep this fallback in sync.
  DEFAULT_MODEL_DOWNLOAD_MB: 80,
} as const;

/**
 * Private VAD prototype (Phase 2 — neural voice-activity detection), behind a flag.
 * Replaces RMS energy gating with Silero VAD speech probability at the two decision
 * points (speech onset + silence/end). OFF BY DEFAULT: the RMS path is byte-identical
 * unless explicitly enabled via `window.__PRIVATE_VAD_PROTOTYPE__ === true` or
 * `?privateVad=1`. The Silero runtime (`@ricky0123/vad-web`) is lazy-loaded ONLY when
 * enabled, so default download/bundle/perf are unaffected.
 *
 * Thresholds are explicit and reported in the RMS-vs-VAD A/B (no unlabelled tuning).
 */
export const PRIV_STT_VAD = {
  // Silero speech-probability for a frame to count as speech (0..1).
  SPEECH_PROB_THRESHOLD: 0.5,
  // Silero operates on 512-sample frames (~32ms @ 16kHz).
  FRAME_SAMPLES: 512,
  // Minimum continuous speech to confirm onset (debounce false triggers).
  MIN_SPEECH_MS: 250,
  // Hangover: trailing silence required before declaring utterance end.
  MIN_SILENCE_MS: 300,
  // Audio retained before confirmed onset so soft starts are not clipped.
  PREROLL_MS: 300,
  // Runtime metadata surfaced to the proof report.
  MODEL: 'silero-vad',
  RUNTIME: '@ricky0123/vad-web',
} as const;

export const PRIV_STT_V4 = {
  ENGINE_KEY: 'transformers-js-v4',
  // Default v4 model id (base_q4 = rollout floor). v4 has NO tiny variant — PRIV_STT_V4_VARIANTS is the
  // source of truth; this is only a defensive default/fallback for the worker init.
  MODEL_ID: 'onnx-community/whisper-base.en',
  DTYPE: {
    encoder_model: 'fp32',
    decoder_model_merged: 'q4',
  },
  DEVICE: null,
  // Matches PRIV_STT_V4_VARIANTS.base_q4 (whisper-base.en) — was 120 for the old tiny default.
  EXPECTED_Q4_SPLIT_DOWNLOAD_MB: 142,
  WORKER_REQUEST_TIMEOUT_MS: 90_000,
} as const;

/**
 * v4 model TIERS for the flag-gated resolver (v4 = @huggingface/transformers).
 * Only active when the v4 feature flag is on; flag-off behavior is unchanged.
 *
 *  - base_q4   = the universal FLOOR. Works on WASM (RTF ~0.72) and WebGPU
 *                (~0.094). ~142 MB split download. Default flagged v4 engine.
 *  - distil_q4 = the WebGPU ACCURACY tier (~21% lower WER than v2-base on hard
 *                speech). ~251 MB and WebGPU-only — WASM RTF ~2.2 is unusable —
 *                so it is selected ONLY when WebGPU is confirmed AND the distil
 *                flag + user qualification are on. Never the universal default.
 *
 * dtype is the split scheme (fp32 encoder + q4 decoder), matching the bakeoff
 * sizes (LibriSpeech test-other, Apple Metal). Selection is via the resolver; the
 * engine reads the chosen variant. base_q4 is the first flagged rollout floor.
 */
export const PRIV_STT_V4_VARIANTS = {
  base_q4: {
    id: 'base_q4',
    MODEL_ID: 'onnx-community/whisper-base.en',
    DTYPE: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
    EXPECTED_SPLIT_DOWNLOAD_MB: 142,
    requiresWebGPU: false,
  },
  distil_q4: {
    id: 'distil_q4',
    MODEL_ID: 'onnx-community/distil-small.en',
    DTYPE: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
    EXPECTED_SPLIT_DOWNLOAD_MB: 251,
    requiresWebGPU: true,
  },
} as const;

export type PrivSttV4VariantId = keyof typeof PRIV_STT_V4_VARIANTS;

/** First flagged rollout floor (reviewer: base_q4 before distil_q4). */
export const PRIV_STT_V4_DEFAULT_VARIANT: PrivSttV4VariantId = 'base_q4';

/**
 * Single source of truth for the explicit private-engine override localStorage key.
 * Shared by `PrivateSTT` (override read) and `sttIdentity` (debug mirror) so the two
 * cannot drift. NOTE: the override itself is honored only in dev/test/E2E — see
 * `PrivateSTT.getPrivateEngineOverride`. It is NOT a production user affordance.
 */
export const PRIVATE_ENGINE_OVERRIDE_KEY = 'speaksharp.private.engine';

/**
 * Private model-eval candidates (flag-gated A/B). The CI Private v2 benchmark showed
 * ~51.7% WER vs a 6.1% ceiling, so decode/model quality — not just onset detection — is
 * the dominant gap. This lets the test agent A/B larger local models against the default
 * whisper-tiny.en WITHOUT a blind switch. Selection is via `?privateModel=` /
 * `window.__PRIVATE_MODEL__`; DEFAULT keeps current production behavior byte-identical.
 * Download sizes are approximate (quantized) and confirmed by the browser proof.
 */
export const PRIV_STT_MODELS = {
  // PRIVATE-BASE-DEFAULT (product direction): the Private release default is v2 **base.en** — it is
  // materially more accurate (human proof WER ~0.037 vs tiny ~0.093) and the release optimizes for
  // transcript trust over fastest first text. base.en is self-hosted under public/models/, so the
  // default loads local-only (no Hugging Face). tiny.en stays a CANDIDATE for internal/emergency
  // fallback (selectable via the flag), but is NOT a user-facing release option.
  DEFAULT: 'whisper-base.en',
  // Remote ids MUST be the Xenova/* family — these repos are built for transformers.js v2
  // (@xenova/transformers, the production library). onnx-community/* repos are v3-format and
  // FAIL to load on v2 with "Unsupported model type: whisper" (test-confirmed). distil-whisper
  // (distil-small.en) only exists in v3 form, so it is NOT loadable on v2 — replaced here by
  // whisper-small.en (Xenova/whisper-small.en, v2-native), giving a clean tiny→base→small
  // accuracy ladder. Default tiny loads from local public/models/ (flag-off byte-identical);
  // these remoteIds only matter for the candidate downloads. approxMB are best-effort; the A/B
  // captures the real downloaded size.
  CANDIDATES: {
    'whisper-tiny.en': { localId: 'whisper-tiny.en', remoteId: 'Xenova/whisper-tiny.en', approxMB: 40 },
    'whisper-base.en': { localId: 'whisper-base.en', remoteId: 'Xenova/whisper-base.en', approxMB: 80 },
    'whisper-small.en': { localId: 'whisper-small.en', remoteId: 'Xenova/whisper-small.en', approxMB: 244 },
  },
} as const;

const ASSEMBLYAI_PACKET_MS_BOUNDS = {
  min: STT_PROVIDER_REQUIREMENTS.CLOUD_ASSEMBLYAI.MIN_PACKET_MS,
  max: STT_PROVIDER_REQUIREMENTS.CLOUD_ASSEMBLYAI.MAX_PACKET_MS,
} as const;

const CLOUD_MIN_PACKET_MS = assignBoundedNumber(
  STT_CONFIG.ASSEMBLYAI_MIN_PACKET_MS,
  'CLOUD_STT.MIN_PACKET_MS',
  ASSEMBLYAI_PACKET_MS_BOUNDS,
);

const CLOUD_MAX_PACKET_MS = assignBoundedNumber(
  STT_CONFIG.ASSEMBLYAI_MAX_PACKET_MS,
  'CLOUD_STT.MAX_PACKET_MS',
  ASSEMBLYAI_PACKET_MS_BOUNDS,
);

assertOrderedBounds(CLOUD_MIN_PACKET_MS, CLOUD_MAX_PACKET_MS, 'CLOUD_STT packet duration');

export const CLOUD_STT = {
  SAMPLE_RATE_HZ: PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ,
  ENCODING: 'pcm_s16le',
  SPEECH_MODEL: 'universal-streaming-english',
  MIN_PACKET_MS: CLOUD_MIN_PACKET_MS,
  MAX_PACKET_MS: CLOUD_MAX_PACKET_MS,
  MAX_QUEUED_AUDIO_FRAMES: 4_000,
  MAX_RECONNECT_ATTEMPTS: 5,
  BASE_RECONNECT_DELAY_MS: 1_000,
  RECONNECT_EXPONENT_CAP: 16,
  RECONNECT_JITTER_MS: 200,
  SOCKET_CLOSE_TIMEOUT_MS: 2_000,
  // After Stop we send Terminate and must WAIT for the provider's final turn +
  // Termination so the tail of the speech is not dropped. 2s was too short
  // (test-agent finding #2); give the provider a realistic budget to flush the
  // last final turn. Measured via stopToTerminationMs on the cloud trace.
  STOP_TERMINATION_TIMEOUT_MS: 8_000,
} as const;

export const NATIVE_STT = {
  LANG: 'en-US',
  INTERIM_RESULTS: true,
  // Native Browser STT is a session/dictation workflow. Chrome/Edge must stay
  // continuous to avoid the no-result restart regression from fc0ffc39.
  CONTINUOUS: true,
  MAX_ALTERNATIVES: 1,
  START_TIMEOUT_MS: 3_000,
  STOP_TIMEOUT_MS: 1_000,
  RESTART_MAX_ATTEMPTS: 3,
  RESTART_BASE_DELAY_MS: 100,
  RESTART_DEBOUNCE_MS: 300,
  // #29 cold-start gate: conservative safety-net timeout to lift the "Getting mic ready…" cue if the
  // real acoustic signal (onaudiostart/onspeechstart) never arrives. NOT the primary mechanism.
  NATIVE_ACOUSTIC_READY_FALLBACK_MS: 1_500,
} as const;

export function secondsToSamples(
  seconds: number,
  sampleRate: number,
): number {
  return Math.round(seconds * sampleRate);
}

export function millisecondsToSamples(
  milliseconds: number,
  sampleRate: number,
): number {
  return Math.round((milliseconds * sampleRate) / 1_000);
}

export function samplesToSeconds(
  samples: number,
  sampleRate: number,
): number {
  return samples / sampleRate;
}

export const PRIV_STT_DERIVED = {
  MIN_TRANSCRIPTION_SAMPLES: secondsToSamples(
    PRIV_STT.MIN_TRANSCRIPTION_SECONDS,
    PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ,
  ),
  LIVE_DECODE_WINDOW_SAMPLES: secondsToSamples(
    PRIV_STT.LIVE_DECODE_WINDOW_SECONDS,
    PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ,
  ),
  UTTERANCE_SILENCE_TAIL_SAMPLES: secondsToSamples(
    PRIV_STT.UTTERANCE_SILENCE_TAIL_SECONDS,
    PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ,
  ),
  MAX_UTTERANCE_SAMPLES: secondsToSamples(
    PRIV_STT.MAX_UTTERANCE_SECONDS,
    PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ,
  ),
  LEADING_TRIM_KEEP_MARGIN_SAMPLES: secondsToSamples(
    PRIV_STT.LEADING_TRIM_KEEP_MARGIN_SECONDS,
    PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ,
  ),
  LEADING_MAX_QUIET_SAMPLES: secondsToSamples(
    PRIV_STT.LEADING_MAX_QUIET_SECONDS,
    PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ,
  ),
  LEADING_QUIET_KEEP_SAMPLES: secondsToSamples(
    PRIV_STT.LEADING_QUIET_KEEP_SECONDS,
    PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ,
  ),
  MAX_RETRY_SAMPLES: secondsToSamples(
    PRIV_STT.MAX_RETRY_SECONDS,
    PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ,
  ),
  SPEECH_START_MIN_SAMPLES: millisecondsToSamples(
    PRIV_STT.SPEECH_START_MIN_MS,
    PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ,
  ),
  SPEECH_START_PREROLL_SAMPLES: millisecondsToSamples(
    PRIV_STT.SPEECH_START_PREROLL_MS,
    PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ,
  ),
  SPEECH_START_RESET_TOLERANCE_SAMPLES: millisecondsToSamples(
    PRIV_STT.SPEECH_START_RESET_TOLERANCE_MS,
    PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ,
  ),
  FORCE_FINAL_MIN_SAMPLES: secondsToSamples(
    PRIV_STT.FORCE_FINAL_MIN_SECONDS,
    PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ,
  ),
} as const;

export const CLOUD_STT_DERIVED = {
  MIN_PACKET_SAMPLES: millisecondsToSamples(CLOUD_STT.MIN_PACKET_MS, CLOUD_STT.SAMPLE_RATE_HZ),
  MAX_PACKET_SAMPLES: millisecondsToSamples(CLOUD_STT.MAX_PACKET_MS, CLOUD_STT.SAMPLE_RATE_HZ),
} as const;

assertOrderedBounds(
  CLOUD_STT_DERIVED.MIN_PACKET_SAMPLES,
  CLOUD_STT_DERIVED.MAX_PACKET_SAMPLES,
  'CLOUD_STT packet samples',
);
