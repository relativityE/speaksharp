// @vitest-environment node
// #1643 missing-Start abandonment against the real recording, admission and completion-journal chain in PostgreSQL WASM.
// Sequential semantics only. Native concurrency (both race orders, delayed writers) is
// tests/db/recording-start-abandonment-realpg.mjs. Not hosted ACL, provider, deletion or live evidence.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { completionBootstrap } from './account-completion-fixture.mjs';

const scope = 'a'.repeat(64);
const journal = 'backend/supabase/migrations/20261020230653_account_pending_completion_journal_1643.sql';
const candidate = 'backend/supabase/migrations/20261112133000_recording_start_abandonment_1643.sql';
const consumed: { file: string; sha256: string; beforeSha256: string; afterSha256: string }[] = [];
type Account = { user: string; lease: string; hash: string; request: string };
let db: PGlite, index = 0;

const sql = async (text: string) => { await db.exec('RESET ROLE'); return db.exec(text); };
const value = async <T = unknown>(text: string): Promise<T> => {
  const result = await sql(text);
  return Object.values(result.at(-1)?.rows?.[0] ?? {})[0] as T;
};
const failure = async (text: string) => {
  try { await sql(text); return null; } catch (error) { return String((error as Error).message); }
};
const service = (text: string) => `SET ROLE service_role; ${text}`;
const as = (a: Account, text: string) => `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${a.user}',false); ${text}`;
const acquire = (a: Account, lease = a.lease) => value<Record<string, unknown>>(as(a, `SELECT acquire_recording_lease('${lease}','synthetic',false)`));
const release = (a: Account) => value<Record<string, unknown>>(as(a, `SELECT release_recording_lease('${a.lease}')`));
const abandon = (a: Account, lease: string | null = a.lease) =>
  value<Record<string, unknown>>(as(a, `SELECT abandon_recording_start_v1(${lease === null ? 'NULL' : `'${lease}'`})`));
const create = (a: Account, lease: string | null = a.lease) => value<Record<string, unknown>>(as(a,
  `SELECT create_session_and_update_usage('{"title":"synthetic","duration":0${lease ? `,"lease_id":"${lease}"` : ''}}'::jsonb,'private')`));
const phase = (a: Account, lease = a.lease) =>
  value<string>(`SELECT coalesce((SELECT phase FROM account_save_obligations WHERE user_id='${a.user}' AND lease_id='${lease}'),'none')`);
const abandoned = (a: Account) => value<number>(`SELECT count(*)::int FROM recording_start_abandonments WHERE user_id='${a.user}' AND lease_id='${a.lease}'`);
const sessions = (a: Account) => value<number>(`SELECT count(*)::int FROM sessions WHERE user_id='${a.user}'`);
const claim = (a: Account) => value<Record<string, unknown> | null>(service(`SELECT claim_account_pending_completion_v1('${a.user}','${a.request}','${scope}')`));

