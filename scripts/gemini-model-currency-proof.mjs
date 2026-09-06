#!/usr/bin/env node
/**
 * Trusted Gemini currency proof.
 *
 * This file must run from the repository default branch. Candidate PR code is never checked out or
 * executed: the workflow supplies only a JSON contract read from the target commit. The provider key is
 * sent only to Google's fixed API host and is never written to evidence.
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
const MAX_PROVIDER_REQUESTS = 10;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

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

export async function runProof({
  contract,
  targetSha,
  sampleCount,
  apiKey,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
  spacingMs = 8000,
  requestTimeoutMs = 30_000,
  onProgress = () => {},
}) {
  validateContract(contract);
  if (!/^[0-9a-f]{40}$/i.test(targetSha)) throw new Error('target SHA must be a full 40-character commit');
  if (![1, 10].includes(sampleCount)) throw new Error('sample count must be 1 or 10');
  if (!apiKey) throw new Error('GEMINI_API_KEY is unavailable');

  const fabricatedTranscript = 'Good morning. Our Friday review attendance is low, so I propose moving the meeting to Tuesday.';
  const fabricatedMetrics = 'Metrics:\n- Words Per Minute (WPM): 132\n- Clarity Score: 88%\n- Total Words: 16\n- Duration: 8 seconds';
  const prompt = buildProofPrompt(contract, fabricatedTranscript, fabricatedMetrics);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(contract.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const evidence = {
    target_sha: targetSha,
    model: contract.model,
    contract_sha256: createHash('sha256').update(JSON.stringify(contract)).digest('hex'),
    fabricated_transcript: fabricatedTranscript,
    requested_samples: sampleCount,
    max_provider_requests: MAX_PROVIDER_REQUESTS,
    provider_requests: 0,
    samples: [],
  };
  onProgress(evidence);

  const attemptsPerSample = sampleCount === 1 ? 4 : 1;
  for (let sample = 1; sample <= sampleCount; sample += 1) {
    if (sample > 1) await sleep(spacingMs);
    const row = { sample, attempts: [], valid: false, reason: null };
    for (let attempt = 1; attempt <= attemptsPerSample; attempt += 1) {
      if (evidence.provider_requests >= MAX_PROVIDER_REQUESTS) {
        row.reason = 'provider-request budget exhausted';
        break;
      }
      evidence.provider_requests += 1;
      const started = Date.now();
      let response;
      let bodyText = '';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error(`provider request exceeded ${requestTimeoutMs}ms`)), requestTimeoutMs);
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: contract.generationConfig }),
          signal: controller.signal,
        });
        bodyText = await response.text();
      } catch (error) {
        row.attempts.push({ attempt, http_status: null, elapsed_ms: Date.now() - started, error: String(error) });
        row.reason = controller.signal.aborted ? 'provider request timed out' : 'provider request threw';
        onProgress(evidence);
        break;
      } finally {
        clearTimeout(timeout);
      }
      row.attempts.push({ attempt, http_status: response.status, elapsed_ms: Date.now() - started, raw_response: bodyText });
      onProgress(evidence);
      if (!response.ok) {
        row.reason = `provider HTTP ${response.status}`;
        if (attempt < attemptsPerSample && RETRYABLE.has(response.status)) {
          await sleep(5000 * 2 ** (attempt - 1));
          continue;
        }
        break;
      }
      const validation = validateProviderBody(bodyText, contract);
      Object.assign(row, validation);
      break;
    }
    evidence.samples.push(row);
    onProgress(evidence);
  }
  evidence.success = evidence.samples.length === sampleCount && evidence.samples.every((sample) => sample.valid === true);
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
    evidence = await runProof({
      contract,
      targetSha: process.env.TARGET_SHA ?? '',
      sampleCount: Number(process.env.SAMPLE_N ?? '1'),
      apiKey: process.env.GEMINI_API_KEY,
      onProgress: persist,
    });
  } catch (error) {
    evidence.error = error instanceof Error ? error.message : String(error);
  } finally {
    persist(evidence);
  }
  if (!evidence.success) {
    console.error(`Gemini proof failed: ${evidence.error ?? evidence.samples?.filter((sample) => !sample.valid).map((sample) => sample.reason).join('; ') ?? 'unknown failure'}`);
    process.exitCode = 1;
  } else {
    console.log(`Gemini proof passed for ${evidence.target_sha}: ${evidence.provider_requests} provider request(s), ${evidence.samples.length} valid sample(s).`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
