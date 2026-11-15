// @vitest-environment node
/**
 * J8 (nine-journey design; Sam's disposition 2026-11-15): one run-owned account, three feedback legs, one fence, one receipt
 * with three leg-scoped readback results. The pure rules behind it, with their failing controls.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    J8_ADMISSION_ENV, J8_FENCE_CASE, J8_FENCE_KEY_CAP, J8_KEY_CAPS, J8_SUITE, J8WriteGate, TAKE_PROJECTION_FIELDS, j8RunnerAdmission, legReadback,
    legReceipt, legSink, mergeLegReadback, takeDigest, takesReadComplete, takesUnchangedVerdict,
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
    it('legReceipt reads only its own leg\'s rows, under unscoped names', () => {
        const rows: { step: string; verdict: string }[] = [{ step: 'J8.a: feedback', verdict: 'PASS' }, { step: 'J8.b: feedback', verdict: 'FAIL' }];
        const receipt = { rows, row: (step: string, verdict: 'PASS' | 'FAIL' | 'HOLD') => { rows.push({ step, verdict }); } };
        const b = legReceipt(receipt, 'J8.b');
        expect(b.rows).toEqual([{ step: 'feedback', verdict: 'FAIL' }]);
        b.row('feedback diagnostic chain', 'HOLD', 'x');
        expect(rows.at(-1)).toEqual({ step: 'J8.b: feedback diagnostic chain', verdict: 'HOLD' });
    });
    it('legSink scopes every row to its leg', () => {
        const rows: string[] = [];
        legSink({ row: (step) => rows.push(step) }, 'J8.c').row('no-session association', 'PASS', 'x');
        expect(rows).toEqual(['J8.c: no-session association']);
    });
});

describe('J8WriteGate: decided at route entry, frozen to the open leg, one owner per key, unknown outcomes block', () => {
    // Report keys are UUIDs (classifyInsertBody); a short label maps to a fixed UUID per key.
    const uuid = (label: string) => `00000000-0000-4000-8000-${Buffer.from(label).toString('hex').padStart(12, '0').slice(-12)}`;
    const insert = (key: string) => () => ({ idempotency_key: uuid(key), description: 'x' });
    const send = (g: J8WriteGate, key: string, outcome: 'answered' | 'unknown' | 'aborted-unsent' | 'committed-response-dropped' = 'answered') => {
        const d = g.enter('POST', insert(key));
        if (d.action !== 'abort') g.settle(d.attempt, outcome);
        return d;
    };
    it('a write between leg windows is aborted unsent', () => {
        const g = new J8WriteGate();
        expect(g.enter('POST', insert('k1'))).toEqual({ leg: null, action: 'abort', reason: 'between-windows' });
        expect(g.refused.none).toBe(1);
    });
    it('J8.a and J8.c each get their own one-key bound (one same-key Retry allowed)', () => {
        const g = new J8WriteGate();
        g.open('J8.a');
        expect(send(g, 'ka')).toMatchObject({ leg: 'J8.a', action: 'forward' });
        expect(send(g, 'ka')).toMatchObject({ action: 'forward' }); // same-key Retry
        expect(send(g, 'ka')).toMatchObject({ action: 'abort', reason: 'attempt-cap' });
        g.close('J8.a');
        g.open('J8.c');
        expect(send(g, 'kc')).toMatchObject({ leg: 'J8.c', action: 'forward' });
        expect(send(g, 'kc-second')).toMatchObject({ action: 'abort', reason: 'report-cap' });
        expect(g.keysOf('J8.a')).toEqual([uuid('ka')]);
        expect(g.keysOf('J8.c')).toEqual([uuid('kc')]);
    });
    it('CROSS-LEG KEY REPLAY: a key first seen in one leg is refused in any other', () => {
        const g = new J8WriteGate();
        g.open('J8.a'); send(g, 'shared'); g.close('J8.a');
        g.open('J8.b');
        expect(g.enter('POST', insert('shared'))).toEqual({ leg: 'J8.b', action: 'abort', reason: 'cross-leg-key' });
        g.close('J8.b');
        g.open('J8.c');
        expect(g.enter('POST', insert('shared'))).toEqual({ leg: 'J8.c', action: 'abort', reason: 'cross-leg-key' });
    });
    it('LATE PRIOR-LEG REQUEST: a J8.a write that arrives after J8.a closed is refused (between windows, or by key owner in a later leg)', () => {
        const g = new J8WriteGate();
        g.open('J8.a'); send(g, 'ka'); g.close('J8.a');
        expect(g.enter('POST', insert('ka'))).toMatchObject({ action: 'abort', reason: 'between-windows' });
        g.open('J8.b');
        expect(g.enter('POST', insert('ka'))).toMatchObject({ action: 'abort', reason: 'cross-leg-key' });
    });
    it('UNKNOWN OUTCOME: a failed forward stays unresolved; no further write and no next leg can open', () => {
        const g = new J8WriteGate();
        g.open('J8.b');
        expect(send(g, 'kb', 'unknown')).toMatchObject({ action: 'ledger' });
        expect(g.unresolvedCount).toBe(1);
        expect(g.enter('POST', insert('kb2'))).toMatchObject({ action: 'abort', reason: 'prior-write-unresolved' });
        g.close('J8.b');
        expect(() => g.open('J8.c')).toThrow(/unknown outcome/);
    });
    it('an observed commit whose browser response was dropped on purpose is resolved (not unknown); the next leg may open', () => {
        const g = new J8WriteGate();
        g.open('J8.b');
        send(g, 'kb', 'committed-response-dropped');
        expect(g.unresolvedCount).toBe(0);
        g.close('J8.b');
        expect(() => g.open('J8.c')).not.toThrow();
    });
    it('a write in flight blocks the next write and the next leg until it is settled; settle is per attempt', () => {
        const g = new J8WriteGate();
        g.open('J8.b');
        const d = g.enter('POST', insert('k'));
        expect(g.enter('POST', insert('k'))).toMatchObject({ action: 'abort', reason: 'prior-write-unresolved' });
        g.close('J8.b');
        expect(() => g.open('J8.c')).toThrow(/in flight/);
        if (d.action === 'abort') throw new Error('unexpected');
        g.settle(d.attempt, 'answered');
        expect(() => g.settle(d.attempt, 'answered')).toThrow(/already settled/);
        expect(() => g.open('J8.c')).not.toThrow();
    });
    it('the leg is frozen at entry and windows cannot overlap', () => {
        const g = new J8WriteGate();
        g.open('J8.a');
        const d = g.enter('POST', insert('ka'));
        expect(d.leg).toBe('J8.a');
        expect(() => g.open('J8.b')).toThrow(/still open/);
        expect(() => g.close('J8.c')).toThrow(/not the open one/);
    });
});

describe('j8RunnerAdmission: no runner, no signup (Sam on 94fe88d7)', () => {
    const env = { [J8_ADMISSION_ENV]: '/adm.json', GITHUB_RUN_ID: '43000000000', GITHUB_RUN_ATTEMPT: '1' };
    const doc = (over: Record<string, unknown> = {}) => JSON.stringify({ suite: J8_SUITE, runId: '43000000000', runAttempt: '1',
        createAttempt: { attemptId: 'J8.a-1', lookupRef: 'rwt-journey-j8-1731700000-43000000000@example.com', recordedBeforeSend: true }, ...over });
    it('DISCOVERY / DIRECT INVOCATION: without the runner admission the journey is not admitted (it sends nothing)', () => {
        expect(j8RunnerAdmission({}, () => { throw new Error('never read'); })).toMatchObject({ admitted: false, reason: expect.stringMatching(/never runs standalone/) });
    });
    it('admitted only for this run, the J8 suite, and an account-create attempt recorded before the signup', () => {
        expect(j8RunnerAdmission(env, () => doc())).toEqual({ admitted: true, lookupRef: 'rwt-journey-j8-1731700000-43000000000@example.com', attemptId: 'J8.a-1' });
        expect(j8RunnerAdmission(env, () => '{not json').admitted).toBe(false);
        expect(j8RunnerAdmission(env, () => doc({ suite: 'feedback-association-boundaries-older-take' })).admitted).toBe(false);
        expect(j8RunnerAdmission(env, () => doc({ runId: '1' })).admitted).toBe(false);
        expect(j8RunnerAdmission({ ...env, GITHUB_RUN_ATTEMPT: '2' }, () => doc()).admitted).toBe(false);
        expect(j8RunnerAdmission(env, () => doc({ createAttempt: { attemptId: 'x', lookupRef: 'someone@example.com', recordedBeforeSend: true } })).admitted).toBe(false);
        expect(j8RunnerAdmission(env, () => doc({ createAttempt: { attemptId: 'x', lookupRef: 'rwt-journey-j8-1@example.com', recordedBeforeSend: false } })).admitted).toBe(false);
    });
    it('the spec decides admission FIRST: before any signup, route, fence or page action, and skips with zero sends', () => {
        const spec = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../live/rwt-feedback-association-boundaries.live.spec.ts'), 'utf8');
        const body = spec.slice(spec.indexOf("test('J8: one account"));
        const gate = body.indexOf('const admission = j8RunnerAdmission(process.env');
        const skip = body.indexOf('test.skip(!admission.admitted');
        const ret = body.indexOf('if (!admission.admitted) return;');
        for (const later of ['prepareDisposable(', 'installJ8WriteRoute(', 'new JourneyFeedbackFence(', 'parity.attach(', 'tap.attach(page)', 'page.goto(']) {
            expect(body.indexOf(later)).toBeGreaterThan(ret);
        }
        expect(gate).toBeGreaterThan(-1);
        expect(skip).toBeGreaterThan(gate);
        expect(ret).toBeGreaterThan(skip);
        expect(body).toContain('await prepareDisposable(page, receipt, owner, admission.lookupRef)');
    });
});

describe('legReadback + mergeLegReadback: each leg bound only to its own capture and submit', () => {
    const STORED = { storedRows: 1, insertKeys: 1 };
    const plans = (bindings: Record<J8Leg, ReadbackActionBinding>): Record<J8Leg, ReadbackPlan> => ({
        'J8.a': legReadback(ALL_EVENTS, { ...A.window, bindings: [bindings['J8.a']], stored: STORED }, CTX),
        'J8.b': legReadback(ALL_EVENTS, { ...B.window, bindings: [bindings['J8.b']], stored: STORED }, CTX),
        'J8.c': legReadback(ALL_EVENTS, { ...C.window, bindings: [bindings['J8.c']], stored: STORED }, CTX),
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
        const p = legReadback(ALL_EVENTS, { fromMs: 200, toMs: 309, bindings: [C.binding], stored: STORED }, CTX);
        expect(p.missingBindings).toEqual(['share_feedback']);
        expect(p.bindingReasons?.share_feedback).toBe('anchor_mismatch');
    });
    it('J8.b\'s fault-leg submits are excluded, so only the final submit can anchor the leg', () => {
        const fault = { event: 'feedback_submit', at: 201, journeyId: 'journey-fault', bootId: 'boot-fault', releaseSha: RELEASE, trafficType: 'canary' };
        const p = legReadback([...ALL_EVENTS, fault], { ...B.window, bindings: [B.binding], excludeJourneys: ['journey-fault'], stored: STORED }, CTX);
        expect(p.missingBindings).toEqual([]);
        const withoutExclusion = legReadback([...ALL_EVENTS, fault], { ...B.window, bindings: [B.binding], stored: STORED }, CTX);
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
    it('CAPTURE-ONLY is not proof: a valid capture with no submit of its own, or without its own stored report, is missing for that leg', () => {
        // The capture and route are valid, but this leg's own submit never happened.
        const noSubmit = A.events.filter((e) => e.event !== 'feedback_submit');
        const capOnly = legReadback(noSubmit, { ...A.window, bindings: [A.binding], stored: STORED }, CTX);
        expect(capOnly.journeys).toEqual([]);
        expect(capOnly.missingBindings).toEqual(['share_feedback']);
        // The submit happened, but there is no independently observed stored report for it.
        const unproven = legReadback(ALL_EVENTS, { ...A.window, bindings: [A.binding], stored: null }, CTX);
        expect(unproven.missingBindings).toEqual(['share_feedback']);
        expect(legReadback(ALL_EVENTS, { ...A.window, bindings: [A.binding], stored: { storedRows: 2, insertKeys: 1 } }, CTX).missingBindings).toEqual(['share_feedback']);
    });
    it('a submit from BEFORE the leg\'s own capture never proves it', () => {
        const early = A.events.map((e) => (e.event === 'feedback_submit' ? { ...e, at: A.binding.capturedAt - 1 } : e));
        const p = legReadback(early, { ...A.window, bindings: [A.binding], stored: STORED }, CTX);
        expect(p.journeys).toEqual([]);
        expect(p.missingBindings).toEqual(['share_feedback']);
    });
    it('a leg with no capture at all stays missing for that leg only', () => {
        const merged = mergeLegReadback({
            'J8.a': legReadback(ALL_EVENTS, { ...A.window, bindings: [], stored: STORED }, CTX),
            'J8.b': legReadback(ALL_EVENTS, { ...B.window, bindings: [B.binding], stored: STORED }, CTX),
            'J8.c': legReadback(ALL_EVENTS, { ...C.window, bindings: [C.binding], stored: STORED }, CTX),
        });
        expect(merged.missingBindings).toEqual(['J8.a:share_feedback']);
        expect(merged.bindingReasons?.['J8.a:share_feedback']).toBe('no_capture');
    });
});

describe('takesUnchangedVerdict: exact before/after equality of both takes\' complete, owner-bound projections', () => {
    const full = (id: string, over: Record<string, unknown> = {}) => ({
        ...Object.fromEntries(TAKE_PROJECTION_FIELDS.map((f) => [f, null])), id, user_id: 'u', status: 'completed', transcript: 't', ai_suggestions: { tip: 1 }, ...over,
    }) as Record<string, unknown>;
    const digests = (rows: Record<string, unknown>[]) => new Map(rows.map((r) => [r.id as string, takeDigest(r, 'u')]));
    const ids: [string, string] = ['older', 'newer'];
    it('PASS only when both identities are present, complete, owner-bound and equal', () => {
        const before = digests([full('older'), full('newer')]);
        expect(takesReadComplete(ids, before)).toBe(true);
        expect(takesUnchangedVerdict(ids, before, digests([full('older'), full('newer')])).status).toBe('PASS');
    });
    it('a changed coaching field or transcript FAILs; a removed take FAILs; a swapped identity FAILs', () => {
        const before = digests([full('older'), full('newer')]);
        expect(takesUnchangedVerdict(ids, before, digests([full('older', { ai_suggestions: { tip: 2 } }), full('newer')])).status).toBe('FAIL');
        expect(takesUnchangedVerdict(ids, before, digests([full('older'), full('newer', { transcript: 'u' })])).status).toBe('FAIL');
        expect(takesUnchangedVerdict(ids, before, digests([full('older')])).status).toBe('FAIL');
        const swapped = new Map([['older', takeDigest(full('newer'), 'u')], ['newer', takeDigest(full('older'), 'u')]]);
        expect(takesUnchangedVerdict(ids, before, swapped).status).toBe('FAIL');
    });
    it('MISSING FIELDS ARE NOT NULLS: a row missing any projected key has no digest, so two identical incomplete reads cannot PASS', () => {
        for (const f of TAKE_PROJECTION_FIELDS) {
            const incomplete = full('older');
            delete incomplete[f];
            expect(takeDigest(incomplete, 'u')).toBeNull();
        }
        const partial = (id: string) => { const r = full(id); delete r.updated_at; return r; };
        const sameIncomplete = digests([partial('older'), partial('newer')]);
        expect(takesReadComplete(ids, sameIncomplete)).toBe(false);
        expect(takesUnchangedVerdict(ids, sameIncomplete, sameIncomplete).status).not.toBe('PASS');
        // present-null before, absent after: never "unchanged"
        const before = digests([full('older'), full('newer')]);
        expect(takesUnchangedVerdict(ids, before, digests([partial('older'), full('newer')])).status).toBe('HOLD');
    });
    it('a row of another owner has no digest (owner-bound reads only)', () => {
        expect(takeDigest(full('older', { user_id: 'someone-else' }), 'u')).toBeNull();
        expect(takesReadComplete(ids, new Map([['older', takeDigest(full('older', { user_id: 'x' }), 'u')], ['newer', takeDigest(full('newer'), 'u')]]))).toBe(false);
    });
    it('the same identity twice FAILs; an incomplete read before the submit HOLDs; the digest is deterministic and opaque', () => {
        expect(takesUnchangedVerdict(['older', 'older'], new Map(), new Map()).status).toBe('FAIL');
        expect(takesUnchangedVerdict(ids, digests([full('older')]), digests([full('older'), full('newer')])).status).toBe('HOLD');
        expect(takeDigest(full('older'), 'u')).toBe(takeDigest(full('older'), 'u'));
        expect(takeDigest(full('older'), 'u')).not.toBe(takeDigest(full('older', { filler_counts: { um: 1 } }), 'u'));
        expect(takeDigest(full('older'), 'u')).toMatch(/^[0-9a-f]{64}$/);
        expect(takeDigest(null, 'u')).toBeNull();
    });
});
