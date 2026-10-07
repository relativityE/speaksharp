import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
    evaluateReceivedPracticeLoop, PRACTICE_LOOP_RECEIPT_FAMILIES, REVIEW_REQUEST_SEQ_MAX, type ReceivedPracticeLoopRow,
} from '../receivedPracticeLoopGate';
import { buildReadbackQuery } from '../bootScopedReceipts';

/**
 * Rows in the received shape of the App Dev producer candidate `fix/1258-coaching-event-ownership` 6d840e1e2
 * (contract 6037393538): envelope journey/boot, the saved take's frozen `subject_*`, product, one
 * `review_request_seq` per logical lifecycle, `invocations` on terminal events, `review_source` on renders.
 */
const binding = { journeyId: 'journey-a', bootId: 'boot-a', product: 'open_mic' as const, attemptIds: ['attempt-a'] };
const owned = (attemptId: string, seq: number | null = 1) => ({
    subject_boot_id: 'boot-a', subject_journey_id: 'journey-a', subject_attempt_id: attemptId, subject_attempt_seq: 1,
    product: 'open_mic', ...(seq === null ? {} : { review_request_seq: seq }),
});
const row = (event: string, properties: Record<string, unknown>, extra: Partial<ReceivedPracticeLoopRow> = {}): ReceivedPracticeLoopRow => ({
    event, journeyId: 'journey-a', bootId: 'boot-a', properties, ...extra,
});
const requested = (attemptId = 'attempt-a', seq = 1) => row('practice_loop_review_requested', { review_ready: true, ...owned(attemptId, seq) });
const completed = (attemptId = 'attempt-a', seq = 1, invocations = 1) => row('practice_loop_review_completed', { ...owned(attemptId, seq), invocations });
const persisted = (attemptId = 'attempt-a', seq = 1, invocations = 1) => row('practice_loop_review_persisted', { ...owned(attemptId, seq), invocations });
const renderedGenerated = (attemptId = 'attempt-a', seq = 1) => row('practice_loop_review_rendered', { ...owned(attemptId, seq), review_source: 'generated' });
const renderedStored = (props: Record<string, unknown> = { product: 'open_mic' }) => row('practice_loop_review_rendered', { ...props, review_source: 'stored' });
const failed = (attemptId = 'attempt-a', seq = 1) => row('practice_loop_review_failed', { reason: 'network', ...owned(attemptId, seq), invocations: 2 });
const complete = (attemptId = 'attempt-a', seq = 1, invocations = 1): ReceivedPracticeLoopRow[] =>
    [requested(attemptId, seq), completed(attemptId, seq, invocations), persisted(attemptId, seq, invocations), renderedGenerated(attemptId, seq)];
