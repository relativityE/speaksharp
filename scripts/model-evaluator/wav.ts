/** Strict PCM16 mono 16 kHz fixture reader; no resampling or timing-dependent playback. */
export function decodeWav16kMono(bytes: Buffer): Float32Array {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('fixture is not RIFF/WAVE');
  }
  let offset = 12;
  let format: { audioFormat: number; channels: number; sampleRate: number; bits: number } | null = null;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > bytes.length) throw new Error('truncated WAV chunk');
    if (id === 'fmt ') {
      if (size < 16) throw new Error('short WAV fmt chunk');
      format = {
        audioFormat: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2),
        sampleRate: bytes.readUInt32LE(start + 4), bits: bytes.readUInt16LE(start + 14),
      };
    }
    if (id === 'data') {
      if (dataOffset !== -1) throw new Error('multiple WAV data chunks');
      dataOffset = start; dataSize = size;
    }
    offset = start + size + (size % 2);
  }
  if (!format || format.audioFormat !== 1 || format.channels !== 1 ||
      format.sampleRate !== 16_000 || format.bits !== 16 || dataOffset < 0 ||
      dataSize === 0 || dataSize % 2 !== 0) {
    throw new Error('fixture must be PCM16 mono 16 kHz with nonempty data');
  }
  const audio = new Float32Array(dataSize / 2);
  for (let index = 0; index < audio.length; index += 1) {
    audio[index] = bytes.readInt16LE(dataOffset + index * 2) / 32768;
  }
  return audio;
}
