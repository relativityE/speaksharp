import { vi, describe, it, expect, beforeEach } from 'vitest';
import { analyticsBuffer } from '../../AnalyticsBuffer';
import { emitFinalizeBreakdown } from '../finalizeBreakdown';
import { projectEventProps } from '../../telemetryAllowlist';
import { beginJourney, __resetJourneyIdentityForTests } from '../journeyIdentity';
import posthog from 'posthog-js';

vi.mock('posthog-js', () => ({
    default: { capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), reloadFeatureFlags: vi.fn() },
}));
vi.mock('@sentry/react', () => ({ setUser: vi.fn(), captureException: vi.fn() }));

const rows = () => (posthog.capture as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .filter((c) => c[0] === 'stage_latency').map((c) => c[1] as Record<string, unknown>);
// A read well after every stop below began, so the elapsed bound never decides these cases.
const NOW = 100_000;
const drain = () => analyticsBuffer.push('session_started', { mode: 'private' }, 'CRITICAL');

beforeEach(() => {
    vi.clearAllMocks();
    __resetJourneyIdentityForTests();
    analyticsBuffer.queue.length = 0;
    analyticsBuffer.ready = true;
    beginJourney();
});

describe('finalize breakdown inside recording_terminated', () => {
    it('splits a fresh Whisper stop into wait, prep and decode rows', () => {
        const n = emitFinalizeBreakdown(
            { finalizeWaitMs: 812.4, finalizePrepMs: 40, finalizeDecodeMs: 12_900, updatedAtMs: 5_000 }, 1_000, 'private', NOW);
        drain();
        expect(n).toBe(3);
        expect(rows().map((r) => [r.stage, r.duration_ms])).toEqual([
            ['stop_finalize_wait', 812], ['stop_finalize_prep', 40], ['stop_finalize_decode', 12_900],
        ]);
    });

    it('drops a summary published before this stop began (an earlier take)', () => {
        expect(emitFinalizeBreakdown(
            { finalizeWaitMs: 500, finalizePrepMs: 10, finalizeDecodeMs: 4_000, updatedAtMs: 999 }, 1_000, 'private', NOW)).toBe(0);
        drain();
        expect(rows()).toEqual([]);
    });

    it('sends nothing for an unmeasured interval, never a made-up zero', () => {
        expect(emitFinalizeBreakdown(
            { finalizeWaitMs: 300, finalizePrepMs: null, finalizeDecodeMs: null, updatedAtMs: 2_000 }, 1_000, 'private', NOW)).toBe(1);
        drain();
        expect(rows().map((r) => r.stage)).toEqual(['stop_finalize_wait']);
    });

    it('keeps a genuinely measured zero', () => {
        expect(emitFinalizeBreakdown(
            { finalizeWaitMs: 0, finalizePrepMs: 0, finalizeDecodeMs: 900, updatedAtMs: 2_000 }, 1_000, 'private', NOW)).toBe(3);
        drain();
        expect(rows().map((r) => [r.stage, r.duration_ms])).toEqual([
            ['stop_finalize_wait', 0], ['stop_finalize_prep', 0], ['stop_finalize_decode', 900],
        ]);
    });

    it('sends nothing when the stopping engine is not Private Whisper, even with a fresh summary', () => {
        const fresh = { finalizeWaitMs: 5, finalizePrepMs: 5, finalizeDecodeMs: 5, updatedAtMs: 2_000 };
        expect(emitFinalizeBreakdown(fresh, 1_000, 'mock', NOW)).toBe(0);
        expect(emitFinalizeBreakdown(fresh, 1_000, null, NOW)).toBe(0);
        drain();
        expect(rows()).toEqual([]);
    });

    it('sends only stage and a rounded duration, nothing else', () => {
        emitFinalizeBreakdown(
            { finalizeWaitMs: 1.6, finalizePrepMs: null, finalizeDecodeMs: null, updatedAtMs: 2_000 }, 1_000, 'private', NOW);
        drain();
        expect(rows()).toHaveLength(1);
        expect(rows()[0]).toMatchObject({ stage: 'stop_finalize_wait', duration_ms: 2 });
        // The allowlist would strip anything beyond stage and duration_ms, such as transcript text.
        const projected = projectEventProps('stage_latency', { stage: 'stop_finalize_wait', duration_ms: 2, text: 'hello' });
        expect(Object.keys(projected.props).sort()).toEqual(['duration_ms', 'stage']);
        expect(projected.dropped).toContain('text');
    });

    it('sends nothing without a summary or a stop anchor', () => {
        expect(emitFinalizeBreakdown(null, 1_000, 'private', NOW)).toBe(0);
        expect(emitFinalizeBreakdown(
            { finalizeWaitMs: 1, finalizePrepMs: 1, finalizeDecodeMs: 1, updatedAtMs: 2 }, null, 'private', NOW)).toBe(0);
    });

    it('drops a summary whose intervals could not fit inside this stop (a timed-out take still decoding)', () => {
        // Stop began at 1_000 and is read at 6_000: 5s elapsed. A summary claiming 4s of wait plus 240s of
        // decode was measured over some other, longer stop, even though it was published after this one began.
        expect(emitFinalizeBreakdown(
            { finalizeWaitMs: 4_000, finalizePrepMs: 20, finalizeDecodeMs: 240_000, updatedAtMs: 5_500 }, 1_000, 'private', 6_000)).toBe(0);
        drain();
        expect(rows()).toEqual([]);
    });

    it('keeps a summary that fills the whole elapsed stop, allowing for the 0.1ms rounding', () => {
        // 5_000ms elapsed; the three published (rounded) values add up to 5_000.3.
        expect(emitFinalizeBreakdown(
            { finalizeWaitMs: 100.1, finalizePrepMs: 0.1, finalizeDecodeMs: 4_900.1, updatedAtMs: 5_900 }, 1_000, 'private', 6_000)).toBe(3);
        drain();
        expect(rows().map((r) => r.stage)).toEqual(['stop_finalize_wait', 'stop_finalize_prep', 'stop_finalize_decode']);
    });

    it('sends nothing when there is no clock to bound the stop by', () => {
        expect(emitFinalizeBreakdown(
            { finalizeWaitMs: 1, finalizePrepMs: 1, finalizeDecodeMs: 1, updatedAtMs: 2_000 }, 1_000, 'private', null)).toBe(0);
    });

    it('the allowlist accepts the three new stages', () => {
        for (const stage of ['stop_finalize_wait', 'stop_finalize_prep', 'stop_finalize_decode']) {
            const projected = projectEventProps('stage_latency', { stage, duration_ms: 10 });
            expect(projected.props).toMatchObject({ stage, duration_ms: 10 });
            expect(projected.dropped).toEqual([]);
        }
    });
});
