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

const { loadSavedFocusPointsCoverage, readSavedSessionProduct } = await import('../savedFocusPointsCoverage');

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
            evidenceRows: 3,
        });
    });

    // #1577 Codex P2 4236239714: the coaching function treats zero evidence rows as pending (425), but the points still
    // render as `unavailable`. The persisted evidence count is carried so a retry is offered only when the backend can act.
    it('CASUALTY (Codex 4236239714): points saved but NO evidence rows → coverage with evidenceRows 0, every point unavailable', async () => {
        tables.objective_evidence = { data: [], error: null };
        const result = await loadSavedFocusPointsCoverage('s1');
        expect(result).toMatchObject({ kind: 'coverage', detected: 0, total: 4, evidenceRows: 0 });
        expect(result.kind === 'coverage' ? result.points.map((p) => p.status) : []).toEqual(['unavailable', 'unavailable', 'unavailable', 'unavailable']);
    });

    // #1535 Codex P2 r4116626850 (PM RETURN 5859089409): a FAILED brief read is not a missing brief.
    it('CASUALTY: a failed brief read keeps the results but flags the read as failed (retryable), never a missing set', async () => {
        tables.objective_brief = { data: null, error: { code: '503' } };
        const result = await loadSavedFocusPointsCoverage('s1');
        expect(result).toMatchObject({ kind: 'coverage', detected: 2, total: 4, brief: null, briefReadFailed: true });
    });

    it('CONTROL: a genuinely absent or unusable brief (no error) reports no brief and NO read failure', async () => {
        for (const data of [null, { project_id: null, event_goal: 'x' }]) {
            tables.objective_brief = { data, error: null };
            const result = await loadSavedFocusPointsCoverage('s1');
            expect(result).toMatchObject({ kind: 'coverage', detected: 2, total: 4, brief: null });
            expect(result).not.toHaveProperty('briefReadFailed');
        }
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

// #1535 Codex P2 r4116741461: the durable product, read only to decide whether a Focus read failure is relevant.
describe('readSavedSessionProduct', () => {
    it.each([
        ['open_mic', { data: { product: 'open_mic' }, error: null }, 'open_mic'],
        ['focus_points', { data: { product: 'focus_points' }, error: null }, 'focus_points'],
        ['legacy NULL', { data: { product: null }, error: null }, 'unknown'],
        ['no row', { data: null, error: null }, 'unknown'],
        ['a read failure', { data: null, error: { code: '503' } }, 'error'],
        ['a missing column (pre-migration)', { data: null, error: { code: '42703', message: 'column sessions.product does not exist' } }, 'error'],
    ])('%s → %s', async (_label, result, expected) => {
        tables.sessions = result as { data: unknown; error: unknown };
        expect(await readSavedSessionProduct('s1')).toBe(expected);
        expect(calls.filter((c) => c.table === 'sessions').map((c) => [c.op, c.args[0]])).toEqual([['select', 'product'], ['eq', 'id']]);
    });
});
