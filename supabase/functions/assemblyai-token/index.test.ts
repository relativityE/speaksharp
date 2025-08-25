import { handler } from './index.ts';
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assert } from 'https://deno.land/std@0.224.0/assert/assert.ts';

Deno.test('assemblyai-token edge function', async (t) => {
  const mockCreateAssemblyAI = () => ({
    realtime: {
      createTemporaryToken: () => Promise.resolve('mock_assemblyai_token'),
    },
  }) as any;

  // This mock will always fail auth, useful for testing bypass
  const failingMockCreateSupabase = () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: null }, error: { message: 'Unauthorized' } }),
    },
  }) as any;

  await t.step('should return a token if SUPER_DEV_MODE is enabled, regardless of auth status', async () => {
    // Set the env var for this test
    Deno.env.set('SUPER_DEV_MODE', 'true');

    try {
      const req = new Request('http://localhost/assemblyai-token', { method: 'POST' });
      // We use the failing mock here to prove auth is bypassed
      const res = await handler(req, failingMockCreateSupabase, mockCreateAssemblyAI);
      const json = await res.json();

      assertEquals(res.status, 200);
      assertExists(json.token);
      assertEquals(json.token, 'mock_assemblyai_token');
    } finally {
      // Clean up the env var
      Deno.env.delete('SUPER_DEV_MODE');
    }
  });

  await t.step('should return 401 if user is not authenticated and dev mode is off', async () => {
    // Ensure dev mode is off
    assert(Deno.env.get('SUPER_DEV_MODE') === undefined, 'SUPER_DEV_MODE should not be set');

    const req = new Request('http://localhost/assemblyai-token', { method: 'POST' });
    const res = await handler(req, failingMockCreateSupabase, mockCreateAssemblyAI);
    const json = await res.json();

    assertEquals(res.status, 401);
    // The error message was updated in the source file, let's match it.
    assertEquals(json.error, 'Authentication failed - v2');
  });

  await t.step('should return 403 if free user exceeds usage limit', async () => {
    const mockCreateSupabase = () => ({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'test-user' } }, error: null }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: { subscription_status: 'free', usage_seconds: 1000 }, error: null }),
          }),
        }),
      }),
    }) as any;

    const req = new Request('http://localhost/assemblyai-token', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer fake-token' },
    });
    const res = await handler(req, mockCreateSupabase, mockCreateAssemblyAI);
    const json = await res.json();

    assertEquals(res.status, 403);
    assertEquals(json.error, 'Usage limit exceeded. Please upgrade to Pro for unlimited access.');
  });

  await t.step('should return a token for a pro user', async () => {
    const mockCreateSupabase = () => ({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'pro-user' } }, error: null }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: { subscription_status: 'pro' }, error: null }),
          }),
        }),
      }),
    }) as any;

    const req = new Request('http://localhost/assemblyai-token', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer fake-token' },
    });
    const res = await handler(req, mockCreateSupabase, mockCreateAssemblyAI);
    const json = await res.json();

    assertEquals(res.status, 200);
    assertExists(json.token);
    assertEquals(json.token, 'mock_assemblyai_token');
  });
});
