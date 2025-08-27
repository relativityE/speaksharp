import { handler } from './index.ts';
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { stub } from "https://deno.land/std@0.224.0/testing/mock.ts";
import * as jose from 'https://esm.sh/jose@4.15.1';

Deno.test('generate-dev-jwt edge function', async (t) => {

  await t.step('should return 500 if environment variables are missing', async () => {
    const envStub = stub(Deno.env, "get", () => undefined);
    try {
      const req = new Request('http://localhost/generate-dev-jwt', { method: 'POST' });
      const res = await handler(req);
      assertEquals(res.status, 500);
      const json = await res.json();
      assertEquals(json.error, 'Missing required environment variables');
    } finally {
      envStub.restore();
    }
  });

  await t.step('should return a JWT if environment variables are set', async () => {
    const envStub = stub(Deno.env, "get", (key) => {
      if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'super-secret-key-that-is-long-enough';
      if (key === 'UUID_DEV_USER') return 'test-uuid';
      return undefined;
    });

    try {
      const req = new Request('http://localhost/generate-dev-jwt', { method: 'POST' });
      const res = await handler(req);

      assertEquals(res.status, 200);
      const json = await res.json();
      assertExists(json.token);
      assertEquals(json.expires_in, 600);

      // Optional: verify the token to ensure it's well-formed
      const { payload } = await jose.jwtVerify(json.token, new TextEncoder().encode('super-secret-key-that-is-long-enough'));
      assertEquals(payload.sub, 'test-uuid');
      assertExists(payload.exp);

    } finally {
      envStub.restore();
    }
  });
});
