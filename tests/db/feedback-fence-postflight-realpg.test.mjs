// Native, owned disposable PostgreSQL. No hosted database, provider or model calls.
// #1811: the SELECT-only exact pre/postflight for the feedback fence (20261114100000), driven through its real CLI over the
// real user_issue_reports migration chain and the exact fence bytes. Negative controls: prerequisite, withheld, phase, RPC and
// trigger-function ACLs, table grant, disabled write trigger, a moved report trigger, receipt and body tamper.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { accessSync, constants, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import process from 'node:process';

const CHAIN = [
  '20260605080000_user_issue_reports.sql',
  '20260605120000_user_issue_reports_optional_user.sql',
  '20260607023000_grant_issue_report_insert.sql',
  '20260710000000_user_issue_reports_category_slugs.sql',
  '20260721130000_report_session_ownership_guard.sql',
  '20260903140000_feedback_kind_severity_contract.sql',
  '20260904150000_share_feedback_redesign.sql',
].map((name) => resolve('backend/supabase/migrations', name));
const FENCE = resolve('backend/supabase/migrations/20261114100000_rwt_feedback_fence_1811.sql');
const cli = resolve('scripts/feedback-fence-migration-postflight.mjs');
const SCOPE = 'exact installed catalog only; no activation or customer-flow proof';

