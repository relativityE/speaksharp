// A single synthetic provider-generation probe; separate from the models connectivity check.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { model } = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),
  '../../backend/supabase/functions/get-ai-suggestions/contract.json',
), 'utf8'));
const PROMPT = 'Reply with one word: ready.';
const MAX_RESPONSE_BYTES = 16_384;

async function readPayload(response) {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return JSON.parse(text + decoder.decode());
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) return null;
      text += decoder.decode(chunk.value, { stream: true });
    }
  } catch {
    return null;
  } finally {
    void reader.cancel().catch(() => {});
  }
}

function object(value) { return typeof value === 'object' && value !== null && !Array.isArray(value); }

function generatedTextResult(payload) {
  if (!object(payload) || !Array.isArray(payload.candidates)) return 'malformed';
  if (!payload.candidates.length) return 'empty';
  const content = payload.candidates[0]?.content;
  if (content === undefined) return 'empty';
  if (!object(content) || !Array.isArray(content.parts)) return 'malformed';
  if (content.parts.some((part) => !object(part) || ('text' in part && typeof part.text !== 'string'))) return 'malformed';
  return content.parts.some((part) => part.thought !== true && part.text?.trim()) ? 'generated' : 'empty';
}

export async function evaluateGeminiGeneration(key, { fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  const fixed = (status, detail) => ({ status, detail, drilldownUrl: 'https://aistudio.google.com/' });
  if (typeof key !== 'string' || !key.trim()) return fixed('skip', 'missing=GEMINI_API_KEY');
  if (typeof model !== 'string' || !/^gemini-[a-z0-9.-]+$/.test(model)) return fixed('fail', 'generation=invalid_model_contract');
  let timer;
  const controller = new AbortController();
  const deadlineMs = Number.isFinite(timeoutMs) ? Math.min(10_000, Math.max(1, timeoutMs)) : 10_000;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      resolve(fixed('fail', 'generation=timeout'));
      controller.abort();
    }, deadlineMs);
  });
  const request = (async () => {
    try {
      const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        redirect: 'error',
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: PROMPT }] }],
          generationConfig: { maxOutputTokens: 128, thinkingConfig: { thinkingLevel: 'low' } },
        }),
      });
      if (response.status !== 200) {
        try { void response.body?.cancel().catch(() => {}); } catch { /* metadata is sufficient */ }
        const reason = response.status === 429 ? 'rate_limited_429' : response.status === 503 ? 'unavailable_503' : 'http_error';
        return fixed('fail', `generation=${reason}`);
      }
      const reason = generatedTextResult(await readPayload(response));
      return fixed(reason === 'generated' ? 'pass' : 'fail', `generation=${reason}`);
    } catch {
      return fixed('fail', 'generation=network_error');
    }
  })();
  try { return await Promise.race([request, deadline]); } finally { clearTimeout(timer); }
}
