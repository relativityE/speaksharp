// Native, owned disposable PostgreSQL. No hosted database, provider, or model calls.
// #1643 follow-up (PO 2026-11-19: "make sure save records are deleted"): a run-owned proof account's finished save-journal rows
// (account_save_obligations) have no FK to auth.users and survive Auth deletion. Actual recording, admission and completion
// journal migrations, then the candidate service_role-only cleanup functions, then the SHARED live cleanup step
// (tests/live/helpers/runOwnedCleanup.ts clearDeletedAccountSaveJournal) driven against this database.
//
// Run: node --test tests/db/deleted-account-save-journal-cleanup-realpg.test.mjs (also works with --import tsx)
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
import { tsImport } from 'tsx/esm/api';
import { completionBootstrap, recordingChain } from './account-completion-fixture.mjs';

const journal = 'backend/supabase/migrations/20261020230653_account_pending_completion_journal_1643.sql';
const abandonment = 'backend/supabase/migrations/20261112133000_recording_start_abandonment_1643.sql';
const candidate = 'backend/supabase/migrations/20261119200000_deleted_account_save_journal_cleanup_1643.sql';
const helper = 'tests/live/helpers/runOwnedCleanup.ts';
const CLAIM_FN = 'claim_account_save_journal_cleanup_v1';
const RESUME_FN = 'resume_account_save_journal_cleanup_v1';
const DELETE_FN = 'delete_deleted_account_save_journal_v1';
const COUNT_FN = 'count_account_save_journal_v1';
const CLAIMS = 'account_save_journal_cleanup_claims';
const scope = 'a'.repeat(64);
const service = text => `SET ROLE service_role; ${text}`;
const as = (a, text) => `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${a.user}',false); ${text}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const lit = v => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
// Two GitHub runs of the same workflow (the RWT journeys' app_metadata.ct_run shape) and one canary run (canary_run).
const runBinding = runId => ({ repository: 'relativityE/speaksharp', workflow: 'relativityE/speaksharp/.github/workflows/rc-gates.yml@refs/heads/main',
  runId, runAttempt: '1', role: 'rwt-journey' });
const RUN_A = runBinding('44000000001'), RUN_B = runBinding('44000000002');
const CANARY = { repository: 'relativityE/speaksharp', workflow: 'relativityE/speaksharp/.github/workflows/canary.yml@refs/heads/main',
  runId: '44000000003', runAttempt: '1', role: 'canary-active-trial' };

test('deleted-account save-journal cleanup: only the run that owns a deleted account removes its finished rows, reads back zero, service_role only', async t => {
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
  // The shared live cleanup steps under test (TypeScript). tsImport loads them through tsx whether or not the runner passed
  // `--import tsx`: the evidence lane runs plain `node --test`, where its extensionless imports would not resolve.
  const { claimSaveJournalCleanup, clearDeletedAccountSaveJournal, cleanupFailureStep, newSaveJournalSecret, cleanupRunOwnedAccount,
    resumeSaveJournalCleanup, SAVE_JOURNAL_CLAIM_FN, SAVE_JOURNAL_RESUME_FN, SAVE_JOURNAL_DELETE_FN, SAVE_JOURNAL_COUNT_FN,
    RESIDUE_CHECKS } = await tsImport(`../../${helper}`, import.meta.url);
  assert.equal(SAVE_JOURNAL_CLAIM_FN, CLAIM_FN); assert.equal(SAVE_JOURNAL_DELETE_FN, DELETE_FN); assert.equal(SAVE_JOURNAL_COUNT_FN, COUNT_FN);
  assert.equal(SAVE_JOURNAL_RESUME_FN, RESUME_FN);

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
  const claimRows = a => Number(sql(`SELECT count(*) FROM ${CLAIMS} WHERE user_id='${a.user}'`));
  const authExists = a => sql(`SELECT EXISTS(SELECT 1 FROM auth.users WHERE id='${a.user}')`) === 't';
  const deleteAuth = a => sql(`DELETE FROM auth.users WHERE id='${a.user}'`);
  const fnCall = (fn, p) => `SELECT public.${fn}(${Object.entries(p).map(([k, v]) =>
    `${k}=>${k === 'p_run_binding' ? (v === null ? 'NULL::jsonb' : `${lit(JSON.stringify(v))}::jsonb`) : k === 'p_user_id' ? (v === null ? 'NULL::uuid' : `${lit(v)}::uuid`) : `${lit(v)}::text`}`).join(',')})`;
  const claimSql = (a, binding, secret) => service(fnCall(CLAIM_FN, { p_user_id: a.user, p_run_binding: binding, p_token: secret }));
  const deleteSql = (a, secret) => service(fnCall(DELETE_FN, { p_user_id: a.user ?? a, p_token: secret }));

  /**
   * The service_role client the live cleanup uses, reduced to `rpc` and pointed at this cluster: each call runs as
   * service_role, exactly the role PostgREST uses for the service key. A database error is returned like supabase-js does
   * ({ data: null, error }), never thrown, so the helper's own error handling is what is tested.
   */
  const serviceRpc = { calls: [], rpc(fn, params) {
    this.calls.push(fn);
    assert.ok(/^[a-z_0-9]+$/.test(fn) && UUID.test(String(params.p_user_id)), 'rpc adapter only forwards a plain function name and a uuid');
    try {
      const value = sql(service(fnCall(fn, params)));
      return Promise.resolve({ data: value === '' ? null : Number(value), error: null });
    } catch (e) {
      const stderr = String(e.stderr ?? e.message);
      const code = /permission denied|not claimed by this run|not owned by this run|not run-owned/.test(stderr) ? '42501'
        : /does not exist/.test(stderr) ? '42883' : /account not found|no cleanup claim/.test(stderr) ? 'P0002' : '55000';
      return Promise.resolve({ data: null, error: { code, message: stderr } });
    }
  } };

  /** A run-owned proof account; `meta` is what the service role wrote into its app_metadata (the run binding). */
  function seed(meta = { ct_run: RUN_A }, prefix = 'rwt-journey-save-journal-') {
    const suffix = String(++index).padStart(12, '0');
    const a = { user: `c9110000-0000-4000-8000-${suffix}`, email: `${prefix}${index}@example.test`, n: 0, binding: meta.ct_run ?? meta.canary_run ?? null };
    sql(`INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data) VALUES('${a.user}','${prefix}${index}@example.test',now(),
        ${lit(JSON.stringify({ provider: 'email', providers: ['email'], ...meta }))}::jsonb);
      UPDATE user_profiles SET subscription_status='pro' WHERE id='${a.user}';`);
    return a;
  }
  /** The run that owns `a` claims it while it exists (with its own one-time secret), then Auth deletes it. */
  function claimAndDelete(a) {
    a.secret = newSaveJournalSecret();
    sql(claimSql(a, a.binding, a.secret));
    deleteAuth(a);
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
  const refusedAt = step => e => cleanupFailureStep(e) === step;

  try {
    execFileSync(bin.initdb, ['-D', data, '-U', env.PGUSER, '-A', 'trust', '--no-locale', '--encoding=UTF8'], { encoding: 'utf8' });
    execFileSync(bin.pg_ctl, ['-D', data, '-l', join(root, 'postgres.log'), '-w', 'start', '-o',
      `-F -k ${socket} -h '' -p 5432 -c max_connections=12 -c shared_buffers=16MB -c deadlock_timeout=100ms`], { encoding: 'utf8' });
    started = true; assert.equal(sql("SELECT current_setting('data_directory')"), data);
    sql(completionBootstrap());
    // Supabase Auth keeps app_metadata in auth.users.raw_app_meta_data (nullable jsonb); the shared fixture omits the column.
    sql('ALTER TABLE auth.users ADD COLUMN raw_app_meta_data jsonb');
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
      // Today's live cleanup steps have nothing to call: they fail closed (no silent residue=0).
      await assert.rejects(() => claimSaveJournalCleanup(serviceRpc, seed().user, RUN_A, newSaveJournalSecret()), refusedAt('save_journal_claim:account_save_obligations'));
      await assert.rejects(() => clearDeletedAccountSaveJournal(serviceRpc, a.user, newSaveJournalSecret()), refusedAt('save_journal_delete:account_save_obligations'));
      assert.equal(journalRows(a), 2);
      receipts.push({ case: 'prior_source_residue', rowsLeft: 2 });
    });

    sql(readFileSync(candidate, 'utf8'));

    await t.test('access: only service_role may execute; journal and claims stay closed to every role; definer with an empty search_path', () => {
      for (const fn of [`${CLAIM_FN}(uuid,jsonb,text)`, `${RESUME_FN}(uuid,text,jsonb,text)`, `${DELETE_FN}(uuid,text)`, `${COUNT_FN}(uuid)`]) {
        for (const [role, allowed] of [['anon', 'f'], ['authenticated', 'f'], ['service_role', 't'], ['public', 'f']])
          assert.equal(sql(`SELECT has_function_privilege('${role}','${fn}','EXECUTE')`), allowed, `${role} ${fn}`);
        assert.equal(sql(`SELECT prosecdef FROM pg_proc WHERE oid='${fn}'::regprocedure`), 't');
        assert.equal(sql(`SELECT proconfig::text FROM pg_proc WHERE oid='${fn}'::regprocedure`), '{"search_path=\\"\\""}');
      }
      assert.equal(sql(`SELECT count(*) FROM pg_proc WHERE proname IN ('${CLAIM_FN}','${RESUME_FN}','${DELETE_FN}','${COUNT_FN}')`), '4', 'exactly one overload each');
      for (const table of ['account_save_obligations', CLAIMS]) for (const role of ['anon', 'authenticated', 'service_role'])
        for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'])
          assert.equal(sql(`SELECT has_table_privilege('${role}','${table}','${privilege}')`), 'f', `${table} ${role} ${privilege}`);
      assert.equal(sql(`SELECT relrowsecurity FROM pg_class WHERE oid='public.${CLAIMS}'::regclass`), 't');
    });

    await t.test('a non-service caller is refused and changes nothing', () => {
      const a = seed(); savedTake(a); claimAndDelete(a);
      for (const role of ['anon', 'authenticated']) {
        assert.throws(() => sql(`SET ROLE ${role}; ${fnCall(CLAIM_FN, { p_user_id: a.user, p_run_binding: RUN_A, p_token: a.secret })}`), /permission denied/, role);
        assert.throws(() => sql(`SET ROLE ${role}; ${fnCall(DELETE_FN, { p_user_id: a.user, p_token: a.secret })}`), /permission denied/, role);
        assert.throws(() => sql(`SET ROLE ${role}; ${fnCall(RESUME_FN, { p_user_id: a.user, p_email: a.email, p_run_binding: RUN_A, p_token: a.secret })}`), /permission denied/, role);
        assert.throws(() => sql(`SET ROLE ${role}; SELECT ${COUNT_FN}('${a.user}')`), /permission denied/, role);
      }
      assert.throws(() => sql(as(a, fnCall(DELETE_FN, { p_user_id: a.user, p_token: a.secret }))), /permission denied/);
      assert.equal(journalRows(a), 1);
    });

    await t.test('OWNERSHIP (Sam, #1906): a run that names ANOTHER run\'s deleted account is refused and nothing is deleted', async () => {
      const mine = seed({ ct_run: RUN_A }), theirs = seed({ ct_run: RUN_B });
      savedTake(mine); savedTake(theirs); savedTake(theirs);
      claimAndDelete(mine); claimAndDelete(theirs);
      const theirsBefore = journalSnapshot(theirs);
      // Run A presents its own secret for run B's account: refused by the database, directly and through the shared step.
      assert.throws(() => sql(deleteSql(theirs, mine.secret)), /account save journal not claimed by this run/);
      await assert.rejects(() => clearDeletedAccountSaveJournal(serviceRpc, theirs.user, mine.secret), refusedAt('save_journal_delete:account_save_obligations'));
      // Nor with no secret, a malformed one, or a guess.
      for (const secret of [null, '', 'x', newSaveJournalSecret()]) assert.throws(() => sql(deleteSql(theirs, secret)), /not claimed by this run/, String(secret));
      assert.equal(journalSnapshot(theirs), theirsBefore, 'run B\'s finished rows are untouched');
      assert.equal(claimRows(theirs), 1, 'run B\'s claim is untouched');
      // A deleted account that was never claimed cannot be cleaned by anyone (the claim is the only proof of ownership).
      const orphan = seed({ ct_run: RUN_B }); savedTake(orphan); deleteAuth(orphan);
      assert.throws(() => sql(deleteSql(orphan, mine.secret)), /not claimed by this run/);
      assert.equal(journalRows(orphan), 1);
      // The owners clean their own: both zero, both claims gone.
      await clearDeletedAccountSaveJournal(serviceRpc, mine.user, mine.secret);
      await clearDeletedAccountSaveJournal(serviceRpc, theirs.user, theirs.secret);
      assert.deepEqual([journalRows(mine), journalRows(theirs), claimRows(mine), claimRows(theirs)], [0, 0, 0, 0]);
      receipts.push({ case: 'foreign_run_refused', foreignRowsBefore: 2, foreignRowsAfterRefusal: 2, ownerCleaned: 0 });
    });

    await t.test('OWNERSHIP: the claim is made only while the account exists, only for a run-owned address, only with the account\'s own binding', async () => {
      const a = seed({ ct_run: RUN_B }); savedTake(a);
      const secret = newSaveJournalSecret();
      // Run A tries to claim run B's account while it exists: its binding is not the one the service role wrote.
      assert.throws(() => sql(claimSql(a, RUN_A, secret)), /account is not owned by this run/);
      await assert.rejects(() => claimSaveJournalCleanup(serviceRpc, a.user, RUN_A, secret), refusedAt('save_journal_claim:account_save_obligations'));
      // Nor as unbound, nor with an extra or changed key, nor the canary's binding.
      for (const binding of [null, { ...RUN_B, extra: '1' }, { ...RUN_B, runAttempt: '2' }, CANARY])
        assert.throws(() => sql(claimSql(a, binding, secret)), /account is not owned by this run/, JSON.stringify(binding));
      assert.equal(claimRows(a), 0);
      // A secret that is not 64 lowercase hex characters is refused.
      for (const bad of [null, '', 'A'.repeat(64), 'a'.repeat(63)]) assert.throws(() => sql(claimSql(a, RUN_B, bad)), /cleanup secret required/, String(bad));
      // Unbound account: only an unbound claim. Canary account: only its canary binding. Both keys at once: nobody.
      const unbound = seed({}), canary = seed({ canary_run: CANARY }, 'ctrial-run-'), both = seed({ ct_run: RUN_A, canary_run: CANARY });
      assert.throws(() => sql(claimSql(unbound, RUN_A, secret)), /not owned by this run/);
      sql(claimSql(unbound, null, secret)); assert.equal(claimRows(unbound), 1);
      assert.throws(() => sql(claimSql(canary, null, secret)), /not owned by this run/);
      sql(claimSql(canary, CANARY, secret)); assert.equal(claimRows(canary), 1);
      for (const binding of [RUN_A, CANARY, null]) assert.throws(() => sql(claimSql(both, binding, secret)), /not owned by this run/);
      // A real (non-proof) address is never claimable, even with a matching binding.
      const real = seed({ ct_run: RUN_A }, 'someone-'); assert.throws(() => sql(claimSql(real, RUN_A, secret)), /account is not run-owned/);
      // Once the account is gone, nobody can claim it (ownership can no longer be checked).
      deleteAuth(a);
      assert.throws(() => sql(claimSql(a, RUN_B, secret)), /account not found/);
      assert.throws(() => sql(service(fnCall(CLAIM_FN, { p_user_id: null, p_run_binding: null, p_token: secret }))), /account id required/);
      assert.equal(journalRows(a), 1);
    });

    await t.test('a retried claim while the account exists replaces the secret; the earlier secret no longer deletes', async () => {
      const a = seed(); savedTake(a);
      const first = newSaveJournalSecret(), second = newSaveJournalSecret();
      sql(claimSql(a, RUN_A, first)); sql(claimSql(a, RUN_A, second)); assert.equal(claimRows(a), 1);
      deleteAuth(a);
      assert.throws(() => sql(deleteSql(a, first)), /not claimed by this run/);
      assert.equal(journalRows(a), 1);
      await clearDeletedAccountSaveJournal(serviceRpc, a.user, second);
      assert.deepEqual([journalRows(a), claimRows(a)], [0, 0]);
    });

    await t.test('refused while the account still exists: a live account\'s journal is never touched', async () => {
      const a = seed(); savedTake(a);
      a.secret = newSaveJournalSecret(); sql(claimSql(a, RUN_A, a.secret));
      const before = journalSnapshot(a);
      assert.throws(() => sql(deleteSql(a, a.secret)), /account still exists/);
      await assert.rejects(() => clearDeletedAccountSaveJournal(serviceRpc, a.user, a.secret), refusedAt('save_journal_delete:account_save_obligations'));
      assert.equal(journalSnapshot(a), before);
    });

    await t.test('J3.b shape through the shared live steps: full + repeat takes removed, readback zero, claim gone, other accounts untouched', async () => {
      const a = seed(), b = seed(), live = seed();
      savedTake(a); savedTake(a);                          // the full take and the one repeat
      savedTake(b); savedTake(b); savedTake(b);            // another deleted account of the same run, cleaned separately below
      savedTake(live);                                     // a live account that must never be touched
      a.secret = newSaveJournalSecret();
      serviceRpc.calls.length = 0;
      await claimSaveJournalCleanup(serviceRpc, a.user, RUN_A, a.secret);
      deleteAuth(a); claimAndDelete(b);
      const bBefore = journalSnapshot(b), liveBefore = journalSnapshot(live);
      assert.equal(journalRows(a), 2);
      // The readback is independent: it reports real rows, so a zero from it means zero.
      assert.equal(sql(service(`SELECT ${COUNT_FN}('${a.user}')`)), '2');
      assert.equal(sql(service(`SELECT ${COUNT_FN}('${live.user}')`)), '1');
      await clearDeletedAccountSaveJournal(serviceRpc, a.user, a.secret);
      assert.deepEqual(serviceRpc.calls, [CLAIM_FN, DELETE_FN, COUNT_FN], 'claim, then delete, then an independent readback');
      assert.equal(journalRows(a), 0, 'the deleted account\'s rows are gone');
      assert.equal(claimRows(a), 0, 'and so is its claim: nothing left behind');
      assert.equal(sql(service(`SELECT ${COUNT_FN}('${a.user}')`)), '0');
      assert.equal(journalSnapshot(b), bBefore, 'another deleted account is untouched');
      assert.equal(journalSnapshot(live), liveBefore, 'a live account is untouched');
      await clearDeletedAccountSaveJournal(serviceRpc, b.user, b.secret);
      assert.equal(journalRows(b), 0);
      receipts.push({ case: 'shared_step_cleans', deletedAccountRowsBefore: 2, after: 0, otherDeleted: bBefore.split(',').length, live: liveBefore.split(',').length });
    });

    await t.test('refused while any row of the deleted account is unsettled, and while a product closure completion is processing', async () => {
      const a = seed(); savedTake(a); claimAndDelete(a);
      // An unsettled row cannot arise through the product (the delete guard refuses), so it is planted directly.
      sql(`INSERT INTO account_save_obligations(user_id,lease_id,phase) VALUES('${a.user}',gen_random_uuid(),'admitted')`);
      const before = journalSnapshot(a);
      assert.throws(() => sql(deleteSql(a, a.secret)), /account admitted save unsettled/);
      assert.equal(journalSnapshot(a), before); assert.equal(claimRows(a), 1);
      const b = seed(); savedTake(b); claimAndDelete(b);
      sql(`INSERT INTO account_completion_executions(user_id,request_id,execution_id,scope_digest,expires_at)
        VALUES('${b.user}',gen_random_uuid(),gen_random_uuid(),'${scope}',now()+interval '5 minutes')`);
      const bBefore = journalSnapshot(b);
      assert.throws(() => sql(deleteSql(b, b.secret)), /account closure completion in progress/);
      await assert.rejects(() => clearDeletedAccountSaveJournal(serviceRpc, b.user, b.secret), refusedAt('save_journal_delete:account_save_obligations'));
      assert.equal(journalSnapshot(b), bBefore);
      sql(`UPDATE account_completion_executions SET phase='completed' WHERE user_id='${b.user}'`);
      assert.equal(sql(deleteSql(b, b.secret)), '0');
    });

    await t.test('a null id is refused; an unclaimed id is refused even with no rows', () => {
      assert.throws(() => sql(service(fnCall(DELETE_FN, { p_user_id: null, p_token: 'a'.repeat(64) }))), /account id required/);
      assert.throws(() => sql(deleteSql('c9290000-0000-4000-8000-000000000000', 'a'.repeat(64))), /not claimed by this run/);
    });

    await t.test('serialized with the product closure: waits on the per-account closure lock', async () => {
      const a = seed(); savedTake(a); claimAndDelete(a);
      const hname = `closure_holder_${index}`, wname = `journal_cleanup_waiter_${index}`;
      const holder = client(hname, `BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('account-billing:${a.user}',0));`, true);
      await waitFor(() => idle(hname));
      const waiter = client(wname, deleteSql(a, a.secret) + ';'); await waitFor(() => blocked(wname, hname));
      assert.equal(journalRows(a), 1, 'nothing removed while the closure lock is held');
      holder.child.stdin.end('COMMIT;\n');
      const h = await holder.done, w = await waiter.done; receipts.push({ order: 'closure-lock-then-cleanup', observedBlock: true, holderCode: h.code, waiterCode: w.code });
      assert.equal(h.code, 0, h.stderr); assert.equal(w.code, 0, w.stderr);
      assert.equal(last(w.stdout), '0'); assert.equal(journalRows(a), 0);
    });

    await t.test('the shared steps fail closed on a non-zero or uncounted answer (no silent residue=0)', async () => {
      const fake = answers => ({ rpc: () => Promise.resolve(answers.shift()) });
      const s = newSaveJournalSecret();
      for (const [answers, step] of [
        [[{ data: 1, error: null }], 'residue_found:account_save_obligations'],
        [[{ data: null, error: null }], 'residue_unproven:account_save_obligations'],
        [[{ data: 0, error: null }, { data: 2, error: null }], 'residue_found:account_save_obligations'],
        [[{ data: 0, error: null }, { data: null, error: { code: '42501', message: 'x' } }], 'residue_query:account_save_obligations'],
        [[{ data: null, error: { code: '42883', message: 'x' } }], 'save_journal_delete:account_save_obligations'],
      ]) await assert.rejects(() => clearDeletedAccountSaveJournal(fake(answers), seed().user, s), refusedAt(step), step);
      await assert.rejects(() => clearDeletedAccountSaveJournal({}, seed().user, s), refusedAt('save_journal_delete:account_save_obligations'));
      await assert.rejects(() => claimSaveJournalCleanup(fake([{ data: null, error: { code: '42501', message: 'x' } }]), seed().user, RUN_A, s), refusedAt('save_journal_claim:account_save_obligations'));
      await assert.rejects(() => claimSaveJournalCleanup({}, seed().user, RUN_A, s), refusedAt('save_journal_claim:account_save_obligations'));
      assert.match(newSaveJournalSecret(), /^[0-9a-f]{64}$/); assert.notEqual(newSaveJournalSecret(), newSaveJournalSecret());
    });

    // ── RESTART after Auth deletion (Sam, #1906 review: "a run using this new code must still be able to finish its own cleanup
    //    after Auth deletion and a restart") ────────────────────────────────────────────────────────────────────────────────
    const resumeSql = (a, binding, secret, email = a.email) => service(fnCall(RESUME_FN, { p_user_id: a.user, p_email: email, p_run_binding: binding, p_token: secret }));
    const claimToken = a => sql(`SELECT coalesce(encode(token_sha256,'hex'),'') FROM ${CLAIMS} WHERE user_id='${a.user}'`);
    const RUN_ENV = ['GITHUB_ACTIONS', 'GITHUB_REPOSITORY', 'GITHUB_WORKFLOW_REF', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'];
    const savedEnv = Object.fromEntries(RUN_ENV.map(k => [k, process.env[k]]));
    /** This process acts as the GitHub run `b` (its env is what currentRunBinding() reads), or as a local run when `b` is null. */
    const actAs = b => {
      for (const k of RUN_ENV) delete process.env[k];
      if (b) Object.assign(process.env, { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: b.repository, GITHUB_WORKFLOW_REF: b.workflow, GITHUB_RUN_ID: b.runId, GITHUB_RUN_ATTEMPT: b.runAttempt });
    };
    const restoreEnv = () => { for (const k of RUN_ENV) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; } };
    const tableExists = table => sql(`SELECT to_regclass('public.${table}') IS NOT NULL`) === 't';
    const outsideFixture = new Set();
    /**
     * The service-role admin client the SHARED cleanupRunOwnedAccount uses, pointed at this cluster: Auth reads and deletion are
     * real auth.users rows (the deletion fires the product's real save-obligation guard), the save-journal functions are the
     * real service_role functions, and every residue readback reads the real table. Residue tables this fixture does not create
     * answer a counted 0 and are named in the receipts (they are product tables outside the save journal under test).
     * `crash` throws, as a dead process would, right after that step: the secret the cleanup held is gone with it.
     */
    const realAdmin = ({ crash } = {}) => {
      const steps = [];
      const die = step => { if (crash === step) throw new Error(`SIMULATED_CRASH after ${step}`); };
      const count = (table, column, value) => {
        if (!tableExists(table)) { outsideFixture.add(table); return { count: 0, error: null }; }
        return { count: Number(sql(`SELECT count(*) FROM public.${table} WHERE ${column}=${lit(value)}`)), error: null };
      };
      return {
        steps,
        auth: { admin: {
          getUserById: async uid => {
            const row = sql(`SELECT json_build_object('id',id,'email',email,'app_metadata',coalesce(raw_app_meta_data,'{}'::jsonb))::text FROM auth.users WHERE id=${lit(uid)}`);
            return row ? { data: { user: JSON.parse(row) }, error: null }
              : { data: { user: null }, error: { status: 404, code: 'user_not_found', message: 'User not found' } };
          },
          deleteUser: async uid => {
            try { sql(`DELETE FROM auth.users WHERE id=${lit(uid)}`); } catch { return { error: { message: 'Database error deleting user' } }; }
            steps.push('deleteUser'); die('deleteUser'); return { error: null };
          },
          listUsers: async () => { throw new Error('not used: the uid is known'); },
        } },
        from: table => ({
          select: (columns, opts) => ({ eq: async (column, value) => {
            if (opts?.head) return count(table, column, value);
            if (!tableExists(table)) { outsideFixture.add(table); return { data: [], error: null }; }
            const rows = sql(`SELECT coalesce(json_agg(json_build_object(${columns.split(',').map(c => `'${c}',${c}`).join(',')})),'[]')::text
              FROM public.${table} WHERE ${column}=${lit(value)}`);
            return { data: JSON.parse(rows), error: null };
          } }),
          delete: () => ({ eq: async (column, value) => {
            if (tableExists(table)) sql(`DELETE FROM public.${table} WHERE ${column}=${lit(value)}`); else outsideFixture.add(table);
            steps.push(`pre_delete:${table}`); die(`pre_delete:${table}`); return { error: null };
          } }),
        }),
        rpc: async (fn, args) => { steps.push(fn); const r = await serviceRpc.rpc(fn, args); die(fn); return r; },
      };
    };
    const cleanup = (admin, a) => cleanupRunOwnedAccount({ admin, capturedUid: a.user, createdEmail: a.email, runOwnedPrefix: 'rwt-journey-' });

    await t.test('RESTART (Sam, #1906): a cleanup that crashed right after the Auth deletion is finished by the SAME run; another run is still refused', async () => {
      try {
        const a = seed({ ct_run: RUN_A }); savedTake(a); savedTake(a);   // the full take and one repeat, both saved
        actAs(RUN_A);
        const crashed = realAdmin({ crash: 'deleteUser' });
        await assert.rejects(() => cleanup(crashed, a), /SIMULATED_CRASH after deleteUser/);
        assert.deepEqual(crashed.steps, [CLAIM_FN, 'pre_delete:trial_entitlements', 'deleteUser'],
          'claimed, pre-deleted and deleted in Auth; then the process died holding the only copy of the secret');
        // The state Sam described: account gone, finished rows left, claim left, and nobody holds its secret any more.
        assert.equal(authExists(a), false);
        assert.deepEqual([journalRows(a), claimRows(a)], [2, 1]);
        const before = journalSnapshot(a), token = claimToken(a);

        // ANOTHER run restarting against this account (run B of the same workflow): the database refuses the resume. Nothing changes.
        actAs(RUN_B);
        const foreign = realAdmin();
        await assert.rejects(() => cleanup(foreign, a), refusedAt('save_journal_resume:account_save_obligations'));
        assert.deepEqual(foreign.steps, [RESUME_FN], 'refused at the resume: no delete was attempted');
        // Nor a re-run attempt of the same run (another attempt is another owner), nor a local run that binds nothing.
        for (const other of [{ ...RUN_A, runAttempt: '2' }, null]) {
          actAs(other);
          await assert.rejects(() => cleanup(realAdmin(), a), refusedAt('save_journal_resume:account_save_obligations'), JSON.stringify(other));
        }
        assert.deepEqual([journalSnapshot(a), claimToken(a), claimRows(a)], [before, token, 1], 'rows, claim and its secret untouched');

        // THE SAME RUN restarts: it finishes its own cleanup through the shared step. Rows gone, claim gone, verdict written.
        actAs(RUN_A);
        const restarted = realAdmin();
        const lines = [], con = globalThis.console, log = con.log; con.log = (...x) => { lines.push(x.join(' ')); };
        try { assert.equal(await cleanup(restarted, a), a.user); } finally { con.log = log; }
        assert.deepEqual(restarted.steps, [RESUME_FN, DELETE_FN, COUNT_FN], 'resume with a fresh secret, delete, independent readback; no second Auth deletion');
        assert.deepEqual([journalRows(a), claimRows(a)], [0, 0]);
        assert.deepEqual(lines.filter(l => /^RUN_(OWNED_CLEANUP|SAVE_JOURNAL_RESUME)/.test(l)),
          ['RUN_SAVE_JOURNAL_RESUME claim=resumed', `RUN_OWNED_CLEANUP cleanup_verified residue=0 tables_verified=${RESIDUE_CHECKS.length + 2}`]);
        assert.ok(!lines.some(l => l.includes(a.user) || l.includes(a.email)), 'no uid or address in the log');

        // A second restart after it finished: no claim is left, so nothing is deleted and only the zero readback passes.
        const again = realAdmin();
        assert.equal(await cleanup(again, a), a.user);
        assert.deepEqual(again.steps, [RESUME_FN, COUNT_FN]);
        receipts.push({ case: 'restart_after_auth_deletion', rowsLeftByCrash: 2, foreignRunRefused: true, otherAttemptRefused: true,
          localRunRefused: true, ownerRestartRowsAfter: 0, claimAfter: 0, residueTablesOutsideFixture: [...outsideFixture].sort() });
      } finally { restoreEnv(); }
    });

    await t.test('RESTART: a crash at any earlier step is finished the ordinary way (the account still exists, so it is claimed again)', async () => {
      try {
        actAs(RUN_A);
        for (const crash of [CLAIM_FN, 'pre_delete:trial_entitlements']) {
          const a = seed({ ct_run: RUN_A }); savedTake(a);
          await assert.rejects(() => cleanup(realAdmin({ crash }), a), /SIMULATED_CRASH/);
          assert.equal(authExists(a), true, crash);
          const restarted = realAdmin();
          assert.equal(await cleanup(restarted, a), a.user, crash);
          assert.deepEqual(restarted.steps, [CLAIM_FN, 'pre_delete:trial_entitlements', 'deleteUser', DELETE_FN, COUNT_FN], crash);
          assert.deepEqual([authExists(a), journalRows(a), claimRows(a)], [false, 0, 0], crash);
        }
        // And a crash after the journal delete itself (claim already dropped, verdict never written): the restart passes on the readback.
        const a = seed({ ct_run: RUN_A }); savedTake(a);
        await assert.rejects(() => cleanup(realAdmin({ crash: DELETE_FN }), a), /SIMULATED_CRASH/);
        assert.deepEqual([authExists(a), journalRows(a), claimRows(a)], [false, 0, 0]);
        const restarted = realAdmin();
        assert.equal(await cleanup(restarted, a), a.user);
        assert.deepEqual(restarted.steps, [RESUME_FN, COUNT_FN]);
      } finally { restoreEnv(); }
    });

    await t.test('RESUME in the database: only after deletion, only for the claim\'s own binding and address, never an unbound claim', async () => {
      const a = seed({ ct_run: RUN_A }); savedTake(a);
      const first = newSaveJournalSecret(), fresh = newSaveJournalSecret();
      sql(claimSql(a, RUN_A, first));
      assert.throws(() => sql(resumeSql(a, RUN_A, fresh)), /account still exists/, 'a live account is never resumed');
      deleteAuth(a);
      const token = claimToken(a);
      for (const [binding, email, why] of [[RUN_B, a.email, 'another run'], [{ ...RUN_A, runAttempt: '2' }, a.email, 'another attempt'],
        [{ ...RUN_A, extra: '1' }, a.email, 'an extra key'], [null, a.email, 'no binding'], [CANARY, a.email, 'the canary binding'],
        [RUN_A, 'rwt-journey-someone-else@example.test', 'another address'], [RUN_A, null, 'no address']])
        assert.throws(() => sql(resumeSql(a, binding, fresh, email)), /not claimed by this run/, why);
      for (const bad of [null, '', 'A'.repeat(64), 'a'.repeat(63)]) assert.throws(() => sql(resumeSql(a, RUN_A, bad)), /cleanup secret required/, String(bad));
      assert.throws(() => sql(service(fnCall(RESUME_FN, { p_user_id: null, p_email: a.email, p_run_binding: RUN_A, p_token: fresh }))), /account id required/);
      assert.equal(claimToken(a), token, 'every refusal left the claim\'s secret as it was');
      assert.throws(() => sql(resumeSql({ user: 'c9290000-0000-4000-8000-000000000001', email: a.email }, RUN_A, fresh)), /no cleanup claim/);
      // The address is compared case-insensitively, as the claim recorded it.
      sql(resumeSql(a, RUN_A, fresh, a.email.toUpperCase()));
      assert.throws(() => sql(deleteSql(a, first)), /not claimed by this run/, 'the lost secret no longer deletes');
      assert.equal(sql(deleteSql(a, fresh)), '0');
      assert.deepEqual([journalRows(a), claimRows(a)], [0, 0]);
      // An UNBOUND claim (a local run) is never resumable: its only proof was the secret the crash lost.
      const u = seed({}); savedTake(u); u.secret = newSaveJournalSecret(); sql(claimSql(u, null, u.secret)); deleteAuth(u);
      for (const binding of [null, RUN_A]) assert.throws(() => sql(resumeSql(u, binding, fresh)), /not claimed by this run/);
      assert.equal(journalRows(u), 1);
      await assert.rejects(() => resumeSaveJournalCleanup(serviceRpc, u.user, u.email, null, fresh), refusedAt('save_journal_resume:account_save_obligations'));
      await assert.rejects(() => resumeSaveJournalCleanup({}, u.user, u.email, null, fresh), refusedAt('save_journal_resume:account_save_obligations'));
      // A CANARY claim resumes only with its canary binding.
      const c = seed({ canary_run: CANARY }, 'ctrial-run-'); savedTake(c); c.secret = newSaveJournalSecret(); sql(claimSql(c, CANARY, c.secret)); deleteAuth(c);
      assert.throws(() => sql(resumeSql(c, RUN_A, fresh)), /not claimed by this run/);
      sql(resumeSql(c, CANARY, fresh)); assert.equal(sql(deleteSql(c, fresh)), '0');
      // Serialized like the delete: it waits on the per-account closure lock.
      const w = seed({ ct_run: RUN_A }); savedTake(w); w.secret = newSaveJournalSecret(); sql(claimSql(w, RUN_A, w.secret)); deleteAuth(w);
      const hname = `resume_holder_${index}`, wname = `resume_waiter_${index}`;
      const holder = client(hname, `BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('account-billing:${w.user}',0));`, true);
      await waitFor(() => idle(hname));
      const waiter = client(wname, resumeSql(w, RUN_A, fresh) + ';'); await waitFor(() => blocked(wname, hname));
      holder.child.stdin.end('COMMIT;\n');
      const h = await holder.done, r = await waiter.done;
      assert.equal(h.code, 0, h.stderr); assert.equal(r.code, 0, r.stderr);
      assert.equal(sql(deleteSql(w, fresh)), '0');
      receipts.push({ case: 'resume_refusals', refusedBindings: 5, refusedAddresses: 2, unboundRefused: true, lockObserved: true });
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
