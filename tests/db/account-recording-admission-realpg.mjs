// Real, owned local PostgreSQL; production pending + recording/retention SQL.
// No hosted DB/provider calls. The usage adapter is a declared fixture stub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { pendingBootstrap, closureMigration } from './account-closure-pending-fixture.mjs';

const recordingChain = [
  '20260801000000_sessions_transcript_state.sql',
  '20260803000000_transcript_retention_newest_two.sql',
  '20260731120000_session_progress_evaluations.sql',
  '20260804000000_transcript_retention_converge_on_save.sql',
  '20260805000000_transcript_retention_preflight.sql',
  '20260819120000_complete_session_v2_atomic_retention_1314.sql',
  '20260908120000_transcript_retention_newest_one.sql',
  '20260607040000_active_recording_lease.sql',
  '20260923120000_one_active_engine_per_account_1476.sql',
  '20260926190000_session_product_marker_1258.sql',
];
const candidate = 'backend/supabase/migrations/20261019055102_account_pending_recording_admission_1643.sql';
const as = user => `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${user}',false);`;
const acquire = lease => `SELECT acquire_recording_lease('${lease}','offline-device',false)`;
const pending = (user, hash) => `SET ROLE service_role; SELECT begin_account_closure_pending('${user}','${hash}',true)`;
const receipts = [];

