// Exact main70e source-derived port; transformations in port-pure.cjs. Offline only.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.coachingContract = exports.COACHING_SETTLE_BOUND_MS = exports.EDGE_PROVIDER_BUDGET_MS = exports.EDGE_MAX_PROVIDER_ATTEMPTS = void 0;
exports.canonicalSuggestionSha256 = canonicalSuggestionSha256;
exports.coachingSessionBindingSha256 = coachingSessionBindingSha256;
exports.recomputeCoachingPromptSha256 = recomputeCoachingPromptSha256;
exports.buildRwtCoachingEvidenceArtifact = buildRwtCoachingEvidenceArtifact;
const node_crypto_1 = require("node:crypto");
/**
 * The pinned active coaching contract, read at RUNTIME rather than imported: a TS module import would pull the Deno Edge
 * tree (`backend/supabase/functions/`) into the live typecheck, which `scripts/verify-live-typecheck-scope.mjs` forbids.
 * Same file, same value — the configured-model check below is unchanged.
 */
/**
 * #1258 option A (Codex r4290615974, PM 6207410484) — the Edge function's OWN attempt ceiling, read from its source so
 * the evidence bound and the server policy cannot drift. Fails closed if the constant cannot be read.
 */
exports.EDGE_MAX_PROVIDER_ATTEMPTS = 3;
/**
 * #1474 (Sam 6242612760) — the Edge function's OWN total provider budget for one coaching request, read from its source
 * like the attempt ceiling above. Waiting for every sent coaching exchange is bounded by this budget plus a fixed
 * transport/body allowance, so a never-answered request ends the wait instead of holding the receipt. Fails closed.
 */
exports.EDGE_PROVIDER_BUDGET_MS = 45000;
/** The bound for settling every sent coaching exchange: the Edge budget plus 15 s for transport and the response body. */
exports.COACHING_SETTLE_BOUND_MS = exports.EDGE_PROVIDER_BUDGET_MS + 15_000;
exports.coachingContract = require('./coaching-contract.json');
const SHA40 = /^[0-9a-f]{40}$/i;
const SHA64 = /^[0-9a-f]{64}$/i;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODEL_ID = /^[A-Za-z0-9._:-]{1,128}$/;
/**
 * #1258 alpha run 38288222695: read at RUNTIME, never as an ESM JSON import. The repo is `"type": "module"`, so
 * Playwright on Node 22 refuses a bare `.json` import ("needs an import attribute of type: json") and every spec that
 * reaches this helper fails to load. Vitest accepts the import, so unit CI never saw it. Same pattern as rwtJourney.ts.
 */
const FIXTURES = require('./fixture-manifest.json').fixtures;
const TAKE_KEYS = [
    'runId', 'suiteId', 'product', 'fixtureName', 'fixtureSha256', 'sessionId', 'userId', 'runOwnedBinding',
    'transcript', 'metrics', 'savedInputReadback', 'configuredModel', 'diagnosticRequestId', 'diagnosticAttemptId', 'diagnosticClientAttempt',
    'diagnosticStatus', 'diagnosticOutcome', 'diagnosticReason', 'providerAttempts', 'retryCount', 'source',
    'providerDurationMs', 'totalDurationMs', 'promptSha256', 'authorityReceipt', 'renderedSuggestions',
];
function record(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error(`${label}: expected an object`);
    return value;
}
function exactKeys(value, required, optional, label) {
    const item = record(value, label);
    const allowed = new Set([...required, ...optional]);
    for (const key of Object.keys(item))
        if (!allowed.has(key))
            throw new Error(`${label}: unexpected field ${key}`);
    for (const key of required)
        if (!Object.prototype.hasOwnProperty.call(item, key))
            throw new Error(`${label}: missing field ${key}`);
    return item;
}
function jsonbText(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value))
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(jsonbText).join(', ')}]`;
    if (value && typeof value === 'object') {
        const item = value;
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
function canonicalSuggestionSha256(value) {
    if (!exactPair(value))
        throw new Error('suggestion pair is invalid');
    return (0, node_crypto_1.createHash)('sha256').update(jsonbText(value), 'utf8').digest('hex');
}
const exactPair = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const item = value;
    return JSON.stringify(Object.keys(item).sort()) === JSON.stringify(['version', 'what_to_try_next', 'what_worked'])
        && (item.version === 'gemini_coaching_v1' || item.version === 'gemini_coaching_focus_v1')
        && typeof item.what_worked === 'string' && item.what_worked.trim().length > 0
        && typeof item.what_to_try_next === 'string' && item.what_to_try_next.trim().length > 0;
};
const PROMPT_INPUT_MAX_CHARS = 8000;
const PROMPT_FOCUS_LABEL_MAX_CHARS = 200;
/** Recompute the Edge's response-only selected-session binding from the authenticated DB readback identity. */
function coachingSessionBindingSha256(userId, sessionId) {
    return (0, node_crypto_1.createHash)('sha256')
        .update(JSON.stringify({ user_id: userId, session_id: sessionId }), 'utf8')
        .digest('hex');
}
function promptContextIsComplete(value) {
    try {
        const context = exactKeys(value, ['transcriptState', 'focusContext'], [], 'promptContext');
        if (context.transcriptState !== 'available')
            return false;
        exactKeys(context.focusContext, context.focusContext && typeof context.focusContext === 'object'
            && context.focusContext.kind === 'focus'
            ? ['kind', 'topic', 'points'] : ['kind'], [], 'promptContext.focusContext');
        const focus = context.focusContext;
        if (focus.kind === 'none')
            return true;
        if (focus.kind !== 'focus' || (focus.topic !== null && typeof focus.topic !== 'string') || !Array.isArray(focus.points))
            return false;
        for (const point of focus.points) {
            const item = exactKeys(point, ['label', 'verdict', 'detectedAtSeconds'], [], 'promptContext.focusContext.point');
            if (typeof item.label !== 'string'
                || !['detected', 'not_detected', 'unavailable'].includes(String(item.verdict))
                || (item.detectedAtSeconds !== null && (typeof item.detectedAtSeconds !== 'number' || !Number.isFinite(item.detectedAtSeconds))))
                return false;
        }
        return focus.points.length > 0;
    }
    catch {
        return false;
    }
}
function promptQuoteLabel(value) {
    return `"${value.replace(/[\r\n"]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, PROMPT_FOCUS_LABEL_MAX_CHARS)}"`;
}
function promptClockText(seconds) {
    const rounded = Math.max(0, Math.round(seconds));
    return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}