async function seed(): Promise<Account> {
  const suffix = String(++index).padStart(12, '0');
  const a: Account = { user: `b9310000-0000-4000-8000-${suffix}`, lease: `b9320000-0000-4000-8000-${suffix}`, hash: String(index).padStart(64, 'a'), request: '' };
  await sql(`INSERT INTO auth.users VALUES('${a.user}','start-abandonment-${index}@example.test',now());
    UPDATE user_profiles SET subscription_status='pro',stripe_customer_id='cus_start_${index}' WHERE id='${a.user}';`);
  await sql(service(`SELECT issue_account_closure_pending_token('${a.user}','${a.hash}')`));
  a.request = await value<string>(`SELECT request_id FROM account_closure_tokens WHERE user_id='${a.user}'`);
  return a;
}
async function pending(a: Account) {
  expect(await value(service(`SELECT begin_account_closure_pending('${a.user}','${a.hash}',true)`))).not.toBeNull();
  await sql(`INSERT INTO account_completion_coverage VALUES('${a.user}','${a.request}','${scope}',
    'synthetic fixture legacy coverage; not production proof','synthetic fixture portal settlement; not provider proof')`);
  const h = 'c' + a.hash.slice(1);
  expect(await value(service(`SELECT issue_account_completion_status_v1('${a.user}','${a.request}','${scope}','${h}')`))).not.toBeNull();
  expect(await value(service(`SELECT acknowledge_account_completion_status_v1('${a.user}','${a.request}','${scope}','${h}')`))).toBe(true);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(completionBootstrap());
  await db.exec(`SET ROLE closure_owner; ${readFileSync(journal, 'utf8')} RESET ROLE;`);
  await sql(`UPDATE account_completion_configuration SET enabled=true,scope_digest='${scope}'`);
  // Prior-source reproduction: a lease with no take is admitted save debt that release never settles.
  const a = await seed();
  assert.equal((await acquire(a)).acquired, true);
  assert.equal((await release(a)).released, true);
  assert.equal(await phase(a), 'admitted');
  await pending(a);
  assert.deepEqual(await claim(a), { outcome: 'pending' });
  assert.match(String(await failure(`DELETE FROM auth.users WHERE id='${a.user}'`)), /admitted save unsettled/);
  const source = readFileSync(candidate);
  const beforeSha256 = createHash('sha256').update(source).digest('hex');
  await db.exec(`SET ROLE closure_owner; ${source.toString('utf8')} RESET ROLE;`);
  const afterSha256 = createHash('sha256').update(readFileSync(candidate)).digest('hex');
  assert.equal(afterSha256, beforeSha256, 'SQL bytes remain unchanged across actual execution');
  consumed.push({ file: candidate, sha256: beforeSha256, beforeSha256, afterSha256 });
  // The reproduced debt is settled by the explicit cancellation, and completion can then proceed.
  assert.deepEqual(await abandon(a), { abandoned: true, outcome: 'abandoned_not_recorded', repeated: false });
  assert.ok((await claim(a))?.executionId);
}, 30000);
afterAll(async () => {
  await db?.close();
  const binding = JSON.parse(process.env.TEST_EFFICACY_BINDING ?? 'null');
  if (binding?.sql) writeFileSync(binding.sql.witnessFile, JSON.stringify({ schemaVersion: 1,
    phaseId: binding.phaseId, bindingSha256: createHash('sha256').update(JSON.stringify(binding)).digest('hex'),
    consumer: 'tests/db/recording-start-abandonment.integration.test.ts', consumed }));
});

