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
import { PrivateSTT, createPrivateSTT, EngineType } from '../engines';
import { ITranscriptionMode, TranscriptionModeOptions } from './types';
import { MicStream } from '../utils/types';
import { concatenateFloat32Arrays } from '../utils/AudioProcessor';
import { TranscriptUpdate } from '../TranscriptionService';
import { IS_TEST_ENVIRONMENT } from '../../../config/env';

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
  }
}
import { toast } from 'sonner';

type Status = 'idle' | 'loading' | 'transcribing' | 'stopped' | 'error';

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

export default class PrivateWhisper implements ITranscriptionMode {
  private onTranscriptUpdate: (update: TranscriptUpdate) => void;
  private onModelLoadProgress?: (progress: number | null) => void;
  private onReady?: () => void;
  private onAudioData?: (data: Float32Array) => void;
  private status: Status;
  private transcript: string;
  private privateSTT: PrivateSTT;
  private engineType: EngineType | null = null;
  private mic: MicStream | null = null;
  private audioChunks: Float32Array[] = [];
  private isProcessing: boolean = false;
  private processingInterval: NodeJS.Timeout | null = null;

  constructor({ onTranscriptUpdate, onModelLoadProgress, onReady, onAudioData }: TranscriptionModeOptions) {
    if (!onTranscriptUpdate) {
      throw new Error("onTranscriptUpdate callback is required for PrivateWhisper.");
    }
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onModelLoadProgress = onModelLoadProgress;
    this.onReady = onReady;
    this.onAudioData = onAudioData;
    this.status = 'idle';
    this.transcript = '';
    this.privateSTT = createPrivateSTT();

    // Check for test environment and expose instance for E2E verification
    if (IS_TEST_ENVIRONMENT) {
      console.log('[PrivateWhisper] 🧪 Exposing instance for E2E testing as window.__PrivateWhisper_INT_TEST__');
      window.__PrivateWhisper_INT_TEST__ = this;
    }

    logger.info('[PrivateWhisper] Initialized (dual-engine facade).');
  }

