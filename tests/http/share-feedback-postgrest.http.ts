/**
 * #1258 — Share Feedback over HTTP: the REAL `issueReportService.submit`, through the installed `@supabase/postgrest-js`
 * (the client `supabase-js` uses for `.from()`), against a REAL PostgREST on a disposable Postgres that holds ONLY the
 * migration-defined grants (scripts/feedback-postgrest-bootstrap.sh). Run by .github/workflows/feedback-postgrest-proof.yml.
 *
 * RED: the shipped write, `upsert(row, { onConflict: 'idempotency_key', ignoreDuplicates: true })`, is refused (42501):
 * `INSERT … ON CONFLICT` needs SELECT on the conflict column and `authenticated` has INSERT only.
 * GREEN: the plain insert stores one row per draft; only THIS draft's collision on the idempotency index is "stored".
 */
import { createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgrestClient } from '@supabase/postgrest-js';

const BASE = process.env.FEEDBACK_PGRST_URL ?? 'http://127.0.0.1:3999';
const SECRET = process.env.PGRST_JWT_SECRET ?? 'disposable-ci-only-secret-at-least-32-chars-long';
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const OWN_SESSION = '130bbc6c-5d89-465d-91e6-51f5a5951e34';
const FOREIGN_SESSION = '44444444-4444-4444-8444-444444444444';
const BODY = 'RWT automated journey check from a disposable account. Please ignore.';

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');
const jwt = (sub: string, role = 'authenticated') => {
    const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const p = b64url(JSON.stringify({ role, sub, exp: Math.floor(Date.now() / 1000) + 3600 }));
    return `${h}.${p}.${b64url(createHmac('sha256', SECRET).update(`${h}.${p}`).digest())}`;
};
const client = (token: string | null) => new PostgrestClient(BASE, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
const sql = (q: string) => execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-qAt', '-c', q], { encoding: 'utf8' }).trim();
const count = (where = 'true') => Number(sql(`SELECT count(*) FROM public.user_issue_reports WHERE ${where}`));

// The service's ONLY network dependency is the Supabase client; it is the real postgrest-js client here.
let current = client(jwt(USER));
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ from: (t: string) => current.from(t) }) }));
const emitted: Array<{ event: string; props: Record<string, unknown> }> = [];
vi.mock('@/services/telemetry/safeEmit', () => ({
    safeEmit: (event: string, props: Record<string, unknown>) => { emitted.push({ event, props }); },
}));
const { issueReportService, isIdempotentReplay } = await import('../../frontend/src/services/issueReportService');

const send = (key: string, over: Partial<{ userId: string; sessionId: string | null; title: string }> = {}) => issueReportService.submit({
    userId: over.userId ?? USER, sessionId: over.sessionId === undefined ? OWN_SESSION : over.sessionId,
    category: 'analytics_sessions', severity: 'not_applicable', title: over.title ?? 'RWT automated journey check.',
    description: BODY, pageUrl: '/analytics/id',
    metadata: { route: '/analytics/id', feedback_type: 'praise', feedback_kind: 'comment', feedback_severity: null },
    includeAudio: false, idempotencyKey: key,
});
const rowFor = (key: string) => ({
    user_id: USER, session_id: OWN_SESSION, category: 'analytics_sessions', severity: 'not_applicable',
    title: 'RWT automated journey check.', description: BODY, page_url: '/analytics/id',
    metadata: { feedback_type: 'praise', feedback_kind: 'comment', feedback_severity: null },
    include_audio: false, audio_attachment_note: null, idempotency_key: key,
});

beforeEach(() => {
    sql(`DELETE FROM public.user_issue_reports; DELETE FROM public.sessions; DELETE FROM auth.users;
         INSERT INTO auth.users VALUES ('${USER}'), ('${OTHER}');
         INSERT INTO public.sessions VALUES ('${OWN_SESSION}', '${USER}'), ('${FOREIGN_SESSION}', '${OTHER}');`);
    current = client(jwt(USER));
    emitted.length = 0;
});