test('feedback fence exact pre/postflight over the real report chain', async (t) => {
  const names = ['initdb', 'pg_ctl', 'psql'];
  let bin;
  for (const directory of [...(process.env.PATH ?? '').split(delimiter), '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/18/bin']) {
    if (!isAbsolute(directory)) continue;
    try {
      bin = Object.fromEntries(names.map((name) => {
        const file = realpathSync(join(directory, name)); accessSync(file, constants.X_OK); return [name, file];
      }));
      break;
    } catch { /* Only a complete installed toolchain is eligible. */ }
  }
  assert.ok(bin, 'NOT RUN: installed local PostgreSQL initdb/pg_ctl/psql toolchain unavailable');
  const root = mkdtempSync(join(tmpdir(), 'feedback-fence-postflight-'));
  const data = join(root, 'data');
  const socket = join(root, 'socket', '.s.PGSQL.5432').length > 100 ? mkdtempSync('/tmp/ffp-') : join(root, 'socket');
  if (socket === join(root, 'socket')) mkdirSync(socket);
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('PG') && k !== 'DB_URL')),
    PATH: `${resolve(bin.psql, '..')}${delimiter}${process.env.PATH ?? ''}`,
    PGHOST: socket, PGPORT: '5432', PGUSER: 'postflight_fixture_admin', PGDATABASE: 'postgres', LC_ALL: 'C' };
  const args = ['-h', socket, '-p', '5432', '-U', env.PGUSER, '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
  const sql = (text) => execFileSync(bin.psql, [...args, '-1', '-f', '-'], { env, encoding: 'utf8', timeout: 60000, input: text, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  let receiptIndex = 0;
  const run = (mode, receipt) => spawnSync(process.execPath, [cli, mode, '20261114100000', receipt], { env, encoding: 'utf8', timeout: 60000 });
  const freshReceipt = () => join(root, `receipt-${++receiptIndex}.json`);
  const ok = (result) => { assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout.trim().split('\n').at(-1)); };
  const refused = (result, pattern) => { assert.notEqual(result.status, 0); assert.match(result.stderr, pattern); };
  let started = false;
  try {
    execFileSync(bin.initdb, ['-D', data, '-U', env.PGUSER, '-A', 'trust', '--no-locale', '--encoding=UTF8'], { env, encoding: 'utf8' });
    execFileSync(bin.pg_ctl, ['-D', data, '-l', join(root, 'postgres.log'), '-w', 'start', '-o',
      `-F -k ${socket} -h '' -p 5432 -c max_connections=12 -c shared_buffers=16MB`], { env, encoding: 'utf8' });
    started = true;
    sql(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
      CREATE TABLE auth.users(id uuid PRIMARY KEY, raw_app_meta_data jsonb NOT NULL DEFAULT '{}');
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      CREATE TABLE public.sessions(id uuid PRIMARY KEY, user_id uuid);
      CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY);
      INSERT INTO supabase_migrations.schema_migrations VALUES ('20261110173548'),('20261112133000');`);
    for (const file of CHAIN) sql(readFileSync(file, 'utf8'));

    let before;
    await t.test('before: target absent, prerequisite applied, withheld pending; records the report triggers', () => {
      before = freshReceipt();
      assert.deepEqual(ok(run('before', before)), { mode: 'before', version: '20261114100000', target: 'absent', scope: SCOPE });
      const receipt = JSON.parse(readFileSync(before, 'utf8'));
      assert.ok(JSON.parse(receipt.rows[3]).length >= 1, 'the predecessor report triggers are recorded');
    });

    await t.test('before refuses a missing prerequisite and an applied withheld migration', () => {
      sql(`DELETE FROM supabase_migrations.schema_migrations WHERE version='20261112133000'`);
      refused(run('before', freshReceipt()), /prerequisite not applied: 20261112133000/);
      sql(`INSERT INTO supabase_migrations.schema_migrations VALUES ('20261112133000')`);
      for (const withheld of ['20261027192550', '20261112130000']) {
        sql(`INSERT INTO supabase_migrations.schema_migrations VALUES ('${withheld}')`);
        refused(run('before', freshReceipt()), new RegExp(`withheld migration applied: ${withheld}`));
        sql(`DELETE FROM supabase_migrations.schema_migrations WHERE version='${withheld}'`);
      }
    });

    await t.test('after refuses before the apply', () => {
      refused(run('after', before), /ledger does not match the phase/);
    });

    sql(readFileSync(FENCE, 'utf8'));
    sql(`INSERT INTO supabase_migrations.schema_migrations VALUES ('20261114100000')`);

    await t.test('before refuses once the target is installed', () => {
      refused(run('before', freshReceipt()), /ledger does not match the phase/);
    });

    await t.test('after: exact functions, service-role-only RPCs, closed table, BEFORE INSERT trigger, other triggers unchanged', () => {
      assert.deepEqual(ok(run('after', before)), { mode: 'after', version: '20261114100000', target: 'exact', scope: SCOPE });
    });

    await t.test('after refuses widened ACLs and a table grant', () => {
      for (const [grant, revoke, pattern] of [
        ['GRANT EXECUTE ON FUNCTION public.open_rwt_feedback_fence_v1(uuid,jsonb,text,integer) TO authenticated',
          'REVOKE EXECUTE ON FUNCTION public.open_rwt_feedback_fence_v1(uuid,jsonb,text,integer) FROM authenticated', /RPC ACL differs/],
        ['GRANT EXECUTE ON FUNCTION public.clean_rwt_feedback_fence_v1(text) TO PUBLIC',
          'REVOKE EXECUTE ON FUNCTION public.clean_rwt_feedback_fence_v1(text) FROM PUBLIC', /RPC ACL differs/],
        ['REVOKE EXECUTE ON FUNCTION public.close_rwt_feedback_fence_v1(text) FROM service_role',
          'GRANT EXECUTE ON FUNCTION public.close_rwt_feedback_fence_v1(text) TO service_role', /RPC ACL differs/],
        ['GRANT EXECUTE ON FUNCTION public.verify_rwt_feedback_fence_v1(text) TO anon',
          'REVOKE EXECUTE ON FUNCTION public.verify_rwt_feedback_fence_v1(text) FROM anon', /RPC ACL differs/],
        ['GRANT EXECUTE ON FUNCTION public._rwt_feedback_fence_v1() TO authenticated',
          'REVOKE EXECUTE ON FUNCTION public._rwt_feedback_fence_v1() FROM authenticated', /trigger function ACL differs/],
        ['GRANT SELECT ON public.rwt_feedback_fences TO authenticated',
          'REVOKE SELECT ON public.rwt_feedback_fences FROM authenticated', /table shape differs/],
        ['ALTER TABLE public.rwt_feedback_fences DISABLE ROW LEVEL SECURITY',
          'ALTER TABLE public.rwt_feedback_fences ENABLE ROW LEVEL SECURITY', /table shape differs/],
      ]) {
        sql(grant);
        refused(run('after', before), pattern);
        sql(revoke);
      }
      ok(run('after', before));
    });

    await t.test('after refuses a disabled write trigger, and a moved report trigger', () => {
      sql('ALTER TABLE public.user_issue_reports DISABLE TRIGGER zz_rwt_feedback_fence');
      refused(run('after', before), /write trigger differs/);
      sql('ALTER TABLE public.user_issue_reports ENABLE TRIGGER zz_rwt_feedback_fence');
      const other = JSON.parse(JSON.parse(readFileSync(before, 'utf8')).rows[3])[0].name;
      sql(`ALTER TABLE public.user_issue_reports DISABLE TRIGGER ${other}`);
      refused(run('after', before), /changed another report trigger/);
      sql(`ALTER TABLE public.user_issue_reports ENABLE TRIGGER ${other}`);
      ok(run('after', before));
    });

    await t.test('after refuses a missing prior receipt', () => {
      refused(run('after', join(root, 'absent.json')), /could not execute/);
    });

    await t.test('after refuses a trigger function body that differs from the reviewed source (applied last; not restored)', () => {
      sql(`CREATE OR REPLACE FUNCTION public._rwt_feedback_fence_v1() RETURNS trigger LANGUAGE plpgsql
        SECURITY DEFINER SET search_path = '' AS $$ BEGIN RETURN NEW; END $$`);
      refused(run('after', before), /_rwt_feedback_fence_v1\(\) shape differs from source/);
    });
  } finally {
    if (started) try { execFileSync(bin.pg_ctl, ['-D', data, '-m', 'fast', '-w', 'stop'], { env, encoding: 'utf8' }); } catch { /* best effort */ }
    rmSync(root, { recursive: true, force: true });
    if (socket !== join(root, 'socket')) rmSync(socket, { recursive: true, force: true });
  }
});
