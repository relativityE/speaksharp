// @vitest-environment node
/**
 * #1258 RWT run 38104864048 (F1): Analytics "Practice again" stayed on "Try again" (`linkState=error`) for a FIRST
 * eligible session. `session_progress_evaluations` has THREE foreign keys to `sessions` (`session_id`,
 * `baseline_session_id`, `previous_comparable_session_id`), so PostgREST cannot pick one for an unhinted
 * `sessions?select=id,session_progress_evaluations!inner(...)` embed and rejects the request (PGRST201, "more than one
 * relationship was found"). That read runs only when the evaluation names no baseline/previous session — a first
 * session — and its error became `status:'error'` → `linkState:'error'` → a press that only refetches.
 *
 * The stub answers the QUERY the way PostgREST resolves it: an embed without a relationship hint is ambiguous.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const AMBIGUOUS = { code: 'PGRST201', message: "Could not embed because more than one relationship was found for 'sessions' and 'session_progress_evaluations'" };
let priorRows: Record<string, unknown>[] = [];
let priorReadError: unknown = null;
let selects: string[] = [];

const firstEvaluation = {
    session_id: 's1', eligible: true, exclusion_reasons: [], clarity_raw: 88, filler_count: 5, error_marker_count: 0, wpm: 140,
    word_count: 128, cohort_key: 'private|v2|base|clarity_v1', baseline_session_id: null, previous_comparable_session_id: null,
};
const recommendation = {
    id: 'rec-1', target_metric: 'clear_delivery', target_direction: 'maintain', target_value: 88, target_units: 'points',
    shown_text: 'Hold this clear delivery next time',
};

/** Resolves an embed like PostgREST: `<table>!<hint>…` is resolvable; a bare `<table>!inner(` / `<table>(` is not. */
const embedIsAmbiguous = (select: string): boolean => /(^|[\s,])session_progress_evaluations(!inner)?\(/.test(select);

function query(table: string) {
    let select = '';
    const chain: Record<string, unknown> = {};
    chain.select = (s: string) => { select = s; selects.push(`${table}:${s}`); return chain; };
    for (const m of ['eq', 'neq', 'lt', 'or', 'in', 'order', 'limit']) chain[m] = () => chain;
    chain.maybeSingle = async () => {
        if (table === 'session_progress_evaluations') return { data: firstEvaluation, error: null };
        if (table === 'progress_recommendations') return { data: recommendation, error: null };
        if (table === 'sessions') return { data: { id: 's1', created_at: '2026-10-11T02:22:31.483012+00:00' }, error: null };
        return { data: null, error: null };
    };
    chain.then = (resolve: (value: unknown) => void) => {
        if (table === 'sessions' && embedIsAmbiguous(select)) return resolve({ data: null, error: AMBIGUOUS });
        if (table === 'sessions') return resolve({ data: priorReadError ? null : priorRows, error: priorReadError });
        return resolve({ data: [], error: null });
    };
    return chain;
}
const from = vi.fn((table: string) => query(table));
const rpc = vi.fn();
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ from, rpc }) }));
import { loadSessionProgress } from '../loadSessionProgress';

beforeEach(() => { priorRows = []; priorReadError = null; selects = []; from.mockClear(); rpc.mockReset(); });

describe('#1258 F1 — first eligible session reads its progress through an unambiguous embed', () => {
    it('a first eligible session is ELIGIBLE with a baseline comparison and its recommendation (Practice again can link)', async () => {
        const view = await loadSessionProgress('s1');
        expect(view).toMatchObject({ status: 'eligible', comparison: 'baseline', recommendationId: 'rec-1' });
    });

    it('a prior eligible session in another cohort still restarts the comparison', async () => {
        priorRows = [{ id: 's0', session_progress_evaluations: [{ cohort_key: 'cloud|x|y|clarity_v1' }] }];
        expect(await loadSessionProgress('s1')).toMatchObject({ status: 'eligible', comparison: 'restarted' });
    });

    it('a REAL history read failure stays fail-closed (error, never an unlinked repeat)', async () => {
        priorReadError = { code: '57014', message: 'canceling statement due to statement timeout' };
        expect(await loadSessionProgress('s1')).toMatchObject({ status: 'error', message: 'Comparison history could not be verified.' });
    });

    it('the schema really has more than one sessions FK on session_progress_evaluations, and the client hints session_id', () => {
        const root = path.resolve(__dirname, '../../../../..');
        const dir = path.join(root, 'backend/supabase/migrations');
        const create = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
            .map((f) => readFileSync(path.join(dir, f), 'utf8'))
            .map((sql) => sql.match(/CREATE TABLE IF NOT EXISTS public\.session_progress_evaluations \(([\s\S]*?)\n\);/)?.[1])
            .find(Boolean) ?? '';
        const fks = create.match(/REFERENCES public\.sessions\(id\)/g) ?? [];
        expect(fks.length).toBeGreaterThan(1);
        const source = readFileSync(path.join(root, 'frontend/src/services/progress/loadSessionProgress.ts'), 'utf8');
        expect(source).toContain("session_progress_evaluations!session_id!inner(cohort_key)");
        expect(embedIsAmbiguous(source)).toBe(false);
    });
});
