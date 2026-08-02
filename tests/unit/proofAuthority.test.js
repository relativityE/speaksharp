import { describe, it, expect } from 'vitest';
import { isPrivateV2PersistedDeviceType, extractUidFromAuthStorage, isNotFoundError } from '../live/helpers/proofAuthority.ts';

describe('#1151 proof-authority decisions (falsification)', () => {
    describe('persisted Private-v2 device_type', () => {
        it('accepts exactly "browser" and rejects wasm/cloud/native/empty', () => {
            expect(isPrivateV2PersistedDeviceType('browser')).toBe(true);
            expect(isPrivateV2PersistedDeviceType('wasm')).toBe(false);        // the old wrong expectation
            expect(isPrivateV2PersistedDeviceType('browser-wasm')).toBe(false);
            expect(isPrivateV2PersistedDeviceType('cloud')).toBe(false);
            expect(isPrivateV2PersistedDeviceType('native')).toBe(false);
            expect(isPrivateV2PersistedDeviceType(null)).toBe(false);
        });
    });

    describe('early UID capture from auth storage', () => {
        it('extracts UID from the object-session shape', () => {
            const entries = [{ key: 'sb-abc-auth-token', value: JSON.stringify({ user: { id: 'uid-1' } }) }];
            expect(extractUidFromAuthStorage(entries)).toBe('uid-1');
        });
        it('extracts UID from currentSession + JWT sub fallback', () => {
            expect(extractUidFromAuthStorage([{ key: 'sb-x-auth-token', value: JSON.stringify({ currentSession: { user: { id: 'uid-2' } } }) }])).toBe('uid-2');
            const jwt = `h.${Buffer.from(JSON.stringify({ sub: 'uid-3' })).toString('base64')}.s`;
            expect(extractUidFromAuthStorage([{ key: 'sb-y-auth-token', value: JSON.stringify({ access_token: jwt }) }])).toBe('uid-3');
        });
        it('returns null when no auth-token entry or no id is present', () => {
            expect(extractUidFromAuthStorage([{ key: 'unrelated', value: '{}' }])).toBeNull();
            expect(extractUidFromAuthStorage([{ key: 'sb-z-auth-token', value: 'not-json' }])).toBeNull();
            expect(extractUidFromAuthStorage([])).toBeNull();
        });
    });

    describe('deletion proof = only not-found', () => {
        it('treats 404 / not-found messages as deletion proof', () => {
            expect(isNotFoundError({ status: 404 })).toBe(true);
            expect(isNotFoundError({ code: 'user_not_found' })).toBe(true);
            expect(isNotFoundError({ message: 'User not found' })).toBe(true);
        });
        it('does NOT treat network/auth/rate-limit/other errors as deletion proof', () => {
            expect(isNotFoundError({ status: 500, message: 'internal' })).toBe(false);
            expect(isNotFoundError({ status: 429, message: 'rate limited' })).toBe(false);
            expect(isNotFoundError({ message: 'fetch failed' })).toBe(false);
            expect(isNotFoundError(null)).toBe(false);
            expect(isNotFoundError(undefined)).toBe(false);
        });
    });
});
