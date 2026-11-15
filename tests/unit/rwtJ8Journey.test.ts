// @vitest-environment node
/**
 * J8 (nine-journey design; Sam's disposition 2026-11-15): one run-owned account, three feedback legs, one fence, one receipt
 * with three leg-scoped readback results. The pure rules behind it, with their failing controls.
 */
import { describe, expect, it } from 'vitest';
import {
    J8_FENCE_CASE, J8_FENCE_KEY_CAP, J8_KEY_CAPS, J8WriteGate, legReadback, legSink, mergeLegReadback, takeDigest, takesUnchangedVerdict,
    type J8Leg,
} from '../live/helpers/rwtJ8Journey';
import type { ReadbackActionBinding } from '../live/helpers/rwtAcceptance';
import type { ReadbackPlan } from '../live/helpers/rwtOracles';

const RELEASE = 'a'.repeat(40);
const RUN_ID = '43000000000';
const RUN_ATTEMPT = '1';
const CTX = { expectedReleaseSha: RELEASE, expectedRunId: RUN_ID, expectedRunAttempt: RUN_ATTEMPT };

/** One leg's own document on Analytics: its boot control, its route into Analytics, its action capture, its submit. */
function legDocument(n: number, t0: number) {
    const journeyId = `journey-${n}`;
    const bootId = `boot-${n}`;
    const base = { journeyId, bootId, releaseSha: RELEASE, trafficType: 'canary' };
    const events = [
        { event: 'telemetry_positive_control', at: t0, ...base },
        { event: 'journey_step', at: t0 + 1, ...base, journeyStep: 'route_change', toRoute: '/analytics' },
        { event: 'feedback_submit', at: t0 + 5, ...base },
    ];
    const binding: ReadbackActionBinding = { stage: 'share_feedback', ...base, runId: RUN_ID, runAttempt: RUN_ATTEMPT, entry: 'route_change', capturedAt: t0 + 3 };
    return { journeyId, events, binding, window: { fromMs: t0, toMs: t0 + 9 } };
}
const A = legDocument(1, 100);
const B = legDocument(2, 200);
const C = legDocument(3, 300);
const ALL_EVENTS = [...A.events, ...B.events, ...C.events];

describe('J8 constants: one AHT-07+AHT-08 fence, keys 1/4/1 with no borrowing', () => {
    it('the fence case and its cap are the sum of the per-leg caps', () => {
        expect(J8_FENCE_CASE).toBe('AHT-07+AHT-08');
        expect(J8_KEY_CAPS).toEqual({ 'J8.a': 1, 'J8.b': 4, 'J8.c': 1 });
        expect(J8_FENCE_KEY_CAP).toBe(6);
    });
    it('legSink scopes every row to its leg', () => {
        const rows: string[] = [];
        legSink({ row: (step) => rows.push(step) }, 'J8.c').row('no-session association', 'PASS', 'x');
        expect(rows).toEqual(['J8.c: no-session association']);
    });
});

