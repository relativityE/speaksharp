/**
 * #1258 — received-side Practice Loop proof for one RWT recording journey.
 *
 * The PostHog query already binds rows to the controlled identity, release, traffic class and bounded
 * time window. This evaluator adds the take-level binding the query cannot infer, from the ownership
 * fields the producers emit under contract 6037393538 (App Dev candidate `fix/1258-coaching-event-ownership`
 * 6d840e1e2):
 *
 *   - `subject_boot_id` / `subject_journey_id` / `subject_attempt_id` — the saved take's frozen identity.
 *     A take this tab did not record has none; such a row cannot be bound and, unless it is a stored
 *     render, could hide a request for a declared take (HOLD);
 *   - `product` — read ONLY from the take-bound coaching rows: absent is HOLD, a product other than the
 *     declared one is FAIL. Other product-bearing events in the journey are not evidence about this take: a
 *     journey spans Session -> Analytics -> Session (useJourneyBoundary), where a revisit can legitimately
 *     name another saved session's product;
 *   - `review_request_seq` — one logical review lifecycle, shared by its requested and terminal events and
 *     by the render of the pair it generated. A per-tab counter that wraps after REVIEW_REQUEST_SEQ_MAX, so
 *     it is only ever read together with the take subject: two takes may legitimately share a value across
 *     a wrap, while one take showing a value twice is a duplicate delivery or a second lifecycle — FAIL
 *     either way, so the wrap never makes a verdict ambiguous;
 *   - `invocations` — server calls inside that one lifecycle (the bounded retry). A retry is NOT a second
 *     generation request; it is reported, and completed/persisted disagreeing on it is a conflict;
 *   - `review_source` — `generated` renders carry the lifecycle seq and count toward it; `stored` renders
 *     (revisit, reload) carry none and never count as a generation.
 *
 * Missing, malformed or unbindable evidence is HOLD. A single observed complete lifecycle is also HOLD:
 * this readback has no declared PostHog ingestion-settlement policy, so delayed duplicate rows cannot be
 * ruled out from one query snapshot (or merely by repeating an unchanged query). An observed failure,
 * a conflict, a duplicate outcome or more than one lifecycle for one take is FAIL. Ownership is never inferred.
 */
export const PRACTICE_LOOP_RECEIPT_FAMILIES = Object.freeze([
    'practice_loop_review_requested',
    'practice_loop_review_completed',
    'practice_loop_review_persisted',
    'practice_loop_review_rendered',
] as const);

/** Mirrors the producer's `REVIEW_REQUEST_SEQ_MAX` and the allowlist range for `review_request_seq`. */
export const REVIEW_REQUEST_SEQ_MAX = 1000;
const INVOCATIONS_MAX = 10;

