/**
 * #1258 — received-side Practice Loop proof for one RWT recording journey.
 *
 * The PostHog query already binds rows to the controlled identity, release, traffic class and bounded
 * time window. This evaluator adds the take-level binding the query cannot infer, using ONLY fields the
 * governed producers emit today:
 *
 *   - `journey_id` / `boot_id` — the envelope's, attached to every event at the capture boundary;
 *   - `attempt_id` — the envelope's open recording attempt. A normal Stop -> READY leaves it open until the
 *     next accepted Start; a hard reset, unmount or idle reclamation clears it, and a row without it is HOLD;
 *   - product — the practice_loop_review_* events carry none. A received row in the same journey/boot that
 *     names a different product contradicts the declared binding (HOLD); absence is part of the gap below.
 *
 * PRODUCER GAP (#1258 comment 6037347459; PM delivery #308). The events carry no saved-session id, no
 * product and no request id, and `requested` is emitted once per review lifecycle, outside its internal
 * retry loop, so it does not identify the server request(s). Ownership and one-request pairing therefore
 * cannot be PROVEN from received rows, and this gate never returns QUALIFIED: a complete lifecycle is HOLD
 * with `PRODUCER_GAP_REASON`. What the received rows CAN prove is a conflict, and that is FAIL: more than
 * one `requested` for one take (each is a separate review lifecycle), a failed outcome, failed alongside
 * success, or a duplicated outcome. Missing or unattributable evidence is HOLD. Ownership is never
 * inferred beyond the envelope's own fields. `saved_review_revisited` is intentionally outside this event
 * set: opening cached feedback is not a new generation request.
 */
export const PRACTICE_LOOP_RECEIPT_FAMILIES = Object.freeze([
    'practice_loop_review_requested',
    'practice_loop_review_completed',
    'practice_loop_review_persisted',
    'practice_loop_review_rendered',
] as const);

/** Lifted only when the producers emit the ownership fields App Dev publishes; until then no coaching readback qualifies. */
export const PRODUCER_GAP_REASON = 'HOLD: producer gap — practice_loop_review_* carry no saved-session, product or request id, so take ownership and one-request pairing cannot be proven from received rows (#1258 comment 6037347459)';

const ALL_PRACTICE_LOOP_FAMILIES = new Set<string>([
    ...PRACTICE_LOOP_RECEIPT_FAMILIES,
    'practice_loop_review_failed',
]);

export type PracticeLoopProduct = 'open_mic' | 'focus_points';

export interface ReceivedPracticeLoopRow {
    event: string;
    journeyId?: string | null;
    bootId?: string | null;
    timestamp?: string | number | null;
    properties?: Readonly<Record<string, unknown>> | null;
}

export interface ReceivedPracticeLoopBinding {
    journeyId: string;
    bootId: string;
    product: PracticeLoopProduct;
    attemptIds: readonly string[];
}

export interface ReceivedPracticeLoopResult {
    /** QUALIFIED is reserved for when the producer gap closes; this evaluator cannot return it today. */
    verdict: 'QUALIFIED' | 'HOLD' | 'FAIL';
    expectedRequests: number;
    receivedRequests: number;
    reasons: string[];
}

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/** Evaluate all declared saved takes in one journey against only received PostHog rows. */
export function evaluateReceivedPracticeLoop(
    rows: readonly ReceivedPracticeLoopRow[],
    binding: ReceivedPracticeLoopBinding,
): ReceivedPracticeLoopResult {
    const reasons: string[] = [];
    const fail = (reason: string) => reasons.push(`FAIL: ${reason}`);
    const hold = (reason: string) => reasons.push(`HOLD: ${reason}`);
    const ids = [...new Set(binding.attemptIds.filter(nonEmpty))];
    if (!nonEmpty(binding.journeyId) || !nonEmpty(binding.bootId) || ids.length === 0
        || ids.length !== binding.attemptIds.length) {
        hold('the RWT receipt does not declare one journey, boot and every saved attempt for coaching readback');
    }

    const inJourney = (row: ReceivedPracticeLoopRow) => row.journeyId === binding.journeyId && row.bootId === binding.bootId;
    const contradicting = rows.filter((row) => inJourney(row) && nonEmpty(row.properties?.product)
        && row.properties?.product !== 'unknown' && row.properties?.product !== binding.product);
    if (contradicting.length > 0) {
        hold(`received ${[...new Set(contradicting.map((row) => row.event))].join(', ')} in this journey names a product other than the declared ${binding.product}`);
    }

    const relevant = rows.filter((row) => ALL_PRACTICE_LOOP_FAMILIES.has(row?.event));
    if (relevant.some((row) => ids.includes(String(row.properties?.attempt_id ?? '')) && !inJourney(row))) {
        hold('a received coaching event for a declared saved attempt belongs to a different or unknown journey/boot');
    }

    const byAttempt = new Map<string, ReceivedPracticeLoopRow[]>();
    for (const row of relevant.filter(inJourney)) {
        const attemptId = row.properties?.attempt_id;
        if (!nonEmpty(attemptId)) {
            // Unattributable: it could be a second request for a declared take.
            hold(`received ${row.event} in this journey carries no attempt_id, so it cannot be bound to a saved take`);
            continue;
        }
        // Another take in the same journey (an unsaved short take never generates a review) is not this take's evidence.
        if (!ids.includes(attemptId)) continue;
        const group = byAttempt.get(attemptId) ?? [];
        group.push(row);
        byAttempt.set(attemptId, group);
    }

    let receivedRequests = 0;
    for (const attemptId of ids) {
        const counts = new Map<string, number>();
        for (const row of byAttempt.get(attemptId) ?? []) counts.set(row.event, (counts.get(row.event) ?? 0) + 1);
        const requested = counts.get('practice_loop_review_requested') ?? 0;
        receivedRequests += requested;
        if (requested > 1) fail(`attempt ${attemptId} has ${requested} received coaching requests; exactly one is allowed`);

        const duplicates = PRACTICE_LOOP_RECEIPT_FAMILIES.slice(1).filter((family) => (counts.get(family) ?? 0) > 1);
        if (duplicates.length > 0) fail(`attempt ${attemptId} has duplicate received coaching outcomes: ${duplicates.join(', ')}`);

        const failedCount = counts.get('practice_loop_review_failed') ?? 0;
        const successCount = PRACTICE_LOOP_RECEIPT_FAMILIES.slice(1).reduce((sum, family) => sum + (counts.get(family) ?? 0), 0);
        if (failedCount > 0) {
            fail(successCount > 0
                ? `attempt ${attemptId} has conflicting failed and successful coaching outcomes`
                : `attempt ${attemptId} received a failed coaching outcome`);
            continue;
        }
        const missing = PRACTICE_LOOP_RECEIPT_FAMILIES.filter((family) => (counts.get(family) ?? 0) === 0);
        if (missing.length > 0) hold(`attempt ${attemptId} is missing received coaching events: ${missing.join(', ')}`);
    }

    reasons.push(PRODUCER_GAP_REASON);
    return {
        verdict: reasons.some((reason) => reason.startsWith('FAIL:')) ? 'FAIL' : 'HOLD',
        expectedRequests: ids.length,
        receivedRequests,
        reasons,
    };
}
