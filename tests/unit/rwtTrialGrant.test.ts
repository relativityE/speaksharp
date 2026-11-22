// @vitest-environment node
/**
 * J1.a (Sam on run 45014809858): the receipt must establish that a brand-new account starts a 30-day trial. These checks
 * prove the verdict, the row it writes, that a failed read is HOLD and never a pass, and that J1 requires the row.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TRIAL_ROW, TRIAL_START_SKEW_MS, trialGrantRow, trialGrantVerdict } from '../live/helpers/rwtTrialGrant';

const DAY = 86_400_000;
const SIGNUP = Date.parse('2026-11-22T12:00:00.000Z');
const profile = (o: Record<string, unknown> = {}) => ({
    trial_started_at: new Date(SIGNUP + 2_000).toISOString(),
    trial_expires_at: new Date(SIGNUP + 2_000 + 30 * DAY).toISOString(),
    commercial_trial_granted_at: new Date(SIGNUP + 2_000).toISOString(),
    subscription_status: 'free',
    ...o,
});

describe('trialGrantVerdict', () => {
    it('PASS: granted, 30 days, started at sign-up, active, free', () => {
        expect(trialGrantVerdict(profile(), SIGNUP, SIGNUP + 60_000)).toMatchObject({
            status: 'PASS', evidence: { trialGranted: true, windowDays: 30, startedAtSignup: true, active: true, free: true },
        });
    });
    it('FAIL: no grant, a wrong window, a start far from sign-up, an expired trial, or a Pro profile', () => {
        for (const [p, now] of [
            [profile({ commercial_trial_granted_at: null }), SIGNUP],
            [profile({ trial_expires_at: new Date(SIGNUP + 2_000 + 14 * DAY).toISOString() }), SIGNUP],
            [profile({ trial_expires_at: new Date(SIGNUP + 2_000 + 31 * DAY).toISOString() }), SIGNUP],
            [profile({ trial_started_at: new Date(SIGNUP - TRIAL_START_SKEW_MS - 1_000).toISOString(),
                trial_expires_at: new Date(SIGNUP - TRIAL_START_SKEW_MS - 1_000 + 30 * DAY).toISOString() }), SIGNUP],
            [profile(), SIGNUP + 31 * DAY],
            [profile({ subscription_status: 'pro' }), SIGNUP],
            [profile({ subscription_status: undefined }), SIGNUP],
            [profile({ trial_started_at: null }), SIGNUP],
            [profile({ trial_expires_at: 'not a date' }), SIGNUP],
        ] as const) {
            expect(trialGrantVerdict(p as never, SIGNUP, now).status).toBe('FAIL');
        }
    });
    it('HOLD, never PASS, when the profile could not be read; evidence carries no ids or timestamps', () => {
        expect(trialGrantVerdict(null, SIGNUP, SIGNUP)).toMatchObject({ status: 'HOLD', evidence: { profileRead: false } });
        const ev = trialGrantVerdict(profile(), SIGNUP, SIGNUP).evidence;
        expect(Object.values(ev).every((v) => v === null || typeof v === 'boolean' || typeof v === 'number')).toBe(true);
    });
});

describe('trialGrantRow', () => {
    const sink = () => { const rows: Array<{ step: string; verdict: string }> = []; return { rows, row: (step: string, verdict: string) => rows.push({ step, verdict }) }; };
    const admin = (r: { data: unknown; error: unknown } | 'throw') => ({ from: () => ({ select: () => ({ eq: () => ({
        maybeSingle: async () => { if (r === 'throw') throw new Error('x'); return r; },
    }) }) }) });
    it('reads this account\'s profile and writes one row', async () => {
        const r = sink();
        await trialGrantRow(r, admin({ data: profile(), error: null }) as never, 'uid', SIGNUP, () => SIGNUP + 1_000);
        expect(r.rows).toEqual([{ step: TRIAL_ROW, verdict: 'PASS' }]);
    });
    it('a read error, a thrown read, no admin or no uid is HOLD', async () => {
        for (const [a, uid] of [[admin({ data: null, error: { code: 'x' } }), 'uid'], [admin('throw'), 'uid'], [null, 'uid'],
            [admin({ data: profile(), error: null }), '']] as const) {
            const r = sink();
            await trialGrantRow(r, a as never, uid, SIGNUP, () => SIGNUP);
            expect(r.rows).toEqual([{ step: TRIAL_ROW, verdict: 'HOLD' }]);
        }
    });
});

describe('wiring: J1 writes the row right after sign-up and requires it', () => {
    const src = (f: string) => readFileSync(resolve(__dirname, '../..', f), 'utf8');
    it('the spec captures the sign-up moment and writes the row after the signup row; acceptance requires it', () => {
        const spec = src('tests/live/rwt-open-mic-first-session.live.spec.ts');
        const started = spec.indexOf('const signupStartedAt = Date.now();');
        const signup = spec.indexOf('await signUpDisposableAccount(page, createdEmail);');
        const row = spec.indexOf("receipt.row('signup', 'PASS'");
        const trial = spec.indexOf('await trialGrantRow(receipt, admin as never, capturedUid, signupStartedAt);');
        expect([started > 0, started < signup, signup < row, row < trial]).toEqual([true, true, true, true]);
        expect(src('tests/live/helpers/rwtAcceptance.ts')).toContain(`'${TRIAL_ROW}',`);
    });
});