const FAILED = 'practice_loop_review_failed';
const RENDERED = 'practice_loop_review_rendered';
const ALL_PRACTICE_LOOP_FAMILIES = new Set<string>([...PRACTICE_LOOP_RECEIPT_FAMILIES, FAILED]);

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
    verdict: 'QUALIFIED' | 'HOLD' | 'FAIL';
    expectedRequests: number;
    /** Distinct received review lifecycles across the declared takes (exactly one per take qualifies). */
    receivedRequests: number;
    /** Highest server-call count a declared take's lifecycle reported (>1 = an internal retry, still one request). */
    maxInvocations: number;
    reasons: string[];
}

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const boundedInt = (value: unknown, max: number): number | null => {
    const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
    return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
};

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
    const byAttempt = new Map<string, ReceivedPracticeLoopRow[]>();
    for (const row of rows.filter((r) => ALL_PRACTICE_LOOP_FAMILIES.has(r?.event))) {
        const props = row.properties ?? {};
        const attemptId = props.subject_attempt_id;
        if (!nonEmpty(attemptId)) {
            // A stored render (revisit/reload) is never a generation and needs no take.
            if (row.event === RENDERED && props.review_source === 'stored') continue;
            if (inJourney(row)) hold(`received ${row.event} in this journey names no saved take, so it could hide a request for a declared take`);
            continue;
        }
        if (!ids.includes(attemptId)) continue;
        if (!inJourney(row)) {
            hold(`received ${row.event} for declared take ${attemptId} arrived under a different or unknown journey/boot`);
            continue;
        }
        if (props.subject_journey_id !== binding.journeyId || props.subject_boot_id !== binding.bootId) {
            hold(`received ${row.event} names take ${attemptId} with a subject journey/boot other than the declared recording`);
            continue;
        }
        if (!nonEmpty(props.product)) {
            hold(`received ${row.event} for take ${attemptId} carries no product`);
            continue;
        }
        if (props.product !== binding.product) {
            fail(`received ${row.event} for take ${attemptId} names product ${String(props.product)}, not the declared ${binding.product}`);
            continue;
        }
        const group = byAttempt.get(attemptId) ?? [];
        group.push(row);
        byAttempt.set(attemptId, group);
    }

    let receivedRequests = 0;
    let maxInvocations = 0;
    for (const attemptId of ids) {
        const attemptReasonStart = reasons.length;
        const lifecycle: { row: ReceivedPracticeLoopRow; seq: number }[] = [];
        for (const row of byAttempt.get(attemptId) ?? []) {
            const props = row.properties ?? {};
            if (row.event === RENDERED) {
                if (props.review_source === 'stored') {
                    if (props.review_request_seq !== undefined && props.review_request_seq !== null) {
                        hold(`take ${attemptId} has a stored render that carries a request seq`);
                    }
                    continue;
                }
                if (props.review_source !== 'generated') {
                    hold(`take ${attemptId} has a render with no generated/stored source`);
                    continue;
                }
            }
            const seq = boundedInt(props.review_request_seq, REVIEW_REQUEST_SEQ_MAX);
            if (seq === null) {
                hold(`received ${row.event} for take ${attemptId} carries no valid review_request_seq`);
                continue;
            }
            lifecycle.push({ row, seq });
        }

        const seqs = [...new Set(lifecycle.map((entry) => entry.seq))];
        receivedRequests += seqs.length;
        if (seqs.length > 1) {
            fail(`take ${attemptId} has ${seqs.length} distinct review lifecycles; exactly one generation request is allowed`);
            continue;
        }
        const counts = new Map<string, number>();
        for (const { row } of lifecycle) counts.set(row.event, (counts.get(row.event) ?? 0) + 1);

        const requested = counts.get('practice_loop_review_requested') ?? 0;
        if (requested > 1) fail(`take ${attemptId} received its review request ${requested} times (a duplicate delivery or a second lifecycle reusing the seq)`);
        const duplicates = PRACTICE_LOOP_RECEIPT_FAMILIES.slice(1).filter((family) => (counts.get(family) ?? 0) > 1);
        if (duplicates.length > 0) fail(`take ${attemptId} has duplicate received coaching outcomes: ${duplicates.join(', ')}`);

        const failedCount = counts.get(FAILED) ?? 0;
        const successCount = PRACTICE_LOOP_RECEIPT_FAMILIES.slice(1).reduce((sum, family) => sum + (counts.get(family) ?? 0), 0);
        if (failedCount > 0) {
            fail(successCount > 0
                ? `take ${attemptId} has conflicting failed and successful coaching outcomes`
                : `take ${attemptId} received a failed coaching outcome`);
            continue;
        }

        const terminalInvocations = lifecycle
            .filter(({ row }) => row.event === 'practice_loop_review_completed' || row.event === 'practice_loop_review_persisted')
            .map(({ row }) => boundedInt(row.properties?.invocations, INVOCATIONS_MAX));
        if (terminalInvocations.some((n) => n === null)) {
            hold(`take ${attemptId} has a completed/persisted event with no valid invocations count`);
        } else if (new Set(terminalInvocations).size > 1) {
            fail(`take ${attemptId} reports conflicting invocation counts for one lifecycle`);
        }
        for (const n of terminalInvocations) if (n !== null) maxInvocations = Math.max(maxInvocations, n);

        const missing = PRACTICE_LOOP_RECEIPT_FAMILIES.filter((family) => (counts.get(family) ?? 0) === 0);
        if (missing.length > 0) hold(`take ${attemptId} is missing received coaching events: ${missing.join(', ')}`);
        else if (seqs.length === 1 && requested === 1 && duplicates.length === 0 && failedCount === 0
            && !reasons.slice(attemptReasonStart).some((reason) => reason.startsWith('FAIL:'))) {
            hold(`take ${attemptId} has one complete received lifecycle, but delayed duplicate ingestion cannot be ruled out without a declared settlement policy`);
        }
    }

    return {
        verdict: reasons.some((reason) => reason.startsWith('FAIL:')) ? 'FAIL' : reasons.length > 0 ? 'HOLD' : 'QUALIFIED',
        expectedRequests: ids.length,
        receivedRequests,
        maxInvocations,
        reasons,
    };
}