const evaluate = (rows: ReceivedPracticeLoopRow[], b = binding) => evaluateReceivedPracticeLoop(rows, b);

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
        for (const field of ['subject_attempt_id', 'subject_journey_id', 'subject_boot_id', 'product', 'review_request_seq', 'invocations', 'review_source']) {
            expect(query).toContain(`properties.${field} AS ${field}`);
        }
        expect(query).not.toContain('properties.*');
        expect(query).not.toMatch(/session_id/);
    });

    it('one complete lifecycle for the saved take qualifies', () => {
        expect(evaluate(complete())).toEqual({ verdict: 'QUALIFIED', expectedRequests: 1, receivedRequests: 1, maxInvocations: 1, reasons: [] });
    });

    it('RETRY: an internal retry inside one lifecycle (invocations 2) is still one generation request', () => {
        expect(evaluate(complete('attempt-a', 1, 2))).toMatchObject({ verdict: 'QUALIFIED', receivedRequests: 1, maxInvocations: 2 });
    });

    it('reload/cached revisit is not a generation: stored renders and saved_review_revisited never count', () => {
        const rows = [...complete(), renderedStored(), renderedStored(owned('attempt-a', null)),
            row('saved_review_revisited', { product: 'open_mic', review_state: 'review' })];
        expect(evaluate(rows)).toMatchObject({ verdict: 'QUALIFIED', receivedRequests: 1 });
    });

    it('PRE-PRODUCER RELEASE: rows without ownership fields HOLD, never qualify', () => {
        const legacy = PRACTICE_LOOP_RECEIPT_FAMILIES.map((family) => row(family, { attempt_id: 'attempt-a' }));
        const result = evaluate(legacy);
        expect(result.verdict).toBe('HOLD');
        expect(result.reasons.join(' ')).toMatch(/names no saved take/);
    });

    it('HOLDs a sent-but-not-yet-received or partially ingested lifecycle, and names what is missing', () => {
        const partial = evaluate(complete().slice(0, 2));
        expect(partial.verdict).toBe('HOLD');
        expect(partial.reasons.join(' ')).toMatch(/missing received coaching events: practice_loop_review_persisted, practice_loop_review_rendered/);
        expect(evaluate([]).reasons.join(' ')).toMatch(/missing received coaching events: practice_loop_review_requested/);
    });

    it('HOLDs a take whose only render is stored: the generated render is missing', () => {
        const rows = [requested(), completed(), persisted(), renderedStored(owned('attempt-a', null))];
        expect(evaluate(rows).reasons.join(' ')).toMatch(/missing received coaching events: practice_loop_review_rendered/);
    });

    it('HOLDs unbindable evidence: another journey/boot, a different subject journey/boot, no product, no or invalid seq, no source', () => {
        const cases: ReceivedPracticeLoopRow[][] = [
            complete().map((r) => ({ ...r, journeyId: 'journey-b' })),
            complete().map((r) => ({ ...r, bootId: 'boot-b' })),
            complete().map((r) => ({ ...r, properties: { ...r.properties, subject_journey_id: 'journey-b' } })),
            complete().map((r) => ({ ...r, properties: { ...r.properties, subject_boot_id: 'boot-b' } })),
            complete().map((r) => ({ ...r, properties: { ...r.properties, product: undefined } })),
            complete().map((r) => ({ ...r, properties: { ...r.properties, review_request_seq: undefined } })),
            complete().map((r) => ({ ...r, properties: { ...r.properties, review_request_seq: 0 } })),
            complete().map((r) => ({ ...r, properties: { ...r.properties, review_request_seq: REVIEW_REQUEST_SEQ_MAX + 1 } })),
            complete().map((r) => ({ ...r, properties: { ...r.properties, review_request_seq: 1.5 } })),
            [requested(), completed(), persisted(), row('practice_loop_review_rendered', owned('attempt-a'))],
            [requested(), row('practice_loop_review_completed', owned('attempt-a')), persisted(), renderedGenerated()],
            [...complete(), renderedStored(owned('attempt-a', 7))],
        ];
        for (const rows of cases) expect(evaluate(rows).verdict).toBe('HOLD');
    });

    it('HOLDs a coaching row in the journey that names no take: it could hide a second request', () => {
        const result = evaluate([...complete(), row('practice_loop_review_requested', { review_ready: true, product: 'open_mic', review_request_seq: 2 })]);
        expect(result.verdict).toBe('HOLD');
        expect(result.reasons.join(' ')).toMatch(/names no saved take/);
    });

    it('HOLDs when a non-coaching product-bearing row in the journey contradicts the declared product', () => {
        expect(evaluate([...complete(), row('saved_review_practice_action', { product: 'focus_points' })]).verdict).toBe('HOLD');
        expect(evaluate([...complete(), row('saved_review_practice_action', { product: 'unknown' })]).verdict).toBe('QUALIFIED');
    });

    it('HOLDs an incomplete receipt binding (no boot, no attempts, duplicate attempt ids)', () => {
        expect(evaluate(complete(), { ...binding, bootId: '' }).verdict).toBe('HOLD');
        expect(evaluate(complete(), { ...binding, attemptIds: [] }).verdict).toBe('HOLD');
        expect(evaluate(complete(), { ...binding, attemptIds: ['attempt-a', 'attempt-a'] }).verdict).toBe('HOLD');
    });

    it('FAILs a received product that contradicts the declared product on the bound take', () => {
        expect(evaluate(complete().map((r) => ({ ...r, properties: { ...r.properties, product: 'focus_points' } }))).verdict).toBe('FAIL');
    });

    it('FAILs an extra generation request for one take: a second lifecycle, even if only partly received', () => {
        expect(evaluate([...complete(), requested('attempt-a', 2)])).toMatchObject({ verdict: 'FAIL', receivedRequests: 2 });
        expect(evaluate([...complete(), completed('attempt-a', 2)]).verdict).toBe('FAIL');
        expect(evaluate([...complete(), renderedGenerated('attempt-a', 2)]).verdict).toBe('FAIL');
    });

    it('FAILs an observed failure, conflicting success/failure, duplicate outcomes, and disagreeing invocation counts', () => {
        expect(evaluate([requested(), failed()]).verdict).toBe('FAIL');
        expect(evaluate([...complete(), failed()]).verdict).toBe('FAIL');
        expect(evaluate([...complete(), renderedGenerated()]).verdict).toBe('FAIL');
        expect(evaluate([requested(), completed('attempt-a', 1, 1), persisted('attempt-a', 1, 2), renderedGenerated()]).verdict).toBe('FAIL');
    });

    it('a conflict outranks missing evidence: FAIL, not HOLD', () => {
        expect(evaluate([requested(), requested('attempt-a', 2)]).verdict).toBe('FAIL');
    });

    describe('request-sequence wrap (REVIEW_REQUEST_SEQ_MAX)', () => {
        it('the gate range mirrors the producer counter and the allowlist', () => {
            const producer = path.resolve(__dirname, '../reviewSubject.ts');
            const subject = existsSync(producer) ? readFileSync(producer, 'utf8').match(/REVIEW_REQUEST_SEQ_MAX = (\d+)/)?.[1] : undefined;
            // The producer module lives on the App Dev candidate; on a base without it the mirror is checked by the probe.
            expect(subject === undefined || Number(subject) === REVIEW_REQUEST_SEQ_MAX).toBe(true);
            expect(REVIEW_REQUEST_SEQ_MAX).toBe(1000);
        });

        it('two takes sharing a seq after a wrap stay independent: each pairs by take + seq', () => {
            const both = { ...binding, attemptIds: ['attempt-a', 'attempt-b'] };
            expect(evaluate([...complete('attempt-a', REVIEW_REQUEST_SEQ_MAX), ...complete('attempt-b', REVIEW_REQUEST_SEQ_MAX)], both))
                .toMatchObject({ verdict: 'QUALIFIED', expectedRequests: 2, receivedRequests: 2 });
            expect(evaluate([...complete('attempt-a', 1), ...complete('attempt-b', 1)], both).verdict).toBe('QUALIFIED');
        });

        it('one take showing the same seq twice is a duplicate or a wrapped second lifecycle — FAIL either way, never ambiguous', () => {
            expect(evaluate([...complete(), requested()]).verdict).toBe('FAIL');
            expect(evaluate([...complete(), completed()]).verdict).toBe('FAIL');
        });

        it('a boundary seq (1 and MAX) is valid; a take whose lifecycle spans the wrap (MAX then 1) is two lifecycles — FAIL', () => {
            expect(evaluate(complete('attempt-a', 1)).verdict).toBe('QUALIFIED');
            expect(evaluate(complete('attempt-a', REVIEW_REQUEST_SEQ_MAX)).verdict).toBe('QUALIFIED');
            expect(evaluate([...complete('attempt-a', REVIEW_REQUEST_SEQ_MAX), requested('attempt-a', 1)]).verdict).toBe('FAIL');
        });
    });

    it('each declared saved take needs its own lifecycle; one take cannot borrow another\'s events', () => {
        const both = { ...binding, attemptIds: ['attempt-a', 'attempt-b'] };
        expect(evaluate(complete('attempt-a'), both).reasons.join(' ')).toMatch(/take attempt-b is missing/);
        expect(evaluate(complete('attempt-b')).reasons.join(' ')).toMatch(/take attempt-a is missing/);
    });

    it('an undeclared take in the same journey neither counts against the declared take nor fills its gap', () => {
        expect(evaluate([...complete(), ...complete('attempt-other', 2)])).toMatchObject({ verdict: 'QUALIFIED', receivedRequests: 1 });
        expect(evaluate(complete('attempt-other')).reasons.join(' ')).toMatch(/take attempt-a is missing/);
    });
});
