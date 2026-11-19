// Native, owned disposable PostgreSQL. No hosted database, provider or model calls.
// The exact 20261112133000 pre/postflight (scripts/start-abandonment-migration-postflight.mjs) against the actual
// completion-journal predecessor and the actual candidate, with negative controls for every refusal it promises.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { accessSync, constants, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import process from 'node:process';
import { completionBootstrap } from './account-completion-fixture.mjs';

const journal = 'backend/supabase/migrations/20261020230653_account_pending_completion_journal_1643.sql';
const candidate = 'backend/supabase/migrations/20261112133000_recording_start_abandonment_1643.sql';
const cli = resolve('scripts/start-abandonment-migration-postflight.mjs');

test('start-abandonment exact postflight: before/after on the real chain, and every refusal', async t => {
  const names = ['initdb', 'pg_ctl', 'psql'];
  let bin;
  for (const directory of [...(process.env.PATH ?? '').split(delimiter), '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/18/bin']) {
    if (!isAbsolute(directory)) continue;
    try {
      bin = Object.fromEntries(names.map(name => {
        const file = realpathSync(join(directory, name)); accessSync(file, constants.X_OK); return [name, file];
      }));
      break;
    } catch { /* Only a complete installed toolchain is eligible. */ }
  }
  assert.ok(bin, 'NOT RUN: installed local PostgreSQL initdb/pg_ctl/psql toolchain unavailable');
  const root = mkdtempSync(join(tmpdir(), 'start-abandonment-postflight-'));
  // A Unix socket path is capped at 103 bytes; macOS's per-user temp root alone can approach that, so only the socket
  // moves to a short private directory there (removed below). Linux CI keeps it under the fixture root.
  const data = join(root, 'data');
  const socket = join(root, 'socket', '.s.PGSQL.5432').length > 100 ? mkdtempSync('/tmp/sap-') : join(root, 'socket');
  if (socket === join(root, 'socket')) mkdirSync(socket);
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('PG') && k !== 'DB_URL')),
    PATH: `${resolve(bin.psql, '..')}${delimiter}${process.env.PATH ?? ''}`,
    PGHOST: socket, PGPORT: '5432', PGUSER: 'postflight_fixture_admin', PGDATABASE: 'postgres',
    // macOS postmaster refuses to start multithreaded under an unset/invalid locale; harmless on Linux.
    LC_ALL: 'C' };
  const args = ['-h', socket, '-p', '5432', '-U', env.PGUSER, '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
  const sql = text => (text.length > 64_000
    ? execFileSync(bin.psql, [...args, '-1', '-f', '-'], { env, encoding: 'utf8', timeout: 60000, input: text, stdio: ['pipe', 'pipe', 'pipe'] })
    : execFileSync(bin.psql, [...args, '-c', text], { env, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] })).trim();
  let receiptIndex = 0;
  const run = (mode, receipt) => spawnSync(process.execPath, [cli, mode, '20261112133000', receipt], { env, encoding: 'utf8', timeout: 60000 });
  const freshReceipt = () => join(root, `receipt-${++receiptIndex}.json`);
  const ok = result => { assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout.trim().split('\n').at(-1)); };
  const refused = (result, pattern) => { assert.notEqual(result.status, 0); assert.match(result.stderr, pattern); };
  let started = false;
  try {
    execFileSync(bin.initdb, ['-D', data, '-U', env.PGUSER, '-A', 'trust', '--no-locale', '--encoding=UTF8'], { env, encoding: 'utf8' });
    execFileSync(bin.pg_ctl, ['-D', data, '-l', join(root, 'postgres.log'), '-w', 'start', '-o',
      `-F -k ${socket} -h '' -p 5432 -c max_connections=12 -c shared_buffers=16MB`], { env, encoding: 'utf8' });
    started = true;
    sql(completionBootstrap());
    sql(readFileSync(journal, 'utf8'));
    sql(`CREATE SCHEMA IF NOT EXISTS supabase_migrations;
      CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY);
      INSERT INTO supabase_migrations.schema_migrations VALUES ('20261020230653'),('20261110173548') ON CONFLICT DO NOTHING;`);

    let before;
    await t.test('before: predecessor bodies exact, target absent, prerequisite applied, withheld pending', () => {
      before = freshReceipt();
      assert.deepEqual(ok(run('before', before)), { mode: 'before', version: '20261112133000', obligations: 'exact', target: 'absent',
        scope: 'exact installed catalog only; no activation or customer-flow proof' });
    });

    await t.test('before refuses a missing prerequisite and an applied withheld migration', () => {
      sql(`DELETE FROM supabase_migrations.schema_migrations WHERE version='20261110173548'`);
      refused(run('before', freshReceipt()), /prerequisite not applied: 20261110173548/);
      sql(`INSERT INTO supabase_migrations.schema_migrations VALUES ('20261110173548')`);
      for (const withheld of ['20261027192550', '20261112130000']) {
        sql(`INSERT INTO supabase_migrations.schema_migrations VALUES ('${withheld}')`);
        refused(run('before', freshReceipt()), new RegExp(`withheld migration applied: ${withheld}`));
        sql(`DELETE FROM supabase_migrations.schema_migrations WHERE version='${withheld}'`);
      }
    });

    await t.test('after refuses before the apply (ledger and objects disagree with the phase)', () => {
      refused(run('after', before), /ledger does not match the phase/);
    });

    sql(readFileSync(candidate, 'utf8'));
    sql(`INSERT INTO supabase_migrations.schema_migrations VALUES ('20261112133000')`);

    await t.test('before refuses once the target is installed', () => {
      refused(run('before', freshReceipt()), /ledger does not match the phase/);
    });

    await t.test('after: exact target catalog, authenticated-only EXECUTE, closed RLS table, unchanged trigger bindings', () => {
      assert.deepEqual(ok(run('after', before)), { mode: 'after', version: '20261112133000', obligations: 'exact', target: 'exact',
        scope: 'exact installed catalog only; no activation or customer-flow proof' });
    });

    await t.test('after refuses a widened function ACL and a widened table grant', () => {
      sql(`GRANT EXECUTE ON FUNCTION public.abandon_recording_start_v1(uuid) TO anon`);
      refused(run('after', before), /function ACL differs/);
      sql(`REVOKE EXECUTE ON FUNCTION public.abandon_recording_start_v1(uuid) FROM anon`);
      sql(`GRANT SELECT ON public.recording_start_abandonments TO authenticated`);
      refused(run('after', before), /table shape differs/);
      sql(`REVOKE SELECT ON public.recording_start_abandonments FROM authenticated`);
      ok(run('after', before));
    });

    await t.test('after refuses a missing or mismatched prior receipt', () => {
      refused(run('after', join(root, 'absent.json')), /could not execute/);
    });

    await t.test('after refuses a body that differs from the reviewed source (applied last; not restored)', () => {
      sql(`CREATE OR REPLACE FUNCTION public.abandon_recording_start_v1(p_lease_id uuid) RETURNS jsonb LANGUAGE plpgsql
        SECURITY DEFINER SET search_path = '' AS $$ BEGIN RETURN '{}'::jsonb; END $$`);
      refused(run('after', before), /abandon_recording_start_v1\(uuid\) shape differs from source/);
    });
  } finally {
    if (started) try { execFileSync(bin.pg_ctl, ['-D', data, '-m', 'fast', '-w', 'stop'], { env, encoding: 'utf8' }); } catch { /* best effort */ }
    rmSync(root, { recursive: true, force: true });
    if (socket !== join(root, 'socket')) rmSync(socket, { recursive: true, force: true });
  }
});
