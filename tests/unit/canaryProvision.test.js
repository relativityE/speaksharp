// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { classifyError, withRetry, provisionCanary } from '../../scripts/lib/canaryProvision.mjs';

const CANARY = 'canary@speaksharp.app';
const config = { email: CANARY, password: 'pw', ceilingMax: 1, ceilingEnforce: true };
const invalidJwt = { message: 'invalid JWT ... unrecognized JWT kid <nil> for algorithm ES256' };

describe('classifyError', () => {
  it('auth_config (NON-retryable) for invalid-JWT / 401 / 403 — the observed canary failure', () => {
    expect(classifyError(invalidJwt)).toMatchObject({ category: 'auth_config', retryable: false });
    expect(classifyError({ status: 401 })).toMatchObject({ category: 'auth_config', retryable: false });
    expect(classifyError({ status: 403 })).toMatchObject({ category: 'auth_config', retryable: false });
  });
  it('retryable for 429 / 5xx / network; other otherwise', () => {
    expect(classifyError({ status: 429 })).toMatchObject({ category: 'retryable', retryable: true });
    expect(classifyError({ status: 503 })).toMatchObject({ category: 'retryable', retryable: true });
    expect(classifyError({ message: 'fetch failed' })).toMatchObject({ category: 'retryable', retryable: true });
    expect(classifyError({ status: 400, message: 'Invalid login credentials' })).toMatchObject({ category: 'other', retryable: false });
  });
});

describe('withRetry', () => {
  it('retries retryable (5xx) then succeeds; never retries invalid-JWT', async () => {
    let n = 0;
    const ok = await withRetry(() => { n += 1; return Promise.resolve(n < 2 ? { error: { status: 503 } } : { data: 'ok', error: null }); }, { sleep: () => Promise.resolve() });
    expect(ok.data).toBe('ok'); expect(n).toBe(2);
    let m = 0;
    const bad = await withRetry(() => { m += 1; return Promise.resolve({ error: invalidJwt }); }, { sleep: () => Promise.resolve() });
    expect(bad.error).toBeTruthy(); expect(m).toBe(1); // not retried
  });
});

const profileChain = (tier = 'free') => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { subscription_status: tier } }) }) }) });
function makeAnon({ signIn = [{ ok: true }], tier = 'free' } = {}) {
  const seq = [...signIn];
  return {
    auth: { signInWithPassword: vi.fn(async () => { const s = seq.length > 1 ? seq.shift() : seq[0]; return s.ok ? { data: { user: { id: s.userId || 'u1' } }, error: null } : { data: null, error: s.error }; }) },
    from: () => profileChain(tier),
  };
}
function makeAdmin({ listUsers = [{ users: [{ email: CANARY }] }], createUser = { error: null }, updateUser = { error: null } } = {}) {
  const lu = [...listUsers];
  return { auth: { admin: {
    listUsers: vi.fn(async () => { const l = lu.length > 1 ? lu.shift() : lu[0]; return l.error ? { data: null, error: l.error } : { data: { users: l.users || [] }, error: null }; }),
    createUser: vi.fn(async () => createUser),
    updateUserById: vi.fn(async () => updateUser),
  } } };
}

describe('provisionCanary — sign-in-first with restored protections', () => {
  it('HEALTHY: existing account signs in → NO admin MUTATION (no createUser/updateUser); ceiling OK', async () => {
    const admin = makeAdmin();
    const res = await provisionCanary({ anon: makeAnon(), admin, config });
    expect(res.status).toBe('healthy');
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(res.ceiling).toBe('ok');
  });

  it('HEALTHY even when the ceiling admin.listUsers is intermittently rejected (best-effort → skipped)', async () => {
    const admin = makeAdmin({ listUsers: [{ error: invalidJwt }] });
    const res = await provisionCanary({ anon: makeAnon(), admin, config });
    expect(res.status).toBe('healthy'); // a flaky admin call must NOT fail a healthy canary
    expect(res.ceiling).toBe('skipped');
  });

  it('CEILING enforced: >max canary-like accounts with CANARY_ENFORCE=fail → ceiling_exceeded', async () => {
    const admin = makeAdmin({ listUsers: [{ users: [{ email: CANARY }, { email: 'canary-stray@speaksharp.app' }] }] });
    const res = await provisionCanary({ anon: makeAnon(), admin, config });
    expect(res).toMatchObject({ status: 'ceiling_exceeded', count: 2 });
  });

  it('RECOVERY (stale password): sign-in fails → account exists → password SYNCED via updateUserById → recovered', async () => {
    const admin = makeAdmin({ createUser: { error: { message: 'A user with this email has already been registered' } }, listUsers: [{ users: [{ email: CANARY, id: 'u9' }] }] });
    const anon = makeAnon({ signIn: [{ ok: false, error: { status: 400, message: 'Invalid login credentials' } }, { ok: true, userId: 'u9' }] });
    const res = await provisionCanary({ anon, admin, config });
    expect(res.status).toBe('recovered');
    expect(admin.auth.admin.updateUserById).toHaveBeenCalled(); // password sync restored (thread #59)
  });

  it('RECOVERY (missing account): sign-in fails → createUser succeeds → re-sign-in → recovered', async () => {
    const admin = makeAdmin({ createUser: { error: null } });
    const anon = makeAnon({ signIn: [{ ok: false, error: { status: 400, message: 'Invalid login credentials' } }, { ok: true }] });
    const res = await provisionCanary({ anon, admin, config });
    expect(res.status).toBe('recovered');
  });

  it('CONFIG ERROR: recovery admin createUser rejected on invalid-JWT → actionable, not retried', async () => {
    const admin = makeAdmin({ createUser: { error: invalidJwt } });
    const anon = makeAnon({ signIn: [{ ok: false, error: { status: 500 } }] });
    const res = await provisionCanary({ anon, admin, config });
    expect(res).toMatchObject({ status: 'config_error', scope: 'service_role_key' });
  });

  it('never surfaces the credential VALUE in the returned result', async () => {
    const secret = 'S3cr3t-canary-value';
    const res = await provisionCanary({ anon: makeAnon(), admin: makeAdmin(), config: { ...config, password: secret } });
    expect(JSON.stringify(res)).not.toContain(secret);
  });
});
