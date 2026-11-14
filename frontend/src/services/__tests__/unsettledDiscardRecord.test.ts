// @vitest-environment jsdom
/** G5 (#1861) — the owner-bound, content-free record of an unsettled discard (review on a95ca10). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    UNSETTLED_DISCARD_MAX_AGE_MS,
    clearUnsettledDiscardRecord,
    getUnsettledDiscardRecordForUser,
    saveUnsettledDiscardRecord,
} from '../unsettledDiscardRecord';

const KEY = 'speaksharp_unsettled_discard';
const REASON = 'Session was shorter than the minimum duration; session was not saved to history.';

describe('unsettledDiscardRecord', () => {
    beforeEach(() => { localStorage.clear(); vi.useRealTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('is read only for its own owner, and an ownerless take is never recorded', () => {
        saveUnsettledDiscardRecord({ sessionId: 's1', userId: 'a', reason: REASON });
        expect(getUnsettledDiscardRecordForUser('a')?.sessionId).toBe('s1');
        expect(getUnsettledDiscardRecordForUser('b')).toBeNull();
        expect(getUnsettledDiscardRecordForUser(null)).toBeNull();
        localStorage.clear();
        saveUnsettledDiscardRecord({ sessionId: 's1', userId: null, reason: REASON });
        expect(localStorage.getItem(KEY)).toBeNull();
    });

    it('ignores a record whose owner is not its key, and malformed data', () => {
        const now = new Date().toISOString();
        localStorage.setItem(KEY, JSON.stringify({ a: { sessionId: 's1', userId: 'b', reason: REASON, savedAt: now } }));
        expect(getUnsettledDiscardRecordForUser('a')).toBeNull();
        expect(getUnsettledDiscardRecordForUser('b')).toBeNull();
        for (const raw of ['not json', '[]', '"x"', JSON.stringify({ a: 'x' })]) {
            localStorage.setItem(KEY, raw);
            expect(getUnsettledDiscardRecordForUser('a')).toBeNull();
        }
    });

    it('clears only the record that names this session', () => {
        saveUnsettledDiscardRecord({ sessionId: 's1', userId: 'a', reason: REASON });
        clearUnsettledDiscardRecord('a', 'other');
        expect(getUnsettledDiscardRecordForUser('a')?.sessionId).toBe('s1');
        clearUnsettledDiscardRecord('a', 's1');
        expect(getUnsettledDiscardRecordForUser('a')).toBeNull();
        expect(localStorage.getItem(KEY)).toBeNull();
    });

    it('keeps an owner\'s older record rather than overwriting it with another row', () => {
        saveUnsettledDiscardRecord({ sessionId: 's1', userId: 'a', reason: REASON });
        saveUnsettledDiscardRecord({ sessionId: 's2', userId: 'a', reason: REASON });
        expect(getUnsettledDiscardRecordForUser('a')?.sessionId).toBe('s1');
    });

    it('stops re-arming a record past the age bound, or one dated in the future or undated', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-14T00:00:00Z'));
        saveUnsettledDiscardRecord({ sessionId: 's1', userId: 'a', reason: REASON });
        vi.setSystemTime(new Date(Date.parse('2026-11-14T00:00:00Z') + UNSETTLED_DISCARD_MAX_AGE_MS));
        expect(getUnsettledDiscardRecordForUser('a')?.sessionId).toBe('s1');
        vi.setSystemTime(new Date(Date.parse('2026-11-14T00:00:00Z') + UNSETTLED_DISCARD_MAX_AGE_MS + 1));
        expect(getUnsettledDiscardRecordForUser('a')).toBeNull();
        saveUnsettledDiscardRecord({ sessionId: 's2', userId: 'a', reason: REASON });
        expect(getUnsettledDiscardRecordForUser('a')?.sessionId, 'an expired record does not block a new one').toBe('s2');

        const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        localStorage.setItem(KEY, JSON.stringify({ a: { sessionId: 's1', userId: 'a', reason: REASON, savedAt: future } }));
        expect(getUnsettledDiscardRecordForUser('a')).toBeNull();
        localStorage.setItem(KEY, JSON.stringify({ a: { sessionId: 's1', userId: 'a', reason: REASON } }));
        expect(getUnsettledDiscardRecordForUser('a')).toBeNull();
    });

    it('holds at most twenty owners and never a field over the bound', () => {
        for (let i = 0; i < 21; i++) saveUnsettledDiscardRecord({ sessionId: `s${i}`, userId: `u${i}`, reason: REASON });
        expect(getUnsettledDiscardRecordForUser('u19')?.sessionId).toBe('s19');
        expect(getUnsettledDiscardRecordForUser('u20')).toBeNull();
        saveUnsettledDiscardRecord({ sessionId: 'x'.repeat(201), userId: 'u0', reason: REASON });
        expect(getUnsettledDiscardRecordForUser('u0')?.sessionId).toBe('s0');
    });
});
