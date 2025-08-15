// src/services/transcription/TranscriptionService.js
import LocalWhisper from './modes/LocalWhisper';
import CloudAssemblyAI from './modes/CloudAssemblyAI';
import { createMicStream } from './utils/audioUtils';

export default class TranscriptionService {
  constructor(mode = 'local', { model = 'tiny.en.bin', onUpdate } = {}) {
    this.mode = mode;      // 'local' | 'cloud'
    this.model = model;    // whisper model
    this.onUpdate = onUpdate;
    this.instance = null;
    this.mic = null;
    this._fallbackArmed = true;
    this._lagStrikes = 0;
  }

  async init() {
    this.mic = await createMicStream({ sampleRate: 16000, frameSize: 1024 });

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

    await this._instantiate(performanceWatcher);
  }

  async _instantiate(performanceWatcher) {
    if (this.instance) {
      try { await this.instance.stopTranscription(); } catch {}
    }
    this.instance =
      this.mode === 'local'
        ? new LocalWhisper({ model: this.model, performanceWatcher, onUpdate: this.onUpdate })
        : new CloudAssemblyAI({ performanceWatcher, onUpdate: this.onUpdate });
    await this.instance.init();
  }

  async setMode(mode, { hotSwitch = false } = {}) {
    if (mode === this.mode) return;
    this.mode = mode;
    await this._instantiate(this.instance?.performanceWatcher);
    if (hotSwitch && this.mic) {
      // restart immediately on new backend
      await this.instance.startTranscription(this.mic);
    }
  }

  async startTranscription() {
    if (!this.instance) throw new Error('TranscriptionService not initialized');
    this._lagStrikes = 0;
    this._fallbackArmed = true;
    return this.instance.startTranscription(this.mic);
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
