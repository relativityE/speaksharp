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

describe('#1415 P2 — retirement is token-scoped', () => {
    it('a STALE attempt cannot retire its successor', () => {
        const first = mint({ recordingId: 'rec-1' });
        mint({ recordingId: 'rec-2' });   // the user clicked again

        // The stale attempt reaches retirement too — its teardown, its failure, its late callback.
        // Unscoped, it would delete the intent the newer click just created and silently cancel a
        // recording the user is actively asking for.
        expect(retireRecordingIntent('teardown', first.token)).toBeNull();
        expect(pendingRecordingIntent()?.recordingId).toBe('rec-2');
    });

    it('an attempt CAN retire its own token', () => {
        const only = mint();
        expect(retireRecordingIntent('cancelled', only.token)).toEqual({
            token: only.token, reason: 'cancelled',
        });
        expect(pendingRecordingIntent()).toBeNull();
    });

    it('an unscoped retirement still works, for authorities that act on whatever is current', () => {
        mint();
        expect(retireRecordingIntent('teardown')?.reason).toBe('teardown');
    });
});

describe('#1415 P1 — the original caller is settled, once, at the right authority', () => {
    it('a refusal REJECTS the caller rather than leaving it hanging', async () => {
        const rejected: Error[] = [];
        mintRecordingIntent({
            recordingId: 'rec-1', policy: null, userWords: [],
            settlement: { resolve: () => { /* not this path */ }, reject: (e) => rejected.push(e) },
        });
        retireRecordingIntent('permission_denied');
        expect(rejected).toHaveLength(1);
        expect(rejected[0].message).toBe('RECORDING_INTENT_RETIRED:permission_denied');
    });

    it('a SUCCESSFUL start does not reject — the recording authority resolves separately', () => {
        const rejected: Error[] = [];
        mintRecordingIntent({
            recordingId: 'rec-1', policy: null, userWords: [],
            settlement: { resolve: () => { /* resolved by the caller */ }, reject: (e) => rejected.push(e) },
        });
        // A promise settles once. Rejecting on `started` would win the race against the resolve and
        // report a recording that is running as a failed start.
        retireRecordingIntent('started');
        expect(rejected).toHaveLength(0);
    });

    it('a REPLACED intent settles its own caller, so the first click never hangs', () => {
        const rejected: Error[] = [];
        mintRecordingIntent({
            recordingId: 'rec-1', policy: null, userWords: [],
            settlement: { resolve: () => { /* n/a */ }, reject: (e) => rejected.push(e) },
        });
        mint({ recordingId: 'rec-2' });
        expect(rejected[0]?.message).toBe('RECORDING_INTENT_REPLACED');
    });
});

describe('#1415 — a LATE failure from a superseded attempt cannot cancel its successor', () => {
    it('A prepares, B supersedes A, A fails late — B survives and can still record', () => {
        // The exact race the asynchronous download-rejection handler creates. That handler fires long
        // after its attempt stopped being current: the user clicks again, B is minted, and only THEN
        // does A's download reject. Unscoped, A's failure retires B and silently cancels a recording
        // the user is actively asking for.
        const settledA: string[] = [];
        const settledB: string[] = [];
        const a = mintRecordingIntent({
            recordingId: 'rec-A', policy: null, userWords: [],
            settlement: { resolve: () => settledA.push('resolve'), reject: (e) => settledA.push(e.message) },
        });
        const b = mintRecordingIntent({
            recordingId: 'rec-B', policy: null, userWords: [],
            settlement: { resolve: () => settledB.push('resolve'), reject: (e) => settledB.push(e.message) },
        });

        // A's delayed download failure arrives, carrying its real cause.
        const late = retireRecordingIntent('acquisition_failed', a.token, new Error('DOWNLOAD_FAILED'));

        // It retires NOTHING: A is already gone, and B is not A's to retire.
        expect(late).toBeNull();
        expect(pendingRecordingIntent()?.recordingId).toBe('rec-B');
        expect(isCurrentIntent(b.token)).toBe(true);
        // B's caller is untouched — it was neither settled nor cancelled by A.
        expect(settledB).toEqual([]);
        // A's own caller was already rejected when B replaced it; the late failure adds nothing.
        expect(settledA).toEqual(['RECORDING_INTENT_REPLACED']);

        // And B can still be claimed and started, which is the outcome the user asked for.
        expect(claimRecordingIntent()?.recordingId).toBe('rec-B');
        expect(settledB).toEqual([]);
    });

    it('the SAME late failure does settle its OWN attempt when that attempt is still current', () => {
        // Scoping must not make the handler inert: when A is still the pending intent, its failure is
        // exactly the thing that should retire it, with the real cause reaching the caller.
        const settled: string[] = [];
        const a = mintRecordingIntent({
            recordingId: 'rec-A', policy: null, userWords: [],
            settlement: { resolve: () => settled.push('resolve'), reject: (e) => settled.push(e.message) },
        });
        expect(retireRecordingIntent('acquisition_failed', a.token, new Error('DOWNLOAD_FAILED'))
            ?.reason).toBe('acquisition_failed');
        expect(pendingRecordingIntent()).toBeNull();
        expect(settled).toEqual(['DOWNLOAD_FAILED']);
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
