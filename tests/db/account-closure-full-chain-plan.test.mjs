// Pure metadata controls only. These do not apply migrations or prove schema/runtime compatibility.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { test } from 'node:test';
import { ACCOUNT_STAGE_NAMES, HEARTBEAT_PREREQUISITE, REVIEWED_MIGRATION_SNAPSHOT,
  buildAccountReplayPlan } from './account-closure-full-chain.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const rows = () => REVIEWED_MIGRATION_SNAPSHOT.map((row) => ({ ...row }));
const version = (name) => name.split('_')[0];
const expectedStages = [
  '20261016180000_account_closure_drain_enforcement.sql',
  '20261017200000_checkout_rejection_recovery.sql',
  '20261018170000_account_closure_pending_checkout.sql',
  '20261019055102_account_pending_recording_admission_1643.sql',
  '20261019202856_account_coaching_admission_1643.sql',
  '20261020230653_account_pending_completion_journal_1643.sql',
];

test('six independently named semantic stages, not a global chronology claim', () => {
  assert.deepEqual(ACCOUNT_STAGE_NAMES, expectedStages);
  const plan = buildAccountReplayPlan(rows());
  assert.equal(plan.executed, false);
  assert.equal(plan.mode, 'PLAN_ONLY');
  assert.equal(plan.replayOrderClaim, 'SEMANTIC_ACCOUNT_STAGES_WITH_REVIEWED_BASELINE');
  assert.equal(plan.lastAccountStage.name, expectedStages.at(-1));
  assert.equal(plan.newestApprovedSnapshot.name, '20261021005553_objective_evidence_span_1474.sql');
  assert.equal(plan.lastAccountStage.sha256, '955d829bdcc9649dadfd23e9ebef2839d56b31bddd87cd77fd2122df3ba87a1c');
  assert.equal(plan.newestApprovedSnapshot.sha256, '4a58bc423eba074734c411c8a7c0a87fe43c2d41102d2cb6f34db4f0b2998c01');
  for (const name of expectedStages) assert.ok(!plan.baseline.includes(version(name)));
  // N3 is a reviewed baseline member, even though its timestamp is later than account completion.
  assert.ok(plan.baseline.includes('20261021005553'));
  let previous = plan.baseline;
  for (const [i, stage] of plan.stages.entries()) {
    assert.equal(stage.name, expectedStages[i]);
    assert.deepEqual(stage.history.filter((v) => !previous.includes(v)), [version(stage.name)]);
    assert.ok(previous.every((v) => stage.history.includes(v)));
    for (const later of expectedStages.slice(i + 1)) assert.ok(!stage.history.includes(version(later)));
    previous = stage.history;
  }
});

test('U1 is a deliberate named baseline profile, never a filesystem auto-opt-in', () => {
  const input = [...rows(), { ...HEARTBEAT_PREREQUISITE }];
  assert.throws(() => buildAccountReplayPlan(input), /unreviewed migration/);
  assert.throws(() => buildAccountReplayPlan(rows(), 'completion-n3-u1'), /reviewed migration missing/);
  const plan = buildAccountReplayPlan(input, 'completion-n3-u1');
  assert.equal(plan.heartbeatProfileSelected, true);
  assert.ok(plan.baseline.includes('20261019010000'));
  assert.ok(plan.stages.every((s) => s.history.includes('20261019010000')));
  assert.equal(plan.migrations, buildAccountReplayPlan(rows()).migrations + 1);
  assert.throws(() => buildAccountReplayPlan(input, 'auto'), /unknown reviewed baseline profile/);
});

for (const row of REVIEWED_MIGRATION_SNAPSHOT) {
  test(`missing reviewed member fails closed: ${row.name}`, () => {
    assert.throws(() => buildAccountReplayPlan(rows().filter((r) => r.name !== row.name)), /reviewed migration missing/);
  });
  test(`changed bytes fail closed: ${row.name}`, () => {
    const changed = rows();
    changed.find((r) => r.name === row.name).sha256 = '0'.repeat(64);
    assert.throws(() => buildAccountReplayPlan(changed), /reviewed migration digest changed/);
  });
}

