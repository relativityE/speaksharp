// @vitest-environment node
// Release v2 (Sam, 18 Nov): the exact-apply catalog gates for #1863 (20261114170000) and #1835 (20261117105700), executed against the
// real migration chain on PGlite: production-equivalent predecessors (the two withheld migrations skipped), then each target's exact bytes.
// "before" must pass on the predecessor catalog and "after" on the applied one; the committed payment-wall expectation must re-derive
// byte for byte from the migration; and a tampered catalog (body, grant, policy, trigger, ledger) must be refused.
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { PAYMENT_WALL_VERSION, assertPaymentWallSnapshot, paymentWallContract, paymentWallSnapshotQuery } from '../../scripts/lib/paymentWallMigrationPostflight.mjs';
import { PRACTICE_PRIVACY_VERSION, assertPracticePrivacySnapshot, practicePrivacyContract, practicePrivacySnapshotQuery } from '../../scripts/lib/practicePrivacyMigrationPostflight.mjs';

const DIR = 'backend/supabase/migrations';
const ROOT = process.cwd();
const BOOT = readFileSync('tests/db/trial-read-access-current-chain.integration.test.ts', 'utf8').split('const BOOTSTRAP = `')[1].split('`;')[0];
const WITHHELD = new Set(['20261027192550', '20261112130000']);
const file = (version: string) => readdirSync(DIR).find(f => f.startsWith(`${version}_`))!;
const bytes = (version: string) => readFileSync(`${DIR}/${file(version)}`, 'utf8');

let db: PGlite;
const rows = async (query: string) => (await db.exec(query)).map(r => Object.values(r.rows[0] as Record<string, string>)[0]);
const ledgerAdd = (v: string) => db.query('INSERT INTO supabase_migrations.schema_migrations VALUES ($1) ON CONFLICT DO NOTHING', [v]);

type Fn = { signature: string; md5: string; acl: string[] };
type Trig = { name: string; enabled: string; conditional: boolean };
type Table = { rls: boolean; privileges: string[] };
/** One snapshot with row `index` rewritten by `f` (the parsed JSON in, any JSON out). */
const rewrite = <T,>(snapshot: string[], index: number, f: (value: T) => unknown) =>
  snapshot.map((r, i) => (i === index ? JSON.stringify(f(JSON.parse(r) as T)) : r));
let pwBefore: string[]; let pwAfter: string[]; let ppBefore: string[]; let ppAfter: string[];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BOOT);
  await db.exec('CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY);');
  for (const f of readdirSync(DIR).filter(f => /^\d{8,14}_.+\.sql$/.test(f)).sort()) {
    const v = f.split('_')[0];
    if (v >= PAYMENT_WALL_VERSION) break;
    if (WITHHELD.has(v)) continue;
    await db.exec(readFileSync(`${DIR}/${f}`, 'utf8'));
    await ledgerAdd(v);
  }
  pwBefore = await rows(paymentWallSnapshotQuery());
  await db.exec(bytes(PAYMENT_WALL_VERSION)); await ledgerAdd(PAYMENT_WALL_VERSION);
  pwAfter = await rows(paymentWallSnapshotQuery());
  ppBefore = await rows(practicePrivacySnapshotQuery());
  await db.exec(bytes(PRACTICE_PRIVACY_VERSION)); await ledgerAdd(PRACTICE_PRIVACY_VERSION);
  ppAfter = await rows(practicePrivacySnapshotQuery());
}, 600_000);
afterAll(async () => { await db?.close(); });

