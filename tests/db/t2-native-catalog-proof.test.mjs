// Protocol/negative controls only. Fake SQL is NOT native database evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNativeT2CatalogProof } from './t2-native-catalog-proof.mjs';
import { T2_VERSIONS, t2ExpectedCatalog } from '../../scripts/lib/t2MigrationPostflight.mjs';
import { EXACT_MIGRATION_ALLOWLIST } from '../../scripts/lib/exactMigrationGate.mjs';

const sources = Object.fromEntries(T2_VERSIONS.map(v => [v, readFileSync(new URL(
  '../../backend/supabase/migrations/' + EXACT_MIGRATION_ALLOWLIST.find(x => x.version === v).file,
  import.meta.url), 'utf8')]));
const identity = { profile: 'main-t2-account-126', environment: 'disposable',
  treeClean: true, selectedPostgresVersion: '17.6.1.155',
  testedCommit: '1c2932550de0a083f159df2f2fe7c9a3cfd27b82',
  requestedHead: '1c2932550de0a083f159df2f2fe7c9a3cfd27b82',
  ownedContainer: 'supabase_db_closure-proof-0123456789abcdef',
  imageDigest: 'ghcr.io/supabase/postgres@sha256:3866d94d8426927e8db3f1c5d790752292bfbe27b5f1f46e199ae1b7d3c1710b' };
const expected = stage => t2ExpectedCatalog(stage === 0 ? 'before' : 'after', T2_VERSIONS[Math.max(0, stage - 1)]);
function fixture(mutate = () => {}) {
  const saved = [], queries = [];
  let call = 0;
  const proof = createNativeT2CatalogProof({ identity, sources,
    retain: r => saved.push(r),
    sql: query => {
      const stage = call++;
      queries.push(query);
      const row = [JSON.stringify({ version: 'PostgreSQL 17.6 on aarch64', serverVersionNum: '170006', readOnly: 'on', database: 'postgres' }),
        JSON.stringify(expected(stage)), JSON.stringify(stage === 6
          ? { billing_disabled: true, completion_disabled: true } : { billing_disabled: true }), 'true', 'true'];
      mutate(row, stage);
      return row.join('\n');
    },
  });
  return { proof, saved, queries };
}

test('exact seven read-only snapshots, no earlier PASS; retained evidence bound to source and owned image', () => {
  const { proof, saved, queries } = fixture();
  for (let n = 0; n < 7; n++) {
    proof.record(n);
    assert.equal(proof.report().status, 'INCOMPLETE');
  }
  const done = proof.finish();
  assert.equal(done.status, 'PASS');
  assert.equal(done.stages.length, 7);
  assert.deepEqual(done.identity, identity);
  assert.equal(Object.keys(done.sourceHashes).length, 6);
  assert.equal(saved.at(-1).status, 'PASS');
  for (const q of queries) {
    assert.match(q, /^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;/);
    assert.match(q, /SET LOCAL search_path=public,pg_temp/);
    assert.doesNotMatch(q, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\s+(?:INTO|TABLE|FUNCTION)/);
  }
});

for (let broken = 0; broken < 7; broken++) {
  test(`stage${broken}: actual catalog digest drift is rejected and retained, later snapshots cannot repair it`, () => {
    const { proof, saved } = fixture((row, stage) => {
      if (stage === broken) {
        const catalog = JSON.parse(row[1]);
        catalog[Object.keys(catalog)[0]] = '0'.repeat(32);
        row[1] = JSON.stringify(catalog);
      }
    });
    for (let n = 0; n < broken; n++) proof.record(n);
    assert.throws(() => proof.record(broken), /T2 catalog mismatch/);
    assert.equal(saved.at(-1).status, 'FAIL');
    assert.equal(saved.at(-1).stages.at(-1).status, 'FAIL');
    assert.match(saved.at(-1).stages.at(-1).output, /00000000000000000000000000000000/);
    assert.throws(() => proof.record(broken + 1), /already failed/);
    assert.throws(() => proof.finish(), /proof failed/);
  });
}

for (const [name, change, reason] of [
  ['missing metadata object', r => { const c = JSON.parse(r[1]); delete c[Object.keys(c)[0]]; r[1] = JSON.stringify(c); }, /catalog mismatch/],
  ['extra metadata object', r => { const c = JSON.parse(r[1]); c['function:public.unexpected()'] = '0'.repeat(32); r[1] = JSON.stringify(c); }, /catalog mismatch/],
  ['ledger gap', r => { r[3] = 'false'; }, /ledger prefix mismatch/],
  ['admission ACL drift', r => { r[4] = 'false'; }, /admission\/ACL mismatch/],
  ['enabled legacy rollout', r => { r[2] = '{"billing_disabled":false}'; }, /inactive authority/],
  ['non-native runtime', r => { r[0] = r[0].replace('PostgreSQL 17.6', 'PGlite'); }, /native PostgreSQL17/],
  ['read-write snapshot', r => { r[0] = r[0].replace('"on"', '"off"'); }, /must be read-only/],
  ['wrong database', r => { r[0] = r[0].replace('"postgres"', '"other"'); }, /other/],
  ['missing output line', r => { r.pop(); }, /incomplete/],
  ['malformed output', r => { r[1] = '{'; }, /JSON/],
]) test(`${name}: fail closed with actual failed output retained`, () => {
  const { proof, saved } = fixture(change);
  assert.throws(() => proof.record(0), reason);
  assert.equal(saved.at(-1).status, 'FAIL');
  assert.equal(saved.at(-1).stages[0].status, 'FAIL');
});

