import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, parse, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The pinned active coaching contract, read at RUNTIME rather than imported: a TS module import would pull the Deno Edge
 * tree (`backend/supabase/functions/`) into the live typecheck, which `scripts/verify-live-typecheck-scope.mjs` forbids.
 * Same file, same value — the configured-model check below is unchanged.
 */
/**
 * #1258 option A (Codex r4290615974, PM 6207410484) — the Edge function's OWN attempt ceiling, read from its source so
 * the evidence bound and the server policy cannot drift. Fails closed if the constant cannot be read.
 */
export const EDGE_MAX_PROVIDER_ATTEMPTS = (() => {
  const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),
    '../../../backend/supabase/functions/get-ai-suggestions/providerRetry.ts'), 'utf8');
  const n = Number(/export const MAX_PROVIDER_ATTEMPTS = (\d+);/.exec(src)?.[1]);
  if (!Number.isInteger(n) || n < 1) throw new Error('rwtCoachingEvidence: the Edge MAX_PROVIDER_ATTEMPTS could not be read');
  return n;
})();

/**
 * #1474 (Sam 6242612760) — the Edge function's OWN total provider budget for one coaching request, read from its source
 * like the attempt ceiling above. Waiting for every sent coaching exchange is bounded by this budget plus a fixed
 * transport/body allowance, so a never-answered request ends the wait instead of holding the receipt. Fails closed.
 */
export const EDGE_PROVIDER_BUDGET_MS = (() => {
  const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),
    '../../../backend/supabase/functions/get-ai-suggestions/providerRetry.ts'), 'utf8');
  const n = Number(/export const PROVIDER_BUDGET_MS = ([\d_]+);/.exec(src)?.[1]?.replace(/_/g, ''));
  if (!Number.isInteger(n) || n < 1) throw new Error('rwtCoachingEvidence: the Edge PROVIDER_BUDGET_MS could not be read');
  return n;
})();
/** The bound for settling every sent coaching exchange: the Edge budget plus 15 s for transport and the response body. */
export const COACHING_SETTLE_BOUND_MS = EDGE_PROVIDER_BUDGET_MS + 15_000;

export const coachingContract = JSON.parse(readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../backend/supabase/functions/get-ai-suggestions/contract.json'), 'utf8',
)) as { model: string; promptTemplate: string };

const SHA40 = /^[0-9a-f]{40}$/i;
const SHA64 = /^[0-9a-f]{64}$/i;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODEL_ID = /^[A-Za-z0-9._:-]{1,128}$/;
/**
 * #1258 alpha run 38288222695: read at RUNTIME, never as an ESM JSON import. The repo is `"type": "module"`, so
 * Playwright on Node 22 refuses a bare `.json` import ("needs an import attribute of type: json") and every spec that
 * reaches this helper fails to load. Vitest accepts the import, so unit CI never saw it. Same pattern as rwtJourney.ts.
 */
const FIXTURES = (JSON.parse(readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/rwt/rwt-fixtures.manifest.json'), 'utf8',
)) as { fixtures: Record<string, { sha256: string; kind: string }> }).fixtures;

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

interface PromptPointReadback {
  label: string;
  verdict: 'detected' | 'not_detected' | 'unavailable';
  detectedAtSeconds: number | null;
}

interface PromptContextReadback {
  transcriptState: 'available' | string;
  focusContext:
    | { kind: 'none' }
    | { kind: 'focus'; topic: string | null; points: PromptPointReadback[] }
    | { kind: 'pending' | 'error' };
}

