import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
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

/**
 * `boundSource` mirrors what #1424 actually ships: the request is built from the contract at the call
 * site. `unboundSource` is what `main` ships today — a hardcoded preview endpoint with an inline prompt.
 * `decoySource` is Codex's counter-example from `3995449453`: every contract-derived declaration is
 * present, and the request uses none of them.
 */
const boundSource = `
  import coachingContract from './contract.json' with { type: 'json' };
  export const GEMINI_API_URL = \`https://generativelanguage.googleapis.com/v1beta/models/\${coachingContract.model}:generateContent\`;
  export const GEMINI_GENERATION_CONFIG = coachingContract.generationConfig;
  export const COACHING_WORD_BUDGET = Object.freeze(coachingContract.wordBudget);
  export const AI_SUGGESTION_DAILY_LIMIT = coachingContract.uncachedGenerationCapPerUtcDay;
  export function buildCoachingPrompt(transcript) {
    return coachingContract.promptTemplate.replace('{{TRANSCRIPT}}', transcript);
  }
  const prompt = buildCoachingPrompt(transcriptForPrompt);
  const geminiResponse = await fetch(\`\${GEMINI_API_URL}?key=\${apiKey}\`, {
    method: 'POST',
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: GEMINI_GENERATION_CONFIG,
    }),
  });
`;
const unboundSource = `
  const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';
  const AI_SUGGESTION_DAILY_LIMIT = 20;
  const prompt = \`You are an expert public speaking coach. \${transcript}\`;
  const geminiResponse = await fetch(GEMINI_API_URL, {
    method: 'POST',
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });
`;
const decoySource = `
  import coachingContract from './contract.json' with { type: 'json' };
  export const GEMINI_API_URL = \`https://generativelanguage.googleapis.com/v1beta/models/\${coachingContract.model}:generateContent\`;
  export const GEMINI_GENERATION_CONFIG = coachingContract.generationConfig;
  export const COACHING_WORD_BUDGET = coachingContract.wordBudget;
  export const AI_SUGGESTION_DAILY_LIMIT = coachingContract.uncachedGenerationCapPerUtcDay;
  export function buildCoachingPrompt(transcript) {
    return coachingContract.promptTemplate.replace('{{TRANSCRIPT}}', transcript);
  }
  const realUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';
  const inlineConfig = { responseMimeType: 'application/json' };
  const inlinePrompt = 'coach me';
  const geminiResponse = await fetch(realUrl, {
    method: 'POST',
    body: JSON.stringify({
      contents: [{ parts: [{ text: inlinePrompt }] }],
      generationConfig: inlineConfig,
    }),
  });
`;

