// @vitest-environment node
/** #1258 PR 4 (Browser PM 6050746477) — a restored row is shown only to its owner; the id alone is not ownership. */
import { describe, it, expect } from 'vitest';
import type { PracticeSession } from '@/types/session';
import { restorableSession, restoreRefused } from '../restorableSession';

const row = (over: Partial<PracticeSession> = {}) => ({ id: 's1', user_id: 'owner-b', created_at: '', duration: 60, ...over } as PracticeSession);

describe('restorableSession', () => {
    it('shows the requested row to its owner', () => {
        expect(restorableSession(row(), 's1', 'owner-b')).toEqual(row());
    });
    it('CASUALTY: a cached row of ANOTHER account is never shown, even when the id matches', () => {
        expect(restorableSession(row({ user_id: 'owner-a' }), 's1', 'owner-b')).toBeNull();
        expect(restoreRefused(row({ user_id: 'owner-a' }), 's1', 'owner-b')).toBe(true);
    });
    it('a different id, a missing row, or an unsettled owner shows nothing', () => {
        expect(restorableSession(row(), 's2', 'owner-b')).toBeNull();
        expect(restorableSession(null, 's1', 'owner-b')).toBeNull();
        expect(restorableSession(row(), 's1', null)).toBeNull();
    });
    it('refuses (falls back) only once the owner is known; an unsettled owner waits', () => {
        expect(restoreRefused(null, 's1', 'owner-b')).toBe(true);
        expect(restoreRefused(row(), 's1', 'owner-b')).toBe(false);
        expect(restoreRefused(row({ user_id: 'owner-a' }), 's1', null)).toBe(false);
    });
});
