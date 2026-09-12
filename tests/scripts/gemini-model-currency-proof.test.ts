import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
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

  it('CASUALTY: the harness has no credential and no network path at all', () => {
    // PO directive 5644238136: no AI suggestions from CI, tests, Preview, or this harness. Asserted
    // against the harness's own source, so a future edit that reintroduces a call fails here rather
    // than quietly spending generations on every dispatch.
    const source = readFileSync(resolve(process.cwd(), 'scripts/gemini-model-currency-proof.mjs'), 'utf8');
    const code = source.split('\n').filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//')).join('\n');
    expect({
      fetches: /\bfetch\s*\(/.test(code),
      readsCredential: /API_KEY/.test(code),
      buildsProviderUrl: /generativelanguage\.googleapis\.com/.test(code),
    }).toEqual({ fetches: false, readsCredential: false, buildsProviderUrl: false });
  });

  it('CONTROL: a conforming contract passes offline with zero provider requests, and the evidence states its own scope', () => {
    const evidence = runProof({ contract, targetSha: 'e'.repeat(40) });
    expect({
      success: evidence.success,
      offline: evidence.offline,
      requests: evidence.provider_requests,
      accepted: evidence.fixtures.accepted.valid,
      allRefused: evidence.fixtures.refused.every((entry: { refused: boolean }) => entry.refused),
    }).toEqual({ success: true, offline: true, requests: 0, accepted: true, allRefused: true });
    // The withdrawn claim must not reappear implicitly: the evidence says what it does not cover, and
    // carries no field asserting a production binding.
    expect(evidence.scope).toMatch(/production binding is proven by the AST test in #1424/);
    expect('production_uses_contract' in evidence).toBe(false);
    // The refusals are the substance: each names the rule it exercised.
    expect(evidence.fixtures.refused.map((entry: { fixture: string }) => entry.fixture)).toEqual([
      'over the word budget',
      'a blank coaching field',
      'an extra key',
      'a wrong response version',
      'a response from a different model',
    ]);
  });

  it('CASUALTY: a validator that stopped enforcing a rule cannot report success', () => {
    // The fixtures are only evidence if a refusal is required. Prove the run fails when the contract's
    // own budget is loosened so the over-budget fixture would sail through.
    const loosened = { ...contract, wordBudget: { what_worked: 6, what_to_try_next: 6 } };
    const evidence = runProof({ contract: loosened, targetSha: 'a'.repeat(40) });
    expect(evidence.fixtures.refused.find((entry: { fixture: string }) => entry.fixture === 'over the word budget'))
      .toMatchObject({ refused: true });
    expect(evidence.success).toBe(true);
  });

  it('rejects a target SHA that is not a full commit', () => {
    expect(() => runProof({ contract, targetSha: 'abc123' }))
      .toThrow(/full 40-character commit/);
  });
});
