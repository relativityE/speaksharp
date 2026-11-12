import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Outcome 4, first increment — `loadRepeatOrigin`. A small in-memory PostgREST fake that HONOURS the eq/in filters the
 * loader sends, so "another account's attempt" and "a newer unrelated session" are excluded by the query the loader
 * actually builds, and the row checks behind it are exercised by serving rows that ignore those filters.
 */
type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
let errors: Record<string, unknown> = {};
/** Serve every row of a table, ignoring the filters (a wider read than RLS + filters allow). */
let ignoreFilters: Record<string, boolean> = {};

function query(table: string) {
    const filters: Array<{ column: string; value: unknown; op: 'eq' | 'in' }> = [];
    const rows = () => (tables[table] ?? []).filter((row) => ignoreFilters[table] || filters.every((filter) => filter.op === 'in'
        ? (filter.value as unknown[]).includes(row[filter.column])
        : row[filter.column] === filter.value));
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = (column: string, value: unknown) => { filters.push({ column, value, op: 'eq' }); return chain; };
    chain.in = (column: string, value: unknown[]) => { filters.push({ column, value, op: 'in' }); return chain; };
    // Used only by `loadSessionProgress` (parity tests): ordering and the cross-cohort history probe are not modelled.
    chain.or = () => chain;
    chain.neq = () => chain;
    chain.order = () => chain;
    chain.limit = () => chain;
    chain.maybeSingle = async () => {
        if (errors[table]) return { data: null, error: errors[table] };
        const found = rows();
        return found.length > 1 ? { data: null, error: { code: 'PGRST116' } } : { data: found[0] ?? null, error: null };
    };
    chain.then = (resolve: (value: unknown) => void) => resolve(errors[table] ? { data: null, error: errors[table] } : { data: rows(), error: null });
    return chain;
}
const from = vi.fn((table: string) => query(table));
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ from, rpc: vi.fn() }) }));
import { loadRepeatOrigin } from '../loadRepeatOrigin';
import { loadSessionProgress } from '../loadSessionProgress';

const USER = 'user-1';
const COHORT = 'private|v2|base|clarity_v1';
const ev = (session_id: string, over: Row = {}): Row => ({
    session_id, formula_version: 'clarity_v1', eligible: true, exclusion_reasons: [], clarity_raw: 88, filler_count: 4,
    error_marker_count: 0, wpm: 142, word_count: 245, cohort_key: COHORT, baseline_session_id: null,
    previous_comparable_session_id: null, ...over,
});
const attempt = (over: Row = {}): Row => ({
    id: 'att-1', user_id: USER, recommendation_id: 'rec-a', lifecycle: 'completed', outcome: 'moved',
    practice_session_id: 'B', next_comparable_session_id: 'B', ...over,
});

beforeEach(() => {
    errors = {}; ignoreFilters = {}; from.mockClear();
    tables = {
        progress_recommendation_attempts: [attempt()],
        progress_recommendations: [{
            id: 'rec-a', user_id: USER, source_session_id: 'A', formula_version: 'clarity_v1', target_metric: 'filler_rate',
            target_direction: 'decrease', target_value: 2, target_units: 'percent of words',
            shown_text: 'Cut filler words toward 2%', source_metric_value: (4 / 245) * 100,
        }],
        sessions: [
            { id: 'A', created_at: '2025-01-17T14:00:00.000Z' },
            { id: 'B', created_at: '2025-01-17T15:00:00.000Z' },
            { id: 'C', created_at: '2025-01-17T16:00:00.000Z' },
        ],
        session_progress_evaluations: [
            ev('A'),
            ev('B', { filler_count: 2, word_count: 250 }),
            ev('C', { filler_count: 0, word_count: 300 }),
        ],
    };
});

