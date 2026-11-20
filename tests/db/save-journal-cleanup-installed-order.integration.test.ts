// @vitest-environment node
// #1906 (Sam's review: "the exact-apply and installed-order proof is also still outstanding"). The deleted-account save-journal
// cleanup migration (20261119200000) applied as its EXACT bytes on top of the production-equivalent chain, in installed order:
// every earlier migration in version order with the two withheld migrations skipped (as the #1863/#1835 exact-apply gate test
// does), ending at the last migration production holds (20261117105700, #1835). It must apply cleanly, add exactly its own
// objects (one table, six functions) with exactly the expected grants, and change NOTHING else in the catalog. Then the
// functions run on that chain: a run cleans only the deleted account it claimed, and another run's account is refused; a run whose
// cleanup crashed after the Auth deletion resumes its own claim on restart, and another run cannot; a restarted run that knows only
// its run binding (no account id) finds and finishes its own claim, and another run's binding finds nothing.
// #1827's repeat-tip migration (20261119120000) merged before this one and is not in production yet, so either may reach
// production first: the target must add the same objects on top of it, and both orders must end in the same catalog.
// Offline only (PGlite). This is not the exact-apply allowlist entry or a production postflight; those belong to the release lane.
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, it } from 'vitest';

const DIR = 'backend/supabase/migrations';
const TARGET = '20261119200000';
const LAST_IN_PRODUCTION = '20261117105700';
const WITHHELD = new Set(['20261027192550', '20261112130000']);
const UNRELEASED_BEFORE_TARGET = ['20261119120000']; // #1827 repeat tip: merged, not yet in production
const BOOT = readFileSync('tests/db/trial-read-access-current-chain.integration.test.ts', 'utf8').split('const BOOTSTRAP = `')[1].split('`;')[0];
const TARGET_FILE = readdirSync(DIR).find(f => f.startsWith(`${TARGET}_`))!;
const FNS = ['claim_account_save_journal_cleanup_v1', 'resume_account_save_journal_cleanup_v1', 'delete_deleted_account_save_journal_v1', 'count_account_save_journal_v1',
  'resume_run_account_save_journal_cleanups_v1', 'list_unfinished_account_save_journal_cleanup_runs_v1'];

let db: PGlite;
let ledgerBefore: string[]; let ledgerAfter: string[];
let before: Record<string, string[]>; let after: Record<string, string[]>;
const colOn = async (pg: PGlite, query: string) => (await pg.query<Record<string, string>>(query)).rows.map(r => String(Object.values(r)[0]));
const col = (query: string) => colOn(db, query);
const migrationFile = (v: string) => readdirSync(DIR).find(f => f.startsWith(`${v}_`))!;
const applyVersion = async (pg: PGlite, v: string) => {
  await pg.exec(readFileSync(`${DIR}/${migrationFile(v)}`, 'utf8'));
  await pg.query('INSERT INTO supabase_migrations.schema_migrations VALUES ($1)', [v]);
};
/** The production-equivalent chain: every migration through LAST_IN_PRODUCTION in version order, withheld ones skipped. */
async function productionChain(): Promise<PGlite> {
  const pg = new PGlite();
  await pg.exec(BOOT);
  await pg.exec('CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY);');
  for (const f of readdirSync(DIR).filter(f => /^\d{8,14}_.+\.sql$/.test(f)).sort()) {
    const v = f.split('_')[0];
    if (v > LAST_IN_PRODUCTION) break;
    if (WITHHELD.has(v)) continue;
    await pg.exec(readFileSync(`${DIR}/${f}`, 'utf8'));
    await pg.query('INSERT INTO supabase_migrations.schema_migrations VALUES ($1)', [v]);
  }
  return pg;
}
let otherOrder: { added: Record<string, string[]>; removed: Record<string, string[]>; finalTargetFirst: Record<string, string[]>; finalVersionOrder: Record<string, string[]> };

