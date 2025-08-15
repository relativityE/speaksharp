import { AssemblyAI } from 'assemblyai';

export default class CloudAssemblyAI {
  constructor({ apiKey = import.meta.env.VITE_ASSEMBLYAI_API_KEY, performanceWatcher, onTranscriptUpdate } = {}) {
    this.apiKey = apiKey;
    this.performanceWatcher = performanceWatcher;
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.client = null;
    this.transcriber = null;
    this._frameCount = 0;
    this._t0 = 0;
  }

  async init() {
    if (!this.apiKey) throw new Error('Missing VITE_ASSEMBLYAI_API_KEY');
    this.client = new AssemblyAI({ apiKey: this.apiKey });
  }

  async startTranscription(mic) {
    if (!this.client) throw new Error('AssemblyAI client not initialized');

    this.transcriber = this.client.streaming.transcriber({
      sampleRate: 16000,
    });

    this.transcriber.on('open', ({ sessionId }) => {
      console.log(`AssemblyAI session opened with ID: ${sessionId}`);
      this._frameCount = 0;
      this._t0 = performance.now();
      if (this.onTranscriptUpdate) {
        this.onTranscriptUpdate({ transcript: { partial: '' } });
      }
    });

    this.transcriber.on('error', (error) => {
      console.error('AssemblyAI error:', error);
    });

    this.transcriber.on('close', (code, reason) => {
      console.log('AssemblyAI session closed:', code, reason);
    });

    this.transcriber.on('transcript.partial', (partial) => {
        if (partial.text && this.onTranscriptUpdate) {
            this.onTranscriptUpdate({ transcript: { partial: partial.text } });
        }
    });

    this.transcriber.on('transcript.final', (final) => {
        if (final.text && this.onTranscriptUpdate) {
            this.onTranscriptUpdate({ transcript: { final: final.text } });
        }
    });

    await this.transcriber.connect();

    const onFrame = (f32) => {
      if (!this.transcriber) return;

      // The SDK expects audio chunks to be sent via the `sendAudio` method.
      // It handles the base64 encoding internally.
      this.transcriber.sendAudio(f32);

      // PERF
      this._frameCount++;
      if (this._frameCount % 10 === 0 && this.performanceWatcher) {
        const elapsedMs = performance.now() - this._t0;
        const audioMs = (this._frameCount * 1024) / 16000 * 1000;
        const rtFactor = elapsedMs / audioMs;
        this.performanceWatcher({ provider: 'cloud', rtFactor, elapsedMs, audioMs });
      }
    };

    mic.onFrame(onFrame);
    this._stop = () => mic.offFrame(onFrame);
  }

  async stopTranscription() {
    if (this._stop) this._stop();
    this._stop = null;
    if (this.transcriber) {
      await this.transcriber.close();
      this.transcriber = null;
    }
    // The SDK does not provide a way to get the full transcript at the end,
    // so we rely on the hook to have stored the last final transcript.
    return '';
  }

  // This method is no longer a reliable way to get the transcript,
  // as the state is now managed in the hook via callbacks.
  // It's kept for architectural consistency.
  async getTranscript() {
    return '';
  }
}