test('shared omission cannot mutate the reviewed oracle into accepting a missing stage', () => {
  // Independent pin from the accepted receiving-design snapshot, not recomputed from actual files.
  assert.equal(REVIEWED_MIGRATION_SNAPSHOT.length, 128);
  assert.equal(createHash('sha256').update(JSON.stringify(REVIEWED_MIGRATION_SNAPSHOT)).digest('hex'),
    '288ea990c1cff997209670d008f06d792341e1cd9cd0deb3272c8cf2d0d03315');
  assert.ok(Object.isFrozen(REVIEWED_MIGRATION_SNAPSHOT));
  assert.ok(REVIEWED_MIGRATION_SNAPSHOT.every(Object.isFrozen));
  const completion = REVIEWED_MIGRATION_SNAPSHOT.find((r) => r.name === expectedStages.at(-1));
  assert.throws(() => { completion.name = 'silently-replaced.sql'; }, TypeError);
  assert.throws(() => REVIEWED_MIGRATION_SNAPSHOT.pop(), TypeError);
  const bothMissing = rows().filter((r) => !expectedStages.slice(-2).includes(r.name));
  assert.throws(() => buildAccountReplayPlan(bothMissing), /reviewed migration missing/);
});

test('duplicates, new interior/later migrations and unknown legacy SQL are refused', () => {
  assert.throws(() => buildAccountReplayPlan([...rows(), rows()[0]]), /duplicate migration names/);
  assert.throws(() => buildAccountReplayPlan([...rows(), { ...rows()[0], name: '20250811062708_other.sql' }]), /duplicate migration versions/);
  for (const name of ['20261018500000_unknown.sql', '20261022000000_future.sql', 'unknown.sql']) {
    assert.throws(() => buildAccountReplayPlan([...rows(), { name, sha256: 'a'.repeat(64) }]), /unreviewed migration|unrecognized migration name/);
  }
});

test('malformed manifests and digest containers are not treated as empty input', () => {
  for (const input of [null, {}, 'rows']) assert.throws(() => buildAccountReplayPlan(input), /manifest must be an array/);
  for (const row of [null, [], 1, { name: 1 }, { name: 'x.sql', sha256: {} }]) {
    assert.throws(() => buildAccountReplayPlan([row]));
  }
});

test('plan import and invalid arguments need no Docker, credentials, database or artifact cleanup', () => {
  const driver = fileURLToPath(new URL('./account-closure-full-chain.mjs', import.meta.url));
  for (const args of [['--plan', '--cleanup'], ['--plan', '--profile=auto'], ['--plan', '--profile=completion-n3', '--profile=completion-n3-u1']]) {
    const result = spawnSync(process.execPath, [driver, ...args], { cwd: root, env: { PATH: '' }, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /plan and cleanup|unknown reviewed baseline profile|choose exactly one reviewed baseline profile/);
    assert.doesNotMatch(result.stderr, /docker|Docker|GITHUB_ACTIONS|ENOENT/);
  }
});

for (const profile of ['completion-n3', 'completion-n3-u1']) test(`${profile}: actual receiving-tree manifest is checked, not replaced with a metadata fixture`, () => {
  const dir = new URL('../../backend/supabase/migrations/', import.meta.url);
  const actual = readdirSync(dir).filter((name) => name.endsWith('.sql')).map((name) => ({ name,
    sha256: createHash('sha256').update(readFileSync(new URL(name, dir))).digest('hex') }));
  // Current base may lack accepted successor source. Report HOLD; do not erase that precondition.
  const expected = new Map([...REVIEWED_MIGRATION_SNAPSHOT,
    ...(profile === 'completion-n3-u1' ? [HEARTBEAT_PREREQUISITE] : [])].map((r) => [r.name, r.sha256]));
  const missing = [...expected.keys()].some((name) => !actual.some((r) => r.name === name));
  const changedOrUnknown = actual.some((r) => expected.get(r.name) !== r.sha256);
  if (missing || changedOrUnknown) assert.throws(() => buildAccountReplayPlan(actual, profile), /reviewed migration missing|unreviewed migration|digest changed/);
  else assert.equal(buildAccountReplayPlan(actual, profile).executed, false);
});
