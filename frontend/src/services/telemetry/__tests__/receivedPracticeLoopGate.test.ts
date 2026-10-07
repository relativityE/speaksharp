import { describe, expect, it } from 'vitest';
import { evaluateReceivedPracticeLoop, type ReceivedPracticeLoopRow } from '../receivedPracticeLoopGate';
import { buildReadbackQuery } from '../bootScopedReceipts';

const binding = { journeyId: 'journey-a', bootId: 'boot-a', product: 'open_mic' as const, attemptIds: ['attempt-a'] };
const row = (event: string, requestId = 'request-a', extra: Record<string, unknown> = {}): ReceivedPracticeLoopRow => ({
    event, journeyId: 'journey-a', bootId: 'boot-a',
    properties: { subject_attempt_id: 'attempt-a', product: 'open_mic', request_id: requestId, ...extra },
});
const complete = (): ReceivedPracticeLoopRow[] => [
    row('practice_loop_review_requested'), row('practice_loop_review_completed'),
    row('practice_loop_review_persisted'), row('practice_loop_review_rendered'),
];

describe('received Practice Loop readback', () => {
    it('the production query selects only governed ownership fields and pins identity, release, traffic and time window', () => {
        const query = buildReadbackQuery({
            windowHours: 6, releaseSha: 'release-a', trafficType: 'canary', qualifyingIdentity: 'identity-a',
            governedEvents: ['practice_loop_review_requested'], quote: (value) => `'${value}'`,
        });
        expect(query).toContain("timestamp > now() - INTERVAL 6 HOUR");
        expect(query).toContain("properties.release_sha = 'release-a'");
        expect(query).toContain("properties.traffic_type = 'canary'");
        expect(query).toContain("distinct_id = 'identity-a'");
        expect(query).toContain('properties.product AS product');
        expect(query).toContain('properties.request_id AS request_id');
        expect(query).not.toContain('properties.*');
    });

    it('one complete request lifecycle for the saved take qualifies', () => {
        expect(evaluateReceivedPracticeLoop(complete(), binding)).toMatchObject({ verdict: 'QUALIFIED', expectedRequests: 1, receivedRequests: 1 });
    });

    it('reload/cached revisit is not a generation request', () => {
        const rows = [...complete(), { event: 'saved_review_revisited', journeyId: 'journey-a', bootId: 'boot-a', properties: { product: 'open_mic' } }];
        expect(evaluateReceivedPracticeLoop(rows, binding).verdict).toBe('QUALIFIED');
    });

    it('HOLDs a sent-but-not-yet-received or partially ingested beacon; a later complete readback can qualify', () => {
        expect(evaluateReceivedPracticeLoop(complete().slice(0, 2), binding).verdict).toBe('HOLD');
        expect(evaluateReceivedPracticeLoop(complete(), binding).verdict).toBe('QUALIFIED');
    });

    it('HOLDs on wrong journey, boot, product, attempt, or missing request ownership', () => {
        for (const changed of [
            complete().map((r) => ({ ...r, journeyId: 'journey-b' })),
            complete().map((r) => ({ ...r, bootId: 'boot-b' })),
            complete().map((r) => ({ ...r, properties: { ...r.properties, product: 'focus_points' } })),
            complete().map((r) => ({ ...r, properties: { ...r.properties, subject_attempt_id: 'attempt-b' } })),
            complete().map((r) => ({ ...r, properties: { ...r.properties, request_id: undefined } })),
        ]) expect(evaluateReceivedPracticeLoop(changed, binding).verdict).toBe('HOLD');
    });

    it('FAILs when a take has an extra distinct generation request', () => {
        expect(evaluateReceivedPracticeLoop([...complete(), row('practice_loop_review_requested', 'request-b')], binding).verdict).toBe('FAIL');
    });

    it('FAILs conflicting success/failure and duplicate outcomes', () => {
        expect(evaluateReceivedPracticeLoop([...complete(), row('practice_loop_review_failed')], binding).verdict).toBe('FAIL');
        expect(evaluateReceivedPracticeLoop([...complete(), row('practice_loop_review_rendered')], binding).verdict).toBe('FAIL');
    });

    it('HOLDs when one request ID is reused across saved attempts', () => {
        const secondAttempt = complete().map((r) => ({
            ...r, properties: { ...r.properties, subject_attempt_id: 'attempt-b' },
        }));
        expect(evaluateReceivedPracticeLoop([...complete(), ...secondAttempt], {
            ...binding, attemptIds: ['attempt-a', 'attempt-b'],
        }).verdict).toBe('HOLD');
    });

    it('does not borrow a same-number or same-request event from another saved attempt', () => {
        const otherAttempt = complete().map((r) => ({ ...r, properties: { ...r.properties, subject_attempt_id: 'attempt-b' } }));
        expect(evaluateReceivedPracticeLoop(otherAttempt, { ...binding, attemptIds: ['attempt-a'] }).verdict).toBe('HOLD');
    });
});