describe('J8WriteGate: decided at route entry, frozen to the open leg', () => {
    // Report keys are UUIDs (classifyInsertBody); a short label maps to a fixed UUID per key.
    const uuid = (label: string) => `00000000-0000-4000-8000-${Buffer.from(label).toString('hex').padStart(12, '0').slice(-12)}`;
    const insert = (key: string) => () => ({ idempotency_key: uuid(key), description: 'x' });
    it('a write between leg windows is aborted unsent', () => {
        const g = new J8WriteGate();
        expect(g.enter('POST', insert('k1'))).toEqual({ leg: null, action: 'abort', reason: 'between-windows' });
        expect(g.refused.none).toBe(1);
    });
    it('J8.a and J8.c each get their own one-key bound (one same-key Retry allowed), never borrowing another leg\'s key', () => {
        const g = new J8WriteGate();
        g.open('J8.a');
        expect(g.enter('POST', insert('ka'))).toMatchObject({ leg: 'J8.a', action: 'forward' });
        g.settle();
        expect(g.enter('POST', insert('ka'))).toMatchObject({ action: 'forward' }); // same-key Retry
        g.settle();
        expect(g.enter('POST', insert('ka2'))).toMatchObject({ action: 'abort' }); // attempt cap
        g.close('J8.a');
        g.open('J8.c');
        expect(g.enter('POST', insert('kc'))).toMatchObject({ leg: 'J8.c', action: 'forward' });
        g.settle();
        expect(g.enter('POST', insert('kc-second'))).toMatchObject({ action: 'abort', reason: 'report-cap' });
        expect(g.keysOf('J8.a')).toEqual([uuid('ka')]);
        expect(g.keysOf('J8.c')).toEqual([uuid('kc')]);
    });
    it('a write while an earlier one is unresolved is refused, whatever the leg', () => {
        const g = new J8WriteGate();
        g.open('J8.b');
        expect(g.enter('POST', insert('k'))).toEqual({ leg: 'J8.b', action: 'ledger' });
        expect(g.enter('POST', insert('k'))).toEqual({ leg: 'J8.b', action: 'abort', reason: 'prior-write-unresolved' });
        g.settle();
        expect(g.enter('POST', insert('k'))).toEqual({ leg: 'J8.b', action: 'ledger' });
    });
    it('the leg is frozen at entry: closing the window after entry does not move an admitted write to another leg', () => {
        const g = new J8WriteGate();
        g.open('J8.a');
        const d = g.enter('POST', insert('ka'));
        g.close('J8.a');
        g.open('J8.c');
        expect(d.leg).toBe('J8.a');
        expect(g.keysOf('J8.c')).toEqual([]);
    });
    it('windows cannot overlap', () => {
        const g = new J8WriteGate();
        g.open('J8.a');
        expect(() => g.open('J8.b')).toThrow(/still open/);
        expect(() => g.close('J8.c')).toThrow(/not the open one/);
    });
});

describe('legReadback + mergeLegReadback: each leg bound only to its own capture and submit', () => {
    const plans = (bindings: Record<J8Leg, ReadbackActionBinding>): Record<J8Leg, ReadbackPlan> => ({
        'J8.a': legReadback(ALL_EVENTS, { ...A.window, bindings: [bindings['J8.a']] }, CTX),
        'J8.b': legReadback(ALL_EVENTS, { ...B.window, bindings: [bindings['J8.b']] }, CTX),
        'J8.c': legReadback(ALL_EVENTS, { ...C.window, bindings: [bindings['J8.c']] }, CTX),
    });
    it('three legs, three own documents: each leg binds exactly its own journey; nothing is missing', () => {
        const merged = mergeLegReadback(plans({ 'J8.a': A.binding, 'J8.b': B.binding, 'J8.c': C.binding }));
        expect(merged.missingBindings).toEqual([]);
        expect(merged.legJourneys).toEqual({ 'J8.a': [A.journeyId], 'J8.b': [B.journeyId], 'J8.c': [C.journeyId] });
        expect(merged.journeys.map((j) => j.stages)).toEqual([['share_feedback'], ['share_feedback'], ['share_feedback']]);
    });
    it('NEGATIVE CONTROL: swapping two legs\' bindings lets neither pass on the other\'s evidence', () => {
        const merged = mergeLegReadback(plans({ 'J8.a': B.binding, 'J8.b': A.binding, 'J8.c': C.binding }));
        expect(merged.missingBindings).toEqual(['J8.a:share_feedback', 'J8.b:share_feedback']);
        expect(merged.legJourneys['J8.a']).toEqual([]);
        expect(merged.legJourneys['J8.b']).toEqual([]);
        expect(merged.legJourneys['J8.c']).toEqual([C.journeyId]);
    });
    it('another leg\'s submit inside this leg\'s window is never this leg\'s anchor (a borrowed first submit FAILs the binding)', () => {
        // J8.c's window is stretched to include J8.b's submit: the first submit in the window is B's, not C's.
        const p = legReadback(ALL_EVENTS, { fromMs: 200, toMs: 309, bindings: [C.binding] }, CTX);
        expect(p.missingBindings).toEqual(['share_feedback']);
        expect(p.bindingReasons?.share_feedback).toBe('anchor_mismatch');
    });
    it('J8.b\'s fault-leg submits are excluded, so only the final submit can anchor the leg', () => {
        const fault = { event: 'feedback_submit', at: 201, journeyId: 'journey-fault', bootId: 'boot-fault', releaseSha: RELEASE, trafficType: 'canary' };
        const p = legReadback([...ALL_EVENTS, fault], { ...B.window, bindings: [B.binding], excludeJourneys: ['journey-fault'] }, CTX);
        expect(p.missingBindings).toEqual([]);
        const withoutExclusion = legReadback([...ALL_EVENTS, fault], { ...B.window, bindings: [B.binding] }, CTX);
        expect(withoutExclusion.missingBindings).toEqual(['share_feedback']);
    });
    it('a journey two legs both bound is borrowed evidence: it is dropped and both legs are recorded missing', () => {
        const same = (p: ReadbackPlan): ReadbackPlan => ({ ...p, journeys: [{ journeyId: 'journey-x', stages: ['share_feedback'] }] });
        const base = plans({ 'J8.a': A.binding, 'J8.b': B.binding, 'J8.c': C.binding });
        const merged = mergeLegReadback({ 'J8.a': same(base['J8.a']), 'J8.b': same(base['J8.b']), 'J8.c': base['J8.c'] });
        expect(merged.missingBindings).toEqual(['J8.a:share_feedback', 'J8.b:share_feedback']);
        expect(merged.bindingReasons).toEqual({ 'J8.a:share_feedback': 'duplicate_capture', 'J8.b:share_feedback': 'duplicate_capture' });
        expect(merged.journeys.map((j) => j.journeyId)).toEqual([C.journeyId]);
    });
    it('a leg with no capture at all stays missing for that leg only', () => {
        const merged = mergeLegReadback({
            'J8.a': legReadback(ALL_EVENTS, { ...A.window, bindings: [] }, CTX),
            'J8.b': legReadback(ALL_EVENTS, { ...B.window, bindings: [B.binding] }, CTX),
            'J8.c': legReadback(ALL_EVENTS, { ...C.window, bindings: [C.binding] }, CTX),
        });
        expect(merged.missingBindings).toEqual(['J8.a:share_feedback']);
        expect(merged.bindingReasons?.['J8.a:share_feedback']).toBe('no_capture');
    });
});