interface PromptGenerationReceipt {
  request: {
    sessionId: string;
    product: 'open_mic' | 'focus_points';
    requestId: string;
    attemptId: string;
    clientAttempt: number;
    clientReleaseId: string;
  };
  response: {
    request_id: string;
    attempt_id: string;
    client_attempt: number | null;
    status: number;
    outcome: string;
    reason: string;
    provider: string;
    configured_model: string;
    observed_model: string | null;
    source: string;
    provider_attempts: number;
    retry_count: number;
    prompt_sha256: string | null;
    product: string;
    has_session: boolean;
    client_release_id: string | null;
    session_binding_sha256: string | null;
  };
}

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
    promptContext?: PromptContextReadback;
  };
  configuredModel: string;
  diagnosticRequestId: string;
  diagnosticAttemptId: string;
  diagnosticClientAttempt: number;
  diagnosticStatus: number;
  diagnosticOutcome: 'success';
  diagnosticReason: 'none';
  providerAttempts: number;
  retryCount: number;
  source: 'fresh' | 'cache';
  providerDurationMs: number;
  totalDurationMs: number;
  promptSha256: string | null;
  promptGenerationReceipt?: PromptGenerationReceipt;
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
  'transcript', 'metrics', 'savedInputReadback', 'configuredModel', 'diagnosticRequestId', 'diagnosticAttemptId', 'diagnosticClientAttempt',
  'diagnosticStatus', 'diagnosticOutcome', 'diagnosticReason', 'providerAttempts', 'retryCount', 'source',
  'providerDurationMs', 'totalDurationMs', 'promptSha256', 'authorityReceipt', 'renderedSuggestions',
];

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

const PROMPT_INPUT_MAX_CHARS = 8000;
const PROMPT_FOCUS_LABEL_MAX_CHARS = 200;

/** Recompute the Edge's response-only selected-session binding from the authenticated DB readback identity. */
export function coachingSessionBindingSha256(userId: string, sessionId: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ user_id: userId, session_id: sessionId }), 'utf8')
    .digest('hex');
}

function promptContextIsComplete(value: unknown): value is PromptContextReadback {
  try {
    const context = exactKeys(value,
      ['transcriptState', 'focusContext'], [], 'promptContext');
    if (context.transcriptState !== 'available') return false;
    exactKeys(context.focusContext,
      context.focusContext && typeof context.focusContext === 'object'
        && (context.focusContext as Record<string, unknown>).kind === 'focus'
        ? ['kind', 'topic', 'points'] : ['kind'], [], 'promptContext.focusContext');
    const focus = context.focusContext as Record<string, unknown>;
    if (focus.kind === 'none') return true;
    if (focus.kind !== 'focus' || (focus.topic !== null && typeof focus.topic !== 'string') || !Array.isArray(focus.points)) return false;
    for (const point of focus.points) {
      const item = exactKeys(point, ['label', 'verdict', 'detectedAtSeconds'], [], 'promptContext.focusContext.point');
      if (typeof item.label !== 'string'
        || !['detected', 'not_detected', 'unavailable'].includes(String(item.verdict))
        || (item.detectedAtSeconds !== null && (typeof item.detectedAtSeconds !== 'number' || !Number.isFinite(item.detectedAtSeconds)))) return false;
    }
    return focus.points.length > 0;
  } catch {
    return false;
  }
}

function promptQuoteLabel(value: string): string {
  return `"${value.replace(/[\r\n"]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, PROMPT_FOCUS_LABEL_MAX_CHARS)}"`;
}

