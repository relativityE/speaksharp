import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAIN_MIGRATION_SNAPSHOT, buildMainU1ReplayPlan, parseMainProofArguments } from './account-closure-full-chain.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => readFileSync(join(root, path), 'utf8');
// Independent pins reviewed from99585/e772, not values read back from the planner.
const U1 = Object.freeze({ name: '20261019010000_heartbeat_session_cap_keeps_take_open_1593.sql',
  version: '20261019010000', sha256: 'df02b867f5a4f29ee207a8b4359a82bb3b27abefd9eabe2eb5cd9960b4f0fb45' });
const baseTuplesSha256 = '601403209858cc31dba0f9125b1feebd535827d7e4bed469e2458e6ff7cda2b0';
const drain = '20261016180000_account_closure_drain_enforcement.sql';
const recovery = '20261017200000_checkout_rejection_recovery.sql';
const physical = readdirSync(join(root, 'backend/supabase/migrations')).filter(name => name.endsWith('.sql')).sort().map(name => ({
  name, version: name.match(/^(\d{8}|\d{14})_.+\.sql$/)?.[1] ?? null,
  sha256: hash(readFileSync(join(root, 'backend/supabase/migrations', name))),
}));
const main = physical.filter(row => row.name !== U1.name);
const receiving = [...main, U1].sort((a, b) => a.name.localeCompare(b.name, 'en'));
const versionsWithout = names => receiving.filter(row => row.version !== null && !names.includes(row.name)).map(row => row.version);

test('frozen independent main identity and exact physical source count', () => {
  assert.equal(main.length, 122);
  assert.equal(main.filter(row => row.version !== null).length, 120);
  assert.equal(receiving.length, 123);
  assert.equal(receiving.filter(row => row.version !== null).length, 121);
  const tuples = rows => rows.map(row => [row.name, row.version, row.sha256]);
  assert.equal(hash(JSON.stringify(tuples(main))), baseTuplesSha256);
  assert.equal(hash(JSON.stringify(tuples(MAIN_MIGRATION_SNAPSHOT))), baseTuplesSha256);
  assert.deepEqual(MAIN_MIGRATION_SNAPSHOT, main);
  // On the combined receiving branch the real U1 bytes must match, not merely the virtual planning row.
  const actualU1 = physical.find(row => row.name === U1.name);
  if (actualU1) assert.deepEqual(actualU1, U1);
});

test('main120 is the default and retains all three original ordered stages', () => {
  const plan = buildMainU1ReplayPlan(main);
  assert.equal(plan.profile, 'main-120');
  assert.equal(plan.migrations, 120);
  assert.equal(plan.executed, false);
  assert.deepEqual(plan.stages.map(row => [row.name, row.versions.length]), [
    ['baseline-before-drain', 118], ['drain-enforcement', 119], ['checkout-rejection-recovery', 120],
  ]);
  assert.deepEqual(plan.stages[0].versions, versionsWithout([drain, recovery, U1.name]));
  assert.deepEqual(plan.stages[1].versions, versionsWithout([recovery, U1.name]));
  assert.deepEqual(plan.stages[2].versions, versionsWithout([U1.name]));
});

test('explicit main-u1 keeps original118/119/120 byte identities and adds only U1 last121', () => {
  const base = buildMainU1ReplayPlan(main);
  const plan = buildMainU1ReplayPlan(receiving, 'main-u1-121');
  assert.equal(plan.migrations, 121);
  assert.equal(plan.executed, false);
  assert.deepEqual(plan.stages.slice(0, 3), base.stages);
  assert.deepEqual(plan.stages[3], { name: 'heartbeat-u1', versions: versionsWithout([]) });
  assert.equal(plan.stages[3].versions.at(-1), U1.version);
  assert.equal(plan.unversioned.length, 2);
});

