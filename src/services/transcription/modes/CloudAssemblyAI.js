import { AssemblyAI } from 'assemblyai';
import { supabase } from '../../../lib/supabaseClient';

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
      // Use the Supabase client to invoke the edge function.
      // This is the most robust method as it handles the URL and auth headers automatically.
      const { data, error } = await supabase.functions.invoke('assemblyai-token');

      if (error) {
        throw error;
      }

      if (!data || !data.token) {
        throw new Error('Token not found in response from Supabase function.');
      }

      return data.token;
    } catch (error) {
      console.error('Failed to get AssemblyAI token:', error);
      throw new Error(`Failed to get AssemblyAI token: ${error.message}`);
    }
  }

  async init() {
    // Token will be fetched on-demand in startTranscription.
  }

  async startTranscription(mic) {
    try {
      const token = await this._getTemporaryToken();

      if (typeof token !== 'string' || !token) {
        throw new Error('Invalid token received. Must be a non-empty string.');
      }

      this.transcriber = new AssemblyAI.StreamingTranscriber({
        token: token,
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
        this.transcriber.sendAudio(f32);
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
