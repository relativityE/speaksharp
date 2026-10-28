// Real-PG check of the versioned persistence ACL/atomic invalidation boundary.
// Synthetic evidence only; no platform/provider observations or activation.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';
import console from 'node:console';
import { setTimeout } from 'node:timers/promises';

const root = mkdtempSync(join(tmpdir(), 'closure-a-'));
const data = join(root, 'data'); const socket = join(root, 'socket'); mkdirSync(socket);
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !key.startsWith('PG') && !key.startsWith('SUPABASE') && key !== 'DB_URL')),
PGHOST: socket, PGPORT: '5432', PGUSER: 'attestation_test_admin', PGDATABASE: 'postgres', PGOPTIONS: '-c client_min_messages=warning' };
const sql = (text) => execFileSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', text],
    { env, encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const clients = [];
function client(name, statement) {
    const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
    if (statement) args.push('-c', statement);
    const child = spawn('psql', args, { env: { ...env, PGAPPNAME: name,
        PGOPTIONS: '-c client_min_messages=warning -c lock_timeout=8000 -c statement_timeout=10000' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let error = '';
    child.stdout.on('data', (part) => { output += part; }); child.stderr.on('data', (part) => { error += part; });
    const done = new Promise((resolve, reject) => {
        child.on('error', reject); child.on('close', (code) => resolve({ code, output: output.trim(), error: error.trim() }));
    });
    clients.push({ child, done }); return { child, done };
}
async function waitFor(query) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) { if (sql(query) === 't') return; await setTimeout(25); }
    throw new Error('required concurrent database barrier missing');
}
async function hold(name) {
    const holder = client(name);
    holder.child.stdin.write('BEGIN; SELECT singleton FROM account_billing_coordination FOR UPDATE;\n');
    await waitFor(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND state='idle in transaction')`);
    return holder;
}
async function release(holder) { holder.child.stdin.end('COMMIT;\n\\q\n'); assert.equal((await holder.done).code, 0); }
const waiting = (name) => `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND wait_event_type='Lock')`;
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
      ${readFileSync('backend/supabase/migrations/20261016090000_account_closure_drain_persistence.sql', 'utf8')} RESET ROLE;`);
    const record = { version: 1, candidateSha: 'a'.repeat(40), mainSha: 'b'.repeat(40), migrationDigest: 'c'.repeat(64), target: {},
        deployments: [], configDigest: 'd'.repeat(64), payments: { frontendEnabled: false, backendEnabled: false }, operatorId: 'fixture',
        createdAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString(),
        evidenceDigest: 'e'.repeat(64), bindingDigest: 'f'.repeat(64), legacyWriters: [], inventory: {} };
    const validation = { version: 1, validation: 'OFFLINE_VALID', activationAuthorized: false,
        bindingDigest: record.bindingDigest, evidenceDigest: record.evidenceDigest, quarantined: [] };
    const quote = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
    const call = (generation, input = record, id = '11111111-1111-4111-8111-111111111111') =>
        `SELECT record_account_closure_drain_attestation('${id}',${generation},${quote(input)},${quote(validation)})`;
    assert.equal(sql(`SET ROLE service_role; ${call(0)}`), '11111111-1111-4111-8111-111111111111');
    sql(`SET ROLE service_role; ${call(0)}`); // exact identity retry is idempotent
    assert.equal(sql('SELECT count(*) FROM account_closure_drain_attestations'), '1');
    assert.equal(sql('SELECT checkout_workers_drained FROM account_billing_coordination'), 'f');
    for (const role of ['anon', 'authenticated']) assert.throws(() => sql(`SET ROLE ${role}; ${call(0)}`), /permission denied/);
    assert.throws(() => sql('SET ROLE service_role; UPDATE account_closure_attestation_state SET generation=99'), /permission denied/);
    assert.equal(sql(`SET ROLE service_role; SELECT invalidate_account_closure_drain_attestations(0,'uncertain_writer','${'a'.repeat(64)}')`), '1');
    assert.throws(() => sql(`SET ROLE service_role; ${call(0)}`), /stale attestation generation/);
    assert.equal(sql("SELECT count(*) FROM account_closure_drain_attestations WHERE invalidated_at IS NOT NULL AND invalidation_reason='uncertain_writer'"), '1');

    // Initially valid registration expires while serialized behind another connection.
    const expiredId = '22222222-2222-4222-8222-222222222222';
    const blocker = await hold('expiry_blocker');
    const short = { ...record, createdAt: sql("SELECT to_char((clock_timestamp()-interval '1 second') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')"),
        expiresAt: sql("SELECT to_char((clock_timestamp()+interval '2 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')") };
    const expiryClient = client('expiry_registration', `SET ROLE service_role; ${call(1, short, expiredId)}`);
    await waitFor(waiting('expiry_registration'));
    assert.equal(sql(`SELECT query_start < '${short.expiresAt}'::timestamptz FROM pg_stat_activity WHERE application_name='expiry_registration'`), 't');
    await waitFor(`SELECT clock_timestamp()>'${short.expiresAt}'::timestamptz`);
    await release(blocker);
    const expiredResult = await expiryClient.done;
    assert.notEqual(expiredResult.code, 0, 'expired lock-wait registration accepted');
    assert.match(expiredResult.error, /stale attestation/);
    assert.equal(sql(`SELECT count(*) FROM account_closure_drain_attestations WHERE attestation_id='${expiredId}'`), '0');
    assert.equal(sql('SELECT binding_digest IS NULL FROM account_closure_attestation_state'), 't');

    // Positive control: still valid after a proven lock wait, actual recorded_at
    // must be post-release rather than the registration request's query_start.
    const validId = '33333333-3333-4333-8333-333333333333';
    const positiveBlocker = await hold('positive_blocker');
    const validClient = client('positive_registration', `SET ROLE service_role; ${call(1, record, validId)}`);
    await waitFor(waiting('positive_registration'));
    const releasedAt = sql('SELECT clock_timestamp()'); await release(positiveBlocker);
    const positive = await validClient.done; assert.equal(positive.code, 0, positive.error);
    assert.equal(sql(`SELECT recorded_at>='${releasedAt}'::timestamptz FROM account_closure_drain_attestations WHERE attestation_id='${validId}'`), 't');

    // Invalidation queues first; stale generation registration must not insert
    // after it, and both use the same global coordination→generation lock order.
    const serializationBlocker = await hold('serialization_blocker');
    const invalidator = client('concurrent_invalidation', `SET ROLE service_role; SELECT invalidate_account_closure_drain_attestations(1,'rollback','${'a'.repeat(64)}')`);
    await waitFor(waiting('concurrent_invalidation'));
    const staleId = '44444444-4444-4444-8444-444444444444';
    const stale = client('concurrent_registration', `SET ROLE service_role; ${call(1, record, staleId)}`);
    await waitFor(waiting('concurrent_registration')); await release(serializationBlocker);
    assert.equal((await invalidator.done).code, 0);
    const staleResult = await stale.done; assert.notEqual(staleResult.code, 0); assert.match(staleResult.error, /stale attestation generation/);
    assert.equal(sql(`SELECT count(*) FROM account_closure_drain_attestations WHERE attestation_id='${staleId}'`), '0');
    assert.equal(sql('SELECT generation FROM account_closure_attestation_state'), '2');
    assert.equal(sql('SELECT checkout_workers_drained FROM account_billing_coordination'), 'f');
    assert.equal(sql('SELECT checkout_workers_drained FROM account_billing_coordination'), 'f');
    console.log(JSON.stringify({ result: 'PASS', postgres: sql('SHOW server_version'),
        boundary: 'trusted-service persistence/ACL/concurrent expiry and invalidation', externalFactsVerified: false, providerCalls: 0, fullChain: 'UNVERIFIED' }));
} finally {
    for (const { child } of clients) if (child.exitCode === null) { child.stdin.end(); child.kill('SIGTERM'); }
    await Promise.allSettled(clients.map(({ done }) => done));
    if (started || existsSync(join(data, 'postmaster.pid'))) execFileSync('pg_ctl', ['-D', data, '-w', 'stop', '-m', 'immediate'], { encoding: 'utf8' });
    rmSync(root, { recursive: true, force: true });
}
