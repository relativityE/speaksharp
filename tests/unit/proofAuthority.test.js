import { describe, it, expect } from 'vitest';
import { isPrivateV2PersistedDeviceType, extractUidFromAuthStorage, isNotFoundError, isPrivateRuntimeIdentity } from '../live/helpers/proofAuthority.ts';

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

    describe('deletion proof = ONLY the documented 404 not-found shape', () => {
        it('requires status 404 AND a not-found code/message', () => {
            expect(isNotFoundError({ status: 404, code: 'user_not_found' })).toBe(true);
            expect(isNotFoundError({ status: 404, message: 'User not found' })).toBe(true);
            expect(isNotFoundError({ status: 404 })).toBe(false);               // 404 but no not-found text → ambiguous, fail closed
        });
        it('rejects non-404 errors that merely contain "user not found" text', () => {
            expect(isNotFoundError({ status: 500, message: 'user not found (transient)' })).toBe(false);
            expect(isNotFoundError({ status: 401, message: 'user not found' })).toBe(false);
            expect(isNotFoundError({ status: 429, message: 'user not found' })).toBe(false);
            expect(isNotFoundError({ code: 'user_not_found' })).toBe(false);    // no status
            expect(isNotFoundError({ message: 'fetch failed' })).toBe(false);
            expect(isNotFoundError(null)).toBe(false);
            expect(isNotFoundError(undefined)).toBe(false);
        });
    });

    describe('structured Private runtime identity (allows device browser)', () => {
        it('accepts private serviceMode + default (non-tiny) model + no v4 fallback', () => {
            expect(isPrivateRuntimeIdentity({ serviceMode: 'private', privateModelKey: 'whisper-base.en', fallbackOccurred: false }).ok).toBe(true);
            expect(isPrivateRuntimeIdentity({ serviceMode: 'PRIVATE', privateModelKey: 'whisper-base.en' }).ok).toBe(true);
        });
        it('rejects cloud/native producing mode, the tiny emergency fallback model, and v4 fallback', () => {
            expect(isPrivateRuntimeIdentity({ serviceMode: 'cloud', privateModelKey: 'whisper-base.en' }).ok).toBe(false);
            expect(isPrivateRuntimeIdentity({ serviceMode: 'native', privateModelKey: 'whisper-base.en' }).ok).toBe(false);
            expect(isPrivateRuntimeIdentity({ serviceMode: 'private', privateModelKey: 'whisper-tiny.en' }).ok).toBe(false);
            expect(isPrivateRuntimeIdentity({ serviceMode: 'private', privateModelKey: 'whisper-base.en', fallbackOccurred: true }).ok).toBe(false);
            expect(isPrivateRuntimeIdentity({ serviceMode: '', privateModelKey: null }).ok).toBe(false);
        });
    });
});
