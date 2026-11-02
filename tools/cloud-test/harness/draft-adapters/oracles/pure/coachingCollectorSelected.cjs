// Exact main70e source-derived port; transformations in port-pure.cjs. Offline only.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assembleTake = assembleTake;
exports.readSavedPromptObservation = readSavedPromptObservation;
exports.captureCoachingTake = captureCoachingTake;
exports.capturedTakesDifferVerdict = capturedTakesDifferVerdict;
exports.readLiveCoachingPair = readLiveCoachingPair;
const rwtCoachingEvidence_cjs_1 = require("./rwtCoachingEvidence.cjs");
const rwtCoachingConsistency_cjs_1 = require("./rwtCoachingConsistency.cjs");
const PROOF_RESPONSE_KEYS = ['request_id', 'attempt_id', 'client_attempt', 'status', 'outcome', 'reason', 'provider', 'configured_model',
    'observed_model', 'source', 'provider_attempts', 'retry_count', 'prompt_sha256', 'product', 'has_session', 'client_release_id',
    'session_binding_sha256'];
const successes = (exchanges, sessionId) => exchanges.filter((e) => e.sent.sessionId === sessionId && e.status === 200 && e.diagnostics?.outcome === 'success');
/**
 * One take's evidence, or the closed reason it is unavailable (HOLD). The terminal success is the take's last successful
 * exchange; the generation proof is the take's FRESH generation (for a cache replay, the original one — absent → the
 * helper HOLDs prompt binding rather than inventing it).
 */
