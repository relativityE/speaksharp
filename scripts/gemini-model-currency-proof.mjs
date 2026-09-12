#!/usr/bin/env node
/**
 * Trusted Gemini currency proof.
 *
 * OFFLINE contract-conformance harness (PO directive 5644238136). It runs from the repository default
 * branch, never checks out or executes candidate code, and makes NO network request of any kind: there
 * is no credential, no fetch, and no provider call anywhere in this module. The workflow supplies one
 * inert text read from the target commit — the JSON contract — and everything below validates it.
 *
 * SCOPE, stated here and in the evidence: this proves the candidate's contract IS the locked product
 * contract and that the shared response validator discriminates correctly. It does NOT prove that the
 * production function uses that contract (see the note above `buildProofPrompt`), and it does NOT prove
 * the provider is currently serving the model — that is answered in Production, by suggestions
 * generating automatically after a completed session.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REQUIRED_KEYS = ['version', 'what_to_try_next', 'what_worked'];
const COACHING_FIELDS = ['what_worked', 'what_to_try_next'];
const EXPECTED_MODEL = 'gemini-3.6-flash';
const EXPECTED_VERSION = 'gemini_coaching_v1';
const EXPECTED_REQUEST_CAP = 10;
const EXPECTED_WORD_BUDGET = 6;
const EXPECTED_SCHEMA_MAX_LENGTH = 90;

const exactKeys = (value, expected) => JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
const words = (value) => value.trim().split(/\s+/).filter(Boolean).length;

export function validateContract(contract) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) throw new Error('contract must be an object');
  if (!exactKeys(contract, ['model', 'version', 'uncachedGenerationCapPerUtcDay', 'wordBudget', 'generationConfig', 'promptTemplate'])) {
    throw new Error(`unexpected contract keys: ${JSON.stringify(Object.keys(contract).sort())}`);
  }
  if (contract.model !== EXPECTED_MODEL) throw new Error(`model must be ${EXPECTED_MODEL}`);
  if (contract.version !== EXPECTED_VERSION) throw new Error(`version must be ${EXPECTED_VERSION}`);
  if (contract.uncachedGenerationCapPerUtcDay !== EXPECTED_REQUEST_CAP) throw new Error(`uncached generation cap must be ${EXPECTED_REQUEST_CAP}`);
  if (!contract.wordBudget || !exactKeys(contract.wordBudget, COACHING_FIELDS)) throw new Error('word budget must define exactly the two coaching fields');
  for (const field of COACHING_FIELDS) {
    if (contract.wordBudget[field] !== EXPECTED_WORD_BUDGET) throw new Error(`${field} word budget must be ${EXPECTED_WORD_BUDGET}`);
  }

  const config = contract.generationConfig;
  const schema = config?.responseSchema;
  if (!config || !exactKeys(config, ['responseMimeType', 'responseSchema'])) throw new Error('generation config contains untrusted or missing fields');
  if (config?.responseMimeType !== 'application/json') throw new Error('response MIME type must be application/json');
  if (!schema || !exactKeys(schema, ['type', 'properties', 'required'])) throw new Error('response schema contains untrusted or missing fields');
  if (schema?.type !== 'OBJECT') throw new Error('response schema must be an object');
  if (!exactKeys(schema?.properties ?? {}, REQUIRED_KEYS)) throw new Error('response schema property set does not match production');
  if (JSON.stringify([...(schema?.required ?? [])].sort()) !== JSON.stringify(REQUIRED_KEYS)) throw new Error('response schema required set does not match production');
  if (!exactKeys(schema.properties.version ?? {}, ['type', 'enum']) || schema.properties.version.type !== 'STRING') {
    throw new Error('response schema version contains untrusted or missing fields');
  }
  if (JSON.stringify(schema.properties.version?.enum) !== JSON.stringify([EXPECTED_VERSION])) throw new Error('response schema version enum does not match production');
  for (const field of COACHING_FIELDS) {
    const fieldSchema = schema.properties[field];
    if (!fieldSchema || !exactKeys(fieldSchema, ['type', 'minLength', 'maxLength', 'pattern'])) {
      throw new Error(field + ' schema contains untrusted or missing fields');
    }
    if (fieldSchema?.type !== 'STRING' || fieldSchema.minLength !== 1 || fieldSchema.pattern !== '.*\\S.*') {
      throw new Error(`${field} schema must reject empty and whitespace-only strings`);
    }
    if (fieldSchema.maxLength !== EXPECTED_SCHEMA_MAX_LENGTH) {
      throw new Error(`${field} schema maxLength must be ${EXPECTED_SCHEMA_MAX_LENGTH}`);
    }
  }

  if (typeof contract.promptTemplate !== 'string') throw new Error('promptTemplate must be a string');
  for (const marker of ['{{TRANSCRIPT}}', '{{METRICS}}']) {
    if (contract.promptTemplate.split(marker).length !== 2) throw new Error(`${marker} must occur exactly once`);
  }
  const unknownMarkers = contract.promptTemplate.match(/\{\{[^}]+\}\}/g)?.filter((marker) => !['{{TRANSCRIPT}}', '{{METRICS}}'].includes(marker)) ?? [];
  if (unknownMarkers.length) throw new Error(`unknown prompt markers: ${JSON.stringify(unknownMarkers)}`);
  if (!contract.promptTemplate.includes('AT MOST 6 words')) throw new Error('prompt does not state the six-word budget');
  return contract;
}

/**
 * WHAT THIS HARNESS DOES NOT CLAIM, and why the claim was withdrawn.
 *
 * Three successive versions tried to prove statically that the PRODUCTION function derives its request
 * from this contract, and Codex defeated each one in turn: source-wide regexes passed decoy declarations
 * (`3995449453`); request-site anchoring passed a `fetch` written inside a template literal
 * (`3995482306`), a spread-merged generation config (`3995482308`), and declared-but-unused budget and
 * cap aliases (`3995482310`); and the security review showed the same gap could bless an exfiltrating
 * candidate (`3995491120`).
 *
 * The root cause was the tool, not the individual holes: this job runs `node` with no dependency install,
 * so only Node built-ins are available and every attempt degraded into substring matching over untrusted
 * TypeScript. Rather than ship a fourth patch and call it proof, the claim is REMOVED from here. The
 * production binding is proven in #1424 by a test that parses `get-ai-suggestions/index.ts` with the real
 * TypeScript compiler, in CI, where the compiler exists — checking the tree being merged, on every PR.
 *
 * What remains here is exactly what this runtime can support honestly, and the evidence says so in its
 * own `scope` field so a reader cannot mistake it for more.
 */

