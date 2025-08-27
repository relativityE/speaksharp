import { AssemblyAI } from 'assemblyai';
import { supabase } from '../../../lib/supabaseClient';
import { toast } from 'sonner';

export default class CloudAssemblyAI {
  constructor({ onTranscriptUpdate, onReady, session, navigate } = {}) {
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onReady = onReady;
    this.session = session;
    this.navigate = navigate;
    this.transcriber = null;
    this._stopMicListener = null;
  }

  async _getAssemblyAIToken() {
    try {
      let userSession = this.session;
      const isDevMode = import.meta.env.VITE_DEV_MODE === 'true';

      if (isDevMode && !userSession) {
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error) throw new Error(`Anonymous sign-in failed: ${error.message}`);
        if (!data.session) throw new Error('Anonymous sign-in did not return a session.');
        userSession = data.session;
      }

      if (!userSession?.access_token) {
        throw new Error('User not authenticated. Please log in to use Cloud transcription.');
      }
      const userJwt = userSession.access_token;

      const { data, error } = await supabase.functions.invoke('assemblyai-token', {
        headers: { 'Authorization': `Bearer ${userJwt}` },
      });

      if (error) {
          if (error.context?.reason) {
              throw new Error(`Supabase function invocation for assemblyai-token failed: ${error.context.reason}`);
          }
          throw new Error(`Supabase function invocation for assemblyai-token failed: ${error.message}`);
      }
      if (data.error) throw new Error(`AssemblyAI token error: ${data.error}`);
      if (!data?.token) throw new Error('Token not found in response from Supabase function.');

      return data.token;

    } catch (error) {
      console.error('Failed to get AssemblyAI token:', error);
      toast.error('Failed to start session', { description: error.message });
      throw new Error(`Failed to get AssemblyAI token. Reason: ${error.message}`);
    }
  }

  async init() {
    // Initialization is handled in startTranscription
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

        // Start listening to the microphone only after the connection is open
        const onFrame = (f32) => {
          if (this.transcriber) {
            this.transcriber.sendAudio(f32);
          }
        };
        mic.onFrame(onFrame);
        this._stopMicListener = () => mic.offFrame(onFrame);
      });

      this.transcriber.on('error', (error) => {
        console.error('AssemblyAI error:', error);
        toast.error('An error occurred with the transcription service.');
      });

      this.transcriber.on('close', (code, reason) => {
        console.log('AssemblyAI session closed:', code, reason);
        this.transcriber = null;
      });

      this.transcriber.on('transcript.partial', (p) => {
        if (p.text && this.onTranscriptUpdate) this.onTranscriptUpdate({ transcript: { partial: p.text } });
      });
      this.transcriber.on('transcript.final', (f) => {
        if (f.text && this.onTranscriptUpdate) this.onTranscriptUpdate({ transcript: { final: f.text }, words: f.words });
      });

      await this.transcriber.connect();

    } catch (error) {
      console.error('Failed to start transcription:', error);
      throw error;
    }
  }

  async stopTranscription() {
    if (this._stopMicListener) {
      this._stopMicListener();
      this._stopMicListener = null;
    }

    if (this.transcriber) {
      await this.transcriber.close();
      this.transcriber = null;
    }
  }
}
