import { AssemblyAI } from 'assemblyai';
import { supabase } from '../../../lib/supabaseClient';

export default class CloudAssemblyAI {
  constructor({ performanceWatcher, onTranscriptUpdate, session } = {}) {
    this.performanceWatcher = performanceWatcher;
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.session = session;
    this.transcriber = null;
    this._frameCount = 0;
    this._t0 = 0;
  }

  async _getTemporaryToken() {
    const devModeSecret = import.meta.env.DEV ? import.meta.env.VITE_DEV_SECRET_KEY_V2 : undefined;
    let authHeader;

    if (devModeSecret) {
      console.log('[CloudAssemblyAI] Dev mode: using secret key for token request.');
      authHeader = `Bearer ${devModeSecret}`;
    } else {
      console.log('[CloudAssemblyAI] Production mode: using user session for token request.');
      const session = this.session;
      if (!session) {
        // This is a critical client-side check before attempting to call the function.
        throw new Error('User not authenticated. Please log in to use Cloud transcription.');
      }
      authHeader = `Bearer ${session.access_token}`;
    }

    try {
      const { data, error } = await supabase.functions.invoke('assemblyai-token', {
        headers: {
          'Authorization': authHeader,
        },
      });

      if (error) {
        // Errors from the function (e.g., network errors, 5xx status)
        throw new Error(`Supabase function invocation failed: ${error.message}`);
      }

      if (data.error) {
        // Errors returned in the function's JSON response body (e.g., auth failures)
        throw new Error(`AssemblyAI token error: ${data.error}`);
      }

      if (!data || !data.token) {
        throw new Error('Token not found in response from Supabase function.');
      }

      return data.token;
    } catch (error) {
      console.error('Failed to get AssemblyAI token:', error);
      // Provide a more user-friendly error message.
      throw new Error(`Failed to get AssemblyAI token. Please ensure the server is configured correctly and you have the required permissions. Reason: ${error.message}`);
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
        disfluencies: true,
        punctuate: true,
        end_utterance_silence_threshold: 1000,
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
              this.onTranscriptUpdate({
                  transcript: { final: final.text },
                  words: final.words
              });
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
