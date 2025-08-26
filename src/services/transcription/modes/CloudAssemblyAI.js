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

  async _getAuthToken() {
    const devSecretKey = import.meta.env.VITE_DEV_SECRET_KEY;

    // --- Developer Path ---
    if (devSecretKey) {
      console.log('[CloudAssemblyAI] Dev mode: Attempting to get temporary JWT...');
      try {
        const { data, error } = await supabase.functions.invoke('generate-dev-jwt', {
          headers: { 'X-Dev-Secret-Key': devSecretKey },
        });
        if (error) throw error;
        if (data.error) throw new Error(data.error);
        return data.token;
      } catch (e) {
        console.error("Failed to get dev JWT:", e);
        throw new Error(`Failed to get developer token. Reason: ${e.message}`);
      }
    }

    // --- Standard User Path ---
    if (!this.session?.access_token) {
      throw new Error('User not authenticated. Please log in to use Cloud transcription.');
    }
    return this.session.access_token;
  }

  async _getAssemblyAIToken() {
    try {
      const userJwt = await this._getAuthToken();
      const { data, error } = await supabase.functions.invoke('assemblyai-token', {
        headers: { 'Authorization': `Bearer ${userJwt}` },
      });

      if (error) throw new Error(`Supabase function invocation failed: ${error.message}`);
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
      return data.token;
    } catch (error) {
      console.error('Failed to get AssemblyAI token:', error);
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
