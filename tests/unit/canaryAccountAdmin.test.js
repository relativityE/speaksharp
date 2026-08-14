import { describe, expect, it } from 'vitest';
import { provisionCanaryCredential, maskEmail } from '../../scripts/lib/canaryAccountAdmin.mjs';

// #1294 focused Admin - Test Users behavior + security proofs for the canary credential seam. The core is
// injectable, so these run with in-memory Supabase mocks — no network, no real accounts. They prove:
// confirmed create when absent, safe authenticated reuse when present, no duplicate, no password reset on a
// wrong password, missing/malformed/equal/prohibited-domain rejection, no credential leakage, an immutable
// active-trial readback, and that NO tier/sub_test_*/trial/paid state is ever written.

const SECRETS = {
  CANARY_TRIAL_EMAIL: 'operator+trial@example.com',
  CANARY_TRIAL_PASSWORD: 'trial-secret-pw',
  CANARY_PAID_EMAIL: 'operator+paid@example.net',
  CANARY_PAID_PASSWORD: 'paid-secret-pw',
};

const FUTURE = new Date(Date.now() + 20 * 86400_000).toISOString();
const PAST = new Date(Date.now() - 86400_000).toISOString();

const activeTrialProfile = (id = 'u1') => ({
  id, subscription_status: 'free', stripe_subscription_id: null, stripe_customer_id: null,
  trial_started_at: new Date(Date.now() - 5 * 86400_000).toISOString(), trial_expires_at: FUTURE,
});

function makeAdmin({ users = [], profile, createError = null, createdUserId = 'created-id', listError = null } = {}) {
  const calls = { listUsers: 0, createUser: [], updateUserById: [], from: [], select: [] };
  const admin = {
    calls,
    auth: {
      admin: {
        listUsers: async () => { calls.listUsers++; return listError ? { data: null, error: listError } : { data: { users }, error: null }; },
        createUser: async (payload) => {
          calls.createUser.push(payload);
          if (createError) return { data: null, error: createError };
          users.push({ id: createdUserId, email: payload.email });
          return { data: { user: { id: createdUserId } }, error: null };
        },
        updateUserById: async (...a) => { calls.updateUserById.push(a); return { data: {}, error: null }; },
      },
    },
    from: (t) => {
      calls.from.push(t);
      return { select: (cols) => { calls.select.push(cols); return { eq: () => ({ maybeSingle: async () => ({ data: profile ?? null, error: null }) }) }; } };
    },
  };
  return admin;
}
const makeSignIn = ({ ok = true, error = null, userId = 'u1' } = {}) =>
  () => ({ auth: { signInWithPassword: async () => (ok ? { data: { user: { id: userId } }, error: null } : { data: null, error }) } });

const run = (over = {}) => provisionCanaryCredential({
  adminClient: over.adminClient ?? makeAdmin(over.admin ?? {}),
  makeSignInClient: over.makeSignInClient ?? makeSignIn(over.signIn ?? {}),
  secrets: over.secrets ?? SECRETS,
  purpose: over.purpose ?? 'canary_trial',
  now: over.now,
});

