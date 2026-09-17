import type { GovernedEvent } from '../telemetryAllowlist';

/**
 * #1259 P2 — receipts that are singular by product contract.
 *
 * Several required families are intentionally repeatable (`recording_state`, `recording_intent`,
 * `stage_latency`, `journey_step`, and `practice_loop`). Treating every family as exactly-once would
 * reject an ordinary successful take. These three are different: one positive control is minted per
 * boot, and a controlled qualification journey contains one started and one saved session. A second
 * received row is therefore evidence of duplicate delivery, not richer coverage.
 */
export const EXACTLY_ONCE_RECEIPT_FAMILIES: readonly GovernedEvent[] = Object.freeze([
    'telemetry_positive_control',
    'session_started',
    'session_saved',
]);

export interface DeliveryReceiptRow {
    event: string;
    timestamp?: string | number | null;
    properties?: Record<string, unknown> | null;
}

export type DeliveryFailureCategory =
    | 'transport_not_initialized'
    | 'client_backpressure_observed'
    | 'required_receipt_missing_after_clean_drain'
    | 'unaccounted_delivery_gap';

export interface DeliveryFailure {
    category: DeliveryFailureCategory;
    affectedFamilies: string[];
}

export interface DeliveryReceiptResult {
    verdict: 'QUALIFIED' | 'HOLD';
    receivedCounts: Record<string, number>;
    missingFamilies: string[];
    duplicateFamilies: string[];
    attemptBindingProblems: string[];
    deliveryFailures: DeliveryFailure[];
    reasons: string[];
}

/** HogQL may return numeric properties as canonical decimal strings. Malformed values are unknown, not zero. */
const nonNegativeCount = (value: unknown): number | null => {
    if (typeof value === 'number') {
        return Number.isInteger(value) && value >= 0 ? value : null;
    }
    if (typeof value === 'string' && /^(?:0|[1-9]\d{0,8})$/.test(value)) {
        return Number(value);
    }
    return null;
};

const nonBlank = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0;

const timestampMs = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string' || value.trim().length === 0) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const isBootPositiveControl = (row: DeliveryReceiptRow): boolean =>
    row.event === 'telemetry_positive_control'
    && row.properties?.comparison_evidence_document_id == null;

/** Received production marker that can causally precede each journey receipt. */
const RECEIPT_MARKER_STAGE: Readonly<Partial<Record<string, string>>> = Object.freeze({
    session_started: 'intent_to_recording',
    session_saved: 'session_saved',
});

/**
 * Judge rows that have ALREADY been bound to the qualifying boot and journey.
 *
 * The decision is made from received-vendor rows only. Producer calls, the local queue, and
 * `posthog.capture()` are deliberately absent: each can report success while the vendor has no row.
 * Existing content-free health fields name where an absence became observable:
 *
 * - `transport_initialized=false`: the SDK transport never initialized;
 * - `backpressure_dropped` / a pagehide drop: the client queue discarded events;
 * - a received clean-drain health row plus a missing required receipt: the required row is absent
 *   despite a clean drain receipt (without pretending this proves the producer ran);
 * - no received diagnostic: an explicit unaccounted delivery gap, never an inferred success.
 */
