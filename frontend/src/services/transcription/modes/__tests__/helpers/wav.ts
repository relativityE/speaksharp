/**
 * Minimal PCM16 WAV decoder + framer for replaying REAL audio through the PrivateWhisper gate.
 * Reusable tooling (#891): the same decoder ingests a synthesized soft-onset fixture OR a captured
 * real take, so validation never depends on a live mic.
 */

export interface DecodedWav {
  samples: Float32Array; // mono, [-1, 1]
  sampleRate: number;
  durationSec: number;
}

function readChunkId(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/** Decode a 16-bit PCM WAV (mono or stereo) to mono Float32. */
export function decodeWavToFloat32(buffer: ArrayBuffer): DecodedWav {
  const view = new DataView(buffer);
  if (readChunkId(view, 0) !== 'RIFF' || readChunkId(view, 8) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }

  let numChannels = 1;
  let sampleRate = 16000;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataLength = 0;

  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = readChunkId(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      numChannels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === 'data') {
      dataOffset = body;
      dataLength = size;
    }
    offset = body + size + (size % 2); // chunks are word-aligned
  }

  if (dataOffset < 0) throw new Error('no data chunk');
  if (bitsPerSample !== 16) throw new Error(`only PCM16 supported, got ${bitsPerSample}-bit`);

  const bytesPerSample = 2;
  const frameStep = bytesPerSample * numChannels;
  const frameCount = Math.floor(dataLength / frameStep);
  const out = new Float32Array(frameCount);

  for (let i = 0; i < frameCount; i++) {
    // Average channels to mono.
    let acc = 0;
    for (let ch = 0; ch < numChannels; ch++) {
      const s = view.getInt16(dataOffset + i * frameStep + ch * bytesPerSample, true);
      acc += s / 32768;
    }
    out[i] = acc / numChannels;
  }

  return { samples: out, sampleRate, durationSec: frameCount / sampleRate };
}

/** Split samples into fixed-size frames (the mic delivers ~frameSize chunks). */
export function framesFromSamples(samples: Float32Array, frameSize: number): Float32Array[] {
  const frames: Float32Array[] = [];
  for (let i = 0; i < samples.length; i += frameSize) {
    frames.push(samples.slice(i, Math.min(i + frameSize, samples.length)));
  }
  return frames;
}

/** RMS of a segment — used to locate the first speech sample (the "opening"). */
export function segmentRms(samples: Float32Array, start: number, end: number): number {
  let sum = 0;
  const a = Math.max(0, start);
  const b = Math.min(samples.length, end);
  for (let i = a; i < b; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, b - a));
}
