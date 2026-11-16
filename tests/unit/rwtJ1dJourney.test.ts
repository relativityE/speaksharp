import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
    deepLinkExactReturnVerdict, deepLinkRenderedOwnDetailVerdict, digestOf, historyPreservedVerdict, J1D_ADMISSION_ENV, J1D_ROWS,
    J1D_SUITE, j1dCaseAssertions, type J1dObservations, j1dRunnerAdmission, j1dVerdicts, noRecordingOrSessionWriteVerdict,
    returnOwnerPreservedVerdict,
} from '../live/helpers/rwtJ1dJourney';
import { SIGNOUT_MIN_OBSERVATION_MS, type SignOutObservation } from '../live/helpers/rwtSignOutRecorder';

const plan = createRequire(import.meta.url)('../../tools/cloud-test/nightly/journey-plan.cjs') as {
    NATIVE_LEG_ROWS: Record<string, readonly string[]>;
    JOURNEY_INVOCATIONS: Record<string, { suite: string; spec: string; account: string }>;
};

const TAKE_A = digestOf('take-a');
const TAKE_B = digestOf('take-b');
const OWNER = digestOf('owner-1');
const OTHER = digestOf('owner-2');
const OFF = { recording: false, liveTracks: 0 };

const recorderPass = (): SignOutObservation => ({
    armedBeforeClick: true, priorSessions: 1, clickSeq: 5, logout: { requestSeq: 6, completedSeq: 7, status: 204 },
    windowClosed: true, requests: [], unreadHeaders: 0, observedAfterLogoutMs: SIGNOUT_MIN_OBSERVATION_MS,
    probe: { status: 401, dataRows: null },
});

/** A complete, passing J1.d observation. Each failing control below changes exactly one fact. */
const good = (over: Partial<J1dObservations> = {}): J1dObservations => ({
    knownTakeDigests: [TAKE_A, TAKE_B],
    ownerBefore: OWNER, ownerAfterReturn: OWNER,
    listedAfterReturn: [TAKE_B, TAKE_A], reopened: { [TAKE_A]: true, [TAKE_B]: true },
    micAfterSignOut: OFF,
    signOut: { logoutCompleted: true, sessionAfter: false },
    deepLink: { requested: '/session/abc?tab=review', landed: '/session/abc?tab=review' },
    rendered: { takeDigest: TAKE_A, ownerDigest: OWNER },
    requestedTakeDigest: TAKE_A,
    micAtReturnEntry: OFF, micOnDeepLink: OFF,
    writes: { recordingStarts: 0, sessionWrites: 0, windowClosed: true },
    finalSignOut: { logoutCompleted: true, sessionAfter: false },
    recorder: recorderPass(),
    ...over,
});

describe('J1.d rows are the nightly plan\'s native J1.d rows', () => {
    it('matches journey-plan NATIVE_LEG_ROWS exactly, in order', () => {
        expect([...J1D_ROWS]).toEqual([...plan.NATIVE_LEG_ROWS['J1.d']]);
    });
    it('names the J1D invocation suite, spec and reused J1.a account', () => {
        expect(plan.JOURNEY_INVOCATIONS.J1D.suite).toBe(J1D_SUITE);
        expect(plan.JOURNEY_INVOCATIONS.J1D.spec).toBe('tests/live/rwt-returning-signout.live.spec.ts');
        expect(plan.JOURNEY_INVOCATIONS.J1D.account).toBe('reuses:J1.a');
    });
});

