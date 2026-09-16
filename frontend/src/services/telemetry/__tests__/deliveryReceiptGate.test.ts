import { describe, expect, it } from 'vitest';
import {
    evaluateDeliveryReceipts,
    EXACTLY_ONCE_RECEIPT_FAMILIES,
    type DeliveryReceiptRow,
} from '../deliveryReceiptGate';

const row = (event: string, properties: Record<string, unknown> = {}, timestamp?: string): DeliveryReceiptRow => ({
    event,
    properties,
    timestamp,
});

const complete = (): DeliveryReceiptRow[] => EXACTLY_ONCE_RECEIPT_FAMILIES.map((event) =>
    row(event, event === 'session_started' || event === 'session_saved'
        ? { attempt_id: 'attempt-1' }
        : {}));

describe('#1259 P2 — received-vendor receipt cardinality and named delivery failures', () => {
    it('QUALIFIES when every singleton receipt was read back exactly once', () => {
        const result = evaluateDeliveryReceipts(complete());

        expect(result).toMatchObject({
            verdict: 'QUALIFIED',
            missingFamilies: [],
            duplicateFamilies: [],
            deliveryFailures: [],
        });
        expect(result.receivedCounts).toEqual(Object.fromEntries(
            EXACTLY_ONCE_RECEIPT_FAMILIES.map((family) => [family, 1]),
        ));
    });

    it('CASUALTY: a duplicate singleton receipt HOLDS instead of disappearing into a Set', () => {
        const result = evaluateDeliveryReceipts([...complete(), row('session_saved')]);

        expect(result.verdict).toBe('HOLD');
        expect(result.duplicateFamilies).toEqual(['session_saved']);
        expect(result.receivedCounts.session_saved).toBe(2);
        expect(result.reasons.join(' ')).toContain('received more than once');
    });

    it('CASUALTY: start and save receipts from different retries cannot be spliced into one qualified take', () => {
        const rows = complete();
        const saved = rows.find((candidate) => candidate.event === 'session_saved');
        if (saved?.properties) saved.properties.attempt_id = 'attempt-2';

        const result = evaluateDeliveryReceipts(rows);

        expect(result.verdict).toBe('HOLD');
        expect(result.receivedCounts).toMatchObject({ session_started: 1, session_saved: 1 });
        expect(result.attemptBindingProblems).toEqual([
            'session_started and session_saved must name the same recording attempt',
        ]);
    });

    it('CASUALTY: singleton start/save receipts without native attempt identity cannot qualify', () => {
        const rows = complete();
        const started = rows.find((candidate) => candidate.event === 'session_started');
        if (started?.properties) started.properties.attempt_id = null;

        const result = evaluateDeliveryReceipts(rows);

        expect(result.verdict).toBe('HOLD');
        expect(result.attemptBindingProblems).toEqual([
            'session_started and session_saved must carry non-empty attempt_id values',
        ]);
    });

    it('CASUALTY: a signed-document comparison control is not a second boot receipt', () => {
        const result = evaluateDeliveryReceipts([
            ...complete(),
            row('telemetry_positive_control', { comparison_evidence_document_id: 'evidence-1' }),
        ]);

        expect(result.verdict).toBe('QUALIFIED');
        expect(result.receivedCounts.telemetry_positive_control).toBe(1);
        expect(result.duplicateFamilies).toEqual([]);
    });

    it('CASUALTY: a missing receipt after a clean drain names the vendor-boundary gap', () => {
        const result = evaluateDeliveryReceipts([
            ...complete().filter((candidate) => candidate.event !== 'session_saved'),
            row('stage_latency', { stage: 'session_saved' }, '2026-09-16T12:00:00Z'),
            row('telemetry_health', { flush_outcome: 'drained', dropped_count: 0 }, '2026-09-16T12:00:01Z'),
        ]);

        expect(result.verdict).toBe('HOLD');
        expect(result.missingFamilies).toEqual(['session_saved']);
        expect(result.deliveryFailures).toEqual([{
            category: 'required_receipt_missing_after_clean_drain',
            affectedFamilies: ['session_saved'],
        }]);
    });

    it('CASUALTY: a client-side burst drop is named as backpressure, never vendor receipt', () => {
        const result = evaluateDeliveryReceipts([
            ...complete().filter((candidate) => candidate.event !== 'session_started'),
            row('stage_latency', { stage: 'intent_to_recording' }, '2026-09-16T12:00:00Z'),
            row('telemetry_health', { flush_outcome: 'backpressure_dropped', dropped_count: 3 }, '2026-09-16T12:00:01Z'),
        ]);

        expect(result.verdict).toBe('HOLD');
        expect(result.deliveryFailures).toEqual([{
            category: 'client_backpressure_observed',
            affectedFamilies: ['session_started'],
        }]);
    });

    it('CASUALTY: a string-valued HogQL drop count still proves client backpressure', () => {
        const result = evaluateDeliveryReceipts([
            ...complete().filter((candidate) => candidate.event !== 'session_started'),
            row('stage_latency', { stage: 'intent_to_recording' }, '2026-09-16T12:00:00Z'),
            row('telemetry_health', { flush_outcome: 'backpressure_dropped', dropped_count: '3' }, '2026-09-16T12:00:01Z'),
        ]);

        expect(result.verdict).toBe('HOLD');
        expect(result.deliveryFailures).toEqual([{
            category: 'client_backpressure_observed',
            affectedFamilies: ['session_started'],
        }]);
    });

    it('CASUALTY: a malformed drop count is not silently reclassified as a clean drain', () => {
        const result = evaluateDeliveryReceipts([
            ...complete().filter((candidate) => candidate.event !== 'session_saved'),
            row('stage_latency', { stage: 'session_saved' }, '2026-09-16T12:00:00Z'),
            row('telemetry_health', { flush_outcome: 'drained', dropped_count: 'not-a-count' }, '2026-09-16T12:00:01Z'),
        ]);

        expect(result.deliveryFailures).toEqual([{
            category: 'unaccounted_delivery_gap',
            affectedFamilies: ['session_saved'],
        }]);
    });

    it('CASUALTY: an uninitialised transport is a distinct named failure', () => {
        const result = evaluateDeliveryReceipts([
            ...complete().filter((candidate) => candidate.event !== 'session_started'),
            row('telemetry_positive_control', { transport_initialized: false }),
        ]);

        expect(result.verdict).toBe('HOLD');
        expect(result.deliveryFailures).toContainEqual({
            category: 'transport_not_initialized',
            affectedFamilies: ['session_started'],
        });
    });

    it('CASUALTY: an unexplained absence remains an explicit delivery failure', () => {
        const result = evaluateDeliveryReceipts(
            complete().filter((candidate) => candidate.event !== 'session_saved'),
        );

        expect(result.verdict).toBe('HOLD');
        expect(result.deliveryFailures).toEqual([{
            category: 'unaccounted_delivery_gap',
            affectedFamilies: ['session_saved'],
        }]);
    });

    it('CASUALTY: an earlier clean drain cannot diagnose a later missing receipt', () => {
        const result = evaluateDeliveryReceipts([
            ...complete().filter((candidate) => candidate.event !== 'session_saved'),
            row('telemetry_health', { flush_outcome: 'drained', dropped_count: 0 }, '2026-09-16T11:59:59Z'),
            row('stage_latency', { stage: 'session_saved' }, '2026-09-16T12:00:00Z'),
        ]);

        expect(result.deliveryFailures).toEqual([{
            category: 'unaccounted_delivery_gap',
            affectedFamilies: ['session_saved'],
        }]);
    });
});
