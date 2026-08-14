import { describe, expect, it, vi } from 'vitest';
import { inventoryUnaffiliatedIdentities } from '../../scripts/lib/unaffiliatedIdentityAudit.mjs';

const makeAdmin = () => ({
  auth: { admin: { listUsers: vi.fn()
    .mockResolvedValueOnce({ data: { users: [
      { id: 'u1', email: 'first@unauthorized.invalid' },
      { id: 'u2', email: 'owned@example.test' },
      { id: 'u3', email: 'second@unauthorized.invalid' },
    ] }, error: null }) } },
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      in: vi.fn().mockResolvedValue({ data: [
        { id: 'u1', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' },
        { id: 'u3', stripe_customer_id: null, stripe_subscription_id: null },
      ], error: null }),
    })),
  })),
});

describe('read-only unaffiliated identity inventory', () => {
  it('returns sanitized Supabase/Stripe counts without mutation or raw identities', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'cus_1', email: 'first@unauthorized.invalid' }], has_more: false }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'sub_1' }], has_more: false }) });
    const result = await inventoryUnaffiliatedIdentities({
      admin: makeAdmin(),
      fetchFn,
      stripeSecretKey: 'protected-value',
      domain: 'unauthorized.invalid',
    });

    expect(result).toEqual({
      domain: 'unauthorized.invalid',
      supabase_auth_identities: 2,
      supabase_profiles: 2,
      profiles_with_customer_binding: 1,
      profiles_with_subscription_binding: 1,
      stripe_customers: 1,
      stripe_subscriptions: 1,
      cross_bound_customers: 1,
      mutation_performed: false,
    });
    expect(JSON.stringify(result)).not.toContain('first@');
    expect(fetchFn).toHaveBeenCalledWith(expect.stringContaining('/customers/search?'), expect.objectContaining({ method: 'GET' }));
    expect(fetchFn).toHaveBeenCalledWith(expect.stringContaining('/subscriptions?'), expect.objectContaining({ method: 'GET' }));
  });
});
