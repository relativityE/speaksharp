import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import coachingContract from '../contract.json' with { type: 'json' };
import { GEMINI_API_URL, geminiProvider, geminiRequestBody } from './gemini.ts';

// Offline only: `fetch` is replaced for each case and restored; no provider is ever called.
type Seen = { url: string; init: RequestInit };
async function withFetch<T>(answer: (seen: Seen) => Response | Promise<Response>, run: (seen: Seen[]) => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  const seen: Seen[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const entry = { url: String(url), init: init ?? {} };
    seen.push(entry);
    return await answer(entry);
  }) as typeof fetch;
  try {
    return await run(seen);
  } finally {
    globalThis.fetch = original;
  }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

function attempt(events: Array<[number, string | null | undefined]>, signal = new AbortController().signal) {
  return geminiProvider.attempt({ prompt: 'PROMPT', apiKey: 'test-key', signal, onResponse: (s, h) => events.push([s, h]) });
}

Deno.test('the Gemini request is byte-identical to the pre-adapter handler request', async () => {
  await withFetch(() => json({ candidates: [], modelVersion: 'gemini-3.8-flash-001' }), async (seen) => {
    const signal = new AbortController().signal;
    await attempt([], signal);
    assertEquals(seen.length, 1);
    assertEquals(seen[0].url, `https://generativelanguage.googleapis.com/v1beta/models/${coachingContract.model}:generateContent?key=test-key`);
    assertEquals(seen[0].url, `${GEMINI_API_URL}?key=test-key`);
    assertEquals(seen[0].init.method, 'POST');
    assertEquals(seen[0].init.headers, { 'Content-Type': 'application/json' });
    assertEquals(seen[0].init.signal, signal);
    // The exact bytes the handler sent before this change: JSON.stringify of contents then the contract's generationConfig.
    assertEquals(seen[0].init.body, JSON.stringify({ contents: [{ parts: [{ text: 'PROMPT' }] }], generationConfig: coachingContract.generationConfig }));
    assertEquals(seen[0].init.body, geminiRequestBody('PROMPT'));
  });
});

Deno.test('a readable answer is normalized: candidate text, a safe model id only, closed answer codes', async () => {
  const body = {
    candidates: [{ content: { parts: [{ text: '{"x":1}' }] }, finishReason: 'STOP' }],
    modelVersion: 'gemini-3.8-flash-001',
    usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7, totalTokenCount: 12 },
  };
  await withFetch(() => json(body), async () => {
    const events: Array<[number, string | null | undefined]> = [];
    const result = await attempt(events);
    assertEquals(events, [[200, undefined]]);
    assertEquals([result.status, result.ok, result.bodyUnreadable, result.errorCodes], [200, true, false, null]);
    assertEquals([result.answer?.text, result.answer?.modelVersion], ['{"x":1}', 'gemini-3.8-flash-001']);
    assertEquals(result.answer?.codes.finish_reason, 'STOP');
  });
  for (const modelVersion of ['has space', 'a'.repeat(129), 42, null, '']) {
    await withFetch(() => json({ ...body, modelVersion }), async () => {
      assertEquals((await attempt([])).answer?.modelVersion, null, String(modelVersion));
    });
  }
  await withFetch(() => json({}), async () => {
    const result = await attempt([]);
    assertEquals([result.answer?.text, result.answer?.modelVersion], [undefined, null]);
  });
});

Deno.test('a failure reports its status and raw Retry-After before the body, and only closed error codes after it', async () => {
  const errorBody = { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota text that must never be read',
    details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'RATE_LIMIT_EXCEEDED' }] } };
  await withFetch(() => json(errorBody, 429, { 'Retry-After': '7' }), async () => {
    const events: Array<[number, string | null | undefined]> = [];
    const result = await attempt(events);
    assertEquals(events, [[429, '7']]);
    assertEquals([result.status, result.ok, result.answer, result.bodyUnreadable], [429, false, null, false]);
    assertEquals(result.errorCodes?.error_status, 'RESOURCE_EXHAUSTED');
    assertEquals(JSON.stringify(result).includes('quota text'), false, 'the error message is never carried');
  });
  await withFetch(() => new Response('not json', { status: 503 }), async () => {
    const events: Array<[number, string | null | undefined]> = [];
    const result = await attempt(events);
    assertEquals(events, [[503, null]], 'an absent header is null for a failure, undefined only for a 2xx answer');
    assertEquals([result.ok, result.errorCodes?.error_status ?? null], [false, null]);
  });
});

Deno.test('a 2xx body that is not JSON is unreadable, with its status already reported', async () => {
  await withFetch(() => new Response('{"truncated', { status: 200 }), async () => {
    const events: Array<[number, string | null | undefined]> = [];
    const result = await attempt(events);
    assertEquals(events, [[200, undefined]]);
    assertEquals([result.ok, result.bodyUnreadable, result.answer, result.errorCodes], [true, true, null, null]);
  });
});

Deno.test('a transport failure is thrown exactly as the transport threw it, before any status', async () => {
  await withFetch(() => { throw new DOMException('timed out', 'TimeoutError'); }, async () => {
    const events: Array<[number, string | null | undefined]> = [];
    const error = await assertRejects(() => attempt(events));
    assertEquals([(error as Error).name, events.length], ['TimeoutError', 0]);
  });
});
