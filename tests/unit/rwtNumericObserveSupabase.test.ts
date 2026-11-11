// @vitest-environment node
/**
 * Review RETURN on 39e3c527: the harness numeric check (`progress-numeric.cjs`) is called by the Open Mic journey with the REAL
 * Supabase admin client. Its linked-evaluation adapter discarded the builder `select()` returned, so `q.eq` threw with the real
 * client (the module's own fake database tolerated it). These controls run the complete observe() path through the INSTALLED
 * @supabase/supabase-js query builder over an offline PostgREST transport — no network.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectedReleaseSha } from '../live/helpers/rwtJourney';

const req = createRequire(__filename);
const numeric = req(resolve(__dirname, '../../tools/cloud-test/harness/draft-adapters/progress-numeric.cjs')) as {
    SOURCE_SHA: string;
    REVALIDATED_SHAS: readonly string[];
    observe: (a: Record<string, unknown>) => Promise<{ result: string; facts: Record<string, unknown> }>;
    expectedText: (v: unknown) => string;
    readExpected: (a: Record<string, unknown>) => Promise<{ result?: string; value?: unknown }>;
};

type Row = Record<string, unknown>;
const ev = (id: string, more: Row = {}): Row => ({ session_id: id, user_id: 'owner', formula_version: 'clarity_v1', eligible: true, exclusion_reasons: [], clarity_raw: 80,
    filler_count: 3, error_marker_count: 0, wpm: 120, word_count: 100, cohort_key: 'engine|version|model|clarity_v1|freeform', baseline_session_id: null,
    previous_comparable_session_id: null, ...more });
const fixture = (): Record<string, Row[]> => ({
    progress_recommendations: [{ id: 'rec', user_id: 'owner', source_session_id: 'A', formula_version: 'clarity_v1', target_metric: 'filler_rate', target_direction: 'decrease',
        target_value: 1, target_units: '% of words', source_metric_value: 3, shown_text: 'private target' }],
    progress_recommendation_attempts: [{ id: 'attempt', user_id: 'owner', recommendation_id: 'rec', practice_session_id: 'B', next_comparable_session_id: 'B', lifecycle: 'completed',
        outcome: 'moved', accepted_at: '2026-10-27T14:00:00Z' }],
    session_progress_evaluations: [ev('A'), ev('B', { filler_count: 2 })],
});

/** An offline PostgREST: filters eq.<v>, order, limit; object responses for the single-object Accept header. */
function offlineFetch(data: Record<string, Row[]>, o: { deny?: string } = {}) {
    const calls: string[] = [];
    const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = new URL(String(input));
        const table = url.pathname.replace(/^\/rest\/v1\//, '');
        calls.push(table);
        if (o.deny === table) return new Response(JSON.stringify({ code: '42501', message: 'denied' }), { status: 403, headers: { 'content-type': 'application/json' } });
        let rows = [...(data[table] ?? [])];
        for (const [k, v] of url.searchParams) {
            if (k === 'select' || k === 'limit' || k === 'order') continue;
            if (v.startsWith('eq.')) rows = rows.filter((r) => String(r[k]) === v.slice(3));
        }
        const order = url.searchParams.get('order');
        if (order) {
            const [col, dir] = order.split('.');
            rows.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (dir === 'desc' ? -1 : 1));
        }
        const limit = url.searchParams.get('limit');
        if (limit) rows = rows.slice(0, Number(limit));
        const accept = new Headers(init?.headers).get('accept') ?? '';
        if (accept.includes('vnd.pgrst.object')) {
            if (rows.length !== 1) return new Response(JSON.stringify({ code: 'PGRST116', message: 'no rows' }), { status: 406, headers: { 'content-type': 'application/json' } });
            return new Response(JSON.stringify(rows[0]), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    return { fetch, calls };
}

const client = (f: typeof fetch) => createClient('https://abcdefghijklmnopqrst.supabase.co', 'offline-key', {
    auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: f },
});
const page = (text: string | null) => ({
    waitForFunction: async () => undefined,
    evaluate: async () => ({ readable: true, pathMatches: true, settled: true, count: text === null ? 0 : 1, visible: text !== null, text }),
});
const CASE = { sourceSha: '', servedSha: '', account: { id: 'owner' } };
const run = async (data: Record<string, Row[]>, rendered: string | null | ((expected: string) => string), o: { deny?: string; release?: string } = {}) => {
    const t = offlineFetch(data, o);
    const db = client(t.fetch as typeof fetch);
    const sha = o.release ?? numeric.SOURCE_SHA;
    const caseConfig = { ...CASE, sourceSha: sha, servedSha: sha };
    const expected = await numeric.readExpected({ db: client(offlineFetch(fixture()).fetch as typeof fetch), caseConfig: { ...CASE, sourceSha: numeric.SOURCE_SHA, servedSha: numeric.SOURCE_SHA },
        sourceSessionId: 'A', repeatSessionId: 'B' });
    const want = expected.value ? numeric.expectedText(expected.value) : '';
    const text = typeof rendered === 'function' ? rendered(want) : rendered;
    const r = await numeric.observe({ page: page(text), db, caseConfig, sourceSessionId: 'A', repeatSessionId: 'B' }).catch((e: { code?: string }) => ({ result: e?.code === 'NOT_RUN' ? 'NOT RUN' : 'THREW', facts: {} }));
    return { r, calls: t.calls, want };
};

describe('progress-numeric observe() through the installed Supabase client (offline transport)', () => {
    it('PASS: the exact rendered before → after text, reached through the linked-repeat read with the real builder', async () => {
        const { r, calls, want } = await run(fixture(), (w) => w);
        expect(want).toBe('Filler rate: 3.0 → 2.0 % of words (original session → linked repeat).');
        expect(r.result).toBe('PASS');
        // the linked repeat evaluation was read (the read that threw `q.eq is not a function` before the fix)
        expect(calls.filter((t) => t === 'session_progress_evaluations').length).toBeGreaterThanOrEqual(2);
    });
    it('CASUALTY: reversed numbers, wrong units or a missing value FAIL', async () => {
        for (const rendered of ['Filler rate: 2.0 → 3.0 % of words (original session → linked repeat).', 'Filler rate: 3.0 → 2.0 wpm (original session → linked repeat).']) {
            expect({ rendered, r: (await run(fixture(), rendered)).r.result }).toEqual({ rendered, r: 'FAIL' });
        }
        expect((await run(fixture(), null)).r.result).toBe('FAIL');
    });
    it('CASUALTY: a linked repeat evaluation of another owner, session or formula never passes', async () => {
        for (const delta of [{ user_id: 'other' }, { session_id: 'C' }, { formula_version: 'other_v9' }]) {
            const d = fixture();
            d.session_progress_evaluations = [ev('A'), { ...ev('B', { filler_count: 2 }), ...delta, ...(delta.session_id ? {} : {}) }];
            if ('session_id' in delta) d.session_progress_evaluations.push({ ...ev('B', { filler_count: 2 }), session_id: 'C' });
            const { r } = await run(d, (w) => w);
            expect({ delta, ok: r.result !== 'PASS' }).toEqual({ delta, ok: true });
        }
    });
    it('CASUALTY: a missing row, a denied read or another release is NOT RUN (never PASS)', async () => {
        const d = fixture();
        d.progress_recommendation_attempts = [];
        expect((await run(d, (w) => w)).r.result).toBe('NOT RUN');
        expect((await run(fixture(), (w) => w, { deny: 'session_progress_evaluations' })).r.result).toBe('NOT RUN');
        expect((await run(fixture(), (w) => w, { release: '0'.repeat(40) })).r.result).toBe('NOT RUN');
    });
});

/**
 * Release 2 (5ffbbb93): the module accepts only revalidated exact pairs; release 2 before any read, so the journey row could only
 * HOLD. 5a7bf6a1's four consumer files are byte-identical to the revalidated snapshots (source/receiving-numeric-source-
 * 5a7bf6a1.json). This drives observe() with the values the AHT-01 caller actually passes: sourceSha = expectedReleaseSha()
 * (rc-gates sets EXPECTED_RELEASE_SHA from diagnostic_release_sha) and servedSha = the page's window.__APP_RELEASE__.
 */
describe('the AHT-01 caller\'s real release binding (5ffbbb93)', () => {
    const SERVED = '5ffbbb93c34371d1960f01d4713a1fa656887d73';
    afterEach(() => vi.unstubAllEnvs());
    const callerRun = async (served: string | null) => {
        const t = offlineFetch(fixture());
        const expected = await numeric.readExpected({ db: client(offlineFetch(fixture()).fetch as typeof fetch),
            caseConfig: { ...CASE, sourceSha: numeric.SOURCE_SHA, servedSha: numeric.SOURCE_SHA }, sourceSessionId: 'A', repeatSessionId: 'B' });
        const want = numeric.expectedText(expected.value);
        return numeric.observe({ page: page(want), db: client(t.fetch as typeof fetch), sourceSessionId: 'A', repeatSessionId: 'B',
            caseConfig: { sourceSha: expectedReleaseSha(), servedSha: served, account: { id: 'owner' } } })
            .catch((e: { code?: string }) => ({ result: e?.code === 'NOT_RUN' ? 'NOT RUN' : 'THREW', facts: {} }));
    };
    it('PASS with the dispatch input and the served page both 5ffbbb93 (release 2)', async () => {
        vi.stubEnv('EXPECTED_RELEASE_SHA', SERVED);
        expect(numeric.REVALIDATED_SHAS).toContain(SERVED);
        expect((await callerRun(SERVED)).result).toBe('PASS');
    });
    it('CASUALTY: a served page on another release, no served release, or an unrevalidated release is NOT RUN', async () => {
        vi.stubEnv('EXPECTED_RELEASE_SHA', SERVED);
        expect((await callerRun(numeric.SOURCE_SHA)).result).toBe('NOT RUN');
        expect((await callerRun(null)).result).toBe('NOT RUN');
        vi.stubEnv('EXPECTED_RELEASE_SHA', 'c'.repeat(40));
        expect((await callerRun('c'.repeat(40))).result).toBe('NOT RUN');
    });
});