export function buildProofPrompt(contract, transcript, metrics) {
  return contract.promptTemplate
    .replace('{{TRANSCRIPT}}', transcript)
    .replace('{{METRICS}}', metrics);
}

export function validateProviderBody(bodyText, contract) {
  let envelope;
  try { envelope = JSON.parse(bodyText); } catch { return { valid: false, reason: 'provider response body was not JSON' }; }
  if (envelope?.modelVersion !== EXPECTED_MODEL) {
    return { valid: false, reason: `provider model version mismatch: ${JSON.stringify(envelope?.modelVersion ?? null)}` };
  }
  const rawText = envelope?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof rawText !== 'string') return { valid: false, reason: 'missing candidates[0].content.parts[0].text' };
  let parsed;
  try { parsed = JSON.parse(rawText.trim()); } catch { return { valid: false, reason: 'model text was not bare JSON' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { valid: false, reason: 'model JSON was not an object' };
  if (!exactKeys(parsed, REQUIRED_KEYS)) return { valid: false, reason: `key mismatch: ${JSON.stringify(Object.keys(parsed).sort())}` };
  if (parsed.version !== contract.version) return { valid: false, reason: `version mismatch: ${JSON.stringify(parsed.version)}` };

  const wordCounts = {};
  for (const field of COACHING_FIELDS) {
    if (typeof parsed[field] !== 'string' || !parsed[field].trim()) return { valid: false, reason: `${field} was blank or non-string` };
    wordCounts[field] = words(parsed[field]);
    if (wordCounts[field] > contract.wordBudget[field]) {
      return { valid: false, reason: `${field} exceeded ${contract.wordBudget[field]} words`, word_counts: wordCounts };
    }
  }
  return { valid: true, word_counts: wordCounts, parsed, model_version: envelope.modelVersion };
}

/**
 * Fixture responses. These are the provider shapes the validator must discriminate between, checked in
 * so the harness can prove its rules WITHOUT a provider. The valid one must be accepted; each invalid
 * one must be refused for its own stated reason, so a validator that silently stopped enforcing a rule
 * fails here instead of in front of a user.
 */
const FIXTURE_VALID = {
  version: 'gemini_coaching_v1',
  what_worked: 'Clear opening named the decision.',
  what_to_try_next: 'End with one dated commitment.',
};
const FIXTURE_REFUSALS = [
  ['over the word budget', { ...FIXTURE_VALID, what_to_try_next: 'one two three four five six seven' }],
  ['a blank coaching field', { ...FIXTURE_VALID, what_worked: '   ' }],
  ['an extra key', { ...FIXTURE_VALID, extra: true }],
  ['a wrong response version', { ...FIXTURE_VALID, version: 'wrong' }],
];
const fixtureEnvelope = (suggestions, modelVersion) => JSON.stringify({
  modelVersion,
  candidates: [{ content: { parts: [{ text: JSON.stringify(suggestions) }] } }],
});

/**
 * PO directive `5644238136` — OFFLINE ONLY. NO CREDENTIAL, NO PROVIDER CALL, EVER.
 *
 * This harness used to send a real request. It no longer can: there is no credential parameter, no
 * fetch, and no network path in this module at all, which a casualty asserts against this file's own
 * source. Nothing here — CI, tests, Preview, or a dispatch — can spend a generation.
 *
 * What it proves:
 *
 *   1. the candidate's contract is exactly the locked product contract (`validateContract`);
 *   2. the shared response validator actually discriminates: it accepts a conforming response and
 *      refuses each fixture that breaks one rule, including an answer from a different model.
 *
 * What it does NOT prove, and says so in its own `scope` field:
 *
 *   - that the PRODUCTION function uses this contract. That claim was withdrawn after five findings
 *     against three static-analysis attempts; #1424 proves it with a real TypeScript parse in CI.
 *   - that Google is currently serving the model. That is a live question, answered in Production by
 *     suggestions generating automatically after a completed session — unchanged by this PR.
 */
export function runProof({ contract, targetSha, onProgress = () => {} }) {
  validateContract(contract);
  if (!/^[0-9a-f]{40}$/i.test(targetSha)) throw new Error('target SHA must be a full 40-character commit');

  const evidence = {
    target_sha: targetSha,
    model: contract.model,
    offline: true,
    provider_requests: 0,
    contract_sha256: createHash('sha256').update(JSON.stringify(contract)).digest('hex'),
    scope: 'contract-and-validator-only: the production binding is proven by the AST test in #1424, not here',
    prompt_sha256: createHash('sha256')
      .update(buildProofPrompt(contract, '{{fixture transcript}}', '{{fixture metrics}}'))
      .digest('hex'),
    fixtures: { accepted: null, refused: [] },
    success: false,
  };
  onProgress(evidence);

  const accepted = validateProviderBody(fixtureEnvelope(FIXTURE_VALID, contract.model), contract);
  evidence.fixtures.accepted = { valid: accepted.valid === true, reason: accepted.reason ?? null, word_counts: accepted.word_counts ?? null };

  for (const [label, suggestions] of FIXTURE_REFUSALS) {
    const result = validateProviderBody(fixtureEnvelope(suggestions, contract.model), contract);
    evidence.fixtures.refused.push({ fixture: label, refused: result.valid !== true, reason: result.reason ?? null });
  }
  // A response from another model must be refused too: the version check is what stops a silent
  // substitution from being read as our contract being honoured.
  const wrongModel = validateProviderBody(fixtureEnvelope(FIXTURE_VALID, 'gemini-other-model'), contract);
  evidence.fixtures.refused.push({ fixture: 'a response from a different model', refused: wrongModel.valid !== true, reason: wrongModel.reason ?? null });

  evidence.success = evidence.fixtures.accepted.valid === true
    && evidence.fixtures.refused.length > 0
    && evidence.fixtures.refused.every((entry) => entry.refused === true);
  onProgress(evidence);
  return evidence;
}

async function main() {
  const contractPath = resolve(process.env.GEMINI_CONTRACT_PATH ?? '');
  const outPath = resolve(process.env.PROOF_OUT ?? 'artifacts/gemini-model-currency-proof.json');
  let evidence = { target_sha: process.env.TARGET_SHA ?? null, success: false, phase: 'harness-started', error: null };
  const persist = (value) => {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(value, null, 2)}\n`);
  };
  persist(evidence);
  try {
    const contractText = readFileSync(contractPath, 'utf8');
    const contract = validateContract(JSON.parse(contractText));
    evidence = runProof({
      contract,
      targetSha: process.env.TARGET_SHA ?? '',
      onProgress: persist,
    });
  } catch (error) {
    evidence.error = error instanceof Error ? error.message : String(error);
  } finally {
    persist(evidence);
  }
  if (!evidence.success) {
    const refusalGap = evidence.fixtures?.refused?.filter((entry) => !entry.refused).map((entry) => entry.fixture).join('; ');
    console.error(`Contract conformance failed: ${evidence.error ?? evidence.fixtures?.accepted?.reason ?? refusalGap ?? 'unknown failure'}`);
    process.exitCode = 1;
  } else {
    console.log(`Contract conformance passed for ${evidence.target_sha}: contract ${evidence.contract_sha256.slice(0, 12)} validated, validator discriminates, ${evidence.provider_requests} provider requests.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
