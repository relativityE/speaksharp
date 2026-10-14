/* @vitest-environment jsdom */
// #1258 (Codex P2 r4275718056) — the pending-attempt readback carries the attempt's server `accepted_at` (normalized to a
// canonical ISO string; absent/invalid → null). It only CONFIRMS that a locally recorded press created this attempt; the
// acceptance time itself stays on the client clock (Codex P2 r4275389955).
import { describe, expect, it, vi } from 'vitest';

let rows: unknown[] = [];
let selected = '';
vi.mock('@/lib/supabaseClient', () => ({
    getSupabaseClient: () => ({
        from: () => {
            const c: Record<string, unknown> = {};
            c.select = (cols: string) => { selected = cols; return c; };
            c.eq = () => c;
            c.limit = async () => ({ data: rows, error: null });
            return c;
        },
    }),
}));
vi.mock('@/lib/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
const { readPendingRecommendationAttempt } = await import('../recordProgress');

describe('#1258 — readPendingRecommendationAttempt returns the server acceptance time (identity confirmation only, Codex P2 r4275718056)', () => {
    it('reads accepted_at and normalizes it', async () => {
        rows = [{ id: 'att-1', recommendation_id: 'rec-1', lifecycle: 'pending', accepted_at: '2026-10-14 11:00:00.123456+00' }];
        expect(await readPendingRecommendationAttempt('rec-1')).toEqual({ status: 'one', attemptId: 'att-1', acceptedAtIso: '2026-10-14T11:00:00.123Z' });
        expect(selected).toContain('accepted_at');
    });
    it('a missing or unparseable accepted_at is null (the caller keeps its own press time)', async () => {
        rows = [{ id: 'att-1', recommendation_id: 'rec-1', lifecycle: 'pending', accepted_at: 'not a time' }];
        expect(await readPendingRecommendationAttempt('rec-1')).toEqual({ status: 'one', attemptId: 'att-1', acceptedAtIso: null });
    });
});