  public async init(): Promise<void> {
    console.log('[PrivateWhisper] 🔄 init() START - Dual-Engine Mode');
    logger.info('[PrivateWhisper] Initializing PrivateSTT facade...');
    this.status = 'loading';

    try {
      // Trigger initial progress
      if (this.onModelLoadProgress) {
        this.onModelLoadProgress(0);
      }

      // Initialize the PrivateSTT facade (auto-selects best engine)
      const result = await this.privateSTT.init({
        onModelLoadProgress: (progress) => {
          console.log(`[PrivateWhisper] 📊 Progress: ${progress}%`);
          if (this.onModelLoadProgress) {
            this.onModelLoadProgress(progress);
          }
        },
        onReady: () => {
          logger.info('[PrivateWhisper] Engine ready callback triggered.');
        }
      });

      if (result.isErr) {
        throw result.error;
      }

      this.engineType = result.value;
      this.status = 'idle';
      console.log(`[PrivateWhisper] ✅ Engine initialized: ${this.engineType}`);
      logger.info(`[PrivateWhisper] Engine initialized: ${this.engineType}`);

      // Show toast notification with engine type
      toast.success(`Model ready! Using ${this.engineType === 'whisper-turbo' ? 'GPU acceleration' : 'CPU mode'}.`);

      // Notify that the service is ready
      if (this.onReady) {
        this.onReady();
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('[PrivateWhisper] ❌ Init failed:', error);
      logger.error({ err: error }, '[PrivateWhisper] Failed to initialize.');
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
      logger.error('[PrivateWhisper CRITICAL] MicStream missing onFrame method!');
      throw new Error('Invalid MicStream: missing onFrame method');
    }
    this.mic = mic;
    logger.info('[PrivateWhisper] startTranscription() called.');
    if (this.status !== 'idle') {
      logger.warn(`[PrivateWhisper] Unexpected status: ${this.status}, expected 'idle'`);
    }
    this.status = 'transcribing';
    this.audioChunks = [];
    this.transcript = '';

    // Subscribe to microphone frames
    mic.onFrame((frame: Float32Array) => {
      // Copy the frame to avoid buffer detachment issues
      const clonedFrame = frame.slice(0);
      this.audioChunks.push(clonedFrame);

      // Pass raw audio to analysis hooks (Pause Detection)
      if (this.onAudioData) {
        this.onAudioData(clonedFrame);
      }
    });

    // Start processing loop (every 1 second)
    this.processingInterval = setInterval(() => {
      this.processAudio();
    }, 1000);

    console.log('[PrivateWhisper] Streaming started.');
    logger.info('[PrivateWhisper] Streaming started.');
  }

  private async processAudio(): Promise<void> {
    if (this.isProcessing) {
      return; // Already processing, skip
    }
    if (this.audioChunks.length === 0) {
      return; // No audio to process
    }

    this.isProcessing = true;

    try {
      // Concatenate all chunks using shared utility
      const concatenated = concatenateFloat32Arrays(this.audioChunks);

      // RMS VAD: Prevent silence from reaching the model to avoid hallucinations
      let sum = 0;
      for (let i = 0; i < concatenated.length; i++) {
        sum += concatenated[i] * concatenated[i];
      }
      const rms = Math.sqrt(sum / concatenated.length);

      // Threshold 0.01 (1%) is a safe silence threshold for 16-bit audio range (-1 to 1)
      if (rms < 0.01) {
        this.audioChunks = [];
        return;
      }

      // CRITICAL FIX: The MicStream ALREADY downsamples to 16kHz (confirmed in audioUtils.impl.ts).
      // Double downsampling (16k -> 16k) is harmless, but if we guessed 44k -> 16k on 16k input, we'd decimate it.
      // So detailed logging is better than blind downsampling here.

      // Log first successful processing to prove data flow
      if (this.transcript.length === 0) {
        // Calculate estimated duration based on 16kHz
        const expectedDurationSec = concatenated.length / 16000;
        console.log(`[PrivateWhisper] 🎤 Processing chunk: ${concatenated.length} samples (${expectedDurationSec.toFixed(2)}s)`);

        // If the duration is wildly different from wall clock, we have a sample rate issue
        // (This is just a heuristic for logs, not control logic)
      }

      // CRITICAL: Ensure we are not double-downsampling if the mic is already 16k
      // MicStream reports 16000, so we trust it. 
      // If the audio is weird, we need to inspect the worklet.
      // For now, pass concatenated directly but keep the check

      const processedAudio = concatenated; // Assuming MicStream gives 16k as promised


      // Perform transcription using the PrivateSTT facade
      const result = await this.privateSTT.transcribe(processedAudio);

      if (result.isErr) {
        throw result.error;
      }

      // Append new text to transcript (incremental)
      const newText = result.value || '';

      if (newText.trim()) {
        // Append with space if transcript already has content
        this.transcript = this.transcript ? `${this.transcript} ${newText}` : newText;
        // CRITICAL FIX: Send ONLY the NEW text as final, not the whole history.
        // useSpeechRecognition accumulates chunks. Sending the whole history causes duplication.
        this.onTranscriptUpdate({ transcript: { final: newText } });
      }

      // CRITICAL FIX: Clear the buffer to prevent quadratic growth
      this.audioChunks = [];

    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error({ err: error }, '[PrivateWhisper] Transcription processing failed.');
    } finally {
      this.isProcessing = false;
    }
  }

  public async stopTranscription(): Promise<string> {
    logger.info('[PrivateWhisper] stopTranscription() called.');

    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    if (this.mic) {
      this.mic = null;
    }

    // Process any remaining audio
    await this.processAudio();

    this.status = 'stopped';
    return this.transcript;
  }

  public async getTranscript(): Promise<string> {
    return this.transcript;
  }

  public async terminate(): Promise<void> {
    logger.info('[PrivateWhisper] Terminating service...');
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    this.isProcessing = false;
    this.audioChunks = []; // Clear buffer

    // Strict cleanup of the underlying engine
    await this.privateSTT.destroy();
    this.status = 'stopped';
  }
}
