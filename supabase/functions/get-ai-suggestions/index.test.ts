import { handler } from './index.ts';
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assert } from 'https://deno.land/std@0.224.0/assert/assert.ts';

// Mock the global fetch to avoid real API calls
globalThis.fetch = async (url, options) => {
  if (url.toString().includes('generativelanguage.googleapis.com')) {
    const mockApiResponse = {
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              summary: "This is a mock summary.",
              suggestions: [{ title: "Pacing", description: "Your pacing was a bit fast." }]
            })
          }]
        }
      }]
    };
    return new Response(JSON.stringify(mockApiResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response('Not Found', { status: 404 });
};

Deno.test('get-ai-suggestions edge function', async (t) => {
  // This mock will always fail auth, useful for testing bypass
  const failingMockCreateSupabase = () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: null }, error: { message: 'Unauthorized' } }),
    },
  }) as any;

  await t.step('should return 401 if user is not authenticated', async () => {
    const req = new Request('http://localhost/get-ai-suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: "hello world" })
    });
    const res = await handler(req, failingMockCreateSupabase);
    const json = await res.json();

    assertEquals(res.status, 401);
    assertEquals(json.error, 'Authentication failed');
  });

  await t.step('should return 403 if user is not a pro member', async () => {
    const mockCreateSupabaseFreeUser = () => ({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'free-user' } }, error: null }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: { subscription_status: 'free' }, error: null }),
          }),
        }),
      }),
    }) as any;

    const req = new Request('http://localhost/get-ai-suggestions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer fake-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: "hello world" })
    });
    const res = await handler(req, mockCreateSupabaseFreeUser);
    const json = await res.json();

    assertEquals(res.status, 403);
    assertEquals(json.error, 'User is not on a Pro plan');
  });

  await t.step('should return suggestions for a pro user', async () => {
    Deno.env.set('GEMINI_API_KEY', 'mock-key');
    const mockCreateSupabaseProUser = () => ({
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

    try {
        const req = new Request('http://localhost/get-ai-suggestions', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer fake-token', 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript: "hello world pro user" })
        });
        const res = await handler(req, mockCreateSupabaseProUser);
        const json = await res.json();

        assertEquals(res.status, 200);
        assertExists(json.suggestions);
        assertEquals(json.suggestions.summary, "This is a mock summary.");
    } finally {
        Deno.env.delete('GEMINI_API_KEY');
    }
  });
});
