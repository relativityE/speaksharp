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
 * 2. Tries whisper-turbo first (5s timeout)
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
import { toast } from 'sonner';

type Status = 'idle' | 'loading' | 'transcribing' | 'stopped' | 'error';

/**
 * Utility to clear the Whisper model cache from IndexedDB.
 * Used for self-repair when browser locks occur.
 */
export async function clearPrivateSTTCache(): Promise<void> {
  return new Promise((resolve) => {
    logger.info('[PrivateSTT] Attempting to clear model cache...');

    // Clear whisper-turbo cache
    const request1 = indexedDB.deleteDatabase('whisper-turbo');
    request1.onsuccess = () => {
      logger.info('[PrivateSTT] whisper-turbo IndexedDB cleared.');
    };

    // Clear transformers cache
    const request2 = indexedDB.deleteDatabase('transformers-cache');
    request2.onsuccess = () => {
      logger.info('[PrivateSTT] transformers-cache IndexedDB cleared.');
    };

    // Resolve after a short delay to allow both operations
    setTimeout(resolve, 100);
  });
}

export default class PrivateWhisper implements ITranscriptionMode {
  private onTranscriptUpdate: (update: TranscriptUpdate) => void;
  private onModelLoadProgress?: (progress: number | null) => void;
  private onReady?: () => void;
  private status: Status;
  private transcript: string;
  private privateSTT: PrivateSTT;
  private engineType: EngineType | null = null;
  private mic: MicStream | null = null;
  private audioChunks: Float32Array[] = [];
  private isProcessing: boolean = false;
  private processingInterval: NodeJS.Timeout | null = null;

  constructor({ onTranscriptUpdate, onModelLoadProgress, onReady }: TranscriptionModeOptions) {
    if (!onTranscriptUpdate) {
      throw new Error("onTranscriptUpdate callback is required for PrivateWhisper.");
    }
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onModelLoadProgress = onModelLoadProgress;
    this.onReady = onReady;
    this.status = 'idle';
    this.transcript = '';
    this.privateSTT = createPrivateSTT();

    // Check for test environment and expose instance for E2E verification
    if (typeof window !== 'undefined' && (
      (window as any).__E2E_PLAYWRIGHT__ ||
      (window as any).TEST_MODE
    )) {
      console.log('[PrivateWhisper] 🧪 Exposing instance for E2E testing as window.__PrivateWhisper_INT_TEST__');
      (window as any).__PrivateWhisper_INT_TEST__ = this;
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
      logger.error({ err: error }, '[PrivateWhisper] Failed to initialize.');
      this.status = 'error';

      // Provide a proactive fix for failures
      toast.error('Private STT initialization failed.', {
        duration: 15000,
        action: {
          label: 'Clear Cache & Reload',
          onClick: async () => {
            await clearPrivateSTTCache();
            window.location.reload();
          }
        }
      });

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
      this.audioChunks.push(frame.slice(0));
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

      // Log first successful processing to prove data flow
      if (this.transcript.length === 0 && concatenated.length > 0) {
        console.log(`[PrivateWhisper] 🎤 Processing first audio chunk: ${concatenated.length} samples`);
        logger.info(`[PrivateWhisper] Processing audio chunk size=${concatenated.length}`);
      }

      // Perform transcription using the PrivateSTT facade
      const result = await this.privateSTT.transcribe(concatenated);

      if (result.isErr) {
        throw result.error;
      }

      // Append new text to transcript (incremental)
      const newText = result.value || '';
      if (newText.trim()) {
        // Append with space if transcript already has content
        this.transcript = this.transcript ? `${this.transcript} ${newText}` : newText;
        this.onTranscriptUpdate({ transcript: { final: this.transcript } });
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
}
