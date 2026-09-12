import {
  handler,
  GEMINI_API_URL,
  GEMINI_GENERATION_CONFIG,
  COACHING_WORD_BUDGET,
  countWords,
  AI_SUGGESTION_DAILY_LIMIT,
  buildCoachingPrompt,
} from './index.ts';
import coachingContract from './contract.json' with { type: 'json' };
import { assertEquals, assertNotEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';

const suggestionA = {
  version: 'gemini_coaching_v1',
  what_worked: 'Risk-first opening clarified the launch decision.',
  what_to_try_next: 'Move the support bottleneck later.',
} as const;
const suggestionB = {
  version: 'gemini_coaching_v1',
  what_worked: 'Customer story made renewal risk concrete.',
  what_to_try_next: 'End with a dated owner commitment.',
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
let lastRequestBody: Record<string, unknown> = {};
let lastRequestUrl = '';

globalThis.fetch = async (url, init) => {
  if (!url.toString().includes('generativelanguage.googleapis.com')) {
    return new Response('Not Found', { status: 404 });
  }
  fetchCount++;
  lastRequestUrl = url.toString();
  const body = JSON.parse(String((init as { body?: BodyInit | null } | undefined)?.body ?? '{}'));
  lastPrompt = String(body?.contents?.[0]?.parts?.[0]?.text ?? '');
  lastRequestBody = body as Record<string, unknown>;
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
    quotaArgs: null as Record<string, unknown> | null,
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
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (name === 'check_usage_limit') {
        return Promise.resolve({
          data: options.entitlement ?? (profile === 'free'
            ? { can_start: false, is_pro: false, error: 'trial_expired' }
            : { can_start: true, is_pro: true }),
          error: options.entitlementError ?? null,
        });
      }
      state.rpcCount++;
      if (name === 'consume_ai_suggestion_quota') state.quotaArgs = args ?? {};
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

  await t.step('#1416 the model endpoint is not a preview channel', () => {
    // The reason for the change, pinned. `gemini-3-flash-preview` is a preview endpoint, and preview
    // shutdowns have run 14 days from announcement — the URL can stop resolving inside a sprint, and
    // the failure would look like a provider outage rather than a deprecation we were told about.
    // Asserted on the exported constant rather than by reading the file: the edge suite runs without
    // `--allow-read`, and widening the sandbox for every edge test to satisfy one assertion trades a
    // real safety property for a convenience.
    assertStringIncludes(GEMINI_API_URL, 'gemini-3.6-flash');
    assertEquals(GEMINI_API_URL.includes('-preview'), false);
  });

  await t.step('#1416 a SHAPE SHIFT from the new model is an error, never an empty review', async () => {
    // The prompt was tuned against the preview model, so the risk of swapping models is that the
    // response shape moves, not that quality drops. Each of these is a shape a different model
    // plausibly returns, and every one must reach the user as a failure rather than as a review with
    // nothing in it — an empty review reads as "the product looked at your session and had nothing to
    // say", which is a false statement about their speaking.
    const shifts = [
      // Markdown-fenced JSON — the single most common cross-model difference.
      '```json\n' + JSON.stringify(suggestionA) + '\n```',
      // Renamed to the labels the UI now shows.
      JSON.stringify({ version: 'gemini_coaching_v1', what_went_well: 'a', what_to_improve: 'b' }),
      // Wrapped in an envelope.
      JSON.stringify({ suggestions: suggestionA }),
      // Arrays instead of strings — a 1+1 contract returned as a list.
      JSON.stringify({ version: 'gemini_coaching_v1', what_worked: ['a'], what_to_try_next: ['b'] }),
      // Prose preamble before the JSON.
      'Here is your coaching:\n' + JSON.stringify(suggestionA),
    ];
    for (const value of shifts) {
      resetProvider();
      geminiText = value;
      const mock = mockSupabase();
      const response = await handler(request(), mock.create);
      assertEquals(response.status, 502);
      // And nothing partially-formed leaks through as if it were a review.
      const body = await response.text();
      assertEquals(body.includes('what_worked'), false);
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

  // #1424 (Codex finding): the JSON contract must be REQUESTED of the provider, not merely hoped for in prose.
  // Without this the model is free to fence its answer or add a key, and every such answer is a 502 for every
  // user. A single executed call that happened to comply is evidence about that call, not about the next one.
  // #1424 A2. The two-phrase format was specified by the product and requested by nothing: the prompt's only
  // length instruction was "concise enough to display in the app", the model returned 22-36 words per field,
  // and nothing truncated it in the UI. These steps hold the budget at each layer it can be broken.
  await t.step('the fixtures this suite trusts are themselves within the coaching budget', () => {
    // A suite whose own happy-path fixtures break the contract proves the contract is not enforced.
    for (const s of [suggestionA, suggestionB]) {
      assertEquals(countWords(s.what_worked) <= COACHING_WORD_BUDGET.what_worked, true, `what_worked over budget: ${s.what_worked}`);
      assertEquals(countWords(s.what_to_try_next) <= COACHING_WORD_BUDGET.what_to_try_next, true, `what_to_try_next over budget: ${s.what_to_try_next}`);
    }
  });

  await t.step('spends the daily quota the product actually configures', async () => {
    resetProvider();
    const mock = mockSupabase({ session: savedSession() });
    await handler(request(), mock.create);
    // Read the limit the handler SENDS, not a restated number: the cap only means something if the value
    // reaching consume_ai_suggestion_quota is the configured one.
    assertEquals(mock.state.quotaArgs?.p_limit, AI_SUGGESTION_DAILY_LIMIT);
    assertEquals(AI_SUGGESTION_DAILY_LIMIT, 10);
  });

  await t.step('the request past the daily cap is refused 429, and spends no provider call', async () => {
    resetProvider();
    // The server-side RPC is the authority; this is the shape it returns once the configured cap is spent.
    const mock = mockSupabase({
      session: savedSession(),
      quota: { allowed: false, remaining: 0, limit: AI_SUGGESTION_DAILY_LIMIT },
    });
    const response = await handler(request(), mock.create);
    assertEquals(response.status, 429);
    // The cap is worthless if it refuses the user but still spends the call.
    assertEquals(fetchCount, 0);
    const body = JSON.parse(await response.text());
    assertEquals(body.limit, AI_SUGGESTION_DAILY_LIMIT);
  });

  await t.step('coaching a user ALREADY received stays readable after the budget lands', async () => {
    // Codex P1. Every review generated before today is 22-36 words - exactly what the old prompt produced.
    // Enforcing the budget on stored rows would not merely hide them: it would spend quota regenerating
    // coaching that was already fine, and 409/403 the users who cannot regenerate. A rule introduced today
    // must not retroactively invalidate what the product said yesterday.
    resetProvider();
    const preBudget = {
      version: 'gemini_coaching_v1',
      what_worked: 'You clearly identified the problem and proposed a direct solution in under twenty seconds',
      what_to_try_next: 'Replace tentative phrasing and filler words with a strong dated commitment your audience can act on',
    };
    assertEquals(countWords(preBudget.what_worked) > COACHING_WORD_BUDGET.what_worked, true, 'fixture must be over budget');

    const mock = mockSupabase({ session: savedSession({ ai_suggestions: preBudget }) });
    const response = await handler(request(), mock.create);
    assertEquals(response.status, 200);
    // Served from cache, so no provider call and no quota spent.
    assertEquals(fetchCount, 0);
    assertEquals(mock.state.rpcCount, 0);
    const body = JSON.parse(await response.text());
    assertEquals(body.suggestions.what_worked, preBudget.what_worked);
  });

  await t.step('the budget boundary is exact: at the limit passes, one word over is refused', async () => {
    const atLimit = 'One two three four five six';          // exactly 6
    const overBy1 = 'One two three four five six seven';    // exactly 7
    assertEquals(countWords(atLimit), COACHING_WORD_BUDGET.what_worked);
    assertEquals(countWords(overBy1), COACHING_WORD_BUDGET.what_worked + 1);

    resetProvider();
    geminiText = JSON.stringify({ version: 'gemini_coaching_v1', what_worked: atLimit, what_to_try_next: atLimit });
    assertEquals((await handler(request(), mockSupabase({ session: savedSession() }).create)).status, 200);

    // One word over on EITHER field is refused. A budget that only rejects egregious overruns is a
    // suggestion, and the whole point of moving this out of the prompt was to stop suggesting.
    for (const field of ['what_worked', 'what_to_try_next']) {
      resetProvider();
      geminiText = JSON.stringify({
        version: 'gemini_coaching_v1',
        what_worked: field === 'what_worked' ? overBy1 : atLimit,
        what_to_try_next: field === 'what_to_try_next' ? overBy1 : atLimit,
      });
      assertEquals((await handler(request(), mockSupabase({ session: savedSession() }).create)).status, 502, `${field} one over must refuse`);
    }
  });

  // Each field is broken ALONE. An over-budget fixture that breaks both at once passes even when one of the
  // two checks is deleted, which is precisely what my first version of this casualty did.
  await t.step('REFUSES an over-budget what_worked, with what_to_try_next left legal', async () => {
    resetProvider();
    geminiText = JSON.stringify({
      version: 'gemini_coaching_v1',
      what_worked: 'You clearly identified the problem and proposed a direct solution in twenty seconds',
      what_to_try_next: 'End with a dated owner commitment.',
    });
    const mock = mockSupabase({ session: savedSession() });
    assertEquals((await handler(request(), mock.create)).status, 502);
  });

  await t.step('REFUSES an over-budget what_to_try_next, with what_worked left legal', async () => {
    resetProvider();
    geminiText = JSON.stringify({
      version: 'gemini_coaching_v1',
      what_worked: 'Risk-first opening clarified the launch decision.',
      what_to_try_next: 'Replace tentative phrasing and filler words with a strong dated commitment your audience can act on',
    });
    const mock = mockSupabase({ session: savedSession() });
    assertEquals((await handler(request(), mock.create)).status, 502);
  });

  await t.step('REFUSES an over-budget answer rather than truncating it into something never said', async () => {
    resetProvider();
    geminiText = JSON.stringify({
      version: 'gemini_coaching_v1',
      // Exactly the shape 3.6 actually returned before the budget existed: valid JSON, right keys, far too long.
      what_worked: 'You clearly identified the problem and proposed a direct solution in under twenty seconds',
      what_to_try_next: 'Replace tentative phrasing and filler words with a strong dated commitment your audience can act on',
    });
    const mock = mockSupabase({ session: savedSession() });
    const response = await handler(request(), mock.create);
    assertEquals(response.status, 502);
    // And no partial coaching leaks into the error body.
    const body = await response.text();
    assertEquals(body.includes('what_worked'), false);
    assertEquals(body.includes('tentative phrasing'), false);
  });

  await t.step('the prompt ASKS for the budget it will enforce', async () => {
    resetProvider();
    const mock = mockSupabase({ session: savedSession() });
    await handler(request(), mock.create);
    // Asking and enforcing must not drift: a parser stricter than the prompt is a 502 we cause ourselves.
    assertStringIncludes(lastPrompt, `AT MOST ${COACHING_WORD_BUDGET.what_worked} words`);
    assertStringIncludes(lastPrompt, `AT MOST ${COACHING_WORD_BUDGET.what_to_try_next} words`);
  });

  /*
   * #1424 — THE REQUEST PRODUCTION ACTUALLY SENDS **IS** THE PINNED CONTRACT.
   *
   * This replaces a static AST test that tried to prove the same thing by reading the source. Codex
   * defeated seven versions of that idea across two PRs — decoy declarations, a `fetch` inside a
   * template literal, a spread-merged config, unused aliases, a helper-local shadow, a reassigned
   * binding, a dynamically built host, and a conditional return. Every one of those is a way for source
   * to LOOK bound while the request diverges.
   *
   * Observation ends the whole class. The handler runs, the fetch stub captures what actually went to
   * the provider, and the captured request is compared against `contract.json` itself. It does not
   * matter how the URL, the config or the prompt were constructed — shadowed, reassigned, assembled at
   * runtime, or chosen in a branch — because what is asserted is what was sent.
   */
  await t.step('#1424 CASUALTY: the request that reaches the provider IS the contract', async () => {
    resetProvider();
    const mock = mockSupabase({ session: savedSession() });
    assertEquals((await handler(request(), mock.create)).status, 200);

    // Exactly one provider call per completed request. A second call — however its URL is built — lands
    // in this same stub and breaks this count, which the source-reading version could not guarantee.
    assertEquals(fetchCount, 1, 'exactly one provider request per handler call');

    // The destination carries the contract's model, taken from the URL that was actually requested.
    assertStringIncludes(lastRequestUrl, `models/${coachingContract.model}:generateContent`);
    assertEquals(lastRequestUrl.includes('-preview'), false, 'no preview endpoint may be requested');

    // The generation config SENT equals the contract's, exactly. A merge or an override fails here.
    assertEquals(lastRequestBody.generationConfig, coachingContract.generationConfig);

    // The prompt SENT was produced from the contract's template: every literal segment of the template,
    // in order, appears in what was sent. A hardcoded or branch-selected prompt cannot satisfy this.
    for (const segment of coachingContract.promptTemplate.split(/\{\{(?:TRANSCRIPT|METRICS)\}\}/)) {
      const literal = segment.trim();
      if (literal.length > 0) assertStringIncludes(lastPrompt, literal);
    }

    // And the two enforcement values production applies are the contract's, not copies that can drift.
    assertEquals(COACHING_WORD_BUDGET, coachingContract.wordBudget);
    assertEquals(AI_SUGGESTION_DAILY_LIMIT, coachingContract.uncachedGenerationCapPerUtcDay);
    assertStringIncludes(GEMINI_API_URL, coachingContract.model);
  });

  await t.step('asks the provider for the JSON contract it will be judged against', async () => {
    resetProvider();
    const mock = mockSupabase({ session: savedSession() });
    assertEquals((await handler(request(), mock.create)).status, 200);

    const config = (lastRequestBody as { generationConfig?: Record<string, unknown> }).generationConfig;
    assertEquals(config !== undefined, true, 'the request must carry a generationConfig');
    assertEquals((config as { responseMimeType?: string }).responseMimeType, 'application/json');

    // The schema and parseSuggestions must demand the same keys. If they diverge, we ask the model for one
    // contract and then reject its obedient answer against another — a 502 we cause ourselves.
    const schema = (config as { responseSchema?: { properties?: Record<string, unknown>; required?: string[] } }).responseSchema;
    const schemaKeys = Object.keys(schema?.properties ?? {}).sort();
    assertEquals(schemaKeys, ['version', 'what_to_try_next', 'what_worked']);
    // Key sets agreeing is not enough (Codex finding). A bare STRING `version` lets the model return any
    // version the schema calls valid and parseSuggestions then rejects — a 502 we asked for ourselves. The
    // values the schema PERMITS must be the values the parser ACCEPTS.
    assertEquals((schema?.properties?.version as { enum?: string[] } | undefined)?.enum, ['gemini_coaching_v1']);

    // The schema also has to carry a length ceiling for the two coaching fields. It cannot express "at most
    // six words", so the exact rule lives in the parser - but a schema with no bound at all leaves the model
    // free to write an essay that the parser then refuses, which is a 502 the provider could have prevented.
    // The ceiling must be GENEROUS enough that a legal in-budget phrase is never rejected upstream.
    for (const [field, budget] of Object.entries(COACHING_WORD_BUDGET)) {
      const fieldSchema = schema?.properties?.[field] as {
        minLength?: number;
        maxLength?: number;
        pattern?: string;
      } | undefined;
      const max = fieldSchema?.maxLength;
      assertEquals(typeof max, 'number', `${field} must declare a maxLength ceiling`);
      // A word averages well under 15 characters; anything tighter could refuse a valid in-budget phrase.
      assertEquals((max as number) >= budget * 15, true, `${field} ceiling ${max} is tighter than its ${budget}-word budget`);
      // The provider schema must reject the same blank/whitespace-only values the production parser rejects.
      // Gemini's Schema supports both fields; this closes the provider/parser mismatch without pretending the
      // schema can count words (the parser remains authoritative for that rule).
      assertEquals(fieldSchema?.minLength, 1, `${field} must reject an empty string upstream`);
      assertEquals(fieldSchema?.pattern, '.*\\S.*', `${field} must reject whitespace-only strings upstream`);
    }
    assertEquals((schema?.required ?? []).slice().sort(), ['version', 'what_to_try_next', 'what_worked']);
    // And the exported constant is the one actually sent, not a second copy that can drift from it.
    assertEquals(config, GEMINI_GENERATION_CONFIG);
  });

  await t.step('the data contract builds the exact prompt without executing source-text substitutions', () => {
    const transcript = 'A literal {{METRICS}} in user speech stays transcript text.';
    const metrics = 'Metrics:\n- Total Words: 9';
    const built = buildCoachingPrompt(transcript, metrics);
    assertStringIncludes(built, `"${transcript}"`);
    assertStringIncludes(built, metrics);
    assertEquals(built.includes('{{TRANSCRIPT}}'), false);
    // One pass over the template means placeholder-looking caller content is inserted as inert data and
    // cannot consume or move the separate metrics substitution.
    assertEquals(built.match(/Metrics:/g)?.length, 1);
  });

  await t.step('the prompt exemplar obeys the same six-word contract it asks Gemini to follow', () => {
    const built = buildCoachingPrompt('fabricated transcript', 'fabricated metrics');
    const exemplarMatch = /\{\s*"version": "gemini_coaching_v1",\s*"what_worked": "([^"]+)",\s*"what_to_try_next": "([^"]+)"\s*\}/.exec(built);
    assertEquals(exemplarMatch !== null, true, 'the exact two-field response exemplar must remain present');
    const [, whatWorked, whatToTryNext] = exemplarMatch!;
    assertEquals(countWords(whatWorked) <= COACHING_WORD_BUDGET.what_worked, true);
    assertEquals(countWords(whatToTryNext) <= COACHING_WORD_BUDGET.what_to_try_next, true);
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
