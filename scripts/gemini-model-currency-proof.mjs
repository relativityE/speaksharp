#!/usr/bin/env node
/**
 * Trusted Gemini currency proof.
 *
 * OFFLINE contract-conformance harness (PO directive 5644238136). It runs from the repository default
 * branch, never checks out or executes candidate code, and makes NO network request of any kind: there
 * is no credential, no fetch, and no provider call anywhere in this module. The workflow supplies two
 * inert texts read from the target commit — the JSON contract and the production function's source —
 * and everything below is validation and static analysis of those.
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
 * Remove comments only. String and template contents are KEPT, because they are exactly what the checks
 * below read — an endpoint path, an import specifier. Comments go because a model name mentioned in a
 * comment is documentation, not a request, and #1424's file carries precisely such a comment.
 */
function withoutComments(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === '//') { const end = source.indexOf('\n', i); i = end === -1 ? source.length : end; continue; }
    if (two === '/*') { const end = source.indexOf('*/', i + 2); i = end === -1 ? source.length : end + 2; out += ' '; continue; }
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      // Copy the literal through verbatim, so a `//` inside a URL is not read as a comment.
      out += ch;
      i += 1;
      while (i < source.length && source[i] !== ch) {
        if (source[i] === '\\') { out += source.slice(i, i + 2); i += 2; continue; }
        out += source[i];
        i += 1;
      }
      if (i < source.length) { out += ch; i += 1; }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * The text of a call's arguments, from `(` to its matching `)`. Parens inside string and template
 * literals are skipped rather than counted, so a `)` in a message cannot end the scan early.
 */
function callArguments(text, callIndex) {
  let i = text.indexOf('(', callIndex);
  if (i === -1) return null;
  const start = i;
  let depth = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < text.length && text[i] !== quote) {
        i += text[i] === '\\' ? 2 : 1;
      }
      i += 1;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') { depth -= 1; if (depth === 0) return text.slice(start + 1, i); }
    i += 1;
  }
  return null;
}

