// @vitest-environment node
// #1643 follow-up (PO 2026-11-19: "make sure save records are deleted"): the candidate service_role-only save-journal cleanup
// functions executed in PostgreSQL WASM over the actual recording, admission, completion-journal and abandonment migrations.
// Sequential semantics only. Native lock serialization and the shared live cleanup step are
// tests/db/deleted-account-save-journal-cleanup-realpg.test.mjs. Not hosted ACL, provider, deletion or live evidence.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { completionBootstrap } from './account-completion-fixture.mjs';

const scope = 'a'.repeat(64);
const journal = 'backend/supabase/migrations/20261020230653_account_pending_completion_journal_1643.sql';
const abandonment = 'backend/supabase/migrations/20261112133000_recording_start_abandonment_1643.sql';
const candidate = 'backend/supabase/migrations/20261119200000_deleted_account_save_journal_cleanup_1643.sql';
const DELETE_FN = 'delete_deleted_account_save_journal_v1';
const COUNT_FN = 'count_account_save_journal_v1';
const consumed: { file: string; sha256: string; beforeSha256: string; afterSha256: string }[] = [];
type Account = { user: string; n: number };
let db: PGlite, index = 0, prior: Account;

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
const rows = (a: Account) => value<number>(`SELECT count(*)::int FROM account_save_obligations WHERE user_id='${a.user}'`);
const snapshot = (a: Account) => value<string>(`SELECT coalesce(string_agg(lease_id::text||':'||phase,',' ORDER BY lease_id),'')
  FROM account_save_obligations WHERE user_id='${a.user}'`);
const deleteAuth = (a: Account) => sql(`DELETE FROM auth.users WHERE id='${a.user}'`);
const cleanup = (a: Account | string) => value<number>(service(`SELECT ${DELETE_FN}('${typeof a === 'string' ? a : a.user}')`));
const count = (a: Account) => value<number>(service(`SELECT ${COUNT_FN}('${a.user}')`));

async function seed(): Promise<Account> {
  const suffix = String(++index).padStart(12, '0');
  const a: Account = { user: `c9210000-0000-4000-8000-${suffix}`, n: 0 };
  await sql(`INSERT INTO auth.users VALUES('${a.user}','save-journal-cleanup-${index}@example.test',now());
    UPDATE user_profiles SET subscription_status='pro' WHERE id='${a.user}';`);
  return a;
}
/** One take through the product RPCs: Start (lease), the take row, Stop + save (complete_session_v2), lease released. */
async function savedTake(a: Account) {
  const lease = `c922${String(++a.n).padStart(4, '0')}-0000-4000-8000-${a.user.slice(-12)}`;
  expect((await value<Record<string, unknown>>(as(a, `SELECT acquire_recording_lease('${lease}','synthetic',false)`))).acquired).toBe(true);
  const created = await value<{ new_session: { id: string } }>(as(a,
    `SELECT create_session_and_update_usage('{"title":"synthetic","duration":0,"lease_id":"${lease}"}'::jsonb,'private')`));
  const done = await value<Record<string, unknown>>(as(a, `SELECT complete_session_v2('${created.new_session.id}','completed',30,NULL,
    '{"kind":"synthetic-control"}'::jsonb,3,70,6,'{}'::jsonb,'{}'::jsonb,'saved synthetic take')`));
  expect(done.success).toBe(true);
  expect((await value<Record<string, unknown>>(as(a, `SELECT release_recording_lease('${lease}')`))).released).toBe(true);
  expect(await value(`SELECT phase FROM account_save_obligations WHERE user_id='${a.user}' AND lease_id='${lease}'`)).toBe('completed');
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(completionBootstrap());
  for (const file of [journal, abandonment]) await db.exec(`SET ROLE closure_owner; ${readFileSync(file, 'utf8')} RESET ROLE;`);
  await sql(`UPDATE account_completion_configuration SET enabled=true,scope_digest='${scope}'`);
  // Prior-source reproduction: finished save-journal rows outlive Auth deletion and service_role can neither read nor delete them.
  prior = await seed(); await savedTake(prior); await savedTake(prior);
  await deleteAuth(prior);
  assert.equal(await rows(prior), 2, 'the residue: both finished rows outlive the account');
  assert.match(String(await failure(service(`SELECT count(*) FROM account_save_obligations WHERE user_id='${prior.user}'`))), /permission denied/);
  assert.match(String(await failure(service(`DELETE FROM account_save_obligations WHERE user_id='${prior.user}'`))), /permission denied/);
  assert.match(String(await failure(service(`SELECT ${DELETE_FN}('${prior.user}')`))), /does not exist/);
  const source = readFileSync(candidate);
  const beforeSha256 = createHash('sha256').update(source).digest('hex');
  await db.exec(`SET ROLE closure_owner; ${source.toString('utf8')} RESET ROLE;`);
  const afterSha256 = createHash('sha256').update(readFileSync(candidate)).digest('hex');
  assert.equal(afterSha256, beforeSha256, 'SQL bytes remain unchanged across actual execution');
  consumed.push({ file: candidate, sha256: beforeSha256, beforeSha256, afterSha256 });
}, 60000);
afterAll(async () => {
  await db?.close();
  const binding = JSON.parse(process.env.TEST_EFFICACY_BINDING ?? 'null');
  if (binding?.sql) writeFileSync(binding.sql.witnessFile, JSON.stringify({ schemaVersion: 1,
    phaseId: binding.phaseId, bindingSha256: createHash('sha256').update(JSON.stringify(binding)).digest('hex'),
    consumer: 'tests/db/deleted-account-save-journal-cleanup.integration.test.ts', consumed }));
});

