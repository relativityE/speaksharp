/**
 * CO006 — the canary's stop/save oracle, extracted so the unit lane can prove it can FAIL.
 *
 * The stop phase used to race a dialog wait, a "No speech" wait and an /analytics navigation, each of
 * which turned its own timeout into `null`. A timeout, an unrelated dialog or a no-speech take therefore
 * all "finished" the race, and the follow-up schema check read `sessions[0]` — any old row — so a take
 * that never saved could still pass. Here the outcome is decided only by evidence bound to THIS take:
 * the save RPC for the session the canary itself started, then a durable readback of that exact row.
 *
 * Pure and Playwright-free: the spec hands in promises and parsed bodies.
 */

/** The save the page sent, captured from a listener registered BEFORE Stop is pressed. */
export interface CompletionEvidence {
    /** `p_session_id` from the complete_session_v2 request body; null when it could not be read. */
    requestSessionId: string | null;
    status: number;
    body: unknown;
}

export interface StopObservation {
    completion: CompletionEvidence | null;
    noSpeechShown: boolean;
    unrelatedDialog: boolean;
}

export type StopOutcome =
    | { kind: 'saved'; sessionId: string }
    | { kind: 'no_speech' }
    | { kind: 'unresolved'; reason: string };

/**
 * Wait for the take's terminal evidence. Only the save response or the no-speech state ends the wait; a
 * dialog is recorded but never ends it, and a source that times out simply never resolves (it cannot win
 * the race the way a swallowed locator timeout used to). After the deadline the observation is frozen, so
 * a late callback cannot change what was decided.
 */
export async function awaitStopTerminal(
    sources: { completion: Promise<CompletionEvidence>; noSpeech: Promise<void>; dialog: Promise<void> },
    deadlineMs: number,
): Promise<StopObservation> {
    const seen: StopObservation = { completion: null, noSpeechShown: false, unrelatedDialog: false };
    let closed = false;
    const never = new Promise<never>(() => undefined);
    void sources.dialog.then(() => { if (!closed) seen.unrelatedDialog = true; }, () => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
        sources.completion.then((c) => { if (!closed) seen.completion = c; }, () => never),
        sources.noSpeech.then(() => { if (!closed) seen.noSpeechShown = true; }, () => never),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, deadlineMs); }),
    ]);
    clearTimeout(timer);
    closed = true;
    return { ...seen };
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** What the observation proves about the take the canary started. Only a saved completion of THAT session passes. */
export function classifyStopOutcome(expectedSessionId: string, observation: StopObservation): StopOutcome {
    const { completion } = observation;
    if (completion) {
        if (completion.requestSessionId !== expectedSessionId) return { kind: 'unresolved', reason: 'completion_for_other_session' };
        if (completion.status < 200 || completion.status >= 300) return { kind: 'unresolved', reason: `completion_http_${completion.status}` };
        const body = completion.body;
        if (!isObject(body) || body.success !== true || body.session_saved !== true || body.final_status !== 'completed') {
            return { kind: 'unresolved', reason: 'completion_not_saved' };
        }
        return { kind: 'saved', sessionId: expectedSessionId };
    }
    // No-speech is its own non-save outcome, never a persisted take.
    if (observation.noSpeechShown) return { kind: 'no_speech' };
    return { kind: 'unresolved', reason: observation.unrelatedDialog ? 'unrelated_dialog_without_save' : 'no_terminal_save' };
}

/** The owner of the started take, from the authoritative start RPC's `new_session`; null when absent. */
export function startOwnerId(newSession: unknown): string | null {
    const owner = isObject(newSession) ? newSession.user_id : undefined;
    return typeof owner === 'string' && owner.trim() ? owner : null;
}

const REQUIRED_FIELDS = ['id', 'user_id', 'total_words', 'duration', 'created_at', 'engine'] as const;

/**
 * Durable readback of the exact saved row. The detail read (`.single()`) returns one object and a list read
 * returns an array; either way the row is found by id — never `rows[0]` — and must belong to the take's
 * owner, be completed and carry words.
 */
export function verifySavedReadback(
    expectedSessionId: string, ownerId: string | null, body: unknown,
): { ok: true } | { ok: false; reason: string } {
    const rows = isObject(body) ? [body] : body;
    if (!Array.isArray(rows)) return { ok: false, reason: 'readback_not_a_row' };
    const row = rows.find((r) => isObject(r) && r.id === expectedSessionId);
    if (!isObject(row)) return { ok: false, reason: 'row_missing' };
    for (const field of REQUIRED_FIELDS) if (row[field] === undefined) return { ok: false, reason: `missing_${field}` };
    if (ownerId === null || row.user_id !== ownerId) return { ok: false, reason: 'wrong_owner' };
    if (row.status !== undefined && row.status !== 'completed') return { ok: false, reason: 'not_completed' };
    if (typeof row.total_words !== 'number' || row.total_words <= 0) return { ok: false, reason: 'no_words' };
    return { ok: true };
}
