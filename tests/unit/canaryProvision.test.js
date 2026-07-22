// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { classifyError, provisionCanary } from '../../scripts/lib/canaryProvision.mjs';

describe('classifyError', () => {
  it('auth_config (NON-retryable) for invalid-JWT / 401 / 403 — the observed canary failure', () => {
    expect(classifyError({ message: 'invalid JWT: ... unrecognized JWT kid <nil> for algorithm ES256' }))
      .toMatchObject({ category: 'auth_config', retryable: false });
    expect(classifyError({ status: 401, message: 'x' })).toMatchObject({ category: 'auth_config', retryable: false });
    expect(classifyError({ status: 403 })).toMatchObject({ category: 'auth_config', retryable: false });
  });
  it('retryable for 429 / 5xx / network', () => {
    expect(classifyError({ status: 429 })).toMatchObject({ category: 'retryable', retryable: true });
    expect(classifyError({ status: 503 })).toMatchObject({ category: 'retryable', retryable: true });
    expect(classifyError({ message: 'fetch failed' })).toMatchObject({ category: 'retryable', retryable: true });
  });
  it('other (not retried) for a 400 invalid-credentials', () => {
    expect(classifyError({ status: 400, message: 'Invalid login credentials' })).toMatchObject({ category: 'other', retryable: false });
  });
});

const anonMock = ({ signInError = null, userId = 'u1', tier = 'free' } = {}) => ({
  auth: { signInWithPassword: vi.fn(async () => (signInError ? { data: null, error: signInError } : { data: { user: { id: userId } }, error: null })) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { subscription_status: tier } }) }) }) }),
});
const adminMock = ({ createError = null } = {}) => ({ auth: { admin: { createUser: vi.fn(async () => ({ error: createError })) } } });

describe('provisionCanary — sign-in-first', () => {
  const config = { email: 'canary@speaksharp.app', password: 'pw' };

  it('HEALTHY: an existing account signs in → NO admin API is touched (avoids a stale service-role key)', async () => {
    const admin = adminMock();
    const res = await provisionCanary({ anon: anonMock(), admin, config });
    expect(res.status).toBe('healthy');
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('CONFIG ERROR (service_role): non-auth sign-in fail → admin createUser invalid-JWT → "rotate the key"', async () => {
    const admin = adminMock({ createError: { message: 'invalid JWT ... unrecognized JWT kid <nil> for algorithm ES256' } });
    const res = await provisionCanary({ anon: anonMock({ signInError: { message: 'fetch failed' } }), admin, config });
    expect(res).toMatchObject({ status: 'config_error', scope: 'service_role_key' });
  });

  it('CONFIG ERROR (canary creds): a 401 on the anon sign-in fails immediately and does NOT touch admin', async () => {
    const admin = adminMock();
    const res = await provisionCanary({ anon: anonMock({ signInError: { status: 401 } }), admin, config });
    expect(res).toMatchObject({ status: 'config_error', scope: 'canary_credentials' });
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('RECOVERED: genuinely-missing account (400) → createUser ok → re-sign-in ok', async () => {
    let calls = 0;
    const anon = {
      auth: { signInWithPassword: vi.fn(async () => { calls += 1; return calls === 1 ? { data: null, error: { status: 400, message: 'Invalid login credentials' } } : { data: { user: { id: 'u2' } }, error: null }; }) },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { subscription_status: 'free' } }) }) }) }),
    };
    const res = await provisionCanary({ anon, admin: adminMock(), config });
    expect(res.status).toBe('recovered');
  });

  it('FAILED: a non-auth sign-in error with no service-role client available for recovery', async () => {
    const res = await provisionCanary({ anon: anonMock({ signInError: { status: 500 } }), admin: null, config });
    expect(res.status).toBe('failed');
  });

  it('never surfaces the credential VALUE in the returned result (env-var NAMES for actionability are fine)', async () => {
    const secretPassword = 'S3cr3t-canary-value';
    const res = await provisionCanary({ anon: anonMock({ signInError: { status: 401 } }), admin: adminMock(), config: { email: config.email, password: secretPassword } });
    expect(JSON.stringify(res)).not.toContain(secretPassword);
  });
});