describe('deleted-account save-journal cleanup (#1643)', () => {
  it('only service_role may execute; the journal stays closed to every client role; definer with an empty search_path', async () => {
    for (const fn of [`${DELETE_FN}(uuid)`, `${COUNT_FN}(uuid)`]) {
      for (const [role, allowed] of [['anon', false], ['authenticated', false], ['service_role', true], ['public', false]] as const)
        expect({ role, fn, can: await value(`SELECT has_function_privilege('${role}','${fn}','EXECUTE')`) }).toEqual({ role, fn, can: allowed });
      expect(await value(`SELECT prosecdef FROM pg_proc WHERE oid='${fn}'::regprocedure`)).toBe(true);
      expect(await value(`SELECT proconfig::text FROM pg_proc WHERE oid='${fn}'::regprocedure`)).toBe('{"search_path=\\"\\""}');
    }
    for (const role of ['anon', 'authenticated', 'service_role']) for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
      expect(await value(`SELECT has_table_privilege('${role}','account_save_obligations','${privilege}')`), `${role} ${privilege}`).toBe(false);
  });

  it('a non-service caller is refused and changes nothing', async () => {
    const a = await seed(); await savedTake(a); await deleteAuth(a);
    for (const role of ['anon', 'authenticated']) {
      expect(await failure(`SET ROLE ${role}; SELECT ${DELETE_FN}('${a.user}')`)).toMatch(/permission denied/);
      expect(await failure(`SET ROLE ${role}; SELECT ${COUNT_FN}('${a.user}')`)).toMatch(/permission denied/);
    }
    expect(await rows(a)).toBe(1);
  });

  it('is refused while the account still exists: a live account\'s journal is never touched', async () => {
    const a = await seed(); await savedTake(a);
    const before = await snapshot(a);
    expect(await failure(service(`SELECT ${DELETE_FN}('${a.user}')`))).toMatch(/account still exists/);
    expect(await snapshot(a)).toBe(before);
  });

  it('removes only the deleted account\'s finished rows and reads back zero; other accounts untouched; repeat is idempotent', async () => {
    const a = await seed(), b = await seed(), live = await seed();
    await savedTake(a); await savedTake(a);
    await savedTake(b); await savedTake(b); await savedTake(b);
    await savedTake(live);
    await deleteAuth(a); await deleteAuth(b);
    const bBefore = await snapshot(b), liveBefore = await snapshot(live);
    expect(await count(a)).toBe(2);
    expect(await count(live)).toBe(1);
    expect(await cleanup(a)).toBe(0);
    expect(await rows(a)).toBe(0);
    expect(await count(a)).toBe(0);
    expect(await snapshot(b)).toBe(bBefore);
    expect(await snapshot(live)).toBe(liveBefore);
    expect(await cleanup(a)).toBe(0);
    // The prior-source residue is cleanable now too.
    expect(await cleanup(prior)).toBe(0);
    expect(await rows(prior)).toBe(0);
  });

  it('is refused while any row of the deleted account is unsettled, and while a product closure completion is processing', async () => {
    const a = await seed(); await savedTake(a); await deleteAuth(a);
    // An unsettled row cannot arise through the product (the delete guard refuses), so it is planted directly.
    await sql(`INSERT INTO account_save_obligations(user_id,lease_id,phase) VALUES('${a.user}',gen_random_uuid(),'admitted')`);
    const before = await snapshot(a);
    expect(await failure(service(`SELECT ${DELETE_FN}('${a.user}')`))).toMatch(/account admitted save unsettled/);
    expect(await snapshot(a)).toBe(before);
    const b = await seed(); await savedTake(b); await deleteAuth(b);
    await sql(`INSERT INTO account_completion_executions(user_id,request_id,execution_id,scope_digest,expires_at)
      VALUES('${b.user}',gen_random_uuid(),gen_random_uuid(),'${scope}',now()+interval '5 minutes')`);
    const bBefore = await snapshot(b);
    expect(await failure(service(`SELECT ${DELETE_FN}('${b.user}')`))).toMatch(/account closure completion in progress/);
    expect(await snapshot(b)).toBe(bBefore);
    await sql(`UPDATE account_completion_executions SET phase='completed' WHERE user_id='${b.user}'`);
    expect(await cleanup(b)).toBe(0);
  });

  it('a null id is refused; an id with no rows returns zero', async () => {
    expect(await failure(service(`SELECT ${DELETE_FN}(NULL)`))).toMatch(/account id required/);
    expect(await cleanup('c9290000-0000-4000-8000-000000000000')).toBe(0);
  });
});
