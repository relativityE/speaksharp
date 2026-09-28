import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    LOGIN_SESSION_LOG_KEY, clearLoginSessions, currentLogin, loginStartedAtOf, readLoginSessions, recordSavedSession,
    recordSavedSessionForCurrentLogin, setCurrentLogin,
} from '../loginSessionLog';

/** FEEDBACK_SESSION_SELECTOR_SPEC §5 — the sessions saved during THIS login (S-9, S-10, S-11 and the storage rules). */
describe('loginSessionLog', () => {
    const LOGIN = 1_700_000_000_000;
    beforeEach(() => { sessionStorage.clear(); clearLoginSessions(); setCurrentLogin(null, null); });

    it('numbers entries 1..N in save order and ignores a repeated key (one save → one entry)', () => {
        recordSavedSession('u1', LOGIN, { key: 'a', product: 'open_mic', savedAt: 1 });
        recordSavedSession('u1', LOGIN, { key: 'b', product: 'focus_points', savedAt: 2 });
        recordSavedSession('u1', LOGIN, { key: 'a', product: 'open_mic', savedAt: 3 });
        expect(readLoginSessions('u1', LOGIN).map((e) => [e.key, e.n])).toEqual([['a', 1], ['b', 2]]);
    });

    it('S-10: a reload in the same login keeps the list and numbers; a different login or owner gives [] and removes it', () => {
        recordSavedSession('u1', LOGIN, { key: 'a', product: 'open_mic', savedAt: 1 });
        // A reload: storage persists in the tab; the same owner and login read it back.
        expect(readLoginSessions('u1', LOGIN)).toHaveLength(1);
        expect(readLoginSessions('u1', LOGIN + 1)).toEqual([]);          // a new sign-in
        expect(sessionStorage.getItem(LOGIN_SESSION_LOG_KEY)).toBeNull();
        recordSavedSession('u1', LOGIN, { key: 'a', product: 'open_mic', savedAt: 1 });
        expect(readLoginSessions('u2', LOGIN)).toEqual([]);              // another account
        expect(readLoginSessions(null, null)).toEqual([]);
    });

    it('S-9: clearLoginSessions (AuthProvider sign-out / account change) empties it; numbering restarts at 1', () => {
        recordSavedSession('u1', LOGIN, { key: 'a', product: 'open_mic', savedAt: 1 });
        recordSavedSession('u1', LOGIN, { key: 'b', product: 'open_mic', savedAt: 2 });
        clearLoginSessions();
        recordSavedSession('u1', LOGIN + 5, { key: 'c', product: 'open_mic', savedAt: 3 });
        expect(readLoginSessions('u1', LOGIN + 5).map((e) => [e.key, e.n])).toEqual([['c', 1]]);
    });

    it('stores only in sessionStorage — never localStorage', () => {
        recordSavedSession('u1', LOGIN, { key: 'a', product: 'open_mic', savedAt: 1 });
        expect(sessionStorage.getItem(LOGIN_SESSION_LOG_KEY)).not.toBeNull();
        expect(localStorage.getItem(LOGIN_SESSION_LOG_KEY)).toBeNull();
    });

    it('parses defensively: malformed JSON or an entry missing a field is dropped, never thrown', () => {
        sessionStorage.setItem(LOGIN_SESSION_LOG_KEY, '{not json');
        expect(() => readLoginSessions('u1', LOGIN)).not.toThrow();
        expect(readLoginSessions('u1', LOGIN)).toEqual([]);
        sessionStorage.setItem(LOGIN_SESSION_LOG_KEY, JSON.stringify({
            ownerId: 'u1', loginStartedAt: LOGIN,
            entries: [{ key: 'ok', n: 1, product: 'open_mic', savedAt: 1 }, { key: 'x', n: 2, product: 'nope', savedAt: 2 }, { n: 3 }],
        }));
        expect(readLoginSessions('u1', LOGIN).map((e) => e.key)).toEqual(['ok']);
    });

    it('if sessionStorage is unavailable, an in-memory list serves the tab; no numbers are invented', () => {
        const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
        try {
            recordSavedSession('u1', LOGIN, { key: 'a', product: 'open_mic', savedAt: 1 });
            expect(readLoginSessions('u1', LOGIN).map((e) => e.n)).toEqual([1]);
        } finally {
            spy.mockRestore();
        }
    });

    it('loginStartedAt is the server sign-in time: a refresh keeps it, a new sign-in changes it', () => {
        expect(loginStartedAtOf({ user: { last_sign_in_at: '2026-09-28T10:00:00Z' } })).toBe(Date.parse('2026-09-28T10:00:00Z'));
        expect(loginStartedAtOf({ user: { last_sign_in_at: null } })).toBeNull();
        expect(loginStartedAtOf(null)).toBeNull();
        setCurrentLogin('u1', LOGIN);
        expect(currentLogin()).toEqual({ ownerId: 'u1', loginStartedAt: LOGIN });
        recordSavedSessionForCurrentLogin({ key: 'a', product: 'open_mic', savedAt: 1 });
        expect(readLoginSessions('u1', LOGIN)).toHaveLength(1);
        setCurrentLogin(null, null);
        recordSavedSessionForCurrentLogin({ key: 'b', product: 'open_mic', savedAt: 2 });   // no login known: ignored
        expect(readLoginSessions('u1', LOGIN)).toHaveLength(1);
    });

    it('S-11: recorded only at the controller\'s confirmed-save boundary — one call site, gated on a persisted save', () => {
        const src = readFileSync(resolve(__dirname, '../SpeechRuntimeController.ts'), 'utf8');
        expect([...src.matchAll(/recordSavedSessionForCurrentLogin\(/g)]).toHaveLength(1);
        const at = src.indexOf('recordSavedSessionForCurrentLogin(');
        const guard = src.lastIndexOf('if (persisted && details?.sessionId', at);
        expect(guard).toBeGreaterThan(-1);
        expect(at - guard).toBeLessThan(200);
        // The guard lives in updateSessionPersisted, which every completed save (and only a completed save) calls with true.
        expect(src.slice(src.lastIndexOf('private updateSessionPersisted(', at), at)).toContain('persisted: boolean');
    });
});
