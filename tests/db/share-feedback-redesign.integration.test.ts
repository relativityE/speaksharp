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

/**
 * #1416 P1 — the migration must survive a POPULATED table.
 *
 * The original schema allowed `title` 4..160; the redesign narrows it to 1..80. `ADD CONSTRAINT`
 * validates the whole table by default, so a report already stored with an 81..160-character title —
 * which the previous UI accepted — aborts the apply on Production. It cannot fail on an empty test
 * database, which is exactly why every check before the apply would have passed.
 *
 * This bootstraps the ORIGINAL schema, seeds a legacy row the old rules allowed, and then applies
 * the exact migration file that will run in production.
 */
describe('#1416 applying the migration to a populated legacy table', () => {
  const LEGACY = '99999999-9999-4999-8999-999999999999';
  let legacyDb: PGlite;
  const legacyTitle = 'L'.repeat(120); // legal under 4..160, illegal under 1..80

  beforeEach(async () => {
    legacyDb = new PGlite();
    await legacyDb.exec(`
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (id uuid PRIMARY KEY);
      INSERT INTO auth.users VALUES ('${USER}');
      CREATE TABLE public.sessions (id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users(id));
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '${USER}'::uuid $$;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'authenticated'::text $$;
    `);
    await legacyDb.exec(read('20260605080000_user_issue_reports.sql'));
    await legacyDb.exec(read('20260710000000_user_issue_reports_category_slugs.sql'));
    await legacyDb.exec(read('20260903140000_feedback_kind_severity_contract.sql'));
    // The legacy row, written under the rules in force at the time.
    await legacyDb.query(
      `INSERT INTO public.user_issue_reports
        (id, user_id, category, severity, title, description, page_url, metadata)
       VALUES ($1,$2,'something_else','medium',$3,$4,'/practice','{}'::jsonb)`,
      [LEGACY, USER, legacyTitle, 'A report written before the limit changed.'],
    );
  });

  it('applies without aborting, and does not touch the legacy content', async () => {
    await expect(legacyDb.exec(read('20260904150000_share_feedback_redesign.sql'))).resolves.toBeDefined();

    const rows = await legacyDb.query<{ title: string }>(
      'SELECT title FROM public.user_issue_reports WHERE id = $1', [LEGACY],
    );
    // Preserved verbatim. Truncating it to fit would destroy support content someone wrote, to meet
    // a limit that did not exist when they wrote it.
    expect(rows.rows[0].title).toBe(legacyTitle);
    expect(rows.rows[0].title.length).toBe(120);
  });

  it('still rejects a NEW title over the new limit', async () => {
    await legacyDb.exec(read('20260904150000_share_feedback_redesign.sql'));
    await expect(legacyDb.query(
      `INSERT INTO public.user_issue_reports
        (id, user_id, category, severity, title, description, page_url, metadata, idempotency_key)
       VALUES ($1,$2,'something_else','not_applicable',$3,'x','/practice',$4,NULL)`,
      ['12121212-1212-4212-8212-121212121212', USER, 'N'.repeat(81),
        JSON.stringify({ feedback_kind: 'comment', feedback_type: 'idea', feedback_severity: null })],
    )).rejects.toThrow();
  });

  it('leaves the narrowed limits explicitly NOT VALID, so no whole-table validation ran', async () => {
    await legacyDb.exec(read('20260904150000_share_feedback_redesign.sql'));
    const rows = await legacyDb.query<{ conname: string; convalidated: boolean }>(
      `SELECT conname, convalidated FROM pg_constraint
       WHERE conrelid = 'public.user_issue_reports'::regclass AND contype = 'c'
         AND conname IN ('user_issue_reports_title_length', 'user_issue_reports_description_length',
                         'user_issue_reports_severity_safe')`,
    );
    expect(rows.rows.length).toBe(3);
    for (const row of rows.rows) expect(row.convalidated).toBe(false);
  });
});

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
  // #1416 findings 7 and 8 — the pairing is one contract, and the database is where it holds.
  //
  // The application boundary derives feedback_type, feedback_kind and severity together, so any
  // other writer — a direct authenticated insert, a future client, a support tool — can produce a
  // record the product could never have made. Previously only `severity` was validated, so a
  // mismatched pair or a `broke` report routed as a comment was accepted and silently corrupted the
  // issue/comment routing this migration exists to preserve.
  const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;

  describe('#1416 exact severity pairs', () => {
    it.each([
      ['minor', 'low'],
      ['slowed', 'medium'],
      ['blocked', 'high'],
    ])('accepts the exact pair %s -> %s', async (feedback_severity, severity) => {
      await expect(insert({
        id: id(100 + severity.length),
        severity,
        metadata: { feedback_kind: 'issue', feedback_type: 'broke', feedback_severity },
      })).resolves.toBeDefined();
    });

    it.each([
      ['minor', 'high'],
      ['minor', 'medium'],
      ['slowed', 'low'],
      ['slowed', 'high'],
      ['blocked', 'low'],
      ['blocked', 'medium'],
    ])('rejects the mismatched pair %s -> %s', async (feedback_severity, severity) => {
      await expect(insert({
        id: id(200 + feedback_severity.length * 10 + severity.length),
        severity,
        metadata: { feedback_kind: 'issue', feedback_type: 'broke', feedback_severity },
      })).rejects.toThrow();
    });

    it('rejects an unrecognised plain-language severity rather than passing on a NULL comparison', async () => {
      await expect(insert({
        id: id(300),
        severity: 'high',
        metadata: { feedback_kind: 'issue', feedback_type: 'broke', feedback_severity: 'catastrophic' },
      })).rejects.toThrow();
    });

    it('rejects a broke report whose plain-language severity key is absent entirely', async () => {
      // An unsatisfiable CHECK expression evaluates to NULL, which Postgres ACCEPTS. Without the
      // explicit coalesce this row is stored with a ranked severity nobody chose.
      await expect(insert({
        id: id(301),
        severity: 'high',
        metadata: { feedback_kind: 'issue', feedback_type: 'broke' },
      })).rejects.toThrow();
    });
  });

  describe('#1416 exact type/kind pairs', () => {
    it.each(['confused', 'idea', 'praise'])('rejects %s stored as an issue', async (feedback_type) => {
      await expect(insert({
        id: id(400 + feedback_type.length),
        metadata: { feedback_kind: 'issue', feedback_type, feedback_severity: null },
      })).rejects.toThrow();
    });

    it('rejects a broke report stored as a comment', async () => {
      await expect(insert({
        id: id(500),
        metadata: { feedback_kind: 'comment', feedback_type: 'broke', feedback_severity: null },
      })).rejects.toThrow();
    });

    it('rejects the contradictory record the finding names exactly', async () => {
      await expect(insert({
        id: id(501),
        metadata: { feedback_type: 'praise', feedback_kind: 'issue', feedback_severity: null },
      })).rejects.toThrow();
    });

    it('rejects a claimed type outside the four the product offers', async () => {
      await expect(insert({
        id: id(502),
        metadata: { feedback_kind: 'comment', feedback_type: 'rant', feedback_severity: null },
      })).rejects.toThrow();
    });

    it('rejects a typed record with no kind at all', async () => {
      await expect(insert({
        id: id(503),
        metadata: { feedback_type: 'idea', feedback_severity: null },
      })).rejects.toThrow();
    });

    it('still accepts a pre-redesign record that carries no feedback_type', async () => {
      // Adding the constraint validates the existing table. Legacy rows must keep their original
      // rule or the migration fails on apply against real data.
      await expect(insert({
        id: id(600),
        severity: 'medium',
        metadata: { feedback_kind: 'issue' },
      })).resolves.toBeDefined();
    });
  });
});
