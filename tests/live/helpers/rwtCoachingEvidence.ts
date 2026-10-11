import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, parse, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import fixtureManifest from '../../fixtures/rwt/rwt-fixtures.manifest.json';

/**
 * The pinned active coaching contract, read at RUNTIME rather than imported: a TS module import would pull the Deno Edge
 * tree (`backend/supabase/functions/`) into the live typecheck, which `scripts/verify-live-typecheck-scope.mjs` forbids.
 * Same file, same value — the configured-model check below is unchanged.
 */
const coachingContract = JSON.parse(readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../backend/supabase/functions/get-ai-suggestions/contract.json'), 'utf8',
)) as { model: string };

const SHA40 = /^[0-9a-f]{40}$/i;
const SHA64 = /^[0-9a-f]{64}$/i;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODEL_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const FIXTURES = fixtureManifest.fixtures as Record<string, { sha256: string; kind: string }>;

export interface CoachingPair {
  version: 'gemini_coaching_v1' | 'gemini_coaching_focus_v1';
  what_worked: string;
  what_to_try_next: string;
}

export interface CoachingAuthorityReceipt {
  session_id: string;
  user_id: string;
  provider: string;
  model: string;
  provider_request_made: boolean;
  receipt_suggestion_sha256: string;
  current_suggestion_sha256: string;
  ai_suggestions: CoachingPair;
  cache_read_count?: number;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface RwtCoachingTakeEvidence {
  runId: string;
  suiteId: string;
  product: 'open_mic' | 'focus_points';
  fixtureName: string;
  fixtureSha256: string;
  sessionId: string;
  userId: string;
  runOwnedBinding: {
    verified: true;
    runId: string;
    sessionId: string;
    userId: string;
    fixtureSha256: string;
  };
  transcript: string;
  metrics: Record<string, JsonValue>;
  /** Exact authenticated database readback used for the generation; a browser-supplied copy cannot substitute. */
  savedInputReadback: {
    sessionId: string;
    userId: string;
    product: 'open_mic' | 'focus_points';
    transcript: string;
    metrics: Record<string, JsonValue>;
  };
  configuredModel: string;
  diagnosticRequestId: string;
  diagnosticAttemptId: string;
  diagnosticStatus: number;
  diagnosticOutcome: 'success';
  diagnosticReason: 'none';
  providerAttempts: number;
  retryCount: number;
  source: 'fresh' | 'cache';
  providerDurationMs: number;
  totalDurationMs: number;
  promptSha256: string;
  authorityReceipt: CoachingAuthorityReceipt;
  renderedSuggestions: CoachingPair;
}

export interface RwtCoachingEvidenceInput {
  releaseSha: string;
  firstTake: RwtCoachingTakeEvidence;
  repeatTake: RwtCoachingTakeEvidence;
}

const TAKE_KEYS = [
  'runId', 'suiteId', 'product', 'fixtureName', 'fixtureSha256', 'sessionId', 'userId', 'runOwnedBinding',
  'transcript', 'metrics', 'savedInputReadback', 'configuredModel', 'diagnosticRequestId', 'diagnosticAttemptId',
  'diagnosticStatus', 'diagnosticOutcome', 'diagnosticReason', 'providerAttempts', 'retryCount', 'source',
  'providerDurationMs', 'totalDurationMs', 'promptSha256', 'authorityReceipt', 'renderedSuggestions',
];
const PROMPT_BINDING_HOLD = Object.freeze({
  verdict: 'HOLD' as const,
  reason: 'prompt_digest_not_recomputed_from_server_authoritative_inputs' as const,
});

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: expected an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: unknown, required: readonly string[], optional: readonly string[], label: string): Record<string, unknown> {
  const item = record(value, label);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(item)) if (!allowed.has(key)) throw new Error(`${label}: unexpected field ${key}`);
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(item, key)) throw new Error(`${label}: missing field ${key}`);
  return item;
}