describe('#1863 payment wall exact-apply catalog gate', () => {
  it('passes before on the predecessor catalog and after on the applied one', () => {
    assert.equal(assertPaymentWallSnapshot(paymentWallContract(ROOT, 'before', PAYMENT_WALL_VERSION), pwBefore).target, 'absent');
    assert.equal(assertPaymentWallSnapshot(paymentWallContract(ROOT, 'after', PAYMENT_WALL_VERSION), pwAfter).target, 'exact');
  });

  it('the committed expectation re-derives byte for byte from the exact migration', () => {
    const committed = JSON.parse(readFileSync('scripts/lib/paymentWallMigrationCatalog.json', 'utf8'));
    const [, functions, policies, triggers] = pwAfter.map(r => JSON.parse(r));
    assert.deepEqual({ functions, policies, triggers }, { functions: committed.functions, policies: committed.policies, triggers: committed.triggers });
    assert.equal(committed.targetSha256, createHash('sha256').update(readFileSync(`${DIR}/${file(PAYMENT_WALL_VERSION)}`)).digest('hex'));
  });

  it('NEGATIVE: a tampered catalog or ledger is refused', () => {
    const contract = paymentWallContract(ROOT, 'after', PAYMENT_WALL_VERSION);
    const edit = <T,>(index: number, f: (value: T) => unknown) => rewrite<T>(pwAfter, index, f);
    assert.throws(() => assertPaymentWallSnapshot(contract, edit<Fn[]>(1, fns => fns.map((fn, i) => (i === 0 ? { ...fn, md5: '0'.repeat(32) } : fn)))), /catalog differs/, 'body');
    assert.throws(() => assertPaymentWallSnapshot(contract, edit<Fn[]>(1, fns => fns.map(fn => (fn.signature.includes('__unguarded') ? { ...fn, acl: ['authenticated'] } : fn)))), /catalog differs/, 'unguarded grant');
    assert.throws(() => assertPaymentWallSnapshot(contract, edit<Fn[]>(1, fns => fns.slice(1))), /catalog differs/, 'missing function');
    assert.throws(() => assertPaymentWallSnapshot(contract, edit<string[]>(2, pols => pols.slice(1))), /catalog differs/, 'dropped policy');
    assert.throws(() => assertPaymentWallSnapshot(contract, edit<string[]>(2, pols => pols.map((p, i) => (i === 0 ? p.replace('using=', 'using=true OR ') : p)))), /catalog differs/, 'weakened policy');
    assert.throws(() => assertPaymentWallSnapshot(contract, edit<Trig[]>(3, t => t.map(x => ({ ...x, enabled: 'D' })))), /catalog differs/, 'disabled trigger');
    assert.throws(() => assertPaymentWallSnapshot(contract, edit<string[]>(0, l => l.filter(v => v !== PAYMENT_WALL_VERSION))), /ledger does not match/, 'ledger');
    assert.throws(() => assertPaymentWallSnapshot(contract, edit<string[]>(0, l => [...l, '20261112130000'])), /withheld migration applied/, 'withheld');
    assert.throws(() => assertPaymentWallSnapshot(paymentWallContract(ROOT, 'before', PAYMENT_WALL_VERSION), pwAfter), /ledger does not match|already present/, 'before on applied');
  });
});

describe('#1835 practice privacy exact-apply catalog gate', () => {
  it('passes before after the payment wall, and after on the applied catalog', () => {
    const before = practicePrivacyContract(ROOT, 'before', PRACTICE_PRIVACY_VERSION);
    assert.equal(assertPracticePrivacySnapshot(before, ppBefore).target, 'absent');
    const after = practicePrivacyContract(ROOT, 'after', PRACTICE_PRIVACY_VERSION);
    const prior = { version: PRACTICE_PRIVACY_VERSION, targetSha256: after.targetSha256, rows: ppBefore };
    assert.equal(assertPracticePrivacySnapshot(after, ppAfter, prior).target, 'exact');
  });

  it('NEGATIVE: a tampered catalog, missing prior receipt or wrong ledger is refused', () => {
    const contract = practicePrivacyContract(ROOT, 'after', PRACTICE_PRIVACY_VERSION);
    const prior = { version: PRACTICE_PRIVACY_VERSION, targetSha256: contract.targetSha256, rows: ppBefore };
    const edit = <T,>(index: number, f: (value: T) => unknown) => rewrite<T>(ppAfter, index, f);
    assert.throws(() => assertPracticePrivacySnapshot(contract, edit<Fn[]>(1, f => f.map((fn, i) => (i === 3 ? { ...fn, md5: '0'.repeat(32) } : fn))), prior), /shape differs/, 'body');
    assert.throws(() => assertPracticePrivacySnapshot(contract, edit<Fn[]>(1, f => f.map((fn, i) => (i === 3 ? { ...fn, acl: [...fn.acl, 'authenticated'] } : fn))), prior), /ACL differs/, 'consent persist grant');
    assert.throws(() => assertPracticePrivacySnapshot(contract, edit<string[]>(2, () => ['service_role']), prior), /old persist still executable/, 'old persist');
    assert.throws(() => assertPracticePrivacySnapshot(contract, edit<Table>(3, t => ({ ...t, rls: false })), prior), /table grants differ/, 'rls off');
    assert.throws(() => assertPracticePrivacySnapshot(contract, edit<Table>(3, t => ({ ...t, privileges: [...t.privileges, 'anon:SELECT'] })), prior), /table grants differ/, 'anon select');
    assert.throws(() => assertPracticePrivacySnapshot(contract, edit<string[]>(4, p => p.slice(1)), prior), /policies differ/, 'policy dropped');
    assert.throws(() => assertPracticePrivacySnapshot(contract, edit<Trig[]>(5, t => t.map(x => (x.name === 'require_session_transcript_opt_in' ? { ...x, conditional: true } : x))), prior), /triggers differ/, 'conditional trigger');
    assert.throws(() => assertPracticePrivacySnapshot(contract, ppAfter, undefined), /prior receipt/, 'no prior');
    assert.throws(() => assertPracticePrivacySnapshot(contract, edit<string[]>(0, l => l.filter(v => v !== PAYMENT_WALL_VERSION)), prior), /prerequisite not applied/, 'payment wall first');
  });
});
