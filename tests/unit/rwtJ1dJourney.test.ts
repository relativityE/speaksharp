// @vitest-environment node
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
    JOURNEY_INVOCATIONS: Record<string, { suite: string; spec: string; account: string; worker?: string }>;
};

const TAKE_A = digestOf('take-a');
const TAKE_B = digestOf('take-b');
const OWNER = digestOf('owner-1');
const OTHER = digestOf('owner-2');
const OFF = { recording: false, liveTracks: 0 };

const recorderPass = (): SignOutObservation => ({
    armedBeforeClick: true, priorSessions: 1, clickSeq: 5, logout: { requestSeq: 6, completedSeq: 7, status: 204 },
    windowClosed: true, requests: [], unreadHeaders: 0, observedAfterLogoutMs: SIGNOUT_MIN_OBSERVATION_MS,
    probe: { status: 401, dataRows: null, wellFormed: null, boundToTake: true, observed: true, anonymous: true },
    pairedControl: { ownerReadBefore: true, ownerReopenedAfter: true },
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
    it('names the J1D suite, and runs in J1.a\'s worker, spec and account (Sam 1a)', () => {
        expect(plan.JOURNEY_INVOCATIONS.J1D.suite).toBe(J1D_SUITE);
        expect(plan.JOURNEY_INVOCATIONS.J1D.spec).toBe('tests/live/rwt-open-mic-first-session.live.spec.ts');
        expect(plan.JOURNEY_INVOCATIONS.J1D.worker).toBe('J1.a');
        expect(plan.JOURNEY_INVOCATIONS.J1D.account).toBe('reuses:J1.a');
    });
});

describe('j1dRunnerAdmission', () => {
    const env = { [J1D_ADMISSION_ENV]: '/adm.json', GITHUB_RUN_ID: '99', GITHUB_RUN_ATTEMPT: '1' };
    const doc = { suite: J1D_SUITE, runId: '99', runAttempt: '1', reusesLeg: 'J1.a', lookupRef: 'rwt-journey-abcd-1234@example.test' };
    const admit = (d: object, e: Record<string, string | undefined> = env) => j1dRunnerAdmission(e, () => JSON.stringify(d));

    it('admits a record bound to this run, reusing J1.a', () => {
        expect(admit(doc)).toEqual({ admitted: true, lookupRef: doc.lookupRef });
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
    it('Sam 2b: an anonymous 200 [] on the exact take passes only with the paired control', () => {
        const empty = { status: 200, dataRows: 0, wellFormed: true, boundToTake: true, observed: true, anonymous: true };
        const row = (r: SignOutObservation) => j1dVerdicts(good({ recorder: r }))['signout-no-unauthorized-read'].status;
        expect(row({ ...recorderPass(), probe: empty })).toBe('PASS');
        expect(row({ ...recorderPass(), probe: empty, pairedControl: { ownerReadBefore: false, ownerReopenedAfter: true } })).toBe('HOLD');
        expect(row({ ...recorderPass(), probe: { ...empty, anonymous: false } })).toBe('HOLD');
        expect(row({ ...recorderPass(), probe: { ...empty, dataRows: 1 } })).toBe('FAIL');
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

describe('Codex #1883: write classification matches full RPC paths, not the truncated route', () => {
    it('counts session-writing RPCs and the recording lease, which routeOf() would collapse to /rest/v1/rpc', async () => {
        const { classifyJourneyWrite } = await import('../live/helpers/rwtJ1dJourney');
        expect(classifyJourneyWrite('POST', '/rest/v1/rpc/create_session_and_update_usage')).toBe('session-write');
        expect(classifyJourneyWrite('POST', '/rest/v1/rpc/heartbeat_session')).toBe('session-write');
        expect(classifyJourneyWrite('POST', '/rest/v1/rpc/acquire_recording_lease')).toBe('recording-start');
        expect(classifyJourneyWrite('PATCH', '/rest/v1/sessions')).toBe('session-write');
        expect(classifyJourneyWrite('DELETE', '/rest/v1/sessions/extra')).toBe('session-write');
    });
    it('reads and unrelated RPCs are not writes', async () => {
        const { classifyJourneyWrite } = await import('../live/helpers/rwtJ1dJourney');
        expect(classifyJourneyWrite('GET', '/rest/v1/sessions')).toBeNull();
        expect(classifyJourneyWrite('POST', '/rest/v1/rpc/get_analytics_summary')).toBeNull();
        expect(classifyJourneyWrite('POST', '/rest/v1/rpc')).toBeNull();
    });
});

describe('Codex #1883: the reopened take is judged from the loaded review id, never visibility alone', () => {
    const fakePage = (ids: Array<string | null>) => {
        let i = 0;
        return {
            getByTestId: () => ({ first: () => ({ getAttribute: async () => ids[Math.min(i++, ids.length - 1)] }) }),
            waitForTimeout: async () => undefined,
        };
    };
    it('waits through the loading render (no id yet) for the loaded id', async () => {
        const { loadedReviewSessionId } = await import('../live/helpers/rwtJ1dJourney');
        expect(await loadedReviewSessionId(fakePage([null, null, 'take-a']) as never, 5_000)).toBe('take-a');
    });
    it('Codex #1883: keeps polling for the whole deadline when each read returns at once (a 30 s load still counts)', async () => {
        const { loadedReviewSessionId } = await import('../live/helpers/rwtJ1dJourney');
        let t = 0;
        let reads = 0;
        const page = {
            getByTestId: () => ({ first: () => ({ getAttribute: async () => { reads += 1; return t >= 30_000 ? 'take-a' : null; } }) }),
            waitForTimeout: async (ms: number) => { t += ms; },
        };
        expect(await loadedReviewSessionId(page as never, 45_000, () => t)).toBe('take-a');
        expect(reads).toBeGreaterThan(100);
    });
    it('stops at the deadline, not before', async () => {
        const { loadedReviewSessionId } = await import('../live/helpers/rwtJ1dJourney');
        let t = 0;
        const page = { getByTestId: () => ({ first: () => ({ getAttribute: async () => null }) }), waitForTimeout: async (ms: number) => { t += ms; } };
        expect(await loadedReviewSessionId(page as never, 45_000, () => t)).toBeNull();
        expect(t).toBeGreaterThanOrEqual(45_000);
    });
    it('returns null when no id ever loads', async () => {
        const { loadedReviewSessionId } = await import('../live/helpers/rwtJ1dJourney');
        expect(await loadedReviewSessionId(fakePage([null]) as never, 50)).toBeNull();
    });
});

describe('Codex #1883: sign-out is judged only after the logout answer (pollUntil)', () => {
    it('waits through a delayed logout answer, then holds', async () => {
        const { pollUntil } = await import('../live/helpers/rwtJ1dJourney');
        let t = 0;
        const ok = await pollUntil(() => t >= 12_000, async (ms) => { t += ms; }, 30_000, () => t);
        expect(ok).toBe(true);
        expect(t).toBeGreaterThanOrEqual(12_000);
    });
    it('gives up at the deadline when the logout never answers, not before', async () => {
        const { pollUntil } = await import('../live/helpers/rwtJ1dJourney');
        let t = 0;
        expect(await pollUntil(() => false, async (ms) => { t += ms; }, 30_000, () => t)).toBe(false);
        expect(t).toBeGreaterThanOrEqual(30_000);
    });
    it('a frozen clock still ends (attempt cap)', async () => {
        const { pollUntil } = await import('../live/helpers/rwtJ1dJourney');
        expect(await pollUntil(() => false, async () => undefined, 1_000, () => 0)).toBe(false);
    });
});
