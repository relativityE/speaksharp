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
let chronologyRows: Record<string, unknown>[] = [];
let priorOrFilters: string[] = [];

const rec = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    target_metric: 'filler_rate',
    target_direction: 'decrease',
    target_value: 3,
    target_units: 'percent of words',
    shown_text: 'Cut filler words toward 3%',
    ...over,
});

function query(table: string) {
    const state: { inMode: boolean } = { inMode: false };
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.neq = () => chain;
    chain.lt = () => chain;
    chain.or = (filter: string) => { priorOrFilters.push(filter); return chain; };
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
        ? { data: state.inMode ? chronologyRows : priorSessions, error: priorError }
        : { data: state.inMode ? references : null, error: null });
    return chain;
}
const from = vi.fn((table: string) => query(table));
const rpc = vi.fn();
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ from, rpc }) }));
import { loadSessionProgress } from '../loadSessionProgress';

const ev = (session_id: string, over: Record<string, unknown> = {}) => ({
    session_id, eligible: true, exclusion_reasons: [], clarity_raw: 90, filler_count: 3, wpm: 140,
    word_count: 200, cohort_key: 'private|v2|base|clarity_v1', baseline_session_id: null,
    previous_comparable_session_id: null, ...over,
});

beforeEach(() => {
    current = null; references = []; recommendation = rec('rec-default'); recommendationError = null; attempt = null; currentError = null;
    currentSession = { created_at: '2026-08-03T12:00:00Z' }; priorSessions = []; priorError = null; from.mockClear();
    chronologyRows = [
        { id: 's0', created_at: '2026-08-03T10:00:00Z' },
        { id: 's1', created_at: '2026-08-03T11:00:00Z' },
        { id: 's2', created_at: '2026-08-03T12:00:00Z' },
    ];
    priorOrFilters = [];
    rpc.mockReset();
    rpc.mockImplementation(async (name: string) => {
        if (name === 'record_progress_recommendation') recommendation = rec('rec-recovered');
        return { data: 'rec-recovered', error: null };
    });
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
        recommendation = rec('rec-2');
        const view = await loadSessionProgress('s2');
        expect(view.status).toBe('eligible');
        if (view.status !== 'eligible') throw new Error('expected eligible');
        expect(view.direction.direction).toBe('improved');
        expect(view.direction.deltaPoints).toBe(6); // previous=84, not first baseline=80
        expect(view.direction.text).toMatch(/7\.1% vs your previous comparable session/i); // one-decimal display
        expect(view.baselineContext).toMatch(/12\.5% vs your first comparable session/i);
        expect(view.comparison).toBe('previous');
        expect(view.recommendationId).toBe('rec-2');
        // Inspectable evidence disclosure: the validated reference session, cohort/mode, inputs, and units.
        expect(view.disclosure).toMatchObject({
            referenceSessionId: 's1',
            referenceRole: 'previous comparable session',
            alsoFirstComparable: false,
            cohortKey: 'private|v2|base|clarity_v1',
            currentClarityPoints: 90,
            referenceClarityPoints: 84,
            deltaPoints: 6,
            units: 'clear-delivery points',
        });
        expect(view.disclosure?.deltaPercent).toBeCloseTo(7.142857142857142, 6);
    });

    it('uses the sole prior evaluation as both baseline and previous on the first comparison', async () => {
        current = ev('s2', { clarity_raw: 90, baseline_session_id: 's1', previous_comparable_session_id: 's1' });
        references = [ev('s1', { clarity_raw: 84 })];
        const view = await loadSessionProgress('s2');
        expect(view).toMatchObject({ status: 'eligible', comparison: 'previous' });
        if (view.status !== 'eligible') throw new Error('expected eligible');
        expect(view.direction).toMatchObject({ direction: 'improved', deltaPoints: 6 });
    });

    it.each([
        ['future timestamp', 's1', '2026-08-03T13:00:00Z'],
        ['equal-time higher id', 's3', '2026-08-03T12:00:00Z'],
    ])('rejects a %s persisted reference from comparison arithmetic', async (_label, referenceId, created_at) => {
        current = ev('s2', { baseline_session_id: referenceId, previous_comparable_session_id: referenceId });
        references = [ev(referenceId, { clarity_raw: 10 })];
        chronologyRows = [{ id: referenceId, created_at }, { id: 's2', created_at: '2026-08-03T12:00:00Z' }];
        const view = await loadSessionProgress('s2');
        expect(view).toMatchObject({ status: 'eligible', comparison: 'restarted' });
        if (view.status !== 'eligible') throw new Error('expected eligible');
        expect(view.direction.deltaPoints).toBeNull();
    });

    it('consumes equal-timestamp A/B/C/D same-mode predecessors with the server tuple order', async () => {
        const timestamp = '2026-08-03T12:00:00Z';

        current = ev('c', { cohort_key: 'private|v2|base|clarity_v1|objective', baseline_session_id: 'a', previous_comparable_session_id: 'a' });
        references = [ev('a', { cohort_key: current.cohort_key, clarity_raw: 80 })];
        chronologyRows = [{ id: 'a', created_at: timestamp }, { id: 'c', created_at: timestamp }];
        expect(await loadSessionProgress('c')).toMatchObject({ status: 'eligible', comparison: 'previous' });

        current = ev('d', { cohort_key: 'private|v2|base|clarity_v1|freeform', baseline_session_id: 'b', previous_comparable_session_id: 'b' });
        references = [ev('b', { cohort_key: current.cohort_key, clarity_raw: 82 })];
        chronologyRows = [{ id: 'b', created_at: timestamp }, { id: 'd', created_at: timestamp }];
        expect(await loadSessionProgress('d')).toMatchObject({ status: 'eligible', comparison: 'previous' });

        current = ev('a', { cohort_key: 'private|v2|base|clarity_v1|objective' });
        references = [];
        currentSession = { id: 'a', created_at: timestamp };
        priorSessions = [];
        expect(await loadSessionProgress('a')).toMatchObject({ status: 'eligible', comparison: 'baseline' });
        expect(priorOrFilters[priorOrFilters.length - 1]).toBe(`created_at.lt.${timestamp},and(created_at.eq.${timestamp},id.lt.a)`);
    });

    it('does not let an invalid previous role influence a valid baseline', async () => {
        current = ev('s2', { baseline_session_id: 's0', previous_comparable_session_id: 's1' });
        references = [ev('s0', { clarity_raw: 80 }), ev('s1', { clarity_raw: 10 })];
        chronologyRows = [
            { id: 's0', created_at: '2026-08-03T10:00:00Z' },
            { id: 's1', created_at: '2026-08-03T13:00:00Z' },
            { id: 's2', created_at: '2026-08-03T12:00:00Z' },
        ];
        const view = await loadSessionProgress('s2');
        expect(view).toMatchObject({ status: 'eligible', comparison: 'restarted' });
        if (view.status !== 'eligible') throw new Error('expected eligible');
        expect(view.direction.deltaPoints).toBeNull();
    });

    it('does not fabricate baseline or movement when retention removed baseline but previous survives', async () => {
        current = ev('s2', { baseline_session_id: 's0', previous_comparable_session_id: 's1' });
        references = [ev('s1', { clarity_raw: 10 })];
        const view = await loadSessionProgress('s2');
        expect(view).toMatchObject({ status: 'eligible', comparison: 'restarted' });
        if (view.status !== 'eligible') throw new Error('expected eligible');
        expect(view.direction).toMatchObject({ direction: 'baseline', deltaPoints: null });
        expect(view.direction.text).toMatch(/restarted/i);
        expect(view.direction.text).not.toMatch(/established|moved|improved/i);
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
        ['ambiguous', [ev('s0'), ev('s0')]],
    ])('fails closed for a %s persisted comparison reference', async (_label, rows) => {
        current = ev('s2', {
            baseline_session_id: _label === 'self' ? 's2' : 's0',
            previous_comparable_session_id: _label === 'ambiguous' ? 's0' : 's1',
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
        rpc.mockResolvedValue({ data: null, error: { message: 'offline' } });
        expect(await loadSessionProgress('s2')).toMatchObject({ status: 'unavailable' });
        recommendationError = { message: 'offline' };
        expect(await loadSessionProgress('s2')).toMatchObject({ status: 'error' });
    });

    it('recovers a missing recommendation by authoritative readback without duplicating on retry', async () => {
        current = ev('s2', { baseline_session_id: 's0', previous_comparable_session_id: 's1' });
        references = [ev('s0'), ev('s1')];
        recommendation = null;
        // The server committed but the RPC response was lost. Reconciliation must trust the row readback.
        rpc.mockImplementationOnce(async () => {
            recommendation = rec('rec-after-lost-success');
            return { data: null, error: { message: 'connection reset after commit' } };
        });
        expect(await loadSessionProgress('s2')).toMatchObject({
            status: 'eligible', recommendationId: 'rec-after-lost-success',
        });
        expect(await loadSessionProgress('s2')).toMatchObject({
            status: 'eligible', recommendationId: 'rec-after-lost-success',
        });
        expect(rpc.mock.calls.filter(([name]) => name === 'record_progress_recommendation')).toHaveLength(1);
    });

    it('reuses the stored recommendation contract after a hard reload instead of recomputing copy', async () => {
        current = ev('s2', { baseline_session_id: 's0', previous_comparable_session_id: 's1', filler_count: 80, wpm: 220 });
        references = [ev('s0'), ev('s1')];
        recommendation = rec('rec-stored', {
            target_metric: 'pace',
            target_direction: 'decrease',
            target_value: 150,
            target_units: 'words per minute',
            shown_text: 'Pause before each decision',
        });

        const firstRead = await loadSessionProgress('s2');
        const reloadRead = await loadSessionProgress('s2');
        for (const view of [firstRead, reloadRead]) {
            expect(view).toMatchObject({
                status: 'eligible',
                recommendationId: 'rec-stored',
                takeaways: {
                    practiceThisNext: 'Pause before each decision',
                    target: { metric: 'pace', direction: 'decrease', targetValue: 150, units: 'words per minute' },
                },
            });
        }
        expect(rpc).not.toHaveBeenCalled();
    });

    it.each([
        ['missing copy', { shown_text: '' }],
        ['non-finite target', { target_value: Number.NaN }],
        ['unknown metric', { target_metric: 'confidence_score' }],
        ['unknown direction', { target_direction: 'maximize' }],
    ])('fails closed for a malformed stored recommendation: %s', async (_label, malformed) => {
        current = ev('s2');
        recommendation = rec('rec-malformed', malformed);
        expect(await loadSessionProgress('s2')).toMatchObject({ status: 'unavailable' });
    });

    it('exposes the latest stored attempt outcome', async () => {
        current = ev('s2');
        recommendation = rec('rec-2');
        attempt = { id: 'att-2', lifecycle: 'completed', outcome: 'moved' };
        const view = await loadSessionProgress('s2');
        expect(view).toMatchObject({ status: 'eligible', latestAttempt: { id: 'att-2', lifecycle: 'completed', outcome: 'moved' } });
    });
});
