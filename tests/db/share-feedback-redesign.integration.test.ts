// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS = resolve(process.cwd(), 'backend', 'supabase', 'migrations');
const read = (file: string) => readFileSync(resolve(MIGRATIONS, file), 'utf8');
const USER = '11111111-1111-4111-8111-111111111111';
const KEY = '22222222-2222-4222-8222-222222222222';
let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES ('${USER}');
    CREATE TABLE public.sessions (id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users(id));
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT '${USER}'::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE
      AS $$ SELECT 'authenticated'::text $$;
  `);
  await db.exec(read('20260605080000_user_issue_reports.sql'));
  await db.exec(read('20260710000000_user_issue_reports_category_slugs.sql'));
  await db.exec(read('20260903140000_feedback_kind_severity_contract.sql'));
  await db.exec(read('20260904150000_share_feedback_redesign.sql'));
});

const insert = (args: { id: string; title?: string; body?: string; severity?: string; metadata: unknown; key?: string | null }) =>
  db.query(
    `INSERT INTO public.user_issue_reports
      (id, user_id, category, severity, title, description, page_url, metadata, idempotency_key)
     VALUES ($1,$2,'something_else',$3,$4,$5,'/practice',$6,$7)`,
    [args.id, USER, args.severity ?? 'not_applicable', args.title ?? 'x', args.body ?? 'x', JSON.stringify(args.metadata), args.key ?? null],
  );

describe('#1404 Share feedback storage contract', () => {
  it('accepts the two-field minimum and a non-defect type', async () => {
    await expect(insert({
      id: '33333333-3333-4333-8333-333333333333',
      metadata: { feedback_kind: 'comment', feedback_type: 'idea', feedback_severity: null },
    })).resolves.toBeDefined();
  });

  it('accepts an optional plain-language severity only for Something broke', async () => {
    await expect(insert({
      id: '44444444-4444-4444-8444-444444444444',
      severity: 'medium',
      metadata: { feedback_kind: 'issue', feedback_type: 'broke', feedback_severity: 'slowed' },
    })).resolves.toBeDefined();
  });

  it('allows Something broke without forcing the optional severity answer', async () => {
    await expect(insert({
      id: '55555555-5555-4555-8555-555555555555',
      metadata: { feedback_kind: 'issue', feedback_type: 'broke', feedback_severity: null },
    })).resolves.toBeDefined();
  });

  it('rejects a ranked defect severity on praise', async () => {
    await expect(insert({
      id: '66666666-6666-4666-8666-666666666666',
      severity: 'high',
      metadata: { feedback_kind: 'comment', feedback_type: 'praise', feedback_severity: null },
    })).rejects.toThrow();
  });

  it('deduplicates repeated delivery by the per-draft key', async () => {
    await insert({
      id: '77777777-7777-4777-8777-777777777777',
      key: KEY,
      metadata: { feedback_kind: 'comment', feedback_type: 'confused', feedback_severity: null },
    });
    await expect(insert({
      id: '88888888-8888-4888-8888-888888888888',
      key: KEY,
      metadata: { feedback_kind: 'comment', feedback_type: 'confused', feedback_severity: null },
    })).rejects.toThrow();
  });
});
