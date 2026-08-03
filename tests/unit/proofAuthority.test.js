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

    describe('structured Private runtime identity (Transformers.js/WASM; allows device browser)', () => {
        // The full launch identity: Private producing mode + Transformers.js/WASM engine + default model + no fallback.
        const base = { serviceMode: 'private', provider: 'transformers.js', engine: 'transformers-js', privateModelKey: 'whisper-base.en', fallbackOccurred: false };
        it('accepts Private + Transformers.js/WASM engine + default (non-tiny) model + no fallback (v2 and v4 engines)', () => {
            expect(isPrivateRuntimeIdentity(base).ok).toBe(true);
            expect(isPrivateRuntimeIdentity({ ...base, serviceMode: 'PRIVATE', fallbackOccurred: undefined }).ok).toBe(true);
            // v4 on-device engine id is also accepted.
            expect(isPrivateRuntimeIdentity({ ...base, engine: 'transformers-js-v4', provider: 'transformers.js (webgpu)' }).ok).toBe(true);
        });
        it('rejects cloud/native producing mode, the tiny emergency fallback model, and any fallback/handoff', () => {
            expect(isPrivateRuntimeIdentity({ ...base, serviceMode: 'cloud' }).ok).toBe(false);
            expect(isPrivateRuntimeIdentity({ ...base, serviceMode: 'native' }).ok).toBe(false);
            expect(isPrivateRuntimeIdentity({ ...base, privateModelKey: 'whisper-tiny.en' }).ok).toBe(false);
            expect(isPrivateRuntimeIdentity({ ...base, fallbackOccurred: true }).ok).toBe(false);
            expect(isPrivateRuntimeIdentity({ serviceMode: '', privateModelKey: null }).ok).toBe(false);
        });
        it('rejects a Private-LABELLED session whose resolved engine is NOT Transformers.js/WASM (mislabel / silent handoff)', () => {
            // serviceMode says 'private' but the engine identity betrays a cloud / web-speech backend — must fail.
            expect(isPrivateRuntimeIdentity({ ...base, provider: 'assemblyai', engine: 'assemblyai' }).ok).toBe(false);
            expect(isPrivateRuntimeIdentity({ ...base, provider: 'web-speech-api', engine: 'web-speech-api' }).ok).toBe(false);
            // Missing/absent engine identity is insufficient — a generic 'private' signal cannot pass.
            expect(isPrivateRuntimeIdentity({ serviceMode: 'private', privateModelKey: 'whisper-base.en' }).ok).toBe(false);
            expect(isPrivateRuntimeIdentity({ ...base, engine: 'transformers-js-tiny' }).ok).toBe(false);
        });
    });
});
