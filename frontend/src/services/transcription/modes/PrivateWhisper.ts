/**
 * ============================================================================
 * PRIVATE WHISPER TRANSCRIPTION SERVICE
 * ============================================================================
 * 
 * PURPOSE:
 * --------
 * Provides client-side speech-to-text using the PrivateSTT dual-engine facade.
 * Automatically selects the best engine:
 * - whisper-turbo (fast) when WebGPU is available
 * - transformers.js (safe) as fallback or in CI
 * 
 * ARCHITECTURE:
 * -------------
 * This service uses the PrivateSTT facade which:
 * 1. Detects available hardware capabilities
 * 1. Detects available hardware capabilities
 * 2. Tries whisper-turbo first
 * 3. Falls back to transformers.js on failure
 * 4. Forces transformers.js in CI/test environments
 * 
 * PERFORMANCE:
 * ------------
 * - whisper-turbo: Very fast on GPU-capable hardware
 * - transformers.js: Slower but reliable on all hardware
 * 
 * RELATED FILES:
 * --------------
 * - frontend/src/services/transcription/engines/ - Engine implementations
 * - frontend/public/sw.js - Service Worker cache logic
 * - frontend/src/hooks/useSpeechRecognition/index.ts - Manages loading state
 * 
 * @see docs/ARCHITECTURE.md - "Dual-Engine Private STT"
 */

import logger from '../../../lib/logger';
import { redactTranscript } from '../../../lib/logRedaction';
import { sanitizeTranscriptText } from '../transcriptSanitizer';
import { createPrivateSTT, EngineType } from '../engines';
import { IPrivateSTT } from '../../../contracts/IPrivateSTT';
import type { PrivateSTTInitOptions } from '../../../contracts/IPrivateSTT';
import { ITranscriptionEngine, TranscriptionModeOptions, Result } from './types';
import { TranscriptionError } from '../errors';

import { MicStream } from '../utils/types';
import { concatenateFloat32Arrays } from '../utils/AudioProcessor';
import { TranscriptUpdate, SttStatus } from '../../../types/transcription';
import { ENV } from '../../../config/TestFlags';
import { PauseDetector } from '../../audio/pauseDetector';
import { PRIV_CLOUD_AUDIO, PRIV_STT, PRIV_STT_DERIVED, SESSION_PAUSE, samplesToSeconds, secondsToSamples } from '../sttConstants';

// Extend Window interface for E2E test flags
declare global {
  interface Window {
    __E2E_MOCK_SESSION__?: boolean;
    __e2eBridgeReady__?: boolean;
    __e2eProfileLoaded__?: boolean;
    __E2E_PLAYWRIGHT__?: boolean;
    __PrivateWhisper_INT_TEST__?: PrivateWhisper;
    __e2e_stt_engine_ready_fired__?: boolean;
    __PRIVATE_TRANSCRIPT_TRACE__?: boolean;
    __PRIVATE_INFERENCE_AUDIO_CHUNKS__?: PrivateInferenceAudioCapture[];
    __PRIVATE_UTTERANCE_AUDIO_CHUNKS__?: PrivateInferenceAudioCapture[];
    __PRIVATE_STT_TIMELINE__?: PrivateSttTimelineEvent[];
    /**
     * Always-on (not trace-gated) summary of Private STT timing for proof harnesses.
     * Diagnostics only — never gates product behavior. See PrivateTimingSummary.
     */
    __PRIVATE_TIMING__?: PrivateTimingSummary;
  }
}

/**
 * Private STT timing summary (#Quality-Push Slice 1). All durations are ms.
 * `timeToFirst*` are measured from speech start when available, else stream start.
 * Updated at each milestone and on finalize; read after Stop for the full picture.
 */
export interface PrivateTimingSummary {
  /** ms from speech-start (fallback stream-start) to the first visible draft provisional. */
  timeToFirstProvisionalMs: number | null;
  /** ms from speech-start (fallback stream-start) to the first committed (non-draft) text. */
  timeToFirstFinalMs: number | null;
  /**
   * ms of the whole-utterance MODEL decode only (the privateSTT.transcribe call) —
   * the saved-transcript authority. Decision-tree branch 3 (decode-bound).
   */
  finalizeDecodeMs: number | null;
  /**
   * ms from Stop (onStop entry) to the whole-utterance commit call — engine cleanup
   * + draining any in-flight live decode off the single-threaded worker.
   * Decision-tree branch 1 (in-flight live decode blocking Stop).
   */
  finalizeWaitMs: number | null;
  /**
   * ms inside commitWholeUtteranceTranscript BEFORE the model call — concatenating
   * the full utterance buffer, energy scan, and diagnostic audio capture.
   * Decision-tree branch 2 (finalize preprocessing).
   */
  finalizePrepMs: number | null;
  /** Total speech captured for this utterance, seconds. */
  utteranceSeconds: number;
  /** Peak live audio buffered at any point, seconds (unbounded-buffer guard). */
  peakBufferedSeconds: number;
  /** Anchor used for timeToFirst*: 'speech' | 'stream' | null (not started). */
  anchor: 'speech' | 'stream' | null;
  /** performance.now() at last update, for ordering across reads. */
  updatedAtMs: number;
}

/**
 * Pure builder for the Private timing summary (unit-testable without the engine).
 * `timeToFirst*` are relative to speech-start when available, else stream-start.
 */
