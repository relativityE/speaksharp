import CloudAssemblyAI from './modes/CloudAssemblyAI';
import NativeBrowser from './modes/NativeBrowser';
import { createMicStream } from './utils/audioUtils';

export default class TranscriptionService {
  constructor({ onTranscriptUpdate, onModelLoadProgress, onReady, profile, forceCloud = false, session, navigate, getAssemblyAIToken } = {}) {
    console.log(`[TranscriptionService] Constructor called with forceCloud: ${forceCloud}`);
    this.mode = null;
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onModelLoadProgress = onModelLoadProgress;
    this.onReady = onReady;
    this.profile = profile;
    this.session = session;
    this.navigate = navigate;
    this.getAssemblyAIToken = getAssemblyAIToken;
    this.forceCloud = forceCloud;
    this.instance = null;
    this.mic = null;
  }

  async init() {
    console.log('[TranscriptionService] Initializing mic stream...');
    try {
      this.mic = await createMicStream({ sampleRate: 16000, frameSize: 1024 });
      console.log('[TranscriptionService] Mic stream created.');
      return { success: true };
    } catch (error) {
      console.error('[TranscriptionService] Failed to initialize mic.', error);
      throw error;
    }
  }

  async startTranscription() {
    console.log('[TranscriptionService] Attempting to start transcription...');
    if (!this.mic) {
      throw new Error("Microphone not initialized. Call init() first.");
    }

    const providerConfig = {
      onTranscriptUpdate: this.onTranscriptUpdate,
      onModelLoadProgress: this.onModelLoadProgress,
      onReady: this.onReady,
      session: this.session,
      navigate: this.navigate,
      getAssemblyAIToken: this.getAssemblyAIToken,
    };

    try {
      console.log(`[TranscriptionService] Attempting to use Cloud mode. forceCloud is ${this.forceCloud}`);
      this.instance = new CloudAssemblyAI(providerConfig);
      await this.instance.init();
      await this.instance.startTranscription(this.mic);
      this.mode = 'cloud';
      console.log('[TranscriptionService] Cloud transcription started successfully.');
    } catch (error) {
      console.warn(`[TranscriptionService] Cloud mode failed. forceCloud is ${this.forceCloud}.`, error);

      if (this.forceCloud) {
        console.error('[TranscriptionService] forceCloud is enabled, re-throwing error without fallback.');
        throw error;
      }

      try {
        console.log('[TranscriptionService] Attempting to fall back to Native Browser mode.');
        if (this.instance) {
          await this.instance.destroy?.();
        }
        this.instance = new NativeBrowser(providerConfig);
        await this.instance.init();
        await this.instance.startTranscription(this.mic);
        this.mode = 'native';
        console.log('[TranscriptionService] Native fallback transcription started successfully.');
      } catch (fallbackError) {
        console.error('[TranscriptionService] Native fallback mode also failed.', fallbackError);
        throw fallbackError;
      }
    }
  }

  async stopTranscription() {
    console.log('[TranscriptionService] Stopping transcription.');
    if (!this.instance) {
      console.warn('[TranscriptionService] No instance to stop.');
      return '';
    }
    const result = await this.instance.stopTranscription();
    console.log('[TranscriptionService] Transcription stopped.');
    return result;
  }

  async getTranscript() {
    if (!this.instance) return '';
    return this.instance.getTranscript();
  }

  async destroy() {
    console.log('[TranscriptionService] Destroying service.');
    try { await this.stopTranscription(); } catch (e) { /* best effort */ }
    try {
      if (this.mic) {
        this.mic.stop();
        console.log('[TranscriptionService] Mic stream stopped.');
      }
    } catch (e) { /* best effort */ }
    this.instance = null;
    this.mic = null;
    console.log('[TranscriptionService] Service destroyed.');
  }
}
