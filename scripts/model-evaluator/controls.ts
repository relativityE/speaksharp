import { sha256 } from './source-binding';

export type AudioControl = {
  kind: 'mute' | 'prefix-250ms';
  sourcePcmSha256: string;
};

/** A real audio intervention, applied identically to both arms before dispatch and output-hash validation. */
export function prepareControlInput(pcm: Float32Array, expectedSha256: string, control?: AudioControl): Float32Array {
  const hash = (input: Float32Array) => sha256(Buffer.from(input.buffer, input.byteOffset, input.byteLength));
  let output = pcm;
  if (control) {
    if (hash(pcm) !== control.sourcePcmSha256) throw new Error('control_source_pcm_digest_mismatch');
    if (control.kind === 'mute') output = new Float32Array(pcm.length);
    else if (control.kind === 'prefix-250ms') output = pcm.slice(0, Math.min(pcm.length, 4000));
    else throw new Error('unsupported_audio_control');
  }
  if (hash(output) !== expectedSha256) throw new Error('PCM digest mismatch');
  return output;
}
