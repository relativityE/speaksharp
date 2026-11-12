// Native, owned disposable PostgreSQL. No hosted database, provider, or model calls.
// #1643 missing-Start abandonment: actual recording, admission and completion-journal migrations, then the candidate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { completionBootstrap, recordingChain } from './account-completion-fixture.mjs';

const journal = 'backend/supabase/migrations/20261020230653_account_pending_completion_journal_1643.sql';
const candidate = 'backend/supabase/migrations/20261112133000_recording_start_abandonment_1643.sql';
const scope = 'a'.repeat(64);
const service = text => `SET ROLE service_role; ${text}`;
const as = (a, text) => `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${a.user}',false); ${text}`;
const acquire = a => as(a, `SELECT acquire_recording_lease('${a.lease}','synthetic',false)`);
const release = a => as(a, `SELECT release_recording_lease('${a.lease}')`);
const abandon = (a, lease = a.lease) => as(a, `SELECT abandon_recording_start_v1('${lease}')`);
const create = (a, lease = a.lease) => as(a, `SELECT create_session_and_update_usage('{"title":"synthetic","duration":0${lease ? `,"lease_id":"${lease}"` : ''}}'::jsonb,'private')`);

test('missing-Start abandonment: proven no-take cancellation, permanent fence, serialized with admission', async t => {
  const root = mkdtempSync(join(tmpdir(), 'start-abandonment-'));
  const data = join(root, 'data'), socket = join(root, 'socket'); mkdirSync(socket);
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('PG'))),
    PGHOST: socket, PGPORT: '5432', PGUSER: 'abandonment_fixture_admin', PGDATABASE: 'postgres' };
  const args = ['-h', socket, '-p', '5432', '-U', env.PGUSER, '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
  // Large bootstrap text goes over stdin (one argument is capped by the OS); everything else is one -c command.
  const sql = text => (text.length > 64_000
    ? execFileSync('psql', [...args, '-1', '-f', '-'], { env, encoding: 'utf8', timeout: 60000, input: text, stdio: ['pipe', 'pipe', 'pipe'] })
    : execFileSync('psql', [...args, '-c', text], { env, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] })).trim();
  const json = text => { const value = sql(text).split('\n').at(-1); return value ? JSON.parse(value) : null; };
  const clients = [], receipts = []; let started = false, index = 0;
  const phase = a => sql(`SELECT coalesce((SELECT phase FROM account_save_obligations WHERE user_id='${a.user}' AND lease_id='${a.lease}'),'none')`);
  const abandoned = a => sql(`SELECT count(*) FROM recording_start_abandonments WHERE user_id='${a.user}' AND lease_id='${a.lease}'`);
  const leaseRows = a => sql(`SELECT count(*) FROM active_recording_lease WHERE user_id='${a.user}'`);
  const sessions = a => sql(`SELECT count(*) FROM sessions WHERE user_id='${a.user}'`);
  function seed() {
    const suffix = String(++index).padStart(12, '0');
    const a = { user: `b9110000-0000-4000-8000-${suffix}`, lease: `b9120000-0000-4000-8000-${suffix}`, hash: String(index).padStart(64, 'a') };
    sql(`INSERT INTO auth.users VALUES('${a.user}','abandonment-${index}@example.test',now());
      UPDATE user_profiles SET subscription_status='pro',stripe_customer_id='cus_abandon_${index}' WHERE id='${a.user}';
      SET ROLE service_role; SELECT issue_account_closure_pending_token('${a.user}','${a.hash}');`);
    a.request = sql(`SELECT request_id FROM account_closure_tokens WHERE user_id='${a.user}'`);
    return a;
  }
  const pendingClaim = a => {
    assert.ok(json(service(`SELECT begin_account_closure_pending('${a.user}','${a.hash}',true)`)), 'pending began');
    sql(`INSERT INTO account_completion_coverage VALUES('${a.user}','${a.request}','${scope}',
      'synthetic fixture legacy coverage; not production proof','synthetic fixture portal settlement; not provider proof')`);
    const h = 'c' + a.hash.slice(1);
    assert.ok(json(service(`SELECT issue_account_completion_status_v1('${a.user}','${a.request}','${scope}','${h}')`))?.requestId);
    assert.equal(sql(service(`SELECT acknowledge_account_completion_status_v1('${a.user}','${a.request}','${scope}','${h}')`)), 't');
    return json(service(`SELECT claim_account_pending_completion_v1('${a.user}','${a.request}','${scope}')`));
  };
  function client(name, text, hold = false) {
    const child = spawn('psql', args, { env: { ...env, PGAPPNAME: name }, stdio: ['pipe', 'pipe', 'pipe'] });
    const c = { child, stdout: '', stderr: '', exited: false }; clients.push(c);
    child.stdout.on('data', x => { c.stdout += x; }); child.stderr.on('data', x => { c.stderr += x; });
    c.done = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => { c.exited = true; resolve({ code, stdout: c.stdout, stderr: c.stderr }); }); });
    if (hold) child.stdin.write(text + '\n'); else child.stdin.end(text + '\n'); return c;
  }
  async function waitFor(fn) { const end = Date.now() + 5000; while (Date.now() < end) { if (fn()) return; await delay(20); } throw Error('required native lock barrier absent'); }
  const idle = name => sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND state='idle in transaction')`) === 't';
  const blocked = (w, h) => sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${w}'
    AND (SELECT pid FROM pg_stat_activity WHERE application_name='${h}')=ANY(pg_blocking_pids(pid)))`) === 't';
  const last = out => out.trim().split('\n').at(-1);
  try {
    execFileSync('initdb', ['-D', data, '-U', env.PGUSER, '-A', 'trust', '--no-locale', '--encoding=UTF8'], { encoding: 'utf8' });
    execFileSync('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-w', 'start', '-o',
      `-F -k ${socket} -h '' -p 5432 -c max_connections=12 -c shared_buffers=16MB -c deadlock_timeout=100ms`], { encoding: 'utf8' });
    started = true; assert.equal(sql("SELECT current_setting('data_directory')"), data);
    sql(completionBootstrap());
    sql(readFileSync(journal, 'utf8'));
    sql(`UPDATE account_completion_configuration SET enabled=true,scope_digest='${scope}'`);

    await t.test('prior-source reproduction: a lease with no take is admitted debt that release never settles', () => {
      const a = seed();
      assert.equal(json(acquire(a)).acquired, true);
      assert.equal(json(release(a)).released, true);
      assert.equal(phase(a), 'admitted');
      assert.deepEqual(pendingClaim(a), { outcome: 'pending' });
      assert.throws(() => sql(`DELETE FROM auth.users WHERE id='${a.user}'`), /admitted save unsettled/);
      assert.throws(() => sql(abandon(a)), /abandon_recording_start_v1/);
    });

    sql(readFileSync(candidate, 'utf8'));

    await t.test('access: journal and record stay closed to every role; only authenticated may call the RPC', () => {
      for (const role of ['anon', 'authenticated', 'service_role']) for (const table of ['recording_start_abandonments', 'account_save_obligations']) {
        for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) assert.equal(sql(`SELECT has_table_privilege('${role}','${table}','${privilege}')`), 'f', `${role} ${table} ${privilege}`);
        assert.equal(sql(`SELECT relrowsecurity FROM pg_class WHERE oid='${table}'::regclass`), 't');
      }
      for (const [role, allowed] of [['anon', 'f'], ['authenticated', 't'], ['service_role', 'f'], ['public', 'f']])
        assert.equal(sql(`SELECT has_function_privilege('${role}','abandon_recording_start_v1(uuid)','EXECUTE')`), allowed, role);
      assert.equal(sql(`SELECT prosecdef FROM pg_proc WHERE oid='abandon_recording_start_v1(uuid)'::regprocedure`), 't');
      assert.equal(sql(`SELECT proconfig::text FROM pg_proc WHERE oid='abandon_recording_start_v1(uuid)'::regprocedure`), '{"search_path=\\"\\""}');
      assert.throws(() => sql(service(`SELECT abandon_recording_start_v1(gen_random_uuid())`)), /permission denied/);
    });

    await t.test('released no-take lease: explicit terminal non-saved outcome settles the debt; nothing is marked completed', () => {
      const a = seed();
      json(acquire(a)); json(release(a));
      assert.deepEqual(pendingClaim(a), { outcome: 'pending' });
      assert.deepEqual(json(abandon(a)), { abandoned: true, outcome: 'abandoned_not_recorded', repeated: false });
      assert.equal(phase(a), 'none');
      assert.equal(abandoned(a), '1');
      assert.equal(sql(`SELECT outcome FROM recording_start_abandonments WHERE user_id='${a.user}'`), 'abandoned_not_recorded');
      assert.equal(sql(`SELECT count(*) FROM account_save_obligations WHERE user_id='${a.user}' AND phase='completed'`), '0');
      assert.equal(sessions(a), '0', 'no dummy session or take is inserted');
      assert.ok(json(service(`SELECT claim_account_pending_completion_v1('${a.user}','${a.request}','${scope}')`))?.executionId);
    });

    await t.test('held (live) no-take lease: cancellation removes it and fences create, reacquire and every bind path', () => {
      const a = seed();
      json(acquire(a)); assert.equal(leaseRows(a), '1');
      assert.equal(json(abandon(a)).abandoned, true);
      assert.equal(leaseRows(a), '0');
      assert.equal(json(as(a, `SELECT heartbeat_recording_lease('${a.lease}')`)).valid, false);
      assert.equal(json(create(a)).error, 'lease_not_held');
      assert.throws(() => sql(acquire(a)), /abandoned recording identity cannot be reused/);
      assert.equal(leaseRows(a), '0');
      // An active take is already refused by the #1476 insert fence (the lease is gone) ...
      assert.throws(() => sql(`INSERT INTO sessions(id,user_id,lease_id,status) VALUES(gen_random_uuid(),'${a.user}','${a.lease}','active')`), /lease_not_held/);
      // ... and any other row that would bind the identity (current lease, or legacy implicit id), even from a writer
      // that skips the RPCs and the active-take fence, is refused by the journal fence.
      for (const status of ['failed', 'completed']) {
        assert.throws(() => sql(`INSERT INTO sessions(id,user_id,lease_id,status) VALUES(gen_random_uuid(),'${a.user}','${a.lease}','${status}')`), /abandoned recording identity cannot be bound/);
        assert.throws(() => sql(`INSERT INTO sessions(id,user_id,status) VALUES('${a.lease}','${a.user}','${status}')`), /abandoned recording identity cannot be bound/);
      }
      assert.equal(sessions(a), '0'); assert.equal(phase(a), 'none'); assert.equal(abandoned(a), '1');
      // A new Start with a new identity is unaffected.
      const next = { ...a, lease: a.lease.replace('b912', 'b913') };
      assert.equal(json(acquire(next)).acquired, true);
      assert.ok(json(create(next)).new_session?.id);
    });

    await t.test('repeated cancellation is idempotent and changes nothing', () => {
      const a = seed(); json(acquire(a));
      assert.equal(json(abandon(a)).repeated, false);
      assert.deepEqual(json(abandon(a)), { abandoned: true, outcome: 'abandoned_not_recorded', repeated: true });
      assert.equal(abandoned(a), '1'); assert.equal(phase(a), 'none');
    });

    await t.test('refused when a take exists: active, released, saved, failed and legacy implicit takes keep their journal row', () => {
      const a = seed(); json(acquire(a));
      const id = json(create(a)).new_session.id;
      assert.deepEqual(json(abandon(a)), { abandoned: false, reason: 'take_exists' });
      json(release(a));
      assert.deepEqual(json(abandon(a)), { abandoned: false, reason: 'take_exists' });
      assert.equal(phase(a), 'admitted'); assert.equal(abandoned(a), '0');
      assert.equal(json(as(a, `SELECT complete_session_v2('${id}','completed',30,NULL,'{"kind":"synthetic-control"}'::jsonb,3,70,6,'{}'::jsonb,'{}'::jsonb,'saved synthetic take')`)).success, true);
      assert.equal(phase(a), 'completed');
      assert.deepEqual(json(abandon(a)), { abandoned: false, reason: 'take_exists' });
      assert.equal(phase(a), 'completed');
      // Old client: no lease sent, implicit identity is the new session id.
      const legacy = seed();
      const legacyId = json(create(legacy, null)).new_session.id;
      assert.equal(sql(`SELECT phase FROM account_save_obligations WHERE user_id='${legacy.user}' AND lease_id='${legacyId}'`), 'admitted');
      assert.deepEqual(json(abandon(legacy, legacyId)), { abandoned: false, reason: 'take_exists' });
      assert.equal(sql(`SELECT phase FROM account_save_obligations WHERE user_id='${legacy.user}' AND lease_id='${legacyId}'`), 'admitted');
    });

    await t.test('wrong user, wrong identity, unauthenticated and unknown identities are refused without effect', () => {
      const a = seed(), b = seed(); json(acquire(a));
      assert.deepEqual(json(abandon(b, a.lease)), { abandoned: false, reason: 'unknown_identity' });
      assert.deepEqual(json(abandon(a, b.lease)), { abandoned: false, reason: 'unknown_identity' });
      assert.deepEqual(json(`SET ROLE authenticated; SELECT abandon_recording_start_v1('${a.lease}')`), { abandoned: false, reason: 'unauthenticated' });
      assert.equal(json(as(a, 'SELECT abandon_recording_start_v1(NULL)')).reason, 'unknown_identity');
      assert.equal(phase(a), 'admitted'); assert.equal(leaseRows(a), '1'); assert.equal(abandoned(a), '0');
      assert.equal(sql(`SELECT count(*) FROM recording_start_abandonments WHERE user_id='${b.user}'`), '0');
      // Another account's session carrying this id as its lease is uncertainty, not proof of absence.
      const c = seed(); json(acquire(c)); json(release(c));
      sql(`INSERT INTO sessions(id,user_id,lease_id,status) VALUES(gen_random_uuid(),'${b.user}','${c.lease}','failed')`);
      assert.deepEqual(json(abandon(c)), { abandoned: false, reason: 'take_exists' });
      assert.equal(phase(c), 'admitted');
    });

    await t.test('a settled journal row is never abandoned, even with no bound session (uncertain state is refused)', () => {
      const a = seed(); json(acquire(a)); json(release(a));
      sql(`UPDATE account_save_obligations SET phase='completed' WHERE user_id='${a.user}' AND lease_id='${a.lease}'`);
      assert.deepEqual(json(abandon(a)), { abandoned: false, reason: 'take_exists' });
      assert.equal(phase(a), 'completed'); assert.equal(abandoned(a), '0');
    });

    await t.test('cancellation takes the account row first, in the admission order, and waits for its holder', async () => {
      const a = seed(); json(acquire(a)); json(release(a));
      const hname = `profile_holder_${index}`, wname = `abandon_profile_waiter_${index}`;
      const holder = client(hname, `BEGIN; SELECT 1 FROM user_profiles WHERE id='${a.user}' FOR UPDATE;`, true); await waitFor(() => idle(hname));
      const waiter = client(wname, abandon(a) + ';'); await waitFor(() => blocked(wname, hname));
      assert.equal(abandoned(a), '0');
      holder.child.stdin.end('COMMIT;\n');
      const h = await holder.done, w = await waiter.done; receipts.push({ order: 'profile-holder-then-abandon', observedBlock: true, holder: h, waiter: w });
      assert.equal(h.code, 0, h.stderr); assert.equal(w.code, 0, w.stderr);
      assert.equal(JSON.parse(last(w.stdout)).abandoned, true); assert.equal(abandoned(a), '1');
    });

    for (const commit of [false, true]) await t.test(`order: session creation first, then cancellation (creation ${commit ? 'commits' : 'rolls back'})`, async () => {
      const a = seed(); json(acquire(a));
      const hname = `create_holder_${index}`, wname = `abandon_waiter_${index}`;
      const holder = client(hname, `BEGIN; ${create(a)};`, true); await waitFor(() => idle(hname));
      const waiter = client(wname, abandon(a) + ';'); await waitFor(() => blocked(wname, hname));
      holder.child.stdin.end(`${commit ? 'COMMIT' : 'ROLLBACK'};\n`);
      const h = await holder.done, w = await waiter.done; receipts.push({ order: 'create-then-abandon', commit, observedBlock: true, holder: h, waiter: w });
      assert.equal(h.code, 0, h.stderr); assert.equal(w.code, 0, w.stderr);
      const answer = JSON.parse(last(w.stdout));
      if (commit) {
        assert.deepEqual(answer, { abandoned: false, reason: 'take_exists' });
        assert.equal(sessions(a), '1'); assert.equal(phase(a), 'admitted'); assert.equal(abandoned(a), '0');
      } else {
        assert.equal(answer.abandoned, true);
        assert.equal(sessions(a), '0'); assert.equal(phase(a), 'none'); assert.equal(abandoned(a), '1');
      }
    });

    for (const commit of [false, true]) await t.test(`order: cancellation first, then admitted session creation (cancellation ${commit ? 'commits' : 'rolls back'})`, async () => {
      const a = seed(); json(acquire(a));
      const hname = `abandon_holder_${index}`, wname = `create_waiter_${index}`;
      const holder = client(hname, `BEGIN; ${abandon(a)};`, true); await waitFor(() => idle(hname));
      const waiter = client(wname, create(a) + ';'); await waitFor(() => blocked(wname, hname));
      holder.child.stdin.end(`${commit ? 'COMMIT' : 'ROLLBACK'};\n`);
      const h = await holder.done, w = await waiter.done; receipts.push({ order: 'abandon-then-create', commit, observedBlock: true, holder: h, waiter: w });
      assert.equal(h.code, 0, h.stderr); assert.equal(w.code, 0, w.stderr);
      const answer = JSON.parse(last(w.stdout));
      if (commit) {
        assert.equal(answer.error, 'lease_not_held'); assert.equal(answer.new_session, null);
        assert.equal(sessions(a), '0'); assert.equal(phase(a), 'none'); assert.equal(abandoned(a), '1');
      } else {
        assert.ok(answer.new_session?.id);
        assert.equal(sessions(a), '1'); assert.equal(phase(a), 'admitted'); assert.equal(abandoned(a), '0');
      }
    });

    // A delayed write that reaches the journal without the profile/recording locks (any session writer, old or new)
    // still serializes on the admitted journal row and is refused after a committed cancellation.
    for (const commit of [false, true]) await t.test(`delayed admitted write racing cancellation (cancellation ${commit ? 'commits' : 'rolls back'})`, async () => {
      const a = seed(); json(acquire(a));
      const hname = `abandon_row_holder_${index}`, wname = `late_writer_${index}`;
      const holder = client(hname, `BEGIN; ${abandon(a)};`, true); await waitFor(() => idle(hname));
      const waiter = client(wname, `INSERT INTO sessions(id,user_id,lease_id,status) VALUES(gen_random_uuid(),'${a.user}','${a.lease}','active');`);
      await waitFor(() => blocked(wname, hname));
      holder.child.stdin.end(`${commit ? 'COMMIT' : 'ROLLBACK'};\n`);
      const h = await holder.done, w = await waiter.done; receipts.push({ order: 'abandon-then-late-write', commit, observedBlock: true, holder: h, waiter: w });
      assert.equal(h.code, 0, h.stderr);
      if (commit) {
        assert.notEqual(w.code, 0); assert.match(w.stderr, /abandoned recording identity cannot be bound/);
        assert.equal(sessions(a), '0'); assert.equal(phase(a), 'none'); assert.equal(abandoned(a), '1');
      } else {
        assert.equal(w.code, 0, w.stderr);
        assert.equal(sessions(a), '1'); assert.equal(phase(a), 'admitted'); assert.equal(abandoned(a), '0');
      }
    });

    for (const commit of [false, true]) await t.test(`late write first, then cancellation (write ${commit ? 'commits' : 'rolls back'})`, async () => {
      const a = seed(); json(acquire(a));
      const hname = `late_holder_${index}`, wname = `abandon_late_waiter_${index}`;
      const holder = client(hname, `BEGIN; INSERT INTO sessions(id,user_id,lease_id,status) VALUES(gen_random_uuid(),'${a.user}','${a.lease}','active');`, true);
      await waitFor(() => idle(hname));
      const waiter = client(wname, abandon(a) + ';'); await waitFor(() => blocked(wname, hname));
      holder.child.stdin.end(`${commit ? 'COMMIT' : 'ROLLBACK'};\n`);
      const h = await holder.done, w = await waiter.done; receipts.push({ order: 'late-write-then-abandon', commit, observedBlock: true, holder: h, waiter: w });
      assert.equal(h.code, 0, h.stderr); assert.equal(w.code, 0, w.stderr);
      const answer = JSON.parse(last(w.stdout));
      if (commit) { assert.deepEqual(answer, { abandoned: false, reason: 'take_exists' }); assert.equal(phase(a), 'admitted'); }
      else { assert.equal(answer.abandoned, true); assert.equal(phase(a), 'none'); }
    });

    await t.test('the record is removed with the account; abandonment never blocks or replaces account deletion', () => {
      const a = seed(); json(acquire(a)); json(abandon(a));
      sql(`DELETE FROM auth.users WHERE id='${a.user}'`);
      assert.equal(abandoned(a), '0');
    });
  } finally {
    for (const c of clients) if (!c.child.stdin.destroyed) c.child.stdin.end();
    if (started) execFileSync('pg_ctl', ['-D', data, '-w', 'stop', '-m', 'immediate'], { encoding: 'utf8' });
    await Promise.allSettled(clients.map(c => c.done));
    mkdirSync('artifacts/recording-start-abandonment', { recursive: true });
    const files = [candidate, journal, 'tests/db/recording-start-abandonment-realpg.mjs', ...recordingChain.map(x => 'backend/supabase/migrations/' + x)];
    writeFileSync('artifacts/recording-start-abandonment/receipts.json', JSON.stringify({ createdAt: new Date().toISOString(),
      databaseStarted: started, qualification: 'Inspect TAP exit and participant results; this artifact alone is not a PASS',
      boundary: 'owned disposable PostgreSQL only; actual recording/admission/completion-journal migrations; declared signup/storage/usage fixtures; no hosted/provider calls',
      hashes: Object.fromEntries(files.map(f => [f, createHash('sha256').update(readFileSync(f)).digest('hex')])), receipts }, null, 2) + '\n');
    rmSync(root, { recursive: true, force: true });
  }
});
