import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  decodeProviderAnswer, decodeProviderError, PROVIDER_ERROR_BODY_MAX_BYTES, readBoundedBody,
} from './providerDecode.ts';

/** A provider message that echoes the request: it must never survive decoding. */
const ECHO = 'my secret transcript words';

Deno.test('#1258 decodeProviderError — closed codes in, free text out', async (t) => {
  await t.step('a Gemini rate limit decodes to RESOURCE_EXHAUSTED + its ErrorInfo reason', () => {
    const body = JSON.stringify({
      error: {
        code: 429, message: `Quota exceeded for ${ECHO}`, status: 'RESOURCE_EXHAUSTED',
        details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'RATE_LIMIT_EXCEEDED', domain: 'googleapis.com' }],
      },
    });
    const codes = decodeProviderError(body);
    assertEquals(codes, { error_status: 'RESOURCE_EXHAUSTED', error_reason: 'RATE_LIMIT_EXCEEDED' });
    assertEquals(JSON.stringify(codes).includes(ECHO), false);
  });

  await t.step('the other canonical failures decode by name', () => {
    for (const status of ['INVALID_ARGUMENT', 'PERMISSION_DENIED', 'UNAVAILABLE', 'DEADLINE_EXCEEDED', 'INTERNAL', 'UNAUTHENTICATED'] as const) {
      assertEquals(decodeProviderError(JSON.stringify({ error: { status, message: ECHO } })), { error_status: status, error_reason: null });
    }
  });

  await t.step('an unknown status or a non-token reason becomes `other`, never the raw value', () => {
    const codes = decodeProviderError(JSON.stringify({
      error: { status: ECHO, details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: ECHO }] },
    }));
    assertEquals(codes, { error_status: 'other', error_reason: 'other' });
  });

  await t.step('PM RETURN 6134462030: an UPPER_SNAKE reason outside the documented list is `other`, never echoed', () => {
    const codes = decodeProviderError(JSON.stringify({ error: {
      status: 'INVALID_ARGUMENT',
      details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SECRET_TRANSCRIPT_WORDS' }],
    } }));
    assertEquals(codes, { error_status: 'INVALID_ARGUMENT', error_reason: 'other' });
    assertEquals(JSON.stringify(codes).includes('SECRET_TRANSCRIPT_WORDS'), false);
  });

  await t.step('a non-JSON or non-Gemini body is `unparseable`', () => {
    assertEquals(decodeProviderError('upstream unavailable'), { error_status: 'unparseable', error_reason: null });
    assertEquals(decodeProviderError(JSON.stringify({ message: ECHO })), { error_status: 'unparseable', error_reason: null });
    assertEquals(decodeProviderError(null), { error_status: 'unparseable', error_reason: null });
  });
});

Deno.test('#1258 decodeProviderAnswer — finish/block reasons and token counts only', async (t) => {
  await t.step('a normal answer reports STOP and every token count, including thinking tokens', () => {
    assertEquals(decodeProviderAnswer({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: ECHO }] } }],
      usageMetadata: { promptTokenCount: 812, candidatesTokenCount: 46, thoughtsTokenCount: 1903, totalTokenCount: 2761 },
    }), {
      finish_reason: 'STOP', block_reason: null,
      prompt_tokens: 812, output_tokens: 46, thinking_tokens: 1903, total_tokens: 2761,
    });
  });

  await t.step('a blocked or truncated answer names why', () => {
    const blocked = decodeProviderAnswer({ promptFeedback: { blockReason: 'SAFETY' } });
    assertEquals([blocked.finish_reason, blocked.block_reason], [null, 'SAFETY']);
    assertEquals(decodeProviderAnswer({ candidates: [{ finishReason: 'MAX_TOKENS' }] }).finish_reason, 'MAX_TOKENS');
    assertEquals(decodeProviderAnswer({ candidates: [{ finishReason: ECHO }] }).finish_reason, 'other');
  });

  await t.step('non-integer or negative counts are dropped, not coerced', () => {
    const codes = decodeProviderAnswer({ usageMetadata: { promptTokenCount: -1, candidatesTokenCount: 1.5, thoughtsTokenCount: '9' } });
    assertEquals([codes.prompt_tokens, codes.output_tokens, codes.thinking_tokens], [null, null, null]);
  });
});

Deno.test('#1258 readBoundedBody — an oversized body is not buffered', async () => {
  assertEquals(await readBoundedBody(new Response('{"error":{"status":"INTERNAL"}}')), '{"error":{"status":"INTERNAL"}}');
  assertEquals(await readBoundedBody(new Response('x'.repeat(PROVIDER_ERROR_BODY_MAX_BYTES + 1))), null);
  assertEquals(await readBoundedBody(new Response(null)), null);
});

// #1258 (Codex P2 r4289041570, PM 6204153627): the error-body read is diagnostic, so it must never extend the failure path.
// One independent deadline bounds the WHOLE read (not each chunk); a stalled or trickling body, or a cancel() that never
// settles, returns null by that deadline. Timing is asserted structurally (the read settles before a guard that is far
// longer than the deadline), never against a tight wall-clock threshold.
Deno.test('#1258 readBoundedBody — one bounded deadline for the whole read', async (t) => {
  const GUARD_MS = 2_000;
  const settlesBeforeGuard = async (read: Promise<string | null>): Promise<string | null | 'HUNG'> => {
    let guard: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([read, new Promise<'HUNG'>((resolve) => { guard = setTimeout(() => resolve('HUNG'), GUARD_MS); })]);
    } finally {
      clearTimeout(guard);
    }
  };
  const stalledBody = (cancel?: () => Promise<void>) => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"error":')); },
    ...(cancel ? { cancel } : {}),
  }), { status: 503 });

  await t.step('a normal short body still decodes within the deadline', async () => {
    assertEquals(await settlesBeforeGuard(readBoundedBody(new Response('{"error":{"status":"UNAVAILABLE"}}'), 20)),
      '{"error":{"status":"UNAVAILABLE"}}');
  });

  await t.step('a stalled body returns null by the deadline instead of holding the retry', async () => {
    assertEquals(await settlesBeforeGuard(readBoundedBody(stalledBody(), 20)), null);
  });

  await t.step('a trickling body cannot extend the TOTAL deadline (not reset per chunk)', async () => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const trickle = new Response(new ReadableStream<Uint8Array>({
      start(controller) { timer = setInterval(() => controller.enqueue(new TextEncoder().encode(' ')), 5); },
      cancel() { clearInterval(timer); },
    }), { status: 503 });
    try {
      assertEquals(await settlesBeforeGuard(readBoundedBody(trickle, 30)), null);
    } finally {
      clearInterval(timer);
    }
  });

  await t.step('a cancel() that never settles cannot hold the return', async () => {
    assertEquals(await settlesBeforeGuard(readBoundedBody(stalledBody(() => new Promise<void>(() => undefined)), 20)), null);
  });
});
