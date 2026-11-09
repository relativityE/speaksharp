// @vitest-environment node
/** Work point 2: the reliability corpus builder binds each reference to exactly the audio written. */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { clipRecord, wavFromPcm, LONG_FORM_TARGETS, MAX_TAKE_SECONDS, SAMPLE_RATE_HZ } from '../../../scripts/corpus/make-reliability-corpus.mjs';

const pcmOf = (samples: number) => Buffer.alloc(samples * 2, 1);
const part = (id: string, samples: number, reference: string) =>
    ({ id, reference, flac: `/c/LibriSpeech/test-clean/1/2/${id}.flac`, pcm: pcmOf(samples), sampleCount: samples });

describe('reliability corpus builder', () => {
    it('writes a 16 kHz mono 16-bit WAV whose data is exactly the joined PCM', () => {
        const pcm = pcmOf(3);
        const wav = wavFromPcm(pcm);
        expect(wav.length).toBe(44 + 6);
        expect(wav.readUInt32LE(24)).toBe(SAMPLE_RATE_HZ);
        expect(wav.readUInt16LE(22)).toBe(1);
        expect(wav.readUInt16LE(34)).toBe(16);
        expect(wav.readUInt32LE(40)).toBe(6);
        expect(wav.subarray(44)).toEqual(pcm);
    });
    it('binds the reference, in order, to the exact sample count and PCM digest, and records each utterance', () => {
        const parts = [part('u1', 16_000, 'HELLO THERE'), part('u2', 8_000, 'GENERAL KENOBI')];
        const wav = wavFromPcm(Buffer.concat(parts.map(p => p.pcm)));
        const record = clipRecord('rel-x', 'rel-x.wav', wav, parts, '/c');
        expect(record.reference).toBe('HELLO THERE GENERAL KENOBI');
        expect(record.audio).toMatchObject({ sampleRateHz: 16_000, sampleCount: 24_000, durationSeconds: 1.5,
            pcmSha256: createHash('sha256').update(wav.subarray(44)).digest('hex') });
        expect(record.source.utterances).toEqual([{ id: 'u1', sampleCount: 16_000 }, { id: 'u2', sampleCount: 8_000 }]);
    });
    it('refuses audio whose sample count is not the sum of its utterances (no silent crop or padding)', () => {
        const parts = [part('u1', 16_000, 'HELLO')];
        expect(() => clipRecord('rel-x', 'rel-x.wav', wavFromPcm(pcmOf(15_999)), parts, '/c')).toThrow(/sample count/);
    });
    it('plans long-form clips that fit the maximum take', () => {
        for (const t of LONG_FORM_TARGETS) {
            expect(t.minSeconds).toBeLessThan(t.maxSeconds);
            expect(t.maxSeconds).toBeLessThanOrEqual(MAX_TAKE_SECONDS);
        }
    });
});
