/**
 * #1304 Task 3C — the audio path refuses rather than guesses.
 *
 * Everything about a WER depends on the audio being what it claims to be. A 44.1 kHz buffer handed to
 * a 16 kHz model still produces a transcript — a bad one — and every number downstream would be wrong
 * with nothing to indicate why. So the loader fails on a mismatch instead of reinterpreting it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeWav, AudioFormatError, REQUIRED_SAMPLE_RATE_HZ } from '../audio';

/** Build a RIFF/WAVE file, optionally with an extra chunk before `data`. */
function makeWav({
    sampleRate = REQUIRED_SAMPLE_RATE_HZ,
    channels = 1,
    bitsPerSample = 16,
    audioFormat = 1,
    samples = [0, 16384, -16384, 32767],
    extraChunk = false,
}: Partial<{
    sampleRate: number; channels: number; bitsPerSample: number; audioFormat: number;
    samples: number[]; extraChunk: boolean;
}> = {}): Buffer {
    const data = Buffer.alloc(samples.length * 2);
    samples.forEach((s, i) => data.writeInt16LE(s, i * 2));

    const fmt = Buffer.alloc(16);
    fmt.writeUInt16LE(audioFormat, 0);
    fmt.writeUInt16LE(channels, 2);
    fmt.writeUInt32LE(sampleRate, 4);
    fmt.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 8);
    fmt.writeUInt16LE(channels * (bitsPerSample / 8), 12);
    fmt.writeUInt16LE(bitsPerSample, 14);

    const chunks: Buffer[] = [Buffer.from('fmt '), sizeOf(fmt), fmt];
    if (extraChunk) {
        // A `LIST` chunk between `fmt ` and `data` — exactly what breaks a parser that assumes the
        // audio begins at byte 44.
        // ODD length on purpose. RIFF chunks are word-aligned, so an odd body carries a pad byte; a
        // parser that forgets it walks off by one and finds no `data` chunk at all. An even-sized
        // chunk here would exercise nothing.
        const list = Buffer.from('INFOhello world');
        chunks.push(Buffer.from('LIST'), sizeOf(list), list);
        // A real RIFF writer emits the pad byte after an odd body. Omitting it here made the FIXTURE
        // malformed rather than testing the parser — the parser skipped a byte the file did not have,
        // and the failure looked like a parser bug. The declared size stays odd; the file is aligned.
        if (list.length % 2 === 1) chunks.push(Buffer.alloc(1));
    }
    chunks.push(Buffer.from('data'), sizeOf(data), data);

    const body = Buffer.concat(chunks);
    const header = Buffer.alloc(12);
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(4 + body.length, 4);
    header.write('WAVE', 8, 'ascii');
    return Buffer.concat([header, body]);
}
const sizeOf = (b: Buffer) => { const s = Buffer.alloc(4); s.writeUInt32LE(b.length); return s; };

let dir: string;
const write = (name: string, buffer: Buffer) => { const p = join(dir, name); writeFileSync(p, buffer); return p; };

beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'cert-audio-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

describe('a well-formed 16 kHz mono PCM file decodes', () => {
    it('produces float samples in [-1, 1] and the right duration', () => {
        const audio = decodeWav(write('ok.wav', makeWav()));
        expect(audio.sampleRate).toBe(REQUIRED_SAMPLE_RATE_HZ);
        expect(audio.samples).toHaveLength(4);
        expect(audio.seconds).toBeCloseTo(4 / REQUIRED_SAMPLE_RATE_HZ, 10);
        expect(Array.from(audio.samples).every((s) => s >= -1 && s <= 1)).toBe(true);
        // 16-bit signed spans -32768..32767, so the scale is 32768 — using 32767 would push the
        // negative rail past -1 and clip on exactly the loudest samples.
        expect(audio.samples[1]).toBeCloseTo(0.5, 10);
        expect(audio.samples[2]).toBeCloseTo(-0.5, 10);
    });

    it('honours RIFF word alignment on an ODD-sized chunk', () => {
        const buffer = makeWav({ extraChunk: true });
        // The precondition: without an odd body there is no pad byte and this proves nothing.
        const listSize = buffer.readUInt32LE(buffer.indexOf(Buffer.from('LIST')) + 4);
        expect(listSize % 2).toBe(1);
        expect(decodeWav(write('odd.wav', buffer)).samples).toHaveLength(4);
    });

    it('walks chunks rather than assuming audio starts at byte 44', () => {
        // An encoder-inserted LIST chunk shifts the data. A parser using a fixed offset reads metadata
        // as audio — a burst of noise at the start of every clip that looks like a model problem.
        const audio = decodeWav(write('extra.wav', makeWav({ extraChunk: true })));
        expect(audio.samples).toHaveLength(4);
        expect(audio.samples[1]).toBeCloseTo(0.5, 10);
    });
});

