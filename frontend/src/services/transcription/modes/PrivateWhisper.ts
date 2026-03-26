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
import { IPrivateSTT } from '@/contracts/IPrivateSTT';
import { ITranscriptionEngine, TranscriptionModeOptions, Result } from './types';
import { CacheMissEvent } from '../errors';
import { EngineCallbacks } from '@/contracts/IPrivateSTTEngine';

import { MicStream } from '../utils/types';
import { concatenateFloat32Arrays } from '../utils/AudioProcessor';
import { TranscriptUpdate } from '@/types/transcription';
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

/**
 * ARCHITECTURE:
 * TranscriptionService generates a runId (e.g., abc-123) every time you click record. 
 * This identifies the current recording session.
 * The service then creates an engine and passes this runId into the engine's constructor 
 * via the options.instanceId field.
 * Inside the Engine, this ID is stored as this.instanceId.
 */
import { STTEngine } from '@/contracts/STTEngine';

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
  private isProcessing: boolean = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private pauseDetector: PauseDetector;

  public get type(): EngineType {
    return (this.privateSTT.getEngineType() as EngineType) || 'whisper-turbo';
  }

  constructor(options: TranscriptionModeOptions, privateSTT?: IPrivateSTT) {
    super();
    this.onTranscriptUpdate = options.onTranscriptUpdate;
    this.onModelLoadProgress = options.onModelLoadProgress;
    this.onReady = options.onReady;
    this.onAudioData = options.onAudioData;

    // Set base properties manually for immediate construction logging
    // init() will override these based on callbacks, but constructor runs first
    this.serviceId = options.serviceId || 'unknown';
    this.runId = options.instanceId || 'unknown'; // TranscriptionService uses instanceId as runId

    this.status = 'uninitialized';
    this.currentTranscript = '';
    this.privateSTT = (privateSTT as IPrivateSTT) || (createPrivateSTT() as IPrivateSTT);
    this.pauseDetector = new PauseDetector();
    this.lastHeartbeat = Date.now();

    // Check for E2E environment and expose instance for verification
    if (ENV.IS_E2E) {
      logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[PrivateWhisper] 🧪 Exposing instance for E2E testing');
      window.__PrivateWhisper_INT_TEST__ = this;
    }

    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[PrivateWhisper] Initialized (dual-engine facade).');
  }

  protected async onInit(_callbacks: EngineCallbacks | TranscriptionModeOptions): Promise<Result<void, Error>> {
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
      const initPromise = this.privateSTT.init({
        serviceId: this.serviceId,
        runId: this.instanceId,
        onModelLoadProgress: (progress: number | null) => {
          logger.info({ sId: this.serviceId, rId: this.instanceId, progress }, '[PrivateWhisper] 📊 Progress');
          if (this.onModelLoadProgress) {
            this.onModelLoadProgress(progress);
          }
        },
        onReady: () => {
          logger.info({ sId: this.serviceId, rId: this.instanceId }, '[PrivateWhisper] Engine ready callback triggered.');
        },
        onTranscriptUpdate: (data) => {
          if (this.onTranscriptUpdate) {
            this.onTranscriptUpdate(data);
          }
        }
      });

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
        throw new CacheMissEvent();
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
    this.audioChunks = [];
    this.currentTranscript = '';
    this.updateHeartbeat();

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
    this.frameListenerDisposer = this.mic.onFrame(listener);

    // Start processing loop (every 500ms) for more responsive UI
    this.processingInterval = setInterval(() => {
      void this.processAudio();
    }, 500);

    logger.info({ sId: this.serviceId, rId: this.instanceId }, '[PrivateWhisper] Streaming started.');
  }

  private async processAudio(): Promise<void> {
    this.updateHeartbeat();
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
            rId: this.instanceId,
            silenceDuration: this.pauseDetector.getCurrentSilenceDurationSeconds(),
            samples: concatenated.length
          }, '[PrivateWhisper] 🤫 Meaningful silence detected - skipping chunk');
        }
        this.audioChunks = []; // Clear buffer to prevent backlog
        return;
      }

      logger.info({ sId: this.serviceId, rId: this.instanceId, samples: concatenated.length }, '[PrivateWhisper] 🔊 Speech detected');

      if (this.currentTranscript.length === 0) {
        const expectedDurationSec = concatenated.length / 16000;
        logger.info({ sId: this.serviceId, rId: this.instanceId, samples: concatenated.length, expectedDurationSec }, '[PrivateWhisper] 🎤 Processing chunk');
      }

      const processedAudio = concatenated;

      // Atomically capture and clear in same synchronous tick
      this.audioChunks.length = 0;

      // Perform transcription using the PrivateSTT facade
      const result = await this.privateSTT.transcribe(processedAudio);

      if (result.isOk === false) {
        throw result.error;
      }

      // Append new text to transcript (incremental)
      const newText = result.data || '';

      if (newText.trim()) {
        logger.info({ sId: this.serviceId, rId: this.instanceId, newText, latencyMs: (performance.now() - tStart).toFixed(2) }, '[PrivateWhisper] ✨ Transcription success');
        this.currentTranscript = this.currentTranscript ? `${this.currentTranscript} ${newText}` : newText;
        if (this.onTranscriptUpdate) {
          this.onTranscriptUpdate({ transcript: { final: newText } });
        }
      }

    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error({ sId: this.serviceId, rId: this.instanceId, err: error }, '[PrivateWhisper] Transcription processing failed.');
    } finally {
      this.isProcessing = false;
    }
  }

  protected async onStop(): Promise<void> {
    logger.info({ sId: this.serviceId, rId: this.instanceId }, '[PrivateWhisper] onStop() called.');

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
  }

  protected async onDestroy(): Promise<void> {
    logger.info({ sId: this.serviceId, rId: this.instanceId }, '[PrivateWhisper] Terminating service...');
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

  async transcribe(audio: Float32Array): Promise<Result<string, Error>> {
    return this.privateSTT.transcribe(audio);
  }

  private cleanupFrameListener(): void {
    if (this.frameListenerDisposer) {
      this.frameListenerDisposer();
      this.frameListenerDisposer = null;
    }
  }
}
