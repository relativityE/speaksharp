import { describe, it, expect, vi, beforeEach } from 'vitest';

// A flexible supabase mock: the evaluations list query is awaited; the recommendation query uses maybeSingle.
let evalRows: unknown[] = [];
let recRow: unknown = null;
const maybeSingle = vi.fn(async () => ({ data: recRow, error: null }));
function chain(kind: 'evals' | 'rec') {
    const c: Record<string, unknown> = {};
    c.select = () => c; c.eq = () => c; c.maybeSingle = maybeSingle;
    (c as { then?: unknown }).then = (resolve: (v: unknown) => void) => resolve({ data: evalRows, error: null });
    return kind === 'rec' ? { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }) } : c;
}
const from = vi.fn((table: string) => chain(table === 'progress_recommendations' ? 'rec' : 'evals'));
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ from }) }));
vi.mock('@/lib/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } }));

import { loadSessionProgress } from '../loadSessionProgress';

const ev = (session_id: string, over: Record<string, unknown> = {}) => ({
    session_id, eligible: true, clarity_raw: 90, filler_count: 3, wpm: 140, word_count: 200,
    cohort_key: 'private|v2|base|clarity_v1', ...over,
});
const times = {
    s0: '2026-07-01T00:00:00Z', s1: '2026-07-10T00:00:00Z', s2: '2026-07-20T00:00:00Z',
};

beforeEach(() => { evalRows = []; recRow = null; from.mockClear(); maybeSingle.mockClear(); });

describe('#1045 loadSessionProgress', () => {
    it('returns null when the session has no eligible evaluation (incl. tables absent)', async () => {
        evalRows = [ev('s2', { eligible: false })];
        expect(await loadSessionProgress('s2', times)).toBeNull();
    });

    it('picks baseline (oldest) and previous (newest prior) by persisted created_at within the cohort', async () => {
        evalRows = [ev('s0', { clarity_raw: 80 }), ev('s1', { clarity_raw: 84 }), ev('s2', { clarity_raw: 90 })];
        recRow = { id: 'rec-2' };
        const view = await loadSessionProgress('s2', times);
        expect(view).not.toBeNull();
        // s2 (90) vs baseline s0 (80) = +10 -> improved, above the 3-pt threshold.
        expect(view!.direction.direction).toBe('improved');
        expect(view!.recommendationId).toBe('rec-2');
        // Exactly two takeaways present.
        expect(view!.takeaways.whatWorked.length).toBeGreaterThan(0);
        expect(view!.takeaways.practiceThisNext.length).toBeGreaterThan(0);
    });

    it('excludes a different-cohort prior session from the comparison', async () => {
        evalRows = [
            ev('s0', { clarity_raw: 40, cohort_key: 'OTHER' }), // different cohort — must be ignored
            ev('s2', { clarity_raw: 90 }),
        ];
        const view = await loadSessionProgress('s2', times);
        // No same-cohort prior -> baseline established, not a fabricated comparison.
        expect(view!.direction.direction).toBe('baseline');
    });
});
