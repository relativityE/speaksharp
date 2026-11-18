// @vitest-environment node
// Run 44302168905: run 10 passed every journey step and failed only the in-test cleanup, whose reason the journey swallowed.
// These execute the ACTUAL cleanup paths (runOwnedCleanup.ts against a stand-in admin client; the journey's Stripe check against
// a stand-in Stripe) and classify every real error. Node environment: the cleanup helper's import chain must not run under jsdom.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { cleanupFailureCode, proveStripeFixtureDeleted, safeFailureReason } from './contract';

// Run 44302168905: a cleanup failure is named by a fixed code; messages, ids and counts never reach the receipt.
test('cleanup failure codes: each helper failure is named, content-free, and fits the receipt and progress line', async () => {
  const { requireZeroResidue } = await import('../../live/helpers/runOwnedCleanup');
  const residue = (count: unknown, t: string) => { try { requireZeroResidue(count, t); return null; } catch (e) { return e; } };
  const cases: Array<[unknown, string]> = [
    [residue(2, 'session_attribution_authority'), 'account_cleanup_residue_session_attribution_authority'],
    [residue(null, 'transcript_retention_tombstones'), 'account_cleanup_residue_unread_transcript_retention_tombstones'],
    [new Error('cleanup residue query on objective_session failed (fail closed): permission denied'), 'account_cleanup_residue_unread_objective_session'],
    [new Error('cleanup deleteUser blocked by an unsettled take (fail closed): unsettleable=1 lease_only=0 not_stopped=0'), 'account_cleanup_unsettled_take'],
    [new Error('cleanup deleteUser failed (fail closed): Database error deleting user'), 'account_cleanup_deleteuser_failed'],
    [new Error('post-delete verify returned a non-not-found error — deletion UNPROVEN (fail closed): x'), 'account_cleanup_delete_unproven'],
    [new Error('cleanup trial_entitlements pre-delete failed (fail closed): x'), 'account_cleanup_predelete_failed'],
    [new Error('cleanup take settlement read failed (fail closed)'), 'account_cleanup_take_settlement_failed'],
    [new Error('cleanup_uid_email_disagreement (fail closed)'), 'account_cleanup_identity_refused'],
    [new Error('something new'), 'account_cleanup_other'],
    ['not an error', 'account_cleanup_other'],
  ];
  for (const [error, code] of cases) {
    assert.equal(cleanupFailureCode('account', error), code, String(error));
    assert.match(code, /^[a-z0-9_]{1,80}$/);
    assert.equal(safeFailureReason(new Error(`BILLING_JOURNEY:${code}`)), code);
  }
  // A table name that is not a plain identifier is never echoed.
  assert.equal(cleanupFailureCode('account', new Error('cleanup found run-owned residue in Bad-Table (fail closed): count=1')), 'account_cleanup_residue_unnamed');
  for (const [m, code] of [['BILLING_JOURNEY:clock_cleanup_not_proven', 'stripe_cleanup_clock_cleanup_not_proven'],
    ['BILLING_JOURNEY:customer_cleanup_not_proven', 'stripe_cleanup_customer_cleanup_not_proven'],
    ['BILLING_JOURNEY:stripe_request_failed', 'stripe_cleanup_stripe_request_failed'], ['cus_123 leaked', 'stripe_cleanup_other']] as const)
    assert.equal(cleanupFailureCode('stripe', new Error(m)), code);
  // The journey records the first failure (never swallows it) and carries it into the receipt reason.
  const spec = readFileSync('tests/billing/user-journey/journey.billing.spec.ts', 'utf8');
  const cleanup = spec.slice(spec.indexOf('  async cleanup(): Promise<void> {'), spec.indexOf("    this.steps.add('cleanup');"));
  assert.match(cleanup, /\} catch \(error\) \{ stripeFailed = true; note\(cleanupFailureCode\('stripe', error\)\); \}/);
  assert.match(cleanup, /\} catch \(error\) \{ accountFailed = true; note\(cleanupFailureCode\('account', error\)\); \}/);
  assert.match(cleanup, /requireFact\(!stripeFailed && !accountFailed && stripeClean && !this\.uncertainStripeCreate, failure \?\? 'cleanup_unproven'\);/);
  assert.doesNotMatch(cleanup, /catch \{/, 'no cleanup failure is swallowed');
  assert.match(spec, /catch \(error\) \{ cleanupFailed = true; reason \?\?= safeFailureReason\(error\); \}/);
});

