// src/services/transcription/TranscriptionService.js
import LocalWhisper from './modes/LocalWhisper';
import CloudAssemblyAI from './modes/CloudAssemblyAI';
import NativeBrowser from './modes/NativeBrowser';
import { createMicStream } from './utils/audioUtils';

export default class TranscriptionService {
  constructor(mode = 'local', { model = 'tiny.en.bin', onTranscriptUpdate } = {}) {
    this.mode = mode;      // 'local' | 'cloud' | 'native'
    this.model = model;    // whisper model
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.instance = null;
    this.mic = null;
    this._fallbackArmed = true;
    this._lagStrikes = 0;
  }

  async init() {
    const performanceWatcher = ({ provider, rtFactor }) => {
      // If local falls behind for several checks, failover
      if (provider === 'local') {
        if (rtFactor > 1.25) this._lagStrikes++;
        else this._lagStrikes = 0;

        if (this._fallbackArmed && this._lagStrikes >= 5) {
          console.warn('Local STT lagging; switching to cloud fallback');
          this.setMode('cloud', { hotSwitch: true }).catch(console.error);
        }
      }
    };

    try {
      await this._instantiate(performanceWatcher);
    } catch (error) {
      console.warn(`Failed to initialize ${this.mode} mode. Falling back to native.`, error);
      this.setMode('native');
      await this._instantiate(performanceWatcher);
    }
  }

  async _instantiate(performanceWatcher) {
    if (this.instance) {
      try { await this.instance.stopTranscription(); } catch {}
    }

    if (this.mic && this.mode !== 'native') {
      this.mic.stop();
      this.mic = null;
    }

    if (!this.mic && this.mode !== 'native') {
      this.mic = await createMicStream({ sampleRate: 16000, frameSize: 1024 });
    }

    const providerConfig = {
      performanceWatcher,
      onTranscriptUpdate: this.onTranscriptUpdate,
    };

    if (this.mode === 'local') {
      this.instance = new LocalWhisper({ model: this.model, ...providerConfig });
    } else if (this.mode === 'cloud') {
      this.instance = new CloudAssemblyAI(providerConfig);
    } else {
      this.instance = new NativeBrowser(providerConfig);
    }

    await this.instance.init();
  }

  async setMode(mode, { hotSwitch = false } = {}) {
    if (mode === this.mode) return;
    this.mode = mode;
    await this._instantiate(this.instance?.performanceWatcher);
    if (hotSwitch) {
      // restart immediately on new backend
      await this.instance.startTranscription(this.mic);
    }
  }

  async startTranscription() {
    if (!this.instance) throw new Error('TranscriptionService not initialized');
    this._lagStrikes = 0;
    this._fallbackArmed = true;
    try {
      await this.instance.startTranscription(this.mic);
    } catch (error) {
      console.warn(`Failed to start ${this.mode} mode. Falling back to native.`, error);
      this.setMode('native');
      await this._instantiate(this.instance?.performanceWatcher);
      await this.instance.startTranscription(this.mic);
    }
  }

  async stopTranscription() {
    this._fallbackArmed = false;
    if (!this.instance) return '';
    return this.instance.stopTranscription();
  }

  async getTranscript() {
    if (!this.instance) return '';
    return this.instance.getTranscript();
  }

  async destroy() {
    try { await this.stopTranscription(); } catch {}
    try { this.mic?.stop(); } catch {}
    this.instance = null;
    this.mic = null;
  }
}
