// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { provisionCanaryCredential, maskEmail, strictLookup } from '../../scripts/lib/canaryAccountAdmin.mjs';

// #1294 focused Admin - Test Users security proofs. Injectable in-memory mocks — no network, no real
// accounts. Proves: DEFINITIVE-absence create + authenticate + id-binding; safe authenticated reuse bound to
// the exact looked-up id; truncated/ambiguous inventory → BLOCKED (never a blind create); wrong password →
// BLOCKED without reset; authoritative 30-day/immutable-marker/server-time trial; synthetic/partial paid
// rejection; no credential leakage; NO tier/sub/trial/paid writes.

const SECRETS = {
  CANARY_TRIAL_EMAIL: 'operator+trial@example.test',
  CANARY_TRIAL_PASSWORD: 'trial-secret-pw',
  CANARY_PAID_EMAIL: 'operator+paid@example.net',
  CANARY_PAID_PASSWORD: 'paid-secret-pw',
};
const iso = (ms) => new Date(ms).toISOString();
const START = Date.now() - 5 * 86400_000;
const DAY = 86400_000;
const trialProfile = (over = {}) => ({
  id: 'x', subscription_status: 'free', subscription_id: null, stripe_customer_id: null, stripe_subscription_id: null,
  trial_started_at: iso(START), trial_expires_at: iso(START + 30 * DAY), commercial_trial_granted_at: iso(START), ...over,
});

function makeAdmin({ pages = [[]], full = false, profile, createId = 'created-id', createError = null, effTier = 'pro' } = {}) {
  const calls = { listUsers: 0, createUser: [], updateUserById: [], from: [] };
  return {
    calls,
    auth: {
      admin: {
        listUsers: async ({ page }) => {
          calls.listUsers++;
          if (full) return { data: { users: Array.from({ length: 200 }, (_, i) => ({ email: `f${page}_${i}@x.z`, id: `f${page}_${i}` })) }, error: null };
          return { data: { users: pages[page - 1] || [] }, error: null };
        },
        createUser: async (payload) => { calls.createUser.push(payload); return createError ? { data: null, error: createError } : { data: { user: { id: createId } }, error: null }; },
        updateUserById: async (...a) => { calls.updateUserById.push(a); return { data: {}, error: null }; },
      },
    },
    from: (t) => { calls.from.push(t); return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile ?? null, error: null }) }) }) }; },
    rpc: async () => ({ data: effTier, error: null }),
  };
}
const makeSignIn = ({ ok = true, userId = 'created-id', error = null } = {}) =>
  () => ({ auth: { signInWithPassword: async () => (ok ? { data: { user: { id: userId } }, error: null } : { data: null, error }) } });

const run = (over = {}) => provisionCanaryCredential({
  adminClient: over.admin ?? makeAdmin(over.adminOpts ?? {}),
  makeSignInClient: over.makeSignInClient ?? makeSignIn(over.signIn ?? {}),
  secrets: over.secrets ?? SECRETS,
  purpose: over.purpose ?? 'canary_trial',
});

describe('strictLookup', () => {
  it('found / absent / ambiguous / truncated', async () => {
    expect(await strictLookup(makeAdmin({ pages: [[{ email: 'a@b.c', id: 'i1' }]] }), 'a@b.c')).toMatchObject({ status: 'found', userId: 'i1' });
    expect(await strictLookup(makeAdmin({ pages: [[]] }), 'a@b.c')).toMatchObject({ status: 'absent' });
    expect(await strictLookup(makeAdmin({ pages: [[{ email: 'a@b.c', id: 'i1' }, { email: 'A@B.C', id: 'i2' }]] }), 'a@b.c')).toMatchObject({ status: 'ambiguous' });
    expect(await strictLookup(makeAdmin({ full: true }), 'a@b.c')).toMatchObject({ status: 'truncated' });
  });
});

