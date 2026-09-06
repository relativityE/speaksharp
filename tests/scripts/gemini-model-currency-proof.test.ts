import { describe, expect, it, vi } from 'vitest';
import {
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
    const invalid = [
      { ...validSuggestions, extra: true },
      { ...validSuggestions, version: 'wrong' },
      { ...validSuggestions, what_worked: '   ' },
      { ...validSuggestions, what_to_try_next: 'one two three four five six seven' },
    ];
    for (const suggestions of invalid) expect(validateProviderBody(providerBody(suggestions), contract).valid).toBe(false);
  });

  it('samples ten logical results with at most ten actual provider requests and preserves invalid evidence', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      expect(_url).toMatch(/^https:\/\/generativelanguage\.googleapis\.com\//);
      expect(_url).not.toContain('attacker');
      expect(JSON.parse(String(init.body)).generationConfig).toEqual(contract.generationConfig);
      const responseNumber = fetchImpl.mock.calls.length;
      const suggestions = responseNumber === 1
        ? { ...validSuggestions, what_worked: 'one two three four five six seven' }
        : validSuggestions;
      return new Response(providerBody(suggestions), { status: 200 });
    });
    const evidence = await runProof({
      contract,
      targetSha: 'a'.repeat(40),
      sampleCount: 10,
      apiKey: 'secret-for-test',
      fetchImpl,
      sleep: async () => {},
      spacingMs: 0,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(10);
    expect(evidence.provider_requests).toBe(10);
    expect(evidence.samples).toHaveLength(10);
    expect(evidence.samples[0].valid).toBe(false);
    expect(evidence.samples.slice(1).every((sample) => sample.valid)).toBe(true);
    expect(evidence.success).toBe(false);
    expect(JSON.stringify(evidence)).not.toContain('secret-for-test');
  });

  it('bounds single-call retries and returns a deliberate result instead of dereferencing no response', async () => {
    const fetchImpl = vi.fn(async () => new Response('busy', { status: 503 }));
    const evidence = await runProof({
      contract,
      targetSha: 'b'.repeat(40),
      sampleCount: 1,
      apiKey: 'secret-for-test',
      fetchImpl,
      sleep: async () => {},
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(evidence.provider_requests).toBe(4);
    expect(evidence.samples[0].reason).toBe('provider HTTP 503');
    expect(evidence.success).toBe(false);
  });
});
