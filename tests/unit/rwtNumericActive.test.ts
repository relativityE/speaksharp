// @vitest-environment node
/**
 * G03 Option A (PO, 2026-11-22): the journey-only ACTIVE numeric check (tests/live/helpers/rwtNumericActive.ts).
 *  - Source: one complete sealed set by git bytes, no trusted SHA, HOLD on unreadable or mixed bytes.
 *  - Identity: the journey's product on both saved sessions, the owner, the bound attempt.
 *  - PARITY with the sealed harness check (progress-numeric.cjs): the same queries, the same answers and the same page reads over the
 *    harness's own case matrix, so the journey copy can never drift from the harness check.
 * The sealed packet itself is untouched (asserted below).
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    NUMERIC_CONSUMER_PATHS, NUMERIC_SOURCE_SETS, matchingNumericSet, observeActive, preflightActive, readExpectedActive,
    readPersistedNumeric, type NumericActiveArgs, type ReadBlob,
} from '../live/helpers/rwtNumericActive';

const ADAPTERS = resolve(__dirname, '../../tools/cloud-test/harness/draft-adapters');
type Answer = { result?: string; facts?: Record<string, unknown>; value?: Record<string, unknown> };
const harness = createRequire(import.meta.url)(resolve(ADAPTERS, 'progress-numeric.cjs')) as {
    SOURCE_SHA: string; CONSUMERS: Array<{ path: string; snapshotSha256: string }>;
    readExpected(a: Record<string, unknown>): Promise<Answer>; observe(a: Record<string, unknown>): Promise<Answer>;
    verify(e: Answer, o: unknown): Answer; expectedText(v: unknown): string;
};
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

// ── The harness offline test's own fixture and fake database (progress-numeric.offline.test.cjs), unchanged in behaviour ──────
type Row = Record<string, unknown>;
type Data = Record<string, Row[]>;
const ev = (id: string, more: Row = {}): Row => ({ session_id: id, user_id: 'owner', formula_version: 'clarity_v1', eligible: true, exclusion_reasons: [], clarity_raw: 80, filler_count: 3, error_marker_count: 0, wpm: 120, word_count: 100, cohort_key: 'engine|version|model|clarity_v1|freeform', baseline_session_id: null, previous_comparable_session_id: null, ...more });
const fixture = (): Data => ({
    progress_recommendations: [{ id: 'rec', user_id: 'owner', source_session_id: 'A', formula_version: 'clarity_v1', target_metric: 'filler_rate', target_direction: 'decrease', target_value: 1, target_units: '% of words', source_metric_value: 3, shown_text: 'private target' }],
    progress_recommendation_attempts: [{ id: 'attempt', user_id: 'owner', recommendation_id: 'rec', practice_session_id: 'B', next_comparable_session_id: 'B', lifecycle: 'completed', outcome: 'moved', accepted_at: '2026-10-27T14:00:00Z' }],
    session_progress_evaluations: [ev('A'), ev('B', { filler_count: 2 })],
});
type Query = { table: string; filters: Array<[string, unknown]>; columns: string; orders: Array<[string, { ascending: boolean }]>; limit: number | null };
function fakeDb(data: Data, { errorTable = null as string | null } = {}) {
    const queries: Query[] = [];
    return {
        queries,
        from(table: string) {
            const query: Query = { table, filters: [], columns: '', orders: [], limit: null };
            queries.push(query);
            let single = false;
            const read = async () => {
                if (errorTable === table) return { error: { code: 'synthetic' }, data: null };
                let rows = structuredClone(data[table] || []).filter((r) => query.filters.every(([k, v]) => r[k] === v));
                for (const [k, o] of query.orders) rows.sort((a, b) => (String(a[k]) < String(b[k]) ? -1 : String(a[k]) > String(b[k]) ? 1 : 0) * (o.ascending === false ? -1 : 1));
                if (query.limit) rows = rows.slice(0, query.limit);
                if (single && rows.length > 1) return { data: null, error: { code: 'ambiguous' } };
                return { data: single ? (rows[0] ?? null) : rows, error: null };
            };
            const q = {
                select(s: string) { query.columns = s; return q; },
                eq(k: string, v: unknown) { query.filters.push([k, v]); return q; },
                order(k: string, o: { ascending: boolean }) { query.orders.push([k, o]); return q; },
                limit(n: number) { query.limit = n; return q; },
                maybeSingle() { single = true; return read(); },
                then(ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) { return read().then(ok, bad); },
            };
            return q;
        },
    };
}
// The harness's own cases: wrong bindings (FAIL), unavailable evidence (NOT RUN), missing/denied tables, ordering and metrics.
// A unique, readable case name: JSON prints NaN and Infinity as null, which would give two cases the same test name.
const caseName = (delta: Row) => JSON.stringify(delta, (_k, v: unknown) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v));
const VARIANTS: Array<[string, (d: Data) => void, string | null]> = [
    ['happy path', () => undefined, null],
    ...([['progress_recommendations', 0, { user_id: 'other' }], ['progress_recommendation_attempts', 0, { user_id: 'other' }], ['progress_recommendation_attempts', 0, { practice_session_id: 'old' }], ['progress_recommendation_attempts', 0, { id: 'other-attempt' }], ['progress_recommendation_attempts', 0, { next_comparable_session_id: 'old' }], ['session_progress_evaluations', 0, { user_id: 'other' }], ['session_progress_evaluations', 1, { user_id: 'other' }],
        ['progress_recommendations', 0, { target_metric: 'constructor' }], ['progress_recommendations', 0, { target_direction: 'unknown' }], ['progress_recommendations', 0, { target_value: Infinity }], ['progress_recommendations', 0, { target_units: '' }], ['progress_recommendations', 0, { shown_text: '' }], ['progress_recommendations', 0, { source_metric_value: null }], ['progress_recommendations', 0, { source_metric_value: NaN }], ['progress_recommendation_attempts', 0, { lifecycle: 'pending', outcome: null }], ['progress_recommendation_attempts', 0, { outcome: 'not_comparable' }], ['progress_recommendation_attempts', 0, { accepted_at: 'invalid' }], ['session_progress_evaluations', 0, { eligible: false }], ['session_progress_evaluations', 1, { eligible: false }], ['session_progress_evaluations', 1, { cohort_key: 'other' }], ['session_progress_evaluations', 1, { filler_count: null }], ['session_progress_evaluations', 1, { filler_count: -1 }], ['session_progress_evaluations', 1, { filler_count: 1.1 }], ['session_progress_evaluations', 1, { word_count: 0 }], ['session_progress_evaluations', 1, { clarity_raw: NaN }], ['session_progress_evaluations', 1, { wpm: Infinity }], ['session_progress_evaluations', 1, { error_marker_count: null }],
        ['session_progress_evaluations', 1, { formula_version: 'other' }], ['session_progress_evaluations', 0, { formula_version: 'other' }],
    ] as Array<[string, number, Row]>).map(([table, index, delta]): [string, (d: Data) => void, string | null] => [`${table}[${index}] ${caseName(delta)}`, (d) => { Object.assign(d[table][index], delta); }, null]),
    ...(['progress_recommendations', 'progress_recommendation_attempts', 'session_progress_evaluations'].map((t): [string, (d: Data) => void, string | null] => [`missing ${t}`, (d) => { d[t] = []; }, null])),
    ...(['progress_recommendations', 'progress_recommendation_attempts', 'session_progress_evaluations'].map((t): [string, (d: Data) => void, string | null] => [`denied ${t}`, () => undefined, t])),
    ['newer unrelated attempt', (d) => { d.progress_recommendation_attempts.push({ ...d.progress_recommendation_attempts[0], id: 'newer', practice_session_id: 'C', accepted_at: '2026-10-27T14:01:00Z' }); }, null],
    ['tied latest attempts', (d) => { d.progress_recommendation_attempts.push({ ...d.progress_recommendation_attempts[0], id: 'tie' }); }, null],
    ['pace metric', (d) => { Object.assign(d.progress_recommendations[0], { target_metric: 'pace', target_units: 'wpm' }); d.session_progress_evaluations[1].wpm = 137.25; }, null],
    ['clear delivery metric', (d) => { Object.assign(d.progress_recommendations[0], { target_metric: 'clear_delivery' }); d.session_progress_evaluations[1].clarity_raw = 83.75; }, null],
];
const HIST = { sourceSha: harness.SOURCE_SHA, servedSha: harness.SOURCE_SHA, account: { id: 'owner' } };
const settle = async (p: Promise<Answer>) => p.then((v) => ({ ok: v }), (e: { code?: string; message?: string }) => ({ threw: e?.code, message: e?.message }));

describe('G03 active numeric check: parity with the sealed harness check', () => {
    it.each(VARIANTS)('the persisted read matches the harness exactly: %s', async (_name, mutate, errorTable) => {
        const d = fixture(); mutate(d);
        const hdb = fakeDb(structuredClone(d), { errorTable }), adb = fakeDb(structuredClone(d), { errorTable });
        const args = { caseConfig: HIST, sourceSessionId: 'A', repeatSessionId: 'B', expectedAttemptId: 'attempt' };
        const h = await settle(harness.readExpected({ ...args, db: hdb }));
        const a = await settle(readPersistedNumeric({ ...args, db: adb }));
        expect(a).toEqual(h);
        expect(adb.queries).toEqual(hdb.queries);
    });

    it('the harness case matrix is not vacuous: it reaches PASS, FAIL and NOT RUN, and the denied reads throw', async () => {
        const seen = new Set<string>();
        for (const [, mutate, errorTable] of VARIANTS) {
            const d = fixture(); mutate(d);
            const r = await settle(readPersistedNumeric({ db: fakeDb(d, { errorTable }), caseConfig: HIST, sourceSessionId: 'A', repeatSessionId: 'B', expectedAttemptId: 'attempt' }));
            if ('threw' in r) { seen.add('THREW'); continue; }
            seen.add(r.ok.result ?? `VALUE:${String(r.ok.value?.status)}`);
        }
        // A FAIL, a NOT RUN, a thrown (denied) read, an available comparison and an unavailable one are all covered.
        expect([...seen].sort()).toEqual(['FAIL', 'NOT RUN', 'THREW', 'VALUE:available', 'VALUE:unavailable']);
    });

    // The page functions run against a minimal DOM: the active and harness observations read exactly the same things.
    // As in a real page: visibility:hidden keeps its layout box (client rects); display:none and a detached node have none.
    type Node = { text: string; visibility?: string; display?: string; rects?: number };
    const dom = (state: { path: string; panel: boolean; direction: boolean; loading: boolean; nodes: Node[] }) => {
        const node = (n: Node) => ({ textContent: n.text, style: { visibility: n.visibility ?? 'visible', display: n.display ?? 'block' },
            getClientRects: () => Array.from({ length: n.rects ?? (n.display === 'none' ? 0 : 1) }, () => ({})) });
        const panel = state.panel ? {
            querySelector: (s: string) => (s.includes('progress-direction') ? (state.direction ? {} : null) : s.includes('progress-loading') ? (state.loading ? {} : null) : null),
            querySelectorAll: () => state.nodes.map(node),
        } : null;
        return {
            location: { pathname: state.path },
            document: { querySelector: (s: string) => (s === '[data-testid="progress-panel"]' ? panel : s.includes('progress-direction') ? (state.panel && state.direction ? {} : null) : s.includes('progress-loading') ? (state.panel && state.loading ? {} : null) : null) },
            getComputedStyle: (n: { style: { visibility: string; display: string } }) => n.style,
        };
    };
    const STATES = [
        { path: '/progress/A', panel: true, direction: true, loading: false, nodes: [{ text: 'X' }] },
        { path: '/progress/A', panel: true, direction: true, loading: true, nodes: [{ text: 'X' }] },
        { path: '/progress/A', panel: true, direction: false, loading: false, nodes: [] },
        { path: '/progress/A', panel: true, direction: true, loading: false, nodes: [{ text: 'X' }, { text: 'Y' }] },
        { path: '/progress/A', panel: true, direction: true, loading: false, nodes: [{ text: 'X', visibility: 'hidden' }] },
        { path: '/progress/A', panel: true, direction: true, loading: false, nodes: [{ text: 'X', display: 'none' }] },
        { path: '/progress/A', panel: true, direction: true, loading: false, nodes: [{ text: 'X', rects: 0 }] },
        { path: '/progress/B', panel: true, direction: true, loading: false, nodes: [{ text: 'X' }] },
        { path: '/progress/A', panel: false, direction: false, loading: false, nodes: [] },
    ];
    const capture = () => {
        const calls: Array<{ kind: string; fn: (route: string) => unknown; arg: string; options?: unknown }> = [];
        const page = {
            waitForFunction: async (fn: (route: string) => unknown, arg: string, options: unknown) => { calls.push({ kind: 'wait', fn, arg, options }); },
            evaluate: async (fn: (route: string) => unknown, arg: string) => { calls.push({ kind: 'evaluate', fn, arg }); return { readable: true, pathMatches: true, settled: true, count: 1, visible: true, text: 'no match' }; },
        };
        return { calls, page };
    };
    const withDom = <T,>(g: ReturnType<typeof dom>, f: () => T): T => {
        const saved = { location: Reflect.get(globalThis, 'location'), document: Reflect.get(globalThis, 'document'), getComputedStyle: Reflect.get(globalThis, 'getComputedStyle') };
        Object.assign(globalThis, g);
        try { return f(); } finally { Object.assign(globalThis, saved); }
    };
    it('the panel wait and the panel read are the harness observation: same route, timeout and results on every panel state', async () => {
        const data = { ...fixture(), sessions: [{ id: 'A', user_id: 'owner', product: 'open_mic' }, { id: 'B', user_id: 'owner', product: 'open_mic' }] };
        const h = capture(), a = capture();
        const hv = await harness.observe({ db: fakeDb(structuredClone(data)), caseConfig: HIST, sourceSessionId: 'A', repeatSessionId: 'B', expectedAttemptId: 'attempt', page: h.page });
        const av = await observeActive({ db: fakeDb(structuredClone(data)), caseConfig: R_CONFIG, sourceSessionId: 'A', repeatSessionId: 'B', expectedAttemptId: 'attempt', product: 'open_mic', page: a.page }, REGISTERED);
        expect(av).toEqual(hv);
        expect(a.calls.map(({ kind, arg, options }) => ({ kind, arg, options }))).toEqual(h.calls.map(({ kind, arg, options }) => ({ kind, arg, options })));
        for (const state of STATES) {
            for (const i of [0, 1]) {
                expect(withDom(dom(state), () => a.calls[i].fn('/progress/A'))).toEqual(withDom(dom(state), () => h.calls[i].fn('/progress/A')));
            }
        }
    });
});

// ── The active route's own rules ─────────────────────────────────────────────────────────────────────────────────────────────
const R = '0123456789abcdef0123456789abcdef01234567';
const R_CONFIG = { sourceSha: R, servedSha: R, account: { id: 'owner' } };
const HISTORICAL_BYTES = Object.fromEntries(harness.CONSUMERS.map((c) => [c.path, readFileSync(resolve(ADAPTERS, 'source/d100', c.path.split('/').pop() as string))]));
const blobs = (bytes: Record<string, Buffer>): ReadBlob => (_sha, file) => { if (!Object.hasOwn(bytes, file)) throw new Error('missing ' + file); return bytes[file]; };
const RECORD = 'frontend/src/services/progress/recordProgress.ts';
// The registered-repeat recordProgress.ts, stored as a non-source fixture: the test needs no git history (the evidence runner executes
// changed tests in a history-free copy). Its bytes are proven to be git blob 52eec014 (recordProgress.ts at c921a350) below.
const REGISTERED_RECORD = readFileSync(resolve(__dirname, '../fixtures/numeric-source/recordProgress.c921a350.ts.txt'));
const gitBlobId = (bytes: Buffer) => createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex');
const REGISTERED = { readBlob: blobs({ ...HISTORICAL_BYTES, [RECORD]: REGISTERED_RECORD }) };
const unreadable: ReadBlob = () => { throw new Error('git object missing'); };
const sessions = (product: string) => [{ id: 'A', user_id: 'owner', product }, { id: 'B', user_id: 'owner', product }];
const activeArgs = (data: Data, product: unknown, more: Partial<NumericActiveArgs> = {}): NumericActiveArgs =>
    ({ db: fakeDb(data), caseConfig: R_CONFIG, sourceSessionId: 'A', repeatSessionId: 'B', expectedAttemptId: 'attempt', product, ...more });
const panel = (text: string) => ({ waitForFunction: async () => undefined, evaluate: async () => ({ readable: true, pathMatches: true, settled: true, count: 1, visible: true, text }) });

describe('G03 active numeric check: source, identity and verdicts', () => {
    it('the sealed sets: historical is the packet\'s own d100 bytes; registered-repeat is the #1827 blob with the other three shared', () => {
        expect(NUMERIC_CONSUMER_PATHS).toEqual(harness.CONSUMERS.map((c) => c.path));
        expect(NUMERIC_SOURCE_SETS[0].sha256).toEqual(NUMERIC_CONSUMER_PATHS.map((p) => sha256(HISTORICAL_BYTES[p])));
        expect(NUMERIC_SOURCE_SETS[1].sha256.slice(0, 3)).toEqual(NUMERIC_SOURCE_SETS[0].sha256.slice(0, 3));
        expect(NUMERIC_SOURCE_SETS[1].sha256[3]).toBe(sha256(REGISTERED_RECORD));
        expect(gitBlobId(REGISTERED_RECORD)).toBe('52eec0141fa42e046a88f05d46af1bc3e5d21afd');
        expect(NUMERIC_SOURCE_SETS[1].sha256[3]).not.toBe(NUMERIC_SOURCE_SETS[0].sha256[3]);
    });

    it('both complete sets qualify at an arbitrary exact release', () => {
        expect(preflightActive(R_CONFIG, { readBlob: blobs(HISTORICAL_BYTES) }).set).toBe('historical-5a7bf6a1');
        expect(preflightActive(R_CONFIG, REGISTERED).set).toBe('registered-repeat-c921a350');
    });

    it('no trusted SHA: the historical origin with unreadable git bytes is NOT_RUN', () => {
        const origin = { sourceSha: harness.SOURCE_SHA, servedSha: harness.SOURCE_SHA, account: { id: 'owner' } };
        expect(() => preflightActive(origin, { readBlob: unreadable })).toThrow(expect.objectContaining({ code: 'NOT_RUN' }));
    });

    it('a changed, missing or mixed consumer set, and a split, short, uppercase or missing binding, are NOT_RUN', () => {
        const changed = { ...HISTORICAL_BYTES, [NUMERIC_CONSUMER_PATHS[1]]: Buffer.concat([HISTORICAL_BYTES[NUMERIC_CONSUMER_PATHS[1]], Buffer.from('\n')]) };
        const missing = Object.fromEntries(Object.entries(HISTORICAL_BYTES).filter(([p]) => p !== RECORD));
        for (const bytes of [changed, missing]) expect(() => preflightActive(R_CONFIG, { readBlob: blobs(bytes) })).toThrow(expect.objectContaining({ code: 'NOT_RUN' }));
        for (const delta of [{ servedSha: 'f'.repeat(40) }, { sourceSha: R.slice(0, 12), servedSha: R.slice(0, 12) }, { sourceSha: R.toUpperCase(), servedSha: R.toUpperCase() }, { servedSha: null }]) {
            expect(() => preflightActive({ ...R_CONFIG, ...delta }, REGISTERED)).toThrow(expect.objectContaining({ code: 'NOT_RUN' }));
        }
        // A per-file mix of two complete sets matches neither.
        const sets = [{ id: 'x', sealedAt: 'x', sha256: ['a1', 'b1', 's2', 's3'].map(sha256) }, { id: 'y', sealedAt: 'y', sha256: ['a2', 'b2', 's2', 's3'].map(sha256) }];
        const of = (a: string, b: string) => blobs(Object.fromEntries(NUMERIC_CONSUMER_PATHS.map((p, i) => [p, Buffer.from([a, b, 's2', 's3'][i])])));
        expect(matchingNumericSet(R, of('a1', 'b1'), sets)).toBe('x');
        expect(matchingNumericSet(R, of('a2', 'b2'), sets)).toBe('y');
        expect(matchingNumericSet(R, of('a1', 'b2'), sets)).toBeNull();
        expect(matchingNumericSet(R, of('a2', 'b1'), sets)).toBeNull();
    });

    for (const product of ['open_mic', 'focus_points']) {
        const other = product === 'open_mic' ? 'focus_points' : 'open_mic';
        const data = () => ({ ...fixture(), sessions: sessions(product) });
        it(`${product}: exact owner, product, bound attempt and both evaluations, then matching rendered numbers PASS`, async () => {
            const e = await readExpectedActive(activeArgs(data(), product), REGISTERED);
            expect((e as Answer).value?.status).toBe('available');
            const r = await observeActive({ ...activeArgs(data(), product), page: panel(harness.expectedText((e as Answer).value)) }, REGISTERED);
            expect(r.result).toBe('PASS');
        });
        it(`${product}: mismatched rendered numbers FAIL; a missing panel is NOT RUN`, async () => {
            expect((await observeActive({ ...activeArgs(data(), product), page: panel('Filler rate: 3.0 → 2.5 % of words (original session → linked repeat).') }, REGISTERED)).result).toBe('FAIL');
            const gone = { waitForFunction: async () => { throw new Error('timeout'); }, evaluate: async () => ({}) };
            expect((await observeActive({ ...activeArgs(data(), product), page: gone }, REGISTERED)).result).toBe('NOT RUN');
        });
        it(`${product}: the other product, a foreign or missing saved session`, async () => {
            for (const [index, delta, want] of [[0, { product: other }, 'FAIL'], [1, { product: other }, 'FAIL'], [1, { product: null }, 'FAIL'], [0, { user_id: 'other' }, 'FAIL'], [1, { user_id: 'other' }, 'FAIL']] as Array<[number, Row, string]>) {
                const d = data(); Object.assign(d.sessions[index], delta);
                expect({ delta, result: ((await readExpectedActive(activeArgs(d, product), REGISTERED)) as Answer).result }).toEqual({ delta, result: want });
            }
            const d = data(); d.sessions.pop();
            expect(((await readExpectedActive(activeArgs(d, product), REGISTERED)) as Answer).result).toBe('NOT RUN');
        });
        it(`${product}: an unrelated newer take or a foreign take cannot lend its numbers`, async () => {
            const d = data(); d.progress_recommendation_attempts.push({ ...d.progress_recommendation_attempts[0], id: 'newer', practice_session_id: 'C', accepted_at: '2026-10-27T14:01:00Z' });
            expect(((await readExpectedActive(activeArgs(d, product), REGISTERED)) as Answer).result).toBe('FAIL');
            const f = data(); f.progress_recommendation_attempts[0].user_id = 'other';
            expect(((await readExpectedActive(activeArgs(f, product), REGISTERED)) as Answer).result).toBe('FAIL');
        });
        it(`${product}: no journey product, no bound attempt, or no git bytes is NOT_RUN, never the historical route`, async () => {
            const origin = { sourceSha: harness.SOURCE_SHA, servedSha: harness.SOURCE_SHA, account: { id: 'owner' } };
            for (const [args, options] of [[activeArgs(data(), undefined), REGISTERED], [activeArgs(data(), 'freeform'), REGISTERED], [activeArgs(data(), product, { expectedAttemptId: null }), REGISTERED], [activeArgs(data(), product, { caseConfig: origin }), { readBlob: unreadable }]] as Array<[NumericActiveArgs, { readBlob: ReadBlob }]>) {
                await expect(readExpectedActive(args, options)).rejects.toMatchObject({ code: 'NOT_RUN' });
            }
        });
    }

    it('the sealed packet is untouched: the harness adapter still exports only its historical route', () => {
        const src = readFileSync(resolve(ADAPTERS, 'progress-numeric.cjs'), 'utf8');
        expect(src).toContain('if(c.sourceSha!==SOURCE_SHA&&!sourceCompatible(c.sourceSha,options.readBlob??gitBlob))');
        expect(src).not.toMatch(/observeActive|preflightActive/);
    });

    it('both journey callers take this active route with their own product and the bound attempt, never the harness observe', () => {
        for (const [file, product] of [['../live/rwt-open-mic-first-session.live.spec.ts', 'open_mic'], ['../live/helpers/rwtFocusPointsJourney.ts', 'focus_points']]) {
            const src = readFileSync(resolve(__dirname, file), 'utf8');
            const step = src.slice(src.indexOf("test.step('saved and displayed comparison numbers match'"));
            const body = step.slice(0, step.indexOf('numericComparisonRow('));
            expect(body).toContain('observeActive({');
            expect(body).toContain(`expectedAttemptId: boundAttemptId, product: '${product}',`);
            expect(body).not.toMatch(/numeric\.(observe|readExpected|preflight)\(/);
        }
    });
});
