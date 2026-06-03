/**
 * Unit tests for the format-transcript Edge Function.
 *
 * Strategy: inject an authenticated mock Supabase client and mock global fetch
 * (Gemini), so we exercise validation, the word-preservation server check, error
 * codes, and the no-transcript-logging guarantee without real network/auth.
 */
import { handler } from './index.ts';
import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';

// --- Gemini mock ------------------------------------------------------------
let mockGeminiText = 'Hello world.';
let mockGeminiMode: 'ok' | 'error' | 'timeout' = 'ok';

globalThis.fetch = (async (url: string | URL | Request, _init?: RequestInit) => {
  if (url.toString().includes('generativelanguage.googleapis.com')) {
    if (mockGeminiMode === 'timeout') {
      throw new DOMException('aborted', 'AbortError');
    }
    if (mockGeminiMode === 'error') {
      return new Response('upstream boom', { status: 503 });
    }
    return new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: mockGeminiText }] } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }
  return new Response('Not Found', { status: 404 });
}) as typeof fetch;

// --- Supabase mock (authenticated; no rpc -> quota is skipped) --------------
// deno-lint-ignore no-explicit-any
const authedSupabase: any = () => ({
  auth: {
    getUser: () => Promise.resolve({ data: { user: { id: 'user-123' } }, error: null }),
  },
});

// Authenticated mock whose consume_formatter_quota RPC returns a fixed verdict.
// deno-lint-ignore no-explicit-any
const quotaSupabase = (verdict: { allowed: boolean; remaining?: number }): any => () => ({
  auth: {
    getUser: () => Promise.resolve({ data: { user: { id: 'user-123' } }, error: null }),
  },
  rpc: (_fn: string, _args: unknown) => Promise.resolve({ data: verdict, error: null }),
});

// Authenticated mock whose quota RPC throws (e.g. table missing in a partial deploy).
// deno-lint-ignore no-explicit-any
const quotaThrowsSupabase: any = () => ({
  auth: {
    getUser: () => Promise.resolve({ data: { user: { id: 'user-123' } }, error: null }),
  },
  rpc: (_fn: string, _args: unknown) => Promise.reject(new Error('rpc unavailable')),
});

// --- Request helper ---------------------------------------------------------
function makeRequest(body: unknown, method = 'POST'): Request {
  return new Request('http://localhost/format-transcript', {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
    body: method === 'GET' || method === 'OPTIONS' ? undefined : JSON.stringify(body),
  });
}

