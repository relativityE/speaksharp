// Owned disposable native PostgreSQL. Two actual RPC clients, no provider/live DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { pendingBootstrap } from './account-closure-pending-fixture.mjs';

test('native pending successor: actual chain, canonical trigger, and admission races', async t => {
  const root = mkdtempSync(join(tmpdir(), 'closure-pending-'));
  const data = join(root, 'data'); const socket = join(root, 'socket'); mkdirSync(socket);
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG'))),
    PGHOST: socket, PGPORT: '5432', PGUSER: 'pending_test_admin', PGDATABASE: 'postgres' };
  const args = ['-h', socket, '-p', '5432', '-U', env.PGUSER, '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
  const sql = text => execFileSync('psql', [...args, '-c', text], { env, encoding: 'utf8', timeout: 10_000 }).trim();
  const clients = [];
  function client(name, text, hold = false) {
    const child = spawn('psql', args, { env: { ...env, PGAPPNAME: name }, stdio: ['pipe', 'pipe', 'pipe'] });
    const state = { stdout: '', stderr: '', child, done: null };
    child.stdout.on('data', chunk => { state.stdout += chunk; });
    child.stderr.on('data', chunk => { state.stderr += chunk; });
    state.done = new Promise((resolve, reject) => {
      child.on('error', reject); child.on('close', code => resolve({ code, stdout: state.stdout, stderr: state.stderr }));
    });
    if (hold) child.stdin.write(text + '\n'); else child.stdin.end(text + '\n');
    clients.push(state); return state;
  }
  async function waitFor(predicate) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) { if (predicate()) return; await delay(20); }
    throw new Error('required native lock barrier not observed');
  }
  let started = false;
  try {
    execFileSync('initdb', ['-D', data, '-U', env.PGUSER, '-A', 'trust', '--no-locale', '--encoding=UTF8'], { encoding: 'utf8' });
    execFileSync('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-w', 'start', '-o',
      `-F -k ${socket} -h '' -p 5432 -c max_connections=10`], { encoding: 'utf8' });
    started = true; assert.equal(sql("SELECT current_setting('data_directory')"), data);
    sql(pendingBootstrap());
    await t.test('actual pending invariant SQL rolls back and leaves destruction disabled', () => {
      assert.match(sql(readFileSync('tests/db/account-closure-pending-invariants.sql', 'utf8')), /ACCOUNT CLOSURE PENDING INVARIANTS PASSED/);
      assert.equal(sql('SELECT count(*) FROM auth.users'), '0');
      assert.equal(sql('SELECT checkout_workers_drained FROM account_billing_coordination'), 'f');
    });
    await t.test('retains the existing enforced Auth-unknown, billing, trial and residue controls after the successor', () => {
      sql('ALTER TABLE auth.users ADD COLUMN raw_app_meta_data jsonb, ADD COLUMN raw_user_meta_data jsonb');
      assert.match(sql(readFileSync('tests/db/account-closure-enforcement-full-chain.sql', 'utf8')),
        /ACCOUNT CLOSURE ENFORCEMENT FULL-CHAIN INVARIANTS PASSED/);
      assert.equal(sql('SELECT count(*) FROM auth.users'), '0');
      assert.equal(sql('SELECT checkout_workers_drained FROM account_billing_coordination'), 'f');
    });
    for (const [index, winner] of ['admission', 'pending'].entries()) {
      await t.test(`${winner} wins the actual two-client transaction race`, async () => {
        const user = `a7010000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
        const hash = String(index + 1).repeat(64);
        sql(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${user}','race-${index}@example.test',now());
          SET ROLE service_role; SELECT issue_account_closure_pending_token('${user}','${hash}');`);
        const admit = `SELECT begin_account_checkout('${user}')`;
        const confirm = `SELECT begin_account_closure_pending('${user}','${hash}',true)`;
        const holderName = `pending_winner_${index}`; const loserName = `pending_waiter_${index}`;
        const holder = client(holderName, `BEGIN; SET LOCAL ROLE service_role; ${winner === 'admission' ? admit : confirm};`, true);
        await waitFor(() => sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${holderName}' AND state='idle in transaction')`) === 't');
        const waiter = client(loserName, `SET ROLE service_role; ${winner === 'admission' ? confirm : admit};`);
        await waitFor(() => sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity w WHERE application_name='${loserName}'
          AND (SELECT pid FROM pg_stat_activity WHERE application_name='${holderName}')=ANY(pg_blocking_pids(w.pid)))`) === 't');
        holder.child.stdin.end('COMMIT;\n');
        const committed = await holder.done; assert.equal(committed.code, 0, committed.stderr);
        const resumed = await waiter.done;
        if (winner === 'admission') {
          assert.equal(resumed.code, 0, resumed.stderr);
          assert.equal(sql(`SELECT count(*) FROM account_checkout_operations WHERE user_id='${user}' AND closure_request_id IS NOT NULL`), '1');
        } else {
          assert.notEqual(resumed.code, 0); assert.match(resumed.stderr, /billing operation pending/);
          assert.equal(sql(`SELECT count(*) FROM account_checkout_operations WHERE user_id='${user}'`), '0');
        }
        assert.equal(sql(`SELECT phase FROM account_closure_attempts WHERE user_id='${user}'`), 'pending');
      });
    }
    await t.test('expired verification after a real profile-lock wait cannot establish pending', async () => {
      const user = 'a7020000-0000-4000-8000-000000000001'; const hash = '9'.repeat(64);
      sql(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${user}','expiry-race@example.test',now());
        SET ROLE service_role; SELECT issue_account_closure_pending_token('${user}','${hash}');`);
      const holder = client('expiry_holder', `BEGIN; SELECT 1 FROM user_profiles WHERE id='${user}' FOR UPDATE;`, true);
      await waitFor(() => sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='expiry_holder' AND state='idle in transaction')") === 't');
      const waiter = client('expiry_waiter', `SET ROLE service_role; SELECT begin_account_closure_pending('${user}','${hash}',true)`);
      await waitFor(() => sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='expiry_waiter' AND wait_event_type='Lock')") === 't');
      holder.child.stdin.end(`UPDATE account_closure_tokens SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id='${user}'; COMMIT;\n`);
      assert.equal((await holder.done).code, 0); assert.equal((await waiter.done).code, 0);
      assert.equal(sql(`SELECT count(*) FROM account_closure_attempts WHERE user_id='${user}'`), '0');
      assert.equal(sql(`SELECT phase FROM account_closure_tokens WHERE user_id='${user}'`), 'issued');
    });
  } finally {
    for (const client of clients) client.child.stdin.end();
    if (started) execFileSync('pg_ctl', ['-D', data, '-w', 'stop', '-m', 'immediate'], { encoding: 'utf8' });
    await Promise.allSettled(clients.map(client => client.done));
    rmSync(root, { recursive: true, force: true });
  }
});
