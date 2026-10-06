// @vitest-environment node
/**
 * #1258 — the Share Feedback write, as the `authenticated` role under RLS, on real Postgres (PGlite) with every
 * `user_issue_reports` migration in order.
 *
 * The shipped dialog wrote with `upsert(..., { onConflict: 'idempotency_key', ignoreDuplicates: true })`, which
 * PostgREST executes as `INSERT … ON CONFLICT (idempotency_key) DO NOTHING`. Postgres requires SELECT privilege on a
 * conflict-target column, and the migrations grant `authenticated` INSERT only, so that write is refused with 42501
 * and nothing is stored. The fix writes with a plain INSERT: no read grant is needed, the unique index still keeps a
 * retried draft to one row, and the collision it raises is the exact error `isIdempotentReplay` accepts.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isIdempotentReplay } from '../../frontend/src/services/issueReportService';

const MIG = resolve(process.cwd(), 'backend', 'supabase', 'migrations');
const MIGRATIONS = [
  '20260605080000_user_issue_reports.sql',
  '20260605120000_user_issue_reports_optional_user.sql',
  '20260607023000_grant_issue_report_insert.sql',
  '20260710000000_user_issue_reports_category_slugs.sql',
  '20260721130000_report_session_ownership_guard.sql',
  '20260903140000_feedback_kind_severity_contract.sql',
  '20260904150000_share_feedback_redesign.sql',
];
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const SESSION = '130bbc6c-5d89-465d-91e6-51f5a5951e34';
const KEY = '22222222-2222-4222-8222-222222222222';

/** The row the shipped dialog builds for "This worked well" on an Analytics session (shape captured from the dialog). */
const ROW = {
  user_id: USER, session_id: SESSION, category: 'analytics_sessions', severity: 'not_applicable',
  title: 'RWT automated journey check from a disposable account.', description: 'RWT automated journey check from a disposable account. Please ignore.',
  page_url: '/analytics/id', metadata: { feedback_type: 'praise', feedback_kind: 'comment', feedback_severity: null },
  include_audio: false, audio_attachment_note: null, idempotency_key: KEY,
};
const COLS = Object.keys(ROW);
let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES ('${USER}'), ('${OTHER}');
    CREATE TABLE public.sessions (id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users(id));
    INSERT INTO public.sessions VALUES ('${SESSION}', '${USER}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'authenticated'::text $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated;
  `);
  for (const file of MIGRATIONS) await db.exec(readFileSync(resolve(MIG, file), 'utf8'));
});

/** One statement as `authenticated` with the JWT subject set, exactly as PostgREST runs a request. */
async function asUser(sub: string, sql: string, row: Record<string, unknown> = ROW) {
  return db.transaction(async (tx) => {
    await tx.exec('SET LOCAL ROLE authenticated');
    await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [sub]);
    return tx.query(sql, [JSON.stringify(row)]);
  });
}
const values = `SELECT ${COLS.join(', ')} FROM json_populate_record(NULL::public.user_issue_reports, $1::json)`;
const PLAIN = `INSERT INTO public.user_issue_reports (${COLS.join(', ')}) ${values}`;
const ON_CONFLICT = `${PLAIN} ON CONFLICT (idempotency_key) DO NOTHING`;
const failure = async (p: Promise<unknown>) => p.then(() => null, (e: { code?: string; message?: string; detail?: string }) => e);
const stored = async () => (await db.query<{ n: number; linked: number }>(
  `SELECT count(*)::int AS n, count(session_id)::int AS linked FROM public.user_issue_reports`)).rows[0];

describe('#1258 Share Feedback write under the real grants and RLS', () => {
  it('CASUALTY: the previous ON CONFLICT write is refused with 42501 under INSERT-only privileges, and stores nothing', async () => {
    const e = await failure(asUser(USER, ON_CONFLICT));
    expect(e?.code).toBe('42501');
    expect((await stored()).n).toBe(0);
  });

  it('the plain insert stores the report once, linked to the session the sender owns', async () => {
    expect(await failure(asUser(USER, PLAIN))).toBeNull();
    expect(await stored()).toEqual({ n: 1, linked: 1 });
  });

  it('a duplicate delivery of the same draft stores ONE row, and its error is exactly what isIdempotentReplay accepts', async () => {
    await asUser(USER, PLAIN);
    const e = await failure(asUser(USER, PLAIN));
    expect(e?.code).toBe('23505');
    expect(e?.message).toContain('"user_issue_reports_idempotency_key_unique"');
    // Postgres OMITS the key values from DETAIL when the role cannot SELECT those columns, and `authenticated` cannot:
    // under the real grants the constraint name is the verifiable signal. A collision on that index is necessarily
    // with the key just sent, so it is this draft. PostgREST passes `message`/`detail` through as `message`/`details`.
    expect(e?.detail ?? '').not.toContain(KEY);
    expect(isIdempotentReplay({ code: e?.code, message: e?.message, details: e?.detail ?? '' }, KEY)).toBe(true);
    expect((await stored()).n).toBe(1);
  });

  it('an unrelated constraint violation is NOT a replay', async () => {
    const e = await failure(asUser(USER, PLAIN, { ...ROW, title: 'x'.repeat(81) }));
    expect(e?.code).toBe('23514');
    expect(isIdempotentReplay({ code: e?.code, message: e?.message, details: e?.detail }, KEY)).toBe(false);
    expect((await stored()).n).toBe(0);
  });

  it('ownership holds: another account cannot store a report as this user (RLS), and a foreign session link is dropped', async () => {
    expect((await failure(asUser(OTHER, PLAIN)))?.code).toBe('42501');
    expect(await failure(asUser(OTHER, PLAIN, { ...ROW, user_id: OTHER }))).toBeNull();
    expect(await stored()).toEqual({ n: 1, linked: 0 });
  });
});
