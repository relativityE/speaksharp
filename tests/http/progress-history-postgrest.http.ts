/* @vitest-environment jsdom */
/**
 * #1258 F3 — the Progress history read over HTTP: the REAL `loadSessionProgress`, through the installed
 * `@supabase/postgrest-js`, against a REAL PostgREST on a disposable Postgres holding the migration-defined Progress
 * relationships (scripts/progress-postgrest-bootstrap.sh). Run by .github/workflows/progress-postgrest-proof.yml.
 *
 * `session_progress_evaluations` has THREE foreign keys to `sessions` (its own session, baseline, previous).
 * RED: the shipped un-hinted embed `session_progress_evaluations!inner(cohort_key)` is refused as ambiguous
 * (PGRST201), so every first eligible session read as `error` and Practice again only refetched Progress (RWT run
 * 37514078995). GREEN: the embed names the `session_id` relationship — taken from the server's own hint and the
 * constraint catalogue, not guessed — and returns the history the comparison rule intends.
 */
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PostgrestClient } from '@supabase/postgrest-js';

const BASE = process.env.PROGRESS_PGRST_URL ?? 'http://127.0.0.1:3999';
const SECRET = process.env.PGRST_JWT_SECRET ?? 'disposable-ci-only-secret-at-least-32-chars-long';
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const CURRENT = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
const EARLIER = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const LATER = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003';
const OTHERS_EARLIER = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
const COHORT = 'private|v2|base|clarity_v1|freeform';
const OTHER_COHORT = 'private|v2|base|clarity_v1|focus_points';
const OLD_SELECT = 'id, session_progress_evaluations!inner(cohort_key)';

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');
const jwt = (sub: string, role = 'authenticated') => {
    const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const p = b64url(JSON.stringify({ role, sub, exp: Math.floor(Date.now() / 1000) + 3600 }));
    return `${h}.${p}.${b64url(createHmac('sha256', SECRET).update(`${h}.${p}`).digest())}`;
};
const client = (token: string) => new PostgrestClient(BASE, { headers: { Authorization: `Bearer ${token}` } });
const sql = (q: string) => execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-qAt', '-c', q], { encoding: 'utf8' }).trim();

// The service's ONLY network dependency is the Supabase client; it is the real postgrest-js client here.
let current = client(jwt(USER));
vi.mock('@/lib/supabaseClient', () => ({
    getSupabaseClient: () => ({ from: (t: string) => current.from(t), rpc: (fn: string, args?: object) => current.rpc(fn, args) }),
}));
vi.mock('@/contexts/AuthProvider', () => ({ useAuthProvider: () => ({ user: { id: USER } }) }));
const { loadSessionProgress } = await import('../../frontend/src/services/progress/loadSessionProgress');
const { useLinkedRepeat } = await import('../../frontend/src/hooks/useLinkedRepeat');
const { progressReadDiagnostic } = await import('../../frontend/src/services/progress/progressReadDiagnostic');

/** The embed the shipped service sends, read from its source so this proof cannot drift from the code under test. */
const SHIPPED_SELECT = /\.select\('(id, session_progress_evaluations[^']*)'\)/.exec(readFileSync(
    path.resolve(__dirname, '../../frontend/src/services/progress/loadSessionProgress.ts'), 'utf8'))?.[1];

const session = (id: string, user: string, createdAt: string) =>
    `INSERT INTO public.sessions VALUES ('${id}', '${user}', '${createdAt}');`;
type ReferenceColumn = 'baseline_session_id' | 'previous_comparable_session_id';
const evaluation = (sessionId: string, user: string, cohort: string, refs: Partial<Record<ReferenceColumn, string>> = {}) => `
    INSERT INTO public.session_progress_evaluations (user_id, session_id, formula_version, duration_seconds, word_count,
        clarity_evidence_available, engine, engine_version, model_name, attribution_status, eligible, clarity_raw,
        filler_count, error_marker_count, wpm, cohort_key, baseline_session_id, previous_comparable_session_id)
    VALUES ('${user}', '${sessionId}', 'clarity_v1', 60, 120, true, 'private', 'v2', 'base', 'verified', true, 84,
        3, 0, 130, '${cohort}', ${refs.baseline_session_id ? `'${refs.baseline_session_id}'` : 'NULL'},
        ${refs.previous_comparable_session_id ? `'${refs.previous_comparable_session_id}'` : 'NULL'});`;
const recommendation = (sessionId: string, user: string) => `
    INSERT INTO public.progress_recommendations (id, user_id, source_session_id, formula_version, target_metric,
        target_direction, target_value, target_units, source_metric_value, shown_text)
    VALUES ('cccccccc-cccc-4ccc-8ccc-${sessionId.slice(-12)}', '${user}', '${sessionId}', 'clarity_v1', 'filler_rate',
        'decrease', 2, 'percent of words', 2.5, 'Cut filler words toward 2%');`;
const recommendationId = (sessionId: string) => `cccccccc-cccc-4ccc-8ccc-${sessionId.slice(-12)}`;

beforeEach(() => {
    sql(`TRUNCATE public.progress_recommendation_attempts, public.progress_recommendations,
             public.session_progress_evaluations, public.sessions, auth.users CASCADE;
         INSERT INTO auth.users VALUES ('${USER}'), ('${OTHER}');
         ${session(EARLIER, USER, '2026-10-01T09:00:00.123456+00')}
         ${session(CURRENT, USER, '2026-10-01T10:00:00.123456+00')}
         ${session(LATER, USER, '2026-10-01T11:00:00+00')}
         ${session(OTHERS_EARLIER, OTHER, '2026-09-01T10:00:00+00')}
         ${evaluation(CURRENT, USER, COHORT)}
         ${recommendation(CURRENT, USER)}`);
    current = client(jwt(USER));
});

