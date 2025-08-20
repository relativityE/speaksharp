import { pipeline } from '@xenova/transformers';

export default class LocalWhisper {
  constructor({ model = 'Xenova/whisper-tiny.en', performanceWatcher, onTranscriptUpdate } = {}) {
    console.log(`[LocalWhisper] Constructor called with model: ${model}`);
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
      console.log(`[LocalWhisper] Initializing local whisper model: ${this.model}`);

      const progress_callback = (progress) => {
        console.log(`[LocalWhisper] Model download progress:`, progress);
        const status = progress.status;
        const file = progress.file;
        const loaded = (progress.loaded / 1024 / 1024).toFixed(2);
        const total = (progress.total / 1024 / 1024).toFixed(2);
        const progressPercent = ((progress.loaded / progress.total) * 100).toFixed(2);

        this.onTranscriptUpdate({
            transcript: { partial: `Downloading model: ${file} (${loaded}MB / ${total}MB - ${progressPercent}%)` }
        });
      };

      this.transcriber = await pipeline('automatic-speech-recognition', this.model, {
        dtype: 'fp32',
        progress_callback,
      });

      this.ready = true;
      console.log('[LocalWhisper] Local whisper model initialized successfully.');
    } catch (error) {
      console.error('[LocalWhisper] Failed to initialize local whisper model:', error);
      this.ready = false;
      throw error;
    }
  }

  async startTranscription(mic) {
    console.log('[LocalWhisper] Starting transcription.');
    if (!this.ready) throw new Error('LocalWhisper not initialized');

    this.audioChunks = [];
    this._frameCount = 0;
    this._t0 = performance.now();

    if (this.onTranscriptUpdate) {
      this.onTranscriptUpdate({ transcript: { partial: '...' } });
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
    console.log('[LocalWhisper] Listening for frames.');
  }

  async stopTranscription() {
    console.log('[LocalWhisper] Stopping transcription.');
    if (this._stop) this._stop();
    this._stop = null;

    if (!this.transcriber || this.audioChunks.length === 0) {
      console.log('[LocalWhisper] No audio chunks to process.');
      if (this.onTranscriptUpdate) {
        this.onTranscriptUpdate({ transcript: { final: '', partial: '' } });
      }
      return '';
    }

    try {
      const totalLength = this.audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const combined = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of this.audioChunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      console.log(`[LocalWhisper] Processing ${totalLength / 16000}s of audio...`);
      const result = await this.transcriber(combined, {
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      const finalText = result.text;
      console.log(`[LocalWhisper] Transcription result: "${finalText}"`);

      if (this.onTranscriptUpdate) {
        this.onTranscriptUpdate({ transcript: { final: finalText, partial: '' } });
      }

      return finalText;

    } catch (error) {
      console.error('[LocalWhisper] Transcription failed:', error);
      if (this.onTranscriptUpdate) {
        this.onTranscriptUpdate({ transcript: { final: 'Error transcribing audio.', partial: '' } });
      }
      return 'Error transcribing audio.';
    } finally {
      this.audioChunks = [];
    }
  }

  async getTranscript() {
    return '';
  }

  destroy() {
    console.log('[LocalWhisper] Destroying instance.');
    if (this._stop) this._stop();
    this.transcriber = null;
    this.ready = false;
    this.audioChunks = [];
  }
}
