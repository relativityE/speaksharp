import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isApprovedLocalBillingSandbox } from "./localSandbox.ts";

const base: Record<string, string> = {
  BILLING_LOCAL_SANDBOX: 'ISOLATED-TEST-MODE-ONLY', STRIPE_SECRET_KEY: 'sk_test_synthetic',
  SUPABASE_URL: 'http://kong:8000', SITE_URL: 'http://localhost:5173',
};
const check = (overrides: Record<string, string | undefined> = {}, origin?: string) =>
  isApprovedLocalBillingSandbox((key) => key in overrides ? overrides[key] : base[key],
    new Request('http://127.0.0.1:54321/functions/v1/stripe-checkout', { headers: origin ? { Origin: origin } : {} }));

Deno.test('accepts only the local stack API origins and local app origins', () => {
  for (const api of ['http://kong:8000', 'http://127.0.0.1:54321', 'http://localhost:54321', 'http://kong:8000/']) {
    assertEquals(check({ SUPABASE_URL: api }), true, api);
  }
  for (const site of ['http://localhost:5173', 'http://127.0.0.1:5173']) assertEquals(check({ SITE_URL: site }, site), true, site);
});

Deno.test('refuses every hosted, credentialed, pathed or near-miss configuration', () => {
  for (const api of ['https://yxlapjuovrsvjswkwnrk.supabase.co', 'http://kong:8001', 'http://kong:8000/rest',
    'http://kong:8000/?x=1', 'http://a:b@127.0.0.1:54321', 'http://127.0.0.2:54321', 'not a url', '']) {
    assertEquals(check({ SUPABASE_URL: api }), false, api);
  }
  for (const site of ['https://speaksharp-public.vercel.app', 'http://localhost:5174', 'http://localhost:5173/', 'https://localhost:5173']) {
    assertEquals(check({ SITE_URL: site }), false, site);
  }
  assertEquals(check({ BILLING_LOCAL_SANDBOX: 'true' }), false);
  assertEquals(check({ STRIPE_SECRET_KEY: 'sk_live_synthetic' }), false);
  assertEquals(check({}, 'https://speaksharp-public.vercel.app'), false);
});
