// src/services/transcription/utils/audio-processor.worklet.js
class PCMDownsampler extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { targetSampleRate = 16000, frameSize = 1024 } = options.processorOptions || {};
    this.targetRate = targetSampleRate;
    this.frameSize = frameSize;
    this.inputRate = sampleRate; // worklet's sampleRate (typically 48k)
    this._buf = [];
    this._ratio = this.inputRate / this.targetRate;
  }

  static get parameterDescriptors() { return []; }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const ch0 = input[0]; // mono mix if needed
    // Naive downsample (good enough for STT); you can swap for polyphase later
    for (let i = 0; i < ch0.length; i += this._ratio) {
      this._buf.push(ch0[Math.floor(i)] || 0);
      if (this._buf.length >= this.frameSize) {
        const out = new Float32Array(this._buf.slice(0, this.frameSize));
        this.port.postMessage(out);
        this._buf.length = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-downsampler', PCMDownsampler);
