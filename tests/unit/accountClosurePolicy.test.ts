import { describe, expect, it, vi } from 'vitest';
import { closeAccount, type ClosureDependencies, type ClosureProof } from '../../backend/supabase/functions/_shared/accountClosure';

const proof: ClosureProof = {
  userId: 'owner', email: 'trial@example.test', customerId: 'customer',
  requestId: 'request', expiresAt: 2000,
};

function fixture() {
  const order: string[] = [];
  let claimed = false;
  const deps: ClosureDependencies = {
    now: () => 1000,
    consumeProof: vi.fn(async () => {
      if (claimed) return null;
      claimed = true;
      return proof;
    }),
    verifyCheckouts: vi.fn(async () => true),
    listSubscriptions: vi.fn()
      .mockResolvedValueOnce({ complete: true, subscriptions: [{ id: 'sub', status: 'active' }] })
      .mockResolvedValue({ complete: true, subscriptions: [{ id: 'sub', status: 'canceled' }] }),
    cancelSubscription: vi.fn(async () => { order.push('cancel'); }),
    settleBilling: vi.fn(async () => { order.push('settle'); }),
    deleteCustomer: vi.fn(async () => { order.push('customer'); return { deleted: true }; }),
    preserveTrialEmail: vi.fn(async () => { order.push('trial'); }),
    removeOwnedStorage: vi.fn(async () => { order.push('storage'); }),
    deleteAuthUser: vi.fn(async () => { order.push('auth'); return { deleted: true }; }),
    verifyResidue: vi.fn(async () => { order.push('residue'); return { clean: true }; }),
  };
  return { deps, order };
}