function assembleTake(input) {
    const { identity, saved, authority, rendered } = input;
    const ok = successes(input.exchanges, identity.sessionId);
    const terminal = ok[ok.length - 1];
    if (!terminal?.diagnostics)
        return { hold: 'no_successful_generation_observed' };
    if (!saved)
        return { hold: 'saved_prompt_inputs_unavailable' };
    if (!authority || !authority.ai_suggestions || authority.provider === null || authority.model === null
        || authority.provider_request_made === null || authority.receipt_suggestion_sha256 === null || authority.current_suggestion_sha256 === null) {
        return { hold: 'server_authority_readback_unavailable' };
    }
    if (!rendered)
        return { hold: 'rendered_pair_unavailable' };
    const d = terminal.diagnostics;
    const fresh = [...ok].reverse().find((e) => e.diagnostics?.source === 'fresh');
    const proof = fresh?.diagnostics && PROOF_RESPONSE_KEYS.every((k) => Object.prototype.hasOwnProperty.call(fresh.diagnostics, k))
        ? {
            request: {
                sessionId: fresh.sent.sessionId ?? '', product: (fresh.sent.product ?? ''),
                requestId: fresh.sent.requestId ?? '', attemptId: fresh.sent.attemptId ?? '',
                clientAttempt: fresh.sent.clientAttempt ?? 0, clientReleaseId: fresh.sent.clientReleaseId ?? '',
            },
            response: Object.fromEntries(PROOF_RESPONSE_KEYS.map((k) => [k, fresh.diagnostics[k]])),
        }
        : undefined;
    const source = d.source === 'cache' ? 'cache' : 'fresh';
    const take = {
        ...identity,
        runOwnedBinding: { verified: true, runId: identity.runId, sessionId: identity.sessionId, userId: identity.userId, fixtureSha256: identity.fixtureSha256 },
        transcript: saved.transcript,
        metrics: saved.metrics,
        savedInputReadback: {
            sessionId: identity.sessionId, userId: identity.userId, product: identity.product,
            transcript: saved.transcript, metrics: saved.metrics, promptContext: saved.promptContext,
        },
        configuredModel: String(d.configured_model ?? ''),
        diagnosticRequestId: String(d.request_id ?? ''),
        diagnosticAttemptId: String(d.attempt_id ?? ''),
        diagnosticClientAttempt: Number(d.client_attempt ?? 0),
        diagnosticStatus: terminal.status ?? 0,
        diagnosticOutcome: 'success',
        diagnosticReason: 'none',
        providerAttempts: Number(d.provider_attempts ?? -1),
        retryCount: Number(d.retry_count ?? -1),
        source,
        providerDurationMs: Number(d.provider_duration_ms ?? -1),
        totalDurationMs: Number(d.total_duration_ms ?? -1),
        promptSha256: typeof d.prompt_sha256 === 'string' ? d.prompt_sha256 : null,
        authorityReceipt: {
            session_id: authority.session_id, user_id: authority.user_id, provider: authority.provider, model: authority.model,
            provider_request_made: authority.provider_request_made,
            receipt_suggestion_sha256: authority.receipt_suggestion_sha256, current_suggestion_sha256: authority.current_suggestion_sha256,
            ai_suggestions: authority.ai_suggestions,
            ...(authority.cache_read_count === null ? {} : { cache_read_count: authority.cache_read_count }),
        },
        renderedSuggestions: rendered,
    };
    if (proof)
        take.promptGenerationReceipt = proof;
    return { take };
}
const PROMPT_METRIC_KEYS = ['wpm', 'filler_counts', 'filler_words', 'next_action_signal'];
/** Expiry is an explicit state, never evidence that inputs or coaching were previously saved. */
async function readSavedPromptObservation(admin, userId, sessionId, product, isActive = () => true) {
    const { data: row, error } = await admin.from('sessions').select(`id, user_id, product, transcript, transcript_state, total_words, ${PROMPT_METRIC_KEYS.join(', ')}`)
        .eq('id', sessionId).eq('user_id', userId).maybeSingle();
    if (!isActive())
        return { state: 'query_error' };
    if (error)
        return { state: 'query_error' };
    if (!row)
        return { state: 'missing' };
    if (row.id !== sessionId || row.user_id !== userId || row.product !== product)
        return { state: 'identity_mismatch' };
    if (row.transcript_state === 'expired' && row.transcript === null)
        return { state: 'expired' };
    if (row.transcript_state !== 'available' || typeof row.transcript !== 'string' || !row.transcript.trim())
        return { state: 'malformed' };
    const transcript = row.transcript;
    const metrics = Object.fromEntries(PROMPT_METRIC_KEYS.map((k) => [k, (row[k] ?? null)]));
    const transcriptState = row.transcript_state;
    // Evidence for the two-take consistency check only. total_words is NOT a provider prompt input.
    const totalWords = Number.isSafeInteger(row.total_words) && Number(row.total_words) >= 0 ? Number(row.total_words) : null;
    if (product === 'open_mic')
        return { state: 'available', totalWords, saved: { transcript, metrics, promptContext: { transcriptState, focusContext: { kind: 'none' } } } };
    // Mirrors the Edge function's loadFocusContext over the same tables, keyed by the run-owned session.
    const { data: objective, error: oErr } = await admin.from('objective_session').select('id, brief_id')
        .eq('source_session_id', sessionId).eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!isActive())
        return { state: 'query_error' };
    if (oErr)
        return { state: 'query_error' };
    if (!objective)
        return { state: 'missing' };
    const [brief, points, evidence] = await Promise.all([
        admin.from('objective_brief').select('event_goal').eq('id', objective.brief_id).eq('user_id', userId).maybeSingle(),
        admin.from('objective_brief_point').select('id, label, sort_order').eq('brief_id', objective.brief_id).eq('user_id', userId).order('sort_order', { ascending: true }),
        admin.from('objective_evidence').select('brief_point_id, verdict, detected_at_seconds').eq('session_id', objective.id).eq('user_id', userId),
    ]);
    if (brief.error || points.error || evidence.error)
        return { state: 'query_error' };
    const pointRows = (points.data ?? []);
    const evidenceRows = (evidence.data ?? []);
    if (!brief.data || pointRows.length === 0 || evidenceRows.length !== pointRows.length)
        return { state: 'malformed' };
    const byPoint = new Map(evidenceRows.map((r) => [r.brief_point_id, r]));
    const verdicts = new Set(['detected', 'not_detected', 'unavailable']);
    if (byPoint.size !== pointRows.length || pointRows.some((p) => typeof p.label !== 'string' || !verdicts.has(byPoint.get(p.id)?.verdict ?? '')))
        return { state: 'malformed' };
    const goal = brief.data?.event_goal;
    const topic = typeof goal === 'string' ? goal : null;
    return { state: 'available', totalWords, saved: {
            transcript, metrics,
            promptContext: {
                transcriptState,
                focusContext: {
                    kind: 'focus', topic,
                    points: pointRows.map((p) => {
                        const r = byPoint.get(p.id);
                        const verdict = (r && verdicts.has(r.verdict) ? r.verdict : 'unavailable');
                        return { label: p.label, verdict, detectedAtSeconds: verdict === 'detected' && typeof r?.detected_at_seconds === 'number' ? r.detected_at_seconds : null };
                    }),
                },
            },
        } };
}
/** Own every nested value: later tap/DB/DOM mutation must not rewrite an earlier observation. */
function immutableCopy(value) {
    const copy = structuredClone(value);
    const freeze = (item) => {
        if (!item || typeof item !== 'object' || Object.isFrozen(item))
            return;
        Object.values(item).forEach(freeze);
        Object.freeze(item);
    };
    freeze(copy);
    return copy;
}
/** A positive witness requires an independently read SAVED pair, not the HTTP answer or the fact of expiry. */
function captureCoachingTake(input) {
    if (input.observed.state === 'identity_mismatch')
        return { fail: 'saved_identity_mismatch' };
    if (input.observed.state !== 'available')
        return { hold: `saved_inputs_${input.observed.state}` };
    const assembled = assembleTake({ ...input, saved: input.observed.saved });
    return immutableCopy('take' in assembled ? { ...assembled, totalWords: input.observed.totalWords } : assembled);
}
/** Use the existing artifact validators for BOTH witnesses before a saved-word-count comparison can PASS. */
function capturedTakesDifferVerdict(first, second, releaseSha) {
    if ('fail' in first || 'fail' in second)
        return { status: 'FAIL', detail: 'a saved take changed or does not match its run-owned identity' };
    if (!('take' in first) || !('take' in second))
        return (0, rwtCoachingConsistency_cjs_1.takesDifferVerdict)(null, null, null);
    try {
        const artifact = (0, rwtCoachingEvidence_cjs_1.buildRwtCoachingEvidenceArtifact)({ releaseSha, firstTake: first.take, repeatTake: second.take });
        const bindings = [artifact.firstTake.promptBinding.verdict, artifact.repeatTake.promptBinding.verdict];
        if (bindings.includes('FAIL'))
            return { status: 'FAIL', detail: 'a captured take failed its saved-input generation binding' };
        if (bindings.includes('HOLD'))
            return { status: 'HOLD', detail: 'a captured take lacks proven saved-input generation binding' };
    }
    catch {
        return { status: 'FAIL', detail: 'captured coaching failed the saved-pair or take-identity contract' };
    }
    const pair = (take) => ({ well: take.authorityReceipt.ai_suggestions.what_worked, next: take.authorityReceipt.ai_suggestions.what_to_try_next });
    return (0, rwtCoachingConsistency_cjs_1.takesDifferVerdict)(pair(first.take), pair(second.take), first.totalWords === null || second.totalWords === null ? null : first.totalWords !== second.totalWords);
}
/** Read identity and visible content in ONE browser turn. A B/C transition cannot splice two different DOM states. */
async function readLiveCoachingPair(page, product) {
    return page.evaluate((kind) => {
        const root = document.documentElement;
        const sessionId = root.getAttribute('data-session-persisted-id');
        const card = document.querySelector('[data-testid="ai-suggestions-card"][data-review-state="ready"]');
        const block = card?.querySelector('[data-testid="ai-suggestions-pair"]');
        if (!sessionId || root.getAttribute('data-session-persisted') !== 'true' || !block || block.getClientRects().length === 0)
            return null;
        const text = (id) => {
            const el = block.querySelector(`[data-testid="${id}"]`);
            return el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' ? el.innerText.trim() : '';
        };
        const well = text('review-what-went-well');
        const next = text('review-try-next');
        return well && next ? { sessionId, pair: { version: kind === 'focus_points' ? 'gemini_coaching_focus_v1' : 'gemini_coaching_v1', what_worked: well, what_to_try_next: next } } : null;
    }, product);
}
