// Isolated PostgreSQL regression, not a Production or provider probe.
// Reuses the scoped SQL fixture and actual migration/RPC source. No full-chain claim.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { setTimeout } from 'node:timers';

const root = mkdtempSync('/private/tmp/account-closure-realpg-');
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
  sql(`CREATE FUNCTION public.test_webhook_profile_barrier() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.stripe_customer_id='cus_race' THEN PERFORM pg_advisory_xact_lock(88001); END IF; RETURN NEW; END; $$;
    CREATE TRIGGER a_account_closure_test_barrier BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION public.test_webhook_profile_barrier();`);
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
  console.log(JSON.stringify({ postgres: sql('SHOW server_version'),
    result: 'PASS', boundary: 'canonical webhook row-lock → closure claim', providerCalls: 0,
    fullMigrationChain: 'UNVERIFIED' }));
} finally {
  if (started || existsSync(join(data, 'postmaster.pid'))) execFileSync('pg_ctl', ['-D', data, '-w', 'stop', '-m', 'immediate'], { encoding: 'utf8' });
  await Promise.allSettled(clients);
  rmSync(root, { recursive: true, force: true });
}
