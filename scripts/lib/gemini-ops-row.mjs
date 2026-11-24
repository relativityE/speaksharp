// A single synthetic provider-generation probe; separate from the models connectivity check.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { model } = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),
  '../../backend/supabase/functions/get-ai-suggestions/contract.json',
), 'utf8'));
const PROMPT = 'Reply with one word: ready.';
const MAX_RESPONSE_BYTES = 16_384;
const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const DRILLDOWN = 'https://aistudio.google.com/';
const SAFE_VERSION = /^gemini-[a-z0-9][a-z0-9.-]{0,58}$/;
const CATALOG_MODEL = /^gemini-(\d{1,3})\.(\d{1,3})-flash(-lite)?(?:-(\d{3}))?$/;
const MAX_CATALOG_PAGES = 4;
const MAX_PROBES = 8;

async function readPayload(response, limit = MAX_RESPONSE_BYTES) {
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
      if (size > limit) return null;
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

async function withDeadline(ms, fallback, work) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => { resolve(typeof fallback === 'function' ? fallback() : fallback); controller.abort(); }, ms);
  });
  try { return await Promise.race([work(controller.signal), deadline]); }
  finally { clearTimeout(timer); }
}

function cancelBody(response) {
  try { void response.body?.cancel().catch(() => {}); } catch { /* metadata is sufficient */ }
}

async function probeGeneration(key, modelId, fetchImpl, deadlineMs) {
  const record = (reason, httpStatus = null, modelVersion = null) => ({ modelId, httpStatus, reason, modelVersion });
  let seenStatus = null;
  return withDeadline(deadlineMs, () => record('timeout', seenStatus), async (signal) => {
    try {
      const response = await fetchImpl(`${API}/${modelId}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        redirect: 'error',
        signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: PROMPT }] }],
          generationConfig: { maxOutputTokens: 128, ...(modelId.includes('-flash-lite') ? {} : { thinkingConfig: { thinkingLevel: 'low' } }) },
        }),
      });
      const status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : null;
      seenStatus = status;
      if (status !== 200) {
        cancelBody(response);
        return record(status === 429 ? 'rate_limited_429' : status === 503 ? 'unavailable_503' : 'http_error', status);
      }
      const payload = await readPayload(response);
      const reason = generatedTextResult(payload);
      const version = typeof payload?.modelVersion === 'string' && SAFE_VERSION.test(payload.modelVersion) ? payload.modelVersion : null;
      return record(reason, status, reason === 'generated' ? version : null);
    } catch {
      return record('network_error');
    }
  });
}

function fixed(status, detail) { return { status, detail, drilldownUrl: DRILLDOWN }; }
function keyPresent(key) { return typeof key === 'string' && Boolean(key.trim()); }

export async function evaluateGeminiGeneration(key, { fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  if (!keyPresent(key)) return fixed('skip', 'missing=GEMINI_API_KEY');
  if (typeof model !== 'string' || !SAFE_VERSION.test(model)) return fixed('fail', 'generation=invalid_model_contract');
  const deadlineMs = Number.isFinite(timeoutMs) ? Math.min(10_000, Math.max(1, timeoutMs)) : 10_000;
  const { reason } = await probeGeneration(key, model, fetchImpl, deadlineMs);
  return fixed(reason === 'generated' ? 'pass' : 'fail', `generation=${reason}`);
}

function rankedModels(entries) {
  const ids = new Map();
  for (const entry of entries) {
    const id = typeof entry?.name === 'string' && entry.name.startsWith('models/') ? entry.name.slice(7) : '';
    const match = CATALOG_MODEL.exec(id);
    if (!match || !Array.isArray(entry.supportedGenerationMethods)
        || !entry.supportedGenerationMethods.includes('generateContent') || (!match[3] && entry.thinking === false)) continue;
    const [, maj, min, lite, rev = '0'] = match;
    if (Number(maj) < 3 || (Number(maj) === 3 && Number(min) < 5)) continue;
    ids.set(id, [Number(maj), Number(min), lite ? 0 : 1, Number(rev)]);
  }
  return [...ids.keys()].sort((a, b) => {
    const aa = ids.get(a), bb = ids.get(b);
    return bb[0] - aa[0] || bb[1] - aa[1] || bb[2] - aa[2] || bb[3] - aa[3] || a.localeCompare(b);
  });
}

async function listModels(key, fetchImpl) {
  return withDeadline(5_000, null, async (signal) => {
    try {
      const entries = [], tokens = new Set();
      let token;
      for (let i = 0; i < MAX_CATALOG_PAGES; i += 1) {
        if (signal.aborted) return null;
        const url = new URL(API);
        url.searchParams.set('pageSize', '100');
        if (token) url.searchParams.set('pageToken', token);
        const response = await fetchImpl(url.href, { method: 'GET', headers: { 'x-goog-api-key': key }, redirect: 'error', signal });
        if (response.status !== 200) { cancelBody(response); return null; }
        const page = await readPayload(response, 262_144);
        if (!Array.isArray(page?.models) || page.models.length > 100) return null;
        entries.push(...page.models);
        token = page.nextPageToken;
        if (token === undefined || token === '') return rankedModels(entries);
        if (typeof token !== 'string' || token.length > 2048 || tokens.has(token)) return null;
        tokens.add(token);
      }
    } catch { return null; }
    return null;
  });
}

// At most four bounded catalog pages and eight sequential synthetic calls; report every tested rank.
export async function evaluateHighestWorkingGemini(key, { fetchImpl = globalThis.fetch } = {}) {
  if (!keyPresent(key)) return fixed('skip', 'missing=GEMINI_API_KEY');
  const ranked = await listModels(key, fetchImpl);
  const pinned = typeof model === 'string' && SAFE_VERSION.test(model) ? model : 'unknown';
  if (ranked === null) return fixed('fail', `catalog_unavailable; pinned=${pinned}; highest_working=unverified; sweep=incomplete_catalog`);
  const results = [];
  for (const id of ranked.slice(0, MAX_PROBES)) {
    const result = await probeGeneration(key, id, fetchImpl, 10_000);
    results.push(result);
  }
  const working = results.find((result) => result.reason === 'generated');
  const tests = results.map((r) => `${r.modelId}:${r.httpStatus ?? 'no_http'}:${r.reason}`).join(',') || 'none';
  const untested = ranked.slice(results.length);
  const label = working ? `Gemini: 200 · ${working.modelVersion ?? 'version unreported'}; ` : '';
  const detail = `${label}pinned=${pinned}; highest_working=${working?.modelId ?? 'unverified'}; `
    + `provider_model_version=${working?.modelVersion ?? 'unreported'}; tested=${tests}; `
    + `sweep=${untested.length ? 'incomplete_probe_cap' : 'complete'}; untested_count=${untested.length}; untested_sample=${untested.slice(0, MAX_PROBES).join(',') || 'none'}`;
  return fixed(working ? 'pass' : 'fail', detail);
}