export function evaluateDeliveryReceipts(
    rows: readonly DeliveryReceiptRow[],
    exactlyOnce: readonly string[] = EXACTLY_ONCE_RECEIPT_FAMILIES,
): DeliveryReceiptResult {
    const receivedCounts = Object.fromEntries(exactlyOnce.map((family) => [family, 0])) as Record<string, number>;
    for (const row of rows) {
        const countable = row?.event !== 'telemetry_positive_control' || isBootPositiveControl(row);
        if (countable && Object.prototype.hasOwnProperty.call(receivedCounts, row?.event)) {
            receivedCounts[row.event] += 1;
        }
    }

    const missingFamilies = exactlyOnce.filter((family) => receivedCounts[family] === 0);
    const duplicateFamilies = exactlyOnce.filter((family) => receivedCounts[family] > 1);
    const attemptBindingProblems: string[] = [];
    if (receivedCounts.session_started === 1 && receivedCounts.session_saved === 1) {
        const startAttempt = rows.find((row) => row.event === 'session_started')?.properties?.attempt_id;
        const saveAttempt = rows.find((row) => row.event === 'session_saved')?.properties?.attempt_id;
        if (!nonBlank(startAttempt) || !nonBlank(saveAttempt)) {
            attemptBindingProblems.push('session_started and session_saved must carry non-empty attempt_id values');
        } else if (startAttempt !== saveAttempt) {
            attemptBindingProblems.push('session_started and session_saved must name the same recording attempt');
        }
    }
    const health = rows.filter((row) => row?.event === 'telemetry_health');
    const controls = rows.filter(isBootPositiveControl);

    const transportNotInitialized = controls.some((row) => row.properties?.transport_initialized === false);
    const deliveryFailures: DeliveryFailure[] = [];
    if (missingFamilies.length > 0) {
        if (transportNotInitialized) {
            deliveryFailures.push({
                category: 'transport_not_initialized',
                affectedFamilies: [...missingFamilies],
            });
        } else {
            // A boot can contain many flushes. A clean drain from before this take cannot explain a
            // later missing receipt, so classify each missing family only from health rows received
            // AFTER its received `stage_latency` production marker. With no causal marker the honest
            // answer is unaccounted, never an invented vendor boundary.
            const grouped = new Map<DeliveryFailureCategory, string[]>();
            for (const family of missingFamilies) {
                const markerStage = RECEIPT_MARKER_STAGE[family];
                const markerTimes = markerStage === undefined ? [] : rows
                    .filter((row) => row.event === 'stage_latency' && row.properties?.stage === markerStage)
                    .map((row) => timestampMs(row.timestamp))
                    .filter((value): value is number => value !== null);
                const marker = markerTimes.length > 0 ? Math.max(...markerTimes) : null;
                const afterMarker = marker === null ? [] : health.filter((row) => {
                    const at = timestampMs(row.timestamp);
                    return at !== null && at >= marker;
                });
                const backpressureDropped = afterMarker.some((row) => {
                    const outcome = row.properties?.flush_outcome;
                    return (outcome === 'backpressure_dropped' || outcome === 'pagehide_drained')
                        && (nonNegativeCount(row.properties?.dropped_count) ?? 0) > 0;
                });
                const cleanDrainReceived = afterMarker.some((row) =>
                    row.properties?.flush_outcome === 'drained'
                    && nonNegativeCount(row.properties?.dropped_count) === 0);
                const category: DeliveryFailureCategory = backpressureDropped
                    ? 'client_backpressure_observed'
                    : cleanDrainReceived
                        ? 'required_receipt_missing_after_clean_drain'
                        : 'unaccounted_delivery_gap';
                grouped.set(category, [...(grouped.get(category) ?? []), family]);
            }
            for (const [category, affectedFamilies] of grouped) {
                deliveryFailures.push({ category, affectedFamilies });
            }
        }
    } else if (transportNotInitialized) {
        // Contradictory evidence is not accepted. A row claiming an uninitialised transport cannot be
        // used as proof that the same transport worked, even if all expected names are also present.
        deliveryFailures.push({
            category: 'transport_not_initialized',
            affectedFamilies: [...exactlyOnce],
        });
    }

    const reasons: string[] = [];
    if (missingFamilies.length > 0) {
        reasons.push(`required singleton receipts never received: ${missingFamilies.join(', ')}`);
    }
    if (duplicateFamilies.length > 0) {
        reasons.push(`required singleton receipts received more than once: ${duplicateFamilies.join(', ')}`);
    }
    reasons.push(...attemptBindingProblems);
    for (const failure of deliveryFailures) {
        reasons.push(`${failure.category}: ${failure.affectedFamilies.join(', ')}`);
    }

    return {
        verdict: missingFamilies.length === 0
            && duplicateFamilies.length === 0
            && attemptBindingProblems.length === 0
            && deliveryFailures.length === 0
            ? 'QUALIFIED'
            : 'HOLD',
        receivedCounts,
        missingFamilies: [...missingFamilies],
        duplicateFamilies: [...duplicateFamilies],
        attemptBindingProblems,
        deliveryFailures,
        reasons,
    };
}
