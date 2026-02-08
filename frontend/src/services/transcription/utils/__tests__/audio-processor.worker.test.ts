import { describe, it, expect } from 'vitest';
import { floatToInt16, floatToWav, downsampleAudio, writeString as workerWriteString } from '../audio-processor.worker';

describe('audio-processor.worker', () => {
    describe('floatToInt16', () => {
        it('should convert Float32Array to Int16Array correctly', () => {
            const floatArray = new Float32Array([0, 1, -1, 0.5, -0.5]);
            const result = floatToInt16(floatArray);

            expect(result).toBeInstanceOf(Int16Array);
            expect(result.length).toBe(floatArray.length);
            expect(result[0]).toBe(0);
            expect(result[1]).toBe(32767);
            expect(result[2]).toBe(-32767);
            expect(result[3]).toBe(Math.floor(0.5 * 32767));
        });
    });

    describe('downsampleAudio', () => {
        it('should return the same array if sample rates match', () => {
            const audio = new Float32Array([1, 2, 3]);
            const result = downsampleAudio(audio, 16000, 16000);
            expect(result).toBe(audio);
        });

        it('should downsample by half correctly', () => {
            const audio = new Float32Array([1, 2, 3, 4, 5, 6]);
            const result = downsampleAudio(audio, 32000, 16000);
            expect(result.length).toBe(3);
            expect(result[0]).toBe(1);
            expect(result[1]).toBe(3);
            expect(result[2]).toBe(5);
        });
    });

    describe('floatToWav', () => {
        it('should generate a valid WAV buffer with correct headers', () => {
            const samples = new Float32Array([0.1, -0.1]);
            const result = floatToWav(samples, 16000);

            expect(result).toBeInstanceOf(Uint8Array);
            expect(result.length).toBe(44 + samples.length * 2);

            // RIFF header
            expect(String.fromCharCode(result[0], result[1], result[2], result[3])).toBe('RIFF');
            // WAVE header
            expect(String.fromCharCode(result[8], result[9], result[10], result[11])).toBe('WAVE');
            // fmt header
            expect(String.fromCharCode(result[12], result[13], result[14], result[15])).toBe('fmt ');
            // data header
            expect(String.fromCharCode(result[36], result[37], result[38], result[39])).toBe('data');
        });
    });

    describe('writeString', () => {
        it('should correctly write characters to DataView', () => {
            const buffer = new ArrayBuffer(4);
            const view = new DataView(buffer);
            workerWriteString(view, 0, 'abcd');

            expect(view.getUint8(0)).toBe('a'.charCodeAt(0));
            expect(view.getUint8(1)).toBe('b'.charCodeAt(0));
            expect(view.getUint8(2)).toBe('c'.charCodeAt(0));
            expect(view.getUint8(3)).toBe('d'.charCodeAt(0));
        });
    });
});
