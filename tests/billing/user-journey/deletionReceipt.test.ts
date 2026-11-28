// @vitest-environment node
// J1.f / J7.d scoring: a leg passes only on its own account's terminal deletion and zero residue, read before
// teardown, plus checked teardown, destruction proof and Stripe residue. Each negative control below must not pass.
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { test } from 'vitest';
import { finaliseDeletionReceipt } from './deletionReceipt.mjs';
import { DESTROYED_SCHEMA, stackIdentitySha256 } from './localStackResources.mjs';

const PROJECT = 'billing-local-stack-123456-1';
const RELEASE = 'a'.repeat(40);
const SYSID = '7300000000000000001';
const identity = { schema: 'billing-local-stack-identity/v1', project: PROJECT,
  database: { container: 'c_db', volume: `supabase_db_${PROJECT}`, systemIdentifier: SYSID },
  containers: ['c_auth', 'c_db'], volumes: [`supabase_db_${PROJECT}`], networks: ['n_net'] };
const destruction = () => ({ schema: DESTROYED_SCHEMA, destroyed: true, project: PROJECT, containers: 2, volumes: 1, networks: 1,
  databaseSystemIdentifier: SYSID, identitySha256: stackIdentitySha256(identity, PROJECT) });
const ref = (id: string) => createHash('sha256').update(id, 'utf8').digest('hex');
const account = (leg: string, route: string, id: string, over: Record<string, unknown> = {}) => ({ leg, route, accountRef: ref(id),
  closurePhase: 'completed', authUserAbsent: true, residueVerified: true, fallbackCleanup: 'NOT_RUN',
  entryReached: true, verificationObserved: true, terminalUi: 'deleted', signInRefused: true, retainedData: 'PASS', retainedGaps: [], ...over });
const receipt = (accounts = [account('J1.f', 'trial_wall', 'u1'), account('J7.d', 'account_page', 'u2')], over = {}) => ({
  schema: 'account-deletion-local/v2', testedRelease: RELEASE, stackRun: PROJECT, stripeMode: 'test', accounts, ...over });
const CLEAN = { journeys: 'success', stackStopped: 'success', stackDestroyed: 'success', stripeClean: 'success' };
const expected = (over = {}) => ({ release: RELEASE, stackRun: PROJECT, destruction: destruction(), identity, ...over });
const score = (r: unknown, checks = CLEAN, exp = expected()) => finaliseDeletionReceipt(r, checks, exp);

test('both accounts deleted, no residue, stack torn down: each leg passes on its own', () => {
  const out = score(receipt());
  assert.deepEqual(out.legs, { 'J1.f': 'PASSED', 'J7.d': 'PASSED' });
  assert.equal(out.result, 'PASSED');
  assert.deepEqual(out.defects, { run: [], 'J1.f': [], 'J7.d': [] });
});

test('deletion missing on one account fails only that leg', () => {
  for (const [field, value, defect] of [['closurePhase', 'auth_deleted', 'deletion_not_terminal'], ['closurePhase', 'pending', 'deletion_not_terminal'],
    ['authUserAbsent', false, 'auth_user_present']] as const) {
    const out = score(receipt([account('J1.f', 'trial_wall', 'u1', { [field]: value }), account('J7.d', 'account_page', 'u2')]));
    assert.deepEqual(out.legs, { 'J1.f': 'NOT_PROVEN', 'J7.d': 'PASSED' }, field);
    assert.ok(out.defects['J1.f'].includes(defect));
    assert.equal(out.result, 'NOT_PROVEN');
  }
});

test('residue left on one account fails that leg', () => {
  const out = score(receipt([account('J1.f', 'trial_wall', 'u1'), account('J7.d', 'account_page', 'u2', { residueVerified: false })]));
  assert.deepEqual(out.legs, { 'J1.f': 'PASSED', 'J7.d': 'NOT_PROVEN' });
  assert.deepEqual(out.defects['J7.d'], ['residue_not_zero']);
});

test('a zero produced by the run\'s own fallback cleanup never passes', () => {
  for (const value of ['RAN', undefined]) {
    const out = score(receipt([account('J1.f', 'trial_wall', 'u1', { fallbackCleanup: value }), account('J7.d', 'account_page', 'u2')]));
    assert.deepEqual(out.legs, { 'J1.f': 'NOT_PROVEN', 'J7.d': 'PASSED' }, String(value));
    assert.ok(out.defects['J1.f'].includes('fallback_cleanup_ran'));
  }
});

test('stack destruction never stands in for deletion: an account with no deletion fields fails', () => {
  const bare = { leg: 'J7.d', route: 'account_page', accountRef: ref('u2') };
  const out = score(receipt([account('J1.f', 'trial_wall', 'u1'), bare as never]));
  assert.equal(out.legs['J7.d'], 'NOT_PROVEN');
  assert.deepEqual(out.defects['J7.d'], ['account_shape']);
});

test('one account cannot count for both legs', () => {
  const out = score(receipt([account('J1.f', 'trial_wall', 'same'), account('J7.d', 'account_page', 'same')]));
  assert.deepEqual(out.legs, { 'J1.f': 'NOT_PROVEN', 'J7.d': 'NOT_PROVEN' });
  assert.ok(out.defects.run.includes('accounts_not_distinct'));
});