describe('#1258 F3 Progress history through real PostgREST under the migration-defined relationships', () => {
    it('the schema has three sessions relationships, and the shipped hint names the session_id one', () => {
        const fkeys = sql(`SELECT c.conname || ':' || a.attname FROM pg_constraint c
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
            WHERE c.conrelid = 'public.session_progress_evaluations'::regclass AND c.contype = 'f'
              AND c.confrelid = 'public.sessions'::regclass ORDER BY 1`).split('\n');
        expect(fkeys).toHaveLength(3);
        const hint = /session_progress_evaluations!([a-z0-9_]+)!inner/.exec(SHIPPED_SELECT ?? '')?.[1];
        expect(fkeys).toContain(`${hint}:session_id`);
    });

    it('RED — the old un-hinted embed is refused as ambiguous, and the server names the shipped relationship', async () => {
        const { data, error } = await current.from('sessions').select(OLD_SELECT).limit(1);
        expect(data).toBeNull();
        expect(error?.code).toBe('PGRST201');
        // PostgREST lists every candidate relationship; the shipped embed must be one it offers, verbatim.
        const offered = JSON.stringify([error?.hint, error?.details]);
        expect(offered).toContain('session_progress_evaluations_session_id_fkey');
        // The real refusal is recorded as closed codes only; none of the server's wording survives.
        const diagnostic = progressReadDiagnostic('history_prior', error);
        expect(diagnostic).toEqual({ stage: 'history_prior', code: 'PGRST201' });
        expect(JSON.stringify(diagnostic)).not.toMatch(/embed|relationship|fkey/i);
        expect(SHIPPED_SELECT).toBe('id, session_progress_evaluations!session_progress_evaluations_session_id_fkey!inner(cohort_key)');
    });

    it('GREEN — the shipped embed is accepted by PostgREST', async () => {
        const { error } = await current.from('sessions').select(SHIPPED_SELECT as string).limit(1);
        expect(error).toBeNull();
    });

    it('GREEN — a first eligible session reads as an eligible baseline with its stored next action', async () => {
        await expect(loadSessionProgress(CURRENT)).resolves.toMatchObject({
            status: 'eligible', comparison: 'baseline', recommendationId: recommendationId(CURRENT), latestAttempt: null,
        });
    });

    it('an earlier eligible session in ANOTHER cohort restarts the comparison (the timestamp filter crosses HTTP intact)', async () => {
        // Discriminating in the other direction too: nothing REFERENCES EARLIER, so a join through baseline/previous
        // would find no prior session and wrongly report a first-ever baseline.
        sql(evaluation(EARLIER, USER, OTHER_COHORT));
        await expect(loadSessionProgress(CURRENT)).resolves.toMatchObject({ status: 'eligible', comparison: 'restarted' });
    });

    it.each(['baseline_session_id', 'previous_comparable_session_id'] as const)(
        'a session referenced ONLY through %s is not history: each prior session joins to its own evaluation', async (column) => {
            // EARLIER has no evaluation of its own; a LATER, other-cohort evaluation names it through `column`. Joined
            // through that relationship it would read as a prior other-cohort session ("restarted"); it is not one.
            sql(evaluation(LATER, USER, OTHER_COHORT, { [column]: EARLIER }));
            expect(sql(`SELECT count(*) FROM public.session_progress_evaluations WHERE ${column} = '${EARLIER}'`)).toBe('1');
            expect(sql(`SELECT count(*) FROM public.session_progress_evaluations WHERE session_id = '${EARLIER}'`)).toBe('0');
            await expect(loadSessionProgress(CURRENT)).resolves.toMatchObject({ status: 'eligible', comparison: 'baseline' });
        });

    it('an INELIGIBLE earlier evaluation is not history: the eligibility filter survives the embed', async () => {
        sql(`INSERT INTO public.session_progress_evaluations (user_id, session_id, formula_version, duration_seconds, word_count,
                clarity_evidence_available, eligible, exclusion_reasons)
             VALUES ('${USER}', '${EARLIER}', 'clarity_v1', 5, 3, false, false, '{too_few_words}');`);
        await expect(loadSessionProgress(CURRENT)).resolves.toMatchObject({ status: 'eligible', comparison: 'baseline' });
    });

    it("another account's earlier session never enters this account's history (RLS)", async () => {
        sql(evaluation(OTHERS_EARLIER, OTHER, OTHER_COHORT));
        await expect(loadSessionProgress(CURRENT)).resolves.toMatchObject({ status: 'eligible', comparison: 'baseline' });
    });

    it('Practice again: the linked repeat reads `linked` for a first eligible session (was `error`)', async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const wrapper = ({ children }: { children: React.ReactNode }) =>
            React.createElement(QueryClientProvider, { client: queryClient }, children);
        const { result } = renderHook(() => useLinkedRepeat(CURRENT), { wrapper });
        await waitFor(() => expect(result.current.linkState).not.toBe('pending'));
        expect(result.current.linkState).toBe('linked');
        expect(result.current.recommendationId).toBe(recommendationId(CURRENT));
    });
});
