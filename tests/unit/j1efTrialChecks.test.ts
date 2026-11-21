// @vitest-environment node
/** J1.e / J1.f disposable-stack smoke: the pure verdicts, both ways. They prove the checks, not the browser run. */
import { describe, expect, it } from 'vitest';
import { closureRefusedVerdict, freshSignInWallVerdict, openPageWallVerdict, provisionedTrialVerdict, serverRefusalVerdict } from '../smoke/j1efTrialChecks';

const NOW = Date.parse('2026-11-20T20:00:00Z');
describe('provisionedTrialVerdict: the signup trigger gave a marked, open trial', () => {
    it('PASS only for a marked trial expiring in the future', () => {
        expect(provisionedTrialVerdict({ commercial_trial_granted_at: '2026-11-20T19:59:00Z', trial_expires_at: '2026-12-20T19:59:00Z' }, NOW)).toEqual({ status: 'PASS', reason: 'marked_trial_provisioned' });
        expect(provisionedTrialVerdict(null, NOW)).toEqual({ status: 'HOLD', reason: 'profile_unread' });
        expect(provisionedTrialVerdict({ commercial_trial_granted_at: null, trial_expires_at: '2026-12-20T19:59:00Z' }, NOW)).toEqual({ status: 'FAIL', reason: 'trial_not_marked' });
        expect(provisionedTrialVerdict({ commercial_trial_granted_at: '2026-11-20T19:59:00Z', trial_expires_at: '2026-11-20T19:00:00Z' }, NOW)).toEqual({ status: 'FAIL', reason: 'trial_not_open' });
        expect(provisionedTrialVerdict({ commercial_trial_granted_at: '2026-11-20T19:59:00Z', trial_expires_at: 'not a date' }, NOW)).toEqual({ status: 'FAIL', reason: 'trial_not_open' });
    });
});

describe('openPageWallVerdict: the wall replaces the OPEN page at the deadline', () => {
    const base = { productShownBefore: true, wallBefore: false, wallAfter: true, productShownAfter: false, pathBefore: '/session', pathAfter: '/session', navigations: 0, micAcquisitions: 0 };
    it('PASS when the open session page turns into the wall in place', () => {
        expect(openPageWallVerdict(base)).toEqual({ status: 'PASS', reason: 'wall_on_open_page' });
    });
    it('NEGATIVE: not open first, a navigation, no wall, product still shown, or the mic opened is never a PASS', () => {
        expect(openPageWallVerdict({ ...base, productShownBefore: false })).toMatchObject({ status: 'HOLD', reason: 'session_not_open_before_expiry' });
        expect(openPageWallVerdict({ ...base, wallBefore: true })).toMatchObject({ status: 'HOLD', reason: 'session_not_open_before_expiry' });
        expect(openPageWallVerdict({ ...base, navigations: 1 })).toMatchObject({ status: 'FAIL', reason: 'wall_needed_a_navigation' });
        expect(openPageWallVerdict({ ...base, pathAfter: '/practice' })).toMatchObject({ status: 'FAIL', reason: 'wall_needed_a_navigation' });
        expect(openPageWallVerdict({ ...base, wallAfter: false })).toMatchObject({ status: 'FAIL', reason: 'no_wall_after_expiry' });
        expect(openPageWallVerdict({ ...base, productShownAfter: true })).toMatchObject({ status: 'FAIL', reason: 'product_still_shown_after_expiry' });
        expect(openPageWallVerdict({ ...base, micAcquisitions: 1 })).toMatchObject({ status: 'FAIL', reason: 'microphone_opened' });
    });
});

describe('freshSignInWallVerdict', () => {
    it('PASS only when signed in, the wall shows, and no product is shown', () => {
        expect(freshSignInWallVerdict({ signedIn: true, wallShown: true, productShown: false })).toEqual({ status: 'PASS', reason: 'wall_after_fresh_sign_in' });
        expect(freshSignInWallVerdict({ signedIn: false, wallShown: true, productShown: false })).toMatchObject({ status: 'HOLD' });
        expect(freshSignInWallVerdict({ signedIn: true, wallShown: false, productShown: false })).toMatchObject({ status: 'FAIL', reason: 'no_wall_after_fresh_sign_in' });
        expect(freshSignInWallVerdict({ signedIn: true, wallShown: true, productShown: true })).toMatchObject({ status: 'FAIL', reason: 'product_shown_after_expiry' });
    });
});

