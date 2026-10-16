// Isolated PostgreSQL regression, not a Production or provider probe.
// Reuses the scoped SQL fixture and actual migration/RPC source. No full-chain claim.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';
import console from 'node:console';
import { setTimeout } from 'node:timers';

const root = mkdtempSync(join(tmpdir(), 'closure-c-'));
const data = join(root, 'data');
const socket = join(root, 'socket');
mkdirSync(socket);
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG'))),
  PGHOST: socket, PGPORT: '5432', PGUSER: 'closure_test_admin', PGDATABASE: 'postgres' };
const connection = ['-h', socket, '-p', env.PGPORT, '-U', env.PGUSER, '-d', env.PGDATABASE];
const uid = '11111111-1111-4111-8111-111111111111';
const hash = 'a'.repeat(64);
const migration = (name) => readFileSync(resolve('backend/supabase/migrations', name), 'utf8');
const sql = (text) => execFileSync('psql', [...connection, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', text],
  { env, encoding: 'utf8', timeout: 10_000 }).trim();
const clients = [];
function client(name, text) {
  const child = spawn('psql', [...connection, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', text],
    { env: { ...env, PGAPPNAME: name }, stdio: ['ignore', 'pipe', 'pipe'] });
  const done = new Promise((resolveResult, reject) => {
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolveResult({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
  clients.push(done);
  return done;
}
async function waitFor(text) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (sql(text) === 't') return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('concurrency barrier did not reach the required database state');
}
let started = false;
try {
  execFileSync('initdb', ['-D', data, '-U', env.PGUSER, '-A', 'trust', '--no-locale', '--encoding=UTF8'], { encoding: 'utf8' });
  execFileSync('pg_ctl', ['-D', data, '-l', join(root, 'server.log'), '-w', 'start', '-o',
    `-F -k ${socket} -h '' -p 5432 -c deadlock_timeout=100ms -c max_connections=10`], { encoding: 'utf8' });
  started = true;
  assert.equal(sql("SELECT current_setting('data_directory')"), data);
  const fixture = readFileSync('tests/db/account-closure-tokens.integration.test.ts', 'utf8');
  const bootstrap = fixture.match(/await db\.exec\(`\n([\s\S]*?)`\);/);
  assert.ok(bootstrap, 'existing scoped SQL fixture missing');
  sql(bootstrap[1]);
  sql(`SET ROLE closure_owner; ${migration('20260812041600_trial_commercial_grant_on_conflict_1294.sql')}
    CREATE TRIGGER on_auth_user_created_trial_profile AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.ensure_trial_profile_for_new_user(); RESET ROLE;
    INSERT INTO auth.users VALUES ('${uid}','user@example.test',now());`);
  sql(`SET ROLE closure_owner; ${migration('20260812002000_webhook_lifecycle_completeness_1282.sql')}
    ${migration('20261013180000_account_closure_tokens.sql')}
    UPDATE account_billing_coordination SET checkout_workers_drained=true,evidence_reference='isolated-test-only';
    RESET ROLE; SET ROLE service_role; SELECT * FROM issue_account_closure_token('${uid}','${hash}');`);
  // Exercise the actual current canonical snapshot, including its profile-row
  // lock, rather than substituting a test UPDATE for a webhook transaction.
  const canonical = migration('20260812041500_flawless_launch_runtime_convergence_1290.sql')
    .split('-- Usage counters remain content-free telemetry.')[0];
  assert.ok(canonical.includes('CREATE OR REPLACE FUNCTION public.apply_stripe_subscription_snapshot('));
  sql(`SET ROLE closure_owner; ${canonical} RESET ROLE;`);
  sql(`CREATE FUNCTION public.test_webhook_profile_barrier() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.stripe_customer_id IN ('cus_race','cus_checkout_race') THEN
      PERFORM pg_advisory_xact_lock(88001); END IF; RETURN NEW; END; $$;
    CREATE TRIGGER a_account_closure_test_barrier BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION public.test_webhook_profile_barrier();`);

  const checkoutUid = '22222222-2222-4222-8222-222222222222';
  sql(`INSERT INTO auth.users VALUES ('${checkoutUid}','checkout@example.test',now());`);
  const checkoutBarrier = client('checkout_race_barrier', 'SELECT pg_advisory_lock(88001); SELECT pg_sleep(20)');
  await waitFor("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='checkout_race_barrier' AND wait_event='PgSleep')");
  const checkoutWebhook = client('checkout_race_webhook', `SET ROLE service_role;
    SELECT apply_stripe_subscription_snapshot('event_checkout_race','sub_checkout_race','cus_checkout_race',
      'active',true,false,NULL,'${checkoutUid}',NULL);`);
  await waitFor("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='checkout_race_webhook' AND wait_event_type='Lock' AND wait_event='advisory')");
  const checkout = client('checkout_race_reservation', `SET ROLE service_role;
    SELECT begin_account_checkout('${checkoutUid}');`);
  const waitingOnWebhook = `SELECT EXISTS(SELECT 1 FROM pg_stat_activity c
    WHERE c.application_name='checkout_race_reservation' AND c.wait_event_type='Lock'
      AND (SELECT pid FROM pg_stat_activity WHERE application_name='checkout_race_webhook')
        = ANY(pg_blocking_pids(c.pid)))`;
  // Both outcomes are database-observed: correct code waits on the webhook;
  // old code commits a reservation while that same webhook remains paused.
  await waitFor(`${waitingOnWebhook} OR EXISTS(SELECT 1 FROM account_checkout_operations WHERE user_id='${checkoutUid}')`);
  const prematureReservations = sql(`SELECT count(*) FROM account_checkout_operations WHERE user_id='${checkoutUid}'`);
  const observedProfileWait = sql(waitingOnWebhook);
  sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='checkout_race_barrier'");
  await checkoutBarrier;
  const [checkoutWrite, reservation] = await Promise.all([checkoutWebhook, checkout]);
  assert.equal(checkoutWrite.code, 0, checkoutWrite.stderr);
  assert.equal(JSON.parse(checkoutWrite.stdout).success, true, checkoutWrite.stdout);
  assert.equal(prematureReservations, '0', 'checkout reserved while the active webhook still held the profile');
  assert.equal(observedProfileWait, 't', 'checkout must wait on the webhook profile lock');
  assert.notEqual(reservation.code, 0, 'paid account unexpectedly reserved checkout');
  assert.match(reservation.stderr, /existing subscription requires billing management/);
  assert.equal(sql(`SELECT stripe_subscription_id FROM user_profiles WHERE id='${checkoutUid}'`), 'sub_checkout_race');
  assert.equal(sql(`SELECT count(*) FROM account_checkout_operations WHERE user_id='${checkoutUid}'`), '0');

  async function rejectsCheckout(name, userId, message) {
    const rejected = await client(name, `SET ROLE service_role; SELECT begin_account_checkout('${userId}');`);
    assert.notEqual(rejected.code, 0, `${name} unexpectedly reserved checkout`);
    assert.match(rejected.stderr, message);
  }
  const eligibleUid = '33333333-3333-4333-8333-333333333333';
  const missingProfileUid = '44444444-4444-4444-8444-444444444444';
  const closingUid = '55555555-5555-4555-8555-555555555555';
  const missingAccountUid = '66666666-6666-4666-8666-666666666666';
  sql(`INSERT INTO auth.users VALUES
    ('${eligibleUid}','eligible@example.test',now()),
    ('${missingProfileUid}','missing-profile@example.test',now()),
    ('${closingUid}','closing@example.test',now());
    DELETE FROM user_profiles WHERE id='${missingProfileUid}';
    INSERT INTO account_billing_fences(user_id,phase) VALUES('${closingUid}','closing');`);
  const eligible = await client('checkout_eligible', `SET ROLE service_role; SELECT begin_account_checkout('${eligibleUid}');`);
  assert.equal(eligible.code, 0, eligible.stderr);
  assert.match(eligible.stdout, /^[0-9a-f-]{36}$/);
  assert.equal(sql(`SELECT count(*) FROM account_checkout_operations WHERE user_id='${eligibleUid}' AND phase='issuing'`), '1');
  for (const phase of ['issuing', 'open', 'unknown']) {
    sql(`UPDATE account_checkout_operations SET phase='${phase}' WHERE user_id='${eligibleUid}'`);
    await rejectsCheckout(`checkout_pending_${phase}`, eligibleUid, /billing operation pending/);
    assert.equal(sql(`SELECT count(*) FROM account_checkout_operations WHERE user_id='${eligibleUid}'`), '1');
  }
  await rejectsCheckout('checkout_missing_account', missingAccountUid, /account (profile )?unavailable/);
  await rejectsCheckout('checkout_missing_profile', missingProfileUid, /account profile unavailable/);
  await rejectsCheckout('checkout_closing', closingUid, /billing operation pending/);
  assert.equal(sql(`SELECT count(*) FROM account_checkout_operations WHERE user_id IN
    ('${missingAccountUid}','${missingProfileUid}','${closingUid}')`), '0');

  const cleanupOperation = sql(`SET ROLE service_role; SELECT begin_account_checkout('${uid}');`);
  sql(`SET ROLE service_role; SELECT record_account_checkout('${uid}','${cleanupOperation}','cs_cleanup');
    SELECT reconcile_account_checkout_expiry('${uid}','${cleanupOperation}','cs_cleanup');`);
  const barrier = client('closure_test_barrier', 'SELECT pg_advisory_lock(88001); SELECT pg_sleep(20)');
  await waitFor("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='closure_test_barrier' AND wait_event='PgSleep')");
  const webhook = client('closure_test_webhook', `SET ROLE service_role;
    SELECT apply_stripe_subscription_snapshot('event_race','sub_race','cus_race','active',true,false,NULL,'${uid}',NULL);`);
  await waitFor("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='closure_test_webhook' AND wait_event_type='Lock' AND wait_event='advisory')");
  const closure = client('closure_test_claim', `SET ROLE service_role;
    SELECT row_to_json(t) FROM claim_account_closure_token('${uid}','${hash}') t;`);
  await waitFor("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='closure_test_claim' AND wait_event_type='Lock')");
  // Release only the barrier backend on the verified isolated cluster.
  sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='closure_test_barrier'");
  await barrier;
  const [write, claim] = await Promise.all([webhook, closure]);
  assert.equal(write.code, 0, write.stderr);
  assert.equal(claim.code, 0, claim.stderr);
  assert.equal(JSON.parse(write.stdout).success, true, write.stdout);
  assert.equal(JSON.parse(claim.stdout).customer_id, 'cus_race', claim.stdout);
  assert.equal(sql(`SELECT phase FROM account_billing_fences WHERE user_id='${uid}'`), 'closing');
  const request = JSON.parse(claim.stdout).request_id;
  const transition = (state, requestId = request) => `SET ROLE service_role;
    SELECT record_account_closure_auth_state('${uid}','${requestId}','${state}');`;
  const cleanupSnapshot = () => sql(`SELECT json_build_object(
    'operations',(SELECT json_agg(o ORDER BY operation_id) FROM account_checkout_operations o WHERE user_id='${uid}'),
    'fences',(SELECT json_agg(f) FROM account_billing_fences f WHERE user_id='${uid}'),
    'journal',(SELECT row_to_json(a) FROM account_closure_attempts a WHERE user_id='${uid}'))`);
  async function rejectsTransition(name, state, message, requestId = request) {
    const before = cleanupSnapshot();
    const result = await client(name, transition(state, requestId));
    assert.notEqual(result.code, 0, `${name} unexpectedly accepted a terminal transition`);
    assert.match(result.stderr, message);
    assert.equal(cleanupSnapshot(), before, `${name} changed held rows or journal`);
  }
  sql(`SET ROLE service_role; SELECT settle_account_closure_billing('${uid}','${request}','cus_race',
    '[{"id":"sub_race","status":"canceled"}]'::jsonb);
    SELECT preserve_account_trial_email('${uid}');`);
  sql(transition('auth_unknown'));
  await rejectsTransition('cleanup_auth_present', 'auth_deleted', /auth absence unconfirmed/);
  sql(`DELETE FROM auth.users WHERE id='${uid}'`);
  assert.equal(sql(`SET ROLE service_role; SELECT verify_account_closure_residue('${uid}','user@example.test')`), 'f');
  assert.equal(sql(`SELECT phase FROM account_closure_attempts WHERE user_id='${uid}'`), 'auth_unknown');
  await rejectsTransition('cleanup_wrong_request', 'auth_deleted', /invalid closure transition/, missingAccountUid);
  for (const phase of ['issuing', 'open', 'unknown']) {
    sql(`UPDATE account_checkout_operations SET phase='${phase}' WHERE user_id='${uid}'`);
    await rejectsTransition(`cleanup_${phase}`, 'auth_deleted', /checkout reconciliation required/);
  }
  sql(`UPDATE account_checkout_operations SET phase='settled' WHERE user_id='${uid}'`);
  for (const mismatch of ['request', 'phase', 'missing']) {
    if (mismatch === 'request') sql(`UPDATE account_billing_fences SET request_id='${missingAccountUid}' WHERE user_id='${uid}'`);
    if (mismatch === 'phase') sql(`UPDATE account_billing_fences SET phase='open' WHERE user_id='${uid}'`);
    if (mismatch === 'missing') sql(`DELETE FROM account_billing_fences WHERE user_id='${uid}'`);
    await rejectsTransition(`cleanup_fence_${mismatch}`, 'auth_deleted', /closure fence ownership missing/);
    sql(`INSERT INTO account_billing_fences(user_id,phase,request_id) VALUES('${uid}','closing','${request}')
      ON CONFLICT(user_id) DO UPDATE SET phase='closing',request_id=EXCLUDED.request_id`);
  }
  const beforeRollback = cleanupSnapshot();
  sql(`BEGIN; ${transition('auth_deleted')} RESET ROLE;
    DO $$ BEGIN IF EXISTS(SELECT 1 FROM account_checkout_operations WHERE user_id='${uid}')
      OR EXISTS(SELECT 1 FROM account_billing_fences WHERE user_id='${uid}')
      THEN RAISE EXCEPTION 'transaction did not clean owned rows'; END IF; END $$; ROLLBACK;`);
  assert.equal(cleanupSnapshot(), beforeRollback, 'rollback lost held rows or journal');

  // Demonstrate real serialization, not just in-process fixture assertions.
  const interlock = client('cleanup_interlock', `SELECT pg_advisory_lock(hashtextextended('account-billing:${uid}',0)); SELECT pg_sleep(20)`);
  await waitFor("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='cleanup_interlock' AND wait_event='PgSleep')");
  const cleanup = client('cleanup_terminal', transition('auth_deleted'));
  await waitFor("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='cleanup_terminal' AND wait_event_type='Lock' AND wait_event='advisory')");
  assert.equal(cleanupSnapshot(), beforeRollback, 'cleanup bypassed the billing interlock');
  sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='cleanup_interlock'");
  await interlock;
  const cleaned = await cleanup;
  assert.equal(cleaned.code, 0, cleaned.stderr);
  assert.equal(sql(`SELECT count(*) FROM account_checkout_operations WHERE user_id='${uid}'`), '0');
  assert.equal(sql(`SELECT count(*) FROM account_billing_fences WHERE user_id='${uid}'`), '0');
  assert.equal(sql(`SELECT phase FROM account_closure_attempts WHERE user_id='${uid}'`), 'auth_deleted');
  assert.equal(sql(`SET ROLE service_role; SELECT verify_account_closure_residue('${uid}','user@example.test')`), 't');
  assert.equal(sql(`SELECT phase FROM account_checkout_operations WHERE user_id='${eligibleUid}'`), 'unknown');
  assert.equal(sql(`SELECT phase FROM account_billing_fences WHERE user_id='${eligibleUid}'`), 'open');
  for (const kind of ['checkout', 'fence']) {
    if (kind === 'checkout') sql(`INSERT INTO account_checkout_operations(user_id,phase) VALUES('${uid}','unknown')`);
    else sql(`INSERT INTO account_billing_fences(user_id,phase,request_id) VALUES('${uid}','closing','${request}')`);
    assert.equal(sql(`SET ROLE service_role; SELECT verify_account_closure_residue('${uid}','user@example.test')`), 'f');
    await rejectsTransition(`cleanup_completion_${kind}`, 'completed', /account residue remains/);
    if (kind === 'checkout') sql(`DELETE FROM account_checkout_operations WHERE user_id='${uid}'`);
    else sql(`DELETE FROM account_billing_fences WHERE user_id='${uid}'`);
  }
  sql(transition('completed'));
  assert.equal(sql(`SELECT phase FROM account_closure_attempts WHERE user_id='${uid}'`), 'completed');
  console.log(JSON.stringify({ postgres: sql('SHOW server_version'),
    result: 'PASS', boundary: 'canonical webhook row-lock → checkout refusal and closure claim',
    checkoutCases: ['webhook-before-checkout', 'eligible-once', 'issuing', 'open', 'unknown',
      'missing-account', 'missing-profile', 'closing'],
    cleanupCases: ['unknown-auth-held', 'auth-present', 'request', 'issuing', 'open', 'unknown',
      'fence-request', 'fence-phase', 'missing-fence', 'rollback', 'billing-interlock',
      'settled-owned-cleanup', 'other-user-isolation', 'completion-checkout', 'completion-fence', 'retained-journal'],
    providerCalls: 0,
    fullMigrationChain: 'UNVERIFIED' }));
} finally {
  if (started || existsSync(join(data, 'postmaster.pid'))) execFileSync('pg_ctl', ['-D', data, '-w', 'stop', '-m', 'immediate'], { encoding: 'utf8' });
  await Promise.allSettled(clients);
  rmSync(root, { recursive: true, force: true });
}
