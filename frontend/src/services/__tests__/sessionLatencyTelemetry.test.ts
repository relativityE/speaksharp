import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyticsBuffer } from '../AnalyticsBuffer';
import {
    beginSessionReviewLatency,
    beginSessionSaveLatency,
    beginSessionStartLatency,
    SESSION_LATENCY_EVENTS,
} from '../sessionLatencyTelemetry';

describe('#1428 F-15/F-16 — session latency telemetry', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('measures initialization from the declared start boundary and emits only closed, content-free fields', () => {
        const ticks = [100.2, 142.8];
        const push = vi.spyOn(analyticsBuffer, 'push').mockImplementation(() => undefined);
        const measurement = beginSessionStartLatency('private', 'cold', () => ticks.shift() ?? 0);

        expect(measurement.settle('recording_started')).toBe(43);
        expect(push).toHaveBeenCalledWith(SESSION_LATENCY_EVENTS.START, {
            duration_ms: 43,
            mode: 'private',
            outcome: 'recording_started',
            model_cache_state: 'cold',
        });
        expect(Object.keys(push.mock.calls[0][1] ?? {}).sort()).toEqual([
            'duration_ms',
            'mode',
            'model_cache_state',
            'outcome',
        ]);
    });

    it('measures save and review as separate Stop boundaries', () => {
        const saveTicks = [500, 900];
        const reviewTicks = [500, 1734.4, 9999];
        const push = vi.spyOn(analyticsBuffer, 'push').mockImplementation(() => undefined);
        const save = beginSessionSaveLatency('private', () => saveTicks.shift() ?? 0);
        const review = beginSessionReviewLatency('private', () => reviewTicks.shift() ?? 0);

        expect(save.settle('saved')).toBe(400);
        expect(review.settle('available')).toBe(1234);
        expect(review.settle('unavailable')).toBeNull();
        expect(push).toHaveBeenCalledTimes(2);
        expect(push).toHaveBeenCalledWith(SESSION_LATENCY_EVENTS.SAVE, {
            duration_ms: 400,
            mode: 'private',
            outcome: 'saved',
        });
        expect(push).toHaveBeenCalledWith(SESSION_LATENCY_EVENTS.REVIEW, {
            duration_ms: 1234,
            mode: 'private',
            outcome: 'available',
        });
    });

    it('distinguishes cached starts and keeps invalid clocks representable without a verdict', () => {
        const push = vi.spyOn(analyticsBuffer, 'push').mockImplementation(() => undefined);
        const backwards = beginSessionStartLatency('private', 'cached', (() => {
            const ticks = [20, 10];
            return () => ticks.shift() ?? 0;
        })());
        const invalid = beginSessionSaveLatency('private', (() => {
            const ticks = [20, Number.NaN];
            return () => ticks.shift() ?? 0;
        })());

        expect(backwards.settle('failed')).toBe(0);
        expect(invalid.settle('failed')).toBe(0);
        expect(push).toHaveBeenCalledWith(SESSION_LATENCY_EVENTS.START, expect.objectContaining({
            model_cache_state: 'cached',
        }));
        for (const [, props] of push.mock.calls) {
            expect(props).not.toHaveProperty('passed');
            expect(props).not.toHaveProperty('threshold_ms');
            expect(props).not.toHaveProperty('target_ms');
        }
    });

    it('never changes recording behavior when the telemetry transport throws', () => {
        vi.spyOn(analyticsBuffer, 'push').mockImplementation(() => { throw new Error('transport down'); });
        const measurement = beginSessionStartLatency('private', 'cold', (() => {
            const ticks = [1, 11];
            return () => ticks.shift() ?? 0;
        })());

        expect(() => measurement.settle('recording_started')).not.toThrow();
    });
});