describe('missing-Start abandonment (#1643)', () => {
  it('the journal and the record stay closed to every client role; only authenticated may call the cancellation', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) for (const table of ['recording_start_abandonments', 'account_save_obligations'])
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
        expect(await value(`SELECT has_table_privilege('${role}','${table}','${privilege}')`), `${role} ${table} ${privilege}`).toBe(false);
    expect(await value(`SELECT relrowsecurity FROM pg_class WHERE oid='recording_start_abandonments'::regclass`)).toBe(true);
    for (const [role, allowed] of [['anon', false], ['authenticated', true], ['service_role', false]] as const)
      expect({ role, can: await value(`SELECT has_function_privilege('${role}','abandon_recording_start_v1(uuid)','EXECUTE')`) }).toEqual({ role, can: allowed });
  });

  it('a released no-take lease is settled as abandoned, not completed, with no session inserted', async () => {
    const a = await seed();
    await acquire(a); await release(a); await pending(a);
    expect(await claim(a)).toEqual({ outcome: 'pending' });
    expect(await abandon(a)).toEqual({ abandoned: true, outcome: 'abandoned_not_recorded', repeated: false });
    expect(await phase(a)).toBe('none');
    expect(await abandoned(a)).toBe(1);
    expect(await value(`SELECT count(*)::int FROM account_save_obligations WHERE user_id='${a.user}' AND phase='completed'`)).toBe(0);
    expect(await sessions(a)).toBe(0);
    expect((await claim(a))?.executionId).toBeTruthy();
  });

  it('a held no-take lease is removed and its identity is fenced for every later acquire, create and bind', async () => {
    const a = await seed();
    await acquire(a);
    expect((await abandon(a)).abandoned).toBe(true);
    expect(await value(`SELECT count(*)::int FROM active_recording_lease WHERE user_id='${a.user}'`)).toBe(0);
    expect((await create(a)).error).toBe('lease_not_held');
    expect(await failure(as(a, `SELECT acquire_recording_lease('${a.lease}','synthetic',false)`))).toMatch(/abandoned recording identity cannot be reused/);
    for (const status of ['failed', 'completed']) {
      expect(await failure(`INSERT INTO sessions(id,user_id,lease_id,status) VALUES(gen_random_uuid(),'${a.user}','${a.lease}','${status}')`)).toMatch(/abandoned recording identity cannot be bound/);
      expect(await failure(`INSERT INTO sessions(id,user_id,status) VALUES('${a.lease}','${a.user}','${status}')`)).toMatch(/abandoned recording identity cannot be bound/);
    }
    expect(await sessions(a)).toBe(0);
    const next = { ...a, lease: a.lease.replace('b932', 'b933') };
    expect((await acquire(next)).acquired).toBe(true);
    expect((await create(next)).new_session).toBeTruthy();
  });

  it('repeating the cancellation is idempotent', async () => {
    const a = await seed();
    await acquire(a);
    expect((await abandon(a)).repeated).toBe(false);
    expect(await abandon(a)).toEqual({ abandoned: true, outcome: 'abandoned_not_recorded', repeated: true });
    expect(await abandoned(a)).toBe(1);
  });

  it('refuses whenever a take exists: active, released, saved and legacy implicit takes keep their journal row', async () => {
    const a = await seed();
    await acquire(a);
    const id = ((await create(a)).new_session as { id: string }).id;
    expect(await abandon(a)).toEqual({ abandoned: false, reason: 'take_exists' });
    await release(a);
    expect(await abandon(a)).toEqual({ abandoned: false, reason: 'take_exists' });
    expect(await phase(a)).toBe('admitted');
    expect((await value<Record<string, unknown>>(as(a, `SELECT complete_session_v2('${id}','completed',30,NULL,'{"kind":"synthetic-control"}'::jsonb,3,70,6,'{}'::jsonb,'{}'::jsonb,'saved synthetic take')`))).success).toBe(true);
    expect(await phase(a)).toBe('completed');
    expect(await abandon(a)).toEqual({ abandoned: false, reason: 'take_exists' });
    expect(await abandoned(a)).toBe(0);
    const legacy = await seed();
    const legacyId = ((await create(legacy, null)).new_session as { id: string }).id;
    expect(await phase(legacy, legacyId)).toBe('admitted');
    expect(await abandon(legacy, legacyId)).toEqual({ abandoned: false, reason: 'take_exists' });
    expect(await phase(legacy, legacyId)).toBe('admitted');
  });

  it('wrong user, unknown identity and unauthenticated calls are refused without effect', async () => {
    const a = await seed(), b = await seed();
    await acquire(a);
    expect(await abandon(b, a.lease)).toEqual({ abandoned: false, reason: 'unknown_identity' });
    expect(await abandon(a, b.lease)).toEqual({ abandoned: false, reason: 'unknown_identity' });
    expect(await abandon(a, null)).toEqual({ abandoned: false, reason: 'unknown_identity' });
    expect(await value(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','',false); SELECT abandon_recording_start_v1('${a.lease}')`))
      .toEqual({ abandoned: false, reason: 'unauthenticated' });
    expect(await failure(service(`SELECT abandon_recording_start_v1('${a.lease}')`))).toMatch(/permission denied/);
    expect(await phase(a)).toBe('admitted');
    expect(await abandoned(a)).toBe(0);
    // Another account's row carrying this id is uncertainty, never proof of absence.
    const c = await seed();
    await acquire(c); await release(c);
    await sql(`INSERT INTO sessions(id,user_id,lease_id,status) VALUES(gen_random_uuid(),'${b.user}','${c.lease}','failed')`);
    expect(await abandon(c)).toEqual({ abandoned: false, reason: 'take_exists' });
    expect(await phase(c)).toBe('admitted');
  });

  it('the record goes with the account and never blocks its deletion', async () => {
    const a = await seed();
    await acquire(a); await abandon(a);
    expect(await failure(`DELETE FROM auth.users WHERE id='${a.user}'`)).toBeNull();
    expect(await abandoned(a)).toBe(0);
  });
});