describe('outcome 4 loadRepeatOrigin', () => {
    it('completed: links the original and returns its stored before → after for this exact repeat', async () => {
        expect(await loadRepeatOrigin('B', USER)).toEqual({
            status: 'repeat', sessionId: 'B', originalSessionId: 'A', originalCreatedAt: '2025-01-17T14:00:00.000Z',
            target: { metric: 'filler_rate', direction: 'decrease', targetValue: 2, units: 'percent of words' },
            lifecycle: 'completed', outcome: 'moved',
            repeatResult: { status: 'available', metric: 'filler_rate', direction: 'decrease', units: 'percent of words', before: (4 / 245) * 100, after: 0.8 },
        });
    });

    it('not comparable: links the original with no values', async () => {
        tables.progress_recommendation_attempts = [attempt({ lifecycle: 'not_comparable', outcome: 'not_comparable', next_comparable_session_id: null })];
        expect(await loadRepeatOrigin('B', USER)).toMatchObject({
            status: 'repeat', originalSessionId: 'A', lifecycle: 'not_comparable', outcome: 'not_comparable', repeatResult: null,
        });
    });

    it('none: the original itself, an unrelated newer session, and a session no attempt names are not repeats', async () => {
        expect(await loadRepeatOrigin('A', USER)).toEqual({ status: 'none', sessionId: 'A' });
        expect(await loadRepeatOrigin('C', USER)).toEqual({ status: 'none', sessionId: 'C' });
        tables.progress_recommendation_attempts = [];
        expect(await loadRepeatOrigin('B', USER)).toEqual({ status: 'none', sessionId: 'B' });
    });

    it('none: a pending or abandoned attempt never makes this session a repeat', async () => {
        for (const lifecycle of ['pending', 'abandoned']) {
            tables.progress_recommendation_attempts = [attempt({ lifecycle, outcome: lifecycle === 'pending' ? null : 'not_completed' })];
            expect(await loadRepeatOrigin('B', USER)).toEqual({ status: 'none', sessionId: 'B' });
            ignoreFilters.progress_recommendation_attempts = true;
            expect(await loadRepeatOrigin('B', USER)).toEqual({ status: 'none', sessionId: 'B' });
            ignoreFilters.progress_recommendation_attempts = false;
        }
    });

    it("another account's attempt or recommendation is never matched, even when a read returns it", async () => {
        tables.progress_recommendation_attempts = [attempt({ user_id: 'user-2' })];
        expect(await loadRepeatOrigin('B', USER)).toEqual({ status: 'none', sessionId: 'B' });
        ignoreFilters.progress_recommendation_attempts = true;
        expect(await loadRepeatOrigin('B', USER)).toEqual({ status: 'none', sessionId: 'B' });

        tables.progress_recommendation_attempts = [attempt()];
        tables.progress_recommendations[0].user_id = 'user-2';
        expect(await loadRepeatOrigin('B', USER)).toEqual({ status: 'none', sessionId: 'B' });
    });

    it('none: a row for another practice session is never matched, and two attempts naming one take are ambiguous', async () => {
        ignoreFilters.progress_recommendation_attempts = true;
        tables.progress_recommendation_attempts = [attempt({ practice_session_id: 'C', next_comparable_session_id: 'C' })];
        expect(await loadRepeatOrigin('B', USER)).toEqual({ status: 'none', sessionId: 'B' });
        ignoreFilters.progress_recommendation_attempts = false;
        tables.progress_recommendation_attempts = [attempt(), attempt({ id: 'att-2' })];
        expect(await loadRepeatOrigin('B', USER)).toEqual({ status: 'none', sessionId: 'B' });
    });

    it('a completed attempt whose next-comparable session is not this one shows no values', async () => {
        tables.progress_recommendation_attempts = [attempt({ next_comparable_session_id: 'C' })];
        expect(await loadRepeatOrigin('B', USER)).toMatchObject({
            status: 'repeat', originalSessionId: 'A', lifecycle: 'completed', repeatResult: { status: 'unavailable' },
        });
    });

    it('completed with unreadable values: missing, ineligible or cross-cohort evidence is unavailable, never zero', async () => {
        const cases: Array<() => void> = [
            () => { tables.session_progress_evaluations = tables.session_progress_evaluations.filter((row) => row.session_id !== 'B'); },
            () => { tables.session_progress_evaluations = tables.session_progress_evaluations.filter((row) => row.session_id !== 'A'); },
            () => { tables.session_progress_evaluations[0] = ev('A', { eligible: false }); },
            () => { tables.session_progress_evaluations[1] = ev('B', { cohort_key: 'cloud|v1|base|clarity_v1' }); },
            () => { tables.progress_recommendations[0].source_metric_value = null; },
            () => { errors.session_progress_evaluations = { code: '08006' }; },
        ];
        for (const breakIt of cases) {
            beforeEachReset();
            breakIt();
            expect(await loadRepeatOrigin('B', USER)).toMatchObject({ status: 'repeat', lifecycle: 'completed', repeatResult: { status: 'unavailable' } });
        }
    });

    it('a read failure is an error, never "not a repeat"', async () => {
        for (const table of ['progress_recommendation_attempts', 'progress_recommendations', 'sessions']) {
            errors = { [table]: { code: '08006', message: 'network' } };
            expect(await loadRepeatOrigin('B', USER)).toEqual({ status: 'error', sessionId: 'B' });
        }
    });

    it('an original with no usable timestamp still links, without a date', async () => {
        tables.sessions[0].created_at = 'not-a-date';
        expect(await loadRepeatOrigin('B', USER)).toMatchObject({ status: 'repeat', originalSessionId: 'A', originalCreatedAt: null });
    });

    it('reads nothing without a signed-in owner', async () => {
        expect(await loadRepeatOrigin('B', '')).toEqual({ status: 'none', sessionId: 'B' });
        expect(from).not.toHaveBeenCalled();
    });
});