function jsonbText(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jsonbText).join(', ')}]`;
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    const keys = Object.keys(item).sort((left, right) => {
      const leftBytes = Buffer.from(left, 'utf8');
      const rightBytes = Buffer.from(right, 'utf8');
      return leftBytes.length - rightBytes.length || Buffer.compare(leftBytes, rightBytes);
    });
    return `{${keys.map((key) => `${JSON.stringify(key)}: ${jsonbText(item[key])}`).join(', ')}}`;
  }
  throw new Error('suggestion pair contains a non-JSON value');
}

/** Matches PostgreSQL `jsonb::text` for the exact string-only suggestion object stored by the authority RPC. */
export function canonicalSuggestionSha256(value: unknown): string {
  if (!exactPair(value)) throw new Error('suggestion pair is invalid');
  return createHash('sha256').update(jsonbText(value), 'utf8').digest('hex');
}

const exactPair = (value: unknown): value is CoachingPair => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return JSON.stringify(Object.keys(item).sort()) === JSON.stringify(['version', 'what_to_try_next', 'what_worked'])
    && (item.version === 'gemini_coaching_v1' || item.version === 'gemini_coaching_focus_v1')
    && typeof item.what_worked === 'string' && item.what_worked.trim().length > 0
    && typeof item.what_to_try_next === 'string' && item.what_to_try_next.trim().length > 0;
};

function validateTake(take: RwtCoachingTakeEvidence, releaseSha: string, label: string): void {
  if (take.product !== 'open_mic' && take.product !== 'focus_points') throw new Error(`${label}: product is invalid`);
  if (take.source !== 'fresh' && take.source !== 'cache') throw new Error(`${label}: source is invalid`);
  exactKeys(take.runOwnedBinding, ['verified', 'runId', 'sessionId', 'userId', 'fixtureSha256'], [], `${label}.runOwnedBinding`);
  exactKeys(take.savedInputReadback, ['sessionId', 'userId', 'product', 'transcript', 'metrics'], [], `${label}.savedInputReadback`);
  exactKeys(take.authorityReceipt,
    ['session_id', 'user_id', 'provider', 'model', 'provider_request_made', 'receipt_suggestion_sha256', 'current_suggestion_sha256', 'ai_suggestions'],
    ['cache_read_count'], `${label}.authorityReceipt`);
  const fixture = FIXTURES[take.fixtureName];
  if (!fixture || fixture.kind !== 'synthetic' || fixture.sha256 !== take.fixtureSha256) {
    throw new Error(`${label}: fixture identity/hash is not a pinned synthetic fixture`);
  }
  if (!UUID_V4.test(take.sessionId) || !UUID_V4.test(take.userId)) throw new Error(`${label}: run-owned identity is invalid`);
  if (!take.runId.trim() || !take.suiteId.trim()) throw new Error(`${label}: run and suite identity are required`);
  if (take.runOwnedBinding.verified !== true || take.runOwnedBinding.runId !== take.runId
    || take.runOwnedBinding.sessionId !== take.sessionId || take.runOwnedBinding.userId !== take.userId
    || take.runOwnedBinding.fixtureSha256 !== take.fixtureSha256) {
    throw new Error(`${label}: session/account is not bound to this run and fixture`);
  }
  if (take.product === 'open_mic' && !take.fixtureName.startsWith('open_mic_')) throw new Error(`${label}: Open Mic fixture/product mismatch`);
  if (take.product === 'focus_points' && !take.fixtureName.startsWith('focus_points_')) throw new Error(`${label}: Focus fixture/product mismatch`);
  if (!take.transcript.trim() || !take.metrics || typeof take.metrics !== 'object' || Array.isArray(take.metrics)) {
    throw new Error(`${label}: exact synthetic input transcript and metrics are required`);
  }
  if (take.savedInputReadback.sessionId !== take.sessionId || take.savedInputReadback.userId !== take.userId
    || take.savedInputReadback.product !== take.product || take.savedInputReadback.transcript !== take.transcript
    || JSON.stringify(take.savedInputReadback.metrics) !== JSON.stringify(take.metrics)) {
    throw new Error(`${label}: synthetic request input differs from authenticated saved-session readback`);
  }
  if (!UUID_V4.test(take.diagnosticRequestId) || !UUID_V4.test(take.diagnosticAttemptId)
    || take.diagnosticStatus !== 200 || take.diagnosticOutcome !== 'success' || take.diagnosticReason !== 'none'
    || !Number.isInteger(take.providerAttempts) || take.providerAttempts < 0 || take.providerAttempts > 2
    || !Number.isInteger(take.retryCount) || take.retryCount < 0 || take.retryCount > 1
    || !MODEL_ID.test(take.configuredModel) || take.configuredModel !== coachingContract.model
    || !Number.isFinite(take.providerDurationMs) || take.providerDurationMs < 0
    || !Number.isFinite(take.totalDurationMs) || take.totalDurationMs < take.providerDurationMs
    || !SHA64.test(take.promptSha256)) {
    if (take.configuredModel !== coachingContract.model) throw new Error(`${label}: configured model does not match the active coaching contract`);
    throw new Error(`${label}: model or timing evidence is incomplete`);
  }

  const receipt = take.authorityReceipt;
  const computedSuggestionSha256 = canonicalSuggestionSha256(receipt.ai_suggestions);
  if (receipt.session_id !== take.sessionId || receipt.user_id !== take.userId
    || receipt.provider !== 'google_gemini' || receipt.provider_request_made !== true
    || !MODEL_ID.test(receipt.model) || !SHA64.test(receipt.receipt_suggestion_sha256)
    || !SHA64.test(receipt.current_suggestion_sha256)
    || receipt.current_suggestion_sha256 !== receipt.receipt_suggestion_sha256) {
    throw new Error(`${label}: server authority receipt does not prove this saved provider result`);
  }
  if (computedSuggestionSha256 !== receipt.receipt_suggestion_sha256) {
    throw new Error(`${label}: canonical suggestion digest does not match the server authority receipt`);
  }
  if (take.source === 'fresh' && receipt.cache_read_count && receipt.cache_read_count > 0) {
    throw new Error(`${label}: fresh generation conflicts with cache-read evidence`);
  }
  if (take.source === 'fresh' && (take.providerAttempts < 1 || take.retryCount !== take.providerAttempts - 1)) {
    throw new Error(`${label}: fresh generation lacks matching provider attempt/retry evidence`);
  }
  if (take.source === 'cache' && (!Number.isInteger(receipt.cache_read_count) || Number(receipt.cache_read_count) < 1)) {
    throw new Error(`${label}: cache replay lacks a server-recorded cache read`);
  }
  if (take.source === 'cache' && (take.providerAttempts !== 0 || take.retryCount !== 0 || take.providerDurationMs !== 0)) {
    throw new Error(`${label}: cache replay must not claim a provider attempt or provider latency`);
  }
  if (!exactPair(take.renderedSuggestions)
    || take.renderedSuggestions.version !== receipt.ai_suggestions.version
    || take.renderedSuggestions.what_worked !== receipt.ai_suggestions.what_worked
    || take.renderedSuggestions.what_to_try_next !== receipt.ai_suggestions.what_to_try_next) {
    throw new Error(`${label}: rendered suggestions differ from the server-authorized saved pair`);
  }
  if (take.product === 'open_mic' && receipt.ai_suggestions.version !== 'gemini_coaching_v1') {
    throw new Error(`${label}: stored coaching version does not match Open Mic`);
  }
  if (take.product === 'focus_points' && receipt.ai_suggestions.version !== 'gemini_coaching_focus_v1') {
    throw new Error(`${label}: stored coaching version does not match Focus Points`);
  }
  if (!SHA40.test(releaseSha)) throw new Error('release SHA is invalid');
}

/**
 * Build a restricted artifact for synthetic-only coaching verification. The returned value contains
 * exact synthetic transcript/metrics and the exact saved/rendered phrases; callers must write it only
 * to the access-restricted evidence destination, never to logs, PostHog or the public RWT receipt.
 */
export function buildRwtCoachingEvidenceArtifact(rawInput: RwtCoachingEvidenceInput) {
  const input = exactKeys(rawInput, ['releaseSha', 'firstTake', 'repeatTake'], [], 'evidence input') as unknown as RwtCoachingEvidenceInput;
  exactKeys(input.firstTake, TAKE_KEYS, [], 'firstTake');
  exactKeys(input.repeatTake, TAKE_KEYS, [], 'repeatTake');
  validateTake(input.firstTake, input.releaseSha, 'firstTake');
  validateTake(input.repeatTake, input.releaseSha, 'repeatTake');
  if (input.firstTake.runId !== input.repeatTake.runId || input.firstTake.suiteId !== input.repeatTake.suiteId
    || input.firstTake.product !== input.repeatTake.product || input.firstTake.fixtureName !== input.repeatTake.fixtureName
    || input.firstTake.sessionId === input.repeatTake.sessionId) {
    throw new Error('first and repeat take identities are inconsistent or reuse a session');
  }
  return {
    schemaVersion: 'rwt_coaching_evidence_v1' as const,
    visibility: 'restricted_synthetic' as const,
    releaseSha: input.releaseSha,
    suiteId: input.firstTake.suiteId,
    product: input.firstTake.product,
    fixture: { name: input.firstTake.fixtureName, sha256: input.firstTake.fixtureSha256 },
    firstTake: { ...input.firstTake, promptBinding: PROMPT_BINDING_HOLD },
    repeatTake: { ...input.repeatTake, promptBinding: PROMPT_BINDING_HOLD },
  };
}

function assertSafeEvidenceDirectory(directory: string): void {
  const absolute = resolve(directory);
  const root = parse(absolute).root;
  const parts = absolute.slice(root.length).split(sep).filter(Boolean);
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = resolve(current, parts[index]);
    let metadata;
    try { metadata = lstatSync(current); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
    }
    if (metadata.isSymbolicLink()) throw new Error(`restricted evidence path contains a symlink: ${current}`);
    const isDestination = index === parts.length - 1;
    if (!isDestination && (metadata.mode & 0o022) !== 0) {
      const stickySystemTemp = (metadata.mode & 0o1000) !== 0 && metadata.uid === 0;
      if (!stickySystemTemp) throw new Error(`restricted evidence path has an unsafe writable ancestor: ${current}`);
    }
    if (isDestination) {
      if (!metadata.isDirectory()) throw new Error('restricted evidence destination is not a directory');
      if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) {
        throw new Error('restricted evidence directory must be owned by the current user');
      }
    }
  }
}

/** Write a private artifact once. The caller must explicitly configure a restricted directory. */
export function writeRwtCoachingEvidenceArtifact(input: RwtCoachingEvidenceInput, privateDirectory: string) {
  if (!privateDirectory.trim()) throw new Error('a restricted private evidence directory is required');
  const artifact = buildRwtCoachingEvidenceArtifact(input);
  const directory = resolve(privateDirectory);
  assertSafeEvidenceDirectory(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  assertSafeEvidenceDirectory(directory);
  const directoryMode = lstatSync(directory).mode & 0o777;
  if ((directoryMode & 0o077) !== 0) throw new Error('restricted evidence directory must not grant group or other access');
  const safeRunId = input.firstTake.runId.replace(/[^A-Za-z0-9._-]/g, '_');
  if (!safeRunId || safeRunId !== input.firstTake.runId) throw new Error('run id is not safe for a private artifact filename');
  const file = resolve(directory, `rwt-coaching-${input.releaseSha}-${safeRunId}.json`);
  const bytes = `${JSON.stringify(artifact, null, 2)}\n`;
  try {
    writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('private coaching artifact already exists; refusing overwrite');
    throw error;
  }
  return { file, sha256: createHash('sha256').update(bytes).digest('hex'), mode: statSync(file).mode & 0o777 };
}