/** One level of resolution: the initialiser of `const <name> = …`, or null. */
function declarationOf(structural, name) {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return null;
  const match = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*([^;]+);`).exec(structural);
  return match ? match[1] : null;
}

/**
 * #1434 Codex exact-head P1s `3995381720` and `3995449453` — PROVE THE CONTRACT REACHES THE ACTUAL
 * REQUEST, NOT MERELY THE FILE.
 *
 * The first version validated `contract.json` in isolation: a green result could sit beside a function
 * calling a hardcoded preview endpoint with an inline prompt, which is what `main` does today.
 *
 * The second version checked the source for contract-derived declarations — and Codex broke it with the
 * right counter-example: a file can DECLARE `GEMINI_API_URL`, `GEMINI_GENERATION_CONFIG` and a
 * contract-built prompt, satisfy every source-wide regex, and then call `fetch` with a separately
 * constructed model and an inline generation config. Decoy declarations, real divergent request.
 *
 * So the checks are anchored at the REQUEST SITE. The provider `fetch` is located in structural source
 * (comments and string contents removed, so prose cannot fool the scan), its arguments are read, and
 * each argument is resolved one level back to its declaration, which must come from the contract. A
 * decoy now fails, because the decoy is not what the request uses.
 *
 * Stated limit, because it is a real one: this is one-level resolution, not full data-flow analysis. It
 * defeats the divergence Codex demonstrated and any simple re-spelling of it; it is not a proof against
 * an adversary who reassigns a bound identifier later in the file, which is why the single-call rule
 * below matters — there is exactly one provider request, and it is the one checked.
 */
export function assertProductionUsesContract(source) {
  if (typeof source !== 'string' || source.trim() === '') {
    throw new Error('production function source is unavailable');
  }
  const structural = withoutComments(source);
  const failures = [];

  const contractImport = /import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]\.\/contract\.json['"]/.exec(structural);
  if (!contractImport) {
    throw new Error('production function does not use the proven contract: does not import ./contract.json');
  }
  const contract = contractImport[1];

  // The provider request: every `fetch(` whose arguments configure a generation.
  const calls = [];
  for (const match of structural.matchAll(/\bfetch\s*\(/g)) {
    const args = callArguments(structural, match.index);
    if (args && /generationConfig\s*:/.test(args)) calls.push(args);
  }
  if (calls.length !== 1) {
    failures.push(calls.length === 0
      ? 'no provider request configuring a generation was found'
      : `${calls.length} provider requests found; exactly one is required so the checked call is the call made`);
  }

  if (calls.length === 1) {
    const args = calls[0];
    const [urlArg] = args.split(',', 1);

    // 1. THE URL the request actually uses must resolve to the contract's model.
    const urlIdentifiers = urlArg.match(/[A-Za-z_$][\w$]*/g) ?? [];
    const urlSources = urlIdentifiers
      .map((name) => declarationOf(structural, name))
      .filter(Boolean)
      .concat(urlArg);
    if (!urlSources.some((text) => new RegExp(`models/\\$\\{\\s*${contract}\\.model\\s*\\}`).test(text))) {
      failures.push('the request URL does not resolve to the contract model');
    }
    if (urlSources.some((text) => /models\/gemini-[A-Za-z0-9.\-]+/.test(text))) {
      failures.push('the request URL resolves to a hardcoded model name');
    }

    // 2. THE GENERATION CONFIG the request actually sends must be the contract's.
    const configExpr = /generationConfig\s*:\s*([A-Za-z_$][\w$.]*)/.exec(args)?.[1] ?? '';
    const configSource = configExpr === `${contract}.generationConfig`
      ? configExpr
      : declarationOf(structural, configExpr) ?? '';
    if (!new RegExp(`${contract}\\.generationConfig\\b`).test(configSource)) {
      failures.push('the request generation config is not the contract generation config');
    }

    // 3. THE PROMPT the request actually sends must be built from the contract template.
    const textExpr = /text\s*:\s*([A-Za-z_$][\w$.]*)/.exec(args)?.[1] ?? '';
    const textDecl = declarationOf(structural, textExpr) ?? '';
    const builder = /^([A-Za-z_$][\w$]*)\s*\(/.exec(textDecl.trim())?.[1];
    const builderBody = builder
      // The builder's body, up to the first line-initial `}` at any indentation. Enough to see whether
      // the prompt it returns comes from the contract template; not a parser, and not claimed to be.
      ? new RegExp(`function\\s+${builder}\\s*\\([^]*?\\n\\s*\\}`).exec(structural)?.[0] ?? declarationOf(structural, builder) ?? ''
      : '';
    if (!new RegExp(`${contract}\\.promptTemplate\\b`).test(`${textDecl}${builderBody}`)) {
      failures.push('the request prompt is not built from the contract template');
    }
  }

  // These are not request arguments, so they stay source-wide: they govern what production accepts and
  // how often it may generate, both enforced away from the call.
  if (!new RegExp(`${contract}\\.wordBudget\\b`).test(structural)) {
    failures.push('word budget is not taken from the contract');
  }
  if (!new RegExp(`${contract}\\.uncachedGenerationCapPerUtcDay\\b`).test(structural)) {
    failures.push('daily generation cap is not taken from the contract');
  }

  if (failures.length) {
    throw new Error(`production function does not use the proven contract: ${failures.join('; ')}`);
  }
  return true;
}

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
 * What it still proves, and this is the part that was missing before:
 *
 *   1. the candidate's contract is exactly the locked product contract (`validateContract`);
 *   2. the candidate's PRODUCTION function derives its model, generation config, prompt, word budget
 *      and daily cap from that same contract (`assertProductionUsesContract`) — read as inert text;
 *   3. the validator those two agree on actually discriminates: it accepts a conforming response and
 *      refuses each fixture that breaks one rule.
 *
 * What it deliberately does NOT prove is that Google's endpoint is currently serving the model. That
 * is a live question, and it is answered where it actually matters — by Production generating
 * suggestions after a completed session, which remains automatic and unchanged.
 */
export function runProof({ contract, productionSource, targetSha, onProgress = () => {} }) {
  validateContract(contract);
  assertProductionUsesContract(productionSource);
  if (!/^[0-9a-f]{40}$/i.test(targetSha)) throw new Error('target SHA must be a full 40-character commit');

  const evidence = {
    target_sha: targetSha,
    model: contract.model,
    offline: true,
    provider_requests: 0,
    contract_sha256: createHash('sha256').update(JSON.stringify(contract)).digest('hex'),
    production_source_sha256: createHash('sha256').update(productionSource).digest('hex'),
    production_uses_contract: true,
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
    // The candidate's production function, read as INERT TEXT from the target commit. Never imported,
    // never executed — only pattern-checked, so a hostile candidate cannot run code in this harness.
    const productionSource = readFileSync(resolve(process.env.GEMINI_FUNCTION_SOURCE_PATH ?? ''), 'utf8');
    evidence = runProof({
      contract,
      productionSource,
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
    console.log(`Contract conformance passed for ${evidence.target_sha}: production binds contract ${evidence.contract_sha256.slice(0, 12)}, ${evidence.provider_requests} provider requests.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
