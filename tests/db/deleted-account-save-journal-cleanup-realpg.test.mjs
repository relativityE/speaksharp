// Native, owned disposable PostgreSQL. No hosted database, provider, or model calls.
// #1643 follow-up (PO 2026-11-19: "make sure save records are deleted"): a run-owned proof account's finished save-journal rows
// (account_save_obligations) have no FK to auth.users and survive Auth deletion. Actual recording, admission and completion
// journal migrations, then the candidate service_role-only cleanup functions, then the SHARED live cleanup step
// (tests/live/helpers/runOwnedCleanup.ts clearDeletedAccountSaveJournal) driven against this database.
//
// Run: node --import tsx --test tests/db/deleted-account-save-journal-cleanup-realpg.test.mjs
// (tsx loads the TypeScript cleanup helper; the database part needs only an installed initdb/pg_ctl/psql.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { accessSync, constants, mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { completionBootstrap, recordingChain } from './account-completion-fixture.mjs';

const journal = 'backend/supabase/migrations/20261020230653_account_pending_completion_journal_1643.sql';
const abandonment = 'backend/supabase/migrations/20261112133000_recording_start_abandonment_1643.sql';
const candidate = 'backend/supabase/migrations/20261119200000_deleted_account_save_journal_cleanup_1643.sql';
const helper = 'tests/live/helpers/runOwnedCleanup.ts';
const DELETE_FN = 'delete_deleted_account_save_journal_v1';
const COUNT_FN = 'count_account_save_journal_v1';
const scope = 'a'.repeat(64);
const service = text => `SET ROLE service_role; ${text}`;
const as = (a, text) => `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${a.user}',false); ${text}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test('deleted-account save-journal cleanup: removes only a deleted account\'s finished rows, reads back zero, service_role only', async t => {
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
  // The shared live cleanup step under test (TypeScript; needs the tsx loader).
  const { clearDeletedAccountSaveJournal, cleanupFailureStep, SAVE_JOURNAL_DELETE_FN, SAVE_JOURNAL_COUNT_FN } = await import(`../../${helper}`);
  assert.equal(SAVE_JOURNAL_DELETE_FN, DELETE_FN); assert.equal(SAVE_JOURNAL_COUNT_FN, COUNT_FN);

  const root = mkdtempSync(join(tmpdir(), 'save-journal-cleanup-'));
  const data = join(root, 'data'), socket = join(root, 'socket'); mkdirSync(socket);
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('PG'))),
    PGHOST: socket, PGPORT: '5432', PGUSER: 'save_journal_fixture_admin', PGDATABASE: 'postgres' };
  const args = ['-h', socket, '-p', '5432', '-U', env.PGUSER, '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
  const sql = text => (text.length > 64_000
    ? execFileSync(bin.psql, [...args, '-1', '-f', '-'], { env, encoding: 'utf8', timeout: 60000, input: text, stdio: ['pipe', 'pipe', 'pipe'] })
    : execFileSync(bin.psql, [...args, '-c', text], { env, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] })).trim();
  const json = text => { const value = sql(text).split('\n').at(-1); return value ? JSON.parse(value) : null; };
  const last = out => out.trim().split('\n').at(-1);
  const clients = [], receipts = []; let started = false, index = 0;

  const journalRows = a => Number(sql(`SELECT count(*) FROM account_save_obligations WHERE user_id='${a.user}'`));
  const journalSnapshot = a => sql(`SELECT coalesce(string_agg(lease_id::text||':'||phase,',' ORDER BY lease_id),'') FROM account_save_obligations WHERE user_id='${a.user}'`);
  const authExists = a => sql(`SELECT EXISTS(SELECT 1 FROM auth.users WHERE id='${a.user}')`) === 't';
  const deleteAuth = a => sql(`DELETE FROM auth.users WHERE id='${a.user}'`);

  /**
   * The service_role client the live cleanup uses, reduced to `rpc` and pointed at this cluster: each call runs as
   * service_role, exactly the role PostgREST uses for the service key. A database error is returned like supabase-js does
   * ({ data: null, error }), never thrown, so the helper's own error handling is what is tested.
   */
  const serviceRpc = { calls: [], rpc(fn, params) {
    this.calls.push(fn);
    assert.ok(/^[a-z_0-9]+$/.test(fn) && UUID.test(String(params.p_user_id)), 'rpc adapter only forwards a plain function name and a uuid');
    try {
      const value = sql(service(`SELECT public.${fn}('${params.p_user_id}')`));
      return Promise.resolve({ data: value === '' ? null : Number(value), error: null });
    } catch (e) {
      const stderr = String(e.stderr ?? e.message);
      return Promise.resolve({ data: null, error: { code: /permission denied/.test(stderr) ? '42501' : /does not exist/.test(stderr) ? '42883' : '55000', message: stderr } });
    }
  } };

  function seed() {
    const suffix = String(++index).padStart(12, '0');
    const a = { user: `c9110000-0000-4000-8000-${suffix}`, n: 0 };
    sql(`INSERT INTO auth.users VALUES('${a.user}','rwt-journey-save-journal-${index}@example.test',now());
      UPDATE user_profiles SET subscription_status='pro' WHERE id='${a.user}';`);
    return a;
  }
  /** One take through the product RPCs: Start (lease), the take row, Stop + save (complete_session_v2), lease released. */
  function savedTake(a) {
    const lease = `c912${String(++a.n).padStart(4, '0')}-0000-4000-8000-${a.user.slice(-12)}`;
    assert.equal(json(as(a, `SELECT acquire_recording_lease('${lease}','synthetic',false)`)).acquired, true);
    const id = json(as(a, `SELECT create_session_and_update_usage('{"title":"synthetic","duration":0,"lease_id":"${lease}"}'::jsonb,'private')`)).new_session.id;
    assert.equal(json(as(a, `SELECT complete_session_v2('${id}','completed',30,NULL,'{"kind":"synthetic-control"}'::jsonb,3,70,6,'{}'::jsonb,'{}'::jsonb,'saved synthetic take')`)).success, true);
    assert.equal(json(as(a, `SELECT release_recording_lease('${lease}')`)).released, true);
    assert.equal(sql(`SELECT phase FROM account_save_obligations WHERE user_id='${a.user}' AND lease_id='${lease}'`), 'completed');
    return { lease, id };
  }
  function client(name, text, hold = false) {
    const child = spawn(bin.psql, args, { env: { ...env, PGAPPNAME: name }, stdio: ['pipe', 'pipe', 'pipe'] });
    const c = { child, stdout: '', stderr: '', exited: false }; clients.push(c);
    child.stdout.on('data', x => { c.stdout += x; }); child.stderr.on('data', x => { c.stderr += x; });
    c.done = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => { c.exited = true; resolve({ code, stdout: c.stdout, stderr: c.stderr }); }); });
    if (hold) child.stdin.write(text + '\n'); else child.stdin.end(text + '\n'); return c;
  }
  async function waitFor(fn) { const end = Date.now() + 5000; while (Date.now() < end) { if (fn()) return; await delay(20); } throw Error('required native lock barrier absent'); }
  const idle = name => sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND state='idle in transaction')`) === 't';
  const blocked = (w, h) => sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${w}'
    AND (SELECT pid FROM pg_stat_activity WHERE application_name='${h}')=ANY(pg_blocking_pids(pid)))`) === 't';

  try {
    execFileSync(bin.initdb, ['-D', data, '-U', env.PGUSER, '-A', 'trust', '--no-locale', '--encoding=UTF8'], { encoding: 'utf8' });
    execFileSync(bin.pg_ctl, ['-D', data, '-l', join(root, 'postgres.log'), '-w', 'start', '-o',
      `-F -k ${socket} -h '' -p 5432 -c max_connections=12 -c shared_buffers=16MB -c deadlock_timeout=100ms`], { encoding: 'utf8' });
    started = true; assert.equal(sql("SELECT current_setting('data_directory')"), data);
    sql(completionBootstrap());
    sql(readFileSync(journal, 'utf8'));
    sql(readFileSync(abandonment, 'utf8'));
    sql(`UPDATE account_completion_configuration SET enabled=true,scope_digest='${scope}'`);

    await t.test('prior-source reproduction: saved takes leave finished journal rows behind after Auth deletion, unreadable to service_role', async () => {
      const a = seed(); savedTake(a); savedTake(a);
      deleteAuth(a);
      assert.equal(authExists(a), false);
      assert.equal(journalRows(a), 2, 'the residue: both finished rows outlive the account');
      assert.throws(() => sql(service(`SELECT count(*) FROM account_save_obligations WHERE user_id='${a.user}'`)), /permission denied/);
      assert.throws(() => sql(service(`DELETE FROM account_save_obligations WHERE user_id='${a.user}'`)), /permission denied/);
      // Today's live cleanup step has nothing to call: it fails closed (no silent residue=0).
      await assert.rejects(() => clearDeletedAccountSaveJournal(serviceRpc, a.user), e => cleanupFailureStep(e) === 'save_journal_delete:account_save_obligations');
      assert.equal(journalRows(a), 2);
      receipts.push({ case: 'prior_source_residue', rowsLeft: 2 });
      t.priorResidue = a;
    });

    sql(readFileSync(candidate, 'utf8'));

    await t.test('access: only service_role may execute; table stays closed to every role; definer with an empty search_path', () => {
      for (const fn of [`${DELETE_FN}(uuid)`, `${COUNT_FN}(uuid)`]) {
        for (const [role, allowed] of [['anon', 'f'], ['authenticated', 'f'], ['service_role', 't'], ['public', 'f']])
          assert.equal(sql(`SELECT has_function_privilege('${role}','${fn}','EXECUTE')`), allowed, `${role} ${fn}`);
        assert.equal(sql(`SELECT prosecdef FROM pg_proc WHERE oid='${fn}'::regprocedure`), 't');
        assert.equal(sql(`SELECT proconfig::text FROM pg_proc WHERE oid='${fn}'::regprocedure`), '{"search_path=\\"\\""}');
      }
      for (const role of ['anon', 'authenticated', 'service_role']) for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'])
        assert.equal(sql(`SELECT has_table_privilege('${role}','account_save_obligations','${privilege}')`), 'f', `${role} ${privilege}`);
    });

    await t.test('a non-service caller is refused and changes nothing', () => {
      const a = seed(); savedTake(a); deleteAuth(a);
      for (const role of ['anon', 'authenticated']) {
        assert.throws(() => sql(`SET ROLE ${role}; SELECT ${DELETE_FN}('${a.user}')`), /permission denied/, role);
        assert.throws(() => sql(`SET ROLE ${role}; SELECT ${COUNT_FN}('${a.user}')`), /permission denied/, role);
      }
      // Even the account's own JWT is refused (and the account is gone anyway).
      assert.throws(() => sql(as(a, `SELECT ${DELETE_FN}('${a.user}')`)), /permission denied/);
      assert.equal(journalRows(a), 1);
    });

    await t.test('refused while the account still exists: a live account\'s journal is never touched', async () => {
      const a = seed(); savedTake(a);
      const before = journalSnapshot(a);
      assert.throws(() => sql(service(`SELECT ${DELETE_FN}('${a.user}')`)), /account still exists/);
      await assert.rejects(() => clearDeletedAccountSaveJournal(serviceRpc, a.user), e => cleanupFailureStep(e) === 'save_journal_delete:account_save_obligations');
      assert.equal(journalSnapshot(a), before);
    });

    await t.test('J3.b shape through the shared live step: full + repeat takes removed, readback zero, other accounts untouched', async () => {
      const a = seed(), b = seed(), live = seed();
      savedTake(a); savedTake(a);                          // the full take and the one repeat
      savedTake(b); savedTake(b); savedTake(b);            // another deleted account, cleaned separately below
      savedTake(live);                                     // a live account that must never be touched
      deleteAuth(a); deleteAuth(b);
      const bBefore = journalSnapshot(b), liveBefore = journalSnapshot(live);
      assert.equal(journalRows(a), 2);
      // The readback is independent: it reports real rows, so a zero from it means zero.
      assert.equal(sql(service(`SELECT ${COUNT_FN}('${a.user}')`)), '2');
      assert.equal(sql(service(`SELECT ${COUNT_FN}('${live.user}')`)), '1');
      serviceRpc.calls.length = 0;
      await clearDeletedAccountSaveJournal(serviceRpc, a.user);
      assert.deepEqual(serviceRpc.calls, [DELETE_FN, COUNT_FN], 'delete, then an independent readback');
      assert.equal(journalRows(a), 0, 'the deleted account\'s rows are gone');
      assert.equal(sql(service(`SELECT ${COUNT_FN}('${a.user}')`)), '0');
      assert.equal(journalSnapshot(b), bBefore, 'another deleted account is untouched');
      assert.equal(journalSnapshot(live), liveBefore, 'a live account is untouched');
      // Repeat is idempotent.
      await clearDeletedAccountSaveJournal(serviceRpc, a.user);
      assert.equal(sql(service(`SELECT ${DELETE_FN}('${a.user}')`)), '0');
      // The prior-source residue account is cleanable now too.
      const prior = t.priorResidue; assert.ok(prior);
      await clearDeletedAccountSaveJournal(serviceRpc, prior.user);
      assert.equal(journalRows(prior), 0);
      receipts.push({ case: 'shared_step_cleans', deletedAccountRowsBefore: 2, after: 0, otherDeleted: bBefore.split(',').length, live: liveBefore.split(',').length });
    });

    await t.test('refused while any row of the deleted account is unsettled, and while a product closure completion is processing', async () => {
      const a = seed(); savedTake(a); deleteAuth(a);
      // An unsettled row cannot arise through the product (the delete guard refuses), so it is planted directly.
      sql(`INSERT INTO account_save_obligations(user_id,lease_id,phase) VALUES('${a.user}',gen_random_uuid(),'admitted')`);
      const before = journalSnapshot(a);
      assert.throws(() => sql(service(`SELECT ${DELETE_FN}('${a.user}')`)), /account admitted save unsettled/);
      assert.equal(journalSnapshot(a), before);
      const b = seed(); savedTake(b); deleteAuth(b);
      sql(`INSERT INTO account_completion_executions(user_id,request_id,execution_id,scope_digest,expires_at)
        VALUES('${b.user}',gen_random_uuid(),gen_random_uuid(),'${scope}',now()+interval '5 minutes')`);
      const bBefore = journalSnapshot(b);
      assert.throws(() => sql(service(`SELECT ${DELETE_FN}('${b.user}')`)), /account closure completion in progress/);
      await assert.rejects(() => clearDeletedAccountSaveJournal(serviceRpc, b.user), e => cleanupFailureStep(e) === 'save_journal_delete:account_save_obligations');
      assert.equal(journalSnapshot(b), bBefore);
      sql(`UPDATE account_completion_executions SET phase='completed' WHERE user_id='${b.user}'`);
      assert.equal(sql(service(`SELECT ${DELETE_FN}('${b.user}')`)), '0');
    });

    await t.test('a null id is refused; an id with no rows returns zero', () => {
      assert.throws(() => sql(service(`SELECT ${DELETE_FN}(NULL)`)), /account id required/);
      assert.equal(sql(service(`SELECT ${DELETE_FN}(gen_random_uuid())`)), '0');
    });

    await t.test('serialized with the product closure: waits on the per-account closure lock', async () => {
      const a = seed(); savedTake(a); deleteAuth(a);
      const hname = `closure_holder_${index}`, wname = `journal_cleanup_waiter_${index}`;
      const holder = client(hname, `BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('account-billing:${a.user}',0));`, true);
      await waitFor(() => idle(hname));
      const waiter = client(wname, service(`SELECT ${DELETE_FN}('${a.user}');`)); await waitFor(() => blocked(wname, hname));
      assert.equal(journalRows(a), 1, 'nothing removed while the closure lock is held');
      holder.child.stdin.end('COMMIT;\n');
      const h = await holder.done, w = await waiter.done; receipts.push({ order: 'closure-lock-then-cleanup', observedBlock: true, holderCode: h.code, waiterCode: w.code });
      assert.equal(h.code, 0, h.stderr); assert.equal(w.code, 0, w.stderr);
      assert.equal(last(w.stdout), '0'); assert.equal(journalRows(a), 0);
    });

    await t.test('the shared step fails closed on a non-zero or uncounted answer (no silent residue=0)', async () => {
      const fake = answers => ({ rpc: () => Promise.resolve(answers.shift()) });
      for (const [answers, step] of [
        [[{ data: 1, error: null }], 'residue_found:account_save_obligations'],
        [[{ data: null, error: null }], 'residue_unproven:account_save_obligations'],
        [[{ data: 0, error: null }, { data: 2, error: null }], 'residue_found:account_save_obligations'],
        [[{ data: 0, error: null }, { data: null, error: { code: '42501', message: 'x' } }], 'residue_query:account_save_obligations'],
        [[{ data: null, error: { code: '42883', message: 'x' } }], 'save_journal_delete:account_save_obligations'],
      ]) await assert.rejects(() => clearDeletedAccountSaveJournal(fake(answers), seed().user), e => cleanupFailureStep(e) === step, step);
      await assert.rejects(() => clearDeletedAccountSaveJournal({}, seed().user), e => cleanupFailureStep(e) === 'save_journal_delete:account_save_obligations');
    });
  } finally {
    for (const c of clients) if (!c.child.stdin.destroyed) c.child.stdin.end();
    if (started) execFileSync(bin.pg_ctl, ['-D', data, '-w', 'stop', '-m', 'immediate'], { encoding: 'utf8' });
    await Promise.allSettled(clients.map(c => c.done));
    mkdirSync('artifacts/deleted-account-save-journal-cleanup', { recursive: true });
    const files = [candidate, journal, abandonment, helper, 'tests/db/deleted-account-save-journal-cleanup-realpg.test.mjs', ...recordingChain.map(x => 'backend/supabase/migrations/' + x)];
    writeFileSync('artifacts/deleted-account-save-journal-cleanup/receipts.json', JSON.stringify({ createdAt: new Date().toISOString(),
      databaseStarted: started, qualification: 'Inspect TAP exit and participant results; this artifact alone is not a PASS',
      boundary: 'owned disposable PostgreSQL only; actual recording/admission/completion-journal/abandonment migrations plus the candidate; declared signup/storage/usage fixtures; no hosted/provider calls',
      hashes: Object.fromEntries(files.map(f => [f, createHash('sha256').update(readFileSync(f)).digest('hex')])), receipts }, null, 2) + '\n');
    rmSync(root, { recursive: true, force: true });
  }
});