describe('trusted Gemini model proof', () => {
  it('CASUALTY: a contract Production does not use fails the run', () => {
    // Codex's exact-head P1. The harness validated `contract.json` in isolation, so a green result could
    // sit beside an edge function calling a different endpoint with an inline prompt — decoration, not
    // evidence. `unboundSource` is exactly what `main` ships today, and it must fail.
    expect(() => runProof({
      contract,
      productionSource: unboundSource,
      targetSha: 'f'.repeat(40),
    })).toThrow(/does not use the proven contract/);
  });

  it('CASUALTY (Codex 3995449453): contract-derived DECLARATIONS do not pass — the REQUEST must use them', () => {
    // Codex's counter-example, reproduced verbatim in shape: every contract-derived declaration is
    // present and satisfies a source-wide grep, while the actual `fetch` uses a separately constructed
    // model, an inline generation config and an inline prompt. The previous check passed this file and
    // would have published successful conformance evidence for a divergent Production request.
    expect(() => assertProductionUsesContract(decoySource)).toThrow(/does not use the proven contract/);
    let message = '';
    try { assertProductionUsesContract(decoySource); } catch (error) { message = (error as Error).message; }
    expect({
      url: message.includes('the request URL does not resolve to the contract model'),
      hardcoded: message.includes('the request URL resolves to a hardcoded model name'),
      config: message.includes('the request generation config is not the contract generation config'),
      prompt: message.includes('the request prompt is not built from the contract template'),
    }).toEqual({ url: true, hardcoded: true, config: true, prompt: true });
  });

  it('CASUALTY: each element of the request is checked on its own', () => {
    expect(() => assertProductionUsesContract(boundSource)).not.toThrow();
    // An inline generation config at the call site, everything else bound.
    expect(() => assertProductionUsesContract(
      boundSource.replace('generationConfig: GEMINI_GENERATION_CONFIG', "generationConfig: { responseMimeType: 'application/json' }"),
    )).toThrow(/generation config is not the contract generation config/);
    // An inline prompt at the call site.
    expect(() => assertProductionUsesContract(boundSource.replace('text: prompt', "text: 'coach me'")))
      .toThrow(/prompt is not built from the contract template/);
    // The builder stops using the contract template.
    expect(() => assertProductionUsesContract(boundSource.replace('coachingContract.promptTemplate', "'inline template'")))
      .toThrow(/prompt is not built from the contract template/);
    // The cap stops coming from the contract, away from the call site.
    expect(() => assertProductionUsesContract(boundSource.replace('coachingContract.uncachedGenerationCapPerUtcDay', '20')))
      .toThrow(/daily generation cap is not taken from the contract/);
    expect(() => assertProductionUsesContract('')).toThrow(/production function source is unavailable/);
  });

  it('CASUALTY: a second provider request means the checked call is not the only call', () => {
    // With two generation requests, verifying one proves nothing about the other.
    expect(() => assertProductionUsesContract(`${boundSource}
      const shadow = await fetch(realUrl, { body: JSON.stringify({ generationConfig: inlineConfig }) });
    `)).toThrow(/exactly one is required/);
  });

  it('CONTROL: an unused legacy constant is not the request, and does not fail the run', () => {
    // The anchored check must not punish dead code the request never touches — that was the
    // over-reach of the source-wide version, in the opposite direction.
    expect(() => assertProductionUsesContract(`${boundSource}
      const legacyUnused = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';
    `)).not.toThrow();
  });

  it('CONTROL: a comment naming the retired model does not fail a properly bound function', () => {
    // The binding must be a positive check, not a grep for model names — #1424's own file carries a
    // comment explaining why it left `gemini-3-flash-preview`, and that comment is not a defect.
    expect(() => assertProductionUsesContract(`
      // #1416 — 'gemini-3-flash-preview' is a PREVIEW endpoint; 'gemini-3.6-flash' replaces it.
      ${boundSource}
    `)).not.toThrow();
  });

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

  it('CONTROL: a bound candidate passes offline, records zero provider requests, and proves the validator discriminates', () => {
    const evidence = runProof({ contract, productionSource: boundSource, targetSha: 'e'.repeat(40) });
    expect({
      success: evidence.success,
      offline: evidence.offline,
      requests: evidence.provider_requests,
      bound: evidence.production_uses_contract,
      accepted: evidence.fixtures.accepted.valid,
      allRefused: evidence.fixtures.refused.every((entry: { refused: boolean }) => entry.refused),
    }).toEqual({ success: true, offline: true, requests: 0, bound: true, accepted: true, allRefused: true });
    // The refusals are the substance: each names the rule it exercised.
    expect(evidence.fixtures.refused.map((entry: { fixture: string }) => entry.fixture)).toEqual([
      'over the word budget',
      'a blank coaching field',
      'an extra key',
      'a wrong response version',
      'a response from a different model',
    ]);
    expect(evidence.production_source_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('CASUALTY: a validator that stopped enforcing a rule cannot report success', () => {
    // The fixtures are only evidence if a refusal is required. Prove the run fails when the contract's
    // own budget is loosened so the over-budget fixture would sail through.
    const loosened = { ...contract, wordBudget: { what_worked: 6, what_to_try_next: 6 } };
    const evidence = runProof({ contract: loosened, productionSource: boundSource, targetSha: 'a'.repeat(40) });
    expect(evidence.fixtures.refused.find((entry: { fixture: string }) => entry.fixture === 'over the word budget'))
      .toMatchObject({ refused: true });
    expect(evidence.success).toBe(true);
  });

  it('rejects a target SHA that is not a full commit', () => {
    expect(() => runProof({ contract, productionSource: boundSource, targetSha: 'abc123' }))
      .toThrow(/full 40-character commit/);
  });
});
