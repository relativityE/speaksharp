import { handler } from './index.ts';
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Mock the global fetch to avoid real API calls
let fetchCount = 0;
globalThis.fetch = async (url) => {
  if (url.toString().includes('generativelanguage.googleapis.com')) {
    fetchCount++;
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
  await t.step('should return 401 if user is not authenticated', async () => {
    const failingMockSupabase = () => ({
      auth: {
        getUser: () => Promise.resolve({ data: { user: null }, error: { message: 'Unauthorized' } }),
      },
      from: () => ({
        select: () => ({
          single: () => Promise.resolve({ data: null, error: { code: 'PGRST116' } }),
        }),
      }),
    }) as any;

    const req = new Request('http://localhost/get-ai-suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: "hello world" })
    });
    const res = await handler(req, failingMockSupabase);
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
        select: () => {
          const result = {
            eq: () => result,
            single: () => Promise.resolve({ data: { subscription_status: 'free' }, error: null }),
          };
          return result;
        },
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
        select: () => {
          const result = {
            eq: () => result,
            single: () => Promise.resolve({ data: { subscription_status: 'pro' }, error: null }),
          };
          return result;
        },
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

  await t.step('should return cached suggestions if available', async () => {
    Deno.env.set('GEMINI_API_KEY', 'mock-key');
    fetchCount = 0;
    const mockSuggestions = { summary: 'Cached summary', suggestions: [] };

    const mockCreateSupabaseWithCache = () => ({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'pro-user' } }, error: null }),
      },
      from: (table: string) => ({
        select: (_columns: string) => {
          const result = {
            eq: (_col: string, _val: string) => result,
            single: () => {
              if (table === 'user_profiles') return Promise.resolve({ data: { subscription_status: 'pro' }, error: null });
              if (table === 'sessions') return Promise.resolve({ data: { ai_suggestions: mockSuggestions }, error: null });
              return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
            }
          };
          return result;
        }
      })
    }) as any;

    try {
      const req = new Request('http://localhost/get-ai-suggestions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer fake-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: "hello world", sessionId: 'test-session' })
      });
      const res = await handler(req, mockCreateSupabaseWithCache);
      const json = await res.json();

      assertEquals(res.status, 200);
      assertEquals(json.suggestions.summary, 'Cached summary');
      assertEquals(fetchCount, 0, 'Should not call Gemini API when cached data exists');
    } finally {
      Deno.env.delete('GEMINI_API_KEY');
    }
  });

  await t.step('should save suggestions to DB when sessionId is provided', async () => {
    Deno.env.set('GEMINI_API_KEY', 'mock-key');
    fetchCount = 0;
    let savedData: any = null;

    const mockCreateSupabaseWithSave = () => ({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'pro-user' } }, error: null }),
      },
      from: (table: string) => ({
        select: (_columns: string) => {
          const result = {
            eq: (_col: string, _val: string) => result,
            single: () => {
              if (table === 'user_profiles') return Promise.resolve({ data: { subscription_status: 'pro' }, error: null });
              if (table === 'sessions') return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
              return Promise.resolve({ data: null, error: null });
            }
          };
          return result;
        },
        update: (data: any) => {
          const result = {
            eq: (_col: string, _val: string) => {
              savedData = data;
              return Promise.resolve({ error: null });
            }
          };
          return result;
        }
      })
    }) as any;

    try {
      const req = new Request('http://localhost/get-ai-suggestions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer fake-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: "hello world", sessionId: 'test-session' })
      });
      const res = await handler(req, mockCreateSupabaseWithSave);
      const _json = await res.json();

      assertEquals(res.status, 200);
      assertEquals(fetchCount, 1);
      assertExists(savedData.ai_suggestions);
      assertEquals(savedData.ai_suggestions.summary, "This is a mock summary.");
    } finally {
      Deno.env.delete('GEMINI_API_KEY');
    }
  });
});