describe('a mismatch is REFUSED, never reinterpreted', () => {
    /** Returns the refusal reason, so each test asserts it at its own call site. */
    const refusalReason = (name: string, buffer: Buffer): string => {
        const path = write(name, buffer);
        try {
            decodeWav(path);
        } catch (error) {
            if (error instanceof AudioFormatError) return error.reason;
            return `threw the wrong error type: ${String(error)}`;
        }
        return 'DECODED — no refusal';
    };

    it('a 44.1 kHz file fails instead of being silently resampled', () => {
        expect(refusalReason('44k.wav', makeWav({ sampleRate: 44_100 }))).toBe('wrong_sample_rate');
    });

    it('a stereo file fails instead of having one channel guessed', () => {
        expect(refusalReason('stereo.wav', makeWav({ channels: 2 }))).toBe('not_mono');
    });

    it('non-16-bit and non-PCM encodings fail', () => {
        expect(refusalReason('f32.wav', makeWav({ bitsPerSample: 32 }))).toBe('not_16_bit');
        expect(refusalReason('alaw.wav', makeWav({ audioFormat: 6 }))).toBe('not_pcm');
    });

    it('a file that is not a WAV at all fails', () => {
        expect(refusalReason('nope.wav', Buffer.from('this is not a riff file'))).toBe('not_a_wav');
    });

    it('a WAV with no data chunk fails rather than returning silence', () => {
        // Zero samples would score as an empty hypothesis on every clip — a total miss attributed to
        // the model rather than to the file.
        const fmt = makeWav();
        const truncated = fmt.subarray(0, fmt.indexOf(Buffer.from('data')));
        const header = Buffer.alloc(12);
        header.write('RIFF', 0, 'ascii');
        header.writeUInt32LE(truncated.length - 8, 4);
        header.write('WAVE', 8, 'ascii');
        expect(refusalReason('nodata.wav', Buffer.concat([header, truncated.subarray(12)])))
            .toBe('missing_data_chunk');
    });
});

describe('a TRUNCATED file is refused, not quietly shortened (blocker 4)', () => {
    const refusalReason = (name: string, buffer: Buffer): string => {
        const path = write(name, buffer);
        try {
            decodeWav(path);
        } catch (error) {
            if (error instanceof AudioFormatError) return error.reason;
            return `threw the wrong error type: ${String(error)}`;
        }
        return 'DECODED — no refusal';
    };

    const longWav = () => makeWav({ samples: Array.from({ length: 400 }, (_, i) => (i % 200) - 100) });

    it('a file cut short mid-data fails on the RIFF size — the outer check catches it first', () => {
        // `subarray` CLAMPS. A download that stopped halfway used to decode, score, and drag an arm's
        // WER down for a reason nothing recorded — the clip was simply shorter than its transcript.
        // Layered like the archive chain: the cheapest check fires first, and it is enough here.
        const full = longWav();
        // Cut RELATIVE to the file's own length. A fixed byte offset was wrong: this fixture is only
        // ~844 bytes, so "cut at 900" removed nothing and the file decoded perfectly.
        const cut = full.subarray(0, Math.floor(full.length * 0.6));
        expect(cut.length).toBeLessThan(full.length);
        expect(refusalReason('cut.wav', cut)).toBe('truncated_riff');
    });

    it('a data chunk over-declaring inside a CONSISTENT RIFF still fails', () => {
        // The case the outer check cannot see: the file's overall size is honest, but the data chunk
        // claims more bytes than follow it. Without this, the inner check would never run.
        const buffer = longWav();
        const dataAt = buffer.indexOf(Buffer.from('data'));
        buffer.writeUInt32LE(buffer.readUInt32LE(dataAt + 4) + 64, dataAt + 4);
        expect(refusalReason('overdeclared.wav', buffer)).toBe('truncated_data_chunk');
    });

    it('the SAME file untruncated decodes — so the refusal is about the cut, not the fixture', () => {
        expect(decodeWav(write('uncut.wav', longWav())).samples).toHaveLength(400);
    });

    it('a RIFF header claiming more than the file holds fails', () => {
        const buffer = makeWav();
        buffer.writeUInt32LE(buffer.length * 4, 4);
        expect(refusalReason('bigriff.wav', buffer)).toBe('truncated_riff');
    });

    it('a data chunk of zero length is refused rather than scored as silence', () => {
        // Zero samples score as an empty hypothesis on every clip — a total miss attributed to the
        // model rather than to the file.
        expect(refusalReason('silent.wav', makeWav({ samples: [] }))).toBe('empty_audio');
    });

    it('the committed fixtures pass the truncation checks', () => {
        // A regression here would mean the checks are too strict, not that the fixtures are broken.
        expect(decodeWav('tests/fixtures/corpus-longform/long-01.wav').samples.length).toBeGreaterThan(0);
        expect(decodeWav('tests/fixtures/stt-isomorphic/audio/h1_1.wav').samples.length).toBeGreaterThan(0);
    });
});

describe('the committed fixtures decode as the branches they are meant to exercise', () => {
    it('the long-form fixture is over 30s and the short one is under', () => {
        // If these ever stopped straddling the window, the certification controls would silently prove
        // one branch twice.
        expect(decodeWav('tests/fixtures/corpus-longform/long-01.wav').seconds).toBeGreaterThan(30);
        expect(decodeWav('tests/fixtures/stt-isomorphic/audio/h1_1.wav').seconds).toBeLessThan(30);
    });
});