test('a leg reached from the wrong route, or missing, or doubled, fails', () => {
  assert.ok(score(receipt([account('J1.f', 'account_page', 'u1'), account('J7.d', 'account_page', 'u2')])).defects['J1.f'].includes('route_mismatch'));
  const one = score(receipt([account('J1.f', 'trial_wall', 'u1')]));
  assert.deepEqual(one.legs, { 'J1.f': 'NOT_PROVEN', 'J7.d': 'NOT_PROVEN' });
  assert.deepEqual(one.defects['J7.d'], ['leg_account_count']);
  const doubled = score(receipt([account('J1.f', 'trial_wall', 'u1'), account('J1.f', 'trial_wall', 'u2')]));
  assert.deepEqual(doubled.legs, { 'J1.f': 'NOT_PROVEN', 'J7.d': 'NOT_PROVEN' });
});

test('cleanup missing or failed fails both legs', () => {
  for (const key of ['stackStopped', 'stackDestroyed', 'stripeClean'] as const) {
    for (const value of ['failure', 'skipped', undefined]) {
      const out = score(receipt(), { ...CLEAN, [key]: value });
      assert.deepEqual(out.legs, { 'J1.f': 'NOT_PROVEN', 'J7.d': 'NOT_PROVEN' }, `${key}=${value}`);
    }
  }
  for (const proof of [null, { ...destruction(), project: 'billing-local-stack-123456-2' }, { ...destruction(), destroyed: false },
    { ...destruction(), identitySha256: 'f'.repeat(64) }]) {
    const out = score(receipt(), CLEAN, expected({ destruction: proof }));
    assert.equal(out.stackDestroyed, 'NOT_PROVEN');
    assert.equal(out.result, 'NOT_PROVEN');
  }
});

test('wrong release, wrong stack, live Stripe or a malformed receipt fails both legs', () => {
  for (const r of [receipt(undefined, { testedRelease: 'b'.repeat(40) }), receipt(undefined, { stackRun: 'billing-local-stack-123456-2' }),
    receipt(undefined, { stripeMode: 'live' }), receipt(undefined, { schema: 'billing-user-journey/v1' }),
    receipt(undefined, { schema: 'account-deletion-local/v1' }),
    { ...receipt(), extra: true }, null, [], 'PASSED']) {
    assert.equal(score(r).result, 'NOT_PROVEN');
  }
  assert.equal(score(receipt(), CLEAN, expected({ release: undefined })).result, 'NOT_PROVEN');
});

test('Sam on a718da25: DB deletion and cleanup green but the browser journey failed is NOT_PROVEN', () => {
  for (const journeys of ['failure', 'cancelled', 'skipped', undefined]) {
    const out = score(receipt(), { ...CLEAN, journeys } as never);
    assert.equal(out.result, 'NOT_PROVEN', String(journeys));
    assert.deepEqual(out.legs, { 'J1.f': 'NOT_PROVEN', 'J7.d': 'NOT_PROVEN' });
    assert.ok(out.defects.run.includes('journey_step_failed'));
  }
});

test('each leg needs its own observed entry, Mailpit verification and terminal "deleted" page, even with the backend green', () => {
  for (const [field, value, defect] of [['entryReached', false, 'entry_not_reached'], ['verificationObserved', false, 'verification_not_observed'],
    ['terminalUi', 'deleted_cleanup_unverified', 'terminal_ui_not_deleted'], ['terminalUi', 'none', 'terminal_ui_not_deleted']] as const) {
    const out = score(receipt([account('J1.f', 'trial_wall', 'u1'), account('J7.d', 'account_page', 'u2', { [field]: value })]));
    assert.deepEqual(out.legs, { 'J1.f': 'PASSED', 'J7.d': 'NOT_PROVEN' }, `${field}=${String(value)}`);
    assert.deepEqual(out.defects['J7.d'], [defect]);
  }
});

test('both sides of the retention promise: a sign-in Auth did not refuse, or retained data that is not PASS, fails that leg', () => {
  for (const [over, defect] of [[{ signInRefused: false }, 'sign_in_not_refused'],
    [{ retainedData: 'GAP', retainedGaps: ['public.account_closure_attempts.user_id'] }, 'retained_data_gap'],
    [{ retainedData: 'FAIL' }, 'retained_data_violation'], [{ retainedData: 'UNREAD' }, 'retained_data_unread'],
    [{ retainedData: 'constructor' }, 'retained_data_unread'], [{ retainedData: undefined }, 'retained_data_unread']] as const) {
    const out = score(receipt([account('J1.f', 'trial_wall', 'u1'), account('J7.d', 'account_page', 'u2', over)]));
    assert.deepEqual(out.legs, { 'J1.f': 'PASSED', 'J7.d': 'NOT_PROVEN' }, JSON.stringify(over));
    assert.deepEqual(out.defects['J7.d'], [defect], JSON.stringify(over));
  }
});

test('a GAP must name its types, a PASS names none, and a type is a schema.table.column name only', () => {
  for (const over of [{ retainedData: 'GAP', retainedGaps: [] }, { retainedGaps: ['public.x.user_id'] }, { retainedGaps: ['someone@example.test'] },
    { retainedGaps: 'public.x.user_id' }]) {
    const out = score(receipt([account('J1.f', 'trial_wall', 'u1', over), account('J7.d', 'account_page', 'u2')]));
    assert.equal(out.legs['J1.f'], 'NOT_PROVEN', JSON.stringify(over));
    assert.ok(out.defects['J1.f'].includes('retained_gaps_shape'), JSON.stringify(over));
  }
});