/** Every catalog object a migration could touch in the API schemas, one comparable line each (bodies by md5, ACLs, config). */
async function catalog(pg: PGlite = db): Promise<Record<string, string[]>> {
  const col = (query: string) => colOn(pg, query);
  return {
    functions: await col(`SELECT p.oid::regprocedure::text||' definer='||p.prosecdef||' vol='||p.provolatile::text||' cfg='||coalesce(p.proconfig::text,'')
        ||' ret='||pg_get_function_result(p.oid)||' md5='||md5(p.prosrc)||' acl='||coalesce(p.proacl::text,'')
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','auth') ORDER BY 1`),
    relations: await col(`SELECT c.oid::regclass::text||' kind='||c.relkind::text||' rls='||c.relrowsecurity||' acl='||coalesce(c.relacl::text,'')
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth') AND c.relkind IN ('r','v','m','p') ORDER BY 1`),
    columns: await col(`SELECT c.table_schema||'.'||c.table_name||'.'||c.column_name||' '||c.data_type||' null='||c.is_nullable||' def='||coalesce(c.column_default,'')
      FROM information_schema.columns c WHERE c.table_schema IN ('public','auth') ORDER BY 1`),
    policies: await col(`SELECT schemaname||'.'||tablename||'.'||policyname||' '||cmd||' roles='||roles::text||' using='||coalesce(qual,'')||' check='||coalesce(with_check,'')
      FROM pg_policies WHERE schemaname IN ('public','auth') ORDER BY 1`),
    triggers: await col(`SELECT t.tgrelid::regclass::text||'.'||t.tgname||' enabled='||t.tgenabled::text||' '||pg_get_triggerdef(t.oid)
      FROM pg_trigger t WHERE NOT t.tgisinternal ORDER BY 1`),
    // Not-null constraints are left out here (PG18 lists them as constraints, PG16 does not); the columns list already pins nullability.
    constraints: await col(`SELECT conrelid::regclass::text||'.'||conname||' '||pg_get_constraintdef(oid)
      FROM pg_constraint WHERE contype <> 'n' AND connamespace IN ('public'::regnamespace,'auth'::regnamespace) ORDER BY 1`),
  };
}
const added = (k: string) => after[k].filter(x => !before[k].includes(x));
const removed = (k: string) => before[k].filter(x => !after[k].includes(x));

beforeAll(async () => {
  db = await productionChain();
  ledgerBefore = await col('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version');
  before = await catalog();
  const source = readFileSync(`${DIR}/${TARGET_FILE}`);
  await db.exec(source.toString('utf8'));
  await db.query('INSERT INTO supabase_migrations.schema_migrations VALUES ($1)', [TARGET]);
  assert.equal(createHash('sha256').update(readFileSync(`${DIR}/${TARGET_FILE}`)).digest('hex'), createHash('sha256').update(source).digest('hex'));
  ledgerAfter = await col('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version');
  after = await catalog();
  // The other order: the unreleased earlier migrations reach production first, then the target. Then the target-first chain
  // receives those migrations afterwards, and both must end in the same catalog.
  const versionOrder = await productionChain();
  try {
    for (const v of UNRELEASED_BEFORE_TARGET) await applyVersion(versionOrder, v);
    const pre = await catalog(versionOrder);
    await applyVersion(versionOrder, TARGET);
    const post = await catalog(versionOrder);
    const added2: Record<string, string[]> = {}, removed2: Record<string, string[]> = {};
    for (const k of Object.keys(pre)) { added2[k] = post[k].filter(x => !pre[k].includes(x)); removed2[k] = pre[k].filter(x => !post[k].includes(x)); }
    const targetFirst = await productionChain();
    try {
      await applyVersion(targetFirst, TARGET);
      for (const v of UNRELEASED_BEFORE_TARGET) await applyVersion(targetFirst, v);
      otherOrder = { added: added2, removed: removed2, finalTargetFirst: await catalog(targetFirst), finalVersionOrder: post };
    } finally { await targetFirst.close(); }
  } finally { await versionOrder.close(); }
}, 600_000);
afterAll(async () => { await db?.close(); });

