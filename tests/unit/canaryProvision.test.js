// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import * as canaryProvision from '../../scripts/lib/canaryProvision.mjs';
import { classifyError, withRetry, signInWithBoundedRetry, verifyCanaryProfileBinding, enforceCeiling, provisionCanary } from '../../scripts/lib/canaryProvision.mjs';

const CANARY = 'paid-canary@example.test';
const config = { email: CANARY, password: 'pw' };
const invalidJwt = { message: 'invalid JWT ... unrecognized JWT kid <nil> for algorithm ES256' };
const badCreds = { status: 400, message: 'Invalid login credentials' };
const unknown400 = { status: 400, message: 'Some unexpected validation problem' };
const malformed = {};
const noSleep = { sleep: () => Promise.resolve() };

const iso = (ms) => new Date(ms).toISOString();
const TRIAL_START = Date.now() - 5 * 86400_000;
const DAY = 86400_000;

// Server-authoritative-shaped profiles (canary reads via the anon flow; effective tier comes from the RPC).
const PAID_PROFILE = {
  subscription_status: 'pro', subscription_id: null, stripe_customer_id: 'cus_canary', stripe_subscription_id: 'sub_canary',
  trial_started_at: null, trial_expires_at: null, commercial_trial_granted_at: null,
};
const TRIAL_PROFILE = {
  subscription_status: 'free', subscription_id: null, stripe_customer_id: null, stripe_subscription_id: null,
  trial_started_at: iso(TRIAL_START), trial_expires_at: iso(TRIAL_START + 30 * DAY), commercial_trial_granted_at: iso(TRIAL_START),
};

function makeAnon({ signIn = [{ ok: true }], profileResult = { data: PAID_PROFILE }, effTier = 'pro', rpcError = null } = {}) {
  const seq = [...signIn];
  const maybeSingle = vi.fn(async () => profileResult);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const update = vi.fn(() => { throw new Error('profile/trial mutation is forbidden in the read-only canary'); });
  const rpc = vi.fn(async () => (rpcError ? { data: null, error: rpcError } : { data: effTier, error: null }));
  return {
    auth: { signInWithPassword: vi.fn(async () => { const s = seq.length > 1 ? seq.shift() : seq[0]; return s.ok ? { data: { user: { id: s.userId || 'u1' } }, error: null } : { data: null, error: s.error }; }) },
    from: vi.fn(() => ({ select, update })),
    rpc,
    _profile: { select, eq, maybeSingle, update, rpc },
  };
}
function makeAdmin({ listUsers = [{ users: [{ email: CANARY }] }] } = {}) {
  const lu = [...listUsers];
  return { auth: { admin: {
    listUsers: vi.fn(async () => { const l = lu.length > 1 ? lu.shift() : lu[0]; return l.error ? { data: null, error: l.error } : { data: { users: l.users || [] }, error: null }; }),
    createUser: vi.fn(async () => ({ error: null })),
    updateUserById: vi.fn(async () => ({ error: null })),
  } } };
}

describe('#1294 R1 — the canary path contains NO account-mutation code', () => {
  it('no recoverCanaryAccount export exists (removed); provisionCanary takes no admin/service-role', () => {
    expect(canaryProvision.recoverCanaryAccount).toBeUndefined();
    expect(provisionCanary.length).toBeLessThanOrEqual(1); // ({ anon, config }) — no admin param
  });
});

describe('classifyError', () => {
  it('auth_config / retryable / recoverable / other', () => {
    for (const e of [invalidJwt, { status: 401 }, { status: 403 }]) expect(classifyError(e)).toMatchObject({ category: 'auth_config' });
    expect(classifyError({ status: 503 })).toMatchObject({ category: 'retryable' });
    expect(classifyError(badCreds)).toMatchObject({ category: 'recoverable_credentials' });
    expect(classifyError(unknown400)).toMatchObject({ category: 'other' });
    expect(classifyError(malformed)).toMatchObject({ category: 'other' });
  });
});

describe('withRetry / signInWithBoundedRetry', () => {
  it('retries transient; stops immediately on auth_config', async () => {
    let n = 0;
    const ok = await withRetry(() => { n += 1; return Promise.resolve(n < 2 ? { error: { status: 503 } } : { data: 'x', error: null }); }, noSleep);
    expect(ok.data).toBe('x'); expect(n).toBe(2);
    const a = makeAnon({ signIn: [{ ok: false, error: { status: 401 } }] });
    expect((await signInWithBoundedRetry(a, config, noSleep)).classification.category).toBe('auth_config');
    expect(a.auth.signInWithPassword).toHaveBeenCalledTimes(1);
  });
});

describe('verifyCanaryProfileBinding — paid lane (server-authoritative, non-synthetic)', () => {
  it('accepts effective-pro + genuine customer/subscription; reads only; no mutation; uses the tier RPC', async () => {
    const anon = makeAnon();
    expect((await verifyCanaryProfileBinding(anon, 'exact-id')).ok).toBe(true);
    expect(anon._profile.eq).toHaveBeenCalledWith('id', 'exact-id');
    expect(anon._profile.rpc).toHaveBeenCalledWith('effective_subscription_tier', expect.any(Object));
    expect(anon._profile.update).not.toHaveBeenCalled();
  });
  it('rejects synthetic sub_test_, non-pro effective tier, free stored tier, blank/absent ids, missing profile', async () => {
    expect((await verifyCanaryProfileBinding(makeAnon({ profileResult: { data: { ...PAID_PROFILE, stripe_subscription_id: 'sub_test_x' } } }), 'u1')).ok).toBe(false);
    expect((await verifyCanaryProfileBinding(makeAnon({ effTier: 'free' }), 'u1')).ok).toBe(false);
    expect((await verifyCanaryProfileBinding(makeAnon({ profileResult: { data: { ...PAID_PROFILE, subscription_status: 'free' } } }), 'u1')).ok).toBe(false);
    expect((await verifyCanaryProfileBinding(makeAnon({ profileResult: { data: { ...PAID_PROFILE, stripe_customer_id: ' ' } } }), 'u1')).ok).toBe(false);
    expect((await verifyCanaryProfileBinding(makeAnon({ profileResult: { data: { ...PAID_PROFILE, stripe_subscription_id: null } } }), 'u1')).ok).toBe(false);
    expect((await verifyCanaryProfileBinding(makeAnon({ profileResult: { data: null } }), 'u1')).ok).toBe(false);
    expect((await verifyCanaryProfileBinding(makeAnon({ rpcError: { message: 'boom' } }), 'u1')).ok).toBe(false);
  });
});

