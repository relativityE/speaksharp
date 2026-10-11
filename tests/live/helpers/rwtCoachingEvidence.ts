import fixtureManifest from '../../fixtures/rwt/rwt-fixtures.manifest.json';

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

const exactPair = (value: unknown): value is CoachingPair => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return JSON.stringify(Object.keys(item).sort()) === JSON.stringify(['version', 'what_to_try_next', 'what_worked'])
    && (item.version === 'gemini_coaching_v1' || item.version === 'gemini_coaching_focus_v1')
    && typeof item.what_worked === 'string' && item.what_worked.trim().length > 0
    && typeof item.what_to_try_next === 'string' && item.what_to_try_next.trim().length > 0;
};

function validateTake(take: RwtCoachingTakeEvidence, releaseSha: string, label: string): void {
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
    || !Number.isInteger(take.providerAttempts) || take.providerAttempts < 1 || take.providerAttempts > 2
    || take.retryCount !== take.providerAttempts - 1
    || !MODEL_ID.test(take.configuredModel) || !Number.isFinite(take.providerDurationMs) || take.providerDurationMs < 0
    || !Number.isFinite(take.totalDurationMs) || take.totalDurationMs < take.providerDurationMs
    || !SHA64.test(take.promptSha256)) throw new Error(`${label}: model or timing evidence is incomplete`);

  const receipt = take.authorityReceipt;
  if (receipt.session_id !== take.sessionId || receipt.user_id !== take.userId
    || receipt.provider !== 'google_gemini' || receipt.provider_request_made !== true
    || !MODEL_ID.test(receipt.model) || !SHA64.test(receipt.receipt_suggestion_sha256)
    || receipt.current_suggestion_sha256 !== receipt.receipt_suggestion_sha256 || !exactPair(receipt.ai_suggestions)) {
    throw new Error(`${label}: server authority receipt does not prove this saved provider result`);
  }
  if (take.source === 'fresh' && receipt.cache_read_count && receipt.cache_read_count > 0) {
    throw new Error(`${label}: fresh generation conflicts with cache-read evidence`);
  }
  if (take.source === 'cache' && (!Number.isInteger(receipt.cache_read_count) || Number(receipt.cache_read_count) < 1)) {
    throw new Error(`${label}: cache replay lacks a server-recorded cache read`);
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
export function buildRwtCoachingEvidenceArtifact(input: RwtCoachingEvidenceInput) {
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
    firstTake: input.firstTake,
    repeatTake: input.repeatTake,
  };
}
