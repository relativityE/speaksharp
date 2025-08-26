/**
 * A simple AudioWorkletProcessor to downsample audio from the microphone.
 * It receives audio from the microphone (at the hardware's native sample rate)
 * and sends back buffers of 16-bit PCM audio at the target sample rate.
 */
class PcmDownsampler extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetSampleRate = options.processorOptions.targetSampleRate || 16000;
    this.frameSize = options.processorOptions.frameSize || 1024;
    this.sourceSampleRate = sampleRate; // sampleRate is a global in AudioWorkletGlobalScope

    this.resamplingRatio = this.sourceSampleRate / this.targetSampleRate;

    // Buffer to hold incoming audio data until we have enough to process
    this.inputBuffer = [];
    this.inputBufferSize = 0;

    // Buffer to hold downsampled audio data
    this.outputBuffer = new Float32Array(this.frameSize);
    this.outputBufferIndex = 0;
  }

  /**
   * This method is called for every block of 128 samples.
   * @param {Float32Array[][]} inputs - An array of inputs, each with an array of channels.
   *                                    We only process the first input and first channel.
   * @returns {boolean} - Must return true to keep the node alive.
   */
  process(inputs) {
    const inputChannel = inputs[0][0];

    // If there's no input, there's nothing to do.
    if (!inputChannel) {
      return true;
    }

    // Naive down-sampling by simply picking samples.
    // This is not high quality, but it's simple and fast.
    let inputIndex = 0;
    while (inputIndex < inputChannel.length) {
      // Add the next sample from the input to our output buffer
      this.outputBuffer[this.outputBufferIndex] = inputChannel[inputIndex];
      this.outputBufferIndex++;

      // If the output buffer is full, send it to the main thread
      if (this.outputBufferIndex === this.frameSize) {
        this.port.postMessage(this.outputBuffer);
        // Reset the buffer index
        this.outputBufferIndex = 0;
      }

      // Move the input index by the resampling ratio
      inputIndex += this.resamplingRatio;
    }

    return true; // Keep the processor alive
  }
}

registerProcessor('pcm-downsampler', PcmDownsampler);
