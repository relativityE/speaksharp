// Scoped real-PostgreSQL proof. No full-chain, provider, or live rollout claim.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';
import console from 'node:console';
import { closureRolloutDependencyMutations } from './accountClosureRolloutMutations.mjs';

const root = mkdtempSync(join(tmpdir(), 'closure-s-'));
const data = join(root, 'data'); const socket = join(root, 'socket'); mkdirSync(socket);
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !key.startsWith('PG') && !key.startsWith('SUPABASE') && key !== 'DB_URL')),
PGHOST: socket, PGPORT: '5432', PGUSER: 'closure_schema_admin', PGDATABASE: 'postgres' };
const sql = (text) => execFileSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', text],
    { env: { ...env, PGOPTIONS: '-c client_min_messages=warning' }, encoding: 'utf8', timeout: 10_000 }).trim();
const cli = resolve('scripts/account-closure-rollout-gate.mjs');
let gateCases = 0;
function gate(mode, success) {
    const result = spawnSync(process.execPath, [cli, mode], { env, encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, success ? 0 : 1, `${mode}: ${result.stdout} ${result.stderr}`);
    if (!success) assert.equal(result.stdout.trim(), '', 'failed verification emitted partial success');
    else {
        const lines = result.stdout.trim().split('\n');
        assert.equal(lines.length, 1, 'must emit only one terminal verification');
        const terminal = JSON.parse(lines[0]);
        assert.equal(terminal.passed, true);
        assert.equal(terminal.stages.length, mode === 'after' ? 3 : 2);
    }
    gateCases += 1;
}
let started = false;
try {
    execFileSync('initdb', ['-D', data, '-U', env.PGUSER, '-A', 'trust', '--no-locale', '--encoding=UTF8'], { encoding: 'utf8' });
    execFileSync('pg_ctl', ['-D', data, '-l', join(root, 'server.log'), '-w', 'start', '-o',
        `-F -k ${socket} -h '' -p 5432 -c max_connections=10`], { encoding: 'utf8' }); started = true;
    assert.equal(sql("SELECT current_setting('data_directory')"), data);
    const fixture = readFileSync('tests/db/account-closure-tokens.integration.test.ts', 'utf8')
        .match(/await db\.exec\(`\n([\s\S]*?)`\);/);
    assert.ok(fixture, 'scoped fixture missing'); sql(fixture[1]);
    sql('ALTER TABLE auth.users ALTER COLUMN email TYPE varchar(255)');
    const baseline = readFileSync('backend/supabase/migrations/20260812041600_trial_commercial_grant_on_conflict_1294.sql', 'utf8');
    const signup = `CREATE TRIGGER on_auth_user_created_trial_profile AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.ensure_trial_profile_for_new_user();`;
    sql(`SET ROLE closure_owner; ${baseline} ${signup} RESET ROLE;`);
    gate('before', true); gate('after', false);
    sql('DROP TRIGGER on_auth_user_created_trial_profile ON auth.users');
    gate('before', false);
    sql(signup);
    const source = readFileSync('backend/supabase/migrations/20261013180000_account_closure_tokens.sql', 'utf8');
    sql(`SET ROLE closure_owner; ${source} RESET ROLE;`);
    gate('before', false); gate('after', true);
    for (const mutation of [
        'ALTER TABLE account_closure_tokens DISABLE ROW LEVEL SECURITY',
        'GRANT EXECUTE ON FUNCTION claim_account_closure_token(uuid,text) TO PUBLIC',
        'ALTER TABLE user_profiles DISABLE TRIGGER account_closure_billing_guard',
        'DROP TRIGGER account_closure_billing_guard ON user_profiles; CREATE TRIGGER account_closure_billing_guard BEFORE INSERT ON user_profiles FOR EACH ROW EXECUTE FUNCTION guard_account_closure_billing()',
        'DROP TRIGGER account_closure_billing_guard ON user_profiles; CREATE TRIGGER account_closure_billing_guard BEFORE INSERT OR UPDATE ON user_profiles FOR EACH ROW WHEN(false) EXECUTE FUNCTION guard_account_closure_billing()',
        "UPDATE account_billing_coordination SET checkout_workers_drained=true,evidence_reference='unproved'",
        'DELETE FROM account_billing_coordination',
        'ALTER TABLE account_closure_tokens RENAME COLUMN token_hash TO wrong_hash',
        'ALTER TABLE account_closure_tokens ALTER COLUMN expires_at SET DEFAULT now()',
        'ALTER TABLE account_checkout_operations DROP CONSTRAINT account_checkout_operations_phase_check',
        'ALTER TABLE account_closure_attempts ALTER COLUMN claimed_email DROP NOT NULL',
        'ALTER TABLE account_closure_attempts DROP CONSTRAINT account_closure_attempts_claimed_email_check',
    ]) {
        // Mutations persist only in this owned, disposable cluster; restore from
        // fresh database fixture for each case. The CLI itself is always read-only.
        sql(mutation); gate('after', false);
        sql('DROP SCHEMA public CASCADE; DROP SCHEMA auth CASCADE; DROP SCHEMA storage CASCADE; CREATE SCHEMA public; DROP ROLE closure_owner; DROP ROLE anon; DROP ROLE authenticated; DROP ROLE service_role;');
        sql(fixture[1]); sql(`SET ROLE closure_owner; ${baseline} ${signup} ${source} RESET ROLE;`); gate('after', true);
    }
    function reset(applied) {
        sql('DROP SCHEMA public CASCADE; DROP SCHEMA auth CASCADE; DROP SCHEMA storage CASCADE; CREATE SCHEMA public; DROP ROLE closure_owner; DROP ROLE anon; DROP ROLE authenticated; DROP ROLE service_role;');
        sql(fixture[1]); sql('ALTER TABLE auth.users ALTER COLUMN email TYPE varchar(255)');
        sql(`SET ROLE closure_owner; ${baseline} ${signup} ${applied ? source : ''} RESET ROLE;`);
    }
    for (const mode of ['before', 'after']) {
        for (const mutation of closureRolloutDependencyMutations) {
            reset(mode === 'after'); gate(mode, true);
            sql(mutation); gate(mode, false);
        }
        reset(mode === 'after'); gate(mode, true);
        sql(`DROP TABLE trial_entitlements;
          CREATE TABLE trial_entitlements(user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
            trial_expires_at timestamptz NOT NULL DEFAULT now(),email text NOT NULL,
            updated_at timestamptz DEFAULT now(),trial_started_at timestamptz NOT NULL DEFAULT now());
          CREATE UNIQUE INDEX differently_named_email ON trial_entitlements(email) INCLUDE(trial_started_at)`);
        gate(mode, true);
    }
    console.log(JSON.stringify({ result: 'PASS', postgres: sql('SHOW server_version'),
        gateCases, dependencyMutationsPerMode: closureRolloutDependencyMutations.length,
        providerCalls: 0, fullChain: 'UNVERIFIED', rolloutActivated: false }));
} finally {
    if (started || existsSync(join(data, 'postmaster.pid'))) {
        execFileSync('pg_ctl', ['-D', data, '-w', 'stop', '-m', 'immediate'], { encoding: 'utf8' });
    }
    rmSync(root, { recursive: true, force: true });
}