Deno.test('format-transcript edge function', async (t) => {
  Deno.env.set('GEMINI_API_KEY', 'test-key');
  mockGeminiMode = 'ok';

  // 1. CORS / OPTIONS preflight
  await t.step('OPTIONS preflight returns CORS headers', async () => {
    const res = await handler(makeRequest(null, 'OPTIONS'), authedSupabase);
    assertEquals(res.status, 200);
    assert(res.headers.get('Access-Control-Allow-Origin'));
    await res.body?.cancel();
  });

  // 2. GET -> METHOD_NOT_ALLOWED
  await t.step('GET returns METHOD_NOT_ALLOWED 405', async () => {
    const res = await handler(makeRequest(null, 'GET'), authedSupabase);
    const json = await res.json();
    assertEquals(res.status, 405);
    assertEquals(json.code, 'METHOD_NOT_ALLOWED');
  });

  // 3. empty transcript
  await t.step('empty transcript -> EMPTY_TRANSCRIPT 400', async () => {
    const res = await handler(makeRequest({ transcript: '   ' }), authedSupabase);
    const json = await res.json();
    assertEquals(res.status, 400);
    assertEquals(json.code, 'EMPTY_TRANSCRIPT');
  });

  // 3b. missing transcript field -> EMPTY_TRANSCRIPT (also the "no transcript" case)
  await t.step('missing transcript field -> EMPTY_TRANSCRIPT 400', async () => {
    const res = await handler(makeRequest({ instruction: 'x' }), authedSupabase);
    const json = await res.json();
    assertEquals(res.status, 400);
    assertEquals(json.code, 'EMPTY_TRANSCRIPT');
  });

  // 4. overlong transcript
  await t.step('overlong transcript -> TRANSCRIPT_TOO_LONG 413', async () => {
    const res = await handler(makeRequest({ transcript: 'a '.repeat(5000) }), authedSupabase);
    const json = await res.json();
    assertEquals(res.status, 413);
    assertEquals(json.code, 'TRANSCRIPT_TOO_LONG');
  });

  // 5. Private guard (hard reject)
  await t.step('engine=private -> PRIVATE_FORMATTER_NOT_ALLOWED 403', async () => {
    const res = await handler(
      makeRequest({ transcript: 'hello world', engine: 'private' }),
      authedSupabase,
    );
    const json = await res.json();
    assertEquals(res.status, 403);
    assertEquals(json.code, 'PRIVATE_FORMATTER_NOT_ALLOWED');
  });

  // 6. missing Gemini key
  await t.step('missing GEMINI_API_KEY -> GEMINI_KEY_MISSING 500', async () => {
    Deno.env.delete('GEMINI_API_KEY');
    const res = await handler(makeRequest({ transcript: 'hello world' }), authedSupabase);
    const json = await res.json();
    assertEquals(res.status, 500);
    assertEquals(json.code, 'GEMINI_KEY_MISSING');
    Deno.env.set('GEMINI_API_KEY', 'test-key');
  });

  // 7. success
  await t.step('success returns formatted + metadata', async () => {
    mockGeminiText = 'Hello world.';
    const res = await handler(makeRequest({ transcript: 'hello world' }), authedSupabase);
    const json = await res.json();
    assertEquals(res.status, 200);
    assertEquals(json.formatted, 'Hello world.');
    assertEquals(json.metadata.provider, 'gemini');
    assertEquals(json.metadata.model, 'gemini-3.5-flash');
    assertEquals(json.metadata.wordPreservingServerCheck, true);
    assertEquals(json.metadata.inputChars, 11);
    assert(typeof json.metadata.latencyMs === 'number');
    assert(typeof json.metadata.formatterVersion === 'string');
  });

  // 8. empty model output
  await t.step('empty model output -> FORMATTER_EMPTY_OUTPUT 502', async () => {
    mockGeminiText = '   ';
    const res = await handler(makeRequest({ transcript: 'hello world' }), authedSupabase);
    const json = await res.json();
    assertEquals(res.status, 502);
    assertEquals(json.code, 'FORMATTER_EMPTY_OUTPUT');
  });

  // 9. provider error
  await t.step('provider non-2xx -> FORMATTER_PROVIDER_ERROR 502', async () => {
    mockGeminiMode = 'error';
    const res = await handler(makeRequest({ transcript: 'hello world' }), authedSupabase);
    const json = await res.json();
    assertEquals(res.status, 502);
    assertEquals(json.code, 'FORMATTER_PROVIDER_ERROR');
    mockGeminiMode = 'ok';
  });

  // 10. word-change fail (recognition correction)
  await t.step('word change -> FORMATTER_WORDS_CHANGED 422', async () => {
    mockGeminiText = 'Plain plan.'; // input "plane plan"
    const res = await handler(makeRequest({ transcript: 'plane plan' }), authedSupabase);
    const json = await res.json();
    assertEquals(res.status, 422);
    assertEquals(json.code, 'FORMATTER_WORDS_CHANGED');
    assertEquals(json.metadata.wordPreservingServerCheck, false);
  });

  // 11. punctuation-only pass
  await t.step('punctuation/casing-only -> 200', async () => {
    mockGeminiText = 'Hello world. How are you?';
    const res = await handler(makeRequest({ transcript: 'hello world how are you' }), authedSupabase);
    const json = await res.json();
    assertEquals(res.status, 200);
    assertEquals(json.formatted, 'Hello world. How are you?');
  });

  // 12. filler-preserving pass
  await t.step('filler words preserved -> 200', async () => {
    mockGeminiText = 'Um, I think, uh, we should go.';
    const res = await handler(
      makeRequest({ transcript: 'um i think uh we should go' }),
      authedSupabase,
    );
    const json = await res.json();
    assertEquals(res.status, 200);
    assertEquals(json.metadata.wordPreservingServerCheck, true);
  });

  // 13. drop-um fail
  await t.step('dropping a filler -> FORMATTER_WORDS_CHANGED 422', async () => {
    mockGeminiText = 'I think we should go.'; // dropped "um"
    const res = await handler(
      makeRequest({ transcript: 'um i think we should go' }),
      authedSupabase,
    );
    const json = await res.json();
    assertEquals(res.status, 422);
    assertEquals(json.code, 'FORMATTER_WORDS_CHANGED');
  });

  // 14. add/reorder fail
  await t.step('reordering words -> FORMATTER_WORDS_CHANGED 422', async () => {
    mockGeminiText = 'We should go, I think.'; // reordered
    const res = await handler(
      makeRequest({ transcript: 'i think we should go' }),
      authedSupabase,
    );
    const json = await res.json();
    assertEquals(res.status, 422);
    assertEquals(json.code, 'FORMATTER_WORDS_CHANGED');
  });

  // 15. NO transcript text in logs
  await t.step('no transcript text appears in logs', async () => {
    const SENTINEL = 'zzqsecretword';
    const captured: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...a: unknown[]) => captured.push(a.map(String).join(' '));
    console.error = (...a: unknown[]) => captured.push(a.map(String).join(' '));
    try {
      mockGeminiMode = 'ok';
      mockGeminiText = `Hello ${SENTINEL}.`; // success path
      await handler(makeRequest({ transcript: `hello ${SENTINEL}` }), authedSupabase).then((r) => r.json());
      mockGeminiText = `Hello ${SENTINEL} extra.`; // word-change path (logs WORDS_CHANGED)
      await handler(makeRequest({ transcript: `hello ${SENTINEL}` }), authedSupabase).then((r) => r.json());
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
    const blob = captured.join('\n');
    assert(blob.length > 0, 'expected some structured logs to be captured');
    assert(!blob.includes(SENTINEL), `transcript text leaked into logs:\n${blob}`);
  });

  // 16. quota enforced: RPC says not allowed -> 429 QUOTA_EXCEEDED (no Gemini call)
  await t.step('quota exceeded -> QUOTA_EXCEEDED 429', async () => {
    mockGeminiMode = 'ok';
    const res = await handler(
      makeRequest({ transcript: 'hello world' }),
      quotaSupabase({ allowed: false }),
    );
    const json = await res.json();
    assertEquals(res.status, 429);
    assertEquals(json.code, 'QUOTA_EXCEEDED');
  });

  // 17. quota allowed -> proceeds to format (200)
  await t.step('quota allowed -> 200 success', async () => {
    mockGeminiText = 'Hello world.';
    const res = await handler(
      makeRequest({ transcript: 'hello world' }),
      quotaSupabase({ allowed: true, remaining: 199 }),
    );
    const json = await res.json();
    assertEquals(res.status, 200);
    assertEquals(json.formatted, 'Hello world.');
  });

  // 18. quota RPC failure degrades OPEN (a quota infra hiccup must not block formatting)
  await t.step('quota RPC throws -> degrade open (200)', async () => {
    mockGeminiText = 'Hello world.';
    const res = await handler(makeRequest({ transcript: 'hello world' }), quotaThrowsSupabase);
    const json = await res.json();
    assertEquals(res.status, 200);
    assertEquals(json.formatted, 'Hello world.');
  });

  // cleanup
  mockGeminiMode = 'ok';
  mockGeminiText = 'Hello world.';
});
