import { describe, expect, it, vi } from 'vitest';
import {
  assertProductionUsesContract,
  buildProofPrompt,
  runProof,
  validateContract,
  validateProviderBody,
} from '../../scripts/gemini-model-currency-proof.mjs';

const contract = {
  model: 'gemini-3.6-flash',
  version: 'gemini_coaching_v1',
  uncachedGenerationCapPerUtcDay: 10,
  wordBudget: { what_worked: 6, what_to_try_next: 6 },
  generationConfig: {
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      properties: {
        version: { type: 'STRING', enum: ['gemini_coaching_v1'] },
        what_worked: { type: 'STRING', minLength: 1, maxLength: 90, pattern: '.*\\S.*' },
        what_to_try_next: { type: 'STRING', minLength: 1, maxLength: 90, pattern: '.*\\S.*' },
      },
      required: ['version', 'what_worked', 'what_to_try_next'],
    },
  },
  promptTemplate: 'AT MOST 6 words\nTranscript: {{TRANSCRIPT}}\nMetrics: {{METRICS}}',
};

const providerBody = (suggestions: Record<string, unknown>, modelVersion = 'gemini-3.6-flash') => JSON.stringify({
  modelVersion,
  candidates: [{ content: { parts: [{ text: JSON.stringify(suggestions) }] } }],
});

const validSuggestions = {
  version: 'gemini_coaching_v1',
  what_worked: 'Clear opening named the decision.',
  what_to_try_next: 'End with one dated commitment.',
};

