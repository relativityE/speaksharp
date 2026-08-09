import { describe, it, expect } from 'vitest';
import { progressInputsFromSessions, progressFromSessionHistory } from '../progressInputsFromSessions';
import type { PracticeSession } from '@/types/session';

const session = (over: Partial<PracticeSession>): PracticeSession => ({
    id: over.id ?? 'x', user_id: 'u', created_at: over.created_at ?? '2026-01-01T00:00:00Z',
    duration: over.duration ?? 600, ...over,
});

// #1222 S7 — real history → progress inputs: validated filler evidence only, oldest-first, honest exclusion.
describe('progressInputsFromSessions (#1222 S7)', () => {
    it('orders oldest-first regardless of input order', () => {
        const inputs = progressInputsFromSessions([
            session({ id: 'b', created_at: '2026-02-01T00:00:00Z', duration: 600, filler_words: { um: { count: 12 } } }),
            session({ id: 'a', created_at: '2026-01-01T00:00:00Z', duration: 600, filler_words: { um: { count: 30 } } }),
        ]);
        expect(inputs).toEqual([
            { fillerCount: 30, durationSeconds: 600 }, // Jan (oldest) first
            { fillerCount: 12, durationSeconds: 600 },
        ]);
    });

    it('EXCLUDES sessions with no valid filler evidence — never a flattering 0', () => {
        const inputs = progressInputsFromSessions([
            session({ id: 'ok', created_at: '2026-01-01T00:00:00Z', filler_words: { um: { count: 6 } } }),
            session({ id: 'empty', created_at: '2026-01-02T00:00:00Z', filler_words: {} }),
            session({ id: 'malformed', created_at: '2026-01-03T00:00:00Z', filler_words: { um: {} as { count: number } } }),
            session({ id: 'none', created_at: '2026-01-04T00:00:00Z' }),
        ]);
        expect(inputs).toEqual([{ fillerCount: 6, durationSeconds: 600 }]);
    });

    it('honours a genuine ZERO filler count (valid evidence of a clean session)', () => {
        const inputs = progressInputsFromSessions([
            session({ created_at: '2026-01-01T00:00:00Z', filler_words: { total: { count: 0 } } }),
        ]);
        expect(inputs).toEqual([{ fillerCount: 0, durationSeconds: 600 }]);
    });

    it('excludes sessions without a positive duration', () => {
        const inputs = progressInputsFromSessions([
            session({ created_at: '2026-01-01T00:00:00Z', duration: 0, filler_words: { um: { count: 5 } } }),
        ]);
        expect(inputs).toEqual([]);
    });

    it('progressFromSessionHistory composes the full metric (2 sessions → % delta)', () => {
        const result = progressFromSessionHistory([
            session({ id: '2', created_at: '2026-02-01T00:00:00Z', duration: 600, filler_words: { um: { count: 24 } } }), // 2.4/min
            session({ id: '1', created_at: '2026-01-01T00:00:00Z', duration: 600, filler_words: { um: { count: 34 } } }), // 3.4/min baseline
        ]);
        expect(result.isBaseline).toBe(false);
        expect(result.baselineRate).toBe(3.4);
        expect(result.currentRate).toBe(2.4);
        expect(result.direction).toBe('improved');
    });
});
