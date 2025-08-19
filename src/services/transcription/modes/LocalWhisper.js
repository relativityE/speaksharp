import { pipeline } from '@xenova/transformers';

export default class LocalWhisper {
  constructor({ model = 'Xenova/whisper-tiny.en', performanceWatcher, onTranscriptUpdate } = {}) {
    this.model = model;
    this.performanceWatcher = performanceWatcher;
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.transcriber = null;
    this.ready = false;
    this.audioChunks = [];
    this._stop = null;
    this._frameCount = 0;
    this._t0 = 0;
  }

  async init() {
    try {
      console.log('Initializing local whisper model...');
      this.transcriber = await pipeline('automatic-speech-recognition', this.model, {
        dtype: 'fp32',
      });
      this.ready = true;
      console.log('Local whisper model initialized.');
    } catch (error) {
      console.error('Failed to initialize local whisper model:', error);
      this.ready = false;
      throw error;
    }
  }

  async startTranscription(mic) {
    if (!this.ready) throw new Error('LocalWhisper not initialized');

    this.audioChunks = [];
    this._frameCount = 0;
    this._t0 = performance.now();

    if (this.onTranscriptUpdate) {
      this.onTranscriptUpdate({ transcript: { partial: '...' } }); // Indicate that we are listening
    }

    const onFrame = (f32) => {
      this.audioChunks.push(f32);

      this._frameCount++;
      if (this._frameCount % 10 === 0 && this.performanceWatcher) {
        const elapsedMs = performance.now() - this._t0;
        const audioMs = (this._frameCount * 1024) / 16000 * 1000;
        const rtFactor = elapsedMs / audioMs;
        this.performanceWatcher({ provider: 'local', rtFactor, elapsedMs, audioMs });
      }
    };

    mic.onFrame(onFrame);
    this._stop = () => mic.offFrame(onFrame);
  }

  async stopTranscription() {
    if (this._stop) this._stop();
    this._stop = null;

    if (!this.transcriber || this.audioChunks.length === 0) {
      return '';
    }

    try {
      // Combine all audio chunks into a single Float32Array
      const totalLength = this.audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const combined = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of this.audioChunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      console.log(`Processing ${combined.length / 16000}s of audio...`);
      const result = await this.transcriber(combined);
      const finalText = result.text;

      if (this.onTranscriptUpdate) {
        this.onTranscriptUpdate({ transcript: { final: finalText, partial: '' } });
      }

      return finalText;

    } catch (error) {
      console.error('Transcription failed:', error);
      if (this.onTranscriptUpdate) {
        this.onTranscriptUpdate({ transcript: { final: 'Error transcribing audio.', partial: '' } });
      }
      return 'Error transcribing audio.';
    } finally {
      this.audioChunks = [];
    }
  }

  async getTranscript() {
    // This method is less relevant in a non-streaming implementation
    // but we return an empty string for consistency.
    return '';
  }
}
