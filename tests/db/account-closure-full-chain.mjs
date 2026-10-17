// Real Supabase-local schema proof in an isolated GitHub runner. No remote link,
// production credentials, provider call, baseline shim or skipped versioned migration.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { accountClosureEnforcementStages } from '../../scripts/lib/accountClosureEnforcementGate.mjs';
import { captureOwnedDatabaseDiagnostics, proofImageEvidence, proofPostgresImage, proofPostgresVersion, proofSubprocessFailure } from './account-closure-full-chain-diagnostics.mjs';

const root = resolve('backend/supabase/migrations');
const candidate = '20261016180000_account_closure_drain_enforcement.sql';
const recovery = '20261017200000_checkout_rejection_recovery.sql';
const postgresVersion = proofPostgresVersion(process.env.PROOF_POSTGRES_VERSION);
const files = readdirSync(root).filter((file) => file.endsWith('.sql')).sort();
assert.ok(files.includes(candidate), 'closure candidate missing');
const manifest = files.map((name) => {
  const match = name.match(/^(\d{8}|\d{14})_.+\.sql$/);
  // Supabase ignores these existing unversioned scripts. Preserve them
  // in the snapshot and manifest; do not pretend it is a replayed migration.
  assert.ok(match || ['rotate_sessions.sql', 'test_usage_rpc.sql'].includes(name), `unrecognized migration name: ${name}`);
  return { name, version: match?.[1] ?? null, sha256: createHash('sha256').update(readFileSync(join(root, name))).digest('hex') };
});
const migrations = manifest.filter((row) => row.version !== null);
assert.equal(new Set(migrations.map((row) => row.version)).size, migrations.length, 'duplicate migration versions');
assert.equal(migrations.at(-1).name, recovery, 'newer migration requires an explicit updated baseline');
if (process.argv.includes('--plan')) {
  console.log(JSON.stringify({ mode: 'PLAN_ONLY', migrations: migrations.length, candidate: migrations.at(-1), unversioned: manifest.filter((row) => row.version === null), executed: false }));
  process.exit(0);
}
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'full-stack execution requires the disposable CI runner');
assert.equal(process.env.DOCKER_HOST, 'unix:///var/run/docker.sock', 'remote Docker contexts are refused');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith('PG') && !key.startsWith('SUPABASE_') && !['DATABASE_URL', 'GITHUB_TOKEN', 'GH_TOKEN',
    'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'].includes(key)));
