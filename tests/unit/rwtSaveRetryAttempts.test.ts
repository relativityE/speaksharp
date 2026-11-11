// AHT-05/06: `completion-attempts`, exact `retry-saved-once` and `review-reopen`, the harness checks the save-retry spec lacked.
// The exact-save port is cross-checked against the harness's own durable-save-oracle.cjs on the same inputs.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    type CompletionAttempt, type SavedRow, attemptEvidence, completionAttemptsVerdict, exactRetrySaveVerdict, parseCompletionAttempt,
    reviewReopenVerdict, transcriptDigest,
} from '../live/helpers/rwtSaveRetryAttempts';

const here = path.dirname(fileURLToPath(import.meta.url));
const harness = createRequire(import.meta.url)(path.resolve(here, '../../tools/cloud-test/harness/draft-adapters/durable-save-oracle.cjs')) as {
    compareSavedRows: (rows: unknown, op: unknown) => { durableSaved: boolean };
};
const sha = (v: string) => createHash('sha256').update(v).digest('hex');

const TAKE = '11111111-1111-4111-8111-111111111111';
const NEXT = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const payload = (over: Record<string, unknown> = {}) => ({
    p_session_id: TAKE, p_status: 'completed', p_final_duration: 42, p_reason: null, p_next_action: { kind: 'pace' },
    p_total_words: 90, p_clarity_score: 81, p_wpm: 128, p_filler_counts: { um: 2 }, p_pause_metrics: { count: 3 }, p_final_transcript: 'hello there',
    ...over,
});
const body = (over: Record<string, unknown> = {}) => JSON.stringify(payload(over));
const attempt = (ordinal: number, raw: string, afterRetry: boolean, dropped: boolean, httpStatus: number | null): CompletionAttempt =>
    ({ ...parseCompletionAttempt(ordinal, raw, afterRetry, dropped), httpStatus });

describe('completionAttemptsVerdict', () => {
    it('the fault, then one Retry with the same body answered 2xx → PASS; the next take is out of scope', () => {
        const a = [attempt(1, body(), false, true, null), attempt(2, body(), true, false, 200), attempt(3, body({ p_session_id: NEXT }), true, false, 200)];
        expect(completionAttemptsVerdict(a).status).toBe('PASS');
    });
    it('a third (late) attempt for the take or a changed body → FAIL (violation, as final-attempts.cjs)', () => {
        expect(completionAttemptsVerdict([attempt(1, body(), false, true, null), attempt(2, body(), true, false, 200), attempt(3, body(), true, false, 200)]).status).toBe('FAIL');
        expect(completionAttemptsVerdict([attempt(1, body(), false, true, null), attempt(2, body({ p_wpm: 129 }), true, false, 200)]))
            .toMatchObject({ status: 'FAIL', detail: expect.stringMatching(/changed the completion payload/) });
    });
    it('a non-2xx or unanswered Retry, or no Retry attempt at all → HOLD (incomplete, the harness says NOT RUN)', () => {
        expect(completionAttemptsVerdict([attempt(1, body(), false, true, null), attempt(2, body(), true, false, 409)]).status).toBe('HOLD');
        expect(completionAttemptsVerdict([attempt(1, body(), false, true, null), attempt(2, body(), true, false, null)]).status).toBe('HOLD');
        expect(completionAttemptsVerdict([attempt(1, body(), false, true, null)]).status).toBe('HOLD');
    });
    it('a second attempt before the explicit Retry, or a non-completed status → FAIL', () => {
        expect(completionAttemptsVerdict([attempt(1, body(), false, true, null), attempt(2, body(), false, false, 200)]).status).toBe('FAIL');
        expect(completionAttemptsVerdict([attempt(1, body(), false, true, null), attempt(2, body({ p_status: 'abandoned' }), true, false, 200)]).status).toBe('FAIL');
    });
    it('no fault or an unreadable fault body → HOLD; any other unreadable body or a non-canonical id → FAIL', () => {
        expect(completionAttemptsVerdict([attempt(1, body(), false, false, 200)]).status).toBe('HOLD');
        expect(completionAttemptsVerdict([attempt(1, 'not json', false, true, null)]).status).toBe('HOLD');
        expect(completionAttemptsVerdict([attempt(1, body(), false, true, null), attempt(2, 'not json', true, false, 200), attempt(3, body(), true, false, 200)]).status).toBe('FAIL');
        expect(completionAttemptsVerdict([attempt(1, body({ p_session_id: 'not-a-uuid' }), false, true, null)]).status).toBe('FAIL');
    });
    it('evidence carries scope, phase, a sha prefix and the status, never the body', () => {
        const a = [attempt(1, body(), false, true, null), attempt(2, body(), true, false, 200), attempt(3, body({ p_session_id: NEXT }), true, false, 201)];
        const ev = attemptEvidence(a, TAKE);
        expect(ev).toMatch(/^1:take:fault:[0-9a-f]{12}:none,2:take:retry:[0-9a-f]{12}:200,3:other:retry:[0-9a-f]{12}:201$/);
        expect(ev).not.toContain('hello');
    });
});

