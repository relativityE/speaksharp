// Native, owned disposable PostgreSQL. No hosted database, provider or model calls.
// #1811 AHT-02/07/08: the transactional run fence on user_issue_reports (20261114100000), over the real user_issue_reports
// migration chain. Proves: run-owned open only; committed report ⇔ recorded id; key cap / unkeyed / closed refusals; close waits
// for an in-flight insert then refuses later ones; clean deletes exactly the recorded ids (owned or ownerless), never another
// account's, and reads back to zero; real users untouched; no API access to the table or the RPCs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
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

const OWNER = '11111111-1111-4111-8111-111111111111';
const REAL_USER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const RACER = '44444444-4444-4444-8444-444444444444';
const AHT02 = '55555555-5555-4555-8555-555555555555';
const COMBINED = '66666666-6666-4666-8666-666666666666';
const BINDING = { repository: 'relativityE/speaksharp', workflow: 'relativityE/speaksharp/.github/workflows/rc-gates.yml@refs/heads/main',
  runId: '43583228045', runAttempt: '1', role: 'rwt-journey' };
const key = (n) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const lit = (v) => `'${String(v).replaceAll("'", "''")}'`;

test('rwt feedback fence: open, record, cap, close-serializes, clean — on the real report chain', async () => {
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
  const root = mkdtempSync(join(tmpdir(), 'rwt-feedback-fence-'));
  const data = join(root, 'data');
  const socket = join(root, 'socket', '.s.PGSQL.5432').length > 100 ? mkdtempSync('/tmp/rff-') : join(root, 'socket');
  if (socket === join(root, 'socket')) mkdirSync(socket);
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('PG') && k !== 'DB_URL')),
    PATH: `${resolve(bin.psql, '..')}${delimiter}${process.env.PATH ?? ''}`, LC_ALL: 'C' };
  const args = ['-h', socket, '-p', '5432', '-U', 'fence_admin', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
  const sql = (text) => execFileSync(bin.psql, [...args, '-1', '-f', '-'], { env, encoding: 'utf8', timeout: 30000, input: text, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const fails = (text, pattern) => {
    let error = null;
    try { sql(text); } catch (e) { error = e; }
    assert.ok(error, `expected refusal: ${text.slice(0, 120)}`);
    assert.match(String(error.stderr), pattern);
  };
  const as = (uid, body) => `SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', ${lit(uid)}, true); ${body}`;
  const service = (body) => `SET LOCAL ROLE service_role; ${body}`;
  // A plain INSERT, exactly the app's shape (authenticated holds INSERT only; no ON CONFLICT).
  const report = (k, userId = 'auth.uid()') => `INSERT INTO public.user_issue_reports(user_id, category, severity, title, description, page_url, metadata, idempotency_key)
    VALUES (${userId}, 'something_else', 'medium', 'Fence check', 'Automated fence check description.', 'https://example.test/analytics', '{}', ${k === null ? 'NULL' : `${lit(k)}::uuid`});`;
  const fence = () => JSON.parse(sql(`SELECT row_to_json(f) FROM public.rwt_feedback_fences f WHERE owner_uid = ${lit(OWNER)}::uuid;`) || 'null');
  let started = false;
  try {
    execFileSync(bin.initdb, ['-D', data, '-U', 'fence_admin', '-A', 'trust', '--no-locale', '--encoding=UTF8'], { env, encoding: 'utf8' });
    execFileSync(bin.pg_ctl, ['-D', data, '-l', join(root, 'postgres.log'), '-w', 'start', '-o',
      `-F -k ${socket} -h '' -p 5432 -c max_connections=12 -c shared_buffers=16MB`], { env, encoding: 'utf8' });
    started = true;
    // Minimal Supabase surface the report chain needs; the chain itself is the real migration bytes.
    sql(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      GRANT anon, authenticated, service_role TO fence_admin;
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
      CREATE TABLE auth.users(id uuid PRIMARY KEY, raw_app_meta_data jsonb NOT NULL DEFAULT '{}');
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
      CREATE TABLE public.sessions(id uuid PRIMARY KEY, user_id uuid);
      INSERT INTO auth.users VALUES (${lit(OWNER)}, ${lit(JSON.stringify({ ct_run: BINDING }))}::jsonb),
        (${lit(REAL_USER)}, '{}'), (${lit(OTHER)}, '{}'), (${lit(RACER)}, ${lit(JSON.stringify({ ct_run: { ...BINDING, runId: '9' } }))}::jsonb),
        (${lit(AHT02)}, ${lit(JSON.stringify({ ct_run: { ...BINDING, runId: '11' } }))}::jsonb),
        (${lit(COMBINED)}, ${lit(JSON.stringify({ ct_run: { ...BINDING, runId: '13' } }))}::jsonb);`);
    for (const file of CHAIN) sql(readFileSync(file, 'utf8'));
    sql(`GRANT SELECT, DELETE ON public.user_issue_reports TO service_role;`);
    sql(readFileSync(FENCE, 'utf8'));

    // No API access to the table or the RPCs except service_role's EXECUTE.
    fails(as(OWNER, 'SELECT count(*) FROM public.rwt_feedback_fences;'), /permission denied/);
    fails(as(OWNER, `SELECT public.close_rwt_feedback_fence_v1('1-1-AHT-08');`), /permission denied/);
    fails(service('SELECT count(*) FROM public.rwt_feedback_fences;'), /permission denied/);

    // A real (unfenced) user is untouched: insert succeeds, nothing recorded anywhere.
    sql(as(REAL_USER, report(key(900))));

    // Open: only for the run-owned account with its exact binding.
    fails(service(`SELECT public.open_rwt_feedback_fence_v1(${lit(REAL_USER)}::uuid, ${lit(JSON.stringify(BINDING))}::jsonb, 'AHT-08', 1);`), /not run-owned/);
    fails(service(`SELECT public.open_rwt_feedback_fence_v1(${lit(OWNER)}::uuid, ${lit(JSON.stringify({ ...BINDING, runAttempt: '2' }))}::jsonb, 'AHT-08', 1);`), /not run-owned/);
    fails(service(`SELECT public.open_rwt_feedback_fence_v1(${lit(OWNER)}::uuid, ${lit(JSON.stringify({ ...BINDING, role: 'canary' }))}::jsonb, 'AHT-08', 1);`), /invalid binding/);
    const runKey = sql(service(`SELECT public.open_rwt_feedback_fence_v1(${lit(OWNER)}::uuid, ${lit(JSON.stringify(BINDING))}::jsonb, 'AHT-08', 3);`)).split('\n').at(-1);
    assert.equal(runKey, '43583228045-1-AHT-08');
    fails(service(`SELECT public.open_rwt_feedback_fence_v1(${lit(OWNER)}::uuid, ${lit(JSON.stringify(BINDING))}::jsonb, 'AHT-07', 2);`), /duplicate key|unique/);

    // Record: committed report ⇔ recorded id; an ownerless report from the fenced actor is still recorded.
    sql(as(OWNER, report(key(1))));
    sql(as(OWNER, report(key(2), 'NULL')));
    let f = fence();
    assert.equal(f.report_ids.length, 2);
    assert.deepEqual(f.report_keys, [key(1), key(2)]);
    // A same-key replay fails on the unique index and its record rolls back with it.
    fails(as(OWNER, report(key(1))), /duplicate key|unique/);
    assert.equal(fence().report_ids.length, 2);
    // Unkeyed refusal (the key cap is proved on the second fence below).
    fails(as(OWNER, report(null)), /unkeyed report/);
    assert.equal(fence().report_ids.length, 2);

    // Close serializes with an in-flight insert: a transaction that has inserted (and holds the fence row lock) but not committed
    // makes close wait; close then sees its committed id. A later insert is refused.
    const slow = spawn(bin.psql, [...args, '-c', `BEGIN; ${as(OWNER, `${report(key(3))} SELECT pg_sleep(2);`)} COMMIT;`], { env, stdio: 'ignore' });
    const slowDone = new Promise((done) => slow.on('exit', (code) => done(code)));
    await new Promise((r) => setTimeout(r, 600));
    const t0 = Date.now();
    const closed = JSON.parse(sql(service(`SELECT public.close_rwt_feedback_fence_v1(${lit(runKey)});`)).split('\n').at(-1));
    const waited = Date.now() - t0;
    assert.equal(await slowDone, 0);
    assert.ok(waited >= 900, `close must wait for the in-flight insert (waited ${waited} ms)`);
    assert.equal(closed.state, 'closed');
    assert.equal(closed.reports, 3, 'the in-flight insert committed before close and is recorded');
    fails(as(OWNER, report(key(1))), /fence is closed/);
    fails(as(OWNER, report(key(4), 'NULL')), /fence is closed/);
    // Close is idempotent.
    assert.equal(JSON.parse(sql(service(`SELECT public.close_rwt_feedback_fence_v1(${lit(runKey)});`)).split('\n').at(-1)).state, 'closed');

    // Clean: exactly the recorded ids that are the account's or ownerless; another account's recorded row is never deleted and
    // keeps the fence closed; the real user's report is untouched.
    f = fence();
    sql(`UPDATE public.user_issue_reports SET user_id = ${lit(OTHER)}::uuid WHERE id = ${lit(f.report_ids[0])}::uuid;`);
    let cleaned = JSON.parse(sql(service(`SELECT public.clean_rwt_feedback_fence_v1(${lit(runKey)});`)).split('\n').at(-1));
    assert.deepEqual(cleaned, { deleted: 2, residue: 1, foreign: 1, state: 'closed' });
    assert.equal(fence().state, 'closed');
    // Account deletion nulls user_id (ON DELETE SET NULL); the recorded id is still found and removed.
    sql(`UPDATE public.user_issue_reports SET user_id = NULL WHERE id = ${lit(f.report_ids[0])}::uuid;`);
    cleaned = JSON.parse(sql(service(`SELECT public.clean_rwt_feedback_fence_v1(${lit(runKey)});`)).split('\n').at(-1));
    assert.deepEqual(cleaned, { deleted: 1, residue: 0, foreign: 0, state: 'cleaned' });
    assert.equal(fence().state, 'cleaned');
    assert.equal(sql(`SELECT count(*) FROM public.user_issue_reports WHERE user_id = ${lit(REAL_USER)}::uuid;`), '1');

    // A second fence: the key cap (1) refuses a second distinct key; a same-key replay is not a new key; clean refuses an open fence.
    sql(`UPDATE auth.users SET raw_app_meta_data = ${lit(JSON.stringify({ ct_run: { ...BINDING, runId: '7' } }))}::jsonb WHERE id = ${lit(OTHER)}::uuid;`);
    const otherKey = sql(service(`SELECT public.open_rwt_feedback_fence_v1(${lit(OTHER)}::uuid, ${lit(JSON.stringify({ ...BINDING, runId: '7' }))}::jsonb, 'AHT-07', 1);`)).split('\n').at(-1);
    sql(as(OTHER, report(key(10))));
    fails(as(OTHER, report(key(11))), /key cap reached/);
    fails(service(`SELECT public.clean_rwt_feedback_fence_v1(${lit(otherKey)});`), /close before cleaning/);

    // AHT-02: the journey checks that feedback SURVIVES account deletion. A REAL auth.users delete (the FK's ON DELETE SET
    // NULL, not a simulated update) leaves the run's report ownerless; the fence still names it, and clean removes only it.
    const aht02Key = sql(service(`SELECT public.open_rwt_feedback_fence_v1(${lit(AHT02)}::uuid, ${lit(JSON.stringify({ ...BINDING, runId: '11' }))}::jsonb, 'AHT-02', 1);`)).split('\n').at(-1);
    assert.equal(aht02Key, '11-1-AHT-02');
    sql(as(AHT02, report(key(30))));
    sql(service(`SELECT public.close_rwt_feedback_fence_v1(${lit(aht02Key)});`));
    sql(`DELETE FROM auth.users WHERE id = ${lit(AHT02)}::uuid;`);
    const aht02Fence = JSON.parse(sql(`SELECT row_to_json(f) FROM public.rwt_feedback_fences f WHERE run_key = ${lit(aht02Key)};`));
    assert.equal(sql(`SELECT count(*) FROM public.user_issue_reports WHERE id = ${lit(aht02Fence.report_ids[0])}::uuid AND user_id IS NULL;`), '1');
    const realBefore = sql(`SELECT count(*) FROM public.user_issue_reports;`);
    assert.deepEqual(JSON.parse(sql(service(`SELECT public.clean_rwt_feedback_fence_v1(${lit(aht02Key)});`)).split('\n').at(-1)),
      { deleted: 1, residue: 0, foreign: 0, state: 'cleaned' });
    assert.equal(sql(`SELECT count(*) FROM public.user_issue_reports;`), String(Number(realBefore) - 1)); // exactly that one row

    // A consolidated journey (one account running several cases) holds ONE fence, labelled with its cases in order.
    fails(service(`SELECT public.open_rwt_feedback_fence_v1(${lit(COMBINED)}::uuid, ${lit(JSON.stringify({ ...BINDING, runId: '13' }))}::jsonb, 'AHT-03', 1);`), /check constraint/);
    fails(service(`SELECT public.open_rwt_feedback_fence_v1(${lit(COMBINED)}::uuid, ${lit(JSON.stringify({ ...BINDING, runId: '13' }))}::jsonb, 'AHT-08+AHT-07', 1);`), /check constraint/);
    fails(service(`SELECT public.open_rwt_feedback_fence_v1(${lit(COMBINED)}::uuid, ${lit(JSON.stringify({ ...BINDING, runId: '13' }))}::jsonb, 'AHT-07+AHT-07', 1);`), /check constraint/);
    assert.equal(sql(service(`SELECT public.open_rwt_feedback_fence_v1(${lit(COMBINED)}::uuid, ${lit(JSON.stringify({ ...BINDING, runId: '13' }))}::jsonb, 'AHT-07+AHT-08', 2);`)).split('\n').at(-1),
      '13-1-AHT-07+AHT-08');

    // The check-then-close race, staged deterministically: a holder takes the fence row lock; close queues behind it FIRST,
    // then an insert queues behind close. Because the trigger reads the fence FOR UPDATE, the insert re-reads the row after
    // close commits and is refused. (Without that lock the insert would read the stale 'open' and record a write after
    // close — the mutant this assertion kills.)
    const raceKey = sql(service(`SELECT public.open_rwt_feedback_fence_v1(${lit(RACER)}::uuid, ${lit(JSON.stringify({ ...BINDING, runId: '9' }))}::jsonb, 'AHT-08', 2);`)).split('\n').at(-1);
    const run = (text) => new Promise((done) => {
      const child = spawn(bin.psql, [...args, '-c', text], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let err = ''; child.stderr.on('data', (d) => { err += d; });
      child.on('exit', (code) => done({ code, err }));
    });
    const holder = run(`BEGIN; SELECT 1 FROM public.rwt_feedback_fences WHERE run_key = ${lit(raceKey)} FOR UPDATE; SELECT pg_sleep(1.5); COMMIT;`);
    await new Promise((r) => setTimeout(r, 300));
    const closer = run(`BEGIN; ${service(`SELECT public.close_rwt_feedback_fence_v1(${lit(raceKey)});`)} COMMIT;`);
    await new Promise((r) => setTimeout(r, 300));
    const writer = run(`BEGIN; ${as(RACER, report(key(20)))} COMMIT;`);
    const [h, c, w] = await Promise.all([holder, closer, writer]);
    assert.equal(h.code, 0, h.err);
    assert.equal(c.code, 0, c.err);
    assert.notEqual(w.code, 0, 'an insert that queued behind close must be refused, not recorded after it');
    assert.match(w.err, /fence is closed/);
    const raced = JSON.parse(sql(`SELECT row_to_json(f) FROM public.rwt_feedback_fences f WHERE run_key = ${lit(raceKey)};`));
    assert.equal(raced.state, 'closed');
    assert.equal(raced.report_ids.length, 0);
  } finally {
    if (started) { try { execFileSync(bin.pg_ctl, ['-D', data, '-m', 'immediate', 'stop'], { env, encoding: 'utf8' }); } catch { /* best effort */ } }
    rmSync(root, { recursive: true, force: true });
    if (!socket.startsWith(root)) rmSync(socket, { recursive: true, force: true });
  }
});