describe('outcome 4 same-target comparison: a repeat is measured against its own original, on the original\'s target', () => {
    it("is measured on the original's saved target, not on what this repeat would recommend for itself", async () => {
        // The original's saved target is pace; this repeat's own fillers are high, so its own takeaway would pick filler rate.
        Object.assign(tables.progress_recommendations[0], { target_metric: 'pace', target_direction: 'increase', target_value: 150, target_units: 'wpm', source_metric_value: 142 });
        tables.session_progress_evaluations[1] = ev('B', { wpm: 151, filler_count: 30, word_count: 250 });
        expect(await loadRepeatOrigin('B', USER)).toMatchObject({
            status: 'repeat', originalSessionId: 'A',
            target: { metric: 'pace', direction: 'increase', targetValue: 150, units: 'wpm' },
            repeatResult: { status: 'available', metric: 'pace', direction: 'increase', units: 'wpm', before: 142, after: 151 },
        });
    });

    it("before is the value saved with the original's target, even if the original's evaluation reads differently later", async () => {
        tables.session_progress_evaluations[0] = ev('A', { filler_count: 20 });
        expect(await loadRepeatOrigin('B', USER)).toMatchObject({ repeatResult: { status: 'available', before: (4 / 245) * 100, after: 0.8 } });
    });

    it('compares against the session whose target was practised, not the previous comparable session in between', async () => {
        // A2 was recorded after A and before B, and is B's previous comparable session; the practised target is still A's.
        tables.sessions.splice(1, 0, { id: 'A2', created_at: '2025-01-17T14:30:00.000Z' });
        tables.session_progress_evaluations.push(ev('A2', { filler_count: 12, word_count: 240 }));
        tables.session_progress_evaluations[1] = ev('B', { filler_count: 2, word_count: 250, previous_comparable_session_id: 'A2' });
        expect(await loadRepeatOrigin('B', USER)).toMatchObject({
            status: 'repeat', originalSessionId: 'A', originalCreatedAt: '2025-01-17T14:00:00.000Z',
            repeatResult: { status: 'available', before: (4 / 245) * 100, after: 0.8 },
        });
    });

    it("after is this repeat's own value, never a newer session's, even when a read returns every evaluation", async () => {
        ignoreFilters.session_progress_evaluations = true;
        expect(await loadRepeatOrigin('B', USER)).toMatchObject({ repeatResult: { status: 'available', after: 0.8 } });
        expect(await loadRepeatOrigin('C', USER)).toEqual({ status: 'none', sessionId: 'C' });
    });

    it("the original's own Progress and the repeat's page read the same target and the same stored result", async () => {
        const original = await loadSessionProgress('A');
        const repeat = await loadRepeatOrigin('B', USER);
        if (original.status !== 'eligible' || repeat.status !== 'repeat') throw new Error(`unexpected ${original.status} / ${repeat.status}`);
        expect(repeat.target).toEqual(original.takeaways.target);
        expect(repeat.repeatResult).toEqual(original.repeatResult);
        expect(original.latestAttempt).toMatchObject({ lifecycle: repeat.lifecycle, outcome: repeat.outcome });
    });
});

