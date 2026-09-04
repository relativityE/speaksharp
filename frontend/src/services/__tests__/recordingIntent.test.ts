import { describe, it, expect, beforeEach } from 'vitest';
import {
    mintRecordingIntent, claimRecordingIntent, retireRecordingIntent,
    pendingRecordingIntent, lastRetiredIntent, isCurrentIntent,
    __resetRecordingIntentForTests,
} from '../recordingIntent';

const mint = (over: Partial<Parameters<typeof mintRecordingIntent>[0]> = {}) =>
    mintRecordingIntent({ recordingId: 'rec-1', policy: null, userWords: [], ...over });

beforeEach(() => __resetRecordingIntentForTests());

describe('#1415 — exactly-once is a property of the CLAIM', () => {
    it('a second claim finds nothing — this is what prevents two recordings from one click', () => {
        mint();
        expect(claimRecordingIntent()).not.toBeNull();
        // Readiness can be signalled more than once: a duplicate transition, a late callback from a
        // superseded attempt, a retry re-reaching READY. If claiming only READ the intent, each of
        // those would start a recording, and one click would become several.
        expect(claimRecordingIntent()).toBeNull();
        expect(pendingRecordingIntent()).toBeNull();
    });

    it('claiming leaves nothing behind even when the caller ignores the result', () => {
        mint();
        claimRecordingIntent();
        expect(pendingRecordingIntent()).toBeNull();
    });

    it('a STALE holder cannot claim a newer intent', () => {
        const first = mint({ recordingId: 'rec-1' });
        mint({ recordingId: 'rec-2' });   // the user clicked again
        // The late holder of the first token must not start the second recording on its behalf.
        expect(claimRecordingIntent(first.token)).toBeNull();
        expect(pendingRecordingIntent()?.recordingId).toBe('rec-2');
    });

    it('a token-scoped claim succeeds only for the CURRENT intent', () => {
        const only = mint();
        expect(claimRecordingIntent(only.token)?.recordingId).toBe('rec-1');
    });
});

describe('#1415 — supersession and retirement carry an explicit reason', () => {
    it('a second click SUPERSEDES the first rather than queueing a second recording', () => {
        const first = mint({ recordingId: 'rec-1' });
        const second = mint({ recordingId: 'rec-2' });
        expect(second.token).not.toBe(first.token);
        expect(lastRetiredIntent()).toEqual({ token: first.token, reason: 'replaced' });
        expect(isCurrentIntent(first.token)).toBe(false);
        expect(isCurrentIntent(second.token)).toBe(true);
    });

    it('every retirement path states WHY, so a refusal can be explained to the user', () => {
        for (const reason of ['cancelled', 'permission_denied', 'acquisition_failed',
            'navigated', 'teardown', 'superseded'] as const) {
            const i = mint();
            expect(retireRecordingIntent(reason)).toEqual({ token: i.token, reason });
            expect(pendingRecordingIntent()).toBeNull();
        }
    });

    it('retiring nothing is not an error — teardown paths run more than once', () => {
        expect(retireRecordingIntent('teardown')).toBeNull();
    });

    it('a claim records that it STARTED, distinct from any refusal', () => {
        mint();
        claimRecordingIntent();
        expect(lastRetiredIntent()?.reason).toBe('started');
    });
});

describe('#1415 — the resumption is bounded', () => {
    it('a fresh click is not a resumption', () => {
        expect(mint().resumed).toBe(false);
    });

    it('an intent created BY a resumption says so, which is what bounds it', () => {
        // Without this flag a start that reaches READY, is refused for preparation again, and re-arms
        // preparation would try forever — a spinner the user can never escape, which is worse than the
        // silent idle this work removes.
        expect(mint({ resumed: true }).resumed).toBe(true);
    });
});
