// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { accountClosureConfigProbe, readAccountClosureEffectiveConfig } from '../../backend/supabase/functions/_shared/accountClosureConfigProbe';
const deployment = 'fixture-project_33333333-3333-4333-8333-333333333333_2';
function fixture() {
  const values: Record<string, string> = { SUPABASE_SERVICE_ROLE_KEY: 'private-service-key', STRIPE_SECRET_KEY: 'sk_test_private-key',
    SITE_URL: 'https://example.test', STRIPE_PRO_PRICE_ID: 'price_fixture', PAYMENTS_ENABLED: 'false',
    SUPABASE_URL: 'https://fixture-project.supabase.co', DENO_DEPLOYMENT_ID: deployment,
    SB_REGION: 'us-east-1', SB_EXECUTION_ID: '44444444-4444-4444-8444-444444444444',
    ACCOUNT_CLOSURE_RUNTIME_BINDING: 'private-grant-envelope' };
  const env = vi.fn((key: string) => values[key]);
  const config = vi.fn(() => readAccountClosureEffectiveConfig(env, 'test'));
  const request = (body: object = { nonce: 'a'.repeat(64), expectedDeploymentId: deployment }, authorization = 'Bearer private-service-key') =>
    new Request('https://fixture-project.supabase.co/functions/v1/account-closure?__operator_config=1', {
      method: 'POST', headers: { Authorization: authorization }, body: JSON.stringify(body),
    });
  return { values, env, config, request, probe: (req: Request) => accountClosureConfigProbe(req, env, 'account-closure', config) };
}
describe('separately authenticated pre-grant effective-config readback', () => {
  it('is available with payments disabled and without any grant, returning only allowlisted instance/config facts', async () => {
    const s = fixture(); delete s.values.ACCOUNT_CLOSURE_RUNTIME_BINDING;
    const response = (await s.probe(s.request()))!;
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
    const result = await response.json();
    expect(result).toMatchObject({ version: 1, function: 'account-closure', nonce: 'a'.repeat(64), deploymentId: deployment,
      projectId: 'fixture-project', region: 'us-east-1', executionId: s.values.SB_EXECUTION_ID,
      configuration: { paymentsEnabled: false, capturedStripeMode: 'test', stripeModeMatches: true } });
    expect(Object.keys(result.configuration).sort()).toEqual(['anonConfigured', 'capturedStripeMode', 'configuredStripeMode',
      'paymentsEnabled', 'proPriceId', 'siteOrigin', 'stripeModeMatches']);
    expect(JSON.stringify(result)).not.toMatch(/private-service|private-key|private-grant/);
    expect(s.env.mock.calls.flat()).not.toContain('ACCOUNT_CLOSURE_RUNTIME_BINDING');
  });
  it.each(['', 'Bearer wrong', 'Bearer ordinary-user-token'])('rejects %s before config/platform access', async (authorization) => {
    const s = fixture(); const response = (await s.probe(s.request(undefined, authorization)))!;
    expect(response.status).toBe(403); expect(s.config).not.toHaveBeenCalled();
    expect(s.env.mock.calls.flat()).toEqual(['SUPABASE_SERVICE_ROLE_KEY']);
  });
  it('leaves ordinary routes untouched without even reading the service key', async () => {
    const s = fixture(); expect(await s.probe(new Request('https://example.test'))).toBeNull();
    expect(s.env).not.toHaveBeenCalled(); expect(s.config).not.toHaveBeenCalled();
  });
  it.each([
    { nonce: 'short', expectedDeploymentId: deployment },
    { nonce: 'a'.repeat(64), expectedDeploymentId: `${deployment}0` },
    { nonce: 'a'.repeat(64), expectedDeploymentId: deployment, paymentsEnabled: true },
  ])('refuses invalid or caller-supplied config: %j', async (body) => {
    const s = fixture(); expect((await s.probe(s.request(body)))!.status).toBe(503); expect(s.config).not.toHaveBeenCalled();
  });
  it.each(['SUPABASE_URL', 'DENO_DEPLOYMENT_ID', 'SB_REGION', 'SB_EXECUTION_ID'])('missing actual %s is never guessed', async (field) => {
    const s = fixture(); delete s.values[field]; expect((await s.probe(s.request()))!.status).toBe(503);
  });
  it('refuses a foreign actual project and oversized body without exposing input', async () => {
    const s = fixture(); s.values.SUPABASE_URL = 'https://foreign.supabase.co';
    expect((await s.probe(s.request()))!.status).toBe(503);
    const response = (await s.probe(s.request({ nonce: 'secret'.repeat(1000), expectedDeploymentId: deployment })))!;
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('secret');
  });
  it('refuses current env mode disagreement with the captured Stripe client', async () => {
    const s = fixture(); s.values.STRIPE_SECRET_KEY = 'sk_live_private-key';
    expect((await s.probe(s.request()))!.status).toBe(503);
  });
  it('grant changes do not alter normalized effective config', () => {
    const s = fixture(); const before = s.config(); s.values.ACCOUNT_CLOSURE_RUNTIME_BINDING = 'different-grant';
    expect(s.config()).toEqual(before);
  });
});
