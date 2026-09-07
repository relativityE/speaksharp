import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyticsBuffer } from '../AnalyticsBuffer';
import {
    beginSessionInitializationLatency,
    beginSessionStopLatency,
    SESSION_LATENCY_EVENTS,
} from '../sessionLatencyTelemetry';

describe('#1428 F-15/F-16 — session latency telemetry', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('measures initialization from the declared start boundary and emits only closed, content-free fields', () => {
        const ticks = [100.2, 142.8];
        const push = vi.spyOn(analyticsBuffer, 'push').mockImplementation(() => undefined);
        const measurement = beginSessionInitializationLatency('private', () => ticks.shift() ?? 0);

        expect(measurement.settle('recording_started')).toBe(43);
        expect(push).toHaveBeenCalledWith(SESSION_LATENCY_EVENTS.INITIALIZATION, {
            duration_ms: 43,
            mode: 'private',
            outcome: 'recording_started',
        });
        expect(Object.keys(push.mock.calls[0][1] ?? {}).sort()).toEqual(['duration_ms', 'mode', 'outcome']);
    });

    it('measures Stop through the review/save decision and settles exactly once', () => {
        const ticks = [500, 1734.4, 9999];
        const push = vi.spyOn(analyticsBuffer, 'push').mockImplementation(() => undefined);
        const measurement = beginSessionStopLatency('private', () => ticks.shift() ?? 0);

        expect(measurement.settle('review_ready')).toBe(1234);
        expect(measurement.settle('failed')).toBeNull();
        expect(push).toHaveBeenCalledTimes(1);
        expect(push).toHaveBeenCalledWith(SESSION_LATENCY_EVENTS.STOP_TO_REVIEW_SAVE, {
            duration_ms: 1234,
            mode: 'private',
            outcome: 'review_ready',
        });
    });

    it('keeps invalid clock output representable without introducing a performance verdict', () => {
        const push = vi.spyOn(analyticsBuffer, 'push').mockImplementation(() => undefined);
        const backwards = beginSessionInitializationLatency('private', (() => {
            const ticks = [20, 10];
            return () => ticks.shift() ?? 0;
        })());
        const invalid = beginSessionStopLatency('private', (() => {
            const ticks = [20, Number.NaN];
            return () => ticks.shift() ?? 0;
        })());

        expect(backwards.settle('failed')).toBe(0);
        expect(invalid.settle('failed')).toBe(0);
        for (const [, props] of push.mock.calls) {
            expect(props).not.toHaveProperty('passed');
            expect(props).not.toHaveProperty('threshold_ms');
            expect(props).not.toHaveProperty('target_ms');
        }
    });

    it('never changes recording behavior when the telemetry transport throws', () => {
        vi.spyOn(analyticsBuffer, 'push').mockImplementation(() => { throw new Error('transport down'); });
        const measurement = beginSessionInitializationLatency('private', (() => {
            const ticks = [1, 11];
            return () => ticks.shift() ?? 0;
        })());

        expect(() => measurement.settle('recording_started')).not.toThrow();
    });
});