function promptClockText(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

/** Independently reconstruct the exact Edge prompt from a run-owned saved-row and saved-Focus readback. */
export function recomputeCoachingPromptSha256(
  readback: RwtCoachingTakeEvidence['savedInputReadback'],
): string | null {
  const raw = readback as RwtCoachingTakeEvidence['savedInputReadback'] & Record<string, unknown>;
  if (!promptContextIsComplete(raw.promptContext)) return null;
  const context = raw.promptContext;
  if ((readback.product === 'open_mic' && context.focusContext.kind !== 'none')
    || (readback.product === 'focus_points' && context.focusContext.kind !== 'focus')) return null;

  const transcript = readback.transcript.length > PROMPT_INPUT_MAX_CHARS
    ? `${readback.transcript.slice(0, PROMPT_INPUT_MAX_CHARS)}\n\n[Transcript truncated for coaching request length.]`
    : readback.transcript;
  const metrics = readback.metrics as Record<string, JsonValue>;
  if (!['wpm', 'filler_counts', 'filler_words', 'next_action_signal'].every((key) => Object.prototype.hasOwnProperty.call(metrics, key))) return null;
  if (metrics.wpm !== null && (typeof metrics.wpm !== 'number' || !Number.isFinite(metrics.wpm))) return null;
  const fillerEvidence = metrics.filler_counts ?? metrics.filler_words;
  const fillers = `- Filler Words: ${fillerEvidence == null ? 'N/A' : JSON.stringify(fillerEvidence)}`;
  const pace = `- Words Per Minute (WPM): ${metrics.wpm ?? 'N/A'}`;
  let metricsText: string;
  let focusText = '';
  if (context.focusContext.kind !== 'focus') {
    metricsText = `\n      Delivery signals:\n      ${pace}\n      ${fillers}\n    `;
  } else {
    const metric = metrics.next_action_signal && typeof metrics.next_action_signal === 'object'
      && !Array.isArray(metrics.next_action_signal)
      ? (metrics.next_action_signal as Record<string, JsonValue>).metric : undefined;
    const chosen = metric === 'filler_rate' ? fillers : metric === 'wpm' ? pace : null;
    metricsText = chosen
      ? `\n      Delivery signal (the one most actionable for this take):\n      ${chosen}\n    `
      : '\n      Delivery signals: none material for this take - coach from the Focus Points results.\n    ';
    const lines = context.focusContext.points.map((point, index) => {
      const result = point.verdict === 'detected'
        ? `detected${point.detectedAtSeconds !== null ? ` at ${promptClockText(point.detectedAtSeconds)}` : ''}`
        : point.verdict === 'not_detected'
          ? 'not detected by the keyword matcher (the speaker may have covered it in other words)'
          : 'not checked';
      return `      ${index + 1}. ${promptQuoteLabel(point.label)}: ${result}`;
    });
    const allDetected = context.focusContext.points.every((point) => point.verdict === 'detected');
    focusText = `\n      Focus Points session. The speaker chose these points to cover, in this order${context.focusContext.topic ? `, for the topic ${promptQuoteLabel(context.focusContext.topic)}` : ''}. A keyword matcher checked the transcript for each:\n${lines.join('\n')}\n\n      Focus Points coaching rules:\n      - Both phrases must help the speaker cover THESE chosen points in the next run: which point to open, introduce or signpost, where it belongs, or pacing between points, when this transcript and these results support it.\n      - "Not detected" is only what the matcher found. Never say a point was missed, skipped or not mentioned; suggest how to make it unmistakable instead.\n${allDetected ? '      - Every point was detected. Do not suggest covering a point as if it were missing; coach placement, transitions or pace between points.\n' : ''}`;
  }
  const fullMetricsText = `${metricsText}${focusText}`;
  const prompt = coachingContract.promptTemplate.replace(
    /\{\{(TRANSCRIPT|METRICS)\}\}/g,
    (_marker, name: string) => name === 'TRANSCRIPT' ? transcript : fullMetricsText,
  );
  return createHash('sha256').update(prompt, 'utf8').digest('hex');
}

function evaluatePromptBinding(take: RwtCoachingTakeEvidence, releaseSha: string) {
  const hold = (reason: string) => ({ verdict: 'HOLD' as const, reason });
  const proof = take.promptGenerationReceipt;
  const computed = recomputeCoachingPromptSha256(take.savedInputReadback);
  if (!proof || computed === null) return hold('authoritative_prompt_inputs_or_generation_receipt_unavailable');
  let request: Record<string, unknown>;
  let response: Record<string, unknown>;
  try {
    request = exactKeys(proof.request,
      ['sessionId', 'product', 'requestId', 'attemptId', 'clientAttempt', 'clientReleaseId'], [], 'promptGenerationReceipt.request');
    response = exactKeys(proof.response,
      ['request_id', 'attempt_id', 'client_attempt', 'status', 'outcome', 'reason', 'provider', 'configured_model',
        'observed_model', 'source', 'provider_attempts', 'retry_count', 'prompt_sha256', 'product', 'has_session',
        'client_release_id', 'session_binding_sha256'], [], 'promptGenerationReceipt.response');
  } catch {
    return hold('generation_receipt_shape_unavailable');
  }
  const expectedSessionBinding = coachingSessionBindingSha256(take.savedInputReadback.userId, take.savedInputReadback.sessionId);
  const requestMatches = request.sessionId === take.savedInputReadback.sessionId
    && request.product === take.savedInputReadback.product
    && request.requestId === response.request_id && request.attemptId === response.attempt_id
    && request.clientAttempt === response.client_attempt && request.clientReleaseId === releaseSha
    && (take.source !== 'fresh'
      || (take.diagnosticRequestId === request.requestId
        && take.diagnosticAttemptId === request.attemptId
        && take.diagnosticClientAttempt === request.clientAttempt));
  const responseMatches = response.status === 200 && response.outcome === 'success' && response.reason === 'none'
    && response.provider === 'google_gemini' && response.source === 'fresh' && response.has_session === true
    && response.product === take.savedInputReadback.product && response.client_release_id === releaseSha
    && response.configured_model === coachingContract.model && response.observed_model === take.authorityReceipt.model
    && Number.isInteger(response.provider_attempts) && Number(response.provider_attempts) >= 1
    && response.retry_count === Number(response.provider_attempts) - 1
    && response.session_binding_sha256 === expectedSessionBinding;
  if (!requestMatches || !responseMatches) {
    return { verdict: 'FAIL' as const, reason: 'generation_request_or_session_binding_mismatch', recomputedSha256: computed };
  }
  if (!SHA64.test(String(response.prompt_sha256)) || response.prompt_sha256 !== computed
    || (take.source === 'fresh' && take.promptSha256 !== response.prompt_sha256)
    || (take.source === 'cache' && take.promptSha256 !== null)) {
    return { verdict: 'FAIL' as const, reason: 'server_prompt_digest_mismatch', recomputedSha256: computed };
  }
  return { verdict: 'PASS' as const, reason: 'recomputed_from_bound_saved_prompt_inputs', recomputedSha256: computed };
}

function validateTake(take: RwtCoachingTakeEvidence, releaseSha: string, label: string): void {
  if (take.product !== 'open_mic' && take.product !== 'focus_points') throw new Error(`${label}: product is invalid`);
  if (take.source !== 'fresh' && take.source !== 'cache') throw new Error(`${label}: source is invalid`);
  exactKeys(take.runOwnedBinding, ['verified', 'runId', 'sessionId', 'userId', 'fixtureSha256'], [], `${label}.runOwnedBinding`);
  exactKeys(take.savedInputReadback, ['sessionId', 'userId', 'product', 'transcript', 'metrics'], ['promptContext'], `${label}.savedInputReadback`);
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
    || !Number.isInteger(take.providerAttempts) || take.providerAttempts < 0 || take.providerAttempts > EDGE_MAX_PROVIDER_ATTEMPTS
    || !Number.isInteger(take.retryCount) || take.retryCount < 0 || take.retryCount > EDGE_MAX_PROVIDER_ATTEMPTS - 1
    || !MODEL_ID.test(take.configuredModel) || take.configuredModel !== coachingContract.model
    || !Number.isFinite(take.providerDurationMs) || take.providerDurationMs < 0
    || !Number.isFinite(take.totalDurationMs) || take.totalDurationMs < take.providerDurationMs
    || (take.promptSha256 !== null && !SHA64.test(take.promptSha256))) {
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
  exactKeys(input.firstTake, TAKE_KEYS, ['promptGenerationReceipt'], 'firstTake');
  exactKeys(input.repeatTake, TAKE_KEYS, ['promptGenerationReceipt'], 'repeatTake');
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
    firstTake: { ...input.firstTake, promptBinding: evaluatePromptBinding(input.firstTake, input.releaseSha) },
    repeatTake: { ...input.repeatTake, promptBinding: evaluatePromptBinding(input.repeatTake, input.releaseSha) },
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
