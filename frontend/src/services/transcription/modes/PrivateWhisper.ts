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
import { IPrivateSTT } from '../engines/IPrivateSTT';
import { ITranscriptionEngine, TranscriptionModeOptions } from './types';
import { MicStream } from '../utils/types';
import { concatenateFloat32Arrays } from '../utils/AudioProcessor';
import { TranscriptUpdate } from '@/types/transcription';
import { IS_TEST_ENVIRONMENT } from '../../../config/env';
import { PauseDetector } from '../../audio/pauseDetector';

// Extend Window interface for E2E test flags
declare global {
  interface Window {
    __E2E_CONTEXT__?: boolean;
    __E2E_MOCK_SESSION__?: boolean;
    __e2eBridgeReady__?: boolean;
    __e2eProfileLoaded__?: boolean;
    TEST_MODE?: boolean;
    __E2E_PLAYWRIGHT__?: boolean;
    __PrivateWhisper_INT_TEST__?: PrivateWhisper;
    __e2e_stt_engine_ready_fired__?: boolean;
  }
}
// Toast removed from here to centralized UI layer
// import { toast } from '@/lib/toast';

type Status = 'uninitialized' | 'idle' | 'loading' | 'transcribing' | 'stopped' | 'error';

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

export default class PrivateWhisper implements ITranscriptionEngine {
  private frameListenerDisposer: (() => void) | null = null;
  private onTranscriptUpdate: (update: TranscriptUpdate) => void;
  private onModelLoadProgress?: (progress: number | null) => void;
  private onReady?: () => void;
  private onAudioData?: (data: Float32Array) => void;
  private status: Status;
  private transcript: string;
  private privateSTT: IPrivateSTT;
  private serviceId: string;
  private runId: string;
  private engineType: EngineType | null = null;
  private mic: MicStream | null = null;
  private audioChunks: Float32Array[] = [];
  private isProcessing: boolean = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private pauseDetector: PauseDetector;

  constructor(options: TranscriptionModeOptions, privateSTT?: IPrivateSTT) {
    this.onTranscriptUpdate = options.onTranscriptUpdate;
    this.onModelLoadProgress = options.onModelLoadProgress;
    this.onReady = options.onReady;
    this.onAudioData = options.onAudioData;
    this.serviceId = options.serviceId || 'unknown';
    this.runId = options.instanceId || 'unknown'; // TranscriptionService sets instanceId = runId
    this.status = 'uninitialized';
    this.transcript = '';
    this.privateSTT = privateSTT || createPrivateSTT();
    this.pauseDetector = new PauseDetector();

    // Check for test environment and expose instance for E2E verification
    if (IS_TEST_ENVIRONMENT) {
      logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateWhisper] 🧪 Exposing instance for E2E testing');
      window.__PrivateWhisper_INT_TEST__ = this;
    }

    logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateWhisper] Initialized (dual-engine facade).');
  }

  public async init(): Promise<void> {
    if (this.status === 'idle' || this.status === 'transcribing') {
      logger.info({ sId: this.serviceId, rId: this.runId }, `[PrivateWhisper] Already ${this.status}, skipping init.`);
      return;
    }
    logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateWhisper] 🔄 init() START - Dual-Engine Mode');
    this.status = 'loading';

    try {
      // Trigger initial progress
      if (this.onModelLoadProgress) {
        this.onModelLoadProgress(0);
      }

      // Initialize the PrivateSTT facade (auto-selects best engine)
      const initPromise = this.privateSTT.init({
        serviceId: this.serviceId,
        runId: this.runId,
        onModelLoadProgress: (progress) => {
          logger.info({ sId: this.serviceId, rId: this.runId, progress }, '[PrivateWhisper] 📊 Progress');
          if (this.onModelLoadProgress) {
            this.onModelLoadProgress(progress);
          }
        },
        onReady: () => {
          logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateWhisper] Engine ready callback triggered.');
        }
      });

      const result = await initPromise;

      if (result.isErr) {
        throw result.error;
      }

      this.engineType = result.value;
      this.status = 'idle';
      logger.info({ sId: this.serviceId, rId: this.runId, engineType: this.engineType }, '[PrivateWhisper] ✅ Engine initialized');

      // ✅ EXPLICIT READINESS SIGNAL FOR TESTS (Engine Variant)
      if (typeof document !== 'undefined') {
        document.body.setAttribute('data-engine-variant', this.engineType);
      }

      // Show toast notification with engine type
      // REMOVED: Internal toast suppressed to prevent duplication with UI layer (Architectural Decision)
      logger.info({ sId: this.serviceId, rId: this.runId }, `[PrivateWhisper] Model ready! Using ${this.engineType === 'whisper-turbo' ? 'GPU acceleration' : 'CPU mode'}.`);

      // ✅ EXPLICIT READINESS SIGNAL FOR TESTS
      if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.__e2e_stt_engine_ready_fired__ = true;
        window.dispatchEvent(new CustomEvent('stt-engine-ready'));
      }

      // Notify that the service is ready
      if (this.onReady) {
        this.onReady();
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error({ sId: this.serviceId, rId: this.runId, err: error }, '[PrivateWhisper] ❌ Init failed');
      this.status = 'error';

      throw error;
    }
  }

  public async startTranscription(mic: MicStream): Promise<void> {
    if (!mic) {
      logger.error('[PrivateWhisper CRITICAL] startTranscription called with null/undefined mic!');
      throw new Error('MicStream is required for PrivateWhisper');
    }
    if (typeof mic.onFrame !== 'function') {
      logger.error({ sId: this.serviceId, rId: this.runId }, '[PrivateWhisper CRITICAL] MicStream missing onFrame method!');
      throw new Error('Invalid MicStream: missing onFrame method');
    }
    this.mic = mic;
    logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateWhisper] startTranscription() called.');
    if (this.status !== 'idle') {
      logger.warn({ sId: this.serviceId, rId: this.runId, status: this.status }, `[PrivateWhisper] Unexpected status: ${this.status}, expected 'idle'`);
    }
    this.status = 'transcribing';
    this.audioChunks = [];
    this.transcript = '';

    // Subscribe to microphone frames
    this.cleanupFrameListener(); // CRITICAL: Clean up previous listener before adding new one

    const listener = (frame: Float32Array) => {
      // Copy the frame to avoid buffer detachment issues
      const clonedFrame = frame.slice(0);
      this.audioChunks.push(clonedFrame);

      // Pass raw audio to analysis hooks (Pause Detection)
      if (this.onAudioData) {
        this.onAudioData(clonedFrame);
      }
    };

    // Store the disposer returned by onFrame
    this.frameListenerDisposer = mic.onFrame(listener);

    // Start processing loop (every 500ms) for more responsive UI
    this.processingInterval = setInterval(() => {
      this.processAudio();
    }, 500);

    logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateWhisper] Streaming started.');
  }

  private async processAudio(): Promise<void> {
    if (this.isProcessing) {
      return; // Already processing, skip
    }
    if (this.audioChunks.length === 0) {
      return; // No audio to process
    }

    this.isProcessing = true;
    const tStart = performance.now();

    try {
      // Concatenate all chunks using shared utility
      const concatenated = concatenateFloat32Arrays(this.audioChunks);

      // Feed frame to PauseDetector for metrics and state
      this.pauseDetector.processAudioFrame(concatenated);

      // SNR-aware VAD: Only transcribe if NOT meaningfully silent (respects micro-pauses)
      const isSilent = this.pauseDetector.isMeaningfullySilent();

      if (isSilent) {
        if (concatenated.length > 500 && Math.random() > 0.9) {
          logger.debug({
            sId: this.serviceId,
            rId: this.runId,
            silenceDuration: this.pauseDetector.getCurrentSilenceDurationSeconds(),
            samples: concatenated.length
          }, '[PrivateWhisper] 🤫 Meaningful silence detected - skipping chunk');
        }
        this.audioChunks = []; // Clear buffer to prevent backlog
        return;
      }

      logger.info({ sId: this.serviceId, rId: this.runId, samples: concatenated.length }, '[PrivateWhisper] 🔊 Speech detected');

      // CRITICAL FIX: The MicStream ALREADY downsamples to 16kHz (confirmed in audioUtils.impl.ts).
      // Double downsampling (16k -> 16k) is harmless, but if we guessed 44k -> 16k on 16k input, we'd decimate it.
      // So detailed logging is better than blind downsampling here.

      // Log first successful processing to prove data flow
      if (this.transcript.length === 0) {
        // Calculate estimated duration based on 16kHz
        const expectedDurationSec = concatenated.length / 16000;
        logger.info({ sId: this.serviceId, rId: this.runId, samples: concatenated.length, expectedDurationSec }, '[PrivateWhisper] 🎤 Processing chunk');

        // If the duration is wildly different from wall clock, we have a sample rate issue
        // (This is just a heuristic for logs, not control logic)
      }

      // CRITICAL: Ensure we are not double-downsampling if the mic is already 16k
      // MicStream reports 16000, so we trust it. 
      // If the audio is weird, we need to inspect the worklet.
      // For now, pass concatenated directly but keep the check

      const processedAudio = concatenated; // Assuming MicStream gives 16k as promised


      // 🔴 CRITICAL FIX: Atomically capture and clear in same synchronous tick (Bug #7)
      // This prevents the race where new audio arrives between count capture and transcribe() start.
      this.audioChunks.length = 0;

      // Perform transcription using the PrivateSTT facade
      const result = await this.privateSTT.transcribe(processedAudio);

      if (result.isErr) {
        throw result.error;
      }

      // Append new text to transcript (incremental)
      const newText = result.value || '';

      if (newText.trim()) {
        logger.info({ sId: this.serviceId, rId: this.runId, newText, latencyMs: (performance.now() - tStart).toFixed(2) }, '[PrivateWhisper] ✨ Transcription success');
        // Append with space if transcript already has content
        this.transcript = this.transcript ? `${this.transcript} ${newText}` : newText;
        this.onTranscriptUpdate({ transcript: { final: newText } });
      }

      // Buffer already cleared via splice(0) - no additional slice needed

    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error({ sId: this.serviceId, rId: this.runId, err: error }, '[PrivateWhisper] Transcription processing failed.');
    } finally {
      this.isProcessing = false;
    }
  }

  public async stopTranscription(): Promise<string> {
    logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateWhisper] stopTranscription() called.');

    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    if (this.mic) {
      this.mic = null;
    }

    this.cleanupFrameListener();

    // Process any remaining audio
    await this.processAudio();

    this.status = 'stopped';
    return this.transcript;
  }

  public async getTranscript(): Promise<string> {
    return this.transcript;
  }

  public async terminate(): Promise<void> {
    logger.info({ sId: this.serviceId, rId: this.runId }, '[PrivateWhisper] Terminating service...');
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    this.cleanupFrameListener();
    this.isProcessing = false;
    this.audioChunks = []; // Clear buffer

    // Strict cleanup of the underlying engine
    await this.privateSTT.destroy();
    if (typeof document !== 'undefined') {
      document.body.removeAttribute('data-engine-variant');
    }
    this.status = 'stopped';
  }

  private cleanupFrameListener(): void {
    if (this.frameListenerDisposer) {
      this.frameListenerDisposer();
      this.frameListenerDisposer = null;
    }
  }

  public getEngineType(): string {
    return this.privateSTT.getEngineType() || 'whisper-turbo'; // Default to turbo for identification
  }
}
