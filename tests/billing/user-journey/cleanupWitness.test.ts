// @vitest-environment node
// Runs 44302168905 / 44316016932: Auth refused to delete the run's account. The witness reads only bounded counts from the exact
// recorded disposable database. Here Docker is a fake whose `psql` executes the witness's own SQL on PGlite loaded with the real
// migrated schema (tests/db bootstrap), so the counts come from the real guard, obligation, lease and session rules.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, test } from 'vitest';
import { bootstrapSql, candidate, seed } from '../../db/content-free-retention-evidence.realpg.mjs';
import { StackProofError, witnessCleanupRefusal, type DockerAnswer, type StackIdentity } from './localStackResources.mjs';

const PROJECT = 'billing-local-stack-123456-1';
const SYSID = '7300000000000000001';
const LABEL = 'com.supabase.cli.project';
const OWNER = `rwt-journey-billing-${randomUUID()}@example.com`;
const identity: StackIdentity = { schema: 'billing-local-stack-identity/v1', project: PROJECT,
  database: { container: 'c_db', volume: `supabase_db_${PROJECT}`, systemIdentifier: SYSID },
  containers: ['c_auth', 'c_db'], volumes: [`supabase_db_${PROJECT}`], networks: ['n_net'] };
const ok = (stdout = ''): DockerAnswer => ({ code: 0, stdout, stderr: '' });

let db: PGlite;
let user: string;
beforeEach(async () => {
  db = new PGlite();
  await db.exec(bootstrapSql());
  await db.exec(`SET ROLE closure_owner;${candidate()}\nRESET ROLE;`);
  // Later obligation rules the bootstrap predates: the explicit Start abandonment (the only path that settles a lease-only debt).
  await db.exec(`SET ROLE closure_owner;${readFileSync('backend/supabase/migrations/20261112133000_recording_start_abandonment_1643.sql', 'utf8')}\nRESET ROLE;`);
  user = (await seed(db, 0)).user;
  await db.query('UPDATE auth.users SET email = $1 WHERE id = $2', [OWNER, user]);
}, 240_000);
afterEach(async () => { await db.close().catch(() => undefined); });

/** A fake daemon for this run's stack. psql runs on PGlite as the local superuser; `over` replaces an answer by its args. */
function daemon(over: Record<string, DockerAnswer> = {}, logs: Record<string, string> = {}) {
  const calls: string[] = [];
  const run = async (args: string[]): Promise<DockerAnswer> => {
    const key = args.join(' ');
    calls.push(key);
    if (key in over) return over[key];
    if (args[0] === 'container' && args[1] === 'inspect') {
      const service = /^supabase_(db|auth)_/.exec(args[4])?.[1];
      return service ? ok(`c_${service} /${args[4]} ${PROJECT}\n`) : { code: 1, stdout: '', stderr: 'No such container' };
    }
    if (args[0] === 'exec') {
      const sql = args[args.length - 1];
      if (sql.includes('pg_control_system')) return ok(`${SYSID}\n`);
      await db.exec('RESET ROLE');
      const r = await db.query<Record<string, unknown>>(sql);
      return ok(r.rows.map(row => Object.values(row).join('|')).join('\n'));
    }
    if (args[0] === 'logs') return { code: 0, stdout: logs[args[1]] ?? '', stderr: '' };
    throw new Error(`unexpected docker call: ${key}`);
  };
  return { run, calls };
}

/** The witness is synchronous over Docker; resolve every fake answer first by replaying each call until none is pending. */
async function witness(d: ReturnType<typeof daemon>, id: unknown = identity) {
  const answers = new Map<string, DockerAnswer>();
  for (;;) {
    const pending: string[][] = [];
    const sync = (args: string[]) => {
      const a = answers.get(args.join('\u0000'));
      if (a) return a;
      pending.push(args);
      return { code: 0, stdout: '', stderr: '' };
    };
    let result: unknown; let error: unknown;
    try { result = witnessCleanupRefusal(id, PROJECT, sync); } catch (e) { error = e; }
    const fresh = pending.filter(a => !answers.has(a.join('\u0000')));
    if (fresh.length === 0) { if (error) throw error; return result as ReturnType<typeof witnessCleanupRefusal>; }
    answers.set(fresh[0].join('\u0000'), await d.run(fresh[0]));
  }
}

async function asOwner(sql: string, params: unknown[] = []) {
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return await db.query<Record<string, unknown>>(sql, params); } finally { await db.exec('RESET ROLE'); }
}
const FINAL = JSON.stringify({ reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'wpm', value: 100, comparator: 'within_target', templateVersion: 'rec_v1' });
async function savedTake(lease: string) {
  const c = (await asOwner("SELECT create_session_and_update_usage($1::jsonb,'private') AS r",
    [JSON.stringify({ title: 't', duration: 0, product: 'open_mic', lease_id: lease })])).rows[0].r as { new_session: { id: string } };
  await asOwner("SELECT complete_session_v2($1,'completed',60,NULL,$2::jsonb,100,NULL,100,'{}',NULL,$3)", [c.new_session.id, FINAL, 'x']);
}