describe('j1dRunnerAdmission', () => {
    const env = { [J1D_ADMISSION_ENV]: '/adm.json', GITHUB_RUN_ID: '99', GITHUB_RUN_ATTEMPT: '1' };
    const doc = { suite: J1D_SUITE, runId: '99', runAttempt: '1', reusesLeg: 'J1.a', lookupRef: 'rwt-journey-abcd-1234@example.test',
        knownTakeDigests: [TAKE_A, TAKE_B] };
    const admit = (d: object, e: Record<string, string | undefined> = env) => j1dRunnerAdmission(e, () => JSON.stringify(d));

    it('admits a record bound to this run, reusing J1.a, with known takes', () => {
        expect(admit(doc)).toEqual({ admitted: true, lookupRef: doc.lookupRef, knownTakeDigests: [TAKE_A, TAKE_B] });
    });
    it('never runs standalone', () => {
        expect(admit(doc, { GITHUB_RUN_ID: '99', GITHUB_RUN_ATTEMPT: '1' }).admitted).toBe(false);
    });
    it('refuses an unreadable record', () => {
        expect(j1dRunnerAdmission(env, () => '{not json').admitted).toBe(false);
        expect(j1dRunnerAdmission(env, () => { throw new Error('missing'); }).admitted).toBe(false);
    });
    it.each([
        ['another suite', { suite: 'returning-history-j1' }],
        ['another run', { runId: '98' }],
        ['another attempt', { runAttempt: '2' }],
        ['an account-create attempt (J1.d never signs up)', { createAttempt: 1 }],
        ['an account not created by J1.a', { reusesLeg: 'J1.b' }],
        ['no lookup reference', { lookupRef: undefined }],
        ['a lookup reference that is not run-owned', { lookupRef: 'maintained-free@example.test' }],
        ['no known takes', { knownTakeDigests: [] }],
        ['a take that is not a digest', { knownTakeDigests: ['take-a'] }],
        ['duplicate takes', { knownTakeDigests: [TAKE_A, TAKE_A] }],
    ])('refuses %s', (_name, over) => {
        expect(admit({ ...doc, ...over }).admitted).toBe(false);
    });
    it('refuses when the environment names no run', () => {
        expect(admit(doc, { [J1D_ADMISSION_ENV]: '/adm.json' }).admitted).toBe(false);
    });
});

describe('j1dVerdicts', () => {
    it('passes every row on complete, clean evidence', () => {
        const v = j1dVerdicts(good());
        expect(Object.keys(v)).toEqual([...J1D_ROWS]);
        for (const row of J1D_ROWS) expect([row, v[row].status]).toEqual([row, 'PASS']);
    });
    it('holds every row when nothing was observed', () => {
        const none: J1dObservations = {
            knownTakeDigests: [], ownerBefore: null, ownerAfterReturn: null, listedAfterReturn: null, reopened: null, micAfterSignOut: null,
            signOut: null, deepLink: null, rendered: null, requestedTakeDigest: null, micAtReturnEntry: null, micOnDeepLink: null, writes: null,
            finalSignOut: null, recorder: null,
        };
        const v = j1dVerdicts(none);
        for (const row of J1D_ROWS) expect([row, v[row].status]).toEqual([row, 'HOLD']);
    });
});

describe('history-preserved', () => {
    it('fails when a known take is missing after the return', () => {
        expect(historyPreservedVerdict(good({ listedAfterReturn: [TAKE_B] })).status).toBe('FAIL');
    });
    it('fails when a known take does not reopen', () => {
        expect(historyPreservedVerdict(good({ reopened: { [TAKE_A]: false, [TAKE_B]: true } })).status).toBe('FAIL');
    });
    it('holds when not every known take was reopened', () => {
        expect(historyPreservedVerdict(good({ reopened: { [TAKE_A]: true } })).status).toBe('HOLD');
    });
    it('an arbitrary nonempty list is not proof', () => {
        expect(historyPreservedVerdict(good({ listedAfterReturn: [digestOf('someone-else')] })).status).toBe('FAIL');
    });
});

describe('mic rows', () => {
    it.each([
        ['switches-mic-off', 'micAfterSignOut'], ['return-entry-mic-off', 'micAtReturnEntry'], ['deep-link-mic-off', 'micOnDeepLink'],
    ] as const)('%s fails on a live track or recording, holds when unread', (row, field) => {
        expect(j1dVerdicts(good({ [field]: { recording: false, liveTracks: 1 } }))[row].status).toBe('FAIL');
        expect(j1dVerdicts(good({ [field]: { recording: true, liveTracks: 0 } }))[row].status).toBe('FAIL');
        expect(j1dVerdicts(good({ [field]: { recording: null, liveTracks: 0 } }))[row].status).toBe('HOLD');
        expect(j1dVerdicts(good({ [field]: null }))[row].status).toBe('HOLD');
    });
});

