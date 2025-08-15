import { AssemblyAI } from 'assemblyai';

export default class CloudAssemblyAI {
  constructor({ performanceWatcher, onTranscriptUpdate } = {}) {
    this.performanceWatcher = performanceWatcher;
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.transcriber = null;
    this.token = null;
    this._frameCount = 0;
    this._t0 = 0;
  }

  async _fetchToken() {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    if (!supabaseUrl) {
      throw new Error('VITE_SUPABASE_URL is not defined.');
    }
    const response = await fetch(`${supabaseUrl}/functions/v1/assemblyai-token`, {
      method: 'POST', // or 'GET' depending on your function
      headers: {
        'Content-Type': 'application/json',
      }
    });
    if (!response.ok) {
      throw new Error('Failed to fetch AssemblyAI token');
    }
    const data = await response.json();
    return data.token;
  }

  async init() {
    this.token = await this._fetchToken();
    if (!this.token) {
      throw new Error('Failed to retrieve a temporary token for AssemblyAI');
    }
  }

  async startTranscription(mic) {
    if (!this.token) throw new Error('AssemblyAI token not available');

    // Note: We create the client here because it's token-based and lightweight.
    // The AssemblyAI client object itself does not maintain a connection.
    const client = new AssemblyAI({ token: this.token });
    this.transcriber = client.streaming.transcriber({
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