test('default rejects extra U1; explicit U1 refuses a missing dependency', () => {
  assert.throws(() => buildMainU1ReplayPlan(receiving), /unreviewed migration/);
  assert.throws(() => buildMainU1ReplayPlan(main, 'main-u1-121'), /reviewed migration missing/);
});

for (const member of receiving) {
  test('explicit U1 refuses missing reviewed member: ' + member.name, () => {
    assert.throws(() => buildMainU1ReplayPlan(receiving.filter(row => row.name !== member.name), 'main-u1-121'), /reviewed migration missing/);
  });
  test('explicit U1 refuses changed bytes: ' + member.name, () => {
    const changed = receiving.map(row => row.name === member.name ? { ...row, sha256: '0'.repeat(64) } : row);
    assert.throws(() => buildMainU1ReplayPlan(changed, 'main-u1-121'), /reviewed migration digest changed/);
  });
}

test('duplicate names and same-version aliases cannot enter the plan', () => {
  assert.throws(() => buildMainU1ReplayPlan([...receiving, U1], 'main-u1-121'), /duplicate migration name/);
  assert.throws(() => buildMainU1ReplayPlan([...receiving, { ...U1, name: U1.version + '_alias.sql' }], 'main-u1-121'), /duplicate migration version/);
});

test('a different late migration is not approved by count, filename order or valid digest shape', () => {
  assert.throws(() => buildMainU1ReplayPlan([...receiving, {
    name: '20261022000000_unreviewed.sql', version: '20261022000000', sha256: 'a'.repeat(64),
  }], 'main-u1-121'), /unreviewed migration/);
});

test('malformed rows and mismatched versions fail closed', () => {
  assert.throws(() => buildMainU1ReplayPlan(null), /manifest must be an array/);
  assert.throws(() => buildMainU1ReplayPlan([null]), /row must be an object/);
  assert.throws(() => buildMainU1ReplayPlan([{ ...main[0], sha256: '' }]), /migration digest missing/);
  assert.throws(() => buildMainU1ReplayPlan([{ ...main[0], version: '20260101000000' }]), /version does not match/);
});

test('profile parsing is explicit and refuses unknown or repeated selectors', () => {
  assert.deepEqual(parseMainProofArguments([]), { profile: 'main-120', plan: false, cleanup: false });
  assert.deepEqual(parseMainProofArguments(['--plan', '--profile=main-u1-121']), { profile: 'main-u1-121', plan: true, cleanup: false });
  assert.deepEqual(parseMainProofArguments(['--cleanup', '--profile=main-u1-121']), { profile: 'main-u1-121', plan: false, cleanup: true });
  assert.throws(() => parseMainProofArguments(['--profile=main-120', '--profile=main-u1-121']), /exactly one/);
  assert.throws(() => parseMainProofArguments(['--profile=main-120', '--profile=main-120']), /exactly one/);
  for (const profile of ['', 'completion-n3-u1', 'main-u1', 'unknown']) {
    assert.throws(() => parseMainProofArguments(['--profile=' + profile]), /unknown reviewed/);
    assert.throws(() => buildMainU1ReplayPlan(receiving, profile), /unknown reviewed/);
  }
  assert.throws(() => parseMainProofArguments(['--skip-invariants']), /unknown proof argument/);
});