const before = (over: SavedRow = {}): SavedRow => ({
    id: TAKE, user_id: USER, status: 'active', idempotency_key: 'k1', lease_id: 'l1', duration: 10, status_reason: null, total_words: null,
    clarity_score: null, wpm: null, filler_counts: null, pause_metrics: null, next_action_signal: null, transcript: null, transcript_state: 'available', ...over,
});
const saved = (over: SavedRow = {}): SavedRow => ({
    ...before(), status: 'completed', duration: 42, total_words: 90, clarity_score: 81, wpm: 128, filler_counts: { um: 2 }, pause_metrics: { count: 3 },
    next_action_signal: { kind: 'pace' }, transcript: 'hello there', ...over,
});
const harnessSaved = (b: Record<string, unknown>, bef: SavedRow, rows: SavedRow[]) => harness.compareSavedRows(rows, {
    operationDigest: 'x', requestBody: b, beforeRow: bef, accountSubjectSha256: sha(String(bef.user_id)), expectedSessionSha256: sha(String(b.p_session_id)),
}).durableSaved;

describe('exactRetrySaveVerdict (agrees with durable-save-oracle compareSavedRows)', () => {
    const cases: [string, Record<string, unknown>, SavedRow, SavedRow[], 'PASS' | 'FAIL'][] = [
        ['exact save', payload(), before(), [saved()], 'PASS'],
        ['duration clamped to 600', payload({ p_final_duration: 900 }), before(), [saved({ duration: 600 })], 'PASS'],
        ['null duration keeps the Start value', payload({ p_final_duration: null }), before(), [saved({ duration: 10 })], 'PASS'],
        ['a changed wpm', payload(), before(), [saved({ wpm: 127 })], 'FAIL'],
        ['a changed transcript', payload(), before(), [saved({ transcript: 'hello' })], 'FAIL'],
        ['a new idempotency key', payload(), before(), [saved({ idempotency_key: 'k2' })], 'FAIL'],
        ['a new lease', payload(), before(), [saved({ lease_id: 'l2' })], 'FAIL'],
        ['two rows', payload(), before(), [saved(), saved({ id: NEXT })], 'FAIL'],
        ['not completed', payload(), before(), [saved({ status: 'active' })], 'FAIL'],
        ['transcript not retained', payload(), before(), [saved({ transcript_state: 'expired' })], 'FAIL'],
        ['no filler counts', payload({ p_filler_counts: null }), before(), [saved({ filler_counts: null })], 'FAIL'],
        ['the payload names another session', payload({ p_session_id: NEXT }), before(), [saved({ id: NEXT })], 'FAIL'],
        ['the Start row was not active', payload(), before({ status: 'completed' }), [saved()], 'FAIL'],
        ['no next action', payload({ p_next_action: null }), before(), [saved({ next_action_signal: null })], 'FAIL'],
    ];
    for (const [name, b, bef, rows, expected] of cases) {
        it(`${name} → ${expected}`, () => {
            const savedId = rows[0]?.id as string;
            expect(exactRetrySaveVerdict(b, bef, rows, String(b.p_session_id) === savedId ? savedId : TAKE).status).toBe(expected);
            expect(harnessSaved(b, bef, rows)).toBe(expected === 'PASS');
        });
    }
    it('the page bound another session → FAIL; no payload or no Start row → HOLD', () => {
        expect(exactRetrySaveVerdict(payload(), before(), [saved()], NEXT).status).toBe('FAIL');
        expect(exactRetrySaveVerdict(payload(), before(), [saved()], null).status).toBe('FAIL');
        expect(exactRetrySaveVerdict(null, before(), [saved()], TAKE).status).toBe('HOLD');
        expect(exactRetrySaveVerdict({ p_session_id: TAKE }, before(), [saved()], TAKE).status).toBe('HOLD');
        expect(exactRetrySaveVerdict(payload(), null, [saved()], TAKE).status).toBe('HOLD');
    });
});

