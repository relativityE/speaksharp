/**
 * #1258 — received-side Practice Loop proof for one RWT recording journey.
 *
 * The PostHog query already binds rows to the controlled identity, release, traffic class and bounded
 * time window. This evaluator adds the product-level binding the query cannot infer: exact journey/boot,
 * saved recording attempt, product and one logical request ID. Missing or mismatched ownership is HOLD;
 * an observed failed outcome, conflicting terminal outcomes, duplicates, or extra requests is FAIL.
 * `saved_review_revisited` is intentionally outside this event set: opening cached feedback is not a new
 * generation request.
 */
export const PRACTICE_LOOP_RECEIPT_FAMILIES = Object.freeze([
    'practice_loop_review_requested',
    'practice_loop_review_completed',
    'practice_loop_review_persisted',
    'practice_loop_review_rendered',
] as const);

const ALL_PRACTICE_LOOP_FAMILIES = new Set<string>([
    ...PRACTICE_LOOP_RECEIPT_FAMILIES,
    'practice_loop_review_failed',
]);

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
    product: 'open_mic' | 'focus_points';
    attemptIds: readonly string[];
}

export interface ReceivedPracticeLoopResult {
    verdict: 'QUALIFIED' | 'HOLD' | 'FAIL';
    expectedRequests: number;
    receivedRequests: number;
    reasons: string[];
}

/** Evaluate all declared saved takes in one journey against only received PostHog rows. */
export function evaluateReceivedPracticeLoop(
    rows: readonly ReceivedPracticeLoopRow[],
    binding: ReceivedPracticeLoopBinding,
): ReceivedPracticeLoopResult {
    const reasons: string[] = [];
    const fail = (reason: string) => reasons.push(`FAIL: ${reason}`);
    const hold = (reason: string) => reasons.push(`HOLD: ${reason}`);
    const ids = [...new Set(binding.attemptIds.filter((id) => typeof id === 'string' && id.trim() !== ''))];
    if (!binding.journeyId.trim() || !binding.bootId.trim() || ids.length === 0
        || ids.length !== binding.attemptIds.length) {
        hold('the RWT receipt does not declare one journey, boot and every saved attempt for coaching readback');
    }

    const relevant = rows.filter((row) => ALL_PRACTICE_LOOP_FAMILIES.has(row?.event));
    const expectedAttemptIds = new Set(ids);
    const bound = relevant.filter((row) => row.journeyId === binding.journeyId && row.bootId === binding.bootId);
    if (relevant.some((row) => expectedAttemptIds.has(String(row.properties?.subject_attempt_id ?? ''))
        && (row.journeyId !== binding.journeyId || row.bootId !== binding.bootId))) {
        hold('a received coaching event for a declared saved attempt belongs to a different or unknown journey/boot');
    }

    const byAttempt = new Map<string, ReceivedPracticeLoopRow[]>();
    for (const row of bound) {
        const props = row.properties ?? {};
        const attemptId = props.subject_attempt_id;
        const product = props.product;
        const requestId = props.request_id;
        if (typeof attemptId !== 'string' || !attemptId.trim()
            || typeof product !== 'string' || !product
            || typeof requestId !== 'string' || !requestId.trim()) {
            hold(`received ${row.event} lacks saved-attempt, product or request ownership`);
            continue;
        }
        if (product !== binding.product) {
            hold(`received ${row.event} product does not match the declared ${binding.product} journey`);
            continue;
        }
        if (!ids.includes(attemptId)) {
            hold(`received ${row.event} names an attempt not declared by this RWT receipt`);
            continue;
        }
        const group = byAttempt.get(attemptId) ?? [];
        group.push(row);
        byAttempt.set(attemptId, group);
    }

    let receivedRequests = 0;
    const requestOwners = new Map<string, string>();
    for (const attemptId of ids) {
        const attemptRows = byAttempt.get(attemptId) ?? [];
        const requestIds = [...new Set(attemptRows.map((row) => row.properties?.request_id).filter((id): id is string => typeof id === 'string' && id.length > 0))];
        receivedRequests += requestIds.length;
        for (const requestId of requestIds) {
            const owner = requestOwners.get(requestId);
            if (owner && owner !== attemptId) hold('one request ID is reused by more than one saved attempt');
            else requestOwners.set(requestId, attemptId);
        }
        if (requestIds.length === 0) {
            hold(`attempt ${attemptId} has no received coaching request`);
            continue;
        }
        if (requestIds.length > 1) fail(`attempt ${attemptId} has ${requestIds.length} distinct coaching requests; exactly one is allowed`);

        const requestRows = attemptRows.filter((row) => row.properties?.request_id === requestIds[0]);
        const counts = new Map<string, number>();
        for (const row of requestRows) counts.set(row.event, (counts.get(row.event) ?? 0) + 1);
        const duplicates = [...counts].filter(([, count]) => count > 1).map(([event]) => event);
        if (duplicates.length > 0) fail(`attempt ${attemptId} has duplicate received coaching events: ${duplicates.join(', ')}`);

        const failedCount = counts.get('practice_loop_review_failed') ?? 0;
        const successCount = PRACTICE_LOOP_RECEIPT_FAMILIES.slice(1).reduce((sum, family) => sum + (counts.get(family) ?? 0), 0);
        if (failedCount > 0 && successCount > 0) {
            fail(`attempt ${attemptId} has conflicting failed and successful coaching outcomes`);
            continue;
        }
        if (failedCount > 0) {
            fail(`attempt ${attemptId} received a failed coaching outcome`);
            continue;
        }
        const missing = PRACTICE_LOOP_RECEIPT_FAMILIES.filter((family) => (counts.get(family) ?? 0) === 0);
        if (missing.length > 0) {
            hold(`attempt ${attemptId} is missing received coaching events: ${missing.join(', ')}`);
            continue;
        }
    }

    return {
        verdict: reasons.some((reason) => reason.startsWith('FAIL:')) ? 'FAIL' : reasons.length > 0 ? 'HOLD' : 'QUALIFIED',
        expectedRequests: ids.length,
        receivedRequests,
        reasons,
    };
}
