import { describe, it, expect, vi, beforeEach } from 'vitest';

// Record the query-builder calls so we can prove the read is NARROW and correctly scoped.
const calls: { select?: string; eq?: [string, unknown]; or?: string; order?: [string, unknown]; limit?: number } = {};
// An ELIGIBLE row (PROGRESS_AND_NEXT_ACTION §4): completed, ≥30s, ≥75 words, transcript present,
// attribution verified. `ai_suggestions` is absent here, so `fix` is null for a different reason —
// there is no review to quote. The eligibility casualties live in sessionEligibility.test.ts.
const row = {
    id: 's1', created_at: '2026-07-20T00:00:00.000Z', duration: 100, status: 'completed',
    total_words: 180, transcript_state: 'available', attribution_status: 'verified',
};
const builder = {
    select: vi.fn((s: string) => { calls.select = s; return builder; }),
    eq: vi.fn((c: string, v: unknown) => { calls.eq = [c, v]; return builder; }),
    or: vi.fn((f: string) => { calls.or = f; return builder; }),
    order: vi.fn((c: string, o: unknown) => { calls.order = [c, o]; return builder; }),
    limit: vi.fn((n: number) => { calls.limit = n; return Promise.resolve({ data: [row], error: null }); }),
};
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ from: vi.fn(() => builder) }) }));

import { sessionService } from '../domainServices';

describe('sessionService.getRecentReviewable (#1042 PR4 — narrow Practice Home read)', () => {
    beforeEach(() => { (Object.keys(calls) as Array<keyof typeof calls>).forEach((k) => delete calls[k]); });

    /*
     * Brief H-4 widened this read by EXACTLY ONE column. `ai_suggestions` is the review
     * `get-ai-suggestions` already cached on the row, and the resume band quotes its fix sentence. The
     * read stays narrow in every other respect — no transcript, scores, WPM, engine or accuracy data —
     * and the service reduces the payload to a plain string before it leaves, so no prose reaches the
     * typed session model.
     */
    it('selects the narrow row plus exactly what H-4 needs — never transcript text, scores, WPM or engine data', async () => {
        await sessionService.getRecentReviewable('user-1');
        expect(calls.select).toBe('id, created_at, duration, status, total_words, transcript_state, attribution_status, ai_suggestions');
        // `transcript_state` is a presence FLAG; the transcript text itself is still never selected.
        expect(calls.select ?? '').not.toMatch(/(^|[ ,])transcript([ ,]|$)|wpm|filler|engine|clarity|accuracy|ground_truth|custom_words|pause_metrics/i);
    });

    it('CASUALTY: an INELIGIBLE row lends no lesson, even when it carries cached coaching', async () => {
        // `get-ai-suggestions` does not apply the §4 gates before caching, so the reader must. A four-second
        // take with a cached review must still resolve `fix` to null, or Home quotes it as the user's lesson.
        const coaching = {
            version: 'gemini_coaching_v1',
            what_worked: 'Clear opening.',
            what_to_try_next: 'Pause instead of filling the gap.',
        };
        // Restore the shared stub afterwards: leaving it overridden would silently feed this row to every
        // later test in the file.
        const limit = builder.limit;
        builder.limit = vi.fn((n: number) => {
            calls.limit = n;
            return Promise.resolve({ data: [{ ...row, duration: 4, ai_suggestions: coaching }], error: null });
        });
        const rows = await sessionService.getRecentReviewable('user-1');
        expect(rows[0].fix).toBeNull();
        // ...while the same row, eligible, does surrender its fix.
        builder.limit = vi.fn((n: number) => {
            calls.limit = n;
            return Promise.resolve({ data: [{ ...row, ai_suggestions: coaching }], error: null });
        });
        const eligible = await sessionService.getRecentReviewable('user-1');
        expect(eligible[0].fix).toBe('Pause instead of filling the gap.');
        builder.limit = limit;
    });

    it('reduces the cached review to the fix sentence, and to null when there is none to quote', async () => {
        const rows = await sessionService.getRecentReviewable('user-1');
        // The fixture row carries no review at all.
        expect(rows[0].fix).toBeNull();
        expect(rows[0]).not.toHaveProperty('ai_suggestions');
    });

    it('restricts to this user, reviewable rows only (null or completed), newest-first, limit 1', async () => {
        const rows = await sessionService.getRecentReviewable('user-1');
        expect(calls.eq).toEqual(['user_id', 'user-1']);
        expect(calls.or).toBe('status.is.null,status.eq.completed'); // excludes active/failed
        expect(calls.order).toEqual(['created_at', { ascending: false }]);
        expect(calls.limit).toBe(1);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ id: 's1', status: 'completed' });
    });
});