describe('verifyCanaryProfileBinding — active trial lane (immutable marker, exact 30-day, server-time)', () => {
  it('accepts an unbilled, marked, exactly-30-day, server-time-active trial', async () => {
    expect((await verifyCanaryProfileBinding(makeAnon({ profileResult: { data: TRIAL_PROFILE } }), 'u1', 'active-trial')).ok).toBe(true);
  });
  it('rejects missing marker / missing start / non-30d window / marker-start drift / billing identity / paid stored state / not-active', async () => {
    const bad = (over) => makeAnon({ profileResult: { data: { ...TRIAL_PROFILE, ...over } } });
    expect((await verifyCanaryProfileBinding(bad({ commercial_trial_granted_at: null }), 'u1', 'active-trial')).ok).toBe(false);
    expect((await verifyCanaryProfileBinding(bad({ trial_started_at: null }), 'u1', 'active-trial')).ok).toBe(false);
    expect((await verifyCanaryProfileBinding(bad({ trial_expires_at: iso(TRIAL_START + 10 * DAY) }), 'u1', 'active-trial')).ok).toBe(false); // 10-day window
    expect((await verifyCanaryProfileBinding(bad({ commercial_trial_granted_at: iso(TRIAL_START - 5 * DAY) }), 'u1', 'active-trial')).ok).toBe(false); // marker drift
    expect((await verifyCanaryProfileBinding(bad({ stripe_subscription_id: 'sub_real' }), 'u1', 'active-trial')).ok).toBe(false);
    expect((await verifyCanaryProfileBinding(bad({ subscription_status: 'pro' }), 'u1', 'active-trial')).ok).toBe(false);
    expect((await verifyCanaryProfileBinding(makeAnon({ profileResult: { data: TRIAL_PROFILE }, effTier: 'free' }), 'u1', 'active-trial')).ok).toBe(false); // not active server-time
  });
});

describe('enforceCeiling (separate read-only hygiene)', () => {
  it('ok / warn / exceeded / skipped', async () => {
    expect((await enforceCeiling(makeAdmin({ listUsers: [{ users: [{ email: CANARY }] }] }), { max: 1, enforce: true, allowedEmails: [CANARY] })).status).toBe('ok');
    const two = [{ users: [{ email: CANARY }, { email: 'trial-canary@example.test' }] }];
    expect((await enforceCeiling(makeAdmin({ listUsers: two }), { max: 1, enforce: true, allowedEmails: [CANARY, 'trial-canary@example.test'] })).status).toBe('exceeded');
    expect((await enforceCeiling(makeAdmin({ listUsers: [{ error: invalidJwt }] }), { max: 1, enforce: true, allowedEmails: [CANARY] })).status).toBe('skipped');
  });
});

describe('provisionCanary — READ-ONLY health, fail-closed', () => {
  it('HEALTHY: sign in + verified paid binding, no mutation', async () => {
    const anon = makeAnon();
    const res = await provisionCanary({ anon, config });
    expect(res.status).toBe('healthy');
    expect(res).toMatchObject({ tier: 'pro', localProfileBound: true });
    expect(anon._profile.update).not.toHaveBeenCalled();
  });
  it('HEALTHY active-trial lane', async () => {
    const res = await provisionCanary({ anon: makeAnon({ profileResult: { data: TRIAL_PROFILE } }), config: { ...config, lane: 'active-trial' } });
    expect(res).toMatchObject({ status: 'healthy', lane: 'active-trial' });
  });
  it.each([
    ['auth_config invalid-JWT', invalidJwt],
    ['transient 503', { status: 503 }],
    ['recognized bad credentials', badCreds],
    ['unknown 400', unknown400],
    ['malformed/empty', malformed],
  ])('FAILS CLOSED on %s sign-in failure — never creates/recovers', async (_label, err) => {
    const res = await provisionCanary({ anon: makeAnon({ signIn: [{ ok: false, error: err }] }), config });
    expect(res.status).toBe('failed');
  });
  it('ENTITLEMENT ERROR: healthy sign-in but Free/unbound → not healthy, no mutation', async () => {
    const anon = makeAnon({ profileResult: { data: { ...PAID_PROFILE, subscription_status: 'free', stripe_customer_id: null, stripe_subscription_id: null } }, effTier: 'free' });
    const res = await provisionCanary({ anon, config });
    expect(res.status).toBe('entitlement_error');
    expect(anon._profile.update).not.toHaveBeenCalled();
  });
  it('never surfaces the credential VALUE in the returned result', async () => {
    const secret = 'S3cr3t-canary-value';
    const res = await provisionCanary({ anon: makeAnon({ signIn: [{ ok: false, error: invalidJwt }] }), config: { email: CANARY, password: secret } });
    expect(JSON.stringify(res)).not.toContain(secret);
  });
});
