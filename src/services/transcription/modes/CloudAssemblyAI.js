import { AssemblyAI } from 'assemblyai';

export default class CloudAssemblyAI {
  constructor({ performanceWatcher, onTranscriptUpdate } = {}) {
    this.performanceWatcher = performanceWatcher;
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.transcriber = null;
    this._frameCount = 0;
    this._t0 = 0;
  }

  async _getTemporaryToken() {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Supabase environment variables VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be configured.');
      }

      const response = await fetch(`${supabaseUrl}/functions/v1/assemblyai-token`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Token request failed with status: ${response.status}`);
      }

      const data = await response.json();
      if (!data.token) {
        throw new Error('Token not found in response from Supabase function.');
      }
      return data.token;
    } catch (error) {
      console.error('Failed to get AssemblyAI token:', error);
      throw error;
    }
  }

  async init() {
    // The init method is no longer responsible for fetching the token.
    // It will be fetched on-demand in startTranscription to ensure it's always fresh.
  }

  async startTranscription(mic) {
    try {
      const token = await this._getTemporaryToken();

      // --- Start of requested debugging logs ---
      console.log('--- AssemblyAI Debug Info ---');
      console.log('Token received type:', typeof token);
      console.log('Is token a non-empty string?', typeof token === 'string' && token.length > 0);
      console.log('Token value (first 10 chars):', typeof token === 'string' ? token.substring(0, 10) + '...' : 'N/A');
      // --- End of requested debugging logs ---

      if (typeof token !== 'string' || !token) {
        throw new Error('Invalid token received. Must be a non-empty string.');
      }

      const config = {
        token: token,
        sampleRate: 16000,
      };

      this.transcriber = new AssemblyAI.StreamingTranscriber(config);

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
        this.transcriber.sendAudio(f32);
        // PERF
        if (this._frameCount % 10 === 0 && this.performanceWatcher) {
          const elapsedMs = performance.now() - this._t0;
          const audioMs = (this._frameCount * 1024) / 16000 * 1000;
          const rtFactor = elapsedMs / audioMs;
          this.performanceWatcher({ provider: 'cloud', rtFactor, elapsedMs, audioMs });
        }
        this._frameCount++;
      };

      mic.onFrame(onFrame);
      this._stop = () => mic.offFrame(onFrame);

    } catch (error) {
      console.error('Failed to start transcription:', error);
      throw error;
    }
  }

  async stopTranscription() {
    if (this._stop) this._stop();
    this._stop = null;
    if (this.transcriber) {
      await this.transcriber.close();
      this.transcriber = null;
    }
    return '';
  }

  async getTranscript() {
    return '';
  }
}
