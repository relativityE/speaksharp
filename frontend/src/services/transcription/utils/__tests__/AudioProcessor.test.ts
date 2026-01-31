import { describe, it, expect, beforeEach } from 'vitest';
import {
    floatToInt16,
    floatToWav,
    concatenateFloat32Arrays,
    AudioBuffer,
    downsampleAudio
} from '../AudioProcessor';

/**
 * AudioProcessor Behavioral Tests
 * 
 * Primary Risk: Audio conversion corruption leading to garbled transcription
 * Minimal Test Set: Verify each conversion function produces correct output format
 */

describe('floatToInt16', () => {
    it('converts Float32 samples to Int16 range', () => {
        const input = new Float32Array([0, 0.5, 1.0, -1.0, -0.5]);
        const result = floatToInt16(input);

        expect(result).toBeInstanceOf(Int16Array);
        expect(result.length).toBe(5);
        expect(result[0]).toBe(0);                 // 0 stays 0
        expect(result[1]).toBeCloseTo(16383, -1);  // 0.5 → ~16384
        expect(result[2]).toBe(32767);             // 1.0 → max
        expect(result[3]).toBe(-32767);            // -1.0 → min (clamped)
    });

    it('clamps values outside -1 to 1 range', () => {
        const input = new Float32Array([2.0, -2.0]);
        const result = floatToInt16(input);

        expect(result[0]).toBe(32767);   // Clamped to max
        expect(result[1]).toBe(-32768);  // Clamped to min
    });
});

describe('floatToWav', () => {
    it('creates valid WAV header', () => {
        const samples = new Float32Array(100);
        const result = floatToWav(samples, 16000);

        expect(result).toBeInstanceOf(Uint8Array);
        // WAV header is 44 bytes + samples * 2 bytes
        expect(result.length).toBe(44 + 100 * 2);

        // Check RIFF header
        const header = String.fromCharCode(...result.slice(0, 4));
        expect(header).toBe('RIFF');

        // Check WAVE format
        const format = String.fromCharCode(...result.slice(8, 12));
        expect(format).toBe('WAVE');
    });

    it('uses provided sample rate', () => {
        const samples = new Float32Array(10);
        const result = floatToWav(samples, 44100);

        // Sample rate is at bytes 24-27 (little endian)
        const view = new DataView(result.buffer);
        expect(view.getUint32(24, true)).toBe(44100);
    });
});

describe('concatenateFloat32Arrays', () => {
    it('concatenates multiple arrays', () => {
        const a1 = new Float32Array([1, 2]);
        const a2 = new Float32Array([3, 4, 5]);
        const a3 = new Float32Array([6]);

        const result = concatenateFloat32Arrays([a1, a2, a3]);

        expect(result).toEqual(new Float32Array([1, 2, 3, 4, 5, 6]));
        expect(result.length).toBe(6);
    });

    it('handles empty array input', () => {
        const result = concatenateFloat32Arrays([]);
        expect(result).toEqual(new Float32Array(0));
    });

    it('handles single array', () => {
        const input = new Float32Array([1, 2, 3]);
        const result = concatenateFloat32Arrays([input]);
        expect(result).toEqual(input);
    });
});

describe('AudioBuffer', () => {
    let buffer: AudioBuffer;

    beforeEach(() => {
        buffer = new AudioBuffer(100); // 100 samples minimum
    });

    it('accumulates samples until threshold', () => {
        const samples50 = new Int16Array(50);
        const result1 = buffer.addSamples(samples50);
        expect(result1).toBeNull(); // Under threshold

        const samples60 = new Int16Array(60);
        const result2 = buffer.addSamples(samples60);
        expect(result2).toBeInstanceOf(Int16Array);
        expect(result2?.length).toBe(110); // 50 + 60
    });

    it('flush returns remaining samples', () => {
        const samples = new Int16Array(30);
        buffer.addSamples(samples);

        const flushed = buffer.flush();
        expect(flushed.length).toBe(30);

        // Buffer should be empty after flush
        const flushed2 = buffer.flush();
        expect(flushed2.length).toBe(0);
    });

    it('clear empties the buffer', () => {
        buffer.addSamples(new Int16Array(50));
        buffer.clear();

        const flushed = buffer.flush();
        expect(flushed.length).toBe(0);
    });
});

describe('downsampleAudio', () => {
    it('returns original if sample rates match', () => {
        const input = new Float32Array([1, 2, 3]);
        const result = downsampleAudio(input, 16000, 16000);
        expect(result).toBe(input); // Same reference
    });

    it('throws error for upsampling', () => {
        const input = new Float32Array([1, 2, 3]);
        expect(() => downsampleAudio(input, 8000, 16000)).toThrow('Upsampling is not supported');
    });

    it('downsamples 48kHz to 16kHz (3:1 ratio)', () => {
        // 12 samples at 48kHz → 4 samples at 16kHz
        const input = new Float32Array([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1]);
        const result = downsampleAudio(input, 48000, 16000);

        expect(result.length).toBe(4);
        // First sample should be 0 (no interpolation needed at position 0)
        expect(result[0]).toBeCloseTo(0, 5);
    });

    it('uses linear interpolation', () => {
        // Simple ramp for easy verification
        const input = new Float32Array([0, 0.5, 1.0]);
        const result = downsampleAudio(input, 30000, 10000);

        // 3:1 ratio, should have 1 sample
        expect(result.length).toBe(1);
        expect(result[0]).toBeCloseTo(0, 5);
    });
});
