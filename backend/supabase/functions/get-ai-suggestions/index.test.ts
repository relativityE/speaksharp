import { handler } from './index.ts';
import { assertEquals, assertNotEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';

const suggestionA = {
  version: 'gemini_coaching_v1',
  what_worked: 'Your risk-first opening made the launch decision clear.',
  what_to_try_next: 'Move the support bottleneck after the recommendation.',
} as const;
const suggestionB = {
  version: 'gemini_coaching_v1',
  what_worked: 'The customer story made the renewal risk concrete.',
  what_to_try_next: 'Replace the vague final sentence with a dated owner commitment.',
} as const;

interface MockOptions {
  profile?: 'pro' | 'free' | 'unauthenticated';
  entitlement?: Record<string, unknown>;
  entitlementError?: unknown;
  userId?: string | null;
  session?: Record<string, unknown> | null;
  sessionError?: unknown;
  quota?: Record<string, unknown>;
  quotaError?: unknown;
  updateError?: unknown;
  readback?: unknown;
}

const savedSession = (overrides: Record<string, unknown> = {}) => ({
  transcript: 'First, we should delay the launch because support has no weekend coverage.',
  transcript_state: 'available',
  duration: 0,
  total_words: 0,
  filler_words: { um: { count: 0 } },
  clarity_score: 0,
  wpm: 0,
  pause_metrics: { extendedPauses: 0 },
  ai_suggestions: null,
  ...overrides,
});

let fetchCount = 0;
let fetchStatus = 200;
let geminiText = JSON.stringify(suggestionA);
let adaptiveGemini = false;
let lastPrompt = '';

globalThis.fetch = async (url, init) => {
  if (!url.toString().includes('generativelanguage.googleapis.com')) {
    return new Response('Not Found', { status: 404 });
  }
  fetchCount++;
  const body = JSON.parse(String((init as { body?: BodyInit | null } | undefined)?.body ?? '{}'));
  lastPrompt = String(body?.contents?.[0]?.parts?.[0]?.text ?? '');
  if (fetchStatus !== 200) return new Response('upstream unavailable', { status: fetchStatus });
  const text = adaptiveGemini && lastPrompt.includes('renewal story')
    ? JSON.stringify(suggestionB)
    : geminiText;
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

function mockSupabase(options: MockOptions = {}) {
  const state = {
    updated: null as unknown,
    filters: [] as Array<[string, unknown]>,
    rpcCount: 0,
  };
  const profile = options.profile ?? 'pro';
  const userId = options.userId === undefined ? 'pro-user' : options.userId;
  const session = options.session === undefined ? savedSession() : options.session;

  const client = {
    auth: {
      getUser: () => Promise.resolve(userId
        ? { data: { user: { id: userId } }, error: null }
        : { data: { user: null }, error: { message: 'Unauthorized' } }),
    },
    rpc: (name: string) => {
      if (name === 'check_usage_limit') {
        return Promise.resolve({
          data: options.entitlement ?? (profile === 'free'
            ? { can_start: false, is_pro: false, error: 'trial_expired' }
            : { can_start: true, is_pro: true }),
          error: options.entitlementError ?? null,
        });
      }
      state.rpcCount++;
      return Promise.resolve({
        data: options.quota ?? { allowed: true, remaining: 19, limit: 20 },
        error: options.quotaError ?? null,
      });
    },
    from: (table: string) => ({
      select: (_columns: string) => {
        const query = {
          eq: (_column: string, _value: unknown) => query,
          single: () => {
            if (table === 'user_profiles') {
              return profile === 'unauthenticated'
                ? Promise.resolve({ data: null, error: { code: 'PGRST116' } })
                : Promise.resolve({ data: { subscription_status: profile }, error: null });
            }
            if (table === 'sessions') {
              return Promise.resolve({ data: session, error: options.sessionError ?? (session ? null : { code: 'PGRST116' }) });
            }
            return Promise.resolve({ data: null, error: null });
          },
        };
        return query;
      },
      update: (value: unknown) => {
        state.updated = value;
        const query = {
          eq: (column: string, value: unknown) => {
            state.filters.push([column, value]);
            return query;
          },
          select: (_columns: string) => query,
          single: () => Promise.resolve({
            data: options.updateError
              ? null
              : { ai_suggestions: options.readback ?? (state.updated as { ai_suggestions?: unknown })?.ai_suggestions },
            error: options.updateError ?? null,
          }),
        };
        return query;
      },
    }),
  };
  return { create: () => client as any, state };
}

function request(body: Record<string, unknown> = { sessionId: 'session-a' }) {
  return new Request('http://localhost/get-ai-suggestions', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function resetProvider() {
  fetchCount = 0;
  fetchStatus = 200;
  geminiText = JSON.stringify(suggestionA);
  adaptiveGemini = false;
  lastPrompt = '';
  Deno.env.set('GEMINI_API_KEY', 'test-key');
}

Deno.test('get-ai-suggestions saved-session contract', async (t) => {
  resetProvider();

  await t.step('rejects unauthenticated users', async () => {
    const mock = mockSupabase({ profile: 'unauthenticated', userId: null });
    assertEquals((await handler(request(), mock.create)).status, 401);
  });

  await t.step('rejects free users', async () => {
    const mock = mockSupabase({ profile: 'free' });
    assertEquals((await handler(request(), mock.create)).status, 403);
  });

  await t.step('allows active-trial analysis through the server entitlement seam', async () => {
    resetProvider();
    const mock = mockSupabase({
      profile: 'free',
      entitlement: { can_start: true, is_pro: true, trial_active: true },
    });
    assertEquals((await handler(request(), mock.create)).status, 200);
    assertEquals(fetchCount, 1);
  });

  await t.step('fails closed when analysis entitlement is uncertain', async () => {
    resetProvider();
    const mock = mockSupabase({ entitlementError: { message: 'database unavailable' } });
    assertEquals((await handler(request(), mock.create)).status, 503);
    assertEquals(fetchCount, 0);
  });

  await t.step('requires a saved session id and ignores caller evidence', async () => {
    const missing = mockSupabase();
    assertEquals((await handler(request({ transcript: 'forged' }), missing.create)).status, 400);

    resetProvider();
    const mock = mockSupabase();
    const res = await handler(request({ sessionId: 'session-a', transcript: 'FORGED CALLER TRANSCRIPT', metrics: { wpm: 999 } }), mock.create);
    assertEquals(res.status, 200);
    assertStringIncludes(lastPrompt, 'support has no weekend coverage');
    assertEquals(lastPrompt.includes('FORGED CALLER TRANSCRIPT'), false);
    assertEquals(lastPrompt.includes('999'), false);
  });

  await t.step('fails closed for missing or unowned sessions', async () => {
    const mock = mockSupabase({ session: null });
    assertEquals((await handler(request(), mock.create)).status, 404);
    assertEquals(fetchCount, 1, 'previous successful step is the only provider call');
  });

  await t.step('returns valid persisted coaching even after transcript expiry without regeneration', async () => {
    resetProvider();
    const mock = mockSupabase({ session: savedSession({ transcript: null, transcript_state: 'expired', ai_suggestions: suggestionA }) });
    const res = await handler(request(), mock.create);
    assertEquals(res.status, 200);
    assertEquals((await res.json()).suggestions, suggestionA);
    assertEquals(fetchCount, 0);
    assertEquals(mock.state.rpcCount, 0);
  });

  await t.step('keeps cached coaching readable for an expired account without new analysis', async () => {
    resetProvider();
    const mock = mockSupabase({
      profile: 'free',
      session: savedSession({ ai_suggestions: suggestionA }),
    });
    const res = await handler(request(), mock.create);
    assertEquals(res.status, 200);
    assertEquals((await res.json()).suggestions, suggestionA);
    assertEquals(fetchCount, 0);
    assertEquals(mock.state.rpcCount, 0);
  });

  await t.step('does not generate from expired or missing transcript evidence', async () => {
    const mock = mockSupabase({ session: savedSession({ transcript: null, transcript_state: 'expired' }) });
    assertEquals((await handler(request(), mock.create)).status, 409);
    assertEquals(fetchCount, 0);
  });

  await t.step('preserves legitimate zero metrics in the grounded prompt', async () => {
    resetProvider();
    const mock = mockSupabase();
    assertEquals((await handler(request(), mock.create)).status, 200);
    assertStringIncludes(lastPrompt, 'Words Per Minute (WPM): 0');
    assertStringIncludes(lastPrompt, 'Clarity Score: 0%');
    assertStringIncludes(lastPrompt, 'Total Words: 0');
    assertStringIncludes(lastPrompt, 'Duration: 0 seconds');
    assertStringIncludes(lastPrompt, '"count":0');
  });

  await t.step('returns cached strict coaching without quota or provider calls', async () => {
    resetProvider();
    const mock = mockSupabase({ session: savedSession({ ai_suggestions: suggestionA }) });
    const res = await handler(request(), mock.create);
    assertEquals(res.status, 200);
    assertEquals((await res.json()).suggestions, suggestionA);
    assertEquals(fetchCount, 0);
    assertEquals(mock.state.rpcCount, 0);
  });

  await t.step('returns unavailable when provider configuration is missing', async () => {
    Deno.env.delete('GEMINI_API_KEY');
    const mock = mockSupabase();
    assertEquals((await handler(request(), mock.create)).status, 503);
    assertEquals(fetchCount, 0);
  });

  await t.step('rejects malformed, blank, extra-key, and wrong-version provider schemas', async () => {
    const invalid = [
      'not json',
      JSON.stringify({ ...suggestionA, what_worked: '   ' }),
      JSON.stringify({ ...suggestionA, extra: true }),
      JSON.stringify({ ...suggestionA, version: 'legacy' }),
    ];
    for (const value of invalid) {
      resetProvider();
      geminiText = value;
      const mock = mockSupabase();
      assertEquals((await handler(request(), mock.create)).status, 502);
    }
  });

  await t.step('returns unavailable for provider and quota failures', async () => {
    resetProvider();
    fetchStatus = 503;
    assertEquals((await handler(request(), mockSupabase().create)).status, 502);

    resetProvider();
    const exhausted = mockSupabase({ quota: { allowed: false, remaining: 0, limit: 20 } });
    assertEquals((await handler(request(), exhausted.create)).status, 429);

    resetProvider();
    const quotaError = mockSupabase({ quotaError: { message: 'down' } });
    assertEquals((await handler(request(), quotaError.create)).status, 503);
  });

  await t.step('requires exact persistence and readback before success', async () => {
    resetProvider();
    const failed = mockSupabase({ updateError: { message: 'write failed' } });
    assertEquals((await handler(request(), failed.create)).status, 503);

    resetProvider();
    const mismatched = mockSupabase({ readback: suggestionB });
    assertEquals((await handler(request(), mismatched.create)).status, 503);

    resetProvider();
    const saved = mockSupabase();
    const res = await handler(request(), saved.create);
    assertEquals(res.status, 200);
    assertEquals((await res.json()).suggestions, suggestionA);
    assertEquals((saved.state.updated as { ai_suggestions: unknown }).ai_suggestions, suggestionA);
    assertEquals(saved.state.filters, [['id', 'session-a'], ['user_id', 'pro-user']]);
  });

  await t.step('materially different saved sessions produce different grounded coaching', async () => {
    resetProvider();
    adaptiveGemini = true;
    const first = await handler(request({ sessionId: 'session-a' }), mockSupabase().create);
    const firstSuggestions = (await first.json()).suggestions;

    const secondMock = mockSupabase({ session: savedSession({ transcript: 'Our renewal story showed the customer lost twelve hours to manual reconciliation.' }) });
    const second = await handler(request({ sessionId: 'session-b' }), secondMock.create);
    const secondSuggestions = (await second.json()).suggestions;
    assertNotEquals(firstSuggestions, secondSuggestions);
    assertEquals(secondSuggestions, suggestionB);
  });

  await t.step('caps saved transcript length before provider submission', async () => {
    resetProvider();
    const mock = mockSupabase({ session: savedSession({ transcript: `START-${'x'.repeat(9000)}-END` }) });
    assertEquals((await handler(request(), mock.create)).status, 200);
    assertStringIncludes(lastPrompt, '[Transcript truncated for coaching request length.]');
    assertEquals(lastPrompt.includes('-END'), false);
  });

  Deno.env.delete('GEMINI_API_KEY');
});
