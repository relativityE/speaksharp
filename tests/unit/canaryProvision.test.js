// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { classifyError, withRetry, signInWithBoundedRetry, verifyTier, enforceCeiling, provisionCanary } from '../../scripts/lib/canaryProvision.mjs';

const CANARY = 'canary@example.com';
const config = { email: CANARY, password: 'pw' };
const invalidJwt = { message: 'invalid JWT ... unrecognized JWT kid <nil> for algorithm ES256' };
const badCreds = { status: 400, message: 'Invalid login credentials' };          // recognized → recoverable
const unknown400 = { status: 400, message: 'Some unexpected validation problem' }; // unknown 4xx → fail closed
const weirdErr = { status: 418, message: "I'm a teapot" };                         // unexpected non-retryable
const malformed = {};                                                              // no status, no message
const noSleep = { sleep: () => Promise.resolve() };

// ---- mock builders ----
const profile = (opts) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => opts }) }) });
function makeAnon({ signIn = [{ ok: true }], profileResult = { data: { subscription_status: 'free' } } } = {}) {
  const seq = [...signIn];
  return {
    auth: { signInWithPassword: vi.fn(async () => { const s = seq.length > 1 ? seq.shift() : seq[0]; return s.ok ? { data: { user: { id: s.userId || 'u1' } }, error: null } : { data: null, error: s.error }; }) },
    from: () => profile(profileResult),
  };
}
function makeAdmin({ listUsers = [{ users: [{ email: CANARY, id: 'u1' }] }], createUser = { error: null }, updateUser = { error: null } } = {}) {
  const lu = [...listUsers];
  return { auth: { admin: {
    listUsers: vi.fn(async () => { const l = lu.length > 1 ? lu.shift() : lu[0]; return l.error ? { data: null, error: l.error } : { data: { users: l.users || [] }, error: null }; }),
    createUser: vi.fn(async () => createUser),
    updateUserById: vi.fn(async () => updateUser),
  } } };
}

describe('classifyError', () => {
  it('auth_config (non-retryable) for invalid-JWT / 401 / 403 / invalid-api-key', () => {
    for (const e of [invalidJwt, { status: 401 }, { status: 403 }, { message: 'Invalid API key' }]) {
      expect(classifyError(e)).toMatchObject({ category: 'auth_config', retryable: false });
    }
  });
  it('retryable for 429/5xx/network', () => {
    expect(classifyError({ status: 503 })).toMatchObject({ category: 'retryable' });
  });
  it('recoverable_credentials ONLY for recognized invalid-login (message or code), never a bare 400', () => {
    expect(classifyError(badCreds)).toMatchObject({ category: 'recoverable_credentials', retryable: false });
    expect(classifyError({ status: 400, code: 'invalid_credentials' })).toMatchObject({ category: 'recoverable_credentials' });
    // Unknown 4xx / unexpected non-retryable / malformed → 'other' (fail closed), NOT recoverable.
    expect(classifyError(unknown400)).toMatchObject({ category: 'other', retryable: false });
    expect(classifyError(weirdErr)).toMatchObject({ category: 'other', retryable: false });
    expect(classifyError(malformed)).toMatchObject({ category: 'other', retryable: false });
  });
});

describe('withRetry / signInWithBoundedRetry', () => {
  it('retries transient then succeeds; never retries invalid-JWT', async () => {
    let n = 0;
    const ok = await withRetry(() => { n += 1; return Promise.resolve(n < 2 ? { error: { status: 503 } } : { data: 'x', error: null }); }, noSleep);
    expect(ok.data).toBe('x'); expect(n).toBe(2);
  });
  it('sign-in stops immediately on auth_config (no retry) and on deterministic; retries transient', async () => {
    const authAnon = makeAnon({ signIn: [{ ok: false, error: { status: 401 } }] });
    expect((await signInWithBoundedRetry(authAnon, config, noSleep)).classification.category).toBe('auth_config');
    expect(authAnon.auth.signInWithPassword).toHaveBeenCalledTimes(1);
    const tAnon = makeAnon({ signIn: [{ ok: false, error: { status: 503 } }] });
    await signInWithBoundedRetry(tAnon, config, { attempts: 3, sleep: () => Promise.resolve() });
    expect(tAnon.auth.signInWithPassword).toHaveBeenCalledTimes(3); // retried
  });
});

describe('verifyTier — FAIL-CLOSED', () => {
  it('free → ok; pro/null/missing/error → NOT ok', async () => {
    expect((await verifyTier(makeAnon({ profileResult: { data: { subscription_status: 'free' } } }), 'u1')).ok).toBe(true);
    expect((await verifyTier(makeAnon({ profileResult: { data: { subscription_status: 'pro' } } }), 'u1')).ok).toBe(false);
    expect((await verifyTier(makeAnon({ profileResult: { data: null } }), 'u1')).ok).toBe(false);
    expect((await verifyTier(makeAnon({ profileResult: { data: { subscription_status: null } } }), 'u1')).ok).toBe(false);
    expect((await verifyTier(makeAnon({ profileResult: { data: null, error: { message: 'boom' } } }), 'u1')).ok).toBe(false);
  });
});