describe('reviewReopenVerdict', () => {
    const d = transcriptDigest('  hello there \n');
    it('the same digest before and after the reload → PASS (trimmed, as the harness fingerprints)', () => {
        expect(d).toBe(transcriptDigest('hello there'));
        expect(reviewReopenVerdict(d, true, d, d).status).toBe('PASS');
    });
    it('not opened, a different transcript, or a different one after the reload → FAIL; nothing saved to compare → HOLD', () => {
        expect(reviewReopenVerdict(d, false, null, null).status).toBe('FAIL');
        expect(reviewReopenVerdict(d, true, transcriptDigest('other'), d).status).toBe('FAIL');
        expect(reviewReopenVerdict(d, true, d, null).status).toBe('FAIL');
        expect(reviewReopenVerdict(null, true, d, d).status).toBe('HOLD');
    });
});

describe('the AHT-05/06 spec wiring', () => {
    const spec = readFileSync(path.resolve(here, '../live/rwt-save-retry-recovery.live.spec.ts'), 'utf8');
    it('records every completion POST in the route, reads the Start row before Stop, and marks Retry just before its click', () => {
        const parse = spec.indexOf('parseCompletionAttempt(drop.completionPosts, route.request().postDataBuffer(), retryMarked, !drop.dropped)');
        const dropMark = spec.indexOf('drop.dropped = true;');
        const startRow = spec.indexOf('readSavedRows(owner.uid, true)');
        const stop1 = spec.indexOf("stopBenchmarkRecording(page, `save-retry-${variant}-1`");
        const mark = spec.indexOf('retryMarked = true;');
        const click = spec.indexOf("page.getByTestId('session-retry-save').click()");
        expect(parse).toBeGreaterThan(0);
        expect(parse).toBeLessThan(dropMark);
        expect(startRow).toBeLessThan(stop1);
        expect(mark).toBeLessThan(click);
        expect(spec.slice(mark, click).replace(/\s+/g, ' ')).toBe('retryMarked = true; await ');
    });
    it('judges the exact save after Retry, then the reopen after the next take', () => {
        const exact = spec.indexOf("receipt.row('Retry Save saved the exact payload once'");
        const nextRow = spec.indexOf("receipt.row('next take saves only itself'");
        const reopen = spec.indexOf("receipt.row('review reopens the saved take'");
        expect(exact).toBeGreaterThan(spec.indexOf("receipt.row('Retry Save leaves one saved session'"));
        expect(exact).toBeLessThan(nextRow);
        expect(nextRow).toBeLessThan(reopen);
    });
    it('judges the completion attempts once, at the final boundary after every owned page closed (no late attempt is missed)', () => {
        const row = "row('completion attempts are the fault and one Retry'";
        expect(spec.split(row)).toHaveLength(2);
        expect(spec).not.toContain(`receipt.${row}`);
        const closed = spec.indexOf("steps.step('owned pages closed'");
        const step = spec.indexOf("steps.step('completion attempts'");
        expect(closed).toBeGreaterThan(spec.indexOf('new FinalizationSteps()'));
        expect(step).toBeGreaterThan(closed);
        expect(spec.indexOf(row)).toBeGreaterThan(step);
        expect(spec.indexOf(row)).toBeLessThan(spec.indexOf('finalizeOwnedCleanup(steps'));
    });
    it('keeps the Start budget at the two designed presses (the reopen presses no Start)', () => {
        expect(spec).toContain("{ total: 2, perControl: { 'mic-download': 1, 'mic-start': 1, 'verdict-practice-again': 1 } }");
    });
});
