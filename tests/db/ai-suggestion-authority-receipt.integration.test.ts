// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const MIGRATION = readFileSync(resolve(
  process.cwd(),
  'backend/supabase/migrations/20260910193000_ai_suggestion_authority_receipt.sql',
), 'utf8');
const USER = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const OTHER_USER = '33333333-3333-4333-8333-333333333333';
const SUGGESTIONS = JSON.stringify({
  version: 'gemini_coaching_v1',
  what_worked: 'The opening was concrete.',
  what_to_try_next: 'Pause before the close.',
});

let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE public.user_profiles (id uuid PRIMARY KEY);
    CREATE TABLE public.sessions (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES public.user_profiles(id),
      ai_suggestions jsonb
    );
    CREATE TABLE public.ai_suggestion_usage_daily (
      user_id uuid NOT NULL REFERENCES public.user_profiles(id),
      usage_date date NOT NULL,
      request_count integer NOT NULL,
      PRIMARY KEY (user_id, usage_date)
    );
    INSERT INTO public.user_profiles (id) VALUES ('${USER}'), ('${OTHER_USER}');
    INSERT INTO public.sessions (id, user_id) VALUES ('${SESSION}', '${USER}');
    INSERT INTO public.ai_suggestion_usage_daily (user_id, usage_date, request_count)
      VALUES ('${USER}', '2026-09-10', 1), ('${OTHER_USER}', '2026-09-10', 1);
    GRANT SELECT, UPDATE ON public.sessions TO service_role;
    GRANT SELECT ON public.user_profiles TO service_role;
    GRANT SELECT ON public.ai_suggestion_usage_daily TO service_role;
  `);
  await db.exec(MIGRATION);
});

describe('#1432 server-owned Gemini authority receipt (real PostgreSQL)', () => {
  it('atomically saves coaching with provider and quota authority, then records cache reuse', async () => {
    const saved = await db.query<{ value: unknown }>(`
      SELECT public.persist_ai_suggestion_with_authority_v1(
        '${SESSION}', '${USER}', $1::jsonb, 'google_gemini', 'gemini-3.6-flash',
        'user_utc_day', '2026-09-10', 10, 1
      ) AS value
    `, [SUGGESTIONS]);
    expect(saved.rows[0].value).toEqual(JSON.parse(SUGGESTIONS));

    const receipt = await db.query<{
      provider: string; model: string; quota_limit: number;
      quota_request_number: number; cache_read_count: number;
    }>('SELECT provider, model, quota_limit, quota_request_number, cache_read_count FROM public.ai_suggestion_authority_receipts');
    expect(receipt.rows).toEqual([{
      provider: 'google_gemini', model: 'gemini-3.6-flash', quota_limit: 10,
      quota_request_number: 1, cache_read_count: 0,
    }]);

    const cached = await db.query<{ recorded: boolean }>(`
      SELECT public.record_ai_suggestion_cache_read_v1('${SESSION}', '${USER}') AS recorded
    `);
    expect(cached.rows[0].recorded).toBe(true);
    const count = await db.query<{ cache_read_count: number }>(
      'SELECT cache_read_count FROM public.ai_suggestion_authority_receipts',
    );
    expect(count.rows[0].cache_read_count).toBe(1);
  });

  it('rolls back both records when the session identity is not owned', async () => {
    await expect(db.query(`
      SELECT public.persist_ai_suggestion_with_authority_v1(
        '${SESSION}', '${OTHER_USER}', $1::jsonb,
        'google_gemini', 'gemini-3.6-flash', 'user_utc_day', '2026-09-10', 10, 1
      )
    `, [SUGGESTIONS])).rejects.toThrow(/session is missing or unowned/);
    const receipts = await db.query<{ count: number }>(
      'SELECT count(*)::integer AS count FROM public.ai_suggestion_authority_receipts',
    );
    expect(receipts.rows[0].count).toBe(0);
    const session = await db.query<{ ai_suggestions: unknown }>(
      `SELECT ai_suggestions FROM public.sessions WHERE id = '${SESSION}'`,
    );
    expect(session.rows[0].ai_suggestions).toBeNull();
  });

  it('refuses a receipt whose quota ordinal is not present in the server ledger', async () => {
    await expect(db.query(`
      SELECT public.persist_ai_suggestion_with_authority_v1(
        '${SESSION}', '${USER}', $1::jsonb, 'google_gemini', 'gemini-3.6-flash',
        'user_utc_day', '2026-09-10', 10, 2
      )
    `, [SUGGESTIONS])).rejects.toThrow(/not backed by the usage ledger/);
    const session = await db.query<{ ai_suggestions: unknown }>(
      `SELECT ai_suggestions FROM public.sessions WHERE id = '${SESSION}'`,
    );
    expect(session.rows[0].ai_suggestions).toBeNull();
  });

  it('does not grant browser roles access to the authority table or RPCs', async () => {
    const grants = await db.query<{ role_name: string; table_read: boolean; rpc_run: boolean }>(`
      SELECT role_name,
             has_table_privilege(role_name, 'public.ai_suggestion_authority_receipts', 'SELECT') AS table_read,
             has_function_privilege(
               role_name,
               'public.persist_ai_suggestion_with_authority_v1(uuid,uuid,jsonb,text,text,text,date,integer,integer)',
               'EXECUTE'
             ) AS rpc_run
        FROM (VALUES ('anon'), ('authenticated')) AS roles(role_name)
       ORDER BY role_name
    `);
    expect(grants.rows).toEqual([
      { role_name: 'anon', table_read: false, rpc_run: false },
      { role_name: 'authenticated', table_read: false, rpc_run: false },
    ]);
  });
});