describe('#1258 Share Feedback through real PostgREST under the migration-defined grants', () => {
    it('RED — the shipped upsert write is refused with 42501 and stores nothing', async () => {
        const { error } = await current.from('user_issue_reports')
            .upsert(rowFor(randomUUID()), { onConflict: 'idempotency_key', ignoreDuplicates: true });
        expect(error?.code).toBe('42501');
        expect(count()).toBe(0);
    });

    it('GREEN — first send stores ONE row linked to the owned session; the storage layer emits no feedback outcome or content', async () => {
        await expect(send(randomUUID())).resolves.toEqual({ id: null });
        expect(count()).toBe(1);
        expect(count(`session_id = '${OWN_SESSION}'`)).toBe(1);
        // Codex r4195165652: the dialog is the single feedback_submit emitter; the storage layer sends none.
        expect(emitted.filter((e) => e.event === 'feedback_submit')).toEqual([]);
        expect(JSON.stringify(emitted)).not.toContain(BODY);
    });

    it('a repeated delivery of the SAME draft is recognised as already stored: one row, two successes', async () => {
        const key = randomUUID();
        await send(key);
        await expect(send(key)).resolves.toEqual({ id: null });
        expect(count()).toBe(1);
    });

    it('CONCURRENT delivery of the same draft: both resolve, one row', async () => {
        const key = randomUUID();
        await expect(Promise.all([send(key), send(key), send(key)])).resolves.toHaveLength(3);
        expect(count()).toBe(1);
    });

    it('a NEW draft (new key) is a new row', async () => {
        await send(randomUUID());
        await send(randomUUID());
        expect(count()).toBe(2);
    });

    it('ownership: a report claiming ANOTHER sender is refused by RLS (failure, nothing stored)', async () => {
        await expect(send(randomUUID(), { userId: OTHER })).rejects.toMatchObject({ code: '42501' });
        expect(count()).toBe(0);
        expect(emitted.filter((e) => e.event === 'feedback_submit')).toEqual([]);
    });

    it('ownership: a link to a session the sender does not own is dropped, the report kept', async () => {
        await send(randomUUID(), { sessionId: FOREIGN_SESSION });
        expect(count()).toBe(1);
        expect(count('session_id IS NOT NULL')).toBe(0);
    });

    it('an UNRELATED unique collision (primary key) is a failure, never "already stored"', async () => {
        const id = randomUUID();
        await current.from('user_issue_reports').insert({ id, ...rowFor(randomUUID()) });
        const { error } = await current.from('user_issue_reports').insert({ id, ...rowFor(randomUUID()) });
        expect(error?.code).toBe('23505');
        expect(isIdempotentReplay(error, rowFor('x').idempotency_key)).toBe(false);
        expect(count()).toBe(1);
    });

    it('the idempotency collision PostgREST returns is exactly what isIdempotentReplay accepts', async () => {
        const key = randomUUID();
        await current.from('user_issue_reports').insert(rowFor(key));
        const { error } = await current.from('user_issue_reports').insert(rowFor(key));
        expect(error?.code).toBe('23505');
        expect(error?.message).toContain('"user_issue_reports_idempotency_key_unique"');
        // Postgres omits the key values from the detail when the role cannot SELECT them (authenticated cannot), so
        // the constraint name is the verifiable signal; a collision on that index is necessarily with the key just sent.
        expect(error?.details ?? '').not.toContain(key);
        expect(isIdempotentReplay(error, key)).toBe(true);
    });

    it('a check violation stays a failure', async () => {
        await expect(send(randomUUID(), { title: 'x'.repeat(81) })).rejects.toMatchObject({ code: '23514' });
        expect(count()).toBe(0);
    });

    const outcomes = () => emitted.filter((e) => e.event === 'feedback_submit').map((e) => e.props.outcome);
    const sanitized = (key: string) => {
        const wire = JSON.stringify(emitted);
        expect(wire).not.toContain(BODY);
        expect(wire).not.toContain(key);
        expect(wire).not.toMatch(/permission denied|row-level|duplicate key|fetch failed|user_issue_reports|ECONNREFUSED/i);
    };

    it('PERMISSION failure — no JWT (anon): refused, nothing stored, no storage-layer outcome and no content', async () => {
        current = client(null);
        const key = randomUUID();
        await expect(send(key)).rejects.toBeTruthy();
        expect(count()).toBe(0);
        expect(outcomes()).toEqual([]);
        sanitized(key);
    });

    it('PERMISSION failure — RLS (another sender): refused; no storage-layer outcome and no content', async () => {
        const key = randomUUID();
        await expect(send(key, { userId: OTHER })).rejects.toMatchObject({ code: '42501' });
        expect(outcomes()).toEqual([]);
        sanitized(key);
    });

    it('NETWORK failure — the API is unreachable: a failure (never "stored"), nothing stored, no content', async () => {
        current = new PostgrestClient('http://127.0.0.1:1', { headers: { Authorization: `Bearer ${jwt(USER)}` } });
        const key = randomUUID();
        await expect(send(key)).rejects.toBeTruthy();
        expect(count()).toBe(0);
        expect(outcomes()).toEqual([]);
        sanitized(key);
    });

    it('success and replay send no storage-layer outcome and no content', async () => {
        const key = randomUUID();
        await send(key);
        await send(key);
        expect(outcomes()).toEqual([]);
        sanitized(key);
    });
});
