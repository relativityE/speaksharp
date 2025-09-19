/* globals sampleRate */

// Extend the global scope to include AudioWorkletGlobalScope properties
declare const sampleRate: number;
declare function registerProcessor(name: string, constructor: new (options: any) => AudioWorkletProcessor): void;

interface PcmDownsamplerOptions {
  processorOptions: {
    targetSampleRate: number;
  };
}

/**
 * An AudioWorkletProcessor for downsampling audio to a target sample rate.
 * This implementation uses a simple averaging algorithm to resample the audio,
 * which is a significant improvement over naive sample dropping.
 */
class PcmDownsampler extends AudioWorkletProcessor {
  private targetSampleRate: number;
  private sourceSampleRate: number;
  private resamplingRatio: number;
  private unprocessedSamples: Float32Array;

  constructor(options: PcmDownsamplerOptions) {
    super();
    this.targetSampleRate = options.processorOptions.targetSampleRate || 16000;
    this.sourceSampleRate = sampleRate; // `sampleRate` is a global in AudioWorkletGlobalScope

    // Calculate the ratio and initialize buffer for unprocessed samples
    this.resamplingRatio = this.sourceSampleRate / this.targetSampleRate;
    this.unprocessedSamples = new Float32Array(0);
  }

  /**
   * This method is called for every block of 128 audio samples.
   * @param {Float32Array[][]} inputs - The input audio data.
   * @returns {boolean} - Must return true to keep the processor alive.
   */
  process(inputs: Float32Array[][]): boolean {
    const inputChannel = inputs[0][0];

    // If there's no input, there's nothing to do.
    if (!inputChannel) {
      return true;
    }

    // Combine unprocessed samples from the previous block with the new input
    const currentSamples = new Float32Array(this.unprocessedSamples.length + inputChannel.length);
    currentSamples.set(this.unprocessedSamples, 0);
    currentSamples.set(inputChannel, this.unprocessedSamples.length);

    // Calculate how many full output samples we can produce
    const numOutputSamples = Math.floor(currentSamples.length / this.resamplingRatio);
    if (numOutputSamples === 0) {
      // Not enough samples to produce an output frame, buffer them for the next block
      this.unprocessedSamples = currentSamples;
      return true;
    }

    const outputData = new Float32Array(numOutputSamples);
    for (let i = 0; i < numOutputSamples; i++) {
      const startIndex = Math.floor(i * this.resamplingRatio);
      const endIndex = Math.floor((i + 1) * this.resamplingRatio);

      let sum = 0;
      for (let j = startIndex; j < endIndex; j++) {
        sum += currentSamples[j];
      }
      outputData[i] = sum / (endIndex - startIndex);
    }

    // Save any remaining samples that didn't form a full output sample
    const processedSamplesCount = Math.floor(numOutputSamples * this.resamplingRatio);
    this.unprocessedSamples = currentSamples.slice(processedSamplesCount);

    // Send the downsampled audio back to the main thread
    this.port.postMessage(outputData);

    return true; // Keep the processor alive
  }
}

registerProcessor('pcm-downsampler', PcmDownsampler);