describe('#1906 save-journal cleanup: exact bytes in installed order on the production-equivalent chain', () => {
  it('applies directly after the last migration production holds, with nothing between and the withheld migrations still absent', () => {
    assert.equal(ledgerBefore.at(-1), LAST_IN_PRODUCTION, 'the predecessor ledger ends where production does');
    const later = readdirSync(DIR).map(f => f.split('_')[0]).filter(v => /^\d{14}$/.test(v) && v > LAST_IN_PRODUCTION);
    assert.deepEqual(later, [...UNRELEASED_BEFORE_TARGET, TARGET], 'only the reviewed unreleased migrations sit between production and this target');
    assert.deepEqual(ledgerAfter, [...ledgerBefore, TARGET]);
    for (const v of WITHHELD) assert.ok(!ledgerAfter.includes(v), `withheld ${v} stays unapplied`);
  });

  it('adds exactly its own table and six functions; nothing else in the catalog changes', () => {
    for (const k of Object.keys(before)) assert.deepEqual(removed(k), [], `${k}: nothing changed or removed`);
    assert.deepEqual(added('relations'), ['account_save_journal_cleanup_claims kind=r rls=true acl={postgres=arwdDxtm/postgres}']);
    assert.deepEqual(added('functions').map(x => x.split(' ')[0]),
      ['claim_account_save_journal_cleanup_v1(uuid,jsonb,text)', 'count_account_save_journal_v1(uuid)', 'delete_deleted_account_save_journal_v1(uuid,text)',
        'list_unfinished_account_save_journal_cleanup_runs_v1(integer)', 'resume_account_save_journal_cleanup_v1(uuid,text,jsonb,text)',
        'resume_run_account_save_journal_cleanups_v1(jsonb,text)']);
    for (const fn of added('functions')) {
      assert.match(fn, / definer=true /, fn);
      assert.match(fn, / cfg=\{"search_path=\\"\\""\} /, fn);
      assert.match(fn, / acl=\{postgres=X\/postgres,service_role=X\/postgres\}$/, fn);
    }
    assert.deepEqual(added('columns'), ['public.account_save_journal_cleanup_claims.claimed_at timestamp with time zone null=NO def=clock_timestamp()',
      'public.account_save_journal_cleanup_claims.email_sha256 bytea null=NO def=', 'public.account_save_journal_cleanup_claims.run_binding jsonb null=YES def=', 'public.account_save_journal_cleanup_claims.token_sha256 bytea null=NO def=',
      'public.account_save_journal_cleanup_claims.user_id uuid null=NO def=']);
    assert.deepEqual(added('constraints').map(c => c.split(' ')[0]).sort(), ['account_save_journal_cleanup_claims.account_save_journal_cleanup_claims_email_sha256_check',
      'account_save_journal_cleanup_claims.account_save_journal_cleanup_claims_pkey',
      'account_save_journal_cleanup_claims.account_save_journal_cleanup_claims_run_binding_check', 'account_save_journal_cleanup_claims.account_save_journal_cleanup_claims_token_sha256_check']);
    assert.deepEqual([added('policies'), added('triggers')], [[], []], 'no policy and no trigger');
  });

  it('applies the same way after the unreleased #1827 migration, and both orders end in the same catalog', () => {
    for (const k of Object.keys(before)) {
      assert.deepEqual(otherOrder.removed[k], [], `${k}: nothing changed or removed after #1827 either`);
      assert.deepEqual(otherOrder.added[k], added(k), `${k}: the same objects are added after #1827`);
      assert.deepEqual(otherOrder.finalTargetFirst[k], otherOrder.finalVersionOrder[k], `${k}: either order ends in the same catalog`);
    }
  });

  it('runs on that chain: a run cleans only the deleted account it claimed; another run naming it is refused', async () => {
    // Supabase Auth keeps app_metadata in auth.users.raw_app_meta_data; the shared bootstrap omits the column.
    await db.exec('ALTER TABLE auth.users ADD COLUMN raw_app_meta_data jsonb');
    const run = (runId: string) => ({ repository: 'relativityE/speaksharp', workflow: 'relativityE/speaksharp/.github/workflows/rc-gates.yml@refs/heads/main', runId, runAttempt: '1', role: 'rwt-journey' });
    const mine = 'c9310000-0000-4000-8000-000000000001', theirs = 'c9310000-0000-4000-8000-000000000002';
    const [s1, s2] = ['1', '2'].map(d => d.repeat(64));
    for (const [id, runId] of [[mine, '44000000001'], [theirs, '44000000002']])
      await db.query('INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES($1,$2,$3::jsonb)', [id, `rwt-journey-order-${id.slice(-1)}@example.test`, JSON.stringify({ ct_run: run(runId) })]);
    await db.exec(`INSERT INTO public.account_save_obligations(user_id,lease_id,phase) VALUES
      ('${mine}',gen_random_uuid(),'completed'),('${theirs}',gen_random_uuid(),'completed'),('${theirs}',gen_random_uuid(),'completed')`);
    const svc = async (q: string) => { await db.exec('SET ROLE service_role'); try { return (await db.query<Record<string, unknown>>(q)).rows; } finally { await db.exec('RESET ROLE'); } };
    await svc(`SELECT public.claim_account_save_journal_cleanup_v1('${mine}','${JSON.stringify(run('44000000001'))}'::jsonb,'${s1}')`);
    await svc(`SELECT public.claim_account_save_journal_cleanup_v1('${theirs}','${JSON.stringify(run('44000000002'))}'::jsonb,'${s2}')`);
    await db.exec(`DELETE FROM auth.users WHERE id IN ('${mine}','${theirs}')`);
    await assert.rejects(() => svc(`SELECT public.delete_deleted_account_save_journal_v1('${theirs}','${s1}')`), /not claimed by this run/);
    assert.deepEqual(await col(`SELECT count(*)::text FROM public.account_save_obligations WHERE user_id='${theirs}'`), ['2']);
    assert.deepEqual(await svc(`SELECT public.delete_deleted_account_save_journal_v1('${mine}','${s1}') AS n`), [{ n: 0 }]);
    assert.deepEqual(await col(`SELECT count(*)::text FROM public.account_save_journal_cleanup_claims WHERE user_id='${mine}'`), ['0']);
    // Restart after a crash (Sam, #1906): run B's cleanup died after the Auth deletion, so its secret s2 is gone. Run A cannot take
    // over B's claim; B, restarting with its own binding and the account's address, hands the claim a fresh secret and finishes.
    const s3 = '3'.repeat(64);
    const resume = (runId: string, email: string) => svc(`SELECT public.resume_account_save_journal_cleanup_v1('${theirs}','${email}','${JSON.stringify(run(runId))}'::jsonb,'${s3}')`);
    await assert.rejects(() => resume('44000000001', 'rwt-journey-order-2@example.test'), /not claimed by this run/);
    await assert.rejects(() => resume('44000000002', 'rwt-journey-order-1@example.test'), /not claimed by this run/);
    await resume('44000000002', 'rwt-journey-order-2@example.test');
    await assert.rejects(() => svc(`SELECT public.delete_deleted_account_save_journal_v1('${theirs}','${s2}')`), /not claimed by this run/);
    assert.deepEqual(await svc(`SELECT public.delete_deleted_account_save_journal_v1('${theirs}','${s3}') AS n`), [{ n: 0 }]);
    assert.deepEqual(await col(`SELECT count(*)::text FROM public.account_save_obligations WHERE user_id IN ('${mine}','${theirs}')`), ['0']);
    // Restart with NO account id (Sam, #1906): run C's process died after deleting its account; a fresh process has only run C's
    // binding. Run D's binding finds nothing; run C's finds exactly that account and finishes it.
    const lost = 'c9310000-0000-4000-8000-000000000003', s4 = '4'.repeat(64), s5 = '5'.repeat(64);
    await db.query('INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES($1,$2,$3::jsonb)', [lost, 'rwt-journey-order-3@example.test', JSON.stringify({ ct_run: run('44000000003') })]);
    await db.exec(`INSERT INTO public.account_save_obligations(user_id,lease_id,phase) VALUES('${lost}',gen_random_uuid(),'completed')`);
    await svc(`SELECT public.claim_account_save_journal_cleanup_v1('${lost}','${JSON.stringify(run('44000000003'))}'::jsonb,'${s4}')`);
    await db.exec(`DELETE FROM auth.users WHERE id='${lost}'`);
    const byRun = async (runId: string) => JSON.parse(String((await svc(`SELECT public.resume_run_account_save_journal_cleanups_v1('${JSON.stringify(run(runId))}'::jsonb,'${s5}')::text AS r`))[0].r));
    assert.deepEqual(await byRun('44000000004'), { count: 0, ids: [] });
    const inventory = JSON.parse(String((await svc(`SELECT public.list_unfinished_account_save_journal_cleanup_runs_v1(0)::text AS r`))[0].r));
    assert.deepEqual(inventory, { claims: 1, live: 0, unbound: 0, runs: [{ binding: run('44000000003'), claims: 1, recent: 0 }] });
    assert.deepEqual(await byRun('44000000003'), { count: 1, ids: [lost] });
    assert.deepEqual(await svc(`SELECT public.delete_deleted_account_save_journal_v1('${lost}','${s5}') AS n`), [{ n: 0 }]);
    assert.deepEqual(await col(`SELECT count(*)::text FROM public.account_save_journal_cleanup_claims`), ['0']);
    for (const fn of FNS) assert.equal((await col(`SELECT count(*)::text FROM pg_proc WHERE proname='${fn}'`))[0], '1');
  });
});