export function buildPrivateTimingSummary(p: {
  streamStartAtMs: number | null;
  speechStartAtMs: number | null;
  firstProvisionalAtMs: number | null;
  firstFinalAtMs: number | null;
  finalizeDecodeMs: number | null;
  finalizeWaitMs: number | null;
  finalizePrepMs: number | null;
  utteranceSampleCount: number;
  peakBufferedSamples: number;
  nowMs: number;
}): PrivateTimingSummary {
  const anchorMs = p.speechStartAtMs ?? p.streamStartAtMs;
  const anchor: PrivateTimingSummary['anchor'] =
    p.speechStartAtMs != null ? 'speech' : p.streamStartAtMs != null ? 'stream' : null;
  const rel = (t: number | null): number | null =>
    t != null && anchorMs != null ? Number(Math.max(0, t - anchorMs).toFixed(1)) : null;
  return {
    timeToFirstProvisionalMs: rel(p.firstProvisionalAtMs),
    timeToFirstFinalMs: rel(p.firstFinalAtMs),
    finalizeDecodeMs: p.finalizeDecodeMs,
    finalizeWaitMs: p.finalizeWaitMs,
    finalizePrepMs: p.finalizePrepMs,
    utteranceSeconds: Number(samplesToSeconds(p.utteranceSampleCount, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
    peakBufferedSeconds: Number(samplesToSeconds(p.peakBufferedSamples, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
    anchor,
    updatedAtMs: Number(p.nowMs.toFixed(1)),
  };
}
// Toast removed from here to centralized UI layer
// import { toast } from '../../../lib/toast';

type Status = 'uninitialized' | 'idle' | 'loading' | 'transcribing' | 'stopped' | 'error';
type PrivateInferenceAudioCapture = {
  createdAt: string;
  samples: number;
  durationSec: number;
  rms: number;
  peak: number;
  wavDataUrl: string;
  transcript?: string;
  error?: string;
  // Optional final-decode diagnostics (whole-utterance captures only).
  speechStartOffsetMs?: number | null;
  retainedPrerollSamples?: number;
  decodeMs?: number;
};

type PrivateSttTimelineEvent = {
  event: string;
  createdAt: string;
  epochMs: number;
  perfMs: number;
  payload?: Record<string, unknown>;
};

type SpeechGateStats = {
  framesSeen: number;
  speechFramesSeen: number;
  resetCount: number;
  candidateResetCount: number;
  maxRms: number;
  maxPeak: number;
  firstSpeechFrameAtMs: number | null;
  lastCandidateSamples: number;
};

const PRIVATE_STT_SAMPLE_RATE = PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ;
const MIN_TRANSCRIPTION_SAMPLES = PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES;
const LIVE_DECODE_WINDOW_SAMPLES = PRIV_STT_DERIVED.LIVE_DECODE_WINDOW_SAMPLES;
const UTTERANCE_SILENCE_TAIL_SAMPLES = PRIV_STT_DERIVED.UTTERANCE_SILENCE_TAIL_SAMPLES;
const MAX_RETRY_SAMPLES = PRIV_STT_DERIVED.MAX_RETRY_SAMPLES;
const PROCESSING_INTERVAL_MS = PRIV_STT.PROCESSING_INTERVAL_MS;
const TRANSCRIPTION_TIMEOUT_MS = 60_000;
const SPEECH_START_MIN_SAMPLES = PRIV_STT_DERIVED.SPEECH_START_MIN_SAMPLES;
const SPEECH_START_PREROLL_SAMPLES = PRIV_STT_DERIVED.SPEECH_START_PREROLL_SAMPLES;
const SPEECH_START_RESET_TOLERANCE_SAMPLES = PRIV_STT_DERIVED.SPEECH_START_RESET_TOLERANCE_SAMPLES;
const FORCE_FINAL_MIN_SAMPLES = PRIV_STT_DERIVED.FORCE_FINAL_MIN_SAMPLES;

const isPrivateTranscriptTraceEnabled = () =>
  typeof window !== 'undefined' && Boolean(window.__PRIVATE_TRANSCRIPT_TRACE__);

function pushPrivateTimeline(event: string, payload?: Record<string, unknown>): void {
  if (!isPrivateTranscriptTraceEnabled()) return;

  window.__PRIVATE_STT_TIMELINE__ = window.__PRIVATE_STT_TIMELINE__ ?? [];
  window.__PRIVATE_STT_TIMELINE__.push({
    event,
    createdAt: new Date().toISOString(),
    epochMs: Date.now(),
    perfMs: typeof performance !== 'undefined' ? Number(performance.now().toFixed(3)) : 0,
    payload,
  });
}

function summarizeAudioEnergy(audio: Float32Array) {
  let sumSquares = 0;
  let peak = 0;

  for (let i = 0; i < audio.length; i += 1) {
    const sample = audio[i] ?? 0;
    const abs = Math.abs(sample);
    sumSquares += sample * sample;
    if (abs > peak) {
      peak = abs;
    }
  }

  return {
    rms: audio.length > 0 ? Math.sqrt(sumSquares / audio.length) : 0,
    peak,
  };
}

function isNonSpeechMetadataOnlyTranscript(text: string): boolean {
  const stripped = text
    .replace(/\[[A-Z_\s]+\]/gi, '')
    .replace(/\([a-z\s]+\)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return text.trim().length > 0 && stripped.length === 0;
}

function isTinyForcedTailTranscript(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return false;

  const words = normalized.split(' ').filter(Boolean);
  return words.length <= 1 && normalized.length <= 3;
}

function isTinyTranscriptFragment(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return false;

  const words = normalized.split(' ').filter(Boolean);
  return words.length <= 1 && normalized.length <= 4;
}

const HALLUCINATION_BLOCKLIST: readonly RegExp[] = [
  /^thanks[.!?]?\s*$/i,
  /^thank you[.!?]?\s*$/i,
  /^thanks for watching[.!?]?\s*$/i,
  /^you[.!?]?\s*$/i,
  /^i[.!?]?\s*$/i,
  /^\.+\s*$/,
  /^\s*$/,
];

const NON_SPEECH_MARKER_PATTERN =
  /(?:^|\s)(?:\*[^*]{1,40}\*|\[[^\]]{1,40}\]|\((?:music|laughter|laughing|applause|inaudible|silence|noise|coughing|speaking in foreign language)[^)]*\))/i;

const TRAILING_NUMERIC_JUNK_PATTERN =
  /(?:^|[\s.?!,])(?:\d+(?:\.\d+)?)(?:\s*,\s*\d+(?:\.\d+)?){1,}\s*[.!?]?\s*$/;

const PRIVATE_DISPLAY_FILLERS = new Set([
  'um',
  'umm',
  'ummm',
  'uh',
  'uhh',
  'uhhh',
  'ah',
  'like',
  'basically',
  'actually',
  'literally',
  'so',
  'oh',
]);

function normalizeTranscriptForGate(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function getTranscriptWords(text: string): string[] {
  const normalized = normalizeTranscriptForGate(text);
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}

function isFillerOnlyTranscript(text: string): boolean {
  const words = getTranscriptWords(text);
  return words.length > 0 && words.every((word) => PRIVATE_DISPLAY_FILLERS.has(word));
}

function getStableWordPrefix(previousText: string, currentText: string): string {
  const previousWords = getTranscriptWords(previousText);
  const currentWords = getTranscriptWords(currentText);
  const stableWords: string[] = [];
  const max = Math.min(previousWords.length, currentWords.length);

  for (let i = 0; i < max; i += 1) {
    if (previousWords[i] !== currentWords[i]) break;
    stableWords.push(currentWords[i]);
  }

  return stableWords.join(' ');
}

function isKnownHallucinationTranscript(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return HALLUCINATION_BLOCKLIST.some((pattern) => pattern.test(normalized));
}

function hasUnsafePrivateCandidateMarker(text: string): boolean {
  return NON_SPEECH_MARKER_PATTERN.test(text);
}

function hasUnsupportedNumericTail(text: string): boolean {
  return TRAILING_NUMERIC_JUNK_PATTERN.test(text);
}

function sanitizePrivateTranscriptCandidate(text: string): string {
  return sanitizeTranscriptText(text);
}

function isPurePrivateHallucinationTranscript(text: string): boolean {
  return isKnownHallucinationTranscript(sanitizePrivateTranscriptCandidate(text));
}

function isUnsafePrivateTranscriptCandidate(text: string): boolean {
  return (
    hasUnsafePrivateCandidateMarker(text) ||
    hasUnsupportedNumericTail(text) ||
    isKnownHallucinationTranscript(text)
  );
}

function wordOverlapRatio(left: string, right: string): number {
  const leftWords = new Set(getTranscriptWords(left));
  const rightWords = getTranscriptWords(right);
  if (leftWords.size === 0 || rightWords.length === 0) return 0;

  const overlap = rightWords.filter((word) => leftWords.has(word)).length;
  return overlap / rightWords.length;
}

function appendTranscriptWithoutDuplicate(base: string, segment: string): string {
  const baseText = base.replace(/\s+/g, ' ').trim();
  const segmentText = segment.replace(/\s+/g, ' ').trim();
  if (!baseText) return segmentText;
  if (!segmentText) return baseText;

  const baseWords = baseText.split(/\s+/);
  const segmentWords = segmentText.split(/\s+/);
  const normalizedBaseWords = getTranscriptWords(baseText);
  const normalizedSegmentWords = getTranscriptWords(segmentText);

  let overlap = 0;
  const maxOverlap = Math.min(normalizedBaseWords.length, normalizedSegmentWords.length);
  for (let size = 1; size <= maxOverlap; size += 1) {
    const baseTail = normalizedBaseWords.slice(-size).join(' ');
    const segmentHead = normalizedSegmentWords.slice(0, size).join(' ');
    if (baseTail === segmentHead) {
      overlap = size;
    }
  }

  return [baseWords.join(' '), segmentWords.slice(overlap).join(' ')].filter(Boolean).join(' ').trim();
}

function containsContiguousWordSequence(text: string, sequence: string[]): boolean {
  if (sequence.length === 0) return true;

  const words = getTranscriptWords(text);
  if (words.length < sequence.length) return false;

  for (let index = 0; index <= words.length - sequence.length; index += 1) {
    const slice = words.slice(index, index + sequence.length);
    if (slice.every((word, offset) => word === sequence[offset])) {
      return true;
    }
  }

  return false;
}

export function mergeLiveProvisionalTranscript(previous: string, next: string): string {
  const previousWords = getTranscriptWords(previous);
  const nextWords = getTranscriptWords(next);
  if (previousWords.length === 0) return next.trim();
  if (nextWords.length === 0) return previous.trim();

  const overlap = wordOverlapRatio(previous, next);
  const isLikelyShortOpeningSegment = previousWords.length <= 3 && nextWords.length >= 2;
  const isLikelyShortTailSegment = previousWords.length >= 3 && nextWords.length <= 3;
  const isLikelyRevision = previousWords.length > 3 && overlap <= 0.25;

  let merged: string;
  if (isLikelyShortTailSegment) {
    merged = appendTranscriptWithoutDuplicate(previous, next);
  } else if (isLikelyRevision) {
    merged = next.trim();
  } else if (isLikelyShortOpeningSegment || overlap > 0) {
    merged = appendTranscriptWithoutDuplicate(previous, next);
  } else {
    merged = next.trim();
  }

  // NO-SHRINK INVARIANT (Private live cumulative transcript fix):
  // The live provisional must never drop words already shown to the user mid-
  // recording. When the rolling-decode window slides to genuinely NEW speech, the
  // overlap is low and the heuristics above would REPLACE (return `next`), making
  // the visible transcript shrink to just the latest window — the user then sees
  // only one sentence that "resets" as they keep speaking (the full text only
  // appears at Stop). If the chosen merge would lose accumulated words, append the
  // new content instead so the draft only ever grows. This affects the LIVE PARTIAL
  // display ONLY; the authoritative final/saveCandidate is a separate whole-utterance
  // decode and is unaffected.
  const shouldPreserveAccumulatedDraft = previousWords.length > PRIV_STT.FIRST_TRANSCRIPT_MIN_WORDS;
  if (
    shouldPreserveAccumulatedDraft &&
    (
      getTranscriptWords(merged).length < previousWords.length ||
      !containsContiguousWordSequence(merged, previousWords)
    )
  ) {
    return appendTranscriptWithoutDuplicate(previous, next);
  }
  return merged;
}

function isUnsupportedPostTranscriptCandidate(candidate: string, currentTranscript: string): boolean {
  const candidateText = candidate.trim();
  const currentText = currentTranscript.trim();
  if (!candidateText || !currentText) return false;
  if (isUnsafePrivateTranscriptCandidate(candidateText)) return true;

  const candidateWords = getTranscriptWords(candidateText);
  if (candidateWords.length < PRIV_STT.FIRST_TRANSCRIPT_MIN_WORDS) return false;

  const overlap = wordOverlapRatio(currentText, candidateText);
  return overlap < 0.35 && candidateWords.length >= 5;
}

function canEmitFirstPartial(
  text: string,
  energy: { rms: number },
  hasVisibleProvisional: boolean,
): boolean {
  if (isUnsafePrivateTranscriptCandidate(text)) return false;

  const words = getTranscriptWords(text);
  if (words.length === 0) return false;

  const relaxedRmsThreshold = SESSION_PAUSE.SILENCE_RMS_THRESHOLD * 0.5;
  if (isFillerOnlyTranscript(text)) return energy.rms >= relaxedRmsThreshold;

  if (hasVisibleProvisional && words.length >= 2) {
    return energy.rms >= relaxedRmsThreshold;
  }

  return words.length >= 2 && energy.rms >= SESSION_PAUSE.SILENCE_RMS_THRESHOLD;
}

function hasFirstTranscriptEmissionSubstance(
  text: string,
  energy: { rms: number },
  durationSec: number,
): boolean {
  const words = getTranscriptWords(text);

  return (
    words.length >= PRIV_STT.FIRST_TRANSCRIPT_MIN_WORDS &&
    durationSec >= PRIV_STT.FIRST_TRANSCRIPT_MIN_DURATION_SECONDS &&
    energy.rms >= PRIV_STT.FIRST_TRANSCRIPT_MIN_RMS
  );
}

function getRetryRetentionMinRms(): number {
  return Math.min(
    PRIV_STT.FIRST_TRANSCRIPT_PARTIAL_MIN_RMS,
    SESSION_PAUSE.SILENCE_RMS_THRESHOLD * 3,
  );
}

// Minimum fraction of the final's words that must be preserved in a longer
// provisional before we prefer it for length. Below this the provisional has
// DIVERGED from the final (a likely hallucination / corruption rather than a clean
// extension), so length alone must not win. (Review F5.)
export const MIN_FINAL_PRESERVED_TO_PREFER_PROVISIONAL = 0.7;

export function shouldPreferVisibleProvisional(provisional: string, finalCandidate: string): boolean {
  const provisionalText = provisional.trim();
  const finalText = finalCandidate.trim();
  if (!provisionalText || !finalText) return false;
  if (isUnsafePrivateTranscriptCandidate(provisionalText)) return false;
  if (isUnsafePrivateTranscriptCandidate(finalText)) return true;

  const provisionalWords = getTranscriptWords(provisionalText);
  const finalWords = getTranscriptWords(finalText);
  if (provisionalWords.length < PRIV_STT.FIRST_TRANSCRIPT_MIN_WORDS) return false;

  const provisionalNormalized = normalizeTranscriptForGate(provisionalText);
  const finalNormalized = normalizeTranscriptForGate(finalText);
  if (!provisionalNormalized || provisionalNormalized === finalNormalized) return false;

  // QUALITY GUARD (review F5): preferring a longer provisional purely by length can
  // select a longer hallucinated/corrupted candidate over a clean shorter one. Only
  // prefer the longer provisional if it genuinely EXTENDS the final — i.e. the final's
  // content is substantially preserved in it (wordOverlapRatio = fraction of the
  // final's words present in the provisional). A divergent rewrite is rejected.
  const finalPreservedInProvisional = wordOverlapRatio(provisionalText, finalText);
  if (finalPreservedInProvisional < MIN_FINAL_PRESERVED_TO_PREFER_PROVISIONAL) {
    return false;
  }

  return (
    provisionalWords.length > finalWords.length ||
    (
      provisionalWords.length === finalWords.length &&
      provisionalNormalized.length > finalNormalized.length
    )
  );
}

function encodePcm16WavDataUrl(audio: Float32Array, sampleRate = PRIVATE_STT_SAMPLE_RATE): string {
  const bytesPerSample = 2;
  const dataBytes = audio.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < audio.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, audio[i] ?? 0));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += bytesPerSample;
  }

  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return `data:audio/wav;base64,${btoa(binary)}`;
}

function capturePrivateInferenceAudio(audio: Float32Array): number | null {
  if (!isPrivateTranscriptTraceEnabled()) return null;

  const energy = summarizeAudioEnergy(audio);
  window.__PRIVATE_INFERENCE_AUDIO_CHUNKS__ = window.__PRIVATE_INFERENCE_AUDIO_CHUNKS__ ?? [];
  window.__PRIVATE_INFERENCE_AUDIO_CHUNKS__.push({
    createdAt: new Date().toISOString(),
    samples: audio.length,
    durationSec: samplesToSeconds(audio.length, PRIVATE_STT_SAMPLE_RATE),
    rms: Number(energy.rms.toFixed(6)),
    peak: Number(energy.peak.toFixed(6)),
    wavDataUrl: encodePcm16WavDataUrl(audio),
  });

  return window.__PRIVATE_INFERENCE_AUDIO_CHUNKS__.length - 1;
}

function capturePrivateUtteranceAudio(
  audio: Float32Array,
  diagnostics?: { speechStartOffsetMs?: number | null; retainedPrerollSamples?: number },
): number | null {
  if (!isPrivateTranscriptTraceEnabled()) return null;

  const energy = summarizeAudioEnergy(audio);
  window.__PRIVATE_UTTERANCE_AUDIO_CHUNKS__ = window.__PRIVATE_UTTERANCE_AUDIO_CHUNKS__ ?? [];
  window.__PRIVATE_UTTERANCE_AUDIO_CHUNKS__.push({
    createdAt: new Date().toISOString(),
    samples: audio.length,
    durationSec: samplesToSeconds(audio.length, PRIVATE_STT_SAMPLE_RATE),
    rms: Number(energy.rms.toFixed(6)),
    peak: Number(energy.peak.toFixed(6)),
    wavDataUrl: encodePcm16WavDataUrl(audio),
    speechStartOffsetMs: diagnostics?.speechStartOffsetMs ?? null,
    retainedPrerollSamples: diagnostics?.retainedPrerollSamples,
  });

  return window.__PRIVATE_UTTERANCE_AUDIO_CHUNKS__.length - 1;
}

/**
 * Utility to clear the Whisper model cache from IndexedDB.
 * Used for self-repair when browser locks occur.
 */
export async function clearPrivateSTTCache(): Promise<void> {
  logger.info('[PrivateSTT] Attempting to clear model cache...');

  const clearDB = (name: string) => new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => {
      logger.info(`[PrivateSTT] ${name} IndexedDB cleared.`);
      resolve();
    };
    request.onerror = () => {
      logger.warn(`[PrivateSTT] Failed to clear ${name} IndexedDB.`);
      resolve(); // Resolve anyway to allow other cleanup
    };
    request.onblocked = () => {
      logger.warn(`[PrivateSTT] Clear ${name} blocked. Ensure all tabs are closed.`);
      resolve();
    };
  });

  // Clear both caches in parallel and wait for actual completion events
  await Promise.all([
    clearDB('whisper-turbo'),
    clearDB('transformers-cache')
  ]);
}