describe('enforceCeiling', () => {
  it('ok / warn / exceeded / skipped', async () => {
    expect((await enforceCeiling(makeAdmin({ listUsers: [{ users: [{ email: CANARY }] }] }), { max: 1, enforce: true })).status).toBe('ok');
    const two = [{ users: [{ email: CANARY }, { email: 'canary-x@example.com' }] }];
    expect((await enforceCeiling(makeAdmin({ listUsers: two }), { max: 1, enforce: false })).status).toBe('warn');
    expect((await enforceCeiling(makeAdmin({ listUsers: two }), { max: 1, enforce: true })).status).toBe('exceeded');
    expect((await enforceCeiling(makeAdmin({ listUsers: [{ error: invalidJwt }] }), { max: 1, enforce: true })).status).toBe('skipped');
  });

  it('(#1148) excludes EXACT deferred legacy identities from the count — not a domain bypass', async () => {
    const withLegacy = [{ users: [{ email: CANARY }, { email: 'canary-legacy@example.com' }] }];
    // Without exclusion: the deferred #1146 legacy account would break the ceiling every run.
    expect((await enforceCeiling(makeAdmin({ listUsers: withLegacy }), { max: 1, enforce: true })).status).toBe('exceeded');
    // Excluded by EXACT email → only the active canary counts; the legacy one is reported as deferred debt.
    const res = await enforceCeiling(makeAdmin({ listUsers: withLegacy }), { max: 1, enforce: true, exclude: ['canary-legacy@example.com'] });
    expect(res.status).toBe('ok');
    expect(res.count).toBe(1);
    expect(res.deferred).toContain('canary-legacy@example.com');
    // A NON-excluded extra canary still trips the ceiling (exclusion is exact, not a blanket bypass).
    const two = [{ users: [{ email: CANARY }, { email: 'canary-x@example.com' }] }];
    expect((await enforceCeiling(makeAdmin({ listUsers: two }), { max: 1, enforce: true, exclude: ['canary-legacy@example.com'] })).status).toBe('exceeded');
  });
});

describe('provisionCanary — health only, fail-closed', () => {
  it('HEALTHY: signs in + free tier → no admin mutation', async () => {
    const admin = makeAdmin();
    const res = await provisionCanary({ anon: makeAnon(), admin, config });
    expect(res.status).toBe('healthy');
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
  });
  it('AUTH/CONFIG sign-in failure → config_error, and NO account mutation', async () => {
    const admin = makeAdmin();
    const res = await provisionCanary({ anon: makeAnon({ signIn: [{ ok: false, error: invalidJwt }] }), admin, config });
    expect(res).toMatchObject({ status: 'config_error', scope: 'anon_auth' });
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
  });
  it('TRANSIENT exhausted sign-in → failed, and NO account mutation', async () => {
    const admin = makeAdmin();
    const res = await provisionCanary({ anon: makeAnon({ signIn: [{ ok: false, error: { status: 503 } }] }), admin, config });
    expect(res).toMatchObject({ status: 'failed', scope: 'transient' });
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
  });
  it('RECOVERY (existence-first, stale password): existing account → updateUserById → recovered', async () => {
    const admin = makeAdmin({ listUsers: [{ users: [{ email: CANARY, id: 'u9' }] }] });
    const anon = makeAnon({ signIn: [{ ok: false, error: badCreds }, { ok: true, userId: 'u9' }] });
    const res = await provisionCanary({ anon, admin, config });
    expect(res.status).toBe('recovered');
    expect(admin.auth.admin.updateUserById).toHaveBeenCalled();
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled(); // update-only, no create
  });
  it.each([
    ['unknown 400', unknown400],
    ['unexpected non-retryable (418)', weirdErr],
    ['malformed/empty error', malformed],
  ])('FAIL CLOSED: %s sign-in failure → failed(unclassified), NO createUser/updateUserById', async (_label, err) => {
    const admin = makeAdmin();
    const res = await provisionCanary({ anon: makeAnon({ signIn: [{ ok: false, error: err }] }), admin, config });
    expect(res).toMatchObject({ status: 'failed', scope: 'unclassified' });
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
  });
  it('RECOVERY (missing account): not found → createUser → recovered', async () => {
    const admin = makeAdmin({ listUsers: [{ users: [] }], createUser: { error: null } });
    const anon = makeAnon({ signIn: [{ ok: false, error: badCreds }, { ok: true }] });
    const res = await provisionCanary({ anon, admin, config });
    expect(res.status).toBe('recovered');
    expect(admin.auth.admin.createUser).toHaveBeenCalled();
  });
  it('TIER ERROR: healthy sign-in but Pro tier → tier_error (not healthy)', async () => {
    const res = await provisionCanary({ anon: makeAnon({ profileResult: { data: { subscription_status: 'pro' } } }), admin: makeAdmin(), config });
    expect(res).toMatchObject({ status: 'tier_error', tier: 'pro' });
  });
  it('never surfaces the credential VALUE in the returned result', async () => {
    const secret = 'S3cr3t-canary-value';
    const res = await provisionCanary({ anon: makeAnon({ signIn: [{ ok: false, error: invalidJwt }] }), admin: makeAdmin(), config: { email: CANARY, password: secret } });
    expect(JSON.stringify(res)).not.toContain(secret);
  });
});
