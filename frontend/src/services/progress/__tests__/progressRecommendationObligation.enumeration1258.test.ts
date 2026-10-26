/* @vitest-environment jsdom */
// #1258 (Codex P2 r4273254647) — a concurrent removal in another tab cannot hide a recommendation obligation.
//
// `listRecommendationObligations` walked `localStorage.key(i)` once. When another tab retired an obligation mid-walk,
// every later key shifted down one index and the next one was skipped. On-load recovery runs once per authenticated
// user, so a skipped obligation stayed unrecovered until a later reload. The reconcile queue already enumerates until
// two consecutive passes agree (`stableQueueKeys`); the obligation store must do the same.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listRecommendationObligations, recordRecommendationObligation } from '../progressRecommendationObligation';

vi.mock('@/lib/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const USER = 'user-1';
const NOW = '2026-10-14T12:00:00.000Z';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('#1258 — obligation enumeration is stable under a concurrent removal', () => {
    it('another tab retiring the first obligation mid-walk does not hide the next one', () => {
        for (const s of ['s-a', 's-b', 's-c']) expect(recordRecommendationObligation(USER, s, NOW).ok).toBe(true);
        const firstKey = localStorage.key(0)!;
        const retiredSession = decodeURIComponent(firstKey.split('|')[2]);
        const realKey = Storage.prototype.key;
        let raced = false;
        vi.spyOn(Storage.prototype, 'key').mockImplementation(function (this: Storage, i: number) {
            // As the walk reaches index 1, another tab retires the obligation at index 0.
            if (i === 1 && !raced) { raced = true; this.removeItem(firstKey); }
            return realKey.call(this, i);
        });
        const listed = listRecommendationObligations(USER);
        expect(listed.ok).toBe(true);
        const sessions = listed.ok ? listed.entries.map((e) => e.sessionId).sort() : [];
        expect(sessions).toEqual(['s-a', 's-b', 's-c'].filter((s) => s !== retiredSession));
    });

    it('a store that never holds still is unreadable (ok: false), never a short list', () => {
        for (const s of ['s-a', 's-b']) recordRecommendationObligation(USER, s, NOW);
        const realKey = Storage.prototype.key;
        let n = 0;
        vi.spyOn(Storage.prototype, 'key').mockImplementation(function (this: Storage, i: number) {
            // Every pass sees a different key set: a fresh obligation lands each time index 0 is read.
            if (i === 0) recordRecommendationObligation(USER, `s-new-${n++}`, NOW);
            return realKey.call(this, i);
        });
        expect(listRecommendationObligations(USER).ok).toBe(false);
    });
});
