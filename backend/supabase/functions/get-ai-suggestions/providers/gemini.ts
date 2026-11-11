import coachingContract from '../contract.json' with { type: 'json' };
import { decodeProviderAnswer, decodeProviderError, readBoundedBody } from '../providerDecode.ts';
import { descriptorUrl, PROVIDER_CATALOG, type ProviderDescriptor } from './catalog.ts';
import { type CoachingProvider, type ProviderAttemptInput, type ProviderAttemptResult, SAFE_MODEL_ID } from './types.ts';

// #1416 — the selected stable model is pinned in contract.json; runtime URL construction uses that single reviewed value
// rather than accepting a caller-supplied model ID. A different Gemini model is a reviewed contract change and redeploy.
// The value now comes from the reviewed Gemini descriptor (catalog.ts), which reads the same contract.json model.
const GEMINI_DESCRIPTOR = (() => {
  const descriptor = PROVIDER_CATALOG.find((d) => d.id === 'google_gemini');
  if (!descriptor) throw new Error('the reviewed catalogue has no google_gemini descriptor');
  return descriptor;
})();
export const GEMINI_API_URL = descriptorUrl(GEMINI_DESCRIPTOR);
export const GEMINI_GENERATION_CONFIG = coachingContract.generationConfig;

/** The exact request body Gemini receives (#1424: the response MIME type and schema are enforced by the provider). */
export function geminiRequestBody(prompt: string): string {
  return JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: GEMINI_GENERATION_CONFIG,
  });
}

/**
 * The `gemini-generate-content` adapter family: any descriptor of that family (a different Gemini model or endpoint) runs through this
 * one reviewed wire protocol — same key placement, headers, body and decoding. The request body's generationConfig is still the
 * contract.json one, so a descriptor changes WHERE the request goes, never what it asks for.
 */
export function createGeminiAdapter(descriptor: ProviderDescriptor): CoachingProvider {
  if (descriptor.family !== 'gemini-generate-content') throw new Error('gemini adapter: descriptor family mismatch');
  const url = descriptorUrl(descriptor);
  return Object.freeze({
    id: descriptor.id,
    keyVariable: descriptor.keyVariable,
    attempt: (input: ProviderAttemptInput) => geminiAttempt(url, input),
  });
}

async function geminiAttempt(url: string, { prompt, apiKey, signal, onResponse }: ProviderAttemptInput): Promise<ProviderAttemptResult> {
  // `fetch` is resolved at call time so the handler's tests (and only they) can replace it.
  const response = await fetch(`${url}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: geminiRequestBody(prompt),
  });
  // #1258 (Codex P2 r4288823216): the status (and a failure's wait hint) is known the moment fetch resolves, before any body is read.
  onResponse(response.status, response.ok ? undefined : response.headers.get('retry-after'));
  if (!response.ok) {
    // #1258 (PM 5953504835 / PO 2026-10-12): the error body is decoded to its closed codes only, never logged or returned.
    const errorCodes = decodeProviderError(await readBoundedBody(response));
    return { status: response.status, ok: false, errorCodes, bodyUnreadable: false, answer: null };
  }
  let data: Awaited<ReturnType<Response['json']>>;
  try {
    data = await response.json();
  } catch {
    return { status: response.status, ok: true, errorCodes: null, bodyUnreadable: true, answer: null };
  }
  return {
    status: response.status, ok: true, errorCodes: null, bodyUnreadable: false,
    answer: {
      text: data?.candidates?.[0]?.content?.parts?.[0]?.text,
      modelVersion: typeof data?.modelVersion === 'string' && SAFE_MODEL_ID.test(data.modelVersion) ? data.modelVersion : null,
      codes: decodeProviderAnswer(data),
    },
  };
}

/** Google Gemini, unchanged behind the adapter boundary: same URL, key placement, headers, body and decoding. */
export const geminiProvider: CoachingProvider = createGeminiAdapter(GEMINI_DESCRIPTOR);