for (const withFix of [false,true]) test(`${withFix ? 'successor' : 'prior-source reproduction'}: actual RPCs, competing locks, preserved admitted completion`, async t => {
  const root = mkdtempSync(join(tmpdir(), 'closure-recording-'));
  const data = join(root, 'data'); const socket = join(root, 'socket'); mkdirSync(socket);
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG'))),
    PGHOST: socket, PGPORT: '5432', PGUSER: 'recording_test_admin', PGDATABASE: 'postgres' };
  const args = ['-h', socket, '-p', '5432', '-U', env.PGUSER, '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
  const sql = text => execFileSync('psql', [...args, '-c', text], { env, encoding: 'utf8', timeout: 10_000 }).trim();
  const json = text => JSON.parse(sql(text).split('\n').at(-1));
  const clients = [];
  function client(name, text, hold = false) {
    const child = spawn('psql', args, { env: { ...env, PGAPPNAME: name }, stdio: ['pipe', 'pipe', 'pipe'] });
    const state = { child, stdout: '', stderr: '', exited: false };
    child.stdout.on('data', chunk => { state.stdout += chunk; });
    child.stderr.on('data', chunk => { state.stderr += chunk; });
    state.done = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', code => { state.exited = true; resolve({ code, stdout: state.stdout, stderr: state.stderr }); });
    });
    if (hold) child.stdin.write(text + '\n'); else child.stdin.end(text + '\n');
    clients.push(state); return state;
  }
  async function waitFor(predicate) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) { if (predicate()) return; await delay(20); }
    throw new Error('required native transaction barrier not observed');
  }
  const blocked = (waiter, holder) => sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity w
    WHERE application_name='${waiter}' AND (SELECT pid FROM pg_stat_activity WHERE application_name='${holder}')=ANY(pg_blocking_pids(w.pid)))`) === 't';
  function seed(index) {
    const user = `b7010000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    const hash = String(index).padStart(64, 'a');
    sql(`INSERT INTO auth.users VALUES('${user}','recording-${index}@example.test',now());
      UPDATE user_profiles SET subscription_status='pro',stripe_customer_id='cus_${index}',stripe_subscription_id='sub_${index}' WHERE id='${user}';
      SET ROLE service_role; SELECT issue_account_closure_pending_token('${user}','${hash}');`);
    return { user, hash, lease: `b7020000-0000-4000-8000-${String(index).padStart(12, '0')}` };
  }
  let started = false;
  try {
    execFileSync('initdb', ['-D', data, '-U', env.PGUSER, '-A', 'trust', '--no-locale', '--encoding=UTF8'], { encoding: 'utf8' });
    execFileSync('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-w', 'start', '-o',
      `-F -k ${socket} -h '' -p 5432 -c max_connections=10`], { encoding: 'utf8' });
    started = true; assert.equal(sql("SELECT current_setting('data_directory')"), data);
    sql(pendingBootstrap());
    // Verbatim current entitlement resolver, not a fake pro-tier answer.
    const entitlement = closureMigration('20260812040000_thirty_day_trial_lifecycle_1282.sql')
      .match(/CREATE OR REPLACE FUNCTION public\.effective_subscription_tier\([\s\S]*?\$\$;/g);
    assert.equal(entitlement?.length, 2);
    sql(`SET ROLE closure_owner; ${entitlement.join('\n')}`);
    sql(`SET ROLE closure_owner;
      ALTER TABLE sessions ALTER COLUMN id SET DEFAULT gen_random_uuid(),
        ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN updated_at timestamptz,
        ADD COLUMN title text, ADD COLUMN transcript text, ADD COLUMN total_words int,
        ADD COLUMN duration int, ADD COLUMN filler_counts jsonb, ADD COLUMN filler_words jsonb,
        ADD COLUMN accuracy double precision, ADD COLUMN ground_truth text, ADD COLUMN engine text,
        ADD COLUMN idempotency_key uuid, ADD COLUMN engine_version text, ADD COLUMN model_name text,
        ADD COLUMN device_type text, ADD COLUMN expires_at timestamptz, ADD COLUMN status text,
        ADD COLUMN next_action_signal jsonb, ADD COLUMN status_reason text,
        ADD COLUMN clarity_score double precision, ADD COLUMN wpm double precision, ADD COLUMN pause_metrics jsonb;
      CREATE TABLE tier_configs(tier_name text PRIMARY KEY,max_concurrent_sessions int);
      INSERT INTO tier_configs VALUES('pro',50),('free',1);
      CREATE TABLE usage_checkpoints(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),session_id uuid,user_id uuid,
        incremental_seconds int,engine_type text,created_at timestamptz DEFAULT now());
      CREATE FUNCTION update_user_usage(int,text,uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"success":true}'::jsonb $$;`);
    for (const file of recordingChain) sql(`SET ROLE closure_owner; ${closureMigration(file)}`);
    sql('SET ROLE closure_owner; SELECT activate_transcript_retention_newest_one()');
    if (withFix) sql(readFileSync(candidate, 'utf8'));
    if (withFix) assert.match(sql(readFileSync('tests/db/account-recording-admission-invariants.sql','utf8')), /ACCOUNT RECORDING ADMISSION INVARIANTS PASSED/);

    for (const [index, winner] of ['pending', 'admission'].entries()) {
      await t.test(`${winner} wins: ${withFix ? 'serialized successor' : 'prior crossing reproduced'}`, async () => {
        const { user, hash, lease } = seed(index + 1);
        const holderName = `recording_holder_${index}`; const waiterName = `recording_waiter_${index}`;
        const holderSQL = winner === 'pending' ? pending(user, hash) : `${as(user)} ${acquire(lease)}`;
        const waiterSQL = winner === 'pending' ? `${as(user)} ${acquire(lease)}` : pending(user, hash);
        const holder = client(holderName, `BEGIN; ${holderSQL};`, true);
        await waitFor(() => sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${holderName}' AND state='idle in transaction')`) === 't');
        const waiter = client(waiterName, waiterSQL + ';');
        await waitFor(() => waiter.exited || blocked(waiterName, holderName));
        const observedBlock = blocked(waiterName, holderName);
        holder.child.stdin.end('COMMIT;\n');
        const h = await holder.done; const w = await waiter.done;
        receipts.push({ source:withFix?'successor':'prior',winner,observedBlock,holder:h,waiter:w });
        assert.equal(h.code, 0, h.stderr); assert.equal(w.code, 0, w.stderr);
        assert.equal(observedBlock, withFix, 'verify actual blocking/crossing, not a sleep or final-row guess');
        const answer = JSON.parse(w.stdout.trim().split('\n').at(-1));
        if (winner === 'pending') {
          assert.equal(answer.acquired, !withFix);
          if (withFix) assert.equal(answer.reason, 'account_closure_pending');
          assert.equal(sql(`SELECT count(*) FROM active_recording_lease WHERE user_id='${user}'`), withFix ? '0' : '1');
        } else {
          assert.equal(answer.phase, 'pending');
          assert.equal(json(`${as(user)} SELECT heartbeat_recording_lease('${lease}')`).valid, true);
        }
        assert.equal(sql(`SELECT phase FROM account_closure_attempts WHERE user_id='${user}'`), 'pending');
      });
    }
    await t.test('pending A does not block unrelated B; admitted A heartbeat/Stop/save/replay remain possible', () => {
      const a = seed(3); const b = seed(4);
      assert.equal(json(`${as(a.user)} ${acquire(a.lease)}`).acquired, true);
      const row = json(`${as(a.user)} SELECT create_session_and_update_usage('{"title":"synthetic","duration":0,"total_words":0,"lease_id":"${a.lease}"}'::jsonb,'private')`);
      assert.ok(row.new_session?.id, JSON.stringify(row));
      assert.equal(json(pending(a.user, a.hash)).phase, 'pending');
      assert.equal(json(`${as(b.user)} ${acquire(b.lease)}`).acquired, true);
      assert.equal(json(`${as(a.user)} SELECT heartbeat_recording_lease('${a.lease}')`).valid, true);
      assert.equal(json(`${as(a.user)} SELECT release_recording_lease('${a.lease}')`).released, true);
      const save = `${as(a.user)} SELECT complete_session_v2('${row.new_session.id}','completed',30,NULL,
        '{"kind":"synthetic-control"}'::jsonb,3,70,6,'{}'::jsonb,'{}'::jsonb,'synthetic saved words')`;
      assert.equal(json(save).success, true); assert.equal(json(save).success, true);
      assert.equal(sql(`SELECT status||':'||transcript FROM sessions WHERE id='${row.new_session.id}'`), 'completed:synthetic saved words');
    });
    if (!withFix) return;
    await t.test('pending refuses same-ID reacquire, forced takeover and the old-client implicit lease', () => {
      const a = seed(5);
      assert.equal(json(`${as(a.user)} ${acquire(a.lease)}`).acquired, true);
      assert.equal(json(pending(a.user,a.hash)).phase, 'pending');
      for (const request of [acquire(a.lease), `SELECT acquire_recording_lease(gen_random_uuid(),'forced',true)`]) {
        assert.deepEqual(json(`${as(a.user)} ${request}`), { acquired: false, reason: 'account_closure_pending' });
      }
      const legacy = seed(6); json(pending(legacy.user,legacy.hash));
      assert.throws(() => sql(`${as(legacy.user)} SELECT create_session_and_update_usage('{"duration":0}'::jsonb,'private')`), /account closure pending/);
      assert.equal(sql(`SELECT count(*) FROM active_recording_lease WHERE user_id='${legacy.user}'`),'0');
      assert.equal(sql(`SELECT count(*) FROM sessions WHERE user_id='${legacy.user}'`),'0');
      assert.equal(sql(`SELECT lease_id FROM active_recording_lease WHERE user_id='${a.user}'`),a.lease);
    });
    await t.test('privileges cannot bypass admission; unauthenticated and missing-profile callers fail closed', () => {
      assert.equal(sql("SELECT has_function_privilege('anon','acquire_recording_lease(uuid,text,boolean)','EXECUTE')"),'f');
      assert.equal(sql("SELECT has_function_privilege('authenticated','_ss_acquire_recording_lease_1476(uuid,text,boolean)','EXECUTE')"),'f');
      assert.equal(sql("SELECT has_function_privilege('service_role','_ss_acquire_recording_lease_1476(uuid,text,boolean)','EXECUTE')"),'f');
      for (const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE']) {
        assert.equal(sql(`SELECT has_table_privilege('authenticated','active_recording_lease','${privilege}')`),'f');
      }
      assert.equal(json("SET ROLE authenticated; SELECT acquire_recording_lease(gen_random_uuid())").reason,'unauthenticated');
      const a=seed(7); sql(`DELETE FROM user_profiles WHERE id='${a.user}'`);
      assert.equal(json(`${as(a.user)} ${acquire(a.lease)}`).reason,'account_unavailable');
      assert.equal(sql(`SELECT count(*) FROM active_recording_lease WHERE user_id='${a.user}'`),'0');
    });
    await t.test('uncommitted pending A never blocks B, and rollback allows A admission', async () => {
      const a=seed(8); const b=seed(9);
      const holder=client('rollback_pending',`BEGIN; ${pending(a.user,a.hash)};`,true);
      await waitFor(()=>sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='rollback_pending' AND state='idle in transaction')")==='t');
      const other=client('independent_b',`${as(b.user)} ${acquire(b.lease)};`);
      await waitFor(()=>other.exited);
      const result=await other.done; assert.equal(result.code,0,result.stderr);
      assert.equal(JSON.parse(result.stdout.trim().split('\n').at(-1)).acquired,true);
      const waiter=client('rollback_waiter',`${as(a.user)} ${acquire(a.lease)};`);
      await waitFor(()=>blocked('rollback_waiter','rollback_pending'));
      holder.child.stdin.end('ROLLBACK;\n');
      assert.equal((await holder.done).code,0);
      const resumed=await waiter.done; assert.equal(resumed.code,0,resumed.stderr);
      assert.equal(JSON.parse(resumed.stdout.trim().split('\n').at(-1)).acquired,true);
      assert.equal(sql(`SELECT count(*) FROM account_closure_attempts WHERE user_id='${a.user}'`),'0');
    });
  } finally {
    for (const c of clients) if (!c.child.stdin.destroyed) c.child.stdin.end();
    if (started) execFileSync('pg_ctl', ['-D', data, '-w', 'stop', '-m', 'immediate'], { encoding: 'utf8' });
    await Promise.allSettled(clients.map(c => c.done));
    rmSync(root, { recursive: true, force: true });
    const evidence='artifacts/account-recording-admission'; mkdirSync(evidence,{recursive:true});
    const digest=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
    writeFileSync(join(evidence,'receipts.json'),JSON.stringify({createdAt:new Date().toISOString(),
      boundary:'selected production pending/recording/retention SQL; local native PostgreSQL; usage adapter stub',
      sourceSha256:Object.fromEntries([candidate,'tests/db/account-recording-admission-realpg.mjs',...recordingChain.map(file=>`backend/supabase/migrations/${file}`)]
        .map(file=>[file,digest(file)])),races:receipts},null,2)+'\n');
  }
});
