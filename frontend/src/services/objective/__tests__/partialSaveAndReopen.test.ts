import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TalkingPointCoverage } from '@/services/rehearsal/outcomeScorecard';

/**
 * #1991 + #1995 (review requirement): a partly-made point SAVES as partial and REOPENS as partial ("yellow"), with the
 * meaning matcher OFF (keyword path) and ON (model path). Yellow must never quietly become green on reopen.
 *
 * Save side: the real signal mapping (`computeObjectiveCoverage` / `computeObjectiveCoverageWithMatcher`).
 * Storage: the rows `objective_finalize_evidence_v1__unguarded` writes from those signals (verdict `detected` for an
 * offset, `coverage` only beside a detection) — that SQL is proven separately in PGlite by
 * tests/db/objective-evidence-partial-coverage.integration.test.ts.
 * Reopen side: the real reader `loadSavedFocusPointsCoverage`.
 */
type Result = { data: unknown; error: unknown };
const tables: Record<string, Result> = {};
function builder(table: string) {
    const chain: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'order', 'limit']) chain[op] = () => chain;
    chain.maybeSingle = () => Promise.resolve(tables[table]);
    chain.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(tables[table]).then(resolve, reject);
    return chain;
}
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ from: (table: string) => builder(table) }) }));
vi.mock('@/lib/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } }));

const { computeObjectiveCoverage, computeObjectiveCoverageWithMatcher } = await import('../objectiveCoverage');
const { loadSavedFocusPointsCoverage } = await import('../savedFocusPointsCoverage');

const POINTS = [
    { id: 'p1', label: 'Customers want faster checkout' },
    { id: 'p2', label: 'Hire two engineers in March' },
];
const BRIEF_POINTS = POINTS.map((p, i) => ({ id: p.id, label: p.label, sort_order: i }));

/** Mirror of the finalize RPC's row derivation (proven in PGlite): detected iff an offset; coverage only with it. */
function storedRows(signals: Array<{ brief_point_id: string; detected_at_seconds: number | null; coverage?: string }>) {
    return signals.map((s) => ({
        brief_point_id: s.brief_point_id,
        verdict: s.detected_at_seconds === null ? 'not_detected' : 'detected',
        detected_at_seconds: s.detected_at_seconds,
        coverage: s.detected_at_seconds === null ? null : (s.coverage ?? null),
    }));
}

async function reopen(signals: Parameters<typeof storedRows>[0]) {
    tables.objective_evidence = { data: storedRows(signals), error: null };
    const view = await loadSavedFocusPointsCoverage('take-1');
    if (view.kind !== 'coverage') throw new Error(`expected coverage, got ${view.kind}`);
    return view.points.map((p) => ({ status: p.status, partial: p.partial }));
}

beforeEach(() => {
    tables.objective_session = { data: { id: 'os1', brief_id: 'b1' }, error: null };
    tables.objective_brief_point = { data: BRIEF_POINTS, error: null };
    tables.objective_brief = { data: { project_id: 'proj1', event_goal: 'goal' }, error: null };
});

describe('a partly-made point saves and reopens as partial, matcher off and on', () => {
    it('matcher OFF (keyword path): partial reopens as partial, covered as covered', async () => {
        const segments = [
            { text: 'Customers want it.', startSec: 4 },                       // 2 of 4 keywords -> partial
            { text: 'We will hire two engineers in March.', startSec: 20 },    // all keywords -> covered
        ];
        const result = computeObjectiveCoverage(POINTS, segments, 60);
        expect(result.coverage.map((c) => c.status)).toEqual(['partial', 'covered']);
        expect(await reopen(result.signals)).toEqual([
            { status: 'detected', partial: true },
            { status: 'detected', partial: false },
        ]);
    });

    it('matcher ON (model path): the model\'s partial reopens as partial, its covered as covered', async () => {
        const modelVerdict: TalkingPointCoverage[] = [
            { point: POINTS[0].label, status: 'partial', matchRatio: 0.5, evidence: { quote: 'They keep asking for a quicker way to pay.', timestampSec: 8 } },
            { point: POINTS[1].label, status: 'covered', matchRatio: 1, evidence: { quote: 'We will hire two engineers in March.', timestampSec: 20 } },
        ];
        const matcher = { isReady: () => true, match: vi.fn(async () => modelVerdict) };
        const result = await computeObjectiveCoverageWithMatcher(POINTS, [{ text: 'x', startSec: 0 }], 60, matcher);
        expect(result.engine).toBe('nli');
        expect(await reopen(result.signals)).toEqual([
            { status: 'detected', partial: true },
            { status: 'detected', partial: false },
        ]);
    });

    it('CONTROL: a signal without coverage (an older client) reopens as detected, never as partial', async () => {
        expect(await reopen([
            { brief_point_id: 'p1', detected_at_seconds: 8 },
            { brief_point_id: 'p2', detected_at_seconds: null },
        ])).toEqual([
            { status: 'detected', partial: false },
            { status: 'not_detected', partial: false },
        ]);
    });
});
