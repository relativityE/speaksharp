// @vitest-environment node
// #1827 outcome 4 D2: the exact-apply catalog gate for 20261119120000, executed against the real migration chain on PGlite:
// production-equivalent predecessors (billing settlement and the refund follow-up withheld), then the exact target bytes.
// "before" must pass on the predecessor catalog and "after" on the applied one; the committed expectation must re-derive byte for
// byte from the migration; and a tampered catalog (helper grant, trigger, column, constraint, index, ledger) must be refused.
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { REPEAT_TIP_VERSION, assertRepeatTipSnapshot, repeatTipContract, repeatTipSnapshotQuery } from '../../scripts/lib/repeatTipMigrationPostflight.mjs';

const DIR = 'backend/supabase/migrations';
const ROOT = process.cwd();
const BOOT = readFileSync('tests/db/trial-read-access-current-chain.integration.test.ts', 'utf8').split('const BOOTSTRAP = `')[1].split('`;')[0];
const WITHHELD = new Set(['20261027192550', '20261112130000']);
const file = (version: string) => readdirSync(DIR).find(f => f.startsWith(`${version}_`))!;

let db: PGlite;
const rows = async (query: string) => (await db.exec(query)).map(r => Object.values(r.rows[0] as Record<string, string>)[0]);
const ledgerAdd = (v: string) => db.query('INSERT INTO supabase_migrations.schema_migrations VALUES ($1) ON CONFLICT DO NOTHING', [v]);
const snapshotWith = async (mutation: string) => {
  await db.exec('BEGIN;' + mutation);
  try { return await rows(repeatTipSnapshotQuery()); } finally { await db.exec('ROLLBACK;'); }
};
let before: string[]; let after: string[];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BOOT);
  await db.exec('CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY);');
  for (const f of readdirSync(DIR).filter(f => /^\d{8,14}_.+\.sql$/.test(f)).sort()) {
    const v = f.split('_')[0];
    if (v >= REPEAT_TIP_VERSION) break;
    if (WITHHELD.has(v)) continue;
    await db.exec(readFileSync(`${DIR}/${f}`, 'utf8'));
    await ledgerAdd(v);
  }
  before = await rows(repeatTipSnapshotQuery());
  await db.exec(readFileSync(`${DIR}/${file(REPEAT_TIP_VERSION)}`, 'utf8'));
  await ledgerAdd(REPEAT_TIP_VERSION);
  after = await rows(repeatTipSnapshotQuery());
}, 600_000);
afterAll(async () => { await db?.close(); });

describe('#1827 D2 repeat-tip exact-apply catalog gate', () => {
  it('passes before on the predecessor catalog and after on the applied one', () => {
    assert.equal(assertRepeatTipSnapshot(repeatTipContract(ROOT, 'before', REPEAT_TIP_VERSION), before).target, 'absent');
    assert.equal(assertRepeatTipSnapshot(repeatTipContract(ROOT, 'after', REPEAT_TIP_VERSION), after).target, 'exact');
  });

  it('the committed expectation re-derives byte for byte from the exact migration', () => {
    const committed = JSON.parse(readFileSync('scripts/lib/repeatTipMigrationCatalog.json', 'utf8'));
    const [, functions, triggers, columns, relation] = after.map(r => JSON.parse(r));
    assert.deepEqual({ functions, triggers, columns, constraints: relation.constraints, indexes: relation.indexes },
      { functions: committed.functions, triggers: committed.triggers, columns: committed.columns,
        constraints: committed.constraints, indexes: committed.indexes });
    assert.equal(committed.targetSha256, createHash('sha256').update(readFileSync(`${DIR}/${file(REPEAT_TIP_VERSION)}`)).digest('hex'));
    assert.equal(committed.functions.length, 8);
    assert.equal(committed.triggers.length, 4);
    assert.equal(committed.columns.length, 3);
    for (const fn of committed.functions as Array<{ signature: string; acl: string[] }>) {
      assert.deepEqual(fn.acl, fn.signature.startsWith('public.register_practice_again_take_v1(') ? ['authenticated'] : [],
        `${fn.signature}: only the client RPC is executable, and only by authenticated`);
    }
  });

  it('NEGATIVE: a tampered catalog or ledger is refused', async () => {
    const contract = repeatTipContract(ROOT, 'after', REPEAT_TIP_VERSION);
    assert.throws(() => assertRepeatTipSnapshot(contract, [] as string[]), /incomplete/, 'empty snapshot');
    assert.throws(() => assertRepeatTipSnapshot(contract, null as unknown as string[]), /incomplete/, 'missing snapshot');
    const cases: Array<[string, string, RegExp]> = [
      ['helper granted to authenticated', 'GRANT EXECUTE ON FUNCTION public._prec_att_snapshot_tip() TO authenticated;', /executable by an API role/],
      ['client RPC granted to anon', 'GRANT EXECUTE ON FUNCTION public.register_practice_again_take_v1(uuid, uuid) TO anon;', /executable by an API role/],
      ['client RPC revoked from authenticated', 'REVOKE EXECUTE ON FUNCTION public.register_practice_again_take_v1(uuid, uuid) FROM authenticated;', /executable by an API role/],
      ['registration column dropped', 'ALTER TABLE public.progress_recommendation_attempts DROP COLUMN registered_session_id;', /catalog differs/],
      ['helper body changed', "CREATE OR REPLACE FUNCTION public._prec_att_lock_owner(p_user uuid) RETURNS void LANGUAGE sql AS 'SELECT 1';", /catalog differs/],
      ['session trigger dropped', 'DROP TRIGGER trg_sessions_prec_tip_on_completed ON public.sessions;', /catalog differs/],
      ['attempt trigger disabled', 'ALTER TABLE public.progress_recommendation_attempts DISABLE TRIGGER trg_prec_att_guard_tip;', /catalog differs/],
      ['tip column made readable by anon', 'GRANT SELECT (practised_tip) ON public.progress_recommendation_attempts TO anon;', /catalog differs/],
      ['shape constraint dropped', 'ALTER TABLE public.progress_recommendation_attempts DROP CONSTRAINT prec_att_practised_tip_shape;', /catalog differs/],
      ['partial index dropped', 'DROP INDEX public.idx_prec_att_tip_session;', /catalog differs/],
    ];
    for (const [label, mutation, pattern] of cases) {
      const tampered = await snapshotWith(mutation);
      assert.throws(() => assertRepeatTipSnapshot(contract, tampered), pattern, label);
    }
    const ledger = (f: (l: string[]) => string[]) => after.map((r, i) => (i === 0 ? JSON.stringify(f(JSON.parse(r))) : r));
    assert.throws(() => assertRepeatTipSnapshot(contract, ledger(l => l.filter(v => v !== REPEAT_TIP_VERSION))), /ledger does not match/, 'ledger');
    assert.throws(() => assertRepeatTipSnapshot(contract, ledger(l => [...l, '20261112130000'])), /withheld migration applied/, 'withheld');
    assert.throws(() => assertRepeatTipSnapshot(contract, ledger(l => l.filter(v => v !== '20261117105700'))), /prerequisite not applied/, 'privacy first');
    assert.throws(() => assertRepeatTipSnapshot(repeatTipContract(ROOT, 'before', REPEAT_TIP_VERSION), after), /ledger does not match|already present/, 'before on applied');
  });
});
