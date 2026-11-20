// @vitest-environment node
/**
 * J1.d reserved-namespace smoke: the pure verdicts the disposable-stack smoke uses. These prove the checks
 * themselves, both ways; they are NOT the browser run, which only the disposable stack's own Playwright evidence can prove.
 */
import { describe, expect, it } from 'vitest';
import {
    SMOKE_EMAIL_DOMAIN, confirmationLink, confirmationMessage, loopbackTargets, quietReturnVerdict, receiptLeaks, sameAccountVerdict,
    signedOutRedirectVerdict, smokeIdentity,
} from '../smoke/j1dSmokeChecks';

const API = 'http://127.0.0.1:54321';
const ADDRESS = 'rwt-journey-open-mic-1760000000001-4242@speaksharp.test';
const verify = (over: Record<string, string> = {}) => {
    const u = new URL(`${API}/auth/v1/verify`);
    for (const [k, v] of Object.entries({ token: 'pkce_abc', type: 'signup', redirect_to: 'http://localhost:5173', ...over })) u.searchParams.set(k, v);
    return u.toString();
};

describe('j1dSmokeChecks: identity and targets', () => {
    it('mints the J1.d run-owned grammar at the reserved namespace only', () => {
        expect(SMOKE_EMAIL_DOMAIN).toBe('speaksharp.test');
        expect(smokeIdentity(1760000000001, '4242')).toBe(ADDRESS);
        expect(smokeIdentity(1760000000001, 'local')).toBe('rwt-journey-open-mic-1760000000001-local@speaksharp.test');
        expect(smokeIdentity(1760000000001, '4242', 'trial-ends')).toBe('rwt-journey-trial-ends-1760000000001-4242@speaksharp.test');
        expect(() => smokeIdentity(1760000000001, '4242', 'Bad Label')).toThrow(/malformed/);
        for (const [ms, run] of [[176000000000, '4242'], [1760000000001, 'abc'], [1760000000001, '']] as const) {
            expect(() => smokeIdentity(ms, run)).toThrow(/malformed/);
        }
    });

    it('accepts plain-http loopback targets and refuses anything else before data exists', () => {
        expect(loopbackTargets({ app: 'http://localhost:5173', api: API, mail: 'http://127.0.0.1:54324' })).toEqual({ status: 'PASS', reason: 'loopback_only' });
        expect(loopbackTargets({ app: 'https://speaksharp-public.vercel.app' })).toEqual({ status: 'HOLD', reason: 'app_not_loopback' });
        expect(loopbackTargets({ api: 'https://yxlapjuovrsvjswkwnrk.supabase.co' })).toEqual({ status: 'HOLD', reason: 'api_not_loopback' });
        expect(loopbackTargets({ api: 'https://127.0.0.1:54321' })).toEqual({ status: 'HOLD', reason: 'api_not_loopback' });
        expect(loopbackTargets({ mail: undefined })).toEqual({ status: 'HOLD', reason: 'mail_unparsable' });
        expect(loopbackTargets({ app: 'http://localhost.evil.io:5173' })).toEqual({ status: 'HOLD', reason: 'app_not_loopback' });
    });
});

describe('j1dSmokeChecks: confirmation through local Mailpit', () => {
    it('finds exactly the one message for this address', () => {
        expect(confirmationMessage([{ ID: 'm1', To: [{ Address: ADDRESS }] }], ADDRESS)).toEqual({ state: 'found', id: 'm1' });
        expect(confirmationMessage([{ ID: 'm1', To: [{ Address: ADDRESS.toUpperCase() }] }], ADDRESS)).toEqual({ state: 'found', id: 'm1' });
    });

    it('NEGATIVE: none, an unreadable listing, two, or one also sent to someone else is never found', () => {
        expect(confirmationMessage([], ADDRESS)).toEqual({ state: 'unavailable' });
        expect(confirmationMessage(null, ADDRESS)).toEqual({ state: 'unavailable' });
        expect(confirmationMessage([{ ID: 'm1', To: [{ Address: 'other@speaksharp.test' }] }], ADDRESS)).toEqual({ state: 'unavailable' });
        expect(confirmationMessage([{ ID: 'm1', To: [{ Address: ADDRESS }] }, { ID: 'm2', To: [{ Address: ADDRESS }] }], ADDRESS)).toEqual({ state: 'ambiguous' });
        expect(confirmationMessage([{ ID: 'm1', To: [{ Address: ADDRESS }, { Address: 'x@speaksharp.test' }] }], ADDRESS)).toEqual({ state: 'ambiguous' });
        expect(confirmationMessage([{ ID: '', To: [{ Address: ADDRESS }] }], ADDRESS)).toEqual({ state: 'ambiguous' });
    });

    it('extracts the single local signup verify link, decoding HTML entities', () => {
        const link = verify();
        expect(confirmationLink(`Confirm: ${link}`, API)).toBe(link);
        expect(confirmationLink(`<a href="${link.replace(/&/g, '&amp;')}">Confirm</a>\n${link}`, API)).toBe(link);
    });

    it('NEGATIVE: no link, two different links, another host, another type or no token is refused', () => {
        expect(confirmationLink('no link here', API)).toBeNull();
        expect(confirmationLink(`${verify()} ${verify({ token: 'other' })}`, API)).toBeNull();
        expect(confirmationLink(verify().replace('127.0.0.1:54321', 'evil.example:54321'), API)).toBeNull();
        expect(confirmationLink(verify({ type: 'recovery' }), API)).toBeNull();
        expect(confirmationLink(verify({ type: 'magiclink' }), API)).toBeNull();
        expect(confirmationLink(verify({ token: '' }), API)).toBeNull();
    });
});

