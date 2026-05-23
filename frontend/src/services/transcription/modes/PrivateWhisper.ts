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

const PRIVATE_STT_SAMPLE_RATE = 16_000;
const MIN_TRANSCRIPTION_SECONDS = 8;
const MIN_TRANSCRIPTION_SAMPLES = PRIVATE_STT_SAMPLE_RATE * MIN_TRANSCRIPTION_SECONDS;
const MAX_RETRY_SECONDS = 12;
const MAX_RETRY_SAMPLES = PRIVATE_STT_SAMPLE_RATE * MAX_RETRY_SECONDS;
const PROCESSING_INTERVAL_MS = 250;

const isPrivateTranscriptTraceEnabled = () =>
  typeof window !== 'undefined' && Boolean(window.__PRIVATE_TRANSCRIPT_TRACE__);

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
    durationSec: audio.length / PRIVATE_STT_SAMPLE_RATE,
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
  private retryAudioBuffer: Float32Array | null = null;
  private isProcessing: boolean = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private pauseDetector: PauseDetector;

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
    this.currentTranscript = '';
    this.updateHeartbeat();

    // Subscribe to microphone frames
    this.cleanupFrameListener(); // CRITICAL: Clean up previous listener before adding new one

    const listener = (frame: Float32Array) => {
      // Copy the frame to avoid buffer detachment issues
      const clonedFrame = frame.slice(0);
      this.audioChunks.push(clonedFrame);
      this.bufferedSampleCount += clonedFrame.length;

      // Track silence per-frame for accurate pause metrics (analytics only)
      this.pauseDetector.processAudioFrame(clonedFrame);

      if (isPrivateTranscriptTraceEnabled()) {
        logger.info({
          sId: this.serviceId,
          rId: this.instanceId,
          frameSamples: clonedFrame.length,
          bufferedChunks: this.audioChunks.length,
          bufferedSamples: this.bufferedSampleCount,
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
    if (!force && this.bufferedSampleCount < MIN_TRANSCRIPTION_SAMPLES) {
      return; // Avoid repeated concatenation copies until there is enough audio.
    }

    this.isProcessing = true;
    const tStart = performance.now();

    try {
      // Concatenate all chunks using shared utility
      const liveAudio = concatenateFloat32Arrays(this.audioChunks);
      const concatenated = this.retryAudioBuffer
        ? concatenateFloat32Arrays([this.retryAudioBuffer, liveAudio])
        : liveAudio;
      if (isPrivateTranscriptTraceEnabled()) {
        const energy = summarizeAudioEnergy(concatenated);
        logger.info({
          sId: this.serviceId,
          rId: this.instanceId,
          force,
          chunks: this.audioChunks.length,
          liveSamples: liveAudio.length,
          retrySamples: this.retryAudioBuffer?.length ?? 0,
          samples: concatenated.length,
          durationSec: Number((concatenated.length / PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
          rms: Number(energy.rms.toFixed(6)),
          peak: Number(energy.peak.toFixed(6)),
        }, '[PRIVATE_TRACE] processor_output');
      }

      if (!force && concatenated.length < MIN_TRANSCRIPTION_SAMPLES) {
        this.bufferedSampleCount = concatenated.length;
        return;
      }

      // PauseDetector now runs per-frame in the listener (for analytics metrics).
      // Whisper handles silence natively — empty results are caught by the
      // `if (newText.trim())` guard below, so we never discard audio here.

      if (this.currentTranscript.length === 0) {
        const expectedDurationSec = concatenated.length / 16000;
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
        return;
      }
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
      if (capturedAudioIndex !== null) {
        const captured = window.__PRIVATE_INFERENCE_AUDIO_CHUNKS__?.[capturedAudioIndex];
        if (captured) captured.transcript = newText;
      }

      if (newText.trim()) {
        this.clearRetryAudioBuffer();
        logger.info({ sId: this.serviceId, rId: this.instanceId, newText, latencyMs: (performance.now() - tStart).toFixed(2) }, '[PrivateWhisper] ✨ Transcription success');
        this.currentTranscript = this.currentTranscript ? `${this.currentTranscript} ${newText}` : newText;
        if (this.onTranscriptUpdate) {
          if (isPrivateTranscriptTraceEnabled()) {
            logger.info({
              sId: this.serviceId,
              rId: this.instanceId,
              textLength: newText.length,
            }, '[PRIVATE_TRACE] transcript_callback_emit');
          }
          this.onTranscriptUpdate({ transcript: { final: newText } });
        }
      } else {
        this.retainAudioForRetry(processedAudio);
      }

    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error({ sId: this.serviceId, rId: this.instanceId, err: error }, '[PrivateWhisper] Transcription processing failed.');
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

  private retainAudioForRetry(audio: Float32Array): void {
    if (audio.length === 0) {
      this.clearRetryAudioBuffer();
      return;
    }

    const start = Math.max(0, audio.length - MAX_RETRY_SAMPLES);
    this.retryAudioBuffer = audio.slice(start);

    if (isPrivateTranscriptTraceEnabled()) {
      logger.info({
        sId: this.serviceId,
        rId: this.instanceId,
        samples: this.retryAudioBuffer.length,
        durationSec: Number((this.retryAudioBuffer.length / PRIVATE_STT_SAMPLE_RATE).toFixed(3)),
      }, '[PRIVATE_TRACE] retained_empty_result_audio');
    }
  }
}