describe('outcome 4 parity: the repeat shows exactly what the original session\'s Progress shows', () => {
    // `loadRepeatOrigin` mirrors `loadSessionProgress`'s `loadRepeatResult` while that file stays byte-identical for
    // AHT-01. Both readers run over the same rows here; any drift in the guards or the derivation fails.
    const scenarios: Array<[string, () => void]> = [
        ['filler rate, moved', () => {}],
        ['filler rate, did not move', () => { tables.progress_recommendation_attempts[0].outcome = 'did_not_move'; tables.session_progress_evaluations[1] = ev('B', { filler_count: 9, word_count: 250 }); }],
        ['pace, increase', () => { Object.assign(tables.progress_recommendations[0], { target_metric: 'pace', target_direction: 'increase', target_units: 'wpm', source_metric_value: 142 }); tables.session_progress_evaluations[1] = ev('B', { wpm: 150 }); }],
        ['clear delivery, maintain', () => { Object.assign(tables.progress_recommendations[0], { target_metric: 'clear_delivery', target_direction: 'maintain', target_units: 'clear-delivery points', source_metric_value: 88 }); }],
        ['repeat evaluation missing', () => { tables.session_progress_evaluations.splice(1, 1); }],
        ['repeat ineligible', () => { tables.session_progress_evaluations[1] = ev('B', { eligible: false }); }],
        ['repeat in another cohort', () => { tables.session_progress_evaluations[1] = ev('B', { cohort_key: 'cloud|v1|base|clarity_v1' }); }],
        ['repeat evidence incomplete', () => { tables.session_progress_evaluations[1] = ev('B', { error_marker_count: null }); }],
        ['repeat lacks the metric', () => { tables.session_progress_evaluations[1] = ev('B', { word_count: 0 }); }],
        ['stored source value missing', () => { tables.progress_recommendations[0].source_metric_value = null; }],
        ['stored source value not finite', () => { tables.progress_recommendations[0].source_metric_value = Number.POSITIVE_INFINITY; }],
        ['completed with a non-movement outcome', () => { tables.progress_recommendation_attempts[0].outcome = 'not_completed'; }],
    ];
    it.each(scenarios)('%s', async (_name, arrange) => {
            arrange();
            const original = await loadSessionProgress('A');
            const repeat = await loadRepeatOrigin('B', USER);
            expect(original.status).toBe('eligible');
            expect(repeat.status).toBe('repeat');
            const fromOriginal = original.status === 'eligible' ? original.repeatResult : undefined;
            const fromRepeat = repeat.status === 'repeat' ? repeat.repeatResult : undefined;
            expect(fromOriginal).toBeTruthy();
            expect(fromRepeat).toEqual(fromOriginal);
    });
});

/** Restores the fixture inside a loop (the module-level `beforeEach` runs once per test). */
function beforeEachReset(): void {
    errors = {};
    tables.progress_recommendations[0].source_metric_value = (4 / 245) * 100;
    tables.session_progress_evaluations = [ev('A'), ev('B', { filler_count: 2, word_count: 250 }), ev('C', { filler_count: 0, word_count: 300 })];
}