/**
 * ARCHITECTURE:
 * TranscriptionService generates a runId (e.g., abc-123) every time you click record. 
 * This identifies the current recording session.
 * The service then creates an engine and passes this runId into the engine's constructor 
 * via the options.instanceId field.
 * Inside the Engine, this ID is stored as this.instanceId.
 */
import { STTEngine } from '../../../contracts/STTEngine';

/**
 * ARCHITECTURE:
 * TranscriptionService generates a runId (e.g., abc-123) every time you click record. 
 * This identifies the current recording session.
 * The service then creates an engine and passes this runId into the engine's constructor 
 * via the options.instanceId field.
 * Inside the Engine, this ID is stored as this.instanceId.
 */
export default class PrivateWhisper extends STTEngine implements ITranscriptionEngine {
  private frameListenerDisposer: (() => void) | null = null;
  private onTranscriptUpdate?: (update: TranscriptUpdate) => void;
  private onModelLoadProgress?: (progress: number | null) => void;
  public onReady?: () => void;
  private onAudioData?: (data: Float32Array) => void;
  private onStatusChange?: (status: SttStatus) => void;
  private status: Status;
  private privateSTT: IPrivateSTT;
  private engineType: EngineType | null = null;
  private mic: MicStream | null = null;
  private audioChunks: Float32Array[] = [];
  private bufferedSampleCount: number = 0;
  private prerollAudioChunks: Float32Array[] = [];
  private prerollSampleCount: number = 0;
  private speechStartAudioChunks: Float32Array[] = [];
  private consecutiveSpeechSamples: number = 0;
  private speechStartQuietSamples: number = 0;
  private hasDetectedSpeech: boolean = false;
  private retryAudioBuffer: Float32Array | null = null;
  private isProcessing: boolean = false;
  // True from the moment Stop is requested until finalization completes. While set,
  // in-flight LIVE decodes must not emit (their stale partials would otherwise paint
  // over the "Processing speech locally…" finalizing state). The whole-utterance
  // commit emit is exempt — it is the authoritative final.
  private isStopping: boolean = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private pauseDetector: PauseDetector;
  private lastTranscriptEmitAtMs: number = 0;
  private preTranscriptMetadataRetryCount: number = 0;
  private pendingFirstTranscript: string | null = null;
  private bestVisibleProvisionalTranscript: string = '';
  private liveProvisionalTranscript: string = '';
  private firstTranscriptAgreementRounds: number = 0;
  private utteranceAudioChunks: Float32Array[] = [];
  private utteranceSampleCount: number = 0;
  private utteranceTrailingSilentSamples: number = 0;
  private wholeUtteranceTranscript: string = '';
  // Timing anchors (diagnostics only) for explaining first-text / final-decode
  // latency. performance.now() ms; null until set this recording.
  private streamStartAtMs: number | null = null;
  private speechStartAtMs: number | null = null;
  // Slice 1 timing telemetry (window.__PRIVATE_TIMING__). Diagnostics only.
  private firstProvisionalAtMs: number | null = null;
  private firstFinalAtMs: number | null = null;
  private finalizeDecodeMs: number | null = null;
  private finalizeWaitMs: number | null = null;
  private finalizePrepMs: number | null = null;
  private stopRequestedAtMs: number | null = null;
  private peakBufferedSamples: number = 0;
  private retainedUtterancePrerollSamplesAtStart: number = 0;
  private speechGateStats: SpeechGateStats = {
    framesSeen: 0,
    speechFramesSeen: 0,
    resetCount: 0,
    candidateResetCount: 0,
    maxRms: 0,
    maxPeak: 0,
    firstSpeechFrameAtMs: null,
    lastCandidateSamples: 0,
  };
  private noiseFloor: number = 0.002;
  private currentThreshold: number = PRIV_STT.SPEECH_START_RMS_THRESHOLD;

  public get type(): EngineType {
    return (this.privateSTT.getEngineType() as EngineType) || 'whisper-turbo';
  }

  /**
   * Diagnostics only: recompute + publish window.__PRIVATE_TIMING__ (Slice 1).
   * Always on (not trace-gated) so any proof can read it; never gates behavior.
   */
  private publishPrivateTiming(): void {
    if (typeof window === 'undefined') return;
    window.__PRIVATE_TIMING__ = buildPrivateTimingSummary({
      streamStartAtMs: this.streamStartAtMs,
      speechStartAtMs: this.speechStartAtMs,
      firstProvisionalAtMs: this.firstProvisionalAtMs,
      firstFinalAtMs: this.firstFinalAtMs,
      finalizeDecodeMs: this.finalizeDecodeMs,
      finalizeWaitMs: this.finalizeWaitMs,
      finalizePrepMs: this.finalizePrepMs,
      utteranceSampleCount: this.utteranceSampleCount,
      peakBufferedSamples: this.peakBufferedSamples,
      nowMs: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    });
  }

  /** Record the first visible draft provisional time once per recording. */
  private markFirstProvisional(): void {
    if (this.firstProvisionalAtMs == null) {
      this.firstProvisionalAtMs = performance.now();
      this.publishPrivateTiming();
    }
  }

  /** Record the first committed (non-draft) transcript time once per recording. */
  private markFirstFinal(): void {
    if (this.firstFinalAtMs == null) {
      this.firstFinalAtMs = performance.now();
      this.publishPrivateTiming();
    }
  }

  private emitProvisionalPartial(text: string, reason: string): void {
    const partial = text.trim();
    if (!partial || !this.onTranscriptUpdate) return;
    // After Stop, do not paint stale live partials over the finalizing state.
    if (this.isStopping) return;
    if (isUnsafePrivateTranscriptCandidate(partial)) {
      pushPrivateTimeline('first_transcript_provisional_partial_rejected', {
        serviceId: this.serviceId,
        runId: this.instanceId,
        textLength: partial.length,
        preview: redactTranscript(partial),
        reason,
      });
      return;
    }
    const visiblePartial = mergeLiveProvisionalTranscript(this.liveProvisionalTranscript, partial);
    this.liveProvisionalTranscript = visiblePartial;
    if (shouldPreferVisibleProvisional(visiblePartial, this.bestVisibleProvisionalTranscript)) {
      this.bestVisibleProvisionalTranscript = visiblePartial;
    } else if (!this.bestVisibleProvisionalTranscript.trim()) {
      this.bestVisibleProvisionalTranscript = visiblePartial;
    }
    pushPrivateTimeline('first_transcript_provisional_partial_emit', {
      serviceId: this.serviceId,
      runId: this.instanceId,
      textLength: visiblePartial.length,
      preview: redactTranscript(visiblePartial),
      rawPreview: redactTranscript(partial),
      reason,
      emittedToUi: true,
    });
    this.lastTranscriptEmitAtMs = performance.now();
    this.onTranscriptUpdate({ transcript: { partial: visiblePartial } });
    this.markFirstProvisional();
  }

  constructor(options: TranscriptionModeOptions, privateSTT?: IPrivateSTT) {
    super(options);
    this.onTranscriptUpdate = options.onTranscriptUpdate;
    this.onModelLoadProgress = options.onModelLoadProgress;
    this.onReady = options.onReady;
    this.onAudioData = options.onAudioData;
    this.onStatusChange = options.onStatusChange;

    // Set base properties manually for immediate construction logging
    // init() will override these based on callbacks, but constructor runs first
    this.serviceId = options.serviceId || 'unknown';
    this.runId = options.runId || 'unknown';

    this.status = 'uninitialized';
    this.currentTranscript = '';
    this.wholeUtteranceTranscript = '';
    this.utteranceAudioChunks = [];
    this.utteranceSampleCount = 0;
    this.utteranceTrailingSilentSamples = 0;
    this.privateSTT = (privateSTT as IPrivateSTT) || (createPrivateSTT(options as PrivateSTTInitOptions) as IPrivateSTT);
    this.pauseDetector = new PauseDetector();
    this.lastHeartbeat = Date.now();

    // Check for E2E environment and expose instance for verification
    if (ENV.isE2E) {
      logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[PrivateWhisper] 🧪 Exposing instance for E2E testing');
      window.__PrivateWhisper_INT_TEST__ = this;
    }

    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[PrivateWhisper] Initialized (dual-engine facade).');
  }

  public async checkAvailability(): Promise<import('../STTStrategy').AvailabilityResult> {
    if (typeof this.privateSTT.checkAvailability === 'function') {
      return this.privateSTT.checkAvailability();
    }

    logger.error({ sId: this.serviceId, rId: this.instanceId }, '[PrivateWhisper] PrivateSTT facade does not expose checkAvailability');
    return {
      isAvailable: false,
      reason: 'UNKNOWN',
      message: 'Private STT availability could not be checked before setup.',
    };
  }

