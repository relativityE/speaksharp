import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { evaluateReceivedPracticeLoop, PRACTICE_LOOP_RECEIPT_FAMILIES, PRODUCER_GAP_REASON, type ReceivedPracticeLoopRow } from '../receivedPracticeLoopGate';
import { buildReadbackQuery } from '../bootScopedReceipts';

const binding = { journeyId: 'journey-a', bootId: 'boot-a', product: 'open_mic' as const, attemptIds: ['attempt-a'] };
// The received shape: envelope journey/boot/attempt only. The producers emit no product or request id on these events.
const row = (event: string, attemptId: string | null = 'attempt-a', extra: Partial<ReceivedPracticeLoopRow> = {}): ReceivedPracticeLoopRow => ({
    event, journeyId: 'journey-a', bootId: 'boot-a', properties: { attempt_id: attemptId }, ...extra,
});
const complete = (attemptId = 'attempt-a'): ReceivedPracticeLoopRow[] =>
    PRACTICE_LOOP_RECEIPT_FAMILIES.map((family) => row(family, attemptId));

describe('received Practice Loop readback', () => {
    it('the production query selects only governed ownership fields and pins identity, release, traffic and time window', () => {
        const query = buildReadbackQuery({
            windowHours: 6, releaseSha: 'release-a', trafficType: 'canary', qualifyingIdentity: 'identity-a',
            governedEvents: ['practice_loop_review_requested'], quote: (value) => `'${value}'`,
        });
        expect(query).toContain('timestamp > now() - INTERVAL 6 HOUR');
        expect(query).toContain("properties.release_sha = 'release-a'");
        expect(query).toContain("properties.traffic_type = 'canary'");
        expect(query).toContain("distinct_id = 'identity-a'");
        expect(query).toContain('properties.attempt_id AS attempt_id');
        expect(query).toContain('properties.product AS product');
        expect(query).not.toContain('request_id');
        expect(query).not.toContain('properties.*');
    });

    it('SOURCE CONTRACT: the gate reads only fields the governed producers emit', () => {
        const gate = readFileSync(path.resolve(__dirname, '../receivedPracticeLoopGate.ts'), 'utf8');
        const code = gate.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
        expect(code).not.toMatch(/request_id|subject_attempt_id/);
        const producer = readFileSync(path.resolve(__dirname, '../../practiceLoopTelemetry.ts'), 'utf8');
        expect(producer).not.toMatch(/request_id|product/);
    });

    it('PRODUCER GAP: one complete lifecycle for the saved take HOLDs with only the producer-gap reason; it never qualifies', () => {
        expect(evaluateReceivedPracticeLoop(complete(), binding)).toEqual({
            verdict: 'HOLD', expectedRequests: 1, receivedRequests: 1, reasons: [PRODUCER_GAP_REASON],
        });
    });

    it('reload/cached revisit is not a generation request: it adds no reason beyond the producer gap', () => {
        const rows = [...complete(), { event: 'saved_review_revisited', journeyId: 'journey-a', bootId: 'boot-a', properties: { product: 'open_mic', attempt_id: 'attempt-a' } }];
        expect(evaluateReceivedPracticeLoop(rows, binding)).toMatchObject({ verdict: 'HOLD', receivedRequests: 1, reasons: [PRODUCER_GAP_REASON] });
    });

    it('HOLDs a sent-but-not-yet-received or partially ingested lifecycle, and names what is missing', () => {
        const partial = evaluateReceivedPracticeLoop(complete().slice(0, 2), binding);
        expect(partial.verdict).toBe('HOLD');
        expect(partial.reasons.join(' ')).toMatch(/missing received coaching events: practice_loop_review_persisted, practice_loop_review_rendered/);
        expect(evaluateReceivedPracticeLoop([], binding).reasons.join(' ')).toMatch(/missing received coaching events: practice_loop_review_requested/);
    });

    it('HOLDs when the declared take\'s events arrive under another journey or boot', () => {
        expect(evaluateReceivedPracticeLoop(complete().map((r) => ({ ...r, journeyId: 'journey-b' })), binding).verdict).toBe('HOLD');
        expect(evaluateReceivedPracticeLoop(complete().map((r) => ({ ...r, bootId: 'boot-b' })), binding).verdict).toBe('HOLD');
    });

    it('HOLDs a coaching row in the journey with no attempt_id: it could hide a second request', () => {
        const result = evaluateReceivedPracticeLoop([...complete(), row('practice_loop_review_requested', null)], binding);
        expect(result.verdict).toBe('HOLD');
        expect(result.reasons.join(' ')).toMatch(/carries no attempt_id/);
    });

    it('HOLDs when a product-bearing row in the journey contradicts the declared product', () => {
        const rows = [...complete(), { event: 'saved_review_practice_action', journeyId: 'journey-a', bootId: 'boot-a', properties: { product: 'focus_points' } }];
        expect(evaluateReceivedPracticeLoop(rows, binding).verdict).toBe('HOLD');
        const unknown = [...complete(), { event: 'saved_review_practice_action', journeyId: 'journey-a', bootId: 'boot-a', properties: { product: 'unknown' } }];
        expect(evaluateReceivedPracticeLoop(unknown, binding).reasons).toEqual([PRODUCER_GAP_REASON]);
    });

    it('HOLDs an incomplete receipt binding (no boot, no attempts, duplicate attempt ids)', () => {
        expect(evaluateReceivedPracticeLoop(complete(), { ...binding, bootId: '' }).verdict).toBe('HOLD');
        expect(evaluateReceivedPracticeLoop(complete(), { ...binding, attemptIds: [] }).verdict).toBe('HOLD');
        expect(evaluateReceivedPracticeLoop(complete(), { ...binding, attemptIds: ['attempt-a', 'attempt-a'] }).verdict).toBe('HOLD');
    });

    it('FAILs when a take has an extra generation request', () => {
        const result = evaluateReceivedPracticeLoop([...complete(), row('practice_loop_review_requested')], binding);
        expect(result).toMatchObject({ verdict: 'FAIL', receivedRequests: 2 });
    });

    it('FAILs an observed failure, conflicting success/failure, and duplicate outcomes', () => {
        expect(evaluateReceivedPracticeLoop([row('practice_loop_review_requested'), row('practice_loop_review_failed')], binding).verdict).toBe('FAIL');
        expect(evaluateReceivedPracticeLoop([...complete(), row('practice_loop_review_failed')], binding).verdict).toBe('FAIL');
        expect(evaluateReceivedPracticeLoop([...complete(), row('practice_loop_review_rendered')], binding).verdict).toBe('FAIL');
    });

    it('NEVER QUALIFIED while the producer gap stands, for any input', () => {
        for (const rows of [complete(), [...complete(), ...complete('attempt-other')], []]) {
            expect(evaluateReceivedPracticeLoop(rows, binding).verdict).not.toBe('QUALIFIED');
        }
    });

    it('a conflict outranks missing evidence: FAIL, not HOLD', () => {
        expect(evaluateReceivedPracticeLoop([row('practice_loop_review_requested'), row('practice_loop_review_requested')], binding).verdict).toBe('FAIL');
    });

    it('each declared saved take needs its own lifecycle; one take cannot borrow another\'s events', () => {
        const both = { ...binding, attemptIds: ['attempt-a', 'attempt-b'] };
        expect(evaluateReceivedPracticeLoop([...complete('attempt-a'), ...complete('attempt-b')], both)).toMatchObject({ verdict: 'HOLD', expectedRequests: 2, receivedRequests: 2, reasons: [PRODUCER_GAP_REASON] });
        expect(evaluateReceivedPracticeLoop(complete('attempt-a'), both).reasons.join(' ')).toMatch(/attempt attempt-b is missing/);
        expect(evaluateReceivedPracticeLoop(complete('attempt-b'), binding).reasons.join(' ')).toMatch(/attempt attempt-a is missing/);
    });

    it('an undeclared take in the same journey neither counts against the declared take nor fills its gap', () => {
        expect(evaluateReceivedPracticeLoop([...complete(), ...complete('attempt-other')], binding)).toMatchObject({ receivedRequests: 1, reasons: [PRODUCER_GAP_REASON] });
        expect(evaluateReceivedPracticeLoop(complete('attempt-other'), binding).reasons.join(' ')).toMatch(/attempt attempt-a is missing/);
    });
});
