import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { isLocalBillingSandbox, LOCAL_BILLING_SANDBOX_ACKNOWLEDGEMENT, paymentsEnabled } from '../appRuntimeConfig';

// The only browser path that shows checkout with a TEST key: the local billing build on loopback.
const ok = {
  acknowledgement: LOCAL_BILLING_SANDBOX_ACKNOWLEDGEMENT,
  key: 'pk_test_abc',
  supabaseUrl: 'http://127.0.0.1:54321',
  pageOrigin: 'http://localhost:5173',
};

describe('isLocalBillingSandbox (loopback-only test checkout)', () => {
  it('opens only when every condition holds', () => {
    expect(isLocalBillingSandbox(ok)).toBe(true);
    expect(isLocalBillingSandbox({ ...ok, supabaseUrl: 'http://localhost:54321/', pageOrigin: 'http://127.0.0.1:5173' })).toBe(true);
  });

  it.each([
    ['no acknowledgement', { acknowledgement: undefined }],
    ['a boolean-style acknowledgement', { acknowledgement: 'true' }],
    ['a live key', { key: 'pk_live_abc' }],
    ['a missing key', { key: '' }],
    ['an unknown key', { key: 'sk_test_abc' }],
    ['a hosted Supabase project', { supabaseUrl: 'https://abcd.supabase.co' }],
    ['https on the loopback API', { supabaseUrl: 'https://127.0.0.1:54321' }],
    ['another loopback port', { supabaseUrl: 'http://127.0.0.1:54322' }],
    ['a path on the API URL', { supabaseUrl: 'http://127.0.0.1:54321/rest' }],
    ['credentials in the API URL', { supabaseUrl: 'http://u:p@127.0.0.1:54321' }],
    ['the in-stack gateway (server-only origin)', { supabaseUrl: 'http://kong:8000' }],
    ['a deployed page origin', { pageOrigin: 'https://speaksharp.app' }],
    ['another local port', { pageOrigin: 'http://localhost:5174' }],
    ['no page origin', { pageOrigin: undefined }],
  ])('stays closed with %s', (_label, change) => {
    expect(isLocalBillingSandbox({ ...ok, ...change })).toBe(false);
  });

  it('leaves the production rule unchanged: a test key alone never enables checkout', () => {
    expect(paymentsEnabled(true, 'pk_test_abc')).toBe(false);
    expect(paymentsEnabled(false, 'pk_live_abc')).toBe(false);
    expect(paymentsEnabled(true, 'pk_live_abc')).toBe(true);
  });
});

describe('only the local billing workflow builds with the sandbox acknowledgement', () => {
  it('no other workflow sets VITE_BILLING_LOCAL_SANDBOX', () => {
    const dir = resolve(__dirname, '../../../../.github/workflows');
    const setters = readdirSync(dir)
      .filter((f) => /\.ya?ml$/.test(f))
      .filter((f) => readFileSync(resolve(dir, f), 'utf8').includes('VITE_BILLING_LOCAL_SANDBOX'));
    expect(setters).toEqual(['billing-local-stack-journey.yml']);
  });

  it('the local billing workflow builds against the loopback API and serves on the local app origin', () => {
    const wf = readFileSync(resolve(__dirname, '../../../../.github/workflows/billing-local-stack-journey.yml'), 'utf8');
    expect(wf).toMatch(/VITE_BILLING_LOCAL_SANDBOX: ISOLATED-TEST-MODE-ONLY/);
    expect(wf).toMatch(/LOCAL_APP_URL: http:\/\/localhost:5173/);
  });
});
