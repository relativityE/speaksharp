/**
 * ============================================================================
 * ON-DEVICE WHISPER TRANSCRIPTION SERVICE
 * ============================================================================
 * 
 * PURPOSE:
 * --------
 * Provides client-side speech-to-text using the Whisper AI model running
 * locally in the browser via WebAssembly (whisper-turbo npm package).
 * 
 * ARCHITECTURE:
 * -------------
 * This service is part of a two-layer caching architecture:
 * 
 * Layer 1 (Service Worker): sw.js intercepts CDN requests for model files
 *   and serves them from /models/ directory (CacheStorage API)
 * 
 * Layer 2 (whisper-turbo): The npm package internally caches compiled WASM
 *   in IndexedDB for faster subsequent loads
 * 
 * PERFORMANCE:
 * ------------
 * - First load: ~2-5 seconds (file I/O + WASM compilation)
 * - Subsequent loads: <1 second (served from IndexedDB cache)
 * - Model size: ~30MB (tiny-q8g16.bin) + ~2MB (tokenizer.json)
 * 
 * RELATED FILES:
 * --------------
 * - frontend/public/sw.js - Service Worker cache logic
 * - scripts/download-whisper-model.sh - Model pre-download script
 * - scripts/check-whisper-update.sh - Model version checker
 * - frontend/src/hooks/useSpeechRecognition/index.ts - Manages loading state
 * - frontend/src/lib/e2e-bridge.ts - MockOnDeviceWhisper for E2E tests
 * 
 * E2E TESTS:
 * ----------
 * - tests/e2e/ondevice-stt.e2e.spec.ts (download progress, caching, P1 regression)
 * 
 * @see docs/ARCHITECTURE.md - "On-Device STT (Whisper) & Service Worker Caching"
 */

import logger from '../../../lib/logger';
import { SessionManager, AvailableModels, InferenceSession } from 'whisper-turbo';
import { ITranscriptionMode, TranscriptionModeOptions } from './types';
import { MicStream } from '../utils/types';
import { floatToWav, concatenateFloat32Arrays } from '../utils/AudioProcessor';
import { TranscriptUpdate } from '../TranscriptionService';
import { toast } from 'sonner';

type Status = 'idle' | 'loading' | 'transcribing' | 'stopped' | 'error';

// ...
// ...
export default class PrivateWhisper implements ITranscriptionMode {
  private onTranscriptUpdate: (update: TranscriptUpdate) => void;
  private onModelLoadProgress?: (progress: number) => void;
  private onReady?: () => void;
  private status: Status;
  private transcript: string;
  private session: InferenceSession | null;
  private mic: MicStream | null = null;
  private manager: SessionManager;
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
    this.session = null;
    this.manager = new SessionManager();
    logger.info('[PrivateWhisper] Initialized (whisper-turbo backend).');
  }

  public async init(): Promise<void> {
    console.log('[Whisper] 🔄 Loading Private STT model...');
    logger.info('[PrivateWhisper] Initializing model...');
    this.status = 'loading';

    try {
      logger.info(`[PrivateWhisper] Loading model: ${AvailableModels.WHISPER_TINY}`);

      // Trigger initial progress to ensure UI shows "Downloading..." immediately
      if (this.onModelLoadProgress) {
        this.onModelLoadProgress(0);
      }



      const result = await this.manager.loadModel(
        AvailableModels.WHISPER_TINY,
        () => {
          logger.info('[PrivateWhisper] Model loaded callback triggered.');
        },
        (progress: number) => {
          if (this.onModelLoadProgress) {
            this.onModelLoadProgress(progress);
          }
        }
      );

      if (result.isErr) {
        throw result.error;
      }

      this.session = result.value;
      this.status = 'idle';
      logger.info('[PrivateWhisper] Model loaded successfully.');

      // Show toast notification
      toast.success('Model ready! You can now start your session.');

      // Notify that the service is ready
      if (this.onReady) {
        this.onReady();
      }
    } catch (error) {
      logger.error({ err: error }, '[PrivateWhisper] Failed to load model.');
      this.status = 'error';
      toast.error('Failed to load Private model. Please try again or use Native mode.');
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
    if (!this.session) {
      logger.error('[PrivateWhisper] session is null - model may not have loaded. Call init() first.');
      throw new Error('PrivateWhisper session not initialized. Call init() first.');
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

    logger.info('[PrivateWhisper] Streaming started.');
  }

  private async processAudio(): Promise<void> {
    if (this.isProcessing) {
      return; // Already processing, skip
    }
    if (!this.session) {
      logger.error('[PrivateWhisper] processAudio called but session is null!');
      return;
    }
    if (this.audioChunks.length === 0) {
      return; // No audio to process
    }

    this.isProcessing = true;

    try {
      // Concatenate all chunks using shared utility
      const concatenated = concatenateFloat32Arrays(this.audioChunks);

      const wavData = floatToWav(concatenated);

      // Perform transcription on NEW audio only
      const result = await this.session.transcribe(wavData, false, {});

      if (result.isErr) {
        throw result.error;
      }

      // Append new text to transcript (incremental)
      const newText = result.value.text || '';
      if (newText.trim()) {
        // Append with space if transcript already has content
        this.transcript = this.transcript ? `${this.transcript} ${newText}` : newText;
        this.onTranscriptUpdate({ transcript: { final: this.transcript } });
      }

      // CRITICAL FIX: Clear the buffer to prevent quadratic growth
      this.audioChunks = [];

    } catch (err) {
      logger.error({ err }, '[PrivateWhisper] Transcription processing failed.');
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
      // We don't need to explicitly unsubscribe as mic.stop() usually handles it,
      // but good practice to clear references.
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
