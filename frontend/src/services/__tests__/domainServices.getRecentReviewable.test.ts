import { describe, it, expect, vi, beforeEach } from 'vitest';

// Record the query-builder calls so we can prove the read is NARROW and correctly scoped.
const calls: {
    select?: string; eq?: [string, unknown]; or?: string; order?: [string, unknown]; limit?: number;
    tables?: string[]; verdictSelect?: string; verdictEq?: [string, unknown];
} = {};
// An ELIGIBLE row (PROGRESS_AND_NEXT_ACTION §4): completed, ≥30s, ≥75 words, transcript present,
// attribution verified. `ai_suggestions` is absent here, so `fix` is null for a different reason —
// there is no review to quote. The eligibility casualties live in sessionEligibility.test.ts.
const row = {
    id: 's1', created_at: '2026-07-20T00:00:00.000Z', duration: 100, status: 'completed',
};
const COACHING = {
    version: 'gemini_coaching_v1',
    what_worked: 'Clear opening.',
    what_to_try_next: 'Pause instead of filling the gap.',
};
const builder = {
    select: vi.fn((sel: string) => { calls.select = sel; return builder; }),
    eq: vi.fn((c: string, v: unknown) => { calls.eq = [c, v]; return builder; }),
    or: vi.fn((f: string) => { calls.or = f; return builder; }),
    order: vi.fn((c: string, o: unknown) => { calls.order = [c, o]; return builder; }),
    limit: vi.fn((n: number) => { calls.limit = n; return Promise.resolve({ data: [row], error: null }); }),
};

/**
 * The authoritative persisted verdict this test run should return for
 * `session_progress_evaluations` — `{ data: null }` stands for "never evaluated".
 */
let verdictRow: { data: unknown; error: unknown } = { data: { eligible: true, exclusion_reasons: [] }, error: null };
const verdictBuilder = {
    select: vi.fn((sel: string) => { calls.verdictSelect = sel; return verdictBuilder; }),
    eq: vi.fn((c: string, v: unknown) => { calls.verdictEq = [c, v]; return verdictBuilder; }),
    order: vi.fn(() => verdictBuilder),
    limit: vi.fn(() => verdictBuilder),
    maybeSingle: vi.fn(() => Promise.resolve(verdictRow)),
};

const from = vi.fn((table: string) => {
    (calls.tables ??= []).push(table);
    return table === 'session_progress_evaluations' ? verdictBuilder : builder;
});

vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ from }) }));

import { sessionService } from '../domainServices';

describe('sessionService.getRecentReviewable (#1042 PR4 — narrow Practice Home read)', () => {
    beforeEach(() => {
        (Object.keys(calls) as Array<keyof typeof calls>).forEach((k) => delete calls[k]);
        verdictRow = { data: { eligible: true, exclusion_reasons: [] }, error: null };
        from.mockClear();
    });

    /** Point the single-row read at a specific row for one assertion, then restore the shared stub. */
    const withRow = async (patch: Record<string, unknown>) => {
        const limit = builder.limit;
        builder.limit = vi.fn((n: number) => {
            calls.limit = n;
            return Promise.resolve({ data: [{ ...row, ...patch }], error: null });
        });
        try {
            return await sessionService.getRecentReviewable('user-1');
        } finally {
            builder.limit = limit;
        }
    };

    /*
     * Brief H-4 widened this read by EXACTLY ONE column. `ai_suggestions` is the review
     * `get-ai-suggestions` already cached on the row, and the resume band quotes its fix sentence. The
     * read stays narrow in every other respect — no transcript, scores, WPM, engine or accuracy data —
     * and the service reduces the payload to a plain string before it leaves, so no prose reaches the
     * typed session model.
     */
    it('selects the narrow row plus exactly what H-4 needs — never transcript text, scores, WPM or engine data', async () => {
        await sessionService.getRecentReviewable('user-1');
        expect(calls.select).toBe('id, created_at, duration, status, ai_suggestions');
        expect(calls.select ?? '').not.toMatch(/(^|[ ,])transcript([ ,]|$)|wpm|filler|engine|clarity|accuracy|ground_truth|custom_words|pause_metrics/i);
        // Eligibility is not re-derived from columns, so none of its inputs are selected here — the
        // advisory `attribution_status` least of all.
        expect(calls.select ?? '').not.toMatch(/attribution_status|total_words|transcript_state/);
    });

    it('CASUALTY: an INELIGIBLE verdict lends no lesson, even when the row carries cached coaching', async () => {
        // `get-ai-suggestions` does not apply the §4 gates before caching, so the reader must consult the
        // verdict. Every excluded reason behaves the same — including the two a hand-written gate missed.
        for (const reason of ['too_short', 'too_few_words', 'no_transcript', 'unverified_attribution',
            'no_clarity_evidence', 'engine_not_comparable']) {
            verdictRow = { data: { eligible: false, exclusion_reasons: [reason] }, error: null };
            const rows = await withRow({ ai_suggestions: COACHING });
            expect(rows[0].fix, `reason ${reason}`).toBeNull();
        }
    });

    it('CASUALTY: never evaluated ⇒ no lesson — absence of a verdict is not a pass', async () => {
        verdictRow = { data: null, error: null };
        const rows = await withRow({ ai_suggestions: COACHING });
        expect(rows[0].fix).toBeNull();
    });

    it('CASUALTY: an unreadable verdict fails closed', async () => {
        verdictRow = { data: null, error: { message: 'rls denied' } };
        const rows = await withRow({ ai_suggestions: COACHING });
        expect(rows[0].fix).toBeNull();
    });

    it('CONTROL: an eligible verdict qualifies the session, read for THAT session', async () => {
        const rows = await withRow({ ai_suggestions: COACHING });
        expect(rows[0].fix).toBe('Pause instead of filling the gap.');
        expect(calls.tables).toContain('session_progress_evaluations');
        expect(calls.verdictSelect).toBe('eligible, exclusion_reasons');
        expect(calls.verdictEq).toEqual(['session_id', 's1']);
    });

    it('CASUALTY: with no cached coaching, the verdict is never even queried', async () => {
        const rows = await sessionService.getRecentReviewable('user-1');
        expect(rows[0].fix).toBeNull();
        expect(calls.tables).not.toContain('session_progress_evaluations');
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