describe('serverRefusalVerdict: the same account, open before and refused after, for the expiry', () => {
    const open = { guardedBefore: { ok: true } as const, usageBefore: { can_start: true, trial_active: true } };
    const refused = { guardedAfter: { ok: false, message: 'P0001 payment_required' } as const, usageAfter: { can_start: false, error: 'trial_expired' } };
    it('PASS when the guarded read is refused with payment_required and the usage check says trial_expired', () => {
        expect(serverRefusalVerdict({ ...open, ...refused })).toEqual({ status: 'PASS', reason: 'server_refuses_expired_account' });
    });
    it('NEGATIVE: no contrast, still allowed, refused for another reason, or a usage answer that is not trial_expired', () => {
        expect(serverRefusalVerdict({ ...refused, guardedBefore: null, usageBefore: null })).toMatchObject({ status: 'HOLD', reason: 'contrast_unread' });
        expect(serverRefusalVerdict({ ...refused, guardedBefore: { ok: false, message: 'x' }, usageBefore: open.usageBefore })).toMatchObject({ status: 'HOLD', reason: 'account_not_open_before_expiry' });
        expect(serverRefusalVerdict({ ...open, guardedAfter: null, usageAfter: null })).toMatchObject({ status: 'HOLD', reason: 'refusal_unread' });
        expect(serverRefusalVerdict({ ...open, ...refused, guardedAfter: { ok: true } })).toMatchObject({ status: 'FAIL', reason: 'guarded_read_allowed_after_expiry' });
        expect(serverRefusalVerdict({ ...open, ...refused, guardedAfter: { ok: false, message: '42501 permission denied' } })).toMatchObject({ status: 'FAIL', reason: 'refused_for_another_reason' });
        expect(serverRefusalVerdict({ ...open, ...refused, usageAfter: { can_start: true } })).toMatchObject({ status: 'FAIL', reason: 'usage_check_not_trial_expired' });
        expect(serverRefusalVerdict({ ...open, ...refused, usageAfter: { can_start: false, error: 'quota_exhausted' } })).toMatchObject({ status: 'FAIL', reason: 'usage_check_not_trial_expired' });
    });
});

describe('closureRefusedVerdict: on loopback the wall\'s deletion path ends in an explicit refusal and nothing else', () => {
    const REFUSAL = { status: 503, error: 'account_closure_unavailable' };
    const refused = { answers: [REFUSAL], refusalShown: true, requestOffered: false, sentShown: false, mailForAddress: 0,
        authUser: 'present', profile: 'present' } as const;
    it('PASS only for 503 refusals shown as the blocked state, nothing offered or sent, and the account untouched', () => {
        expect(closureRefusedVerdict(refused)).toEqual({ status: 'PASS', reason: 'deletion_status_fails_closed' });
        // The completion-route refusal shape is the same deliberate refusal.
        expect(closureRefusedVerdict({ ...refused, answers: [REFUSAL, { status: 503, outcome: 'unavailable' }] })).toMatchObject({ status: 'PASS' });
    });
    it('NEGATIVE: a deletion, an email, a success claim, a 2xx, another refusal or an offered request is a FAIL', () => {
        expect(closureRefusedVerdict({ ...refused, authUser: 'absent' })).toEqual({ status: 'FAIL', reason: 'account_changed_without_binding' });
        expect(closureRefusedVerdict({ ...refused, profile: 'absent' })).toEqual({ status: 'FAIL', reason: 'account_changed_without_binding' });
        expect(closureRefusedVerdict({ ...refused, mailForAddress: 1 })).toEqual({ status: 'FAIL', reason: 'verification_email_sent' });
        expect(closureRefusedVerdict({ ...refused, sentShown: true })).toEqual({ status: 'FAIL', reason: 'verification_claimed_sent' });
        expect(closureRefusedVerdict({ ...refused, answers: [REFUSAL, { status: 200 }] })).toEqual({ status: 'FAIL', reason: 'closure_answered_without_binding' });
        expect(closureRefusedVerdict({ ...refused, answers: [{ status: 503, error: 'other' }] })).toEqual({ status: 'FAIL', reason: 'refused_for_another_reason' });
        expect(closureRefusedVerdict({ ...refused, answers: [{ status: 401, error: 'sign_in_required' }] })).toEqual({ status: 'FAIL', reason: 'refused_for_another_reason' });
        expect(closureRefusedVerdict({ ...refused, requestOffered: true })).toEqual({ status: 'FAIL', reason: 'request_offered_after_refusal' });
        expect(closureRefusedVerdict({ ...refused, refusalShown: false })).toEqual({ status: 'FAIL', reason: 'refusal_not_shown' });
    });
    it('HOLD when anything is unread or no closure request was seen', () => {
        for (const over of [{ mailForAddress: 'unread' }, { authUser: 'unread' }, { profile: 'unread' }] as const) {
            expect(closureRefusedVerdict({ ...refused, ...over })).toEqual({ status: 'HOLD', reason: 'refusal_unread' });
        }
        expect(closureRefusedVerdict({ ...refused, answers: [] })).toEqual({ status: 'HOLD', reason: 'no_closure_request_observed' });
    });
});