describe('#1294 Admin - Test Users canary credential seam', () => {
  it('ABSENT → CREATED exactly one confirmed user, writing NO tier/sub/trial (trial reads back active)', async () => {
    const admin = makeAdmin({ users: [], profile: activeTrialProfile('created-id') });
    const r = await provisionCanaryCredential({ adminClient: admin, makeSignInClient: makeSignIn(), secrets: SECRETS, purpose: 'canary_trial' });
    expect(r.result).toBe('CREATED');
    expect(r.facts.trial_active).toBe(true);
    // exactly one confirmed create, with ONLY email/password/email_confirm — no profile/tier/sub writes.
    expect(admin.calls.createUser).toHaveLength(1);
    expect(admin.calls.createUser[0]).toEqual({ email: 'operator+trial@example.com', password: 'trial-secret-pw', email_confirm: true });
    expect(admin.calls.updateUserById).toHaveLength(0);          // never mutates an account row
    expect(admin.calls.from).toEqual(['user_profiles']);          // only a READ-back
  });

  it('paid purpose CREATED establishes credentials only — no synthetic paid entitlement', async () => {
    const admin = makeAdmin({ users: [], profile: { id: 'created-id', subscription_status: 'free', stripe_subscription_id: null, stripe_customer_id: null } });
    const r = await provisionCanaryCredential({ adminClient: admin, makeSignInClient: makeSignIn(), secrets: SECRETS, purpose: 'canary_paid' });
    expect(r.result).toBe('CREATED');
    expect(r.facts.paid_established_here).toBe(false);
    expect(r.facts.paid_synthetic).toBe(false);
  });

  it('PRESENT + correct password → REUSED (no duplicate create, no password reset)', async () => {
    const admin = makeAdmin({ users: [{ id: 'u1', email: 'operator+trial@example.com' }], profile: activeTrialProfile('u1') });
    const r = await provisionCanaryCredential({ adminClient: admin, makeSignInClient: makeSignIn({ userId: 'u1' }), secrets: SECRETS, purpose: 'canary_trial' });
    expect(r.result).toBe('REUSED');
    expect(r.facts.password_reset).toBe(false);
    expect(admin.calls.createUser).toHaveLength(0);              // never duplicates
    expect(admin.calls.updateUserById).toHaveLength(0);         // never resets the password
  });

  it('PRESENT + WRONG password → BLOCKED without any reset or duplicate', async () => {
    const admin = makeAdmin({ users: [{ id: 'u1', email: 'operator+trial@example.com' }], profile: activeTrialProfile('u1') });
    const signIn = makeSignIn({ ok: false, error: { code: 'invalid_credentials', message: 'Invalid login credentials' } });
    const r = await provisionCanaryCredential({ adminClient: admin, makeSignInClient: signIn, secrets: SECRETS, purpose: 'canary_trial' });
    expect(r.result).toBe('BLOCKED');
    expect(r.facts.password_reset).toBe(false);
    expect(admin.calls.updateUserById).toHaveLength(0);
    expect(admin.calls.createUser).toHaveLength(0);
  });

  it('BLOCKS a missing canary email', async () => {
    const r = await run({ secrets: { ...SECRETS, CANARY_TRIAL_EMAIL: '' } });
    expect(r.result).toBe('BLOCKED');
  });

  it('BLOCKS a malformed canary email', async () => {
    const r = await run({ secrets: { ...SECRETS, CANARY_TRIAL_EMAIL: 'not-an-email' } });
    expect(r.result).toBe('BLOCKED');
  });

  it('BLOCKS equal trial and paid canary emails', async () => {
    const r = await run({ secrets: { ...SECRETS, CANARY_PAID_EMAIL: 'operator+trial@example.com' } });
    expect(r.result).toBe('BLOCKED');
  });

  it('BLOCKS a prohibited speaksharp.app (or subdomain) identity', async () => {
    expect((await run({ secrets: { ...SECRETS, CANARY_TRIAL_EMAIL: 'canary@speaksharp.app' } })).result).toBe('BLOCKED');
    expect((await run({ secrets: { ...SECRETS, CANARY_TRIAL_EMAIL: 'canary@mail.speaksharp.app' } })).result).toBe('BLOCKED');
  });

  it('BLOCKS a reused identity carrying a synthetic sub_test_* subscription (fabricated paid state)', async () => {
    const admin = makeAdmin({
      users: [{ id: 'u1', email: 'operator+paid@example.net' }],
      profile: { id: 'u1', subscription_status: 'pro', stripe_subscription_id: 'sub_test_operator_paid', stripe_customer_id: 'cus_x' },
    });
    const r = await provisionCanaryCredential({ adminClient: admin, makeSignInClient: makeSignIn({ userId: 'u1' }), secrets: SECRETS, purpose: 'canary_paid' });
    expect(r.result).toBe('BLOCKED');
    expect(r.facts.reason).toBe('synthetic_subscription_present');
  });

  it('BLOCKS a trial identity whose server-time window has expired (never extends it)', async () => {
    const admin = makeAdmin({
      users: [{ id: 'u1', email: 'operator+trial@example.com' }],
      profile: { ...activeTrialProfile('u1'), trial_expires_at: PAST },
    });
    const r = await provisionCanaryCredential({ adminClient: admin, makeSignInClient: makeSignIn({ userId: 'u1' }), secrets: SECRETS, purpose: 'canary_trial' });
    expect(r.result).toBe('BLOCKED');
    expect(r.facts.reason).toBe('trial_window_expired');
    expect(admin.calls.updateUserById).toHaveLength(0);
  });

  it('NEVER leaks a raw email or password — output is masked and content-free', async () => {
    const admin = makeAdmin({ users: [], profile: activeTrialProfile('created-id') });
    const r = await provisionCanaryCredential({ adminClient: admin, makeSignInClient: makeSignIn(), secrets: SECRETS, purpose: 'canary_trial' });
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain('trial-secret-pw');
    expect(serialized).not.toContain('operator+trial@example.com');
    expect(r.maskedEmail).toBe('o***@e***.com');
  });

  it('CREATE then idempotent REUSE against the same in-memory store (no duplicate identity)', async () => {
    const users = [];
    const admin = makeAdmin({ users, profile: activeTrialProfile('created-id') });
    const first = await provisionCanaryCredential({ adminClient: admin, makeSignInClient: makeSignIn({ userId: 'created-id' }), secrets: SECRETS, purpose: 'canary_trial' });
    expect(first.result).toBe('CREATED');
    const second = await provisionCanaryCredential({ adminClient: admin, makeSignInClient: makeSignIn({ userId: 'created-id' }), secrets: SECRETS, purpose: 'canary_trial' });
    expect(second.result).toBe('REUSED');
    expect(admin.calls.createUser).toHaveLength(1); // the second run reused; it did not create a duplicate
  });

  it('maskEmail keeps only first-letter hints', () => {
    expect(maskEmail('alice.smith@company.co')).toBe('a***@c***.co');
    expect(maskEmail('x@y.z')).toBe('x***@y***.z');
  });
});
