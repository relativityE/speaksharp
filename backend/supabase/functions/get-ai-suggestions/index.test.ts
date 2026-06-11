import { handler } from './index.ts';
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Mock the global fetch to avoid real API calls
let fetchCount = 0;
let mockGeminiMode: 'ok' | 'malformed' | 'error' | 'throw' = 'ok';
let lastGeminiRequestBody: Record<string, unknown> | null = null;
let mockGeminiText = JSON.stringify({
  summary: "This is a mock summary.",
  suggestions: [{ title: "Pacing", description: "Your pacing was a bit fast." }]
});

globalThis.fetch = async (url, init) => {
  if (url.toString().includes('generativelanguage.googleapis.com')) {
    fetchCount++;
    const requestBody = (init as { body?: BodyInit | null } | undefined)?.body;
    lastGeminiRequestBody = requestBody ? JSON.parse(String(requestBody)) : null;
    if (mockGeminiMode === 'throw') {
      throw new Error('network down');
    }
    if (mockGeminiMode === 'error') {
      return new Response('upstream unavailable', { status: 503 });
    }
    const mockApiResponse = {
      candidates: [{
        content: {
          parts: [{
            text: mockGeminiText
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
  mockGeminiMode = 'ok';
  mockGeminiText = JSON.stringify({
    summary: "This is a mock summary.",
    suggestions: [{ title: "Pacing", description: "Your pacing was a bit fast." }]
  });
  lastGeminiRequestBody = null;

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

  await t.step('should return 403 if user is a Free member', async () => {
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
      rpc: () => Promise.resolve({ data: { allowed: true, remaining: 19, limit: 20 }, error: null }),
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

  await t.step('should return safe fallback suggestions when Gemini API key is missing', async () => {
    Deno.env.delete('GEMINI_API_KEY');
    fetchCount = 0;

    const mockCreateSupabaseProUser = () => ({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'pro-user' } }, error: null }),
      },
      rpc: () => Promise.resolve({ data: { allowed: true, remaining: 19, limit: 20 }, error: null }),
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

    const req = new Request('http://localhost/get-ai-suggestions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer fake-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: "hello missing key" })
    });
    const res = await handler(req, mockCreateSupabaseProUser);
    const json = await res.json();

    assertEquals(res.status, 200);
    assertEquals(json.degraded, true);
    assertEquals(json.suggestions.summary, 'AI suggestions are temporarily unavailable for this session.');
    assertEquals(fetchCount, 0);
  });

  await t.step('should return cached suggestions if available', async () => {
    Deno.env.set('GEMINI_API_KEY', 'mock-key');
    fetchCount = 0;
    const mockSuggestions = { summary: 'Cached summary', suggestions: [] };

    const mockCreateSupabaseWithCache = () => ({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'pro-user' } }, error: null }),
      },
      rpc: () => {
        throw new Error('quota should not be consumed for cached suggestions');
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
    const updateFilters: Array<[string, string]> = [];

    const mockCreateSupabaseWithSave = () => ({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'pro-user' } }, error: null }),
      },
      rpc: () => Promise.resolve({ data: { allowed: true, remaining: 19, limit: 20 }, error: null }),
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
              updateFilters.push([_col, _val]);
              savedData = data;
              return result;
            },
            then: (resolve: (value: { error: null }) => void) => {
              resolve({ error: null });
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
      assertEquals(updateFilters, [['id', 'test-session'], ['user_id', 'pro-user']]);
    } finally {
      Deno.env.delete('GEMINI_API_KEY');
    }
  });

  await t.step('should cap transcript length before sending to Gemini', async () => {
    Deno.env.set('GEMINI_API_KEY', 'mock-key');
    fetchCount = 0;
    lastGeminiRequestBody = null;

    const mockCreateSupabaseProUser = () => ({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'pro-user' } }, error: null }),
      },
      rpc: () => Promise.resolve({ data: { allowed: true, remaining: 19, limit: 20 }, error: null }),
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
        body: JSON.stringify({ transcript: "a".repeat(9000) })
      });
      const res = await handler(req, mockCreateSupabaseProUser);

      assertEquals(res.status, 200);
      const prompt = (lastGeminiRequestBody as any)?.contents?.[0]?.parts?.[0]?.text;
      assertExists(prompt);
      assertEquals(String(prompt).includes('[Transcript truncated for coaching request length.]'), true);
      assertEquals(String(prompt).includes("a".repeat(8500)), false);
    } finally {
      Deno.env.delete('GEMINI_API_KEY');
    }
  });

  await t.step('should request semantic and delivery coaching categories from Gemini', async () => {
    Deno.env.set('GEMINI_API_KEY', 'mock-key');
    fetchCount = 0;
    lastGeminiRequestBody = null;

    const mockCreateSupabaseProUser = () => ({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'pro-user' } }, error: null }),
      },
      rpc: () => Promise.resolve({ data: { allowed: true, remaining: 19, limit: 20 }, error: null }),
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
        body: JSON.stringify({
          transcript: "Today I want to explain why our launch plan matters. First, we reduce risk. Next, we build trust.",
          metrics: { wpm: 132, filler_words: { like: 1 } },
        })
      });
      const res = await handler(req, mockCreateSupabaseProUser);

      assertEquals(res.status, 200);
      assertEquals(fetchCount, 1);

      const prompt = (lastGeminiRequestBody as any)?.contents?.[0]?.parts?.[0]?.text;
      assertExists(prompt);
      assertEquals(String(prompt).includes('logical structure'), true);
      assertEquals(String(prompt).includes('Vocabulary & Variety'), true);
      assertEquals(String(prompt).includes('Audience Impact'), true);
      assertEquals(String(prompt).includes('Delivery & Clutter'), true);
      assertEquals(String(prompt).includes('Do not invent facts'), true);
    } finally {
      Deno.env.delete('GEMINI_API_KEY');
    }
  });

  await t.step('should return safe fallback suggestions for malformed Gemini JSON', async () => {
    Deno.env.set('GEMINI_API_KEY', 'mock-key');
    fetchCount = 0;
    mockGeminiMode = 'malformed';
    mockGeminiText = 'Here are some thoughts, but not JSON.';

    const mockCreateSupabaseProUser = () => ({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'pro-user' } }, error: null }),
      },
      rpc: () => Promise.resolve({ data: { allowed: true, remaining: 19, limit: 20 }, error: null }),
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
        body: JSON.stringify({ transcript: "hello malformed json" })
      });
      const res = await handler(req, mockCreateSupabaseProUser);
      const json = await res.json();

      assertEquals(res.status, 200);
      assertEquals(json.degraded, true);
      assertEquals(json.suggestions.summary, 'AI suggestions are temporarily unavailable for this session.');
      assertEquals(fetchCount, 1);
    } finally {
      mockGeminiMode = 'ok';
      mockGeminiText = JSON.stringify({
        summary: "This is a mock summary.",
        suggestions: [{ title: "Pacing", description: "Your pacing was a bit fast." }]
      });
      Deno.env.delete('GEMINI_API_KEY');
    }
  });

  await t.step('should return safe fallback suggestions when Gemini is unavailable', async () => {
    Deno.env.set('GEMINI_API_KEY', 'mock-key');
    fetchCount = 0;
    mockGeminiMode = 'error';

    const mockCreateSupabaseProUser = () => ({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'pro-user' } }, error: null }),
      },
      rpc: () => Promise.resolve({ data: { allowed: true, remaining: 19, limit: 20 }, error: null }),
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
        body: JSON.stringify({ transcript: "hello unavailable model" })
      });
      const res = await handler(req, mockCreateSupabaseProUser);
      const json = await res.json();

      assertEquals(res.status, 200);
      assertEquals(json.degraded, true);
      assertEquals(json.suggestions.summary, 'AI suggestions are temporarily unavailable for this session.');
      assertEquals(fetchCount, 1);
    } finally {
      mockGeminiMode = 'ok';
      Deno.env.delete('GEMINI_API_KEY');
    }
  });

  await t.step('should return 429 when daily AI coaching quota is exhausted', async () => {
    Deno.env.set('GEMINI_API_KEY', 'mock-key');
    fetchCount = 0;

    const mockCreateSupabaseQuotaExceeded = () => ({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'pro-user' } }, error: null }),
      },
      rpc: () => Promise.resolve({ data: { allowed: false, remaining: 0, limit: 20, used: 20 }, error: null }),
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
        body: JSON.stringify({ transcript: "hello quota" })
      });
      const res = await handler(req, mockCreateSupabaseQuotaExceeded);
      const json = await res.json();

      assertEquals(res.status, 429);
      assertEquals(json.error, 'Daily AI coaching limit reached. Try again tomorrow.');
      assertEquals(fetchCount, 0);
    } finally {
      Deno.env.delete('GEMINI_API_KEY');
    }
  });
});
