// src/services/transcription/modes/LocalWhisper.js
// EXPECTS: model files in /models/whisper/ (public path), e.g. tiny.en.bin / base.en.bin

export default class LocalWhisper {
  constructor({ model = 'tiny.en.bin', performanceWatcher, onUpdate } = {}) {
    this.model = model;
    this.performanceWatcher = performanceWatcher;
    this.onUpdate = onUpdate;
    this.transcript = '';
    this.ready = false;
    this._stop = null;
    this._frameCount = 0;
    this._t0 = 0;
  }

  async init() {
    // TODO(1): Load WASM + model (whisper.cpp browser build)
    // Example shape (pseudo):
    // this.whisper = await Whisper.init({ wasmPath: '/whisper/whisper.wasm' });
    // await this.whisper.loadModel(`/models/whisper/${this.model}`);
    this.ready = true;
  }

  async startTranscription(mic) {
    if (!this.ready) throw new Error('LocalWhisper not initialized');
    this.transcript = '';
    this._frameCount = 0;
    this._t0 = performance.now();

    const onFrame = async (f32) => {
      // TODO(2): Feed PCM f32 (16k mono) to whisper.cpp incremental API
      // const partial = await this.whisper.processFrame(f32);
      // if (partial?.text) {
      //   this.transcript = partial.text;
      //   if (this.onUpdate) {
      //     this.onUpdate({
      //       transcript: partial.text,
      //       isFinal: false // Assume local processing is always partial until flush
      //     });
      //   }
      // }

      // PERF: crude realtime check (frames are 1024 @ 16kHz ≈ 64ms of audio)
      this._frameCount++;
      if (this._frameCount % 10 === 0 && this.performanceWatcher) {
        const elapsedMs = performance.now() - this._t0;
        const audioMs = (this._frameCount * 1024) / 16000 * 1000;
        const rtFactor = elapsedMs / audioMs; // < 1 means faster than realtime
        this.performanceWatcher({ provider: 'local', rtFactor, elapsedMs, audioMs });
      }
    };

    mic.onFrame(onFrame);
    this._stop = () => mic.offFrame(onFrame);
  }

  async stopTranscription() {
    if (this._stop) this._stop();
    this._stop = null;

    // TODO(3): Optionally flush to get final text
    // const finalText = await this.whisper.flush();
    // if (finalText) this.transcript = finalText;

    return this.transcript;
  }

  async getTranscript() {
    return this.transcript;
  }
}