describe('trusted Gemini model proof', () => {
  it('accepts only the established model, daily cap, two fields, six-word budgets, and strict schema', () => {
    expect(validateContract(structuredClone(contract))).toEqual(contract);
    expect(() => validateContract({ ...contract, model: 'attacker-controlled' })).toThrow();
    expect(() => validateContract({ ...contract, uncachedGenerationCapPerUtcDay: 11 })).toThrow();
    expect(() => validateContract({ ...contract, wordBudget: { ...contract.wordBudget, what_worked: 7 } })).toThrow();
    expect(() => validateContract({
      ...contract,
      generationConfig: { ...contract.generationConfig, candidateCount: 4 },
    })).toThrow();
    expect(() => validateContract({
      ...contract,
      generationConfig: {
        ...contract.generationConfig,
        responseSchema: {
          ...contract.generationConfig.responseSchema,
          properties: {
            ...contract.generationConfig.responseSchema.properties,
            what_worked: {
              ...contract.generationConfig.responseSchema.properties.what_worked,
              maxLength: 1e12,
            },
          },
        },
      },
    })).toThrow();
    expect(() => validateContract({
      ...contract,
      generationConfig: {
        ...contract.generationConfig,
        responseSchema: {
          ...contract.generationConfig.responseSchema,
          properties: {
            version: contract.generationConfig.responseSchema.properties.version,
            what_worked: contract.generationConfig.responseSchema.properties.what_worked,
          },
        },
      },
    })).toThrow();
    expect(() => validateContract({
      ...contract,
      generationConfig: {
        ...contract.generationConfig,
        responseSchema: {
          ...contract.generationConfig.responseSchema,
          properties: {
            ...contract.generationConfig.responseSchema.properties,
            what_worked: {
              ...contract.generationConfig.responseSchema.properties.what_worked,
              pattern: '.*',
            },
          },
        },
      },
    })).toThrow();
  });

  it('builds the prompt from inert data without evaluating candidate source code', () => {
    const built = buildProofPrompt(contract, 'literal ${secret}', 'wpm=120');
    expect(built).toContain('literal ${secret}');
    expect(built).toContain('wpm=120');
    expect(built).not.toContain('{{TRANSCRIPT}}');
  });

  it('applies the exact production key, version, nonblank, and six-word checks to every response', () => {
    expect(validateProviderBody(providerBody(validSuggestions), contract).valid).toBe(true);
    expect(validateProviderBody(providerBody(validSuggestions, 'gemini-other-model'), contract)).toMatchObject({
      valid: false,
      reason: 'provider model version mismatch: "gemini-other-model"',
    });
    expect(validateProviderBody(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(validSuggestions) }] } }],
    }), contract)).toMatchObject({
      valid: false,
      reason: 'provider model version mismatch: null',
    });
    const invalid = [
      { ...validSuggestions, extra: true },
      { ...validSuggestions, version: 'wrong' },
      { ...validSuggestions, what_worked: '   ' },
      { ...validSuggestions, what_to_try_next: 'one two three four five six seven' },
    ];
    for (const suggestions of invalid) expect(validateProviderBody(providerBody(suggestions), contract).valid).toBe(false);
  });

  /**
   * PM RETURN `5644180930` — the two corrections, as casualties.
   *
   * `boundSource` is the shape #1424 actually ships: model, generation config, prompt, word budget and
   * daily cap all derived from the contract. `unboundSource` is the shape `main` ships today — a
   * hardcoded preview endpoint with an inline prompt — which is exactly the state a contract-only
   * proof would have blessed.
   */
  const boundSource = `
    import coachingContract from './contract.json' with { type: 'json' };
    export const GEMINI_API_URL = \`https://generativelanguage.googleapis.com/v1beta/models/\${coachingContract.model}:generateContent\`;
    export const GEMINI_GENERATION_CONFIG = coachingContract.generationConfig;
    export const COACHING_WORD_BUDGET = Object.freeze(coachingContract.wordBudget);
    export const AI_SUGGESTION_DAILY_LIMIT = coachingContract.uncachedGenerationCapPerUtcDay;
    const prompt = coachingContract.promptTemplate.replace('{{TRANSCRIPT}}', transcript);
  `;
  const unboundSource = `
    const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';
    const AI_SUGGESTION_DAILY_LIMIT = 20;
    const prompt = \`You are an expert public speaking coach. \${transcript}\`;
  `;

  it('CASUALTY: a contract Production does not use never reaches the provider', async () => {
    // The exact defect Codex named: the harness validated `contract.json` in isolation, so a green
    // proof could sit beside an edge function calling a different endpoint with an inline prompt.
    // The binding runs BEFORE the call, so an unbound candidate costs nothing at all.
    const fetchImpl = vi.fn(async () => new Response(providerBody(validSuggestions), { status: 200 }));
    await expect(runProof({
      contract,
      productionSource: unboundSource,
      targetSha: 'a'.repeat(40),
      apiKey: 'secret-for-test',
      fetchImpl,
    })).rejects.toThrow(/does not use the proven contract/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('CASUALTY: each binding is checked on its own, so a partial adoption still fails', () => {
    expect(() => assertProductionUsesContract(boundSource)).not.toThrow();
    // Imports the contract, then hardcodes the endpoint anyway — the most plausible half-migration.
    expect(() => assertProductionUsesContract(`${boundSource}
      const legacy = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';
    `)).toThrow(/hardcodes a model name/);
    expect(() => assertProductionUsesContract(boundSource.replace('coachingContract.promptTemplate', '`inline prompt`')))
      .toThrow(/prompt is not built from the contract template/);
    expect(() => assertProductionUsesContract(boundSource.replace('coachingContract.uncachedGenerationCapPerUtcDay', '20')))
      .toThrow(/daily generation cap is not taken from the contract/);
    expect(() => assertProductionUsesContract('')).toThrow(/production function source is unavailable/);
  });

  it('CONTROL: a comment naming the old model does not fail a properly bound function', () => {
    // The binding must be a positive check, not a grep for model names — #1424's own file carries a
    // comment explaining why it left `gemini-3-flash-preview`, and that comment is not a defect.
    expect(() => assertProductionUsesContract(`
      // #1416 — 'gemini-3-flash-preview' is a PREVIEW endpoint; 'gemini-3.6-flash' replaces it.
      ${boundSource}
    `)).not.toThrow();
  });

  it('CASUALTY: one dispatch is exactly one provider request, and a retryable status does not buy a second', async () => {
    // This was four attempts on a single sample, and ten samples at the other setting — up to ten paid
    // generations from one dispatch. A 503 is now simply a failed proof.
    const fetchImpl = vi.fn(async () => new Response('busy', { status: 503 }));
    const evidence = await runProof({
      contract,
      productionSource: boundSource,
      targetSha: 'b'.repeat(40),
      apiKey: 'secret-for-test',
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect({
      requests: evidence.provider_requests,
      ceiling: evidence.max_provider_requests,
      reason: evidence.call.reason,
      success: evidence.success,
    }).toEqual({ requests: 1, ceiling: 1, reason: 'provider HTTP 503', success: false });
  });

  it('CONTROL: a valid answer from a bound function passes on a single request, and never records the credential', async () => {
    const checkpoints: unknown[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      expect(_url).toMatch(/^https:\/\/generativelanguage\.googleapis\.com\//);
      expect(_url).not.toContain('attacker');
      expect(JSON.parse(String(init.body)).generationConfig).toEqual(contract.generationConfig);
      return new Response(providerBody(validSuggestions), { status: 200 });
    });
    const evidence = await runProof({
      contract,
      productionSource: boundSource,
      targetSha: 'e'.repeat(40),
      apiKey: 'secret-for-test',
      fetchImpl,
      onProgress: (value: unknown) => { checkpoints.push(structuredClone(value)); },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect({ requests: evidence.provider_requests, success: evidence.success, bound: evidence.production_uses_contract })
      .toEqual({ requests: 1, success: true, bound: true });
    expect(evidence.production_source_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(checkpoints.length).toBeGreaterThan(1);
    expect(JSON.stringify(evidence)).not.toContain('secret-for-test');
  });

  it('aborts a stalled provider read and reports a deliberate timeout on its single request', async () => {
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    const checkpoints: unknown[] = [];
    const evidence = await runProof({
      contract,
      productionSource: boundSource,
      targetSha: 'c'.repeat(40),
      apiKey: 'secret-for-test',
      fetchImpl,
      requestTimeoutMs: 1,
      onProgress: (value: unknown) => { checkpoints.push(structuredClone(value)); },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect({ reason: evidence.call.reason, status: evidence.call.http_status, success: evidence.success })
      .toEqual({ reason: 'provider request timed out', status: null, success: false });
    expect(checkpoints.length).toBeGreaterThan(1);
  });
});