// setup-cli uses the public GHCR mirror to avoid anonymous Docker Hub limits.
// This is an image location, not a Supabase project or credential setting.
env.SUPABASE_INTERNAL_IMAGE_REGISTRY = 'ghcr.io';
const evidence = resolve('artifacts/account-closure-full-chain');
mkdirSync(evidence, { recursive: true });
const resourcesFile = join(evidence, 'resources.json');
const run = (bin, args, options = {}) => {
  const result = spawnSync(bin, args, { env, encoding: 'utf8', timeout: 12 * 60_000, maxBuffer: 8 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) {
    const diagnostic = proofSubprocessFailure(bin, args, result);
    const error = new Error(`${diagnostic.command} failed (status=${diagnostic.status}, signal=${diagnostic.signal}):\n`
      + `stdout:\n${diagnostic.stdout}\nstderr:\n${diagnostic.stderr}`);
    error.subprocess = diagnostic;
    throw error;
  }
  return result.stdout.trim();
};
const firewallArgs = (id, subnet) => ['DOCKER-USER', '-s', subnet, '!', '-d', subnet,
  '-m', 'comment', '--comment', id, '-j', 'DROP'];
function cleanupOwned({ id, stage, networkName, subnet }) {
  assert.match(id, /^closure-proof-[a-f0-9]{16}$/);
  assert.equal(networkName, `${id}-internal`);
  assert.equal(resolve(stage).startsWith(`${resolve(process.env.RUNNER_TEMP)}/closure-chain-`), true);
  if (existsSync(stage)) run('supabase', ['stop', '--no-backup', '--workdir', stage]);
  if (subnet) {
    assert.match(subnet, /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/);
    const args = firewallArgs(id, subnet);
    const rule = spawnSync('sudo', ['iptables', '-w', '-C', ...args], { env, encoding: 'utf8' });
    if (rule.status === 0) run('sudo', ['iptables', '-w', '-D', ...args]);
    else assert.equal(rule.status, 1, 'cannot verify owned firewall teardown');
  }
  const networks = run('docker', ['network', 'ls', '--filter', `name=^${networkName}$`, '--format', '{{.Name}}']);
  if (networks) {
    const network = JSON.parse(run('docker', ['network', 'inspect', networkName]))[0];
    assert.equal(network.Labels['speaksharp.closure-proof'], id, 'cleanup ownership changed');
    run('docker', ['network', 'rm', networkName]);
  }
  const retained = run('docker', ['ps', '-a', '--filter', `name=_${id}$`, '--format', '{{.Names}}']);
  assert.equal(retained, '', 'owned containers remain after teardown');
  const volumes = run('docker', ['volume', 'ls', '--filter', `name=_${id}$`, '--format', '{{.Name}}']);
  assert.equal(volumes, '', 'owned volumes remain after teardown');
  rmSync(stage, { recursive: true, force: true });
}
if (process.argv.includes('--cleanup')) {
  if (existsSync(resourcesFile)) cleanupOwned(JSON.parse(readFileSync(resourcesFile, 'utf8')));
  process.exit(0);
}
writeFileSync(join(evidence, 'migration-manifest.json'), JSON.stringify(manifest, null, 2));
const stage = mkdtempSync(join(process.env.RUNNER_TEMP, 'closure-chain-'));
const id = `closure-proof-${randomBytes(8).toString('hex')}`;
const networkName = `${id}-internal`;
const containerName = `supabase_db_${id}`;
writeFileSync(resourcesFile, JSON.stringify({ id, stage, networkName }));
let primaryError;
let cleanupError;
let realSupabaseSchema = false;
let subnet;
const cli = (args) => run('supabase', [...args, '--workdir', stage]);
const sql = (text) => run('docker', ['exec', '-i', containerName, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
  input: `SET statement_timeout='30s'; SET lock_timeout='5s';\n${text}`,
});
const history = () => sql('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;').split('\n');
function verifyEnforcement(mode) {
  const source = (name) => readFileSync(join(root, name), 'utf8');
  const stages = accountClosureEnforcementStages(mode, { closure: source('20261013180000_account_closure_tokens.sql'),
    baseline: source('20260812041600_trial_commercial_grant_on_conflict_1294.sql'),
    drain: source('20261016090000_account_closure_drain_persistence.sql'), enforcement: source(candidate) });
  const output = sql(`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n${stages.map(([query]) => query).join('\n')}\nCOMMIT;`).split('\n');
  assert.equal(output.length, stages.length, 'incomplete enforcement postflight');
  for (const [index, [, verify]] of stages.entries()) verify(output[index]);
}
try {
  const directory = join(stage, 'supabase');
  mkdirSync(join(directory, 'migrations'), { recursive: true });
  // Fresh, unlinked configuration: never copy project-ref, seed, functions or
  // operator credentials from the application or an installed local stack.
  writeFileSync(join(directory, 'config.toml'), `project_id = "${id}"\n[db]\nmajor_version = 17\n[db.seed]\nenabled = false\n`);
  // Supported CLI selector; fresh staging only, never an installed/project DB.
  mkdirSync(join(directory, '.temp'), { recursive: true });
  writeFileSync(join(directory, '.temp', 'postgres-version'), postgresVersion);
  for (const file of files.filter((name) => name !== candidate && name !== recovery)) cpSync(join(root, file), join(directory, 'migrations', file));
  // Internal-only bridges do not publish the localhost DB port used by the
  // pinned CLI. Use a loopback-published bridge with an owned egress DROP rule
  // established before starting any database/service container instead.
  run('docker', ['network', 'create', '--opt', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1',
    '--label', `speaksharp.closure-proof=${id}`, networkName]);
  const network = JSON.parse(run('docker', ['network', 'inspect', networkName]))[0];
  assert.equal(network.Labels['speaksharp.closure-proof'], id);
  assert.equal(network.EnableIPv6, false, 'unfiltered IPv6 is refused');
  subnet = network.IPAM.Config[0].Subnet;
  assert.match(subnet, /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/);
  writeFileSync(resourcesFile, JSON.stringify({ id, stage, networkName, subnet }));
  run('sudo', ['iptables', '-w', '-I', ...firewallArgs(id, subnet)]);
  run('sudo', ['iptables', '-w', '-C', ...firewallArgs(id, subnet)]);
  // Pull the approved immutable content, then provide the tag expected by the
  // supported CLI selector. Post-start verification refuses retag/substitution.
  const imagePin = proofPostgresImage(postgresVersion);
  run('docker', ['pull', '--platform', 'linux/amd64', imagePin.repositoryDigest]);
  run('docker', ['tag', imagePin.repositoryDigest, imagePin.tag]);
  cli(['start', '--network-id', network.Id, '--exclude', 'studio,imgproxy,realtime,edge-runtime,logflare,vector,supavisor']);
  const container = JSON.parse(run('docker', ['inspect', containerName]))[0];
  assert.deepEqual(Object.keys(container.NetworkSettings.Networks), [networkName], 'database escaped the owned internal network');
  const image = JSON.parse(run('docker', ['image', 'inspect', container.Image]))[0];
  writeFileSync(join(evidence, 'database-image.json'), JSON.stringify(proofImageEvidence(postgresVersion, container, image), null, 2));
  const databaseVersion = JSON.parse(sql(`SELECT json_build_object('version',version(),
    'serverVersionNum',current_setting('server_version_num'),
    'sharedPreloadLibraries',current_setting('shared_preload_libraries',true),
    'sessionPreloadLibraries',current_setting('session_preload_libraries',true),
    'supautilsHintRoles',current_setting('supautils.hint_roles',true),
    'supautilsReservedRoles',current_setting('supautils.reserved_roles',true),
    'supautilsVersionSetting',current_setting('supautils.version',true),
    'extensions',(SELECT json_agg(json_build_object('name',extname,'version',extversion) ORDER BY extname) FROM pg_extension))::text;`));
  writeFileSync(join(evidence, 'database-version.json'), JSON.stringify(databaseVersion, null, 2));
  assert.equal(Math.floor(Number(sql("SELECT current_setting('server_version_num');")) / 10000), 17);
  assert.deepEqual(history(), migrations.filter((row) => row.name !== candidate && row.name !== recovery).map((row) => row.version), 'baseline replay is incomplete');
  verifyEnforcement('before');
  // Legacy schema invariants belong to the actual118 baseline, before119
  // deliberately revokes its service-role mutation bypasses.
  const baselineProof = sql(readFileSync('tests/db/account-closure-full-chain.sql', 'utf8'));
  assert.ok(baselineProof.includes('ACCOUNT CLOSURE FULL-CHAIN INVARIANTS PASSED'), 'baseline proof marker absent');
  console.log('ACTUAL SUPABASE BASELINE REPLAY PASSED');
  // Diagnose the provider's general ACL-error hook before119 changes grants.
  // Failure is real and remains FAIL; it never bypasses the full proof.
  const denialControl = sql(readFileSync('tests/db/account-closure-denial-control.sql', 'utf8'));
  assert.ok(denialControl.includes('ACCOUNT CLOSURE DISPOSABLE DENIAL CONTROL PASSED'), 'disposable denial control absent');
  writeFileSync(join(evidence, 'denial-control.json'), JSON.stringify({ baselineMigrations: migrations.length - 2,
    selectedPostgresVersion: postgresVersion, status: 'PASS', productionProof: false }));
  cpSync(join(root, candidate), join(directory, 'migrations', candidate));
  cli(['migration', 'up', '--local']);
  assert.deepEqual(history(), migrations.filter((row) => row.name !== recovery).map((row) => row.version), 'enforcement history is incomplete');
  realSupabaseSchema = true;
  verifyEnforcement('after');
  const proof = sql(readFileSync('tests/db/account-closure-enforcement-full-chain.sql', 'utf8'));
  assert.ok(proof.includes('ACCOUNT CLOSURE ENFORCEMENT FULL-CHAIN INVARIANTS PASSED'), 'enforcement proof marker absent');
  assert.equal(sql("SELECT count(*) FROM auth.users WHERE id='c1111111-1111-4111-8111-111111111111'"), '0', 'owned fixture Auth residue');
  assert.equal(sql("SELECT count(*) FROM public.account_closure_attempts WHERE user_id='c1111111-1111-4111-8111-111111111111'"), '0', 'owned fixture journal residue');
  assert.equal(sql('SELECT checkout_workers_drained FROM public.account_billing_coordination;'), 'f', 'proof must restore disabled rollout gate');
  verifyEnforcement('after');
  console.log('ACCOUNT CLOSURE ENFORCEMENT FULL-CHAIN INVARIANTS PASSED');
  cpSync(join(root, recovery), join(directory, 'migrations', recovery));
  cli(['migration', 'up', '--local']);
  assert.deepEqual(history(), migrations.map((row) => row.version), 'recovery history is incomplete');
  const recoveryProof = sql(readFileSync('tests/db/checkout-rejection-recovery.sql', 'utf8'));
  assert.ok(recoveryProof.includes('CHECKOUT REJECTION RECOVERY INVARIANTS PASSED'), 'recovery proof marker absent');
  assert.equal(sql("SELECT count(*) FROM auth.users WHERE id IN ('c3333333-3333-4333-8333-333333333333','c4444444-4444-4444-8444-444444444444')"), '0', 'rejection fixture residue');
  verifyEnforcement('after');
  console.log('CHECKOUT REJECTION RECOVERY INVARIANTS PASSED');
} catch (error) {
  primaryError = error;
} finally {
  // Must precede supabase stop/removal: otherwise the crashing backend's state,
  // OOM indicator, server signal and stage output are permanently lost.
  try {
    writeFileSync(join(evidence, 'database-diagnostics.json'), JSON.stringify(captureOwnedDatabaseDiagnostics(containerName, env), null, 2));
    if (primaryError?.subprocess) writeFileSync(join(evidence, 'subprocess-failure.json'), JSON.stringify(primaryError.subprocess, null, 2));
  } catch (error) {
    try {
      writeFileSync(join(evidence, 'diagnostic-capture-failure.json'), JSON.stringify({ message: 'owned database diagnostics unavailable', code: error?.code ?? null }));
    } catch { /* Artifact storage failure must not prevent owned resource cleanup. */ }
  }
  try {
    cleanupOwned({ id, stage, networkName, subnet });
  } catch (error) { cleanupError = error; }
  writeFileSync(join(evidence, 'verdict.json'), JSON.stringify({
    status: primaryError || cleanupError ? 'FAIL' : 'PASS',
    candidate: migrations.at(-1), migrations: migrations.length, realSupabaseSchema,
    testedCommit: run('git', ['rev-parse', 'HEAD']), requestedHead: process.env.PROOF_HEAD_SHA,
    providerProof: false, cleanupVerified: !cleanupError,
    selectedPostgresVersion: postgresVersion, imageComparisonOnly: postgresVersion === '17.6.1.106', productionRepresentativenessVerified: false,
    error: primaryError?.message, cleanupError: cleanupError?.message,
  }, null, 2));
}
if (primaryError || cleanupError) throw primaryError ?? cleanupError;
