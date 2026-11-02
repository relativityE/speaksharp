import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { decodeProviderAnswer, decodeProviderError } from '../providerDecode.ts';
import { geminiProvider } from './gemini.ts';
import { selectProvider } from './registry.ts';
import type { CoachingProvider, ProviderAttemptInput, ProviderAttemptResult } from './types.ts';

/**
 * An OFFLINE alternate adapter (a test double, not a real provider): it answers from a script instead of the network. It exists to
 * prove the interface is replaceable — the same closed input and the same normalized result as the Gemini adapter — with no real
 * provider call. Wiring a second real provider still needs the tracked SQL/frontend follow-on scope.
 */
function scriptedProvider(script: Array<{ status: number; retryAfter?: string | null; body?: unknown; unreadable?: boolean; throws?: string }>) {
  const calls: Array<{ prompt: string; apiKey: string }> = [];
  const provider: CoachingProvider = {
    id: 'offline_double',
    keyVariable: 'OFFLINE_DOUBLE_KEY',
    attempt({ prompt, apiKey, signal, onResponse }: ProviderAttemptInput): Promise<ProviderAttemptResult> {
      calls.push({ prompt, apiKey });
      const step = script[calls.length - 1];
      if (signal.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'));
      if (step.throws) return Promise.reject(new DOMException('transport', step.throws));
      const ok = step.status >= 200 && step.status < 300;
      onResponse(step.status, ok ? undefined : step.retryAfter ?? null);
      if (!ok) return Promise.resolve({ status: step.status, ok, errorCodes: decodeProviderError(JSON.stringify(step.body ?? {})), bodyUnreadable: false, answer: null });
      if (step.unreadable) return Promise.resolve({ status: step.status, ok, errorCodes: null, bodyUnreadable: true, answer: null });
      const body = step.body as { text?: unknown; model?: unknown };
      return Promise.resolve({
        status: step.status, ok, errorCodes: null, bodyUnreadable: false,
        answer: { text: body.text, modelVersion: typeof body.model === 'string' ? body.model : null, codes: decodeProviderAnswer({}) },
      });
    },
  };
  return { provider, calls };
}

const RESULT_KEYS = ['answer', 'bodyUnreadable', 'errorCodes', 'ok', 'status'];

Deno.test('the alternate adapter is selectable through the same registry seam once it is shipped and persistable', () => {
  const { provider } = scriptedProvider([]);
  assertEquals(selectProvider('offline_double', { offline_double: provider }, new Set(['offline_double'])), provider);
  assertEquals(selectProvider('offline_double'), null, 'not shipped in this build: the default registry never selects it');
});

Deno.test('the alternate adapter answers through the identical closed interface, offline', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error('no network: the double must not call fetch'); }) as typeof fetch;
  try {
    const { provider, calls } = scriptedProvider([
      { status: 200, body: { text: '{"version":"gemini_coaching_v1"}', model: 'offline-model-1' } },
      { status: 503, retryAfter: '3', body: { error: { status: 'UNAVAILABLE' } } },
      { status: 200, unreadable: true },
      { status: 0, throws: 'TimeoutError' },
    ]);
    const events: Array<[number, string | null | undefined]> = [];
    const run = () => provider.attempt({ prompt: 'P', apiKey: 'k', signal: new AbortController().signal, onResponse: (s, h) => events.push([s, h]) });
    const answered = await run();
    assertEquals(Object.keys(answered).sort(), RESULT_KEYS);
    assertEquals([answered.ok, answered.answer?.text, answered.answer?.modelVersion], [true, '{"version":"gemini_coaching_v1"}', 'offline-model-1']);
    const failed = await run();
    assertEquals(Object.keys(failed).sort(), RESULT_KEYS);
    assertEquals([failed.ok, failed.status, failed.answer], [false, 503, null]);
    const unreadable = await run();
    assertEquals([unreadable.ok, unreadable.bodyUnreadable], [true, true]);
    let thrown = '';
    try { await run(); } catch (error) { thrown = (error as Error).name; }
    assertEquals(thrown, 'TimeoutError');
    assertEquals(events, [[200, undefined], [503, '3'], [200, undefined]]);
    assertEquals(calls, [{ prompt: 'P', apiKey: 'k' }, { prompt: 'P', apiKey: 'k' }, { prompt: 'P', apiKey: 'k' }, { prompt: 'P', apiKey: 'k' }]);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test('the Gemini adapter and the double expose the same contract surface', () => {
  const { provider } = scriptedProvider([]);
  for (const candidate of [geminiProvider, provider]) {
    assertEquals([typeof candidate.id, typeof candidate.keyVariable, typeof candidate.attempt], ['string', 'string', 'function']);
    assertEquals(/^[A-Z][A-Z0-9_]*$/.test(candidate.keyVariable), true, 'a key variable NAME, never a value');
  }
});
