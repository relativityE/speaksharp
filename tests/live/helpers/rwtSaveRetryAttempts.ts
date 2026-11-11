/**
 * AHT-05/06 (save retry, request lost / response lost): the harness checks the spec lacked, as pure verdicts.
 *  - `completion-attempts`: mirrors tools/cloud-test/harness/bundle/harness/completion-attempts.cjs (`CompletionAttempts.summary`):
 *    for the faulted take's OWN session only, exactly 2 completion POSTs: #1 the injected fault before Retry, #2 after the explicit
 *    Retry Save with the same request-body sha and a 2xx answer. A third or late attempt, a changed body, or a non-completed status
 *    for that session is a FAIL. A later, deliberately started take (another session id) is outside this scope, as in the harness.
 *    Scope is the same as the harness's: the browser's outbound requests and HTTP answers, never server logs.
 *  - `retry-saved-once` (exact): mirrors tools/cloud-test/harness/draft-adapters/durable-save-oracle.cjs `compareSavedRows` (source
 *    pin 5a7bf6a1): the one saved row is the Start session, keeps the Start row's idempotency key and lease, and holds exactly the
 *    values of the completion payload (null means unchanged, duration clamped to 0..600), with a retained transcript.
 *    tests/unit/rwtSaveRetryAttempts.test.ts runs this port and the harness function on the same inputs and requires agreement.
 *
 * Case-only helper: nothing AHT-01 loads imports it (rwtSaveRetry.ts is loaded by rwtAcceptance.ts, so it is left unchanged).
 * Request bodies and rows stay in memory; only verdicts, booleans and counts reach a receipt.
 */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Verdict } from './rwtSaveRetry';

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
/** The harness's canonical session id (fault-contract.cjs / durable-save-oracle.cjs). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** One completion POST as the route saw it. `body` is kept in memory only (the exact check needs the dropped payload). */
export type CompletionAttempt = {
    ordinal: number;
    /** `p_session_id` of the JSON body, or null when the body was unreadable. */
    sessionId: string | null;
    /** `p_status` of the JSON body, or null when unreadable. */
    status: string | null;
    bodySha: string;
    /** Set when the request arrived after the explicit Retry Save mark (the flag is set immediately before the click). */
    afterRetry: boolean;
    /** The one request the journey altered. */
    dropped: boolean;
    /** The HTTP status the page received, or null when it received none. */
    httpStatus: number | null;
    body: Record<string, unknown> | null;
};

