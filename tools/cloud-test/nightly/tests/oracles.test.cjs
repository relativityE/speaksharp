"use strict";
// Nightly AHT suite: the new rows' oracles. Each one passes the healthy behaviour and fails the broken one.
const { createHash } = require('node:crypto');
const { describe, expect, it } = require('./expect-lite.cjs');
const { THIRTY_DAYS_MS, trialLengthVerdict } = require('../oracles/trial-window.cjs');
const { ENDED_AGO_MS, TrialEndRefused, endRunOwnedTrial } = require('../oracles/canary-trial-end.cjs');
const { staleRequestVerdict, unauthorizedReadVerdict } = require('../oracles/sign-out.cjs');
const { oldSessionsNoNewCoachingVerdict } = require('../oracles/upgrade-continuity.cjs');
const { paymentWallVerdict, serverRefusesVerdict, shortStopVerdict } = require('../oracles/payment-wall.cjs');
const T0 = Date.parse('2026-11-14T16:00:00.000Z');
const UID = '0b6f3c1e-5d1a-4c2b-9e1f-2a3b4c5d6e7f';
const OTHER = '9f8e7d6c-5b4a-4321-8765-0fedcba98765';
const sha = (t) => createHash('sha256').update(t).digest('hex');
describe('trial-length-thirty-days', () => {
    const window = { accountId: UID, startedAtMs: T0, endedAtMs: T0 + 20_000 };
    const read = (o = {}) => ({
        via: 'own-token', profileId: UID,
        trialStartedAt: new Date(T0 + 5_000).toISOString(), trialExpiresAt: new Date(T0 + 5_000 + THIRTY_DAYS_MS).toISOString(), ...o,
    });
    it('passes a trial that started at signup and ends exactly 30 days later', () => {
        expect(trialLengthVerdict(read(), window).outcome).toBe('PASS');
    });
    it('fails 29 days, 31 days, a calendar month and one hour off', () => {
        const start = T0 + 5_000;
        for (const end of [start + 29 * 86_400_000, start + 31 * 86_400_000, Date.parse('2026-12-14T16:00:05.000Z') + 3_600_000, start + THIRTY_DAYS_MS + 3_600_000]) {
            expect(trialLengthVerdict(read({ trialExpiresAt: new Date(end).toISOString() }), window).outcome).toBe('FAIL');
        }
    });
    it('fails a trial that started outside the signup window', () => {
        const start = T0 - 3 * 60_000;
        expect(trialLengthVerdict(read({ trialStartedAt: new Date(start).toISOString(), trialExpiresAt: new Date(start + THIRTY_DAYS_MS).toISOString() }), window).outcome).toBe('FAIL');
    });
    it('fails a service-role read, another account, and a missing stamp', () => {
        expect(trialLengthVerdict(read({ via: 'service-role' }), window).outcome).toBe('FAIL');
        expect(trialLengthVerdict(read({ profileId: OTHER }), window).outcome).toBe('FAIL');
        expect(trialLengthVerdict(read({ trialExpiresAt: null }), window).outcome).toBe('FAIL');
    });
});
describe('ending a run-owned trial (canary-tagged, fail closed)', () => {
    const ports = (o = {}) => {
        const writes = [];
        const p = {
            getUser: async () => ({ email: o.email ?? 'rwt-journey-abc@example.test', appMetadata: 'canary' in o ? { canary: o.canary } : { canary: true } }),
            setTrialExpiresAt: async (uid, at) => { writes.push({ uid, at }); return { updatedIds: o.updated ?? [uid] }; },
        };
        return { p, writes };
    };
    const req = { uid: UID, email: 'rwt-journey-abc@example.test', runPrefix: 'rwt-journey-', ackGranted: true, nowMs: T0 };
    it('ends the trial of a tagged run-owned account, in the past, on that account only', async () => {
        const { p, writes } = ports();
        await expect(endRunOwnedTrial(p, req)).resolves.toEqual({ expiresAt: new Date(T0 - ENDED_AGO_MS).toISOString() });
        expect(writes).toEqual([{ uid: UID, at: new Date(T0 - ENDED_AGO_MS).toISOString() }]);
    });
    it('writes nothing without the acknowledgement, the run prefix, the canary claim, or a matching email', async () => {
        const cases = [
            [{ ackGranted: false }, {}],
            [{ email: 'someone@example.test' }, { email: 'someone@example.test' }],
            [{}, { canary: undefined }],
            [{}, { canary: 'true' }],
            [{}, { email: 'rwt-journey-other@example.test' }],
            [{ uid: `${UID},${OTHER}` }, {}],
        ];
        for (const [r, o] of cases) {
            const { p, writes } = ports(o);
            await expect(endRunOwnedTrial(p, { ...req, ...r })).rejects.toBeInstanceOf(TrialEndRefused);
            expect(writes).toEqual([]);
        }
    });
    it('fails closed when the write touched no row, another row, or more than one', async () => {
        for (const updated of [[], [OTHER], [UID, OTHER]]) {
            await expect(endRunOwnedTrial(ports({ updated }).p, req)).rejects.toBeInstanceOf(TrialEndRefused);
        }
    });
});
describe('sign-out rows (a 403 denial is a correct answer)', () => {
    const token = sha('access-token');
    const req = (o = {}) => ({
        method: 'GET', path: '/rest/v1/sessions', status: 200, bearerDigest: token, sentAfterSignOutCompleted: false, ownedIdentifiersInBody: 0, ...o,
    });
    const obs = (o = {}) => ({
        signOutCompletedObserved: true, signedInBearerDigests: [token], ownedIdentifiersRendered: 0,
        requests: [
            req({ ownedIdentifiersInBody: 3 }),
            req({ status: 401, bearerDigest: null, sentAfterSignOutCompleted: true }),
            req({ path: '/rest/v1/user_profiles', status: 403, bearerDigest: sha('anon'), sentAfterSignOutCompleted: true }),
            req({ path: '/assets/app.js', bearerDigest: null, sentAfterSignOutCompleted: true }),
        ],
        ...o,
    });
    it('passes both rows when later requests are denied: 401 and 403 are correct answers', () => {
        expect(unauthorizedReadVerdict(obs()).outcome).toBe('PASS');
        expect(staleRequestVerdict(obs()).outcome).toBe('PASS');
    });
    it('fails no-unauthorized-read on a read that returns the account\'s data without a valid session', () => {
        for (const r of [req({ bearerDigest: null, ownedIdentifiersInBody: 1 }), req({ sentAfterSignOutCompleted: true, bearerDigest: sha('anon'), ownedIdentifiersInBody: 2 })]) {
            expect(unauthorizedReadVerdict(obs({ requests: [r] })).outcome).toBe('FAIL');
        }
    });
    it('fails no-unauthorized-read on data left on the signed-out page', () => {
        expect(unauthorizedReadVerdict(obs({ ownedIdentifiersRendered: 1 })).outcome).toBe('FAIL');
    });
    it('fails no-stale-request on any request with the old session after sign-out, whatever the answer', () => {
        for (const status of [200, 401, 403, null]) {
            expect(staleRequestVerdict(obs({ requests: [req({ status, sentAfterSignOutCompleted: true })] })).outcome).toBe('FAIL');
        }
    });
    it('keeps the two rows separate: a stale request that was denied fails only the stale row', () => {
        const o = obs({ requests: [req({ status: 403, sentAfterSignOutCompleted: true })] });
        expect(unauthorizedReadVerdict(o).outcome).toBe('PASS');
        expect(staleRequestVerdict(o).outcome).toBe('FAIL');
    });
    it('holds both rows when sign-out completing or the token digest was not observed', () => {
        for (const o of [obs({ signOutCompletedObserved: false }), obs({ signedInBearerDigests: [] }), obs({ signedInBearerDigests: [''] })]) {
            expect(unauthorizedReadVerdict(o).outcome).toBe('HOLD');
            expect(staleRequestVerdict(o).outcome).toBe('HOLD');
        }
    });
    it('counts a refreshed token as the session\'s: a stale request with it fails, a read with it before sign-out passes', () => {
        const refreshed = sha('refreshed-access-token');
        const o = obs({ signedInBearerDigests: [token, refreshed], requests: [req({ bearerDigest: refreshed, ownedIdentifiersInBody: 2 })] });
        expect(unauthorizedReadVerdict(o).outcome).toBe('PASS');
        expect(staleRequestVerdict(obs({ signedInBearerDigests: [token, refreshed], requests: [req({ bearerDigest: refreshed, sentAfterSignOutCompleted: true, status: 401 })] })).outcome).toBe('FAIL');
    });
    it('holds both rows when a request or the page was not fully observed', () => {
        for (const o of [obs({ requests: [req({ ownedIdentifiersInBody: undefined })] }), obs({ ownedIdentifiersRendered: undefined }), obs({ requests: undefined })]) {
            expect(unauthorizedReadVerdict(o).outcome).toBe('HOLD');
            expect(staleRequestVerdict(o).outcome).toBe('HOLD');
        }
    });
});
describe('old-sessions-no-new-coaching (J9.a)', () => {
    const pre = { keptSessions: 3, withStoredCoaching: 3 };
    const seen = { sessionsOpened: 3, coachingRequests: 0, storedCoachingRendered: 3 };
    it('passes when every kept session reads its stored coaching with no request', () => {
        expect(oldSessionsNoNewCoachingVerdict(pre, seen).outcome).toBe('PASS');
    });
    it('fails a coaching request, unread stored coaching, or sessions not opened', () => {
        expect(oldSessionsNoNewCoachingVerdict(pre, { ...seen, coachingRequests: 1 }).outcome).toBe('FAIL');
        expect(oldSessionsNoNewCoachingVerdict(pre, { ...seen, storedCoachingRendered: 2 }).outcome).toBe('FAIL');
        expect(oldSessionsNoNewCoachingVerdict(pre, { ...seen, sessionsOpened: 2, storedCoachingRendered: 2 }).outcome).toBe('FAIL');
    });
    it('holds when a kept session had no stored coaching before the release, or there was no pre-release check', () => {
        expect(oldSessionsNoNewCoachingVerdict({ keptSessions: 3, withStoredCoaching: 2 }, { ...seen, coachingRequests: 1 }).outcome).toBe('HOLD');
        expect(oldSessionsNoNewCoachingVerdict(null, seen).outcome).toBe('HOLD');
        expect(oldSessionsNoNewCoachingVerdict({ keptSessions: 0, withStoredCoaching: 0 }, seen).outcome).toBe('HOLD');
    });
});
describe('payment wall', () => {
    const wall = (o = {}) => ({
        wallShown: true, payActionVisible: true, deleteOffered: true, deletePromoted: false,
        historyVisible: false, progressVisible: false, pdfVisible: false, exportVisible: false, recordStartEnabled: false, ...o,
    });
    it('passes a wall that offers paying and deletion, not promoted, with no past data', () => {
        expect(paymentWallVerdict(wall()).outcome).toBe('PASS');
    });
    it('fails each broken wall', () => {
        const broken = [
            { wallShown: false }, { payActionVisible: false }, { deleteOffered: false }, { deletePromoted: true },
            { historyVisible: true }, { progressVisible: true }, { pdfVisible: true }, { exportVisible: true }, { recordStartEnabled: true },
        ];
        for (const b of broken)
            expect(paymentWallVerdict(wall(b)).outcome).toBe('FAIL');
    });
    it('holds a wall with any field not observed, never passing it', () => {
        for (const f of ['historyVisible', 'pdfVisible', 'exportVisible', 'recordStartEnabled', 'deletePromoted', 'wallShown']) {
            const w = wall();
            delete w[f];
            const v = paymentWallVerdict(w);
            expect(v.outcome).toBe('HOLD');
            expect(v.detail).toContain(f);
        }
        expect(paymentWallVerdict(wall({ historyVisible: 'no' })).outcome).toBe('HOLD');
    });
});
describe('trial-expired-server-refuses', () => {
    const required = ['start', 'save', 'coaching'];
    const probes = (o = {}) => required.map((name) => ({ name, status: o[name]?.status ?? 403, providerWorkObserved: o[name]?.providerWorkObserved ?? false }));
    it('passes when every endpoint refuses the expired account', () => {
        expect(serverRefusesVerdict(probes(), required).outcome).toBe('PASS');
    });
    it('fails an accepted request, a server error, provider work, or an unprobed endpoint', () => {
        expect(serverRefusesVerdict(probes({ coaching: { status: 200 } }), required).outcome).toBe('FAIL');
        expect(serverRefusesVerdict(probes({ save: { status: 502 } }), required).outcome).toBe('FAIL');
        expect(serverRefusesVerdict(probes({ coaching: { providerWorkObserved: true } }), required).outcome).toBe('FAIL');
        expect(serverRefusesVerdict(probes().slice(1), required).outcome).toBe('FAIL');
        expect(serverRefusesVerdict([], []).outcome).toBe('FAIL');
    });
    it('accepts only 401, 402 and 403 as a refusal: a moved path, a bad probe or a rate limit proves nothing', () => {
        for (const status of [401, 402])
            expect(serverRefusesVerdict(probes({ start: { status } }), required).outcome).toBe('PASS');
        for (const status of [400, 404, 405, 409, 429])
            expect(serverRefusesVerdict(probes({ start: { status } }), required).outcome).toBe('FAIL');
    });
    it('holds when provider work was not observed for a probe', () => {
        const p = probes();
        delete p[2].providerWorkObserved;
        expect(serverRefusesVerdict(p, required).outcome).toBe('HOLD');
    });
});
describe('short-stop-no-save', () => {
    const read = { sessionIdsBefore: ['a'], sessionIdsAfter: ['a'], acceptedSaveRequests: 0, savedConfirmationShown: false, settled: true };
    it('passes when a short Stop saves nothing', () => {
        expect(shortStopVerdict(read).outcome).toBe('PASS');
    });
    it('fails a new row, an accepted save, or a saved message; holds an unsettled page', () => {
        expect(shortStopVerdict({ ...read, sessionIdsAfter: ['a', 'b'] }).outcome).toBe('FAIL');
        expect(shortStopVerdict({ ...read, acceptedSaveRequests: 1 }).outcome).toBe('FAIL');
        expect(shortStopVerdict({ ...read, savedConfirmationShown: true }).outcome).toBe('FAIL');
        expect(shortStopVerdict({ ...read, settled: false }).outcome).toBe('HOLD');
    });
    it('holds a read with a field not observed, never passing it', () => {
        for (const f of ['sessionIdsBefore', 'sessionIdsAfter', 'acceptedSaveRequests', 'savedConfirmationShown', 'settled']) {
            const r = { ...read };
            delete r[f];
            expect(shortStopVerdict(r).outcome).toBe('HOLD');
        }
    });
});