describe('sign-out rows', () => {
    it.each([['signed-out', 'signOut'], ['return-signed-out', 'finalSignOut']] as const)('%s fails on a remaining session or failed logout', (row, field) => {
        expect(j1dVerdicts(good({ [field]: { logoutCompleted: true, sessionAfter: true } }))[row].status).toBe('FAIL');
        expect(j1dVerdicts(good({ [field]: { logoutCompleted: false, sessionAfter: false } }))[row].status).toBe('FAIL');
        expect(j1dVerdicts(good({ [field]: { logoutCompleted: true, sessionAfter: null } }))[row].status).toBe('HOLD');
    });
});

describe('return-owner-preserved', () => {
    it('fails on another owner and holds when unobserved', () => {
        expect(returnOwnerPreservedVerdict(good({ ownerAfterReturn: OTHER })).status).toBe('FAIL');
        expect(returnOwnerPreservedVerdict(good({ ownerAfterReturn: null })).status).toBe('HOLD');
    });
});

describe('no-recording-or-session-write', () => {
    it('fails on a recording start or a session write, even in an open window', () => {
        expect(noRecordingOrSessionWriteVerdict(good({ writes: { recordingStarts: 1, sessionWrites: 0, windowClosed: true } })).status).toBe('FAIL');
        expect(noRecordingOrSessionWriteVerdict(good({ writes: { recordingStarts: 0, sessionWrites: 1, windowClosed: false } })).status).toBe('FAIL');
    });
    it('holds when the window was never closed', () => {
        expect(noRecordingOrSessionWriteVerdict(good({ writes: { recordingStarts: 0, sessionWrites: 0, windowClosed: false } })).status).toBe('HOLD');
    });
});

describe('deep-link rows', () => {
    it('exact return fails on a different landing (path or query) and holds when unobserved', () => {
        expect(deepLinkExactReturnVerdict(good({ deepLink: { requested: '/session/abc?tab=review', landed: '/session/abc' } })).status).toBe('FAIL');
        expect(deepLinkExactReturnVerdict(good({ deepLink: { requested: '/session/abc', landed: '/history' } })).status).toBe('FAIL');
        expect(deepLinkExactReturnVerdict(good({ deepLink: { requested: '/session/abc', landed: null } })).status).toBe('HOLD');
    });
    it('rendered detail fails on another take or another owner', () => {
        expect(deepLinkRenderedOwnDetailVerdict(good({ rendered: { takeDigest: TAKE_B, ownerDigest: OWNER } })).status).toBe('FAIL');
        expect(deepLinkRenderedOwnDetailVerdict(good({ rendered: { takeDigest: TAKE_A, ownerDigest: OTHER } })).status).toBe('FAIL');
    });
    it('a generic detail or an unknown requested take is not proof', () => {
        expect(deepLinkRenderedOwnDetailVerdict(good({ rendered: { takeDigest: null, ownerDigest: OWNER } })).status).toBe('HOLD');
        expect(deepLinkRenderedOwnDetailVerdict(good({ requestedTakeDigest: digestOf('unknown') })).status).toBe('HOLD');
    });
});

describe('recorder rows come from the sign-out recorder', () => {
    it('hold when the recorder did not observe', () => {
        const v = j1dVerdicts(good({ recorder: null }));
        expect(v['signout-no-unauthorized-read'].status).toBe('HOLD');
        expect(v['signout-no-stale-request'].status).toBe('HOLD');
    });
    it('a probe answered 200 with no rows is not a denial', () => {
        expect(j1dVerdicts(good({ recorder: { ...recorderPass(), probe: { status: 200, dataRows: 0 } } }))['signout-no-unauthorized-read'].status).toBe('HOLD');
    });
    it('a stale request with the signed-out session fails', () => {
        const stale = { sentSeq: 8, answeredSeq: 9, method: 'GET', path: '/rest/v1/sessions', oldSession: true, status: 401, failed: false };
        expect(j1dVerdicts(good({ recorder: { ...recorderPass(), requests: [stale] } }))['signout-no-stale-request'].status).toBe('FAIL');
    });
});

describe('j1dCaseAssertions', () => {
    it('emits one native J1.d row per row, outcomes only', () => {
        const rows = j1dCaseAssertions(j1dVerdicts(good()));
        expect(rows.map((r) => r.id)).toEqual(J1D_ROWS.map((r) => `J1.d:${r}`));
        expect(rows.every((r) => r.leg === 'J1.d' && r.result === 'PASS' && Object.keys(r).length === 3)).toBe(true);
    });
});
