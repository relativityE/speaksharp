import { vi, describe, it, expect, beforeEach } from 'vitest';
import { analyticsBuffer } from '../../AnalyticsBuffer';
import {
    emitRetentionObservation, RETENTION_POLICY_VERSION, RETENTION_COPY_VERSION,
} from '../retentionObservation';
import { projectEventProps } from '../../telemetryAllowlist';
import { stripEnvelopeKeys } from '../envelope';
import { beginJourney, __resetJourneyIdentityForTests } from '../journeyIdentity';
import posthog from 'posthog-js';

vi.mock('posthog-js', () => ({
    default: { capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), reloadFeatureFlags: vi.fn() },
}));
vi.mock('@sentry/react', () => ({ setUser: vi.fn(), captureException: vi.fn() }));

const rows = () => (posthog.capture as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .filter((c) => c[0] === 'retention_observation').map((c) => c[1] as Record<string, unknown>);
const drain = () => analyticsBuffer.push('session_started', { mode: 'private' }, 'CRITICAL');

beforeEach(() => {
    vi.clearAllMocks();
    __resetJourneyIdentityForTests();
    analyticsBuffer.queue.length = 0;
    analyticsBuffer.ready = true;
    beginJourney();
});

describe('F10 — the policy, the copy, and what the client can see', () => {
    it('THE LIVE SESSION: two readable transcripts are recorded as an observation', () => {
        emitRetentionObservation({
            transcriptBearingBefore: 2, transcriptBearingAfter: null,
            contentFreeHistoryCount: 5, savedTranscriptState: null,
        });
        drain();
        expect(rows()[0].transcript_bearing_before).toBe(2);
        // Content-free history surviving is the other half of the retention contract.
        expect(rows()[0].content_free_history_count).toBe(5);
    });

    it('records policy and copy versions SEPARATELY — their disagreement is the finding', () => {
        emitRetentionObservation({
            transcriptBearingBefore: 2, transcriptBearingAfter: 1,
            contentFreeHistoryCount: 5, savedTranscriptState: 'available',
        });
        drain();
        const r = rows()[0];
        expect(r.policy_version).toBe(RETENTION_POLICY_VERSION);
        expect(r.copy_version).toBe(RETENTION_COPY_VERSION);
        // Two fields, not one. Collapsing them makes the mismatch unrepresentable, and the mismatch is
        // exactly what the PO saw: copy promising one transcript beside a list holding two.
        expect(Object.keys(r)).toContain('policy_version');
        expect(Object.keys(r)).toContain('copy_version');
    });

    it('an UNOBSERVED after-count yields a null expiry, never a flattering zero', () => {
        emitRetentionObservation({
            transcriptBearingBefore: 2, transcriptBearingAfter: null,
            contentFreeHistoryCount: 5, savedTranscriptState: null,
        });
        drain();
        // "We did not observe" must not read as "nothing expired" — that is the more flattering of the
        // two readings and the one that would hide a policy which never ran.
        expect(rows()[0].expired_count).toBeNull();
    });

    it('computes the expiry only when BOTH counts were observed', () => {
        emitRetentionObservation({
            transcriptBearingBefore: 3, transcriptBearingAfter: 1,
            contentFreeHistoryCount: 9, savedTranscriptState: 'available',
        });
        drain();
        // 3 before, 1 after, and this save added one: 3 - 1 + 1 = 3 expired.
        expect(rows()[0].expired_count).toBe(3);
    });

    it('never reports a negative expiry', () => {
        emitRetentionObservation({
            transcriptBearingBefore: 0, transcriptBearingAfter: 5,
            contentFreeHistoryCount: 5, savedTranscriptState: 'available',
        });
        drain();
        expect(rows()[0].expired_count).toBe(0);
    });

    it('carries no session id and no transcript', () => {
        emitRetentionObservation({
            transcriptBearingBefore: 2, transcriptBearingAfter: 1,
            contentFreeHistoryCount: 5, savedTranscriptState: 'expired',
        });
        drain();
        // The envelope's own `journey_id` IS a UUID, deliberately — it is minted in the tab and is not
        // the database session id. Asserting over the whole payload would flag it, so the producer's
        // fields are checked on their own, which is where a session id could actually leak in.
        const producerProps = stripEnvelopeKeys(rows()[0]);
        const serialized = JSON.stringify(producerProps);
        expect(serialized).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);   // no session UUID
        expect(serialized).not.toMatch(/[a-z]{5,}\s[a-z]{5,}/i);     // no prose
        // ...and the envelope's id is a correlation key, not the row identifier the database holds.
        expect(rows()[0].journey_id).toBeTruthy();
        expect(producerProps).not.toHaveProperty('journey_id');
    });

    it('every field survives the schema, and an invented state does not', () => {
        expect(projectEventProps('retention_observation', {
            policy_version: 'newest-two', copy_version: 'newest-two',
            transcript_bearing_before: 2, transcript_bearing_after: 1, expired_count: 2,
            content_free_history_count: 5, saved_transcript_state: 'available',
        }).dropped).toEqual([]);
        expect(projectEventProps('retention_observation', {
            saved_transcript_state: 'probably_fine',
        }).dropped).toContain('saved_transcript_state');
    });
});
