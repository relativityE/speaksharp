import { describe, expect, it } from 'vitest';
import { createProgressAggregator, type ProgressEvent } from '../progressAggregator';

/**
 * MAXDEPTH FIX (Part 4) regression tests.
 *
 * Root cause of "Maximum update depth exceeded" during Private base.en setup:
 * whisper-base.en is a split model, so transformers.js fires progress per file,
 * producing a non-monotonic stream that an integer-percent dedupe cannot tame.
 * The aggregator must emit a MONOTONIC non-decreasing percent regardless of the
 * per-file event ordering.
 */
describe('createProgressAggregator', () => {
    function feed(events: ProgressEvent[]): number[] {
        const agg = createProgressAggregator();
        const emitted: number[] = [];
        for (const e of events) {
            const v = agg(e);
            if (v !== null) emitted.push(v);
        }
        return emitted;
    }

    it('emits a monotonic non-decreasing stream from the verbatim oscillating trace', () => {
        // The exact raw per-file sequence captured in the failing trace.
        const raw = [0, 100, 25, 28, 100, 77, 95, 99, 100, 9, 10];
        const emitted = feed(raw.map((progress) => ({ progress })));

        // Never decreases.
        for (let i = 1; i < emitted.length; i++) {
            expect(emitted[i]).toBeGreaterThan(emitted[i - 1]);
        }
        // The raw-progress fallback path only advances; from this sequence that is 0 then 100.
        // Every backward value (25, 28, 77, 95, 99, 9, 10) is dropped — no A→B→A churn.
        expect(emitted).toEqual([0, 100]);
        expect(Math.max(...emitted)).toBe(100);
    });

    it('aggregates two split-model files by bytes into one smooth ramp', () => {
        // encoder (total 100) and decoder (total 300) downloading concurrently.
        const emitted = feed([
            { file: 'encoder_model.onnx', loaded: 0, total: 100, status: 'progress' },
            { file: 'decoder_model_merged.onnx', loaded: 0, total: 300, status: 'progress' },
            { file: 'encoder_model.onnx', loaded: 50, total: 100, status: 'progress' }, // 50/400
            { file: 'decoder_model_merged.onnx', loaded: 150, total: 300, status: 'progress' }, // 200/400
            { file: 'encoder_model.onnx', loaded: 100, total: 100, status: 'done' }, // 250/400
            { file: 'decoder_model_merged.onnx', loaded: 300, total: 300, status: 'done' }, // 400/400
        ]);

        for (let i = 1; i < emitted.length; i++) {
            expect(emitted[i]).toBeGreaterThan(emitted[i - 1]);
        }
        expect(emitted[emitted.length - 1]).toBe(100); // reaches exactly 100 at completion
        expect(emitted[0]).toBeGreaterThanOrEqual(0);
    });

    it('holds (does not regress) when a newly-initiated file enlarges the denominator', () => {
        const agg = createProgressAggregator();
        // First file alone reaches 100% of the (then-known) total.
        expect(agg({ file: 'encoder_model.onnx', loaded: 100, total: 100, status: 'done' })).toBe(100);
        // Second file appears, total jumps to 200 → true aggregate dips to 50%, but we HOLD.
        expect(agg({ file: 'decoder_model_merged.onnx', loaded: 0, total: 100, status: 'progress' })).toBeNull();
        expect(agg({ file: 'decoder_model_merged.onnx', loaded: 50, total: 100, status: 'progress' })).toBeNull();
        // Only once real progress exceeds the held 100 would it advance — which never happens
        // past 100, so it correctly stays pinned at 100.
        expect(agg({ file: 'decoder_model_merged.onnx', loaded: 100, total: 100, status: 'done' })).toBeNull();
    });

    it('ignores cache-warm re-reports of an already-complete file', () => {
        const agg = createProgressAggregator();
        expect(agg({ file: 'encoder_model.onnx', loaded: 100, total: 100, status: 'done' })).toBe(100);
        // Warm re-init re-reports the same completed file: must not emit a backward/duplicate value.
        expect(agg({ file: 'encoder_model.onnx', loaded: 0, total: 100, status: 'progress' })).toBeNull();
        expect(agg({ file: 'encoder_model.onnx', loaded: 100, total: 100, status: 'done' })).toBeNull();
    });

    it('clamps out-of-range values and skips events with no usable signal', () => {
        const agg = createProgressAggregator();
        expect(agg({})).toBeNull(); // no file, no progress
        expect(agg({ status: 'initiate', file: 'x.onnx' })).toBeNull(); // no total yet
        expect(agg({ progress: 150 })).toBe(100); // clamped
        expect(agg({ progress: 200 })).toBeNull(); // already at 100, no advance
    });
});
