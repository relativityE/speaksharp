import CloudAssemblyAI from './modes/CloudAssemblyAI';
import NativeBrowser from './modes/NativeBrowser';
import { createMicStream } from './utils/audioUtils';

export default class TranscriptionService {
  constructor(mode = 'local', { model = 'Xenova/whisper-tiny.en', onTranscriptUpdate, onModelLoadProgress, profile } = {}) {
    console.log(`[TranscriptionService] Constructor called with mode: ${mode}, model: ${model}`);
    this.mode = mode;
    this.model = model;
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onModelLoadProgress = onModelLoadProgress;
    this.profile = profile;
    this.instance = null;
    this.mic = null;
    this._fallbackArmed = true;
    this._lagStrikes = 0;
  }

  async init() {
    console.log('[TranscriptionService] Initializing...');
    const performanceWatcher = ({ provider, rtFactor }) => {
      if (provider === 'local') {
        if (rtFactor > 1.25) this._lagStrikes++;
        else this._lagStrikes = 0;

        const isPro = this.profile?.subscription_status === 'pro' || this.profile?.subscription_status === 'premium';
        if (isPro && this._fallbackArmed && this._lagStrikes >= 5) {
          console.warn('[TranscriptionService] Local STT lagging; switching to cloud fallback for Pro user.');
          this.setMode('cloud', { hotSwitch: true }).catch(console.error);
        }
      }
    };

    try {
      await this._instantiate(performanceWatcher);
      console.log('[TranscriptionService] Initialization complete.');
      return { success: true };
    } catch (error) {
      console.warn(`[TranscriptionService] Failed to initialize ${this.mode} mode. Falling back to native.`, error);
      try {
        this.setMode('native');
        await this._instantiate(performanceWatcher);
        return { success: true, fallback: true, error };
      } catch (fallbackError) {
        console.error('[TranscriptionService] Failed to initialize fallback native mode.', fallbackError);
        throw fallbackError; // If fallback also fails, rethrow the error.
      }
    }
  }

  async _instantiate(performanceWatcher) {
    console.log(`[TranscriptionService] Instantiating provider for mode: ${this.mode}`);
    if (this.instance) {
      try {
        console.log('[TranscriptionService] Stopping previous instance.');
        await this.instance.stopTranscription();
      } catch (e) {
        console.warn('[TranscriptionService] Error stopping previous instance:', e);
      }
    }

    if (this.mic && this.mode !== 'native') {
      console.log('[TranscriptionService] Stopping existing mic stream.');
      this.mic.stop();
      this.mic = null;
    }

    if (!this.mic && this.mode !== 'native') {
      console.log('[TranscriptionService] Creating new mic stream.');
      this.mic = await createMicStream({ sampleRate: 16000, frameSize: 1024 });
      console.log('[TranscriptionService] Mic stream created.');
    }

    const providerConfig = {
      performanceWatcher,
      onTranscriptUpdate: this.onTranscriptUpdate,
      onModelLoadProgress: this.onModelLoadProgress,
    };

    console.log(`[TranscriptionService] Loading provider for mode: ${this.mode}`);
    if (this.mode === 'local') {
      const { default: LocalWhisper } = await import('./modes/LocalWhisper.js');
      this.instance = new LocalWhisper({ model: this.model, ...providerConfig });
    } else if (this.mode === 'cloud') {
      this.instance = new CloudAssemblyAI(providerConfig);
    } else {
      this.instance = new NativeBrowser(providerConfig);
    }
    console.log(`[TranscriptionService] Provider loaded. Initializing provider...`);
    await this.instance.init();
    console.log(`[TranscriptionService] Provider initialized.`);
  }

  async setMode(mode, { hotSwitch = false } = {}) {
    console.log(`[TranscriptionService] Setting mode to: ${mode}, hotSwitch: ${hotSwitch}`);
    if (mode === this.mode) return;
    this.mode = mode;
    await this._instantiate(this.instance?.performanceWatcher);
    if (hotSwitch) {
      console.log('[TranscriptionService] Hot-switching: restarting transcription.');
      await this.instance.startTranscription(this.mic);
    }
  }

  async startTranscription() {
    console.log(`[TranscriptionService] Starting transcription for mode: ${this.mode}`);
    if (!this.instance) throw new Error('TranscriptionService not initialized');
    this._lagStrikes = 0;
    this._fallbackArmed = true;
    // The try/catch for fallback has been removed. Errors will now propagate up to the calling hook,
    // allowing the UI to display a specific error message instead of silently failing.
    await this.instance.startTranscription(this.mic);
    console.log(`[TranscriptionService] Transcription started successfully.`);
  }

  async stopTranscription() {
    console.log('[TranscriptionService] Stopping transcription.');
    this._fallbackArmed = false;
    if (!this.instance) return '';
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