describe('#1294 Admin - Test Users canary credential seam', () => {
  it('ABSENT trial → CREATE + authenticate + id-binding; writes NO tier/sub/trial; authoritative trial readback', async () => {
    const admin = makeAdmin({ pages: [[]], profile: trialProfile('created-id') });
    const r = await provisionCanaryCredential({ adminClient: admin, makeSignInClient: makeSignIn({ userId: 'created-id' }), secrets: SECRETS, purpose: 'canary_trial' });
    expect(r.result).toBe('CREATED');
    expect(r.facts.trial_active_server_time).toBe(true);
    expect(r.facts.trial_window_days).toBe(30);
    expect(admin.calls.createUser).toEqual([{ email: 'operator+trial@example.test', password: 'trial-secret-pw', email_confirm: true }]);
    expect(admin.calls.updateUserById).toHaveLength(0);   // never mutates an account row
    expect(admin.calls.from).toEqual(['user_profiles']);   // read-back only
  });

  it('ABSENT but authenticated id != created id → BLOCKED (identity not bound)', async () => {
    const r = await run({ adminOpts: { pages: [[]], profile: trialProfile(), createId: 'created-id' }, signIn: { userId: 'someone-else' } });
    expect(r.result).toBe('BLOCKED');
    expect(r.facts.reason).toBe('authenticated_id_mismatch');
  });

  it('PRESENT + correct password → REUSED bound to exact found id (no duplicate, no reset)', async () => {
    const admin = makeAdmin({ pages: [[{ email: 'operator+trial@example.test', id: 'found-id' }]], profile: trialProfile('found-id') });
    const r = await provisionCanaryCredential({ adminClient: admin, makeSignInClient: makeSignIn({ userId: 'found-id' }), secrets: SECRETS, purpose: 'canary_trial' });
    expect(r.result).toBe('REUSED');
    expect(admin.calls.createUser).toHaveLength(0);
    expect(admin.calls.updateUserById).toHaveLength(0);
    expect(r.facts.password_reset).toBe(false);
  });

  it('PRESENT + WRONG password → BLOCKED without reset or duplicate', async () => {
    const admin = makeAdmin({ pages: [[{ email: 'operator+trial@example.test', id: 'found-id' }]], profile: trialProfile('found-id') });
    const r = await provisionCanaryCredential({ adminClient: admin, makeSignInClient: makeSignIn({ ok: false, error: { code: 'invalid_credentials', message: 'Invalid login credentials' } }), secrets: SECRETS, purpose: 'canary_trial' });
    expect(r.result).toBe('BLOCKED');
    expect(r.facts.password_reset).toBe(false);
    expect(admin.calls.createUser).toHaveLength(0);
    expect(admin.calls.updateUserById).toHaveLength(0);
  });

  it('TRUNCATED inventory scan → BLOCKED, never a blind create', async () => {
    const admin = makeAdmin({ full: true });
    const r = await provisionCanaryCredential({ adminClient: admin, makeSignInClient: makeSignIn(), secrets: SECRETS, purpose: 'canary_trial' });
    expect(r.result).toBe('BLOCKED');
    expect(r.facts.reason).toBe('inventory_scan_truncated');
    expect(admin.calls.createUser).toHaveLength(0);
  });

  it('AMBIGUOUS duplicate normalized-email → BLOCKED', async () => {
    const r = await run({ adminOpts: { pages: [[{ email: 'operator+trial@example.test', id: 'a' }, { email: 'OPERATOR+trial@Example.test', id: 'b' }]] } });
    expect(r.result).toBe('BLOCKED');
    expect(r.facts.reason).toBe('duplicate_identity');
  });

  it('BLOCKS missing / malformed / equal / prohibited-domain identities', async () => {
    expect((await run({ secrets: { ...SECRETS, CANARY_TRIAL_EMAIL: '' } })).result).toBe('BLOCKED');
    expect((await run({ secrets: { ...SECRETS, CANARY_TRIAL_EMAIL: 'not-an-email' } })).result).toBe('BLOCKED');
    expect((await run({ secrets: { ...SECRETS, CANARY_PAID_EMAIL: 'operator+trial@example.test' } })).result).toBe('BLOCKED');
    expect((await run({ secrets: { ...SECRETS, CANARY_TRIAL_EMAIL: 'x@speaksharp.app' } })).result).toBe('BLOCKED');
    expect((await run({ secrets: { ...SECRETS, CANARY_TRIAL_EMAIL: 'x@mail.speaksharp.app' } })).result).toBe('BLOCKED');
  });

  it('BLOCKS when the public anon sign-in client is unavailable (no service-role fallback)', async () => {
    const r = await run({ makeSignInClient: () => null });
    expect(r.result).toBe('BLOCKED');
    expect(r.facts.reason).toBe('no_anon_sign_in_client');
  });

  it('trial readback BLOCKS synthetic sub / wrong 30-day window / missing marker / not-active-server-time', async () => {
    const found = (over) => ({ adminOpts: { pages: [[{ email: 'operator+trial@example.test', id: 'found-id' }]], profile: trialProfile({ id: 'found-id', ...over.profile }), effTier: over.effTier }, signIn: { userId: 'found-id' } });
    expect((await run(found({ profile: { stripe_subscription_id: 'sub_test_x' } }))).facts.reason).toBe('synthetic_subscription_present');
    expect((await run(found({ profile: { trial_expires_at: iso(START + 10 * DAY) } }))).facts.reason).toBe('trial_window_not_30d');
    expect((await run(found({ profile: { commercial_trial_granted_at: null } }))).facts.reason).toBe('trial_missing_commercial_marker');
    expect((await run(found({ effTier: 'free' }))).facts.reason).toBe('trial_not_active_server_time');
  });

  it('paid create establishes credentials only; rejects partial/synthetic billing shapes', async () => {
    // clean fresh paid account (billing absent) → CREATED, no synthetic
    const ok = await run({ purpose: 'canary_paid', secrets: SECRETS, adminOpts: { pages: [[]], profile: trialProfile('created-id') } });
    expect(ok.result).toBe('CREATED');
    expect(ok.facts.paid_synthetic).toBe(false);
    // partial billing shape (customer but no subscription) → BLOCKED
    const partial = await run({ purpose: 'canary_paid', adminOpts: { pages: [[{ email: 'operator+paid@example.net', id: 'found-id' }]], profile: trialProfile({ id: 'found-id', stripe_customer_id: 'cus_x' }) }, signIn: { userId: 'found-id' } });
    expect(partial.result).toBe('BLOCKED');
    expect(partial.facts.reason).toBe('paid_partial_billing_identity');
  });

  it('NEVER leaks a raw email or password; output is masked', async () => {
    const r = await run({ adminOpts: { pages: [[]], profile: trialProfile('created-id') }, signIn: { userId: 'created-id' } });
    const s = JSON.stringify(r);
    expect(s).not.toContain('trial-secret-pw');
    expect(s).not.toContain('operator+trial@example.test');
    expect(r.maskedEmail).toBe('o***@e***.test');
  });

  it('maskEmail keeps only first-letter hints', () => {
    expect(maskEmail('alice.smith@company.co')).toBe('a***@c***.co');
  });
});