describe('j1dSmokeChecks: signed-out redirect, same account, quiet return', () => {
    const redirect = (over: Partial<Parameters<typeof signedOutRedirectVerdict>[0]> = {}) => signedOutRedirectVerdict({
        requested: '/account', landedPath: '/auth/signin', protectedContentVisible: false, ownedReadSucceeded: false, ...over });
    it('a signed-out protected link lands on sign-in with nothing protected shown or read', () => {
        expect(redirect()).toEqual({ status: 'PASS', reason: 'redirected_to_sign_in' });
    });
    it('NEGATIVE: no redirect, a redirect elsewhere, protected content shown, or an owned read is a FAIL', () => {
        expect(redirect({ landedPath: '/account' })).toEqual({ status: 'FAIL', reason: 'no_redirect' });
        expect(redirect({ landedPath: '/' })).toEqual({ status: 'FAIL', reason: 'redirect_not_to_sign_in' });
        expect(redirect({ protectedContentVisible: true })).toEqual({ status: 'FAIL', reason: 'protected_content_shown_signed_out' });
        expect(redirect({ ownedReadSucceeded: true })).toEqual({ status: 'FAIL', reason: 'owned_read_succeeded_signed_out' });
    });

    const same = (over: Partial<Parameters<typeof sameAccountVerdict>[0]> = {}) => sameAccountVerdict({
        createdUid: 'u1', sessionUid: 'u1', landedPath: '/account', requested: '/account', ownedDetailVisible: true, ...over });
    it('the same account returns to the exact route and its own detail', () => {
        expect(same()).toEqual({ status: 'PASS', reason: 'same_account_and_owned_detail' });
    });
    it('NEGATIVE: no session, another account, another route, or no owned detail is a FAIL', () => {
        expect(same({ sessionUid: null })).toEqual({ status: 'FAIL', reason: 'no_session' });
        expect(same({ sessionUid: 'u2' })).toEqual({ status: 'FAIL', reason: 'different_account' });
        expect(same({ landedPath: '/practice' })).toEqual({ status: 'FAIL', reason: 'not_returned_to_requested_route' });
        expect(same({ ownedDetailVisible: false })).toEqual({ status: 'FAIL', reason: 'owned_detail_missing' });
    });

    it('returning opens no microphone and creates no session; unread counts HOLD', () => {
        expect(quietReturnVerdict({ micAcquisitions: 0, sessionsBefore: 0, sessionsAfter: 0 })).toEqual({ status: 'PASS', reason: 'no_mic_no_session' });
        expect(quietReturnVerdict({ micAcquisitions: 1, sessionsBefore: 0, sessionsAfter: 0 })).toEqual({ status: 'FAIL', reason: 'microphone_opened' });
        expect(quietReturnVerdict({ micAcquisitions: 0, sessionsBefore: 0, sessionsAfter: 1 })).toEqual({ status: 'FAIL', reason: 'session_created' });
        expect(quietReturnVerdict({ micAcquisitions: 0, sessionsBefore: null, sessionsAfter: 0 })).toEqual({ status: 'HOLD', reason: 'sessions_unread' });
        expect(quietReturnVerdict({ micAcquisitions: 0, sessionsBefore: 0, sessionsAfter: null })).toEqual({ status: 'HOLD', reason: 'sessions_unread' });
    });
});

describe('j1dSmokeChecks: the receipt carries no secret', () => {
    it('flags any forbidden value and any token or link shape, never the value itself', () => {
        expect(receiptLeaks('{"ok":true}', ['secret-password'])).toEqual([]);
        expect(receiptLeaks('{"p":"secret-password"}', ['secret-password'])).toEqual(['forbidden_value_0']);
        expect(receiptLeaks(`{"l":"${verify()}"}`, [])).toEqual(['token_or_link_shape']);
        expect(receiptLeaks('{"t":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"}', [])).toEqual(['token_or_link_shape']);
        expect(receiptLeaks('{"t":"access_token=x"}', [])).toEqual(['token_or_link_shape']);
        // Short values are not matched (a 1-5 character value would match ordinary text).
        expect(receiptLeaks('{"a":"abc"}', ['abc'])).toEqual([]);
    });
});
