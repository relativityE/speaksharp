// @vitest-environment jsdom
/**
 * #1643 — App receiving side of CLI's inactive completion status contract (packet 6305110043, exact 3818759a). The client
 * accepts only the closed public union, bound to the request it holds; anything else is `unavailable`, never an
 * inference about identity or completion. No state offers a retry. The status capability lives only in memory, bound
 * to owner + request, and is dropped on owner switch or expiry.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
    accountCompletionStatus,
    accountStatusAcknowledgment,
    accountStatusCapability,
    completionCapabilities,
} from '@/services/accountCompletionStatus';

const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const token = 'c'.repeat(64);
const NOW = 1_792_543_000_000;

describe('#1643 completion status — closed public union', () => {
    it.each([
        [{ outcome: 'pending', requestId, reason: 'checkout_unsettled', canRetry: false }],
        [{ outcome: 'pending', requestId, reason: 'ready', canRetry: false }],
        [{ outcome: 'processing', requestId, canRetry: false }],
        [{ outcome: 'verification_pending', requestId, reason: 'auth_unknown', canRetry: false }],
        [{ outcome: 'completed', requestId, accountDeleted: true, canRetry: false }],
        [{ outcome: 'unavailable', canRetry: false }],
    ])('accepts %o exactly', (value) => {
        expect(accountCompletionStatus(value, requestId)).toEqual(value);
    });

    it.each([
        ['another request', { outcome: 'processing', requestId: other, canRetry: false }],
        ['a retry offer', { outcome: 'pending', requestId, reason: 'ready', canRetry: true }],
        ['an unknown reason', { outcome: 'pending', requestId, reason: 'later', canRetry: false }],
        ['a verification reason on pending', { outcome: 'pending', requestId, reason: 'auth_unknown', canRetry: false }],
        ['completed without deletion', { outcome: 'completed', requestId, accountDeleted: false, canRetry: false }],
        ['an extra key', { outcome: 'processing', requestId, canRetry: false, expiresAt: NOW }],
        ['a legacy destructive reply', { outcome: 'deleted', accountDeleted: true }],
        ['the inactive request contract', { outcome: 'not_pending', destructiveEnabled: false }],
        ['null', null],
        ['an array', [{ outcome: 'processing', requestId, canRetry: false }]],
    ])('reads %s as unavailable — never as completion or absence', (_label, value) => {
        expect(accountCompletionStatus(value, requestId)).toEqual({ outcome: 'unavailable', canRetry: false });
    });
});

describe('#1643 status capability and acknowledgment replies', () => {
    it('accepts a capability for the held request with a 64-hex token and a future deadline', () => {
        const reply = { outcome: 'status_capability', requestId, token, expiresAt: NOW + 900_000 };
        expect(accountStatusCapability(reply, requestId, NOW)).toEqual({ requestId, token, expiresAt: NOW + 900_000 });
    });

    it.each([
        ['another request', { outcome: 'status_capability', requestId: other, token, expiresAt: NOW + 1 }],
        ['an expired deadline', { outcome: 'status_capability', requestId, token, expiresAt: NOW }],
        ['an upper-case token', { outcome: 'status_capability', requestId, token: 'C'.repeat(64), expiresAt: NOW + 1 }],
        ['a fractional deadline', { outcome: 'status_capability', requestId, token, expiresAt: NOW + 0.5 }],
        ['an extra key', { outcome: 'status_capability', requestId, token, expiresAt: NOW + 1, canRetry: false }],
    ])('refuses a capability with %s', (_label, reply) => {
        expect(accountStatusCapability(reply, requestId, NOW)).toBeNull();
    });

    it('acknowledgment is accepted only for the held request; it is not an effect grant', () => {
        expect(accountStatusAcknowledgment({ outcome: 'status_acknowledged', requestId }, requestId)).toBe(true);
        expect(accountStatusAcknowledgment({ outcome: 'status_acknowledged', requestId: other }, requestId)).toBe(false);
        expect(accountStatusAcknowledgment({ outcome: 'unavailable', canRetry: false }, requestId)).toBe(false);
    });
});

describe('#1643 in-memory capability holder', () => {
    afterEach(() => completionCapabilities.clear());

    it('returns the capability only for the same owner and request before its deadline', () => {
        completionCapabilities.hold('owner-a', { requestId, token, expiresAt: NOW + 10 });
        expect(completionCapabilities.get('owner-a', requestId, NOW)).toEqual({ requestId, token, expiresAt: NOW + 10, acknowledged: false });
        expect(completionCapabilities.get('owner-b', requestId, NOW)).toBeNull();
        expect(completionCapabilities.get('owner-a', other, NOW)).toBeNull();
        expect(completionCapabilities.get('owner-a', requestId, NOW + 10)).toBeNull();
    });

    it('CASUALTY: holding for a different owner drops the previous owner\'s capability (account switch)', () => {
        completionCapabilities.hold('owner-a', { requestId, token, expiresAt: NOW + 10 });
        completionCapabilities.hold('owner-b', { requestId: other, token: 'd'.repeat(64), expiresAt: NOW + 10 });
        expect(completionCapabilities.get('owner-a', requestId, NOW)).toBeNull();
    });

    it('acknowledged is recorded once and survives only within the same holding', () => {
        completionCapabilities.hold('owner-a', { requestId, token, expiresAt: NOW + 10 });
        expect(completionCapabilities.acknowledge('owner-a', other, token, NOW)).toBe(false);
        expect(completionCapabilities.acknowledge('owner-a', requestId, token, NOW)).toBe(true);
        expect(completionCapabilities.get('owner-a', requestId, NOW)?.acknowledged).toBe(true);
    });

    // Sam RETURN 1792547869 (1): observed expiry must clear the holding, and acknowledgment must be deadline-aware.
    it('CASUALTY: once expiry is observed the holding is gone — a late acknowledge fails and an earlier clock cannot revive it', () => {
        completionCapabilities.hold('owner-a', { requestId, token, expiresAt: NOW + 10 });
        expect(completionCapabilities.get('owner-a', requestId, NOW + 10)).toBeNull();
        expect(completionCapabilities.acknowledge('owner-a', requestId, token, NOW + 10)).toBe(false);
        expect(completionCapabilities.get('owner-a', requestId, NOW + 9)).toBeNull();
    });

    it('FENCE: acknowledge at or after the deadline is refused even without a prior get', () => {
        completionCapabilities.hold('owner-a', { requestId, token, expiresAt: NOW + 10 });
        expect(completionCapabilities.acknowledge('owner-a', requestId, token, NOW + 10)).toBe(false);
        expect(completionCapabilities.get('owner-a', requestId, NOW)).toBeNull();
    });

    // Sam RETURN 1792547869 (2): acknowledgment binds to the exact held key, not just owner + request.
    it('CASUALTY: a delayed ACK for a replaced key C does not acknowledge the replacement D', () => {
        const replacement = 'd'.repeat(64);
        completionCapabilities.hold('owner-a', { requestId, token, expiresAt: NOW + 10 });
        completionCapabilities.hold('owner-a', { requestId, token: replacement, expiresAt: NOW + 10 });
        expect(completionCapabilities.acknowledge('owner-a', requestId, token, NOW)).toBe(false);
        expect(completionCapabilities.get('owner-a', requestId, NOW)).toEqual({ requestId, token: replacement, expiresAt: NOW + 10, acknowledged: false });
        expect(completionCapabilities.acknowledge('owner-a', requestId, replacement, NOW)).toBe(true);
    });

    it('CONTROL: reading as another owner does not evict the holding — only hold(newOwner) does (caller obligation)', () => {
        completionCapabilities.hold('owner-a', { requestId, token, expiresAt: NOW + 10 });
        expect(completionCapabilities.get('owner-b', requestId, NOW)).toBeNull();
        expect(completionCapabilities.get('owner-a', requestId, NOW)?.token).toBe(token);
    });

    it('is never written to web storage', () => {
        completionCapabilities.hold('owner-a', { requestId, token, expiresAt: NOW + 10 });
        expect(JSON.stringify({ ...localStorage })).not.toContain(token);
        expect(JSON.stringify({ ...sessionStorage })).not.toContain(token);
    });
});