/** Parse one route-seen completion POST into an attempt (the body never leaves memory). */
export function parseCompletionAttempt(ordinal: number, raw: Buffer | string | null, afterRetry: boolean, dropped: boolean): CompletionAttempt {
    const bytes = raw ?? '';
    let body: Record<string, unknown> | null = null;
    try {
        const parsed: unknown = JSON.parse(typeof bytes === 'string' ? bytes : bytes.toString('utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    } catch { body = null; }
    return {
        ordinal,
        sessionId: body && typeof body.p_session_id === 'string' ? body.p_session_id : null,
        status: body && typeof body.p_status === 'string' ? body.p_status : null,
        bodySha: sha256(bytes),
        afterRetry,
        dropped,
        httpStatus: null,
        body,
    };
}

/** Content-free evidence for a receipt: ordinal, scope, phase, body-sha prefix, status. Never the body. */
export function attemptEvidence(attempts: readonly CompletionAttempt[], takeSessionId: string | null): string {
    return attempts.map((a) => {
        const scope = a.sessionId === null ? 'unreadable' : a.sessionId === takeSessionId ? 'take' : 'other';
        return `${a.ordinal}:${scope}:${a.dropped ? 'fault' : a.afterRetry ? 'retry' : 'initial'}:${a.bodySha.slice(0, 12)}:${a.httpStatus ?? 'none'}`;
    }).join(',');
}

/**
 * `completion-attempts`. The take's session is the one the first (faulted) attempt names. FAIL on any extra, late or changed attempt
 * for that session (the harness's VIOLATION), and on an incomplete pair (no Retry attempt, or a non-2xx answer); HOLD only when
 * the instrument could not read the faulted request's identity, so the scope itself is unknown.
 */
export function completionAttemptsVerdict(attempts: readonly CompletionAttempt[]): Verdict {
    const first = attempts.find((a) => a.dropped);
    if (!first) return { status: 'FAIL', detail: 'no completion attempt was altered, so the faulted save never happened' };
    if (first.sessionId === null) return { status: 'HOLD', detail: 'the faulted completion request had no readable session id, so its scope is unknown' };
    if (!UUID.test(first.sessionId)) return { status: 'FAIL', detail: 'the faulted completion named a non-canonical session id' };
    const own = attempts.filter((a) => a.sessionId === first.sessionId);
    if (attempts.some((a) => a.sessionId === null)) {
        return { status: 'FAIL', detail: 'a completion request had an unreadable body, so it could be an extra attempt for the take' };
    }
    if (own.some((a) => a.status !== 'completed')) return { status: 'FAIL', detail: 'a completion attempt for the take did not ask for status completed' };
    if (own[0] !== first || first.afterRetry) return { status: 'FAIL', detail: 'the take\'s first completion attempt was not the injected fault before Retry' };
    if (own.length > 2) return { status: 'FAIL', detail: `${own.length} completion attempts for the take; exactly 2 (the fault and one Retry) are allowed` };
    if (own.length < 2) return { status: 'FAIL', detail: 'Retry Save sent no completion attempt for the take' };
    const retry = own[1];
    if (!retry.afterRetry) return { status: 'FAIL', detail: 'the take\'s second completion attempt came before the explicit Retry Save' };
    if (retry.bodySha !== first.bodySha) return { status: 'FAIL', detail: 'the Retry Save attempt changed the completion payload' };
    if (retry.httpStatus === null || retry.httpStatus < 200 || retry.httpStatus >= 300) {
        return { status: 'FAIL', detail: `the Retry Save attempt was not answered 2xx (${retry.httpStatus ?? 'no answer'})` };
    }
    return { status: 'PASS', detail: 'exactly two completion attempts for the take: the injected fault, then one Retry Save with the same payload, answered 2xx' };
}

/** The durable-save-oracle columns, read from the run-owned account by id; kept in memory only. */
export const SAVED_ROW_COLUMNS = 'id,user_id,status,idempotency_key,lease_id,duration,status_reason,total_words,clarity_score,wpm,filler_counts,pause_metrics,next_action_signal,transcript,transcript_state';
export type SavedRow = Record<string, unknown>;

const COMPLETION_ARGS = ['p_session_id', 'p_status', 'p_final_duration', 'p_reason', 'p_next_action', 'p_total_words', 'p_clarity_score', 'p_wpm', 'p_filler_counts', 'p_pause_metrics', 'p_final_transcript'] as const;
const ROW_COLUMNS = SAVED_ROW_COLUMNS.split(',');

function rowShape(row: SavedRow | null | undefined): row is SavedRow {
    if (!row || typeof row !== 'object' || Array.isArray(row) || ROW_COLUMNS.some((k) => !Object.prototype.hasOwnProperty.call(row, k))) return false;
    if (typeof row.id !== 'string' || !UUID.test(row.id) || typeof row.user_id !== 'string' || !UUID.test(row.user_id)) return false;
    if (typeof row.idempotency_key !== 'string' || !row.idempotency_key || typeof row.lease_id !== 'string' || !row.lease_id) return false;
    for (const k of ['duration', 'total_words', 'clarity_score', 'wpm']) {
        if (row[k] !== null && (typeof row[k] !== 'number' || !Number.isFinite(row[k] as number))) return false;
    }
    for (const k of ['status_reason', 'transcript']) if (row[k] !== null && typeof row[k] !== 'string') return false;
    return true;
}

/**
 * `retry-saved-once`, exact. `body` is the faulted completion payload, `before` the take's own row read while it was still active
 * (the Start session), `rows` every session row of the account after Retry Save. The checks and their order follow
 * `compareSavedRows`; the detail names the first that failed, never a value.
 */
export function exactRetrySaveVerdict(body: Record<string, unknown> | null, before: SavedRow | null, rows: readonly SavedRow[], savedId: string | null): Verdict {
    const fail = (detail: string): Verdict => ({ status: 'FAIL', detail });
    if (!body || Object.keys(body).length !== COMPLETION_ARGS.length || COMPLETION_ARGS.some((k) => !Object.prototype.hasOwnProperty.call(body, k))) {
        return { status: 'HOLD', detail: 'the faulted completion payload was not the 11-argument completion, so the save cannot be compared' };
    }
    if (body.p_status !== 'completed' || typeof body.p_session_id !== 'string' || !UUID.test(body.p_session_id)) return fail('the faulted payload did not complete a canonical session');
    if (!before) return { status: 'HOLD', detail: 'the take\'s row was not read while it was active, so the Start session is unknown' };
    if (!rowShape(before) || before.id !== body.p_session_id || before.status !== 'active') return fail('the completion did not name the session created at Start');
    if (savedId !== body.p_session_id) return fail('the page bound a different session than the one the completion saved');
    if (rows.length !== 1) return fail(`${rows.length} session rows after Retry Save; exactly 1 is allowed`);
    const row = rows[0];
    if (!rowShape(row) || row.id !== body.p_session_id || row.user_id !== before.user_id || row.status !== 'completed') return fail('the saved row is not the completed Start session');
    if (row.idempotency_key !== before.idempotency_key || row.lease_id !== before.lease_id) return fail('the saved row changed its idempotency key or lease');
    if (body.p_final_duration !== null && !Number.isInteger(body.p_final_duration)) return fail('the payload duration was not a whole number');
    const duration = Math.min(600, Math.max(0, (body.p_final_duration as number | null) ?? (before.duration as number | null) ?? 0));
    if (row.duration !== duration) return fail('the saved duration differs from the payload (after the 0..600 clamp)');
    if (body.p_next_action === null || !isDeepStrictEqual(row.next_action_signal, body.p_next_action)) return fail('the saved next action differs from the payload');
    const pairs: [string, string][] = [['p_reason', 'status_reason'], ['p_total_words', 'total_words'], ['p_clarity_score', 'clarity_score'], ['p_wpm', 'wpm'],
        ['p_filler_counts', 'filler_counts'], ['p_pause_metrics', 'pause_metrics'], ['p_final_transcript', 'transcript']];
    for (const [arg, column] of pairs) {
        if (!isDeepStrictEqual(row[column], body[arg] ?? before[column])) return fail(`the saved ${column} differs from the payload`);
    }
    if (row.filler_counts === null || row.transcript_state !== 'available' || typeof row.transcript !== 'string' || !row.transcript.trim()) {
        return fail('the saved take has no filler counts or no retained transcript');
    }
    return { status: 'PASS', detail: 'Retry Save saved the Start session once, with the exact completion payload and its key and lease kept' };
}

/** `review-reopen`: the take reopened from Analytics shows the saved transcript, before and after a reload (digests only). */
export function reviewReopenVerdict(savedDigest: string | null, opened: boolean, before: string | null, after: string | null): Verdict {
    if (savedDigest === null) return { status: 'HOLD', detail: 'the saved transcript was not read, so the reopened review cannot be compared' };
    if (!opened) return { status: 'FAIL', detail: 'the saved take could not be opened from Analytics' };
    if (before !== savedDigest) return { status: 'FAIL', detail: 'the reopened review does not show the saved transcript' };
    if (after !== savedDigest) return { status: 'FAIL', detail: 'after a reload the review does not show the saved transcript' };
    return { status: 'PASS', detail: 'the take reopened from Analytics shows the saved transcript, before and after a reload' };
}

export const transcriptDigest = (text: string): string => sha256(text.trim());
