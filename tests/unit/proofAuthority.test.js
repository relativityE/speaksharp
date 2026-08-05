import { describe, it, expect } from 'vitest';
import {
    isPrivateV2PersistedDeviceType, extractUidFromAuthStorage, isNotFoundError, isPrivateRuntimeIdentity,
    matchesPrivatePersistedArm, composeEngineVersion, resolveRecoveryMatch,
    contentSafeSessionSnapshot, contentSafeSnapshotsEqual,
} from '../live/helpers/proofAuthority.ts';

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

    describe('structured Private runtime identity — anchored on the INSTANTIATED engine (P1.1 modelId + P1.2 runtimeProvider)', () => {
        // Launch identity: Private producing mode + the running engine's OWN provider (transformers-js) + real
        // running model (modelId) + no fallback. runtimeProvider comes from __PRIVATE_STT_RUNTIME_DEBUG__.provider
        // (the instantiated engine), NOT a serviceMode label; modelId is the real field (not privateModelKey).
        const base = { serviceMode: 'private', runtimeProvider: 'transformers-js', modelId: 'whisper-base.en', fallbackOccurred: false };

        it('1. real v2 on-device identity passes', () => {
            expect(isPrivateRuntimeIdentity(base).ok).toBe(true);
            expect(isPrivateRuntimeIdentity({ ...base, serviceMode: 'PRIVATE', fallbackOccurred: undefined }).ok).toBe(true);
        });
        it('2. approved v4 on-device identity passes when structurally produced', () => {
            expect(isPrivateRuntimeIdentity({ ...base, runtimeProvider: 'transformers-js-v4' }).ok).toBe(true);
        });
        it('3. private label + Browser (web-speech) running engine fails', () => {
            expect(isPrivateRuntimeIdentity({ ...base, runtimeProvider: 'web-speech-api' }).ok).toBe(false);
        });
        it('4. private label + Cloud (assemblyai) running engine fails', () => {
            expect(isPrivateRuntimeIdentity({ ...base, runtimeProvider: 'assemblyai' }).ok).toBe(false);
        });
        it('5. missing/unknown/ambiguous running engine identity fails (a generic private label cannot pass)', () => {
            expect(isPrivateRuntimeIdentity({ serviceMode: 'private', modelId: 'whisper-base.en' }).ok).toBe(false); // runtimeProvider absent
            expect(isPrivateRuntimeIdentity({ ...base, runtimeProvider: null }).ok).toBe(false);
            expect(isPrivateRuntimeIdentity({ ...base, runtimeProvider: 'transformers-js-tiny' }).ok).toBe(false); // not an exact family match
            expect(isPrivateRuntimeIdentity({ ...base, runtimeProvider: 'unknown' }).ok).toBe(false);
        });
        it('6. tiny/fallback/handoff fails', () => {
            expect(isPrivateRuntimeIdentity({ ...base, modelId: 'whisper-tiny.en' }).ok).toBe(false); // emergency tiny fallback model
            expect(isPrivateRuntimeIdentity({ ...base, fallbackOccurred: true }).ok).toBe(false);      // any runtime handoff
        });
        it('7. wrong/missing modelId fails (P1.1 — the real running model must be present and non-tiny)', () => {
            expect(isPrivateRuntimeIdentity({ serviceMode: 'private', runtimeProvider: 'transformers-js' }).ok).toBe(false); // modelId absent
            expect(isPrivateRuntimeIdentity({ ...base, modelId: null }).ok).toBe(false);
        });
        it('also rejects cloud/native producing mode outright', () => {
            expect(isPrivateRuntimeIdentity({ ...base, serviceMode: 'cloud' }).ok).toBe(false);
            expect(isPrivateRuntimeIdentity({ ...base, serviceMode: 'native' }).ok).toBe(false);
            expect(isPrivateRuntimeIdentity({ serviceMode: '', modelId: null, runtimeProvider: null }).ok).toBe(false);
        });
    });
    // 8. cleanup/persistence falsifications (persisted device_type, early-UID capture, 404-only deletion proof)
    //    are the sibling describe blocks above and remain green — unchanged by this P1 correction.

    describe('fix 2 (RETURN) — EXACT Private v2/v4 identity via repository mappings (no regex/substring)', () => {
        // the exact repository tuples: v2 = private_v2:whisper-base.en, v4 = private_v4:base_q4
        const v2 = {
            runtimeProvider: 'transformers-js', runtimeModelId: 'Xenova/whisper-base.en',
            persistedEngine: 'private', persistedEngineVersion: 'private_v2:whisper-base.en',
            persistedModelName: 'whisper-base.en', persistedDeviceType: 'browser',
        };
        const v4 = {
            runtimeProvider: 'transformers-js-v4', runtimeModelId: 'onnx-community/whisper-base.en',
            persistedEngine: 'private', persistedEngineVersion: 'private_v4:base_q4',
            persistedModelName: 'base_q4', persistedDeviceType: 'browser',
        };
        it('composeEngineVersion matches the app buildEngineVersion format', () => {
            expect(composeEngineVersion('private_v2', 'whisper-base.en')).toBe('private_v2:whisper-base.en');
            expect(composeEngineVersion('private_v4', 'base_q4')).toBe('private_v4:base_q4');
        });
        it('accepts the EXACT v2 and v4 repository tuples', () => {
            expect(matchesPrivatePersistedArm(v2)).toMatchObject({ ok: true, arm: 'v2' });
            expect(matchesPrivatePersistedArm(v4)).toMatchObject({ ok: true, arm: 'v4' });
        });
        it('REJECTS substring/near-miss engine_version — only EXACT `${variant}:${model}` passes', () => {
            expect(matchesPrivatePersistedArm({ ...v2, persistedEngineVersion: 'private_v2:whisper-base.en-extra' }).ok).toBe(false);
            expect(matchesPrivatePersistedArm({ ...v2, persistedEngineVersion: 'x-private_v2:whisper-base.en' }).ok).toBe(false);
            expect(matchesPrivatePersistedArm({ ...v2, persistedEngineVersion: 'transformers-js' }).ok).toBe(false); // the OLD loose value
            expect(matchesPrivatePersistedArm({ ...v2, persistedEngineVersion: 'private_v2:whisper-small.en' }).ok).toBe(false); // model≠engine_version model
        });
        it('REJECTS an arm mismatch (runtime v4 ↔ persisted v2, and vice-versa)', () => {
            expect(matchesPrivatePersistedArm({ ...v2, runtimeProvider: 'transformers-js-v4' }).ok).toBe(false);
            expect(matchesPrivatePersistedArm({ ...v4, runtimeProvider: 'transformers-js' }).ok).toBe(false);
        });
        it('REJECTS the tiny fallback, an unknown model, a non-browser device, a non-private engine, a non-Private runtime', () => {
            expect(matchesPrivatePersistedArm({ ...v2, persistedEngineVersion: 'private_v2:whisper-tiny.en', persistedModelName: 'whisper-tiny.en' }).ok).toBe(false);
            expect(matchesPrivatePersistedArm({ ...v2, runtimeModelId: 'Xenova/whisper-tiny.en' }).ok).toBe(false);
            expect(matchesPrivatePersistedArm({ ...v2, persistedEngineVersion: 'private_v2:mystery', persistedModelName: 'mystery' }).ok).toBe(false);
            expect(matchesPrivatePersistedArm({ ...v2, persistedDeviceType: 'wasm' }).ok).toBe(false);
            expect(matchesPrivatePersistedArm({ ...v2, persistedEngine: 'native' }).ok).toBe(false);
            expect(matchesPrivatePersistedArm({ ...v2, runtimeProvider: 'web-speech-api' }).ok).toBe(false);
            expect(matchesPrivatePersistedArm({ ...v2, runtimeProvider: 'assemblyai' }).ok).toBe(false);
        });
    });

    describe('fix 1 (RETURN) — bounded recovery match decision (zero/one/ambiguous/not-run-owned)', () => {
        const P = 'private-proof-';
        const mk = (email, id = 'u') => ({ id, email });
        it('ZERO when no user matches the exact email (→ caller retries / persistent-zero fails)', () => {
            expect(resolveRecoveryMatch([], 'private-proof-x@example.com', P).status).toBe('zero');
            expect(resolveRecoveryMatch([mk('other@example.com')], 'private-proof-x@example.com', P).status).toBe('zero');
        });
        it('ONE returns the uid for a unique run-owned exact match (zero→one transition)', () => {
            const users = [mk('private-proof-x@example.com', 'uid-9'), mk('someone@example.com', 'z')];
            expect(resolveRecoveryMatch(users, 'private-proof-x@example.com', P)).toEqual({ status: 'one', uid: 'uid-9' });
        });
        it('AMBIGUOUS when more than one user shares the exact email (fail closed)', () => {
            const users = [mk('private-proof-x@example.com', 'a'), mk('PRIVATE-PROOF-X@example.com', 'b')];
            expect(resolveRecoveryMatch(users, 'private-proof-x@example.com', P)).toEqual({ status: 'ambiguous', count: 2 });
        });
        it('NOT_RUN_OWNED when the sole exact match is not a run-owned account (refuse to delete)', () => {
            const users = [mk('real-customer@example.com', 'c')];
            expect(resolveRecoveryMatch(users, 'real-customer@example.com', P)).toMatchObject({ status: 'not_run_owned' });
        });
    });

    describe('fix 4 — content-safe reload equality', () => {
        const row = {
            id: 's1', user_id: 'u1', status: 'completed', transcript: 'hello world words here',
            engine: 'private', engine_version: 'private_v2:base', model_name: 'base', device_type: 'browser',
        };
        it('snapshot carries transcript LENGTH only — never the raw text', () => {
            const snap = contentSafeSessionSnapshot(row);
            expect(snap.transcriptLen).toBe('hello world words here'.length);
            expect(JSON.stringify(snap)).not.toContain('hello world'); // no raw transcript leaks
            expect(snap).toMatchObject({ id: 's1', status: 'completed', engine: 'private', deviceType: 'browser' });
        });
        it('equal for identical content-safe fields; UNEQUAL when any changes across reload', () => {
            const a = contentSafeSessionSnapshot(row);
            expect(contentSafeSnapshotsEqual(a, contentSafeSessionSnapshot({ ...row })).ok).toBe(true);
            // same length but DIFFERENT text ⇒ still equal (content-safe compares length, not text)
            expect(contentSafeSnapshotsEqual(a, contentSafeSessionSnapshot({ ...row, transcript: 'HELLO WORLD words here' })).ok).toBe(true);
            expect(contentSafeSnapshotsEqual(a, contentSafeSessionSnapshot({ ...row, status: 'failed' })).ok).toBe(false);
            expect(contentSafeSnapshotsEqual(a, contentSafeSessionSnapshot({ ...row, transcript: 'shorter' })).ok).toBe(false);
            expect(contentSafeSnapshotsEqual(a, contentSafeSessionSnapshot({ ...row, engine_version: 'private_v4:base_q4' })).ok).toBe(false);
        });
    });
});