// Run 44302168905 follow-up: the ACTUAL cleanup paths executed against a stand-in admin client and a stand-in Stripe, failing at
// each stage; every real error is classified, and the cleanup gate still refuses (nothing here passes a failed cleanup).
const UID = '11111111-1111-4111-8111-111111111111', EMAIL = 'rwt-journey-billing-1-1@example.com';
type Fail = 'none' | 'settle_read' | 'predelete' | 'delete' | 'readback' | 'residue_read' | 'residue_found';
function fakeAdmin(fail: Fail) {
  let deleted = false;
  const result = (r: object) => ({ then: (ok: (v: object) => unknown) => Promise.resolve(r).then(ok) });
  const query = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const chain: Record<string, unknown> = {};
    const settle = () => {
      if (table === 'sessions' || table === 'active_recording_lease')
        if (!filters.some(([k]) => k === 'count')) return fail === 'settle_read' && table === 'sessions' ? { data: null, error: { message: 'x' } } : { data: [], error: null };
      if (fail === 'residue_read' && table === 'objective_session') return { count: null, error: { message: 'permission denied' } };
      if (fail === 'residue_found' && table === 'session_attribution_authority') return { count: 1, error: null };
      return { count: 0, error: null };
    };
    Object.assign(chain, {
      select: (_c: string, opts?: { count?: string }) => { if (opts?.count) filters.push(['count', true]); return chain; },
      eq: (k: string, v: unknown) => { filters.push([k, v]); return Object.assign(result(settle()), chain); },
      delete: () => ({ eq: () => result(fail === 'predelete' && table === 'trial_entitlements' ? { error: { message: 'x' } } : { error: null }) }),
    });
    return chain;
  };
  return { from: query, auth: { admin: {
    getUserById: async () => deleted
      ? (fail === 'readback' ? { data: null, error: { status: 500, message: 'boom' } } : { data: null, error: { status: 404, code: 'user_not_found', message: 'User not found' } })
      : { data: { user: { id: UID, email: EMAIL, app_metadata: {} } }, error: null },
    deleteUser: async () => { if (fail === 'delete') return { error: { message: 'Database error deleting user' } }; deleted = true; return { error: null }; },
  } } };
}

test('account cleanup, executed: each stage that fails is named; a clean run verifies; the gate never passes a failure', async () => {
  const { cleanupRunOwnedAccount } = await import('../../live/helpers/runOwnedCleanup');
  const run = async (fail: Fail) => {
    try { await cleanupRunOwnedAccount({ admin: fakeAdmin(fail) as never, capturedUid: UID, createdEmail: EMAIL, runOwnedPrefix: 'rwt-journey-billing-' }); return 'verified'; }
    catch (error) { return cleanupFailureCode('account', error); }
  };
  assert.equal(await run('none'), 'verified');
  const expected: Record<Exclude<Fail, 'none' | 'settle_read'>, string> = {
    predelete: 'account_cleanup_predelete_failed', delete: 'account_cleanup_deleteuser_failed',
    readback: 'account_cleanup_delete_unproven', residue_read: 'account_cleanup_residue_unread_objective_session',
    residue_found: 'account_cleanup_residue_session_attribution_authority',
  };
  for (const fail of Object.keys(expected) as Array<Exclude<Fail, 'none' | 'settle_read'>>) assert.equal(await run(fail), expected[fail], fail);
  // The helper's existing rule for an account NOT bound to a run (this journey's): an unreadable take-settlement read is tolerated
  // and the account deletion itself remains the proof; recorded exactly, not loosened here.
  assert.equal(await run('settle_read'), 'verified');
});

test('Stripe cleanup, executed: clock and customer deletion are read back; each failure is named, none is a pass', async () => {
  const fake = (o: { clockDeleted?: boolean; clockId?: string; customerDeleted?: boolean; throws?: string }) => async (path: string) => {
    if (o.throws) throw new Error(`BILLING_JOURNEY:${o.throws}`);
    return path.startsWith('test_helpers/test_clocks/') ? { deleted: o.clockDeleted ?? true, id: o.clockId ?? 'clock_1' } : { deleted: o.customerDeleted ?? true };
  };
  const run = async (stripe: ReturnType<typeof fake>, ids = { clock: 'clock_1' as string | null, customer: 'cus_1' as string | null }) => {
    try { return await proveStripeFixtureDeleted(stripe, ids); } catch (error) { return cleanupFailureCode('stripe', error); }
  };
  assert.equal(await run(fake({})), true);
  assert.equal(await run(fake({ clockDeleted: false })), 'stripe_cleanup_clock_cleanup_not_proven');
  assert.equal(await run(fake({ clockId: 'clock_other' })), 'stripe_cleanup_clock_cleanup_not_proven');
  assert.equal(await run(fake({ customerDeleted: false })), 'stripe_cleanup_customer_cleanup_not_proven');
  assert.equal(await run(fake({ throws: 'stripe_request_failed' })), 'stripe_cleanup_stripe_request_failed');
  assert.equal(await run(fake({ throws: 'stripe_transport_uncertain' })), 'stripe_cleanup_stripe_transport_uncertain');
  // Nothing created: clean. A customer with no clock to own it: not proven clean (the gate refuses).
  assert.equal(await run(fake({}), { clock: null, customer: null }), true);
  assert.equal(await run(fake({}), { clock: null, customer: 'cus_1' }), false);
  // The journey uses this exact function and keeps the gate unchanged.
  const spec = readFileSync('tests/billing/user-journey/journey.billing.spec.ts', 'utf8');
  assert.match(spec, /stripeClean = await proveStripeFixtureDeleted\(\(path, method\) => this\.stripe\(path, method\), \{ clock: this\.clock \|\| null, customer: this\.customer \|\| null \}\);/);
  assert.match(spec, /requireFact\(!stripeFailed && !accountFailed && stripeClean && !this\.uncertainStripeCreate, failure \?\? 'cleanup_unproven'\);/);
});