  protected async onInit(timeoutMs?: number): Promise<Result<void, Error>> {
    if (this.status === 'idle' || this.status === 'transcribing') {
      logger.info({ sId: this.serviceId, rId: this.instanceId }, `[PrivateWhisper] Already ${this.status}, skipping init.`);
      if (this.onReady) {
        this.onReady();
      }
      return Result.ok(undefined);
    }
    logger.info({ sId: this.serviceId, rId: this.instanceId }, '[PrivateWhisper] 🔄 init() START - Dual-Engine Mode');
    this.status = 'loading';
    this.updateHeartbeat();

    try {
      // Trigger initial progress
      if (this.onModelLoadProgress) {
        this.onModelLoadProgress(0);
      }

      // Initialize the PrivateSTT facade (auto-selects best engine)
      const initPromise = this.privateSTT.init(timeoutMs);

      const result = await initPromise;

      if (result.isOk === false) {
        throw result.error;
      }

      this.engineType = this.privateSTT.getEngineType() as EngineType;
      this.status = 'idle';
      this.updateHeartbeat();
      logger.info({ sId: this.serviceId, rId: this.instanceId, engineType: this.engineType }, '[PrivateWhisper] ✅ Engine initialized');

      // ✅ EXPLICIT READINESS SIGNAL FOR TESTS (Engine Variant)
      if (typeof document !== 'undefined') {
        document.body.setAttribute('data-engine-variant', this.engineType || 'unknown');
      }

      logger.info({ sId: this.serviceId, rId: this.instanceId }, `[PrivateWhisper] Model ready! Using ${this.engineType === 'whisper-turbo' ? 'GPU acceleration' : 'CPU mode'}.`);

      // ✅ EXPLICIT READINESS SIGNAL FOR TESTS
      if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.__e2e_stt_engine_ready_fired__ = true;
        window.dispatchEvent(new CustomEvent('stt-engine-ready'));
      }

      // Notify that the service is ready
      if (this.onReady) {
        this.onReady();
      }
      return Result.ok(undefined);
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));

      // Extract CACHE_MISS for specialized UI handling
      if (error.message.includes('not found in cache') || error.message.includes('CACHE_MISS')) {
        logger.warn({ sId: this.serviceId, rId: this.instanceId }, '[PrivateWhisper] 📥 Cache miss detected during init.');
        this.status = 'error';
        throw TranscriptionError.cacheMiss();
      }

      logger.error({ sId: this.serviceId, rId: this.instanceId, err: error }, '[PrivateWhisper] ❌ Init failed');
      this.status = 'error';

      throw error;
    }
  }

  protected async onStart(mic?: MicStream): Promise<void> {
    if (!mic) {
      logger.error('[PrivateWhisper CRITICAL] onStart called with null/undefined mic!');
      throw new Error('MicStream is required for PrivateWhisper');
    }
    this.mic = mic;
    if (typeof this.mic.onFrame !== 'function') {
      logger.error({ sId: this.serviceId, rId: this.instanceId }, '[PrivateWhisper CRITICAL] MicStream missing onFrame method!');
      throw new Error('Invalid MicStream: missing onFrame method');
    }

    logger.info({ sId: this.serviceId, rId: this.instanceId }, '[PrivateWhisper] start() called.');
    if (this.status !== 'idle') {
      logger.warn({ sId: this.serviceId, rId: this.instanceId, status: this.status }, `[PrivateWhisper] Unexpected status: ${this.status}, expected 'idle'`);
    }
    this.status = 'transcribing';
    this.clearAudioBuffer();
    this.clearRetryAudioBuffer();
    this.clearSpeechStartState();
    this.noiseFloor = 0.002;
    this.currentThreshold = PRIV_STT.SPEECH_START_RMS_THRESHOLD;
    this.currentTranscript = '';
    this.wholeUtteranceTranscript = '';
    this.utteranceAudioChunks = [];
    this.utteranceSampleCount = 0;
    this.utteranceTrailingSilentSamples = 0;
    this.lastTranscriptEmitAtMs = 0;
    this.preTranscriptMetadataRetryCount = 0;
    this.pendingFirstTranscript = null;
    this.bestVisibleProvisionalTranscript = '';
    this.liveProvisionalTranscript = '';
    this.firstTranscriptAgreementRounds = 0;
    this.isStopping = false;
    this.streamStartAtMs = performance.now();
    this.speechStartAtMs = null;
    this.retainedUtterancePrerollSamplesAtStart = 0;
    // Reset Slice 1 timing telemetry for the new recording.
    this.firstProvisionalAtMs = null;
    this.firstFinalAtMs = null;
    this.finalizeDecodeMs = null;
    this.finalizeWaitMs = null;
    this.finalizePrepMs = null;
    this.stopRequestedAtMs = null;
    this.peakBufferedSamples = 0;
    this.publishPrivateTiming();
    this.updateHeartbeat();
    pushPrivateTimeline('stream_start', {
      serviceId: this.serviceId,
      runId: this.instanceId,
      minTranscriptionSamples: MIN_TRANSCRIPTION_SAMPLES,
      minTranscriptionSeconds: PRIV_STT.MIN_TRANSCRIPTION_SECONDS,
      processingIntervalMs: PROCESSING_INTERVAL_MS,
      postTranscriptPaintGraceMs: PRIV_STT.POST_TRANSCRIPT_PAINT_GRACE_MS,
      speechStartMinSamples: SPEECH_START_MIN_SAMPLES,
      speechStartMinMs: PRIV_STT.SPEECH_START_MIN_MS,
      speechStartPrerollSamples: SPEECH_START_PREROLL_SAMPLES,
      speechStartPrerollMs: PRIV_STT.SPEECH_START_PREROLL_MS,
      speechStartResetToleranceSamples: SPEECH_START_RESET_TOLERANCE_SAMPLES,
      speechStartResetToleranceMs: PRIV_STT.SPEECH_START_RESET_TOLERANCE_MS,
    });

    // Subscribe to microphone frames
    this.cleanupFrameListener(); // CRITICAL: Clean up previous listener before adding new one

    const listener = (frame: Float32Array) => {
      // Copy the frame to avoid buffer detachment issues
      const clonedFrame = frame.slice(0);

      // Track silence per-frame for accurate pause metrics (analytics only)
      this.pauseDetector.processAudioFrame(clonedFrame);
      const energy = summarizeAudioEnergy(clonedFrame);
      if (!this.hasDetectedSpeech) {
        if (energy.rms < PRIV_STT.SPEECH_START_RMS_THRESHOLD) {
          this.noiseFloor = this.noiseFloor * 0.95 + energy.rms * 0.05;
        }
        this.currentThreshold = Math.max(0.003, Math.min(PRIV_STT.SPEECH_START_RMS_THRESHOLD, this.noiseFloor * 2.0));
      }
      const isSpeechFrame = energy.rms >= this.currentThreshold;

      if (!this.hasDetectedSpeech) {
        this.recordSpeechGateFrame(energy, isSpeechFrame);

        if (isSpeechFrame) {
          this.speechStartAudioChunks.push(clonedFrame);
          this.consecutiveSpeechSamples += clonedFrame.length;
          this.speechStartQuietSamples = 0;
        } else if (
          this.consecutiveSpeechSamples > 0 &&
          this.speechStartQuietSamples + clonedFrame.length <= SPEECH_START_RESET_TOLERANCE_SAMPLES
        ) {
          this.speechStartAudioChunks.push(clonedFrame);
          this.speechStartQuietSamples += clonedFrame.length;
        } else {
          this.recordSpeechGateReset();
          this.preserveSpeechStartCandidateAsPreroll();
          this.speechStartAudioChunks = [];
          this.consecutiveSpeechSamples = 0;
          this.speechStartQuietSamples = 0;
          this.addPrerollFrame(clonedFrame);
        }

        if (this.consecutiveSpeechSamples >= SPEECH_START_MIN_SAMPLES) {
          this.hasDetectedSpeech = true;
          // Timing diagnostics: when speech crossed the gate, and how much pre-onset
          // preroll was retained into the buffers at that moment.
          this.speechStartAtMs = performance.now();
          this.retainedUtterancePrerollSamplesAtStart = this.prerollSampleCount;
          const speechStartOffsetMs = this.streamStartAtMs == null
            ? null
            : Number((this.speechStartAtMs - this.streamStartAtMs).toFixed(1));
          const speechStartBufferedSamples = this.speechStartAudioChunks.reduce(
            (sum, chunk) => sum + chunk.length,
            0,
          );
          this.audioChunks = [
            ...this.prerollAudioChunks.map((chunk) => chunk.slice(0)),
            ...this.speechStartAudioChunks.map((chunk) => chunk.slice(0)),
          ];
          this.bufferedSampleCount = this.prerollSampleCount + speechStartBufferedSamples;
          this.appendUtteranceAudio(this.audioChunks);
          this.prerollAudioChunks = [];
          this.prerollSampleCount = 0;
          this.speechStartAudioChunks = [];

          pushPrivateTimeline('speech_start_detected', {
            serviceId: this.serviceId,
            runId: this.instanceId,
            bufferedSamples: this.bufferedSampleCount,
            bufferedSeconds: Number(samplesToSeconds(this.bufferedSampleCount, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
            consecutiveSpeechSamples: this.consecutiveSpeechSamples,
            speechStartBufferedSamples,
            speechStartMinSamples: SPEECH_START_MIN_SAMPLES,
            prerollSamples: SPEECH_START_PREROLL_SAMPLES,
            toleratedQuietSamples: this.speechStartQuietSamples,
            // Diagnostics: latency from mic-start to speech detection, and the
            // pre-onset preroll actually retained into the buffers.
            speechStartOffsetMs,
            retainedPrerollSamples: this.retainedUtterancePrerollSamplesAtStart,
            retainedPrerollMs: Number((samplesToSeconds(this.retainedUtterancePrerollSamplesAtStart, PRIVATE_STT_SAMPLE_RATE) * 1000).toFixed(1)),
            speechGateStats: this.getSpeechGateStatsSnapshot(),
          });

          if (isPrivateTranscriptTraceEnabled()) {
            logger.info({
              sId: this.serviceId,
              rId: this.instanceId,
              bufferedSamples: this.bufferedSampleCount,
              speechStartMinSamples: SPEECH_START_MIN_SAMPLES,
              prerollSamples: SPEECH_START_PREROLL_SAMPLES,
            }, '[PRIVATE_TRACE] speech_start_detected_with_preroll');
          }
        }
      } else {
        this.audioChunks.push(clonedFrame);
        this.bufferedSampleCount += clonedFrame.length;
        if (this.bufferedSampleCount > this.peakBufferedSamples) {
          this.peakBufferedSamples = this.bufferedSampleCount;
        }
        this.appendFrameToUtteranceAudio(clonedFrame, energy);
      }

      if (isPrivateTranscriptTraceEnabled()) {
        logger.info({
          sId: this.serviceId,
          rId: this.instanceId,
          frameSamples: clonedFrame.length,
          frameRms: Number(energy.rms.toFixed(6)),
          isSpeechFrame,
          hasDetectedSpeech: this.hasDetectedSpeech,
          bufferedChunks: this.audioChunks.length,
          bufferedSamples: this.bufferedSampleCount,
          prerollSamples: this.prerollSampleCount,
        }, '[PRIVATE_TRACE] audio_frame_in');
      }

      // Pass raw audio to analysis hooks (Pause Detection)
      if (this.onAudioData) {
        this.onAudioData(clonedFrame);
      }
    };

    // Store the disposer returned by onFrame
    this.frameListenerDisposer = this.mic.onFrame(listener);

    // Poll frequently; the sample threshold gates expensive model inference.
    this.processingInterval = setInterval(() => {
      void this.processAudio();
    }, PROCESSING_INTERVAL_MS);

    logger.info({ sId: this.serviceId, rId: this.instanceId }, '[PrivateWhisper] Streaming started.');
  }

  private async processAudio({ force = false }: { force?: boolean } = {}): Promise<void> {
    this.updateHeartbeat();
    if (this.isProcessing) {
      return; // Already processing, skip
    }
    if (this.audioChunks.length === 0) {
      return; // No audio to process
    }
    if (!force && !this.hasDetectedSpeech) {
      return; // Do not let initial room silence become the first Whisper chunk.
    }
    if (!force && this.bufferedSampleCount < MIN_TRANSCRIPTION_SAMPLES) {
      return; // Avoid repeated concatenation copies until there is enough audio.
    }
    if (
      !force &&
      this.currentTranscript.trim().length > 0 &&
      this.lastTranscriptEmitAtMs > 0 &&
      performance.now() - this.lastTranscriptEmitAtMs < PRIV_STT.POST_TRANSCRIPT_PAINT_GRACE_MS
    ) {
      pushPrivateTimeline('paint_grace_skip', {
        serviceId: this.serviceId,
        runId: this.instanceId,
        elapsedSinceEmitMs: Number((performance.now() - this.lastTranscriptEmitAtMs).toFixed(2)),
        graceMs: PRIV_STT.POST_TRANSCRIPT_PAINT_GRACE_MS,
        bufferedSamples: this.bufferedSampleCount,
      });
      return;
    }

    this.isProcessing = true;
    const tStart = performance.now();

    try {
      // Concatenate all chunks using shared utility
      const liveAudio = concatenateFloat32Arrays(this.audioChunks);
      const concatenated = this.retryAudioBuffer
        ? concatenateFloat32Arrays([this.retryAudioBuffer, liveAudio])
        : liveAudio;
      const processorEnergy = summarizeAudioEnergy(concatenated);
      pushPrivateTimeline('process_audio_ready', {
        serviceId: this.serviceId,
        runId: this.instanceId,
        force,
        chunks: this.audioChunks.length,
        liveSamples: liveAudio.length,
        retrySamples: this.retryAudioBuffer?.length ?? 0,
        samples: concatenated.length,
        durationSec: Number(samplesToSeconds(concatenated.length, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
        rms: Number(processorEnergy.rms.toFixed(6)),
        peak: Number(processorEnergy.peak.toFixed(6)),
      });
      if (isPrivateTranscriptTraceEnabled()) {
        logger.info({
          sId: this.serviceId,
          rId: this.instanceId,
          force,
          chunks: this.audioChunks.length,
          liveSamples: liveAudio.length,
          retrySamples: this.retryAudioBuffer?.length ?? 0,
          samples: concatenated.length,
          durationSec: Number(samplesToSeconds(concatenated.length, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
          rms: Number(processorEnergy.rms.toFixed(6)),
          peak: Number(processorEnergy.peak.toFixed(6)),
        }, '[PRIVATE_TRACE] processor_output');
      }

      if (!force && concatenated.length < MIN_TRANSCRIPTION_SAMPLES) {
        this.bufferedSampleCount = concatenated.length;
        return;
      }
      if (
        force &&
        this.currentTranscript.trim().length > 0 &&
        concatenated.length < FORCE_FINAL_MIN_SAMPLES
      ) {
        pushPrivateTimeline('force_tail_drop', {
          serviceId: this.serviceId,
          runId: this.instanceId,
          samples: concatenated.length,
          durationSec: Number(samplesToSeconds(concatenated.length, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
          forceFinalMinSamples: FORCE_FINAL_MIN_SAMPLES,
          forceFinalMinSeconds: PRIV_STT.FORCE_FINAL_MIN_SECONDS,
        });
        this.clearAudioBuffer();
        this.clearRetryAudioBuffer();
        this.clearSpeechStartState();
        return;
      }

      const energy = summarizeAudioEnergy(concatenated);
      const isBufferSilent = energy.rms < SESSION_PAUSE.SILENCE_RMS_THRESHOLD;
      const isMeaningfullySilent = this.pauseDetector.isMeaningfullySilent();
      const isLowEnergyPauseTail =
        isMeaningfullySilent && energy.rms < SESSION_PAUSE.SILENCE_RMS_THRESHOLD * 3;
      const hasTranscript = this.currentTranscript.trim().length > 0;
      const isPostTranscriptLowEnergy =
        hasTranscript && energy.rms < SESSION_PAUSE.SILENCE_RMS_THRESHOLD * 3;
      pushPrivateTimeline('silence_gate_decision', {
        serviceId: this.serviceId,
        runId: this.instanceId,
        force,
        samples: concatenated.length,
        durationSec: Number(samplesToSeconds(concatenated.length, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
        rms: Number(energy.rms.toFixed(6)),
        peak: Number(energy.peak.toFixed(6)),
        silenceThreshold: SESSION_PAUSE.SILENCE_RMS_THRESHOLD,
        lowEnergyPauseTailThreshold: SESSION_PAUSE.SILENCE_RMS_THRESHOLD * 3,
        isBufferSilent,
        isMeaningfullySilent,
        isLowEnergyPauseTail,
        isPostTranscriptLowEnergy,
      });
      if (isPrivateTranscriptTraceEnabled()) {
        logger.info({
          sId: this.serviceId,
          rId: this.instanceId,
          force,
          samples: concatenated.length,
          durationSec: Number(samplesToSeconds(concatenated.length, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
          rms: Number(energy.rms.toFixed(6)),
          peak: Number(energy.peak.toFixed(6)),
          silenceThreshold: SESSION_PAUSE.SILENCE_RMS_THRESHOLD,
          isBufferSilent,
          isPauseDetectorSilent: isMeaningfullySilent,
          isLowEnergyPauseTail,
          isPostTranscriptLowEnergy,
        }, '[PRIVATE_TRACE] silence_gate_decision');
      }

      // Gate transcription on the audio buffer that would be sent to Whisper.
      // A current meaningful pause means the speech run ended. Clear tail audio
      // and require a fresh speech-start gate so room noise cannot be sent as
      // another Whisper chunk.
      const isFirstChunk = this.currentTranscript.trim() === '';
      if (!force && isPostTranscriptLowEnergy && !isBufferSilent && !isLowEnergyPauseTail && !isFirstChunk) {
        pushPrivateTimeline('post_transcript_low_energy_tail_deferred', {
          serviceId: this.serviceId,
          runId: this.instanceId,
          samples: concatenated.length,
          rms: Number(energy.rms.toFixed(6)),
          isBufferSilent,
          isMeaningfullySilent,
          isLowEnergyPauseTail,
          isPostTranscriptLowEnergy,
        });
        logger.debug({
          sId: this.serviceId,
          rId: this.instanceId,
          samples: concatenated.length,
          rms: Number(energy.rms.toFixed(6)),
          threshold: SESSION_PAUSE.SILENCE_RMS_THRESHOLD,
        }, '[PrivateWhisper] Deferring low-energy post-transcript tail for later speech or stop');
        return;
      }

      if (!force && (isBufferSilent || isLowEnergyPauseTail) && !isFirstChunk) {
        pushPrivateTimeline('silence_gate_drop', {
          serviceId: this.serviceId,
          runId: this.instanceId,
          samples: concatenated.length,
          rms: Number(energy.rms.toFixed(6)),
          isBufferSilent,
          isMeaningfullySilent,
          isLowEnergyPauseTail,
          isPostTranscriptLowEnergy,
        });
        logger.debug({
          sId: this.serviceId,
          rId: this.instanceId,
          samples: concatenated.length,
          rms: Number(energy.rms.toFixed(6)),
          threshold: SESSION_PAUSE.SILENCE_RMS_THRESHOLD,
          isMeaningfullySilent,
          isLowEnergyPauseTail,
        }, '[PrivateWhisper] 🤫 Silent buffer detected — skipping transcription');
        this.clearAudioBuffer();
        this.clearRetryAudioBuffer();
        this.clearSpeechStartState();
        return;
      }

      if (force && hasTranscript && (isBufferSilent || isLowEnergyPauseTail || isPostTranscriptLowEnergy)) {
        pushPrivateTimeline('force_low_energy_tail_drop', {
          serviceId: this.serviceId,
          runId: this.instanceId,
          samples: concatenated.length,
          rms: Number(energy.rms.toFixed(6)),
          isBufferSilent,
          isMeaningfullySilent,
          isLowEnergyPauseTail,
          isPostTranscriptLowEnergy,
        });
        logger.debug({
          sId: this.serviceId,
          rId: this.instanceId,
          samples: concatenated.length,
          rms: Number(energy.rms.toFixed(6)),
          threshold: SESSION_PAUSE.SILENCE_RMS_THRESHOLD,
          isMeaningfullySilent,
          isLowEnergyPauseTail,
        }, '[PrivateWhisper] Dropping low-energy forced tail before Whisper inference');
        this.clearAudioBuffer();
        this.clearRetryAudioBuffer();
        this.clearSpeechStartState();
        return;
      }

      if (this.currentTranscript.length === 0) {
        const expectedDurationSec = samplesToSeconds(concatenated.length, PRIVATE_STT_SAMPLE_RATE);
        logger.info({ sId: this.serviceId, rId: this.instanceId, samples: concatenated.length, expectedDurationSec }, '[PrivateWhisper] 🎤 Processing chunk');
      }

      const processedAudio = force ? concatenated : this.capLiveDecodeWindow(concatenated);

      // Atomically capture and clear live frames in the same synchronous tick.
      // New frames that arrive while inference is running will be appended to a
      // fresh buffer by the mic listener and processed on a later interval.
      this.clearAudioBuffer();

      // Perform transcription using the PrivateSTT facade
      if (isPrivateTranscriptTraceEnabled()) {
        const energy = summarizeAudioEnergy(processedAudio);
        pushPrivateTimeline('model_inference_start', {
          serviceId: this.serviceId,
          runId: this.instanceId,
          samples: processedAudio.length,
          durationSec: Number(samplesToSeconds(processedAudio.length, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
          rms: Number(energy.rms.toFixed(6)),
          peak: Number(energy.peak.toFixed(6)),
        });
        logger.info({
          sId: this.serviceId,
          rId: this.instanceId,
          samples: processedAudio.length,
          rms: Number(energy.rms.toFixed(6)),
          peak: Number(energy.peak.toFixed(6)),
        }, '[PRIVATE_TRACE] model_inference_start');
      }
      const capturedAudioIndex = capturePrivateInferenceAudio(processedAudio);
      const result = await this.privateSTT.transcribe(processedAudio);
      if (this.status !== 'transcribing') {
        pushPrivateTimeline('model_inference_result_ignored_after_stop', {
          serviceId: this.serviceId,
          runId: this.instanceId,
          ok: result.isOk,
        });
        return;
      }
      pushPrivateTimeline('model_inference_result', {
        serviceId: this.serviceId,
        runId: this.instanceId,
        ok: result.isOk,
        textLength: result.isOk ? (result.data || '').length : 0,
        trimLength: result.isOk ? (result.data || '').trim().length : 0,
        preview: result.isOk ? redactTranscript(result.data || '') : null,
        error: result.isOk ? null : result.error?.message,
      });
      if (isPrivateTranscriptTraceEnabled()) {
        logger.info({
          sId: this.serviceId,
          rId: this.instanceId,
          ok: result.isOk,
          textLength: result.isOk ? (result.data || '').length : 0,
          trimLength: result.isOk ? (result.data || '').trim().length : 0,
          preview: result.isOk ? redactTranscript(result.data || '') : null,
          error: result.isOk ? null : result.error?.message,
        }, '[PRIVATE_TRACE] model_inference_result');
      }

      if (result.isOk === false) {
        if (capturedAudioIndex !== null) {
          const captured = window.__PRIVATE_INFERENCE_AUDIO_CHUNKS__?.[capturedAudioIndex];
          if (captured) captured.error = result.error?.message;
        }
        throw result.error;
      }

      // Append new text to transcript (incremental)
      const newText = result.data || '';
      let textToEmit = newText;
      if (capturedAudioIndex !== null) {
        const captured = window.__PRIVATE_INFERENCE_AUDIO_CHUNKS__?.[capturedAudioIndex];
        if (captured) captured.transcript = newText;
      }

      if (isNonSpeechMetadataOnlyTranscript(newText)) {
        if (this.currentTranscript.trim()) {
          this.clearRetryAudioBuffer();
          this.clearSpeechStartState();
          pushPrivateTimeline('metadata_tail_drop', {
            serviceId: this.serviceId,
            runId: this.instanceId,
            preview: redactTranscript(newText),
          });
          logger.info({
            sId: this.serviceId,
            rId: this.instanceId,
            preview: redactTranscript(newText),
          }, '[PrivateWhisper] Dropping post-transcript metadata chunk as tail noise');
          return;
        }

        this.preTranscriptMetadataRetryCount += 1;
        pushPrivateTimeline('metadata_pre_transcript_retain', {
          serviceId: this.serviceId,
          runId: this.instanceId,
          preview: redactTranscript(newText),
          metadataRetryCount: this.preTranscriptMetadataRetryCount,
          metadataRetryLimit: PRIV_STT.PRE_TRANSCRIPT_METADATA_RETRY_LIMIT,
        });

        if (this.preTranscriptMetadataRetryCount > PRIV_STT.PRE_TRANSCRIPT_METADATA_RETRY_LIMIT) {
          pushPrivateTimeline('metadata_pre_transcript_retry_limit_drop', {
            serviceId: this.serviceId,
            runId: this.instanceId,
            preview: redactTranscript(newText),
            metadataRetryCount: this.preTranscriptMetadataRetryCount,
            metadataRetryLimit: PRIV_STT.PRE_TRANSCRIPT_METADATA_RETRY_LIMIT,
            droppedRetrySamples: this.retryAudioBuffer?.length ?? 0,
          });
          logger.info({
            sId: this.serviceId,
            rId: this.instanceId,
            preview: redactTranscript(newText),
            retryCount: this.preTranscriptMetadataRetryCount,
          }, '[PrivateWhisper] Dropping repeated pre-transcript metadata context');
          this.clearRetryAudioBuffer();
          this.preTranscriptMetadataRetryCount = 0;
          return;
        }

        logger.info({
          sId: this.serviceId,
          rId: this.instanceId,
          preview: redactTranscript(newText),
          retryCount: this.preTranscriptMetadataRetryCount,
        }, '[PrivateWhisper] Retaining non-speech metadata chunk for retry context');
        this.retainSpeechLikeAudioForRetry(processedAudio, energy, 'metadata_pre_transcript');
        return;
      }

      if (!this.currentTranscript.trim() && isKnownHallucinationTranscript(newText)) {
        pushPrivateTimeline('first_transcript_hallucination_retain', {
          serviceId: this.serviceId,
          runId: this.instanceId,
          preview: redactTranscript(newText),
          samples: processedAudio.length,
          durationSec: Number(samplesToSeconds(processedAudio.length, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
          rms: Number(energy.rms.toFixed(6)),
          peak: Number(energy.peak.toFixed(6)),
        });
        logger.info({
          sId: this.serviceId,
          rId: this.instanceId,
          preview: redactTranscript(newText),
        }, '[PrivateWhisper] Holding known Whisper hallucination pattern before first transcript');
        this.retainSpeechLikeAudioForRetry(processedAudio, energy, 'known_hallucination_first_transcript');
        return;
      }

      if (!this.currentTranscript.trim() && hasUnsafePrivateCandidateMarker(newText)) {
        pushPrivateTimeline('first_transcript_unsafe_marker_retain', {
          serviceId: this.serviceId,
          runId: this.instanceId,
          preview: redactTranscript(newText),
          samples: processedAudio.length,
          durationSec: Number(samplesToSeconds(processedAudio.length, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
          rms: Number(energy.rms.toFixed(6)),
          peak: Number(energy.peak.toFixed(6)),
        });
        logger.info({
          sId: this.serviceId,
          rId: this.instanceId,
          preview: redactTranscript(newText),
        }, '[PrivateWhisper] Holding unsafe non-speech marker before first transcript');
        this.retainSpeechLikeAudioForRetry(processedAudio, energy, 'unsafe_marker_first_transcript');
        return;
      }

      if (!this.currentTranscript.trim() && newText.trim()) {
        const processedDurationSec = samplesToSeconds(processedAudio.length, PRIVATE_STT_SAMPLE_RATE);
        const canEmitPartial = canEmitFirstPartial(
          newText,
          energy,
          Boolean(this.liveProvisionalTranscript.trim()),
        );
        const canPromoteToFinal = hasFirstTranscriptEmissionSubstance(newText, energy, processedDurationSec);

        if (!canPromoteToFinal) {
          pushPrivateTimeline('first_transcript_substance_retain', {
            serviceId: this.serviceId,
            runId: this.instanceId,
            preview: redactTranscript(newText),
            wordCount: getTranscriptWords(newText).length,
            minWords: PRIV_STT.FIRST_TRANSCRIPT_MIN_WORDS,
            rms: Number(energy.rms.toFixed(6)),
            minRms: PRIV_STT.FIRST_TRANSCRIPT_MIN_RMS,
            samples: processedAudio.length,
            durationSec: Number(processedDurationSec.toFixed(3)),
            minDurationSec: PRIV_STT.FIRST_TRANSCRIPT_MIN_DURATION_SECONDS,
            canEmitPartial,
          });
          logger.info({
            sId: this.serviceId,
            rId: this.instanceId,
            preview: redactTranscript(newText),
            wordCount: getTranscriptWords(newText).length,
            rms: Number(energy.rms.toFixed(6)),
            durationSec: Number(processedDurationSec.toFixed(3)),
          }, '[PrivateWhisper] Holding first transcript until it has speech-like substance');
          if (canEmitPartial) {
            this.emitProvisionalPartial(newText, 'pre_final_threshold');
          }
          this.retainSpeechLikeAudioForRetry(processedAudio, energy, 'first_transcript_substance');
          return;
        }

        const previousCandidate = this.pendingFirstTranscript;
        const stablePrefix = previousCandidate ? getStableWordPrefix(previousCandidate, newText) : '';

        if (previousCandidate && stablePrefix) {
          this.firstTranscriptAgreementRounds += 1;
        } else {
          this.pendingFirstTranscript = newText;
          this.firstTranscriptAgreementRounds = 1;
        }

        if (this.firstTranscriptAgreementRounds < PRIV_STT.FIRST_TRANSCRIPT_LOCAL_AGREEMENT_ROUNDS) {
          pushPrivateTimeline('first_transcript_local_agreement_retain', {
            serviceId: this.serviceId,
            runId: this.instanceId,
            preview: redactTranscript(newText),
            previousPreview: previousCandidate ? redactTranscript(previousCandidate) : null,
            stablePrefix: redactTranscript(stablePrefix),
            agreementRounds: this.firstTranscriptAgreementRounds,
            requiredAgreementRounds: PRIV_STT.FIRST_TRANSCRIPT_LOCAL_AGREEMENT_ROUNDS,
            samples: processedAudio.length,
            durationSec: Number(samplesToSeconds(processedAudio.length, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
          });
          logger.info({
            sId: this.serviceId,
            rId: this.instanceId,
            preview: redactTranscript(newText),
            previousPreview: previousCandidate ? redactTranscript(previousCandidate) : null,
            stablePrefix: redactTranscript(stablePrefix),
          }, '[PrivateWhisper] Holding first transcript until local agreement confirms it');
          if (canEmitPartial) {
            this.emitProvisionalPartial(newText, 'local_agreement_pending');
          }
          this.retainSpeechLikeAudioForRetry(processedAudio, energy, 'first_transcript_local_agreement');
          return;
        }

        if (stablePrefix && normalizeTranscriptForGate(stablePrefix) !== normalizeTranscriptForGate(newText)) {
          const stablePrefixWordCount = getTranscriptWords(stablePrefix).length;
          if (stablePrefixWordCount < PRIV_STT.FIRST_TRANSCRIPT_MIN_WORDS) {
            pushPrivateTimeline('first_transcript_local_agreement_prefix_too_short', {
              serviceId: this.serviceId,
              runId: this.instanceId,
              preview: redactTranscript(newText),
              stablePrefix: redactTranscript(stablePrefix),
              stablePrefixWordCount,
              minWords: PRIV_STT.FIRST_TRANSCRIPT_MIN_WORDS,
              agreementRounds: this.firstTranscriptAgreementRounds,
            });
            logger.info({
              sId: this.serviceId,
              rId: this.instanceId,
              stablePrefix: redactTranscript(stablePrefix),
              stablePrefixWordCount,
              minWords: PRIV_STT.FIRST_TRANSCRIPT_MIN_WORDS,
            }, '[PrivateWhisper] Holding first transcript because stable prefix is too short');
            if (canEmitPartial) {
              this.emitProvisionalPartial(newText, 'stable_prefix_too_short');
            }
            this.pendingFirstTranscript = newText;
            this.firstTranscriptAgreementRounds = 1;
            this.retainSpeechLikeAudioForRetry(processedAudio, energy, 'first_transcript_stable_prefix_too_short');
            return;
          }

          textToEmit = stablePrefix;
          pushPrivateTimeline('first_transcript_local_agreement_emit_stable_prefix', {
            serviceId: this.serviceId,
            runId: this.instanceId,
            preview: redactTranscript(newText),
            stablePrefix: redactTranscript(stablePrefix),
            agreementRounds: this.firstTranscriptAgreementRounds,
          });
          logger.info({
            sId: this.serviceId,
            rId: this.instanceId,
            stablePrefix: redactTranscript(stablePrefix),
          }, '[PrivateWhisper] Emitting locally agreed first transcript prefix');
        }
      }

      if (force && this.currentTranscript.trim() && isTinyForcedTailTranscript(newText)) {
        this.clearRetryAudioBuffer();
        this.clearSpeechStartState();
        pushPrivateTimeline('tiny_force_tail_drop', {
          serviceId: this.serviceId,
          runId: this.instanceId,
          preview: redactTranscript(newText),
        });
        logger.info({
          sId: this.serviceId,
          rId: this.instanceId,
          preview: redactTranscript(newText),
        }, '[PrivateWhisper] Dropping tiny forced final tail fragment');
        return;
      }

      if (force && isUnsupportedPostTranscriptCandidate(newText, this.currentTranscript)) {
        this.clearRetryAudioBuffer();
        this.clearSpeechStartState();
        pushPrivateTimeline('unsafe_force_tail_drop', {
          serviceId: this.serviceId,
          runId: this.instanceId,
          preview: redactTranscript(newText),
          currentPreview: redactTranscript(this.currentTranscript),
          overlapRatio: Number(wordOverlapRatio(this.currentTranscript, newText).toFixed(3)),
        });
        logger.info({
          sId: this.serviceId,
          rId: this.instanceId,
          preview: redactTranscript(newText),
          currentPreview: redactTranscript(this.currentTranscript),
        }, '[PrivateWhisper] Dropping unsupported forced final candidate');
        return;
      }

      if (!force && this.currentTranscript.trim() && isTinyTranscriptFragment(newText)) {
        pushPrivateTimeline('tiny_post_transcript_fragment_drop', {
          serviceId: this.serviceId,
          runId: this.instanceId,
          preview: redactTranscript(newText),
        });
        logger.info({
          sId: this.serviceId,
          rId: this.instanceId,
          preview: redactTranscript(newText),
        }, '[PrivateWhisper] Dropping tiny post-transcript fragment');
        return;
      }

      if (textToEmit.trim()) {
        this.clearRetryAudioBuffer();
        this.preTranscriptMetadataRetryCount = 0;
        this.pendingFirstTranscript = null;
        this.firstTranscriptAgreementRounds = 0;
        if (!this.currentTranscript.trim() && shouldPreferVisibleProvisional(newText, textToEmit)) {
          pushPrivateTimeline('first_transcript_final_candidate_replaced_by_current_inference', {
            serviceId: this.serviceId,
            runId: this.instanceId,
            finalPreview: redactTranscript(textToEmit),
            inferencePreview: redactTranscript(newText),
          });
          textToEmit = newText;
        } else if (!this.currentTranscript.trim() && shouldPreferVisibleProvisional(this.bestVisibleProvisionalTranscript, textToEmit)) {
          pushPrivateTimeline('first_transcript_final_candidate_replaced_by_visible_provisional', {
            serviceId: this.serviceId,
            runId: this.instanceId,
            finalPreview: redactTranscript(textToEmit),
            provisionalPreview: redactTranscript(this.bestVisibleProvisionalTranscript),
          });
          textToEmit = this.bestVisibleProvisionalTranscript;
        }

        if (!this.currentTranscript.trim() && isUnsafePrivateTranscriptCandidate(textToEmit)) {
          if (shouldPreferVisibleProvisional(this.bestVisibleProvisionalTranscript, textToEmit)) {
            pushPrivateTimeline('first_transcript_unsafe_final_replaced_by_visible_provisional', {
              serviceId: this.serviceId,
              runId: this.instanceId,
              finalPreview: redactTranscript(textToEmit),
              provisionalPreview: redactTranscript(this.bestVisibleProvisionalTranscript),
            });
            textToEmit = this.bestVisibleProvisionalTranscript;
          } else {
            pushPrivateTimeline('first_transcript_unsafe_final_retain', {
              serviceId: this.serviceId,
              runId: this.instanceId,
              preview: redactTranscript(textToEmit),
            });
            this.retainSpeechLikeAudioForRetry(processedAudio, energy, 'unsafe_first_transcript_final');
            return;
          }
        }

        logger.info({ sId: this.serviceId, rId: this.instanceId, newText: redactTranscript(textToEmit), latencyMs: (performance.now() - tStart).toFixed(2) }, '[PrivateWhisper] ✨ Transcription success');
        this.currentTranscript = this.currentTranscript ? `${this.currentTranscript} ${textToEmit}` : textToEmit;
        this.markFirstFinal();
        this.bestVisibleProvisionalTranscript = '';
        this.liveProvisionalTranscript = '';
        // Suppress in-flight live finals once Stop is requested; the whole-utterance
        // commit is the authoritative final from here on.
        if (this.onTranscriptUpdate && !this.isStopping) {
          pushPrivateTimeline('transcript_callback_emit', {
            serviceId: this.serviceId,
            runId: this.instanceId,
            textLength: textToEmit.length,
            preview: redactTranscript(textToEmit),
            processLatencyMs: Number((performance.now() - tStart).toFixed(2)),
          });
          this.lastTranscriptEmitAtMs = performance.now();
          if (isPrivateTranscriptTraceEnabled()) {
            logger.info({
              sId: this.serviceId,
              rId: this.instanceId,
              textLength: textToEmit.length,
            }, '[PRIVATE_TRACE] transcript_callback_emit');
          }
          this.onTranscriptUpdate({ transcript: { final: textToEmit } });
        }
      } else {
        pushPrivateTimeline('empty_transcript_retain', {
          serviceId: this.serviceId,
          runId: this.instanceId,
          samples: processedAudio.length,
          durationSec: Number(samplesToSeconds(processedAudio.length, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
        });
        this.retainSpeechLikeAudioForRetry(processedAudio, energy, 'empty_transcript');
      }

    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error({
        sId: this.serviceId,
        rId: this.instanceId,
        err: error,
        audioChunks: this.audioChunks.length,
        retrySamples: this.retryAudioBuffer?.length ?? 0,
        hasDetectedSpeech: this.hasDetectedSpeech,
        consecutiveSpeechSamples: this.consecutiveSpeechSamples,
        currentTranscript: this.currentTranscript,
      }, '[PrivateWhisper] Transcription processing failed; preserving diagnostic state for STT trace review');
    } finally {
      this.isProcessing = false;
    }
  }

  public async pause(): Promise<void> {
    await super.pause();
  }

  protected async onPause(): Promise<void> {
    logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateWhisper] ⏸️ Internal processing loop paused');
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
  }

  public async resume(): Promise<void> {
    await super.resume();
  }

  protected async onResume(): Promise<void> {
    logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateWhisper] ▶️ Internal processing loop resumed');
    if (!this.processingInterval && this.status === 'transcribing') {
      this.processingInterval = setInterval(() => {
        void this.processAudio();
      }, PROCESSING_INTERVAL_MS);
    }
  }

  protected async onStop(): Promise<void> {
    this.stopRequestedAtMs = performance.now();
    logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateWhisper] 🛑 Stopping engine...');
    pushPrivateTimeline('stop_requested', {
      serviceId: this.serviceId,
      runId: this.instanceId,
      bufferedSamples: this.bufferedSampleCount,
      audioChunks: this.audioChunks.length,
      retrySamples: this.retryAudioBuffer?.length ?? 0,
      hasDetectedSpeech: this.hasDetectedSpeech,
      currentTranscriptLength: this.currentTranscript.length,
    });

    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    if (this.mic) {
      this.mic = null;
    }

    this.cleanupFrameListener();

    // Path C (UX honesty): the whole-utterance stop-commit re-decodes the full
    // utterance and can take several seconds on CPU. Surface the explicit
    // "processing speech" state IMMEDIATELY at Stop — BEFORE waiting for any
    // in-flight live decode to drain — so the user is not staring at stale/blank
    // text for the duration of that wait. Mark the engine stopping so in-flight
    // live emits are suppressed (see emitProvisionalPartial / live-final guard).
    // Only signal when there is actually audio to decode.
    this.isStopping = true;
    const hasUtteranceToFinalize =
      this.utteranceSampleCount >= MIN_TRANSCRIPTION_SAMPLES || this.audioChunks.length > 0;
    if (hasUtteranceToFinalize) {
      this.onStatusChange?.({
        type: 'info',
        message: 'Processing speech locally…',
        detail: 'Finalizing your private transcript on this device.',
      });
    }

    const waitStartedAt = performance.now();
    const wasProcessingAtStop = this.isProcessing;
    while (this.isProcessing && performance.now() - waitStartedAt < TRANSCRIPTION_TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const drainWaitMs = Number((performance.now() - waitStartedAt).toFixed(1));
    // Break down the Stop -> decode-start overhead so a proof can attribute it to
    // the in-flight-live-decode drain (single-threaded worker) vs cleanup, rather
    // than inferring it from raw timeline events.
    pushPrivateTimeline('stop_predecode_breakdown', {
      serviceId: this.serviceId,
      runId: this.instanceId,
      wasProcessingAtStop,
      drainWaitMs,
      sinceStopMs: this.stopRequestedAtMs == null
        ? null
        : Number((performance.now() - this.stopRequestedAtMs).toFixed(1)),
    });

    try {
      // PERF: the whole-utterance decode is the saved-transcript authority and
      // re-decodes the entire utterance. Run it FIRST. The old order ran a forced
      // rolling decode of the (usually blank/low-energy) tail first — a full extra
      // CPU inference of ~3-4s on the critical path whose result the whole-utterance
      // commit then overwrote. Now the forced tail decode runs only as a fallback
      // when the whole-utterance commit produced nothing, cutting post-Stop latency.
      pushPrivateTimeline('stop_whole_utterance_decode_start', {
        serviceId: this.serviceId,
        runId: this.instanceId,
        utteranceSamples: this.utteranceSampleCount,
      });
      const finalizeStartedAtMs = performance.now();
      // Branch 1 (drain + cleanup): Stop entry -> whole-utterance commit call.
      this.finalizeWaitMs = this.stopRequestedAtMs == null
        ? null
        : Number((finalizeStartedAtMs - this.stopRequestedAtMs).toFixed(1));
      this.publishPrivateTiming();
      // Branch 2 (finalizePrepMs) + branch 3 (finalizeDecodeMs) are set inside the commit.
      await this.commitWholeUtteranceTranscript();
      this.publishPrivateTiming();

      if (!this.wholeUtteranceTranscript.trim()) {
        pushPrivateTimeline('stop_force_tail_fallback', {
          serviceId: this.serviceId,
          runId: this.instanceId,
          reason: 'whole_utterance_commit_empty',
        });
        await this.processAudio({ force: true });
      } else {
        pushPrivateTimeline('stop_force_tail_skipped', {
          serviceId: this.serviceId,
          runId: this.instanceId,
          reason: 'whole_utterance_commit_succeeded',
        });
      }
    } finally {
      if (hasUtteranceToFinalize) {
        this.onStatusChange?.({ type: 'ready', message: 'Ready to record' });
      }
    }
    pushPrivateTimeline('stop_force_processing_complete', {
      serviceId: this.serviceId,
      runId: this.instanceId,
      currentTranscriptLength: this.currentTranscript.length,
      wholeUtteranceTranscriptLength: this.wholeUtteranceTranscript.length,
    });

    this.status = 'stopped';
  }

  public override async getTranscript(): Promise<string> {
    return this.wholeUtteranceTranscript.trim() || this.currentTranscript.trim();
  }

  protected async onDestroy(): Promise<void> {
    logger.info({ sId: this.serviceId, rId: this.instanceId }, '[PrivateWhisper] Terminating service...');
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    this.cleanupFrameListener();
    this.isProcessing = false;
    this.clearAudioBuffer();
    this.clearRetryAudioBuffer();
    this.clearSpeechStartState();

    // Strict cleanup of the underlying engine
    await this.privateSTT.destroy();
    if (typeof document !== 'undefined') {
      document.body.removeAttribute('data-engine-variant');
    }
    this.status = 'stopped';
  }

  async transcribe(audio: Float32Array): Promise<Result<string, Error>> {
    return this.privateSTT.transcribe(audio);
  }

  private cleanupFrameListener(): void {
    if (this.frameListenerDisposer) {
      this.frameListenerDisposer();
      this.frameListenerDisposer = null;
    }
  }

  private clearAudioBuffer(): void {
    this.audioChunks.length = 0;
    this.bufferedSampleCount = 0;
  }

  private clearRetryAudioBuffer(): void {
    this.retryAudioBuffer = null;
  }

  private capLiveDecodeWindow(audio: Float32Array): Float32Array {
    const hasCommittedTranscript = this.currentTranscript.trim().length > 0;
    const maxLiveSamples = hasCommittedTranscript
      ? LIVE_DECODE_WINDOW_SAMPLES
      : Math.max(
        LIVE_DECODE_WINDOW_SAMPLES,
        secondsToSamples(PRIV_STT.FIRST_TRANSCRIPT_MIN_DURATION_SECONDS, PRIVATE_STT_SAMPLE_RATE),
      );

    if (audio.length <= maxLiveSamples) return audio;

    const cappedAudio = audio.slice(audio.length - maxLiveSamples);
    pushPrivateTimeline('live_decode_window_capped', {
      serviceId: this.serviceId,
      runId: this.instanceId,
      inputSamples: audio.length,
      inputDurationSec: Number(samplesToSeconds(audio.length, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
      outputSamples: cappedAudio.length,
      outputDurationSec: Number(samplesToSeconds(cappedAudio.length, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
      windowSeconds: Number(samplesToSeconds(maxLiveSamples, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
      hasCommittedTranscript,
    });

    if (isPrivateTranscriptTraceEnabled()) {
      logger.info({
        sId: this.serviceId,
        rId: this.instanceId,
        inputSamples: audio.length,
        outputSamples: cappedAudio.length,
        outputDurationSec: Number(samplesToSeconds(cappedAudio.length, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
      }, '[PRIVATE_TRACE] live_decode_window_capped');
    }

    return cappedAudio;
  }

  private addPrerollFrame(frame: Float32Array): void {
    this.prerollAudioChunks.push(frame);
    this.prerollSampleCount += frame.length;

    while (this.prerollSampleCount > SPEECH_START_PREROLL_SAMPLES && this.prerollAudioChunks.length > 0) {
      const first = this.prerollAudioChunks[0];
      const overflow = this.prerollSampleCount - SPEECH_START_PREROLL_SAMPLES;

      if (first.length <= overflow) {
        this.prerollSampleCount -= first.length;
        this.prerollAudioChunks.shift();
      } else {
        this.prerollAudioChunks[0] = first.slice(overflow);
        this.prerollSampleCount -= overflow;
      }
    }
  }

  private resetSpeechGateStats(): void {
    this.speechGateStats = {
      framesSeen: 0,
      speechFramesSeen: 0,
      resetCount: 0,
      candidateResetCount: 0,
      maxRms: 0,
      maxPeak: 0,
      firstSpeechFrameAtMs: null,
      lastCandidateSamples: 0,
    };
  }

  private recordSpeechGateFrame(
    energy: ReturnType<typeof summarizeAudioEnergy>,
    isSpeechFrame: boolean,
  ): void {
    this.speechGateStats.framesSeen += 1;
    this.speechGateStats.maxRms = Math.max(this.speechGateStats.maxRms, energy.rms);
    this.speechGateStats.maxPeak = Math.max(this.speechGateStats.maxPeak, energy.peak);

    if (isSpeechFrame) {
      this.speechGateStats.speechFramesSeen += 1;
      this.speechGateStats.firstSpeechFrameAtMs ??= performance.now();
    }
  }

  private recordSpeechGateReset(): void {
    this.speechGateStats.resetCount += 1;
    if (this.consecutiveSpeechSamples > 0) {
      this.speechGateStats.candidateResetCount += 1;
      this.speechGateStats.lastCandidateSamples = this.consecutiveSpeechSamples;
      pushPrivateTimeline('speech_gate_candidate_reset', {
        serviceId: this.serviceId,
        runId: this.instanceId,
      candidateSamples: this.consecutiveSpeechSamples,
      candidateSeconds: Number(samplesToSeconds(this.consecutiveSpeechSamples, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
      toleratedQuietSamples: this.speechStartQuietSamples,
      toleratedQuietSeconds: Number(samplesToSeconds(this.speechStartQuietSamples, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
      speechStartMinSamples: SPEECH_START_MIN_SAMPLES,
      speechStartMinSeconds: Number(samplesToSeconds(SPEECH_START_MIN_SAMPLES, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
      resetToleranceSamples: SPEECH_START_RESET_TOLERANCE_SAMPLES,
      speechGateStats: this.getSpeechGateStatsSnapshot(),
    });
    }
  }

  private preserveSpeechStartCandidateAsPreroll(): void {
    if (this.speechStartAudioChunks.length === 0) return;

    let preservedSamples = 0;
    for (const chunk of this.speechStartAudioChunks) {
      const energy = summarizeAudioEnergy(chunk);
      if (energy.rms < this.currentThreshold) continue;

      this.addPrerollFrame(chunk.slice(0));
      preservedSamples += chunk.length;
    }

    if (preservedSamples > 0) {
      pushPrivateTimeline('speech_gate_candidate_preserved_as_preroll', {
        serviceId: this.serviceId,
        runId: this.instanceId,
        preservedSamples,
        preservedSeconds: Number(samplesToSeconds(preservedSamples, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
        prerollSamples: this.prerollSampleCount,
        prerollSeconds: Number(samplesToSeconds(this.prerollSampleCount, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
      });
    }
  }

  private getSpeechGateStatsSnapshot(): Record<string, unknown> {
    return {
      framesSeen: this.speechGateStats.framesSeen,
      speechFramesSeen: this.speechGateStats.speechFramesSeen,
      resetCount: this.speechGateStats.resetCount,
      candidateResetCount: this.speechGateStats.candidateResetCount,
      maxRms: Number(this.speechGateStats.maxRms.toFixed(6)),
      maxPeak: Number(this.speechGateStats.maxPeak.toFixed(6)),
      firstSpeechFrameAtMs: this.speechGateStats.firstSpeechFrameAtMs === null
        ? null
        : Number(this.speechGateStats.firstSpeechFrameAtMs.toFixed(3)),
      lastCandidateSamples: this.speechGateStats.lastCandidateSamples,
      threshold: PRIV_STT.SPEECH_START_RMS_THRESHOLD,
      resetToleranceSamples: SPEECH_START_RESET_TOLERANCE_SAMPLES,
      resetToleranceSeconds: Number(samplesToSeconds(SPEECH_START_RESET_TOLERANCE_SAMPLES, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
    };
  }

  private clearSpeechStartState(): void {
    this.prerollAudioChunks = [];
    this.prerollSampleCount = 0;
    this.speechStartAudioChunks = [];
    this.consecutiveSpeechSamples = 0;
    this.speechStartQuietSamples = 0;
    this.hasDetectedSpeech = false;
    this.resetSpeechGateStats();
  }

  private appendUtteranceAudio(chunks: Float32Array[]): void {
    for (const chunk of chunks) {
      if (chunk.length === 0) continue;
      this.utteranceAudioChunks.push(chunk.slice(0));
      this.utteranceSampleCount += chunk.length;
    }
  }

  private appendFrameToUtteranceAudio(
    frame: Float32Array,
    energy: ReturnType<typeof summarizeAudioEnergy>,
  ): void {
    // Fix A (final-buffer bound): "real speech" for the purpose of resetting the
    // trailing-tail counter uses the app's existing partial-speech bar
    // (FIRST_TRANSCRIPT_PARTIAL_MIN_RMS), NOT the silence floor. The old code reset
    // on anything >= SILENCE_RMS_THRESHOLD (0.01), so low-energy post-speech
    // "chatter" (e.g. rms 0.02-0.09) kept resetting the cap and the whole-utterance
    // buffer grew unbounded (h1_6: committed 10.75s for ~7s of speech, degrading the
    // final decode). This bar is an existing product threshold, not an h1_6-tuned
    // value. Frames below it still get the bounded tail allowance so genuinely quiet
    // endings are preserved up to UTTERANCE_SILENCE_TAIL_SAMPLES.
    const isRealSpeech = energy.rms >= PRIV_STT.FIRST_TRANSCRIPT_PARTIAL_MIN_RMS;
    if (isRealSpeech) {
      this.utteranceTrailingSilentSamples = 0;
      this.appendUtteranceAudio([frame]);
      return;
    }

    this.utteranceTrailingSilentSamples += frame.length;
    if (this.utteranceTrailingSilentSamples <= UTTERANCE_SILENCE_TAIL_SAMPLES) {
      this.appendUtteranceAudio([frame]);
      return;
    }

    if (this.utteranceTrailingSilentSamples === UTTERANCE_SILENCE_TAIL_SAMPLES + frame.length) {
      pushPrivateTimeline('whole_utterance_silence_tail_capped', {
        serviceId: this.serviceId,
        runId: this.instanceId,
        retainedTailSamples: UTTERANCE_SILENCE_TAIL_SAMPLES,
        retainedTailSeconds: PRIV_STT.UTTERANCE_SILENCE_TAIL_SECONDS,
        tailResetThresholdRms: PRIV_STT.FIRST_TRANSCRIPT_PARTIAL_MIN_RMS,
        currentUtteranceSamples: this.utteranceSampleCount,
        currentUtteranceSeconds: Number(samplesToSeconds(this.utteranceSampleCount, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
      });
    }
  }

  private async commitWholeUtteranceTranscript(): Promise<void> {
    const commitEnteredAtMs = performance.now();
    if (this.utteranceAudioChunks.length === 0 || this.utteranceSampleCount < MIN_TRANSCRIPTION_SAMPLES) {
      pushPrivateTimeline('whole_utterance_commit_skip', {
        serviceId: this.serviceId,
        runId: this.instanceId,
        reason: 'insufficient_audio',
        samples: this.utteranceSampleCount,
      });
      return;
    }

    const audio = concatenateFloat32Arrays(this.utteranceAudioChunks);
    const energy = summarizeAudioEnergy(audio);
    const speechStartOffsetMs = this.streamStartAtMs == null || this.speechStartAtMs == null
      ? null
      : Number((this.speechStartAtMs - this.streamStartAtMs).toFixed(1));
    pushPrivateTimeline('whole_utterance_commit_start', {
      serviceId: this.serviceId,
      runId: this.instanceId,
      samples: audio.length,
      durationSec: Number(samplesToSeconds(audio.length, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
      rms: Number(energy.rms.toFixed(6)),
      peak: Number(energy.peak.toFixed(6)),
      // Final-decode timing diagnostics (explains why final lands well after Stop).
      decodeInputDurationMs: Number((samplesToSeconds(audio.length, PRIVATE_STT_SAMPLE_RATE) * 1000).toFixed(1)),
      speechStartOffsetMs,
      retainedPrerollSamples: this.retainedUtterancePrerollSamplesAtStart,
      currentPreview: redactTranscript(this.currentTranscript),
    });

    const capturedAudioIndex = capturePrivateUtteranceAudio(audio, {
      speechStartOffsetMs,
      retainedPrerollSamples: this.retainedUtterancePrerollSamplesAtStart,
    });
    const decodeStartedAtMs = performance.now();
    // Branch 2: finalize preprocessing (concat + energy + audio capture) before the model call.
    this.finalizePrepMs = Number((decodeStartedAtMs - commitEnteredAtMs).toFixed(1));
    this.publishPrivateTiming();
    const result = await this.privateSTT.transcribe(audio);
    const decodeMs = Number((performance.now() - decodeStartedAtMs).toFixed(1));
    // Branch 3: the model decode itself.
    this.finalizeDecodeMs = decodeMs;
    this.publishPrivateTiming();
    const rawText = result.isOk ? result.data : '';
    if (capturedAudioIndex !== null) {
      const captured = window.__PRIVATE_UTTERANCE_AUDIO_CHUNKS__?.[capturedAudioIndex];
      if (captured) {
        captured.decodeMs = decodeMs;
        if (result.isOk) captured.transcript = rawText;
        else captured.error = result.error?.message;
      }
    }

    if (!result.isOk) {
      pushPrivateTimeline('whole_utterance_commit_error', {
        serviceId: this.serviceId,
        runId: this.instanceId,
        error: result.error?.message,
      });
      return;
    }

    const transcript = sanitizePrivateTranscriptCandidate(rawText);
    if (!transcript || isPurePrivateHallucinationTranscript(transcript)) {
      pushPrivateTimeline('whole_utterance_commit_reject', {
        serviceId: this.serviceId,
        runId: this.instanceId,
        reason: !transcript ? 'empty' : 'pure_hallucination',
        rawPreview: redactTranscript(rawText),
        preview: redactTranscript(transcript),
        currentPreview: redactTranscript(this.currentTranscript),
      });
      return;
    }

    this.markFirstFinal();
    const replacedRollingTranscript = this.currentTranscript;
    this.wholeUtteranceTranscript = transcript;
    this.currentTranscript = transcript;
    pushPrivateTimeline('whole_utterance_commit_accept', {
      serviceId: this.serviceId,
      runId: this.instanceId,
      textLength: transcript.length,
      rawPreview: redactTranscript(rawText),
      preview: redactTranscript(transcript),
      replacedRollingPreview: redactTranscript(replacedRollingTranscript),
      // Final-decode wall-clock: time the model spent on the whole-utterance buffer.
      decodeMs,
    });

    this.onTranscriptUpdate?.({ transcript: { final: transcript } });
  }

  private retainAudioForRetry(audio: Float32Array): void {
    if (audio.length === 0) {
      this.clearRetryAudioBuffer();
      return;
    }

    const start = Math.max(0, audio.length - MAX_RETRY_SAMPLES);
    this.retryAudioBuffer = audio.slice(start);
    pushPrivateTimeline('retain_audio_for_retry', {
      serviceId: this.serviceId,
      runId: this.instanceId,
      inputSamples: audio.length,
      retainedSamples: this.retryAudioBuffer.length,
      retainedDurationSec: Number(samplesToSeconds(this.retryAudioBuffer.length, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
    });

    if (isPrivateTranscriptTraceEnabled()) {
      logger.info({
        sId: this.serviceId,
        rId: this.instanceId,
        samples: this.retryAudioBuffer.length,
        durationSec: Number(samplesToSeconds(this.retryAudioBuffer.length, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
      }, '[PRIVATE_TRACE] retained_empty_result_audio');
    }
  }

  private retainSpeechLikeAudioForRetry(
    audio: Float32Array,
    energy: { rms: number; peak: number },
    reason: string,
  ): void {
    const minRetryRms = getRetryRetentionMinRms();
    if (energy.rms < minRetryRms) {
      pushPrivateTimeline('retry_audio_low_rms_drop', {
        serviceId: this.serviceId,
        runId: this.instanceId,
        reason,
        samples: audio.length,
        durationSec: Number(samplesToSeconds(audio.length, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
        rms: Number(energy.rms.toFixed(6)),
        peak: Number(energy.peak.toFixed(6)),
        minRms: minRetryRms,
        droppedRetrySamples: this.retryAudioBuffer?.length ?? 0,
      });
      this.clearRetryAudioBuffer();
      return;
    }

    this.retainAudioForRetry(audio);
  }
}