test('a superseded lease leaves an admitted lease-only obligation: the witness counts it apart from the settled take', async () => {
  const L1 = randomUUID(), L2 = randomUUID();
  await asOwner('SELECT acquire_recording_lease($1,$2,false)', [L1, 'p']);
  await asOwner('SELECT acquire_recording_lease($1,$2,true)', [L2, 'p']);
  await savedTake(L2);
  const d = daemon({}, { c_auth: '{"msg":"500: Database error deleting user"}\n', c_db: 'ERROR:  account admitted save unsettled\n' });
  const w = await witness(d);
  assert.deepEqual(w.counts.obligation, { 'admitted:lease_only_superseded': 1, 'completed:session_linked': 1 });
  assert.deepEqual(w.counts.session, { 'completed:lease_linked': 1 });
  assert.equal(Object.values(w.counts.lease).reduce((a, b) => a + b, 0), 1);
  assert.deepEqual(w.failureCategories, { 'auth:auth_database_error_deleting_user': 1, 'db:guard_admitted_save_unsettled': 1 });
  assert.equal(w.owner, 'bound');
  // Nothing identifying leaves: no uuid, no email, no marker.
  const out = JSON.stringify(w);
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(out) && !out.includes('@') && !out.includes('rwt-journey'), out);
});

test('a lease released before any take keeps its admitted debt (delete refused); only the explicit abandonment settles it', async () => {
  const L1 = randomUUID();
  await asOwner('SELECT acquire_recording_lease($1,$2,false)', [L1, 'p']);
  await asOwner('SELECT release_recording_lease($1)', [L1]);
  let w = await witness(daemon());
  assert.deepEqual(w.counts, { obligation: { 'admitted:lease_only_superseded': 1 }, lease: {}, session: {} });
  await assert.rejects(db.query('DELETE FROM auth.users WHERE id = $1', [user]), /account admitted save unsettled/);
  assert.deepEqual((await asOwner('SELECT abandon_recording_start_v1($1) AS r', [L1])).rows[0].r,
    { abandoned: true, outcome: 'abandoned_not_recorded', repeated: false });
  w = await witness(daemon());
  assert.deepEqual(w.counts, { obligation: {}, lease: {}, session: {} });
});

test('a Start still holding its lease with no take counts as lease-only on the current lease', async () => {
  await asOwner('SELECT acquire_recording_lease($1,$2,false)', [randomUUID(), 'p']);
  const w = await witness(daemon());
  assert.deepEqual(w.counts.obligation, { 'admitted:lease_only_current': 1 });
  assert.deepEqual(w.counts.lease, { recording: 1 });
});

test('the witness refuses before any count query when the database or owner is not the recorded one', async () => {
  const expectCode = async (code: string, d: ReturnType<typeof daemon>, id: unknown = identity) => {
    await assert.rejects(witness(d, id), (e: unknown) => e instanceof StackProofError && e.code === code);
    assert.ok(!d.calls.some(c => c.includes('account_save_obligations')), `${code}: counts were read`);
  };
  const inspectDb = `container inspect --format {{.Id}} {{.Name}} {{index .Config.Labels "${LABEL}"}} supabase_db_${PROJECT}`;
  await expectCode('witness_db_container_not_recorded', daemon({ [inspectDb]: ok(`c_other /supabase_db_${PROJECT} ${PROJECT}`) }));
  await expectCode('witness_db_container_not_recorded', daemon({ [inspectDb]: ok(`c_db /supabase_db_${PROJECT} billing-local-stack-9-1`) }));
  await expectCode('witness_db_container_unreadable', daemon({ [inspectDb]: { code: 1, stdout: '', stderr: 'denied' } }));
  await expectCode('witness_database_identity_mismatch',
    daemon({ 'exec c_db psql -U postgres -v ON_ERROR_STOP=1 -tAc select system_identifier from pg_control_system()': ok('999\n') }));
  // A second user, or an owner that is not the run's marker, is unbound.
  await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${randomUUID()}', 'someone@example.com')`);
  await expectCode('witness_owner_unbound', daemon());
  await expectCode('identity_not_this_run', daemon(), { ...identity, schema: 'other' });
});

test('an unreadable count row or log is a failure, never a partial answer', () => {
  const sync = (args: string[]): DockerAnswer => {
    const key = args.join(' ');
    if (key.includes('pg_control_system')) return ok(`${SYSID}\n`);
    if (key.includes('FROM auth.users WHERE') || key.includes('count(*) FILTER')) return key.includes('FILTER') ? ok('1|1\n') : ok('obligation|admitted|lease_only_current|1\nuser@example.com\n');
    if (args[0] === 'container') return ok(`c_${/supabase_(db|auth)_/.exec(args[4])?.[1]} /${args[4]} ${PROJECT}\n`);
    return ok('');
  };
  assert.throws(() => witnessCleanupRefusal(identity, PROJECT, sync), (e: unknown) => e instanceof StackProofError && e.code === 'witness_count_unreadable');
  const noLogs = (args: string[]): DockerAnswer => (args[0] === 'logs' ? { code: 1, stdout: '', stderr: 'x' }
    : args.join(' ').includes('FILTER') ? ok('1|1') : sync(args).stdout.includes('@') ? ok('') : sync(args));
  assert.throws(() => witnessCleanupRefusal(identity, PROJECT, noLogs), (e: unknown) => e instanceof StackProofError && e.code === 'witness_auth_logs_unreadable');
});
