import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateGeminiGeneration } from '../../scripts/lib/gemini-ops-row.mjs';

const { model } = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),
  '../../backend/supabase/functions/get-ai-suggestions/contract.json',
), 'utf8'));
const key = 'synthetic-key-never-report';
const hidden = 'synthetic-provider-body-never-report';
const response = (parts) => Response.json({ candidates: [{ content: { parts } }] });

describe('Ops Health Gemini generation', () => {
  it('performs exactly one POST on the pinned model and reports generated text without returning it', async () => {
    const calls = [];
    const result = await evaluateGeminiGeneration(key, { fetchImpl: async (...args) => {
      calls.push(args);
      return response([{ text: hidden }]);
    } });
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0];
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`);
    expect(init.method).toBe('POST');
    expect(init.headers['x-goog-api-key']).toBe(key);
    expect(init.redirect).toBe('error');
    expect(JSON.parse(init.body).contents).toEqual([{ parts: [{ text: 'Reply with one word: ready.' }] }]);
    expect(result).toMatchObject({ status: 'pass', detail: 'generation=generated' });
    expect(JSON.stringify(result)).not.toContain(hidden);
    expect(JSON.stringify(result)).not.toContain(key);
  });

  it.each([
    [429, 'rate_limited_429'], [503, 'unavailable_503'], [418, 'http_error'],
  ])('maps HTTP %s to a closed code and makes no retry', async (status, reason) => {
    let calls = 0;
    const result = await evaluateGeminiGeneration(key, { fetchImpl: async () => {
      calls += 1;
      return new Response(hidden, { status });
    } });
    expect(calls).toBe(1);
    expect(result).toMatchObject({ status: 'fail', detail: 'generation=' + reason });
    expect(JSON.stringify(result)).not.toContain(hidden);
    expect(JSON.stringify(result)).not.toContain(key);
  });

  it.each([
    ['blank text', () => response([{ text: '   ' }]), 'empty'],
    ['thought-only', () => response([{ text: hidden, thought: true }]), 'empty'],
    ['malformed JSON', () => new Response(hidden), 'malformed'],
    ['invalid text type', () => response([{ text: 42 }]), 'malformed'],
    ['oversized body', () => new Response('x'.repeat(16_385)), 'malformed'],
  ])('rejects %s on HTTP 200', async (_label, fetchImpl, reason) => {
    const result = await evaluateGeminiGeneration(key, { fetchImpl });
    expect(result).toMatchObject({ status: 'fail', detail: 'generation=' + reason });
    expect(JSON.stringify(result)).not.toContain(hidden);
  });

  it('uses a hard deadline even when a 200 body never produces bytes', async () => {
    let signal;
    const result = await evaluateGeminiGeneration(key, { timeoutMs: 5, fetchImpl: async (_url, init) => {
      signal = init.signal;
      return new Response(new ReadableStream({ start() {} }));
    } });
    expect(signal.aborted).toBe(true);
    expect(result).toMatchObject({ status: 'fail', detail: 'generation=timeout' });
  });

  it('uses only closed codes for a raw fetch error and makes no request without a key', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; throw new Error(hidden + key); };
    expect(await evaluateGeminiGeneration('', { fetchImpl })).toMatchObject({ status: 'skip', detail: 'missing=GEMINI_API_KEY' });
    expect(calls).toBe(0);
    const result = await evaluateGeminiGeneration(key, { fetchImpl });
    expect(result).toMatchObject({ status: 'fail', detail: 'generation=network_error' });
    expect(JSON.stringify(result)).not.toContain(hidden);
    expect(JSON.stringify(result)).not.toContain(key);
  });
});
