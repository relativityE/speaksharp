import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The saved Focus Points read maps ONLY persisted rows: points in their saved order, each with its saved verdict.
 * A point with no evidence (or an unknown verdict) is `unavailable`, never detected; any read failure is `error`,
 * never an empty "nothing to show".
 */
type Result = { data: unknown; error: unknown };
const tables: Record<string, Result> = {};
const calls: Array<{ table: string; op: string; args: unknown[] }> = [];

function builder(table: string) {
    const chain: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'order', 'limit']) {
        chain[op] = (...args: unknown[]) => { calls.push({ table, op, args }); return chain; };
    }
    chain.maybeSingle = () => Promise.resolve(tables[table]);
    chain.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(tables[table]).then(resolve, reject);
    return chain;
}

vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ from: (table: string) => builder(table) }) }));
vi.mock('@/lib/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } }));

const { loadSavedFocusPointsCoverage } = await import('../savedFocusPointsCoverage');

const POINTS = [
    { id: 'p1', label: 'Updates get lost across scattered tools.', sort_order: 0 },
    { id: 'p2', label: 'A shared board assigns an owner and deadline.', sort_order: 1 },
    { id: 'p3', label: 'Pilot the board with one team for two weeks.', sort_order: 2 },
    { id: 'p4', label: 'Measure missed deadlines and time spent on status requests.', sort_order: 3 },
];

beforeEach(() => {
    calls.length = 0;
    tables.objective_session = { data: { id: 'os1', brief_id: 'b1' }, error: null };
    tables.objective_brief_point = { data: POINTS, error: null };
    tables.objective_brief = { data: { project_id: 'proj1', event_goal: 'A better weekly team handoff' }, error: null };
    tables.objective_evidence = {
        data: [
            { brief_point_id: 'p1', verdict: 'detected', detected_at_seconds: 5 },
            { brief_point_id: 'p2', verdict: 'detected', detected_at_seconds: 14 },
            { brief_point_id: 'p3', verdict: 'not_detected', detected_at_seconds: null },
            // p4 deliberately has no evidence row
        ],
        error: null,
    };
});

describe('loadSavedFocusPointsCoverage', () => {
    it('maps the saved points in order with their saved verdicts and totals', async () => {
        const result = await loadSavedFocusPointsCoverage('s1');
        expect(result).toEqual({
            kind: 'coverage',
            detected: 2,
            total: 4,
            points: [
                { label: POINTS[0].label, status: 'detected', detectedAtSeconds: 5 },
                { label: POINTS[1].label, status: 'detected', detectedAtSeconds: 14 },
                { label: POINTS[2].label, status: 'not_detected', detectedAtSeconds: null },
                { label: POINTS[3].label, status: 'unavailable', detectedAtSeconds: null },
            ],
            // The saved set, so "Practice this again" rebinds exactly these points.
            brief: { briefId: 'b1', projectId: 'proj1', topic: 'A better weekly team handoff' },
        });
    });

    it('a failed or unreadable brief keeps the results and reports no brief (never an invented set)', async () => {
        tables.objective_brief = { data: null, error: { code: '42501' } };
        const result = await loadSavedFocusPointsCoverage('s1');
        expect(result).toMatchObject({ kind: 'coverage', detected: 2, total: 4, brief: null });
    });

    it('reads the objective session for exactly this saved take, newest first', async () => {
        await loadSavedFocusPointsCoverage('s1');
        expect(calls).toContainEqual({ table: 'objective_session', op: 'eq', args: ['source_session_id', 's1'] });
        expect(calls).toContainEqual({ table: 'objective_session', op: 'order', args: ['created_at', { ascending: false }] });
        expect(calls).toContainEqual({ table: 'objective_brief_point', op: 'eq', args: ['brief_id', 'b1'] });
        expect(calls).toContainEqual({ table: 'objective_evidence', op: 'eq', args: ['session_id', 'os1'] });
    });

    it('never shows an unknown verdict as detected', async () => {
        tables.objective_evidence = { data: [{ brief_point_id: 'p1', verdict: 'maybe', detected_at_seconds: 3 }], error: null };
        const result = await loadSavedFocusPointsCoverage('s1');
        expect(result.kind === 'coverage' && result.points[0]).toEqual({ label: POINTS[0].label, status: 'unavailable', detectedAtSeconds: null });
        expect(result.kind === 'coverage' && result.detected).toBe(0);
    });

    it('is `none` for a session with no Focus Points record (Open Mic)', async () => {
        tables.objective_session = { data: null, error: null };
        await expect(loadSavedFocusPointsCoverage('s1')).resolves.toEqual({ kind: 'none' });
    });

    it.each([
        ['objective_session', 'session read fails'],
        ['objective_brief_point', 'point read fails'],
        ['objective_evidence', 'evidence read fails'],
    ])('is `error` when the %s read fails (%s)', async (table) => {
        tables[table] = { data: null, error: { code: '42501' } };
        await expect(loadSavedFocusPointsCoverage('s1')).resolves.toEqual({ kind: 'error' });
    });

    it('is `error`, not an empty result, when a saved Focus Points session has no points', async () => {
        tables.objective_brief_point = { data: [], error: null };
        await expect(loadSavedFocusPointsCoverage('s1')).resolves.toEqual({ kind: 'error' });
    });
});
