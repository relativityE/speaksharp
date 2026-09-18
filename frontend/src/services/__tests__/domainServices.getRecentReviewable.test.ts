import { describe, it, expect, vi, beforeEach } from 'vitest';

// Record the query-builder calls so we can prove the read is NARROW and correctly scoped.
const calls: {
    select?: string; eq?: [string, unknown]; or?: string; order?: [string, unknown]; limit?: number;
    rpc?: [string, Record<string, unknown>];
} = {};
// An ELIGIBLE row (PROGRESS_AND_NEXT_ACTION §4): completed, ≥30s, ≥75 words, transcript present,
// attribution verified. `ai_suggestions` is absent here, so `fix` is null for a different reason —
// there is no review to quote. The eligibility casualties live in sessionEligibility.test.ts.
const row = {
    id: 's1', created_at: '2026-07-20T00:00:00.000Z', duration: 100, status: 'completed',
    total_words: 180, transcript_state: 'available',
    // Present but ADVISORY (migration 20260803010000). The gate must ignore it and read the authority.
    attribution_status: 'verified',
};
const COACHING = {
    version: 'gemini_coaching_v1',
    what_worked: 'Clear opening.',
    what_to_try_next: 'Pause instead of filling the gap.',
};
/** The owner-scoped `get_attribution_authority_v1` verdict this test run should return. */
let authorityVerdict: { data: unknown; error: unknown } = { data: 'attrib_v1', error: null };
const rpc = vi.fn((fn: string, args: Record<string, unknown>) => {
    calls.rpc = [fn, args];
    return Promise.resolve(authorityVerdict);
});
const builder = {
    select: vi.fn((s: string) => { calls.select = s; return builder; }),
    eq: vi.fn((c: string, v: unknown) => { calls.eq = [c, v]; return builder; }),
    or: vi.fn((f: string) => { calls.or = f; return builder; }),
    order: vi.fn((c: string, o: unknown) => { calls.order = [c, o]; return builder; }),
    limit: vi.fn((n: number) => { calls.limit = n; return Promise.resolve({ data: [row], error: null }); }),
};
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ from: vi.fn(() => builder), rpc }) }));

import { sessionService } from '../domainServices';

describe('sessionService.getRecentReviewable (#1042 PR4 — narrow Practice Home read)', () => {
    beforeEach(() => {
        (Object.keys(calls) as Array<keyof typeof calls>).forEach((k) => delete calls[k]);
        authorityVerdict = { data: 'attrib_v1', error: null };
        rpc.mockClear();
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
        expect(calls.select).toBe('id, created_at, duration, status, total_words, transcript_state, ai_suggestions');
        // `transcript_state` is a presence FLAG; the transcript text itself is still never selected.
        expect(calls.select ?? '').not.toMatch(/(^|[ ,])transcript([ ,]|$)|wpm|filler|engine|clarity|accuracy|ground_truth|custom_words|pause_metrics/i);
        // The advisory legacy column is NOT read: attribution comes from the authority RPC.
        expect(calls.select ?? '').not.toMatch(/attribution_status/);
    });

    it('CASUALTY: an INELIGIBLE row lends no lesson, even when it carries cached coaching', async () => {
        // `get-ai-suggestions` does not apply the §4 gates before caching, so the reader must. A four-second
        // take with a cached review must still resolve `fix` to null, or Home quotes it as the user's lesson.
        const rows = await withRow({ duration: 4, ai_suggestions: COACHING });
        expect(rows[0].fix).toBeNull();
        // ...and the authority is never even consulted, because no candidate lesson survived the cheap gates.
        expect(rpc).not.toHaveBeenCalled();
    });

    /*
     * Codex P1 + PM RETURN on #1494. `sessions.attribution_status` is client-writable and migration
     * `20260803010000` demotes it to advisory — "Consumers gate on authority_version, NOT on the
     * client-writable legacy sessions columns", failing closed with "no attrib_v1 record => unverified".
     */
    it('CASUALTY: a stale legacy `verified` with NO authority record yields no lesson', async () => {
        authorityVerdict = { data: null, error: null };          // pending / never registered
        const rows = await withRow({ ai_suggestions: COACHING }); // row still carries attribution_status: 'verified'
        expect(rows[0].fix).toBeNull();
        expect(calls.rpc?.[0]).toBe('get_attribution_authority_v1');
    });

    it('CASUALTY: an unreadable authority is an unproven session — it fails closed', async () => {
        authorityVerdict = { data: null, error: { message: 'rpc failed' } };
        const rows = await withRow({ ai_suggestions: COACHING });
        expect(rows[0].fix).toBeNull();
    });

    it('CONTROL: a valid attrib_v1 authority qualifies the session, bound to THAT session id', async () => {
        const rows = await withRow({ ai_suggestions: COACHING });
        expect(rows[0].fix).toBe('Pause instead of filling the gap.');
        // Owner binding is enforced server-side by the SECURITY DEFINER function via auth.uid(); the client's
        // obligation is to ask about exactly this session and accept only the attrib_v1 verdict.
        expect(calls.rpc).toEqual(['get_attribution_authority_v1', { p_session_id: 's1' }]);
    });

    it('CASUALTY: a non-attrib_v1 verdict never qualifies', async () => {
        for (const verdict of ['attrib_v2', 'never_registered', 'verified']) {
            authorityVerdict = { data: verdict, error: null };
            const rows = await withRow({ ai_suggestions: COACHING });
            expect(rows[0].fix, `verdict ${verdict}`).toBeNull();
        }
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