/** Independently reconstruct the exact Edge prompt from a run-owned saved-row and saved-Focus readback. */
function recomputeCoachingPromptSha256(readback) {
    const raw = readback;
    if (!promptContextIsComplete(raw.promptContext))
        return null;
    const context = raw.promptContext;
    if ((readback.product === 'open_mic' && context.focusContext.kind !== 'none')
        || (readback.product === 'focus_points' && context.focusContext.kind !== 'focus'))
        return null;
    const transcript = readback.transcript.length > PROMPT_INPUT_MAX_CHARS
        ? `${readback.transcript.slice(0, PROMPT_INPUT_MAX_CHARS)}\n\n[Transcript truncated for coaching request length.]`
        : readback.transcript;
    const metrics = readback.metrics;
    if (!['wpm', 'filler_counts', 'filler_words', 'next_action_signal'].every((key) => Object.prototype.hasOwnProperty.call(metrics, key)))
        return null;
    if (metrics.wpm !== null && (typeof metrics.wpm !== 'number' || !Number.isFinite(metrics.wpm)))
        return null;
    const fillerEvidence = metrics.filler_counts ?? metrics.filler_words;
    const fillers = `- Filler Words: ${fillerEvidence == null ? 'N/A' : JSON.stringify(fillerEvidence)}`;
    const pace = `- Words Per Minute (WPM): ${metrics.wpm ?? 'N/A'}`;
    let metricsText;
    let focusText = '';
    if (context.focusContext.kind !== 'focus') {
        metricsText = `\n      Delivery signals:\n      ${pace}\n      ${fillers}\n    `;
    }
    else {
        const metric = metrics.next_action_signal && typeof metrics.next_action_signal === 'object'
            && !Array.isArray(metrics.next_action_signal)
            ? metrics.next_action_signal.metric : undefined;
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
    const prompt = exports.coachingContract.promptTemplate.replace(/\{\{(TRANSCRIPT|METRICS)\}\}/g, (_marker, name) => name === 'TRANSCRIPT' ? transcript : fullMetricsText);
    return (0, node_crypto_1.createHash)('sha256').update(prompt, 'utf8').digest('hex');
}
function evaluatePromptBinding(take, releaseSha) {
    const hold = (reason) => ({ verdict: 'HOLD', reason });
    const proof = take.promptGenerationReceipt;
    const computed = recomputeCoachingPromptSha256(take.savedInputReadback);
    if (!proof || computed === null)
        return hold('authoritative_prompt_inputs_or_generation_receipt_unavailable');
    let request;
    let response;
    try {
        request = exactKeys(proof.request, ['sessionId', 'product', 'requestId', 'attemptId', 'clientAttempt', 'clientReleaseId'], [], 'promptGenerationReceipt.request');
        response = exactKeys(proof.response, ['request_id', 'attempt_id', 'client_attempt', 'status', 'outcome', 'reason', 'provider', 'configured_model',
            'observed_model', 'source', 'provider_attempts', 'retry_count', 'prompt_sha256', 'product', 'has_session',
            'client_release_id', 'session_binding_sha256'], [], 'promptGenerationReceipt.response');
    }
    catch {
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
        && response.configured_model === exports.coachingContract.model && response.observed_model === take.authorityReceipt.model
        && Number.isInteger(response.provider_attempts) && Number(response.provider_attempts) >= 1
        && response.retry_count === Number(response.provider_attempts) - 1
        && response.session_binding_sha256 === expectedSessionBinding;
    if (!requestMatches || !responseMatches) {
        return { verdict: 'FAIL', reason: 'generation_request_or_session_binding_mismatch', recomputedSha256: computed };
    }
    if (!SHA64.test(String(response.prompt_sha256)) || response.prompt_sha256 !== computed
        || (take.source === 'fresh' && take.promptSha256 !== response.prompt_sha256)
        || (take.source === 'cache' && take.promptSha256 !== null)) {
        return { verdict: 'FAIL', reason: 'server_prompt_digest_mismatch', recomputedSha256: computed };
    }
    return { verdict: 'PASS', reason: 'recomputed_from_bound_saved_prompt_inputs', recomputedSha256: computed };
}
function validateTake(take, releaseSha, label) {
    if (take.product !== 'open_mic' && take.product !== 'focus_points')
        throw new Error(`${label}: product is invalid`);
    if (take.source !== 'fresh' && take.source !== 'cache')
        throw new Error(`${label}: source is invalid`);
    exactKeys(take.runOwnedBinding, ['verified', 'runId', 'sessionId', 'userId', 'fixtureSha256'], [], `${label}.runOwnedBinding`);
    exactKeys(take.savedInputReadback, ['sessionId', 'userId', 'product', 'transcript', 'metrics'], ['promptContext'], `${label}.savedInputReadback`);
    exactKeys(take.authorityReceipt, ['session_id', 'user_id', 'provider', 'model', 'provider_request_made', 'receipt_suggestion_sha256', 'current_suggestion_sha256', 'ai_suggestions'], ['cache_read_count'], `${label}.authorityReceipt`);
    const fixture = FIXTURES[take.fixtureName];
    if (!fixture || fixture.kind !== 'synthetic' || fixture.sha256 !== take.fixtureSha256) {
        throw new Error(`${label}: fixture identity/hash is not a pinned synthetic fixture`);
    }
    if (!UUID_V4.test(take.sessionId) || !UUID_V4.test(take.userId))
        throw new Error(`${label}: run-owned identity is invalid`);
    if (!take.runId.trim() || !take.suiteId.trim())
        throw new Error(`${label}: run and suite identity are required`);
    if (take.runOwnedBinding.verified !== true || take.runOwnedBinding.runId !== take.runId
        || take.runOwnedBinding.sessionId !== take.sessionId || take.runOwnedBinding.userId !== take.userId
        || take.runOwnedBinding.fixtureSha256 !== take.fixtureSha256) {
        throw new Error(`${label}: session/account is not bound to this run and fixture`);
    }
    if (take.product === 'open_mic' && !take.fixtureName.startsWith('open_mic_'))
        throw new Error(`${label}: Open Mic fixture/product mismatch`);
    if (take.product === 'focus_points' && !take.fixtureName.startsWith('focus_points_'))
        throw new Error(`${label}: Focus fixture/product mismatch`);
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
        || !Number.isInteger(take.providerAttempts) || take.providerAttempts < 0 || take.providerAttempts > exports.EDGE_MAX_PROVIDER_ATTEMPTS
        || !Number.isInteger(take.retryCount) || take.retryCount < 0 || take.retryCount > exports.EDGE_MAX_PROVIDER_ATTEMPTS - 1
        || !MODEL_ID.test(take.configuredModel) || take.configuredModel !== exports.coachingContract.model
        || !Number.isFinite(take.providerDurationMs) || take.providerDurationMs < 0
        || !Number.isFinite(take.totalDurationMs) || take.totalDurationMs < take.providerDurationMs
        || (take.promptSha256 !== null && !SHA64.test(take.promptSha256))) {
        if (take.configuredModel !== exports.coachingContract.model)
            throw new Error(`${label}: configured model does not match the active coaching contract`);
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
    if (!SHA40.test(releaseSha))
        throw new Error('release SHA is invalid');
}
/**
 * Build a restricted artifact for synthetic-only coaching verification. The returned value contains
 * exact synthetic transcript/metrics and the exact saved/rendered phrases; callers must write it only
 * to the access-restricted evidence destination, never to logs, PostHog or the public RWT receipt.
 */
function buildRwtCoachingEvidenceArtifact(rawInput) {
    const input = exactKeys(rawInput, ['releaseSha', 'firstTake', 'repeatTake'], [], 'evidence input');
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
        schemaVersion: 'rwt_coaching_evidence_v1',
        visibility: 'restricted_synthetic',
        releaseSha: input.releaseSha,
        suiteId: input.firstTake.suiteId,
        product: input.firstTake.product,
        fixture: { name: input.firstTake.fixtureName, sha256: input.firstTake.fixtureSha256 },
        firstTake: { ...input.firstTake, promptBinding: evaluatePromptBinding(input.firstTake, input.releaseSha) },
        repeatTake: { ...input.repeatTake, promptBinding: evaluatePromptBinding(input.repeatTake, input.releaseSha) },
    };
}
