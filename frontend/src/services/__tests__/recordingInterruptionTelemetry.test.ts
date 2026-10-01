import { describe, it, expect, vi, beforeEach } from 'vitest';
import { projectEventProps, GOVERNED_EVENTS } from '../telemetryAllowlist';

const push = vi.fn();
vi.mock('@/services/AnalyticsBuffer', () => ({ analyticsBuffer: { push: (...args: unknown[]) => push(...args) } }));

const { recordingInterruptedProps, trackRecordingInterrupted } = await import('../recordingInterruptionTelemetry');

const NOW = Date.parse('2026-10-01T12:00:00.000Z');
const draft = (over: Record<string, unknown> = {}) => ({
    recoveryState: 'active_interrupted' as const, product: 'open_mic' as const, mode: 'private' as const,
    durationSeconds: 49.6, savedAt: '2026-10-01T11:58:20.000Z', ...over,
}) as never;

beforeEach(() => push.mockReset());

/** #1258 flight recorder (PO 2026-10-01): a take that never reached Stop/save is visible in Production telemetry. */
describe('recording_interrupted', () => {
    it('an interrupted draft produces closed, content-free fields that survive projection unchanged', () => {
        const props = recordingInterruptedProps(draft(), NOW);
        expect(props).toEqual({ product: 'open_mic', mode: 'private', take_seconds: 50, heartbeat_age_seconds: 100 });
        const { props: kept, dropped } = projectEventProps('recording_interrupted', props as Record<string, unknown>);
        expect(dropped).toEqual([]);
        expect(kept).toEqual(props);
        expect(GOVERNED_EVENTS).toContain('recording_interrupted');
    });

    it('a FINALIZED draft reached Stop: it is not an interruption and emits nothing', () => {
        expect(recordingInterruptedProps(draft({ recoveryState: 'finalized_pending_save' }), NOW)).toBeNull();
        trackRecordingInterrupted(draft({ recoveryState: 'finalized_pending_save' }), NOW);
        expect(push).not.toHaveBeenCalled();
    });

    it('unknown product/mode collapse to "unknown"; a missing or future heartbeat time is omitted, never a wrong age', () => {
        expect(recordingInterruptedProps(draft({ product: null, mode: 'mock' }), NOW)).toMatchObject({ product: 'unknown', mode: 'unknown' });
        expect(recordingInterruptedProps(draft({ savedAt: 'not-a-date' }), NOW)).not.toHaveProperty('heartbeat_age_seconds');
        expect(recordingInterruptedProps(draft({ savedAt: '2026-10-01T12:05:00.000Z' }), NOW)).not.toHaveProperty('heartbeat_age_seconds');
        expect(recordingInterruptedProps(draft({ durationSeconds: Number.NaN }), NOW)).toMatchObject({ take_seconds: 0 });
    });

    it('the producer pushes exactly one governed event at LOW priority', () => {
        trackRecordingInterrupted(draft(), NOW);
        expect(push).toHaveBeenCalledTimes(1);
        expect(push).toHaveBeenCalledWith('recording_interrupted',
            { product: 'open_mic', mode: 'private', take_seconds: 50, heartbeat_age_seconds: 100 }, 'LOW');
    });

    it('CASUALTY: identity, metrics or content smuggled onto the event are dropped at projection', () => {
        const { props, dropped } = projectEventProps('recording_interrupted', {
            product: 'open_mic', mode: 'private', take_seconds: 50, heartbeat_age_seconds: 100,
            session_id: 'sess-1', transcript: 'um so I was saying', total_words: 120, user_id: 'u-1',
        });
        expect(dropped.sort()).toEqual(['session_id', 'total_words', 'transcript', 'user_id']);
        expect(props).toEqual({ product: 'open_mic', mode: 'private', take_seconds: 50, heartbeat_age_seconds: 100 });
        expect(projectEventProps('recording_interrupted', { take_seconds: -1, heartbeat_age_seconds: 9e9 }).props).toEqual({});
    });
});
