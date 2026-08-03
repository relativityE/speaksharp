import { describe, it, expect, vi, beforeEach } from 'vitest';

let current: Record<string, unknown> | null = null;
let references: Record<string, unknown>[] = [];
let recommendation: Record<string, unknown> | null = null;
let attempt: Record<string, unknown> | null = null;
let currentError: unknown = null;

function query(table: string) {
    const state: { inMode: boolean } = { inMode: false };
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.in = () => { state.inMode = true; return chain; };
    chain.order = () => chain;
    chain.limit = () => chain;
    chain.maybeSingle = async () => {
        if (table === 'session_progress_evaluations') return { data: current, error: currentError };
        if (table === 'progress_recommendations') return { data: recommendation, error: null };
        return { data: attempt, error: null };
    };
    chain.then = (resolve: (value: unknown) => void) => resolve({ data: state.inMode ? references : null, error: null });
    return chain;
}
const from = vi.fn((table: string) => query(table));
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ from }) }));
import { loadSessionProgress } from '../loadSessionProgress';

const ev = (session_id: string, over: Record<string, unknown> = {}) => ({
    session_id, eligible: true, exclusion_reasons: [], clarity_raw: 90, filler_count: 3, wpm: 140,
    word_count: 200, cohort_key: 'private|v2|base|clarity_v1', baseline_session_id: null,
    previous_comparable_session_id: null, ...over,
});

beforeEach(() => { current = null; references = []; recommendation = null; attempt = null; currentError = null; from.mockClear(); });

describe('#1047 U2 loadSessionProgress', () => {
    it('distinguishes missing evaluation, ineligible evidence, and query failure', async () => {
        expect(await loadSessionProgress('s2')).toMatchObject({ status: 'insufficient' });
        current = ev('s2', { eligible: false, exclusion_reasons: ['too_few_words'] });
        expect(await loadSessionProgress('s2')).toMatchObject({ status: 'ineligible', reasons: ['too_few_words'] });
        currentError = { message: 'offline' };
        expect(await loadSessionProgress('s2')).toMatchObject({ status: 'error' });
    });

    it('uses persisted baseline/previous references without client history', async () => {
        current = ev('s2', { clarity_raw: 90, baseline_session_id: 's0', previous_comparable_session_id: 's1' });
        references = [ev('s1', { clarity_raw: 84 }), ev('s0', { clarity_raw: 80 })];
        recommendation = { id: 'rec-2' };
        const view = await loadSessionProgress('s2');
        expect(view.status).toBe('eligible');
        if (view.status !== 'eligible') throw new Error('expected eligible');
        expect(view.direction.direction).toBe('improved');
        expect(view.comparison).toBe('previous');
        expect(view.recommendationId).toBe('rec-2');
    });

    it('renders an explicit restart when a stored baseline exists but no previous comparable session does', async () => {
        current = ev('s2', { baseline_session_id: 's0', previous_comparable_session_id: null });
        references = [ev('s0', { cohort_key: 'older-cohort' })];
        const view = await loadSessionProgress('s2');
        expect(view).toMatchObject({ status: 'eligible', comparison: 'restarted' });
        const eligible = view as Extract<typeof view, { status: 'eligible' }>;
        expect(eligible.direction.text).toMatch(/restarted/i);
    });

    it('exposes the latest stored attempt outcome', async () => {
        current = ev('s2');
        recommendation = { id: 'rec-2' };
        attempt = { lifecycle: 'completed', outcome: 'moved' };
        const view = await loadSessionProgress('s2');
        expect(view).toMatchObject({ status: 'eligible', latestAttempt: { lifecycle: 'completed', outcome: 'moved' } });
    });
});
