import logger from '../../../lib/logger';
import { SessionManager, AvailableModels, InferenceSession } from 'whisper-turbo';
import { ITranscriptionMode, TranscriptionModeOptions } from './types';
import { MicStream } from '../utils/types';
import { floatToWav, concatenateFloat32Arrays } from '../utils/AudioProcessor';
import { TranscriptUpdate } from '../TranscriptionService';
import { toast } from 'sonner';

type Status = 'idle' | 'loading' | 'transcribing' | 'stopped' | 'error';

export default class LocalWhisper implements ITranscriptionMode {
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
      throw new Error("onTranscriptUpdate callback is required for LocalWhisper.");
    }
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onModelLoadProgress = onModelLoadProgress;
    this.onReady = onReady;
    this.status = 'idle';
    this.transcript = '';
    this.session = null;
    this.manager = new SessionManager();
    logger.info('[LocalWhisper] Initialized (whisper-turbo backend).');
  }

  public async init(): Promise<void> {
    logger.info('[LocalWhisper] Initializing model...');
    this.status = 'loading';

    try {
      logger.info(`[LocalWhisper] Loading model: ${AvailableModels.WHISPER_TINY}`);

      // Trigger initial progress to ensure UI shows "Downloading..." immediately
      if (this.onModelLoadProgress) {
        this.onModelLoadProgress(0);
      }

      const result = await this.manager.loadModel(
        AvailableModels.WHISPER_TINY,
        () => {
          logger.info('[LocalWhisper] Model loaded callback triggered.');
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
      logger.info('[LocalWhisper] Model loaded successfully.');

      // Show toast notification
      toast.success('Model ready! You can now start your session.');

      // Notify that the service is ready
      if (this.onReady) {
        this.onReady();
      }
    } catch (error) {
      logger.error({ err: error }, '[LocalWhisper] Failed to load model.');
      this.status = 'error';
      throw error;
    }
  }

  public async startTranscription(mic: MicStream): Promise<void> {
    this.mic = mic;
    logger.info('[LocalWhisper] startTranscription() called.');
    if (this.status !== 'idle' || !this.session) {
      logger.error('[LocalWhisper] Not ready for transcription.');
      return;
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

    logger.info('[LocalWhisper] Streaming started.');
  }

  private async processAudio(): Promise<void> {
    if (this.isProcessing || !this.session || this.audioChunks.length === 0) {
      return;
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
      logger.error({ err }, '[LocalWhisper] Transcription processing failed.');
    } finally {
      this.isProcessing = false;
    }
  }

  public async stopTranscription(): Promise<string> {
    logger.info('[LocalWhisper] stopTranscription() called.');

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