test('completion must remain disabled at stage6', () => {
  const { proof } = fixture((r, n) => { if (n === 6) r[2] = '{"billing_disabled":true,"completion_disabled":false}'; });
  for (let n = 0; n < 6; n++) proof.record(n);
  assert.throws(() => proof.record(6), /inactive authority/);
});
test('all six partial completions plus zero snapshots refuse final PASS', () => {
  for (let count = 0; count < 7; count++) {
    const { proof } = fixture();
    for (let n = 0; n < count; n++) proof.record(n);
    assert.throws(() => proof.finish(), /all seven/);
    assert.notEqual(proof.report().status, 'PASS');
  }
});
test('skipped/repeated/out-of-order hooks never count as seven', () => {
  for (const sequence of [[1], [0, 0], [0, 2]]) {
    const { proof } = fixture();
    for (const n of sequence.slice(0, -1)) proof.record(n);
    assert.throws(() => proof.record(sequence.at(-1)), /missing, repeated, reordered/);
    assert.throws(() => proof.finish(), /proof failed/);
  }
});
for (let omitted = 0; omitted < 7; omitted++) test(`omitting actual hook stage${omitted} cannot yield PASS`, () => {
  const { proof } = fixture();
  assert.throws(() => {
    for (let n = 0; n < 7; n++) if (n !== omitted) proof.record(n);
    proof.finish();
  }, /missing, repeated|all seven/);
  assert.notEqual(proof.report().status, 'PASS');
});
test('semantics-preserving JSON property order passes; no source-string oracle', () => {
  const { proof } = fixture(row => { row[1] = JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(row[1])).reverse())); });
  for (let n = 0; n < 7; n++) proof.record(n);
  assert.equal(proof.finish().status, 'PASS');
});
test('source pin change is refused before SQL', () => {
  let calls = 0;
  assert.throws(() => createNativeT2CatalogProof({ identity,
    sources: { ...sources, [T2_VERSIONS[0]]: sources[T2_VERSIONS[0]] + '\n-- drift' },
    sql: () => { calls++; }, retain() {} }), /migration source mismatch/);
  assert.equal(calls, 0);
});
for (const delta of [{ environment: 'production' }, { profile: 'main-120' },
  { requestedHead: '0'.repeat(40) }, { ownedContainer: 'production' }, { imageDigest: 'unverified' },
  { treeClean: false }, { selectedPostgresVersion: '17.6.1.106' },
  { imageDigest: 'ghcr.io/supabase/postgres@sha256:' + '0'.repeat(64) }]) {
  test(`source/target binding refuses ${JSON.stringify(delta)}`, () => {
    assert.throws(() => createNativeT2CatalogProof({ identity: { ...identity, ...delta }, sources, sql() {}, retain() {} }));
  });
}
test('transport error is a retained failure, not a skipped snapshot', () => {
  const saved = [];
  const proof = createNativeT2CatalogProof({ identity, sources, sql() { throw new Error('owned database exited'); }, retain: r => saved.push(r) });
  assert.throws(() => proof.record(0), /database exited/);
  assert.equal(saved.at(-1).status, 'FAIL');
  assert.throws(() => proof.finish(), /failed/);
});

const workflow = readFileSync(new URL('../../.github/workflows/account-closure-full-chain-proof.yml', import.meta.url), 'utf8');
const trigger = workflow.match(/^on:\n([\s\S]*?)^permissions:/m)?.[1] ?? '';
for (const file of ['tests/db/t2-native-catalog-proof.mjs', 'tests/db/t2-native-catalog-proof.test.mjs']) {
  test(`proof workflow triggers on independently changed ${file}`, () => {
    assert.ok(trigger.split('\n').some(line => line.trim() === `- '${file}'`), `missing explicit proof trigger: ${file}`);
  });
}
test('offline proof command collects the new test alongside the preserved replay-plan test', () => {
  const commands = [...workflow.matchAll(/^\s*run: node --test ([^\n]+)$/gm)].map(match => match[1].trim().split(/\s+/));
  assert.ok(commands.some(files => files.includes('tests/db/account-closure-full-chain-main-u1-plan.test.mjs')
    && files.includes('tests/db/t2-native-catalog-proof.test.mjs')), 'new proof test is not collected by the offline command');
});
