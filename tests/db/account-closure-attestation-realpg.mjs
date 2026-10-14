// Real-PG check of the proposed persistence ACL/atomic invalidation boundary.
// Synthetic evidence only; no platform/provider observations or activation.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import console from 'node:console';

const root = mkdtempSync('/private/tmp/closure-attestation-proof-');
const data = join(root, 'data'); const socket = join(root, 'socket'); mkdirSync(socket);
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !key.startsWith('PG') && !key.startsWith('SUPABASE') && key !== 'DB_URL')),
PGHOST: socket, PGPORT: '5432', PGUSER: 'attestation_test_admin', PGDATABASE: 'postgres', PGOPTIONS: '-c client_min_messages=warning' };
const sql = (text) => execFileSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', text],
    { env, encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let started = false;
try {
    execFileSync('initdb', ['-D', data, '-U', env.PGUSER, '-A', 'trust', '--no-locale', '--encoding=UTF8'], { encoding: 'utf8' });
    execFileSync('pg_ctl', ['-D', data, '-l', join(root, 'server.log'), '-w', 'start', '-o',
        `-F -k ${socket} -h '' -p 5432 -c max_connections=10`], { encoding: 'utf8' }); started = true;
    assert.equal(sql("SELECT current_setting('data_directory')"), data);
    const fixture = readFileSync('tests/db/account-closure-tokens.integration.test.ts', 'utf8')
        .match(/await db\.exec\(`\n([\s\S]*?)`\);/); assert.ok(fixture);
    sql(fixture[1]);
    sql(`SET ROLE closure_owner; ${readFileSync('backend/supabase/migrations/20261013180000_account_closure_tokens.sql', 'utf8')}
      ${readFileSync('scripts/rollout/account-closure-attestation-proposal.sql', 'utf8')} RESET ROLE;`);
    const record = { version: 1, candidateSha: 'a'.repeat(40), mainSha: 'b'.repeat(40), migrationDigest: 'c'.repeat(64), target: {},
        deployments: [], configDigest: 'd'.repeat(64), payments: { frontendEnabled: false, backendEnabled: false }, operatorId: 'fixture',
        createdAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString(),
        evidenceDigest: 'e'.repeat(64), bindingDigest: 'f'.repeat(64), legacyWriters: [], inventory: {} };
    const validation = { version: 1, validation: 'OFFLINE_VALID', activationAuthorized: false,
        bindingDigest: record.bindingDigest, evidenceDigest: record.evidenceDigest, quarantined: [] };
    const quote = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
    const call = (generation) => `SELECT record_account_closure_drain_attestation('11111111-1111-4111-8111-111111111111',${generation},${quote(record)},${quote(validation)})`;
    assert.equal(sql(`SET ROLE service_role; ${call(0)}`), '11111111-1111-4111-8111-111111111111');
    sql(`SET ROLE service_role; ${call(0)}`); // exact identity retry is idempotent
    assert.equal(sql('SELECT count(*) FROM account_closure_drain_attestations'), '1');
    assert.equal(sql('SELECT checkout_workers_drained FROM account_billing_coordination'), 'f');
    for (const role of ['anon', 'authenticated']) assert.throws(() => sql(`SET ROLE ${role}; ${call(0)}`), /permission denied/);
    assert.throws(() => sql('SET ROLE service_role; UPDATE account_closure_attestation_state SET generation=99'), /permission denied/);
    assert.equal(sql(`SET ROLE service_role; SELECT invalidate_account_closure_drain_attestations(0,'uncertain_writer','${'a'.repeat(64)}')`), '1');
    assert.throws(() => sql(`SET ROLE service_role; ${call(0)}`), /stale attestation generation/);
    assert.equal(sql("SELECT count(*) FROM account_closure_drain_attestations WHERE invalidated_at IS NOT NULL AND invalidation_reason='uncertain_writer'"), '1');
    assert.equal(sql('SELECT checkout_workers_drained FROM account_billing_coordination'), 'f');
    console.log(JSON.stringify({ result: 'PASS', postgres: sql('SHOW server_version'),
        boundary: 'trusted-service persistence/ACL/invalidation', externalFactsVerified: false, providerCalls: 0, fullChain: 'UNVERIFIED' }));
} finally {
    if (started || existsSync(join(data, 'postmaster.pid'))) execFileSync('pg_ctl', ['-D', data, '-w', 'stop', '-m', 'immediate'], { encoding: 'utf8' });
    rmSync(root, { recursive: true, force: true });
}
