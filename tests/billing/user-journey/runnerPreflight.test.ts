// Offline controls for the real runner's preflight (Sam's smoke review). No network: fetch is a fake that
// records every address, and any non-loopback address fails the test.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { fingerprint, runnerPreflight } from './runnerPreflight.mjs';

const jwt = (payload: Record<string, unknown>) =>
  `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
const SECRET = `sk_test_${'A1'.repeat(20)}`;
const PRICE = 'price_ProMonthly1282';
const PUBLISHABLE = `pk_test_${'B2'.repeat(20)}`;
const good = (): Record<string, string | undefined> => ({
  BILLING_SANDBOX_STRIPE_KEY: SECRET,
  BILLING_SANDBOX_PUBLISHABLE_KEY: PUBLISHABLE,
  BILLING_LOCAL_APP_PUBLISHABLE_KEY_SHA256: fingerprint(PUBLISHABLE),
  BILLING_SANDBOX_PRICE_ID: PRICE,
  BILLING_LOCAL_FUNCTIONS_STRIPE_KEY_SHA256: fingerprint(SECRET),
  BILLING_LOCAL_FUNCTIONS_PRICE_SHA256: fingerprint(PRICE),
  BILLING_SANDBOX_SUPABASE_URL: 'http://127.0.0.1:54321',
  BILLING_SANDBOX_ANON_KEY: jwt({ iss: 'supabase-demo', role: 'anon', exp: 1983812996 }),
  BILLING_SANDBOX_SERVICE_ROLE_KEY: jwt({ iss: 'supabase-demo', role: 'service_role', exp: 1983812996 }),
});

function network(status: Record<string, number> = {}) {
  const urls: string[] = [];
  const fetchImpl = async (url: string) => {
    urls.push(url);
    assert.match(url, /^http:\/\/(127\.0\.0\.1|localhost):54321\//, `non-loopback fetch: ${url}`);
    const path = new URL(url).pathname;
    return { status: status[path] ?? (path === '/auth/v1/health' ? 200 : 204) };
  };
  return { urls, fetchImpl };
}

test('a test-mode runner bound to this stack passes, touching only the loopback stack', async () => {
  const net = network();
  const facts = await runnerPreflight(good(), net.fetchImpl);
  assert.deepEqual(facts, { api: 'http://127.0.0.1:54321', keyClass: 'test', keysMatchStack: true, backend: 'loopback' });
  assert.deepEqual(net.urls, ['http://127.0.0.1:54321/auth/v1/health', 'http://127.0.0.1:54321/functions/v1/stripe-checkout']);
  assert.ok(net.urls.every(url => !url.includes('stripe.com')));
});

test('negative control: a live, restricted or malformed key is refused before ANY request', async () => {
  const cases: [string, Record<string, string>][] = [
    ['live_or_restricted_key_refused', { BILLING_SANDBOX_STRIPE_KEY: `sk_live_${'A1'.repeat(20)}` }],
    ['live_or_restricted_key_refused', { BILLING_SANDBOX_STRIPE_KEY: `rk_test_${'A1'.repeat(20)}` }],
    ['live_or_restricted_key_refused', { BILLING_SANDBOX_STRIPE_KEY: `rk_live_${'A1'.repeat(20)}` }],
    ['live_or_restricted_key_refused', { BILLING_SANDBOX_PUBLISHABLE_KEY: `pk_live_${'B2'.repeat(20)}` }],
    ['test_secret_key_required', { BILLING_SANDBOX_STRIPE_KEY: 'sk_test_short' }],
    ['test_secret_key_required', { BILLING_SANDBOX_STRIPE_KEY: `pk_test_${'A1'.repeat(20)}` }],
    ['test_secret_key_required', { BILLING_SANDBOX_STRIPE_KEY: '' }],
    ['test_publishable_key_required', { BILLING_SANDBOX_PUBLISHABLE_KEY: `sk_test_${'B2'.repeat(20)}` }],
    ['test_publishable_key_required', { BILLING_SANDBOX_PUBLISHABLE_KEY: '' }],
    ['price_id_malformed', { BILLING_SANDBOX_PRICE_ID: 'prod_x' }],
  ];
  for (const [code, change] of cases) {
    const net = network();
    await assert.rejects(runnerPreflight({ ...good(), ...change }, net.fetchImpl), new RegExp(code), JSON.stringify(change));
    assert.deepEqual(net.urls, [], JSON.stringify(change));
  }
});

test('negative control: a key or price that is not the stack\'s is refused before ANY request', async () => {
  const other = `sk_test_${'C3'.repeat(20)}`;
  const cases: [string, Record<string, string | undefined>][] = [
    ['stripe_key_mismatch_with_stack', { BILLING_SANDBOX_STRIPE_KEY: other }],
    ['stripe_key_mismatch_with_stack', { BILLING_LOCAL_FUNCTIONS_STRIPE_KEY_SHA256: fingerprint(other) }],
    ['price_mismatch_with_stack', { BILLING_SANDBOX_PRICE_ID: 'price_SomeOtherPrice' }],
    ['stack_key_fingerprint_missing', { BILLING_LOCAL_FUNCTIONS_STRIPE_KEY_SHA256: undefined }],
    ['stack_key_fingerprint_missing', { BILLING_LOCAL_FUNCTIONS_PRICE_SHA256: 'not-a-hash' }],
    // Sam's v5 smoke return: a different pk_test used to pass. It must be the one the app was built with.
    ['publishable_key_mismatch_with_app', { BILLING_SANDBOX_PUBLISHABLE_KEY: `pk_test_${'D4'.repeat(20)}` }],
    ['publishable_key_mismatch_with_app', { BILLING_LOCAL_APP_PUBLISHABLE_KEY_SHA256: fingerprint(`pk_test_${'D4'.repeat(20)}`) }],
    ['app_publishable_key_fingerprint_missing', { BILLING_LOCAL_APP_PUBLISHABLE_KEY_SHA256: undefined }],
    ['app_publishable_key_fingerprint_missing', { BILLING_LOCAL_APP_PUBLISHABLE_KEY_SHA256: 'not-a-hash' }],
  ];
  for (const [code, change] of cases) {
    const net = network();
    await assert.rejects(runnerPreflight({ ...good(), ...change }, net.fetchImpl), new RegExp(code), JSON.stringify(change));
    assert.deepEqual(net.urls, []);
  }
});

test('negative control: a hosted or non-local backend is refused before ANY request', async () => {
  const cases: [string, Record<string, string>][] = [
    ['supabase_not_loopback', { BILLING_SANDBOX_SUPABASE_URL: 'https://yxlapjuovrsvjswkwnrk.supabase.co' }],
    ['supabase_not_loopback', { BILLING_SANDBOX_SUPABASE_URL: 'http://127.0.0.1:54321/rest/v1' }],
    ['supabase_not_loopback', { BILLING_SANDBOX_SUPABASE_URL: 'http://127.0.0.1.evil.test:54321' }],
    ['supabase_not_loopback', { BILLING_SANDBOX_SUPABASE_URL: 'http://user@127.0.0.1:54321' }],
    ['supabase_url_invalid', { BILLING_SANDBOX_SUPABASE_URL: 'not a url' }],
    ['anon_key_not_local', { BILLING_SANDBOX_ANON_KEY: jwt({ iss: 'supabase', ref: 'yxlapjuovrsvjswkwnrk', role: 'anon' }) }],
    ['anon_key_not_local', { BILLING_SANDBOX_ANON_KEY: jwt({ iss: 'supabase-demo', role: 'service_role' }) }],
    ['anon_key_not_local', { BILLING_SANDBOX_ANON_KEY: 'sb_publishable_x' }],
    ['service_key_not_local', { BILLING_SANDBOX_SERVICE_ROLE_KEY: jwt({ iss: 'supabase', ref: 'yxlapjuovrsvjswkwnrk', role: 'service_role' }) }],
    ['service_key_not_local', { BILLING_SANDBOX_SERVICE_ROLE_KEY: jwt({ iss: 'supabase-demo', role: 'anon' }) }],
  ];
  for (const [code, change] of cases) {
    const net = network();
    await assert.rejects(runnerPreflight({ ...good(), ...change }, net.fetchImpl), new RegExp(code), JSON.stringify(change));
    assert.deepEqual(net.urls, []);
  }
});

test('negative control: a local stack that does not answer stops the run before Stripe', async () => {
  for (const [status, code] of [[{ '/auth/v1/health': 503 }, 'local_auth_unhealthy'],
    [{ '/functions/v1/stripe-checkout': 502 }, 'local_functions_unavailable']] as const) {
    await assert.rejects(runnerPreflight(good(), network(status).fetchImpl), new RegExp(code));
  }
  await assert.rejects(runnerPreflight(good(), async () => { throw new Error('ECONNREFUSED'); }), /local_backend_unreachable/);
});

test('the runner runs the preflight before its first Stripe call, independently of the payment gate', () => {
  const spec = readFileSync('tests/billing/user-journey/journey.billing.spec.ts', 'utf8');
  const run = spec.slice(spec.indexOf('async run(): Promise<void> {'));
  const preflight = run.indexOf('await runnerPreflight(env)');
  assert.ok(preflight > -1, 'run() calls runnerPreflight');
  assert.ok(preflight < run.indexOf('await this.setup()'), 'before setup(), whose first act is a Stripe call');
  // Only the local stack has the fingerprints; the hosted target keeps its reviewed preflight.
  assert.match(run.slice(0, preflight + 40), /if \(useLocalStack\) await runnerPreflight\(env\)/);
  // Nothing in the preflight module reads the app's payment gate.
  assert.doesNotMatch(readFileSync('tests/billing/user-journey/runnerPreflight.mjs', 'utf8'), /arePaymentsEnabled|VITE_/);
});

test('the workflow gives the runner the stack\'s key and price fingerprints and the test publishable key', () => {
  const workflow = readFileSync('.github/workflows/billing-local-stack-journey.yml', 'utf8');
  assert.match(workflow, /BILLING_LOCAL_FUNCTIONS_STRIPE_KEY_SHA256=\$\(printf '%s' "\$STRIPE_TEST_SECRET_KEY" \| sha256sum \| cut -d' ' -f1\)/);
  assert.match(workflow, /BILLING_LOCAL_FUNCTIONS_PRICE_SHA256=\$\(printf '%s' "\$STRIPE_TEST_PRO_PRICE_ID" \| sha256sum \| cut -d' ' -f1\)/);
  assert.match(workflow, /BILLING_SANDBOX_PUBLISHABLE_KEY: \$\{\{ vars\.STRIPE_TEST_PUBLISHABLE_KEY \}\}/);
  // The app's publishable key fingerprint is written in the step that builds the app, from the key it used.
  const build = workflow.slice(workflow.indexOf("- name: Build and serve this commit's app on the local origin"),
    workflow.indexOf('- name: Install Chromium'));
  assert.match(build, /VITE_STRIPE_PUBLISHABLE_KEY: \$\{\{ vars\.STRIPE_TEST_PUBLISHABLE_KEY \}\}/);
  assert.match(build, /BILLING_LOCAL_APP_PUBLISHABLE_KEY_SHA256=\$\(printf '%s' "\$VITE_STRIPE_PUBLISHABLE_KEY" \| sha256sum \| cut -d' ' -f1\)" >> "\$GITHUB_ENV"/);
  assert.ok(build.indexOf('vite build') < build.indexOf('BILLING_LOCAL_APP_PUBLISHABLE_KEY_SHA256'));
});