describe('account closure — approved no-refund, retained-trial-email policy', () => {
  it.each([
    { ...proof, customerId: undefined }, { ...proof, customerId: false },
    { ...proof, customerId: 0 }, { ...proof, customerId: {} },
    { ...proof, email: 1 }, { ...proof, email: {} }, { ...proof, requestId: {} },
  ])('rejects malformed authoritative proof before any effect (%j)', async (value) => {
    const { deps, order } = fixture();
    vi.mocked(deps.consumeProof).mockResolvedValue(value as unknown as ClosureProof);
    expect((await closeAccount('owner', 'token', deps)).outcome).toBe('refused');
    expect(deps.verifyCheckouts).not.toHaveBeenCalled();
    expect(order).toEqual([]);
  });
  it('legacy open checkout on a customer-null account prevents every destructive call', async () => {
    const { deps } = fixture();
    vi.mocked(deps.consumeProof).mockResolvedValue({ ...proof, customerId:null });
    vi.mocked(deps.verifyCheckouts).mockResolvedValue(false);
    expect((await closeAccount('owner','token',deps)).outcome).toBe('incomplete');
    expect(deps.preserveTrialEmail).not.toHaveBeenCalled();
    expect(deps.deleteAuthUser).not.toHaveBeenCalled();
  });
  it('settles billing, deletes the Stripe customer, preserves trial email, then deletes auth and proves residue', async () => {
    const { deps, order } = fixture();
    expect(await closeAccount('owner', 'emailed-secret', deps)).toEqual({
      outcome: 'deleted', stage: 'residue', billingClosed: true, customerDeleted: true, accountDeleted: true,
    });
    expect(order).toEqual(['cancel', 'settle', 'customer', 'trial', 'storage', 'auth', 'residue']);
    expect(deps.cancelSubscription).toHaveBeenCalledWith('sub', {
      invoice_now: false, prorate: false, idempotencyKey: 'account-closure:request:sub',
    });
    expect(deps.preserveTrialEmail).toHaveBeenCalledWith('owner', 'trial@example.test');
  });

  it.each([
    null, { ...proof, userId: 'someone-else' }, { ...proof, expiresAt: 1000 },
    { ...proof, expiresAt: NaN }, { ...proof, requestId: '' },
  ])('refuses invalid, wrong-account or expired verification before Stripe calls', async (value) => {
    const { deps, order } = fixture();
    vi.mocked(deps.consumeProof).mockResolvedValue(value);
    expect((await closeAccount('owner', 'emailed-secret', deps)).outcome).toBe('refused');
    expect(deps.listSubscriptions).not.toHaveBeenCalled();
    expect(order).toEqual([]);
  });

  it('single-use atomic proof permits only one concurrent closure', async () => {
    const { deps } = fixture();
    const results = await Promise.all([closeAccount('owner', 'token', deps), closeAccount('owner', 'token', deps)]);
    expect(results.map((r) => r.outcome).sort()).toEqual(['deleted', 'refused']);
    expect(deps.deleteAuthUser).toHaveBeenCalledTimes(1);
  });

  it('an incomplete first page does not cancel or delete', async () => {
    const { deps } = fixture();
    vi.mocked(deps.listSubscriptions).mockReset().mockResolvedValue({ complete: false, subscriptions: [] });
    expect((await closeAccount('owner', 'token', deps)).outcome).toBe('incomplete');
    expect(deps.cancelSubscription).not.toHaveBeenCalled();
    expect(deps.deleteAuthUser).not.toHaveBeenCalled();
  });

  it.each(['unpaid', 'paused', 'active', 'past_due'])('does not delete when post-cancel read still reports %s', async (status) => {
    const { deps } = fixture();
    vi.mocked(deps.listSubscriptions).mockReset()
      .mockResolvedValueOnce({ complete: true, subscriptions: [{ id: 'sub', status: 'active' }] })
      .mockResolvedValue({ complete: true, subscriptions: [{ id: 'sub', status }] });
    expect((await closeAccount('owner', 'token', deps)).billingClosed).toBe(false);
    expect(deps.deleteCustomer).not.toHaveBeenCalled();
    expect(deps.deleteAuthUser).not.toHaveBeenCalled();
  });

  it('failed cancellation blocks customer and auth deletion without leaking the provider error', async () => {
    const { deps } = fixture();
    vi.mocked(deps.cancelSubscription).mockRejectedValue(new Error('secret@example.test TOKEN'));
    const result = await closeAccount('owner', 'token', deps);
    expect(result).toMatchObject({ outcome: 'incomplete', stage: 'subscriptions', billingClosed: false });
    expect(JSON.stringify(result)).not.toMatch(/secret|TOKEN/);
    expect(deps.deleteCustomer).not.toHaveBeenCalled();
    expect(deps.deleteAuthUser).not.toHaveBeenCalled();
  });

  it.each(['settleBilling', 'deleteCustomer', 'preserveTrialEmail', 'removeOwnedStorage'] as const)('%s failure stops before auth deletion', async (method) => {
    const { deps } = fixture();
    vi.mocked(deps[method]).mockRejectedValue(new Error('unavailable'));
    expect((await closeAccount('owner', 'token', deps)).outcome).toBe('incomplete');
    expect(deps.deleteAuthUser).not.toHaveBeenCalled();
  });

  it('unconfirmed customer deletion stops before auth deletion', async () => {
    const { deps } = fixture();
    vi.mocked(deps.deleteCustomer).mockResolvedValue({ deleted: false });
    expect((await closeAccount('owner', 'token', deps)).customerDeleted).toBe(false);
    expect(deps.deleteAuthUser).not.toHaveBeenCalled();
  });

  it('auth deletion failure reports billing/customer closure honestly', async () => {
    const { deps } = fixture();
    vi.mocked(deps.deleteAuthUser).mockResolvedValue({ deleted: false });
    expect(await closeAccount('owner', 'token', deps)).toMatchObject({
      outcome: 'incomplete', stage: 'account_deletion', billingClosed: true,
      customerDeleted: true, accountDeleted: false,
    });
    expect(deps.verifyResidue).not.toHaveBeenCalled();
  });

  it.each(['lost response', 'readback timeout'])('unknown auth deletion remains pending (%s)', async () => {
    const { deps } = fixture();
    vi.mocked(deps.deleteAuthUser).mockRejectedValue(new Error('remote outcome unknown'));
    const result = await closeAccount('owner', 'token', deps);
    expect(result.accountDeleted).toBeNull();
    expect(result.outcome).toBe('verification_pending');
    expect(deps.verifyResidue).not.toHaveBeenCalled();
  });

  it.each([false, 'error'])('missing residue proof never reports complete (%s)', async (mode) => {
    const { deps } = fixture();
    if (mode === 'error') vi.mocked(deps.verifyResidue).mockRejectedValue(new Error('read failed'));
    else vi.mocked(deps.verifyResidue).mockResolvedValue({ clean: false });
    expect(await closeAccount('owner', 'token', deps)).toMatchObject({ outcome: 'incomplete', stage: 'residue', accountDeleted: true });
  });

  it('a Free account preserves trial email without making any Stripe call', async () => {
    const { deps } = fixture();
    vi.mocked(deps.consumeProof).mockResolvedValue({ ...proof, customerId: null });
    expect((await closeAccount('owner', 'token', deps)).outcome).toBe('deleted');
    expect(deps.listSubscriptions).not.toHaveBeenCalled();
    expect(deps.deleteCustomer).not.toHaveBeenCalled();
    expect(deps.preserveTrialEmail).toHaveBeenCalledWith('owner', proof.email);
  });
});