const unchangedProofs = [
  {
    "path": "tests/db/account-closure-full-chain.sql",
    "sha256": "26b7fcfa8391224903e23b339e0ae06f1b32c6ed2573e9332d79b12d96cf0368",
    "action": "UNCHANGED"
  },
  {
    "path": "tests/db/account-closure-enforcement-full-chain.sql",
    "sha256": "ab579be545147a2c494dbc8686c7931f188c73793c4e3ef7f1e9bd03f10069fe",
    "action": "UNCHANGED"
  },
  {
    "path": "tests/db/account-closure-denial-control.sql",
    "sha256": "dccbf47df8ee43ca64add790a731d444d6a9fa5985cf28d9d4560304607e2ee5",
    "action": "UNCHANGED"
  },
  {
    "path": "tests/db/checkout-rejection-recovery.sql",
    "sha256": "d1d32577cf750d84d1a1670653c7fdde0b4e954f92a0aeb7e3a2cf5326a905f7",
    "action": "UNCHANGED"
  },
  {
    "path": "tests/db/account-closure-concurrency-realpg.mjs",
    "sha256": "517dd04048e52ceeb0042ec8263ce91465878293d89270d9c3d508856444ed7a",
    "action": "UNCHANGED"
  },
  {
    "path": "tests/db/account-closure-attestation-realpg.mjs",
    "sha256": "c0297c1fd5deadce70d23336d15cfe5d5cb64103040360bd1772cba4cdaac4e3",
    "action": "UNCHANGED"
  },
  {
    "path": "tests/db/account-closure-full-chain-diagnostics.mjs",
    "sha256": "323a5b274605b8125cf861e64a87742bd034132f8c334bb80f600ae90a76e287",
    "action": "UNCHANGED"
  }
];
for (const { path, sha256 } of unchangedProofs) test('original proof/helper unchanged: ' + path, () => {
  assert.equal(hash(readFileSync(join(root, path))), sha256);
});

test('U1 is excluded from initial staging and all four final proof layers remain explicit', () => {
  const driver = read('tests/db/account-closure-full-chain.mjs');
  const replay = driver.indexOf("if (args.profile === 'main-u1-121')");
  assert.ok(driver.includes('name !== candidate && name !== recovery && name !== MAIN_U1_MIGRATION.name'));
  const final = driver.slice(replay, driver.indexOf('} catch (error)', replay));
  assert.ok(replay > driver.indexOf("console.log('CHECKOUT REJECTION RECOVERY INVARIANTS PASSED')"));
  for (const token of [
    "assertCheckoutRejection(sql(checkoutRejectionQuery('after'",
    "verifyEnforcement('after')",
    "readFileSync('tests/db/account-closure-enforcement-full-chain.sql'",
    "readFileSync('tests/db/checkout-rejection-recovery.sql'",
    'ACCOUNT CLOSURE ENFORCEMENT FULL-CHAIN INVARIANTS PASSED',
    'CHECKOUT REJECTION RECOVERY INVARIANTS PASSED',
    'U1 owned fixture Auth residue', 'U1 owned fixture journal residue',
    'U1 proof must restore disabled rollout gate', 'U1 rejection fixture residue',
  ]) assert.ok(final.includes(token), token);
  assert.ok(driver.lastIndexOf('captureOwnedDatabaseDiagnostics(') < driver.lastIndexOf('cleanupOwned({ id, stage, networkName, subnet })'));
  assert.ok(driver.includes("status: primaryError || cleanupError ? 'FAIL' : 'PASS'"));
  assert.ok(driver.includes('if (primaryError || cleanupError) throw primaryError ?? cleanupError'));
});

test('existing workflow collects new Node tests and explicitly selects U1 on replay AND cleanup', () => {
  const workflow = read('.github/workflows/account-closure-full-chain-proof.yml');
  const collection = workflow.indexOf('run: node --test tests/db/account-closure-full-chain-main-u1-plan.test.mjs');
  assert.ok(collection > workflow.indexOf('actions/setup-node@v6'));
  assert.ok(collection < workflow.indexOf('supabase/setup-cli@v2'));
  assert.ok(workflow.includes('run: node tests/db/account-closure-full-chain.mjs --profile=main-u1-121'));
  assert.ok(workflow.includes('run: node tests/db/account-closure-full-chain.mjs --cleanup --profile=main-u1-121'));
  assert.ok(workflow.includes('node tests/db/account-closure-concurrency-realpg.mjs'));
  assert.ok(workflow.includes('node tests/db/account-closure-attestation-realpg.mjs'));
  assert.ok(workflow.includes('if: always()'));
  assert.ok(workflow.includes('retention-days: 1'));
});
