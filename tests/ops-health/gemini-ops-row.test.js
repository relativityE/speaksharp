import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateGeminiGeneration, evaluateHighestWorkingGemini } from '../../scripts/lib/gemini-ops-row.mjs';

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

const catalog = (ids) => ids.map((id) => ({ name: 'models/' + id, supportedGenerationMethods: ['generateContent'] }));

describe('Ops Health highest working Gemini', () => {
  it('tests numeric stable ranks, reports HTTP and actual model, and continues after a usable 200', async () => {
    const calls = [];
    const result = await evaluateHighestWorkingGemini(key, { fetchImpl: async (raw, init) => {
      const url = new URL(raw);
      calls.push([url.pathname, init.method, init.headers['x-goog-api-key']]);
      if (init.method === 'GET') return Response.json({ models: catalog([
        'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.6-flash-preview', 'gemini-3.4-flash', 'gemini-3.7-flash', 'gemini-3.10-flash',
      ]) });
      if (url.pathname.includes('3.10-')) return new Response(hidden, { status: 503 });
      if (url.pathname.includes('3.7-')) return response([{ text: ' ' }]);
      if (!url.pathname.includes('3.5-flash-lite')) return new Response(hidden, { status: 504 });
      expect(JSON.parse(init.body).generationConfig.thinkingConfig).toBe(undefined);
      return Response.json({ modelVersion: 'gemini-3.5-flash-lite-001', candidates: [{ content: { parts: [{ text: hidden }] } }] });
    } });
    expect(calls).toEqual([
      ['/v1beta/models', 'GET', key],
      ['/v1beta/models/gemini-3.10-flash:generateContent', 'POST', key],
      ['/v1beta/models/gemini-3.7-flash:generateContent', 'POST', key],
      ['/v1beta/models/gemini-3.6-flash:generateContent', 'POST', key],
      ['/v1beta/models/gemini-3.5-flash:generateContent', 'POST', key],
      ['/v1beta/models/gemini-3.5-flash-lite:generateContent', 'POST', key],
    ]);
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('Gemini: 200 · gemini-3.5-flash-lite-001');
    expect(result.detail).toContain('highest_working=gemini-3.5-flash-lite; provider_model_version=gemini-3.5-flash-lite-001');
    expect(result.detail).toContain('gemini-3.10-flash:503:unavailable_503,gemini-3.7-flash:200:empty,gemini-3.6-flash:504:http_error,gemini-3.5-flash:504:http_error,gemini-3.5-flash-lite:200:generated');
    expect(JSON.stringify(result)).not.toContain(hidden);
    expect(JSON.stringify(result)).not.toContain(key);
  });

  it('still calls lower ranks after a higher pass but keeps the highest usable result', async () => {
    const tried = [];
    const result = await evaluateHighestWorkingGemini(key, { fetchImpl: async (url, init) => {
      if (init.method === 'GET') return Response.json({ models: catalog(['gemini-3.5-flash', 'gemini-3.8-flash']) });
      tried.push(new URL(url).pathname);
      return response([{ text: hidden }]);
    } });
    expect(tried).toHaveLength(2);
    expect(result.detail).toContain('Gemini: 200 · version unreported;');
    expect(result.detail).toContain('highest_working=gemini-3.8-flash');
    expect(result.detail).toContain('gemini-3.8-flash:200:generated,gemini-3.5-flash:200:generated');
  });

  it('caps probes, preserves untested labels, and refuses a partial catalog rather than claiming a highest model', async () => {
    const ids = Array.from({ length: 9 }, (_, i) => `gemini-3.${5 + i}-flash`);
    let posts = 0;
    const result = await evaluateHighestWorkingGemini(key, { fetchImpl: async (_url, init) => {
      if (init.method === 'GET') return Response.json({ models: catalog(ids) });
      posts += 1;
      return new Response(hidden, { status: 504 });
    } });
    expect(posts).toBe(8);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('highest_working=unverified');
    expect(result.detail).toContain('untested_count=1; untested_sample=gemini-3.5-flash');
    const partial = await evaluateHighestWorkingGemini(key, { fetchImpl: async (_url, init) => {
      expect(init.method).toBe('GET');
      return Response.json({ models: catalog(ids), nextPageToken: hidden });
    } });
    expect(partial.status).toBe('fail');
    expect(partial.detail).toContain('catalog_unavailable');
    expect(partial.detail).not.toContain(hidden);
  });
});