describe('takesUnchangedVerdict: exact before/after equality of both takes\' projections', () => {
    const row = (id: string, over: Record<string, unknown> = {}) => ({ id, user_id: 'u', status: 'completed', transcript: 't', ai_suggestions: { tip: 1 }, updated_at: '2026-11-15T00:00:00Z', ...over });
    const digests = (rows: Record<string, unknown>[]) => new Map(rows.map((r) => [r.id as string, takeDigest(r)]));
    const ids: [string, string] = ['older', 'newer'];
    it('PASS only when both identities are present and both projections are equal', () => {
        const before = digests([row('older'), row('newer')]);
        expect(takesUnchangedVerdict(ids, before, digests([row('older'), row('newer')])).status).toBe('PASS');
    });
    it('a changed coaching field, a changed transcript, a removed take or a swapped identity FAILs', () => {
        const before = digests([row('older'), row('newer')]);
        expect(takesUnchangedVerdict(ids, before, digests([row('older', { ai_suggestions: { tip: 2 } }), row('newer')])).status).toBe('FAIL');
        expect(takesUnchangedVerdict(ids, before, digests([row('older'), row('newer', { transcript: 'u' })])).status).toBe('FAIL');
        expect(takesUnchangedVerdict(ids, before, digests([row('older')])).status).toBe('FAIL');
        // Swapped: same count, but the take now under "older" carries newer's content.
        const swapped = new Map([['older', takeDigest(row('newer'))], ['newer', takeDigest(row('older'))]]);
        expect(takesUnchangedVerdict(ids, before, swapped).status).toBe('FAIL');
    });
    it('the same identity twice FAILs; an unreadable take before the submit HOLDs', () => {
        expect(takesUnchangedVerdict(['older', 'older'], new Map(), new Map()).status).toBe('FAIL');
        expect(takesUnchangedVerdict(ids, digests([row('older')]), digests([row('older'), row('newer')])).status).toBe('HOLD');
    });
    it('the digest is deterministic, covers the saved and coaching fields, and is not the row', () => {
        expect(takeDigest(row('older'))).toBe(takeDigest(row('older')));
        expect(takeDigest(row('older'))).not.toBe(takeDigest(row('older', { filler_counts: { um: 1 } })));
        expect(takeDigest(row('older'))).toMatch(/^[0-9a-f]{64}$/);
        expect(takeDigest(null)).toBeNull();
    });
});
