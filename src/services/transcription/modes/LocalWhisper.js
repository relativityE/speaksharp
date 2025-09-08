import logger from '../../../lib/logger';
import { pipeline } from '@xenova/transformers';

const MODEL_NAME = '/models/whisper-tiny.en/';

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
      this.pipe = await pipeline('automatic-speech-recognition', MODEL_NAME, {
        progress_callback: this.onModelLoadProgress,
      });
      this.status = 'idle';
      logger.info('[LocalWhisper] Model loaded successfully.');
    } catch (error) {
      logger.error('[LocalWhisper] Error loading model:', error);
      this.status = 'error';
      throw error;
    }
  }

  async startTranscription(mic) {
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
