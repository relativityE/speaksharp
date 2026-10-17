import { describe, it, expect, vi, beforeEach } from 'vitest';
import { projectEventProps, GOVERNED_EVENTS } from '../telemetryAllowlist';
import { buildEnvelope } from '../telemetry/envelope';
import { CANDIDATES, identityOf } from '../transcription/candidateRegistry';

const push = vi.fn();
vi.mock('@/services/AnalyticsBuffer', () => ({ analyticsBuffer: { push: (...args: unknown[]) => push(...args) } }));

const { recordingInterruptedProps, trackRecordingInterrupted } = await import('../recordingInterruptionTelemetry');

const NOW = Date.parse('2026-10-01T12:00:00.000Z');
const draft = (over: Record<string, unknown> = {}) => ({
    recoveryState: 'active_interrupted' as const, product: 'open_mic' as const, mode: 'private' as const,
    durationSeconds: 49.6, savedAt: '2026-10-01T11:58:20.000Z', ...over,
}) as never;

beforeEach(() => push.mockReset());

/** #1258 flight recorder (PO 2026-10-01): a take that was never durably finalized or saved is visible in Production telemetry. */
describe('recording_interrupted', () => {
    it('an interrupted draft produces closed, content-free fields that survive projection unchanged', () => {
        const props = recordingInterruptedProps(draft(), NOW);
        expect(props).toEqual({ product: 'open_mic', mode: 'private', take_seconds: 50, heartbeat_age_seconds: 100 });
        const { props: kept, dropped } = projectEventProps('recording_interrupted', props as Record<string, unknown>);
        expect(dropped).toEqual([]);
        expect(kept).toEqual(props);
        expect(GOVERNED_EVENTS).toContain('recording_interrupted');
    });

    it('a FINALIZED draft completed finalization: it is not unresolved and emits nothing', () => {
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
            { product: 'open_mic', mode: 'private', take_seconds: 50, heartbeat_age_seconds: 100 }, 'LOW', false);
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

    it('#1553 P1 r4161804844 RED on fa5c399c7: no model attribution — the draft holds no verified engine identity', () => {
        trackRecordingInterrupted(draft(), NOW);
        // The 4th argument is modelAttributionVerified. Fed to the real envelope builder WITH an engine loaded in this
        // page (the ambient state the finding describes), it must still name no model.
        expect(push.mock.calls[0][3]).toBe(false);
        const envelope = buildEnvelope(
            { engineMetadata: { candidateId: 'v2:base.en', modelIdentity: identityOf(CANDIDATES['v2:base.en']) } },
            push.mock.calls[0][3] as boolean,
        );
        expect({ candidate_id: envelope.candidate_id, engine: envelope.engine, runtime_version: envelope.runtime_version, asset_digest: envelope.asset_digest })
            .toEqual({ candidate_id: null, engine: null, runtime_version: null, asset_digest: null });
    });

    it('#1553 P1 r4161804850: a page lost AFTER Stop (finalization pending) yields the same event — no Stop/phase claim', () => {
        // The controller rewrites the draft as finalized only late in the stop path, so a post-Stop crash leaves this
        // same active_interrupted draft. The event must not carry anything asserting where in the take it ended.
        const props = recordingInterruptedProps(draft(), NOW)!;
        expect(Object.keys(props).sort()).toEqual(['heartbeat_age_seconds', 'mode', 'product', 'take_seconds']);
        expect(Object.keys(props).some((k) => /stop|phase|stage|reached/i.test(k))).toBe(false);
    });
});
