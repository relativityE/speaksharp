/**
 * #1304 Task 3C — audio in, exactly as the product receives it.
 *
 * The engine consumes mono 16 kHz `Float32Array` samples in [-1, 1]. Everything about a WER depends on
 * the audio being what it claims to be, so this parser refuses rather than guesses: a stereo file, a
 * different sample rate, or an unexpected encoding fails with a named reason instead of being silently
 * reinterpreted. Feeding a 44.1 kHz buffer to a 16 kHz model produces a transcript — a bad one — and
 * nothing downstream would ever say why.
 */
import { readFileSync } from 'node:fs';

export const REQUIRED_SAMPLE_RATE_HZ = 16_000;

export interface DecodedAudio {
    samples: Float32Array;
    sampleRate: number;
    seconds: number;
}

export type AudioFormatReason =
    | 'not_a_wav'
    | 'truncated_riff'
    | 'missing_fmt_chunk'
    | 'missing_data_chunk'
    | 'truncated_data_chunk'
    | 'not_pcm'
    | 'not_mono'
    | 'not_16_bit'
    | 'wrong_sample_rate'
    | 'empty_audio';

export class AudioFormatError extends Error {
    constructor(readonly reason: AudioFormatReason, detail: string) {
        super(`${reason}: ${detail}`);
        this.name = 'AudioFormatError';
    }
}

/**
 * Parse a RIFF/WAVE file by walking its chunks.
 *
 * Chunk-walking rather than assuming a 44-byte header: encoders insert `LIST`/`fact` chunks, and an
 * assumed offset would read metadata as audio — which decodes as a burst of noise at the start of
 * every clip and would look like a model problem.
 */
export function decodeWav(path: string): DecodedAudio {
    const buffer = readFileSync(path);
    if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
        throw new AudioFormatError('not_a_wav', path);
    }

    // The RIFF header declares the size of everything after it. A mismatch means the file is not the
    // file it says it is, and every duration computed from it would be wrong.
    const declaredRiffSize = buffer.readUInt32LE(4);
    if (declaredRiffSize + 8 > buffer.length) {
        throw new AudioFormatError(
            'truncated_riff',
            `RIFF declares ${declaredRiffSize + 8} bytes, file holds ${buffer.length}`,
        );
    }

    let offset = 12;
    let format: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | null = null;
    let data: Buffer | null = null;

    while (offset + 8 <= buffer.length) {
        const id = buffer.toString('ascii', offset, offset + 4);
        const size = buffer.readUInt32LE(offset + 4);
        const body = offset + 8;
        if (id === 'fmt ') {
            format = {
                audioFormat: buffer.readUInt16LE(body),
                channels: buffer.readUInt16LE(body + 2),
                sampleRate: buffer.readUInt32LE(body + 4),
                bitsPerSample: buffer.readUInt16LE(body + 14),
            };
        } else if (id === 'data') {
            // A TRUNCATED FILE IS NOT A SHORT FILE. `subarray` clamps silently, so a download that
            // stopped halfway produced a shorter clip that decoded, scored, and dragged an arm's WER
            // down for a reason nothing recorded. The declared size is the file's own claim about
            // itself; if the bytes are not there, the claim is false.
            if (body + size > buffer.length) {
                throw new AudioFormatError(
                    'truncated_data_chunk',
                    `data chunk declares ${size} bytes, file holds ${buffer.length - body}`,
                );
            }
            data = buffer.subarray(body, body + size);
        }
        // Chunks are word-aligned; an odd size carries a pad byte.
        offset = body + size + (size % 2);
    }

    if (!format) throw new AudioFormatError('missing_fmt_chunk', path);
    if (!data) throw new AudioFormatError('missing_data_chunk', path);
    if (format.audioFormat !== 1) throw new AudioFormatError('not_pcm', `audioFormat=${format.audioFormat}`);
    if (format.channels !== 1) throw new AudioFormatError('not_mono', `channels=${format.channels}`);
    if (format.bitsPerSample !== 16) throw new AudioFormatError('not_16_bit', `bits=${format.bitsPerSample}`);
    if (format.sampleRate !== REQUIRED_SAMPLE_RATE_HZ) {
        // Resampling here would hide the mismatch. The corpus and fixtures are 16 kHz by construction;
        // anything else means the wrong file was reached, which is worth failing over.
        throw new AudioFormatError('wrong_sample_rate', `${format.sampleRate} != ${REQUIRED_SAMPLE_RATE_HZ}`);
    }

    const count = Math.floor(data.length / 2);
    // Zero samples would score as an empty hypothesis on every clip — a total miss attributed to the
    // model rather than to the file.
    if (count === 0) throw new AudioFormatError('empty_audio', path);
    const samples = new Float32Array(count);
    // 16-bit signed PCM spans -32768..32767; dividing by 32768 keeps the range within [-1, 1).
    for (let i = 0; i < count; i++) samples[i] = data.readInt16LE(i * 2) / 32768;

    return { samples, sampleRate: format.sampleRate, seconds: count / format.sampleRate };
}
