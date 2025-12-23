import { describe, it, expect } from 'vitest';
import {
    floatToInt16,
    floatToWav,
    concatenateFloat32Arrays,
    AudioBuffer
} from '../utils/AudioProcessor';

describe('AudioProcessor', () => {
    describe('floatToInt16', () => {
        it('should convert Float32Array to Int16Array', () => {
            const input = new Float32Array([0, 0.5, -0.5, 1, -1]);
            const output = floatToInt16(input);

            expect(output).toBeInstanceOf(Int16Array);
            expect(output.length).toBe(5);
        });

        it('should map 0 to 0', () => {
            const input = new Float32Array([0]);
            const output = floatToInt16(input);
            expect(output[0]).toBe(0);
        });

        it('should map 1 to max positive (32767)', () => {
            const input = new Float32Array([1]);
            const output = floatToInt16(input);
            expect(output[0]).toBe(32767);
        });

        it('should map -1 to max negative (-32767)', () => {
            const input = new Float32Array([-1]);
            const output = floatToInt16(input);
            expect(output[0]).toBe(-32767);
        });

        it('should clamp values beyond range', () => {
            const input = new Float32Array([2, -2]);
            const output = floatToInt16(input);
            expect(output[0]).toBe(32767); // clamped
            expect(output[1]).toBe(-32768); // clamped
        });
    });

    describe('floatToWav', () => {
        it('should generate valid WAV header', () => {
            const samples = new Float32Array([0, 0.5, -0.5]);
            const wav = floatToWav(samples);

            // Check RIFF header
            const riff = String.fromCharCode(wav[0], wav[1], wav[2], wav[3]);
            expect(riff).toBe('RIFF');

            // Check WAVE format
            const wave = String.fromCharCode(wav[8], wav[9], wav[10], wav[11]);
            expect(wave).toBe('WAVE');
        });

        it('should have correct file size', () => {
            const samples = new Float32Array(100);
            const wav = floatToWav(samples);

            // Header (44 bytes) + samples (100 * 2 bytes)
            expect(wav.length).toBe(44 + 200);
        });

        it('should use specified sample rate', () => {
            const samples = new Float32Array([0]);
            const wav = floatToWav(samples, 44100);

            // Sample rate at bytes 24-27 (little endian)
            const view = new DataView(wav.buffer);
            expect(view.getUint32(24, true)).toBe(44100);
        });

        it('should default to 16kHz sample rate', () => {
            const samples = new Float32Array([0]);
            const wav = floatToWav(samples);

            const view = new DataView(wav.buffer);
            expect(view.getUint32(24, true)).toBe(16000);
        });
    });

    describe('concatenateFloat32Arrays', () => {
        it('should concatenate multiple arrays', () => {
            const arr1 = new Float32Array([1, 2]);
            const arr2 = new Float32Array([3, 4, 5]);
            const result = concatenateFloat32Arrays([arr1, arr2]);

            expect(result.length).toBe(5);
            expect(Array.from(result)).toEqual([1, 2, 3, 4, 5]);
        });

        it('should handle empty array input', () => {
            const result = concatenateFloat32Arrays([]);
            expect(result.length).toBe(0);
        });

        it('should handle single array', () => {
            const arr = new Float32Array([1, 2, 3]);
            const result = concatenateFloat32Arrays([arr]);
            expect(Array.from(result)).toEqual([1, 2, 3]);
        });
    });

    describe('AudioBuffer', () => {
        it('should accumulate samples until threshold', () => {
            const buffer = new AudioBuffer(100);

            const small = new Int16Array(50);
            expect(buffer.addSamples(small)).toBeNull();

            const more = new Int16Array(60);
            const result = buffer.addSamples(more);
            expect(result).not.toBeNull();
            expect(result!.length).toBe(110);
        });

        it('should clear buffer after returning data', () => {
            const buffer = new AudioBuffer(50);

            buffer.addSamples(new Int16Array(60));
            const second = buffer.addSamples(new Int16Array(60));

            expect(second).not.toBeNull();
            expect(second!.length).toBe(60); // Only the second batch
        });

        it('should flush remaining samples', () => {
            const buffer = new AudioBuffer(100);
            buffer.addSamples(new Int16Array(30));

            const flushed = buffer.flush();
            expect(flushed.length).toBe(30);
        });

        it('should clear buffer', () => {
            const buffer = new AudioBuffer(100);
            buffer.addSamples(new Int16Array(50));
            buffer.clear();

            const flushed = buffer.flush();
            expect(flushed.length).toBe(0);
        });
    });
});
