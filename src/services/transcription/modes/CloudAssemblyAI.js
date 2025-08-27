import { AssemblyAI } from 'assemblyai';
import { supabase } from '../../../lib/supabaseClient';
import { toast } from 'sonner';

export default class CloudAssemblyAI {
  constructor({ performanceWatcher, onTranscriptUpdate, onReady, session, navigate } = {}) {
    this.performanceWatcher = performanceWatcher;
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onReady = onReady;
    this.session = session;
    this.navigate = navigate;
    this.transcriber = null;
    this._frameCount = 0;
    this._t0 = 0;
  }

  async _getAssemblyAIToken() {
    try {
      // --- Standard User Path ---
      if (!this.session?.access_token) {
        throw new Error('User not authenticated. Please log in to use Cloud transcription.');
      }
      const userJwt = this.session.access_token;

      // --- Use JWT to get AssemblyAI Token ---
      console.log('[CloudAssemblyAI] Requesting AssemblyAI token...');
      const { data, error } = await supabase.functions.invoke('assemblyai-token', {
        headers: { 'Authorization': `Bearer ${userJwt}` },
      });

      if (error) throw new Error(`Supabase function invocation for assemblyai-token failed: ${error.message}`);
      if (data.error) {
        if (data.error.includes('Usage limit exceeded')) {
          toast.error("You've run out of free minutes.", {
            description: "Please upgrade to a Pro plan for unlimited transcription.",
            action: { label: "Upgrade", onClick: () => this.navigate('/auth?view=pro-upgrade') },
          });
        }
        throw new Error(`AssemblyAI token error: ${data.error}`);
      }
      if (!data?.token) throw new Error('Token not found in response from Supabase function.');

      console.log('[CloudAssemblyAI] Successfully received AssemblyAI token.');
      return data.token;

    } catch (error) {
      console.error('Failed to get AssemblyAI token:', error);
      toast.error('Failed to start session', { description: error.message });
      throw new Error(`Failed to get AssemblyAI token. Reason: ${error.message}`);
    }
  }

  async init() {
    // Initialization logic can be placed here if needed in the future.
  }

  async startTranscription(mic) {
    try {
      const assemblyAIToken = await this._getAssemblyAIToken();
      this.transcriber = new AssemblyAI.StreamingTranscriber({
        token: assemblyAIToken,
        sampleRate: 16000,
      });

      this.transcriber.on('open', ({ sessionId }) => {
        console.log(`AssemblyAI session opened with ID: ${sessionId}`);
        if (this.onReady) this.onReady();
      });

      this.transcriber.on('error', (error) => console.error('AssemblyAI error:', error));
      this.transcriber.on('close', (code, reason) => console.log('AssemblyAI session closed:', code, reason));
      this.transcriber.on('transcript.partial', (p) => {
        if (p.text && this.onTranscriptUpdate) this.onTranscriptUpdate({ transcript: { partial: p.text } });
      });
      this.transcriber.on('transcript.final', (f) => {
        if (f.text && this.onTranscriptUpdate) this.onTranscriptUpdate({ transcript: { final: f.text }, words: f.words });
      });

      await this.transcriber.connect();

      const onFrame = (f32) => this.transcriber?.sendAudio(f32);
      mic.onFrame(onFrame);
      this._stop = () => mic.offFrame(onFrame);

    } catch (error) {
      console.error('Failed to start transcription:', error);
      // The error is already toasted in _getAssemblyAIToken, so no need to toast again here.
      throw error;
    }
  }

  async stopTranscription() {
    this._stop?.();
    this._stop = null;
    await this.transcriber?.close();
    this.transcriber = null;
  }
}
