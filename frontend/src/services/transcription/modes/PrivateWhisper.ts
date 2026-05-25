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
import { createPrivateSTT, EngineType } from '../engines';
import { IPrivateSTT } from '../../../contracts/IPrivateSTT';
import { ITranscriptionEngine, TranscriptionModeOptions, Result } from './types';
import { TranscriptionError } from '../errors';

import { MicStream } from '../utils/types';
import { concatenateFloat32Arrays } from '../utils/AudioProcessor';
import { TranscriptUpdate } from '../../../types/transcription';
import { ENV } from '../../../config/TestFlags';
import { PauseDetector } from '../../audio/pauseDetector';
import { PRIV_CLOUD_AUDIO, PRIV_STT, PRIV_STT_DERIVED, SESSION_PAUSE, samplesToSeconds } from '../sttConstants';

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
    __PRIVATE_STT_TIMELINE__?: PrivateSttTimelineEvent[];
  }
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
const MAX_RETRY_SAMPLES = PRIV_STT_DERIVED.MAX_RETRY_SAMPLES;
const PROCESSING_INTERVAL_MS = PRIV_STT.PROCESSING_INTERVAL_MS;
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

function canEmitFirstPartial(text: string, energy: { rms: number }): boolean {
  return (
    getTranscriptWords(text).length >= 2 &&
    energy.rms >= PRIV_STT.FIRST_TRANSCRIPT_PARTIAL_MIN_RMS &&
    !isKnownHallucinationTranscript(text)
  );
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
  private processingInterval: NodeJS.Timeout | null = null;
  private pauseDetector: PauseDetector;
  private lastTranscriptEmitAtMs: number = 0;
  private preTranscriptMetadataRetryCount: number = 0;
  private pendingFirstTranscript: string | null = null;
  private firstTranscriptAgreementRounds: number = 0;
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

  constructor(options: TranscriptionModeOptions, privateSTT?: IPrivateSTT) {
    super(options);
    this.onTranscriptUpdate = options.onTranscriptUpdate;
    this.onModelLoadProgress = options.onModelLoadProgress;
    this.onReady = options.onReady;
    this.onAudioData = options.onAudioData;

    // Set base properties manually for immediate construction logging
    // init() will override these based on callbacks, but constructor runs first
    this.serviceId = options.serviceId || 'unknown';
    this.runId = options.runId || 'unknown';

    this.status = 'uninitialized';
    this.currentTranscript = '';
    this.privateSTT = (privateSTT as IPrivateSTT) || (createPrivateSTT() as IPrivateSTT);
    this.pauseDetector = new PauseDetector();
    this.lastHeartbeat = Date.now();

    // Check for E2E environment and expose instance for verification
    if (ENV.isE2E) {
      logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[PrivateWhisper] 🧪 Exposing instance for E2E testing');
      window.__PrivateWhisper_INT_TEST__ = this;
    }

    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[PrivateWhisper] Initialized (dual-engine facade).');
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
    this.lastTranscriptEmitAtMs = 0;
    this.preTranscriptMetadataRetryCount = 0;
    this.pendingFirstTranscript = null;
    this.firstTranscriptAgreementRounds = 0;
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
          const speechStartBufferedSamples = this.speechStartAudioChunks.reduce(
            (sum, chunk) => sum + chunk.length,
            0,
          );
          this.audioChunks = [
            ...this.prerollAudioChunks.map((chunk) => chunk.slice(0)),
            ...this.speechStartAudioChunks.map((chunk) => chunk.slice(0)),
          ];
          this.bufferedSampleCount = this.prerollSampleCount + speechStartBufferedSamples;
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
      if (!force && (isBufferSilent || isLowEnergyPauseTail || isPostTranscriptLowEnergy) && !isFirstChunk) {
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

      if (this.currentTranscript.length === 0) {
        const expectedDurationSec = samplesToSeconds(concatenated.length, PRIVATE_STT_SAMPLE_RATE);
        logger.info({ sId: this.serviceId, rId: this.instanceId, samples: concatenated.length, expectedDurationSec }, '[PrivateWhisper] 🎤 Processing chunk');
      }

      const processedAudio = concatenated;

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
        preview: result.isOk ? (result.data || '').slice(0, 160) : '',
        error: result.isOk ? null : result.error?.message,
      });
      if (isPrivateTranscriptTraceEnabled()) {
        logger.info({
          sId: this.serviceId,
          rId: this.instanceId,
          ok: result.isOk,
          textLength: result.isOk ? (result.data || '').length : 0,
          trimLength: result.isOk ? (result.data || '').trim().length : 0,
          preview: result.isOk ? (result.data || '').slice(0, 120) : '',
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
            preview: newText.slice(0, 160),
          });
          logger.info({
            sId: this.serviceId,
            rId: this.instanceId,
            preview: newText.slice(0, 120),
          }, '[PrivateWhisper] Dropping post-transcript metadata chunk as tail noise');
          return;
        }

        this.preTranscriptMetadataRetryCount += 1;
        pushPrivateTimeline('metadata_pre_transcript_retain', {
          serviceId: this.serviceId,
          runId: this.instanceId,
          preview: newText.slice(0, 160),
          metadataRetryCount: this.preTranscriptMetadataRetryCount,
          metadataRetryLimit: PRIV_STT.PRE_TRANSCRIPT_METADATA_RETRY_LIMIT,
        });

        if (this.preTranscriptMetadataRetryCount > PRIV_STT.PRE_TRANSCRIPT_METADATA_RETRY_LIMIT) {
          pushPrivateTimeline('metadata_pre_transcript_retry_limit_drop', {
            serviceId: this.serviceId,
            runId: this.instanceId,
            preview: newText.slice(0, 160),
            metadataRetryCount: this.preTranscriptMetadataRetryCount,
            metadataRetryLimit: PRIV_STT.PRE_TRANSCRIPT_METADATA_RETRY_LIMIT,
            droppedRetrySamples: this.retryAudioBuffer?.length ?? 0,
          });
          logger.info({
            sId: this.serviceId,
            rId: this.instanceId,
            preview: newText.slice(0, 120),
            retryCount: this.preTranscriptMetadataRetryCount,
          }, '[PrivateWhisper] Dropping repeated pre-transcript metadata context');
          this.clearRetryAudioBuffer();
          this.preTranscriptMetadataRetryCount = 0;
          return;
        }

        logger.info({
          sId: this.serviceId,
          rId: this.instanceId,
          preview: newText.slice(0, 120),
          retryCount: this.preTranscriptMetadataRetryCount,
        }, '[PrivateWhisper] Retaining non-speech metadata chunk for retry context');
        this.retainSpeechLikeAudioForRetry(processedAudio, energy, 'metadata_pre_transcript');
        return;
      }

      if (!this.currentTranscript.trim() && isKnownHallucinationTranscript(newText)) {
        pushPrivateTimeline('first_transcript_hallucination_retain', {
          serviceId: this.serviceId,
          runId: this.instanceId,
          preview: newText.slice(0, 160),
          samples: processedAudio.length,
          durationSec: Number(samplesToSeconds(processedAudio.length, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
          rms: Number(energy.rms.toFixed(6)),
          peak: Number(energy.peak.toFixed(6)),
        });
        logger.info({
          sId: this.serviceId,
          rId: this.instanceId,
          preview: newText.slice(0, 120),
        }, '[PrivateWhisper] Holding known Whisper hallucination pattern before first transcript');
        this.retainSpeechLikeAudioForRetry(processedAudio, energy, 'known_hallucination_first_transcript');
        return;
      }

      if (!this.currentTranscript.trim() && newText.trim()) {
        const processedDurationSec = samplesToSeconds(processedAudio.length, PRIVATE_STT_SAMPLE_RATE);
        const canEmitPartial = canEmitFirstPartial(newText, energy);
        const canPromoteToFinal = hasFirstTranscriptEmissionSubstance(newText, energy, processedDurationSec);

        if (!canPromoteToFinal) {
          pushPrivateTimeline('first_transcript_substance_retain', {
            serviceId: this.serviceId,
            runId: this.instanceId,
            preview: newText.slice(0, 160),
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
            preview: newText.slice(0, 120),
            wordCount: getTranscriptWords(newText).length,
            rms: Number(energy.rms.toFixed(6)),
            durationSec: Number(processedDurationSec.toFixed(3)),
          }, '[PrivateWhisper] Holding first transcript until it has speech-like substance');
          if (canEmitPartial && this.onTranscriptUpdate) {
            pushPrivateTimeline('first_transcript_provisional_partial_emit', {
              serviceId: this.serviceId,
              runId: this.instanceId,
              textLength: newText.trim().length,
              preview: newText.trim().slice(0, 160),
              reason: 'pre_final_threshold',
            });
            this.onTranscriptUpdate({ transcript: { partial: newText.trim() } });
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
            preview: newText.slice(0, 160),
            previousPreview: previousCandidate?.slice(0, 160) ?? null,
            stablePrefix: stablePrefix.slice(0, 160),
            agreementRounds: this.firstTranscriptAgreementRounds,
            requiredAgreementRounds: PRIV_STT.FIRST_TRANSCRIPT_LOCAL_AGREEMENT_ROUNDS,
            samples: processedAudio.length,
            durationSec: Number(samplesToSeconds(processedAudio.length, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
          });
          logger.info({
            sId: this.serviceId,
            rId: this.instanceId,
            preview: newText.slice(0, 120),
            previousPreview: previousCandidate?.slice(0, 120) ?? null,
            stablePrefix: stablePrefix.slice(0, 120),
          }, '[PrivateWhisper] Holding first transcript until local agreement confirms it');
          if (this.onTranscriptUpdate) {
            pushPrivateTimeline('first_transcript_provisional_partial_emit', {
              serviceId: this.serviceId,
              runId: this.instanceId,
              textLength: newText.trim().length,
              preview: newText.trim().slice(0, 160),
            });
            this.onTranscriptUpdate({ transcript: { partial: newText.trim() } });
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
              preview: newText.slice(0, 160),
              stablePrefix: stablePrefix.slice(0, 160),
              stablePrefixWordCount,
              minWords: PRIV_STT.FIRST_TRANSCRIPT_MIN_WORDS,
              agreementRounds: this.firstTranscriptAgreementRounds,
            });
            logger.info({
              sId: this.serviceId,
              rId: this.instanceId,
              stablePrefix: stablePrefix.slice(0, 120),
              stablePrefixWordCount,
              minWords: PRIV_STT.FIRST_TRANSCRIPT_MIN_WORDS,
            }, '[PrivateWhisper] Holding first transcript because stable prefix is too short');
            if (this.onTranscriptUpdate) {
              pushPrivateTimeline('first_transcript_provisional_partial_emit', {
                serviceId: this.serviceId,
                runId: this.instanceId,
                textLength: newText.trim().length,
                preview: newText.trim().slice(0, 160),
                reason: 'stable_prefix_too_short',
              });
              this.onTranscriptUpdate({ transcript: { partial: newText.trim() } });
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
            preview: newText.slice(0, 160),
            stablePrefix: stablePrefix.slice(0, 160),
            agreementRounds: this.firstTranscriptAgreementRounds,
          });
          logger.info({
            sId: this.serviceId,
            rId: this.instanceId,
            stablePrefix: stablePrefix.slice(0, 120),
          }, '[PrivateWhisper] Emitting locally agreed first transcript prefix');
        }
      }

      if (force && this.currentTranscript.trim() && isTinyForcedTailTranscript(newText)) {
        this.clearRetryAudioBuffer();
        this.clearSpeechStartState();
        pushPrivateTimeline('tiny_force_tail_drop', {
          serviceId: this.serviceId,
          runId: this.instanceId,
          preview: newText.slice(0, 160),
        });
        logger.info({
          sId: this.serviceId,
          rId: this.instanceId,
          preview: newText.slice(0, 120),
        }, '[PrivateWhisper] Dropping tiny forced final tail fragment');
        return;
      }

      if (!force && this.currentTranscript.trim() && isTinyTranscriptFragment(newText)) {
        pushPrivateTimeline('tiny_post_transcript_fragment_drop', {
          serviceId: this.serviceId,
          runId: this.instanceId,
          preview: newText.slice(0, 160),
        });
        logger.info({
          sId: this.serviceId,
          rId: this.instanceId,
          preview: newText.slice(0, 120),
        }, '[PrivateWhisper] Dropping tiny post-transcript fragment');
        return;
      }

      if (textToEmit.trim()) {
        this.clearRetryAudioBuffer();
        this.preTranscriptMetadataRetryCount = 0;
        this.pendingFirstTranscript = null;
        this.firstTranscriptAgreementRounds = 0;
        logger.info({ sId: this.serviceId, rId: this.instanceId, newText: textToEmit, latencyMs: (performance.now() - tStart).toFixed(2) }, '[PrivateWhisper] ✨ Transcription success');
        this.currentTranscript = this.currentTranscript ? `${this.currentTranscript} ${textToEmit}` : textToEmit;
        if (this.onTranscriptUpdate) {
          pushPrivateTimeline('transcript_callback_emit', {
            serviceId: this.serviceId,
            runId: this.instanceId,
            textLength: textToEmit.length,
            preview: textToEmit.slice(0, 160),
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

    // Process any remaining audio
    await this.processAudio({ force: true });
    pushPrivateTimeline('stop_force_processing_complete', {
      serviceId: this.serviceId,
      runId: this.instanceId,
      currentTranscriptLength: this.currentTranscript.length,
    });

    this.status = 'stopped';
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
    if (energy.rms < PRIV_STT.FIRST_TRANSCRIPT_PARTIAL_MIN_RMS) {
      pushPrivateTimeline('retry_audio_low_rms_drop', {
        serviceId: this.serviceId,
        runId: this.instanceId,
        reason,
        samples: audio.length,
        durationSec: Number(samplesToSeconds(audio.length, PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
        rms: Number(energy.rms.toFixed(6)),
        peak: Number(energy.peak.toFixed(6)),
        minRms: PRIV_STT.FIRST_TRANSCRIPT_PARTIAL_MIN_RMS,
        droppedRetrySamples: this.retryAudioBuffer?.length ?? 0,
      });
      this.clearRetryAudioBuffer();
      return;
    }

    this.retainAudioForRetry(audio);
  }
}
