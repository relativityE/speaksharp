import logger from '../../../lib/logger';
import { pipeline } from '@xenova/transformers';

const HUB_MODEL = 'Xenova/whisper-tiny.en';
const LOCAL_MODEL_PATH = '/models/whisper-tiny.en/';

export default class LocalWhisper {
  constructor({ onTranscriptUpdate, onModelLoadProgress } = {}) {
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onModelLoadProgress = onModelLoadProgress;
    this.status = 'idle';
    this.transcript = '';
    this.pipe = null;
    logger.info('[LocalWhisper] Initialized.');
  }

  async init() {
    logger.info('[LocalWhisper] Initializing model...');
    this.status = 'loading';

    try {
      // 1. Try to load from Hugging Face Hub
      logger.info(`[LocalWhisper] Attempting to load model from Hub: ${HUB_MODEL}`);
      this.pipe = await pipeline('automatic-speech-recognition', HUB_MODEL, {
        progress_callback: this.onModelLoadProgress,
      });
      this.status = 'idle';
      logger.info(`[LocalWhisper] Model loaded successfully from Hub: ${HUB_MODEL}.`);
    } catch (hubError) {
      // 2. If Hub fails, fall back to local model
      logger.warn(`[LocalWhisper] Failed to load model from Hub. Falling back to local model. Error: ${hubError.message}`);

      try {
        logger.info(`[LocalWhisper] Attempting to load model from local path: ${LOCAL_MODEL_PATH}`);
        this.pipe = await pipeline('automatic-speech-recognition', LOCAL_MODEL_PATH, {
          progress_callback: this.onModelLoadProgress,
        });
        this.status = 'idle';
        logger.info(`[LocalWhisper] Model loaded successfully from local path: ${LOCAL_MODEL_PATH}.`);
      } catch (localError) {
        // 3. If local model also fails, it's a critical error
        logger.error('[LocalWhisper] CRITICAL: Failed to load model from both Hub and local path.', localError);
        this.status = 'error';
        throw localError; // Re-throw the final error to be caught by the UI
      }
    }
  }

  async startTranscription(mic) {
    if (window.__MOCK_LOCAL_WHISPER__) {
      logger.info('Using mocked LocalWhisper for E2E test.');
      this.onTranscriptUpdate('This is a test transcript from a mocked LocalWhisper.', true, []);
      this.status = 'stopped';
      return;
    }
    this.mic = mic;
    logger.info('[LocalWhisper] startTranscription() called.');
    if (this.status !== 'idle' || !this.pipe) {
      logger.error('[LocalWhisper] Not ready for transcription.');
      return;
    }
    this.status = 'transcribing';

    // We will process audio in chunks. This is a simplified approach.
    // A more robust solution would handle continuous streaming.
    const audioData = await this.getAudioData(mic);
    const result = await this.pipe(audioData, {
      chunk_length_s: 30,
      stride_length_s: 5,
    });

    this.transcript = result.text;
    this.onTranscriptUpdate(this.transcript, true, result.chunks || []);
    this.status = 'stopped';
  }

  // Helper to collect audio data for a short duration
  async getAudioData(mic, duration = 5000) {
    return new Promise(resolve => {
      const frames = [];
      const frameHandler = frame => {
        frames.push(frame.slice(0)); // Clone the frame
      };
      mic.onFrame(frameHandler);

      setTimeout(() => {
        mic.offFrame(frameHandler);
        // Concatenate all frames into a single Float32Array
        const totalLength = frames.reduce((sum, f) => sum + f.length, 0);
        const concatenated = new Float32Array(totalLength);
        let offset = 0;
        for (const frame of frames) {
          concatenated.set(frame, offset);
          offset += frame.length;
        }
        resolve(concatenated);
      }, duration);
    });
  }

  async stopTranscription() {
    logger.info('[LocalWhisper] stopTranscription() called.');
    this.status = 'stopped';
    // In a real streaming implementation, we would stop the audio processing here.
    // For this simplified version, we just ensure the state is correct.
    if (this.mic) {
        // In a real implementation, we might need to properly remove listeners.
        // For now, this is sufficient.
        this.mic = null;
    }
    return this.transcript;
  }

  isSupported() {
    return true; // Assume supported for now
  }
}
