import { describe, it, expect, vi, beforeEach } from 'vitest';

let current: Record<string, unknown> | null = null;
let references: Record<string, unknown>[] = [];
let recommendation: Record<string, unknown> | null = null;
let recommendationError: unknown = null;
let attempt: Record<string, unknown> | null = null;
let currentError: unknown = null;
let currentSession: Record<string, unknown> | null = { created_at: '2026-08-03T12:00:00Z' };
let priorSessions: Record<string, unknown>[] = [];
let priorError: unknown = null;

function query(table: string) {
    const state: { inMode: boolean } = { inMode: false };
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.neq = () => chain;
    chain.lt = () => chain;
    chain.in = () => { state.inMode = true; return chain; };
    chain.order = () => chain;
    chain.limit = () => chain;
    chain.maybeSingle = async () => {
        if (table === 'session_progress_evaluations') return { data: current, error: currentError };
        if (table === 'progress_recommendations') return { data: recommendation, error: recommendationError };
        if (table === 'sessions') return { data: currentSession, error: priorError };
        return { data: attempt, error: null };
    };
    chain.then = (resolve: (value: unknown) => void) => resolve(table === 'sessions'
        ? { data: priorSessions, error: priorError }
        : { data: state.inMode ? references : null, error: null });
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

beforeEach(() => {
    current = null; references = []; recommendation = { id: 'rec-default' }; recommendationError = null; attempt = null; currentError = null;
    currentSession = { created_at: '2026-08-03T12:00:00Z' }; priorSessions = []; priorError = null; from.mockClear();
});

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

    it('never compares an incompatible cohort even when a malformed stored reference names it', async () => {
        current = ev('s2', { baseline_session_id: 's0', previous_comparable_session_id: 's1' });
        references = [ev('s0', { clarity_raw: 10, cohort_key: 'other' }), ev('s1', { clarity_raw: 20, cohort_key: 'other' })];
        const view = await loadSessionProgress('s2');
        expect(view).toMatchObject({ status: 'eligible', comparison: 'restarted' });
        const eligible = view as Extract<typeof view, { status: 'eligible' }>;
        expect(eligible.direction.deltaPoints).toBeNull();
    });

    it.each([
        ['missing', []],
        ['ineligible', [ev('s0', { eligible: false })]],
        ['self', [ev('s2')]],
        ['duplicate role', [ev('s0')]],
    ])('fails closed for a %s persisted comparison reference', async (_label, rows) => {
        current = ev('s2', {
            baseline_session_id: _label === 'self' ? 's2' : 's0',
            previous_comparable_session_id: _label === 'duplicate role' ? 's0' : 's1',
        });
        references = rows;
        const view = await loadSessionProgress('s2');
        expect(view).toMatchObject({ status: 'eligible', comparison: 'restarted' });
        const eligible = view as Extract<typeof view, { status: 'eligible' }>;
        expect(eligible.direction.deltaPoints).toBeNull();
    });

    it('distinguishes first-ever baseline from a persisted prior different-cohort session', async () => {
        current = ev('s2');
        priorSessions = [];
        expect(await loadSessionProgress('s2')).toMatchObject({ status: 'eligible', comparison: 'baseline' });
        priorSessions = [{ id: 's-earlier' }];
        expect(await loadSessionProgress('s2')).toMatchObject({ status: 'eligible', comparison: 'restarted' });
    });

    it('fails closed when server chronology cannot be verified', async () => {
        current = ev('s2');
        priorError = { message: 'offline' };
        expect(await loadSessionProgress('s2')).toMatchObject({ status: 'error', message: expect.stringMatching(/history/) });
    });

    it('does not synthesize coaching when the server recommendation is missing', async () => {
        current = ev('s2', { baseline_session_id: 's0', previous_comparable_session_id: 's1' });
        references = [ev('s0'), ev('s1')];
        recommendation = null;
        expect(await loadSessionProgress('s2')).toMatchObject({ status: 'unavailable' });
        recommendationError = { message: 'offline' };
        expect(await loadSessionProgress('s2')).toMatchObject({ status: 'error' });
    });

    it('exposes the latest stored attempt outcome', async () => {
        current = ev('s2');
        recommendation = { id: 'rec-2' };
        attempt = { id: 'att-2', lifecycle: 'completed', outcome: 'moved' };
        const view = await loadSessionProgress('s2');
        expect(view).toMatchObject({ status: 'eligible', latestAttempt: { id: 'att-2', lifecycle: 'completed', outcome: 'moved' } });
    });
});
