// @vitest-environment node
/**
 * J8 (nine-journey design; Sam's disposition 2026-11-15): one run-owned account, three feedback legs, one fence, one receipt
 * with three leg-scoped readback results. The pure rules behind it, with their failing controls.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    J8_ADMISSION_ENV, J8_LEGACY_REFUSAL, j8AdmissionPresent, J8_FENCE_CASE, J8_FENCE_KEY_CAP, J8_KEY_CAPS, J8_SUITE, J8WriteGate, TAKE_PROJECTION_FIELDS, j8RunnerAdmission, legReadback,
    legReceipt, legSink, mergeLegReadback, readTakeDigests, takeDigest, takesReadComplete, takesUnchangedVerdict, writerDrainedVerdict,
    j8bFinalSentFeedbackVerdict, legStartPressVerdict, startPressSnapshot, type J8Leg, type StartPressCounts,
} from '../live/helpers/rwtJ8Journey';
import type { ReadbackActionBinding } from '../live/helpers/rwtAcceptance';
import { RwtReceipt, receiptContentLeaks, telemetryClassRows } from '../live/helpers/rwtJourney';
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
        // The receipt names the runner's own attempt, so the nightly entry maps only this run's receipt.
        expect(body).toContain('receipt.meta.runnerAttempt = admission.attemptId;');
        expect(body.indexOf('receipt.meta.runnerAttempt = admission.attemptId;')).toBeLessThan(body.indexOf('prepareDisposable('));
    });
});

describe('only the J8 journey signs up under a J8 admission (Sam on 27ee1856)', () => {
    const spec = () => readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../live/rwt-feedback-association-boundaries.live.spec.ts'), 'utf8');
    it('any value of the admission variable counts as present; only its absence does not', () => {
        expect(j8AdmissionPresent({})).toBe(false);
        expect(j8AdmissionPresent({ [J8_ADMISSION_ENV]: '/adm.json' })).toBe(true);
        expect(j8AdmissionPresent({ [J8_ADMISSION_ENV]: '' })).toBe(true);
    });
    it('both legacy tests skip FIRST under an admission, before any page action or signup', () => {
        const src = spec();
        const titles = ["test('feedback selected for an older take links only to that take'", "test('No session feedback stores no take or coaching link'"];
        for (const title of titles) {
            const start = src.indexOf(title);
            expect(start).toBeGreaterThan(-1);
            const next = src.indexOf("\n    test('", start + 1);
            const body = src.slice(start, next === -1 ? undefined : next);
            const skip = body.indexOf('test.skip(j8AdmissionPresent(process.env), J8_LEGACY_REFUSAL);');
            const ret = body.indexOf('if (j8AdmissionPresent(process.env)) return;');
            expect(skip).toBeGreaterThan(-1);
            expect(ret).toBeGreaterThan(skip);
            expect(body.indexOf('prepareDisposable(')).toBeGreaterThan(ret);
            // Every page action the test takes comes after the refusal (a token the test never uses is not required).
            for (const later of ['tap.attach(page)', 'armWatchdog(', 'page.goto(', 'page.route(']) {
                const at = body.indexOf(later);
                expect({ later, after: at === -1 || at > ret }).toEqual({ later, after: true });
            }
        }
        // The J8 journey and the two legacy tests are the file's only tests.
        expect(src.match(/\n {4}test\('/g)?.length).toBe(3);
    });
    it('prepareDisposable refuses before any page action or signup when called without the runner email under an admission', () => {
        const src = spec();
        const body = src.slice(src.indexOf('async function prepareDisposable('), src.indexOf('async function prepareDisposable(') + 2000);
        const guard = body.indexOf('if (runnerEmail === undefined && j8AdmissionPresent(process.env)) {');
        expect(guard).toBeGreaterThan(-1);
        expect(body.indexOf('return false;', guard)).toBeLessThan(body.indexOf('page.goto('));
        for (const later of ['installMicAcquisitionCounter(page)', "page.goto('/auth/signup')", 'signUpDisposableAccount(']) expect(body.indexOf(later)).toBeGreaterThan(guard);
        expect(J8_LEGACY_REFUSAL).toMatch(/only the J8 journey may sign up/);
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

/** Sam on 7a755749: unreadable evidence is HOLD; only a successful read proves a take went missing (FAIL). */
describe('the take read keeps "unreadable" apart from "no rows"', () => {
    const ids = ['older', 'newer'] as const;
    const row = (id: string) => Object.fromEntries([...TAKE_PROJECTION_FIELDS.map((f) => [f, null]), ['id', id], ['user_id', 'u']]);
    const both = readTakeDigests({ data: [row('older'), row('newer')], error: null }, 'u');
    it('a failed query, or no row array, is unreadable (null), never an empty map', () => {
        expect(readTakeDigests({ data: null, error: { message: 'boom' } }, 'u')).toBeNull();
        expect(readTakeDigests({ data: [row('older')], error: { message: 'boom' } }, 'u')).toBeNull();
        expect(readTakeDigests({ data: { rows: [] }, error: null }, 'u')).toBeNull();
        expect(readTakeDigests({ data: [], error: null }, 'u')).toEqual(new Map());
    });
    it('CONTROL: unreadable BEFORE the submit is not complete, so J8.c does not run', () => {
        expect(takesReadComplete(ids, null)).toBe(false);
        expect(takesReadComplete(ids, both)).toBe(true);
    });
    it('CONTROL: unreadable AFTER the submit is HOLD, never FAIL and never PASS', () => {
        const v = takesUnchangedVerdict(ids, both, null);
        expect(v.status).toBe('HOLD');
        expect(v.detail).toContain('could not be read after');
        expect(takesUnchangedVerdict(ids, null, both).status).toBe('HOLD');
    });
    it('CONTROL: a SUCCESSFUL read that lacks a saved take after the submit FAILs', () => {
        expect(takesUnchangedVerdict(ids, both, readTakeDigests({ data: [], error: null }, 'u')).status).toBe('FAIL');
        expect(takesUnchangedVerdict(ids, both, readTakeDigests({ data: [row('older')], error: null }, 'u')).status).toBe('FAIL');
        expect(takesUnchangedVerdict(ids, both, both).status).toBe('PASS');
    });
});

/** Sam on 7a755749: the writer is drained only with nothing in flight AND nothing unresolved. */
describe('writerDrainedVerdict', () => {
    it('PASS only when nothing is in flight and nothing is unresolved', () => {
        expect(writerDrainedVerdict({ inFlight: 0, unresolved: 0 }).status).toBe('PASS');
    });
    it('CONTROL: an unresolved write with nothing in flight is HOLD, counted apart', () => {
        const v = writerDrainedVerdict({ inFlight: 0, unresolved: 1 });
        expect(v.status).toBe('HOLD');
        expect(v.evidence).toEqual({ inFlight: 0, unresolved: 1 });
        expect(v.detail).toContain('unknown server outcome');
    });
    it('an in-flight write is HOLD; an uncountable count is HOLD', () => {
        expect(writerDrainedVerdict({ inFlight: 2, unresolved: 0 }).status).toBe('HOLD');
        expect(writerDrainedVerdict({ inFlight: Number.NaN, unresolved: 0 }).status).toBe('HOLD');
        expect(writerDrainedVerdict({ inFlight: 0, unresolved: -1 }).status).toBe('HOLD');
    });
    it('the spec writes the drain row from the verdict with the gate\'s unresolved count, and reads takes without an empty-map fallback', () => {
        const spec = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../live/rwt-feedback-association-boundaries.live.spec.ts'), 'utf8');
        const flat = spec.replace(/\s+/g, ' ');
        expect(flat).toContain('writerDrainedVerdict({ inFlight: Math.max(pendingAfterDrain, gate.pending), unresolved: gate.unresolvedCount })');
        expect(flat).toContain("sink.row('feedback writer drained', drained.status, drained.detail, drained.evidence);");
        const reader = spec.slice(spec.indexOf('const readTakes = async'), spec.indexOf('const linkedToOlder'));
        expect(reader).toContain('readTakeDigests(');
        expect(reader).not.toContain('new Map()');
        expect(flat).toContain('const before = linkedToOlder ? await readTakes() : null;');
    });
});

describe('legStartPressVerdict: each leg\'s OWN Start presses (J8.a zero, J8.b its two takes)', () => {
    const counts = (o: Partial<Record<string, number>> = {}): StartPressCounts => startPressSnapshot({ 'mic-start': 0, 'mic-download': 0,
        'mic-retry': 0, 'verdict-practice-again': 0, 'focus-points-retry': 0, ...o } as StartPressCounts);
    const AHT07 = { total: 2, perControl: { 'mic-start': 1, 'mic-download': 1, 'verdict-practice-again': 1 } };
    it('a snapshot is a frozen copy: the tap counting on never changes it', () => {
        const live = { 'mic-start': 0, 'mic-download': 0, 'mic-retry': 0, 'verdict-practice-again': 0, 'focus-points-retry': 0 };
        const snap = startPressSnapshot(live);
        live['mic-start'] = 5;
        expect(snap['mic-start']).toBe(0);
        expect(Object.isFrozen(snap)).toBe(true);
    });
    it('J8.a (none): PASS only for zero presses in its interval; one press of ANY control FAILs', () => {
        expect(legStartPressVerdict(counts(), counts(), 'none').status).toBe('PASS');
        for (const c of ['mic-start', 'mic-download', 'mic-retry', 'verdict-practice-again', 'focus-points-retry']) {
            expect({ c, s: legStartPressVerdict(counts(), counts({ [c]: 1 }), 'none').status }).toEqual({ c, s: 'FAIL' });
        }
        // Presses before the interval do not count against the leg (only the delta does).
        expect(legStartPressVerdict(counts({ 'mic-start': 3 }), counts({ 'mic-start': 3 }), 'none').status).toBe('PASS');
    });
    it('J8.b (budget): its two designed takes PASS; zero, three, or a control over its cap FAIL', () => {
        const from = counts();
        expect(legStartPressVerdict(from, counts({ 'mic-start': 1, 'verdict-practice-again': 1 }), AHT07)).toMatchObject({ status: 'PASS',
            evidence: { startPresses: 2, cap: 2, overControls: null } });
        expect(legStartPressVerdict(from, counts({ 'mic-download': 1, 'verdict-practice-again': 1 }), AHT07).status).toBe('PASS');
        expect(legStartPressVerdict(from, counts(), AHT07).status).toBe('FAIL');
        expect(legStartPressVerdict(from, counts({ 'mic-start': 1, 'mic-download': 1, 'verdict-practice-again': 1 }), AHT07).detail)
            .toMatch(/more often than designed/);
        expect(legStartPressVerdict(from, counts({ 'mic-start': 2 }), AHT07)).toMatchObject({ status: 'FAIL', evidence: { overControls: 'mic-start' } });
        // An unlisted control allows none: one Start Retry fails even within the total.
        expect(legStartPressVerdict(from, counts({ 'mic-start': 1, 'mic-retry': 1 }), AHT07)).toMatchObject({ status: 'FAIL', evidence: { overControls: 'mic-retry' } });
    });
    it('CONTROL: a press in J8.a is never hidden by J8.b\'s count, because each leg has its own interval', () => {
        const start = counts();
        const afterA = counts({ 'mic-start': 1 }); // a stray press in J8.a
        const afterB = counts({ 'mic-start': 1, 'verdict-practice-again': 1 }); // J8.b then pressed only one
        expect(legStartPressVerdict(start, afterA, 'none').status).toBe('FAIL');
        // The journey-wide total is 2 (would pass a total-only check); J8.b's own count is 1, still within its cap, so the
        // proof that J8.b ran its two takes rests on J8.a's own FAIL above, never on the total.
        expect(legStartPressVerdict(afterA, afterB, AHT07)).toMatchObject({ evidence: { startPresses: 1 } });
    });
    it('a missing snapshot, a negative or an unreadable count is HOLD, never PASS', () => {
        expect(legStartPressVerdict(null, counts(), 'none').status).toBe('HOLD');
        expect(legStartPressVerdict(counts(), null, AHT07).status).toBe('HOLD');
        expect(legStartPressVerdict(counts({ 'mic-start': 2 }), counts({ 'mic-start': 1 }), 'none').status).toBe('HOLD');
        expect(legStartPressVerdict(counts(), counts({ 'mic-start': Number.NaN }), 'none').status).toBe('HOLD');
        expect(legStartPressVerdict(counts(), { ...counts(), 'mic-start': undefined } as unknown as StartPressCounts, 'none').status).toBe('HOLD');
    });
});

describe('J8.b final older-take sent evidence', () => {
    const event = (outcome: string, at: number, journeyId: string | undefined = 'final-b') => ({
        event: 'feedback_submit', at, journeyId, bootId: 'boot-b', releaseSha: RELEASE,
        trafficType: 'canary', fields: { outcome, submit_seq: 7 },
    });
    const own = [event('attempted', 21), event('storage_ok', 23)];
    it('binds only the final pair and keeps telemetry receipt distinct from sent evidence', () => {
        const neighboring = { ...event('storage_ok', 22), journeyId: 'fault-leg' };
        const v = j8bFinalSentFeedbackVerdict([event('attempted', 10), own[0], neighboring, own[1]], ['final-b'], 20, 24, [], RELEASE);
        expect(v.verdict).toBe('PASS');
        expect(v.detail).toMatch(/left the page.*readback/);
        expect(v.evidence).toMatchObject({ attempted: 1, storageOk: 1 });
    });
    it('holds on missing or borrowed bindings, blind beacons, missing pair and invalid time', () => {
        for (const [j, from, to, blind] of [
            [[], 20, 24, []], [['final-b', 'elsewhere'], 20, 24, []],
            [['elsewhere'], 20, 24, []], [['final-b'], 20, 22, []],
            [['final-b'], 20, 24, [22]], [['final-b'], Number.NaN, 24, []],
        ] as const) expect(j8bFinalSentFeedbackVerdict(own, j, from, to, blind, RELEASE).verdict).toBe('HOLD');
        expect(j8bFinalSentFeedbackVerdict([...own, { ...event('attempted', 22), journeyId: undefined }],
            ['final-b'], 20, 24, [], RELEASE).verdict).toBe('HOLD');
    });
    it('does not turn duplicate or mismatched final-pair observations into a pass', () => {
        expect(j8bFinalSentFeedbackVerdict([...own, event('attempted', 24)], ['final-b'], 20, 24, [], RELEASE).verdict).toBe('FAIL');
        const wrong = { ...own[1], fields: { outcome: 'storage_ok', submit_seq: 8 } };
        expect(j8bFinalSentFeedbackVerdict([own[0], wrong], ['final-b'], 20, 24, [], RELEASE).verdict).toBe('FAIL');
    });
});

describe('the J8 spec writes the three former gaps on their own legs', () => {
    const spec = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../live/rwt-feedback-association-boundaries.live.spec.ts'), 'utf8');
    const body = spec.slice(spec.indexOf("test('J8: one account"), spec.indexOf("test('No session feedback stores no take"));
    it('J8.a: its own zero-Start row, from the journey start to the end of its submit', () => {
        expect(body).toContain("startsAtAttach = startPressSnapshot(parity.startPressesByControl);");
        expect(body.indexOf('startsAtAttach = startPressSnapshot')).toBeLessThan(body.indexOf('prepareDisposable(page'));
        expect(body).toContain("legStartPressVerdict(startsAtAttach, startsAfterJ8a, 'none')");
        expect(body).toContain("a.row('no Start press', aStarts.status, aStarts.detail, aStarts.evidence);");
        expect(body.indexOf('startsAfterJ8a = startPressSnapshot')).toBeGreaterThan(body.indexOf("gate.close('J8.a')"));
    });
    it('J8.b: its own Start count from J8.a\'s end to its own end, against AHT-07\'s budget', () => {
        expect(body).toContain("legStartPressVerdict(startsAfterJ8a, startPressSnapshot(parity.startPressesByControl), AHT07_START_PRESS_BUDGET)");
        expect(body).toContain("b.row('Start presses within budget', bStarts.status, bStarts.detail, bStarts.evidence);");
        expect(body.indexOf('const bStarts')).toBeGreaterThan(body.indexOf("gate.close('J8.b')"));
    });
    it('J8.b: the final submit observes its fresh acknowledgment, and its window starts before the submit', () => {
        const final = body.slice(body.indexOf('ledger.beginFinal();'), body.indexOf('ledger.endWindow();', body.indexOf('ledger.beginFinal();')));
        expect(final).toContain('const finalSubmit: { fromMs: number; submitAt?: number } = { fromMs: Date.now() };');
        expect(final.indexOf('finalB = finalSubmit;')).toBeLessThan(final.indexOf("submitFeedback(page, tap, owner.uid, 'selected_older_session'"));
        expect(final).toContain('onSubmitted: ({ submitAt }) => { finalSubmit.submitAt = submitAt; }');
        expect(final).toContain('onFreshAcknowledgment: (observation) => writeFreshAcknowledgmentRow(b, observation)');
    });
    it('J8.b: its readback is bound to the final submit only, and the sent pair is its own row (received is readback)', () => {
        const finish = spec.slice(spec.indexOf('async function finishJ8Receipt('), spec.indexOf('const finalizer = new JourneyFinalizer();'));
        expect(finish).toContain("{ fromMs: finalB?.fromMs ?? Number.POSITIVE_INFINITY, toMs: windows[leg]?.toMs ?? Number.NEGATIVE_INFINITY }");
        expect(finish).toContain("excludeJourneys: leg === 'J8.b' ? faultLegJourneys : []");
        expect(finish).toContain("legSink(receipt, 'J8.b').row('final feedback pair sent', sent.verdict, sent.detail, sent.evidence);");
        expect(body).toContain('finishJ8Receipt(receipt, testInfo, tap, claimed, steps, windows, faultLegJourneys, storedProof, finalB);');
        // No J8.b row may claim RECEIVED from the browser's own sent events.
        expect(spec).not.toContain("steps.step('J8.b received feedback'");
    });
});

describe('J8.b received evidence is the final submit\'s own (Sam: fault attempts excluded, borrowed submits refused)', () => {
    const STORED = { storedRows: 1, insertKeys: 1 };
    // A fault attempt's submit on a journey the run did not record as a fault leg, early in J8.b's leg window.
    const earlier = { event: 'feedback_submit', at: 201, journeyId: 'journey-unlisted-fault', bootId: 'boot-x', releaseSha: RELEASE, trafficType: 'canary' };
    it('BORROWED: over the whole leg window an earlier submit is the first one, so J8.b binds nothing', () => {
        const whole = legReadback([...ALL_EVENTS, earlier], { ...B.window, bindings: [B.binding], excludeJourneys: [], stored: STORED }, CTX);
        expect(whole.missingBindings).toEqual(['share_feedback']);
    });
    it('the final submit\'s window (from just before its click) binds only the final submit\'s journey', () => {
        const final = legReadback([...ALL_EVENTS, earlier], { fromMs: 202, toMs: B.window.toMs, bindings: [B.binding], excludeJourneys: [], stored: STORED }, CTX);
        expect(final.missingBindings).toEqual([]);
        expect(final.journeys.map((j) => j.journeyId)).toEqual([B.journeyId]);
    });
});

describe('the J8 nightly entry\'s admission is the one the spec accepts, for this run and attempt only', () => {
    const require = createRequire(import.meta.url);
    const entry = require('../../tools/cloud-test/nightly/j8-nightly-entry.cjs') as {
        admitJ8: (o: Record<string, unknown>) => { admissionFile: string; attemptId: string; email: string };
        finalizerEvaluate: (r: unknown, rb: unknown, o: { workDir: string }) => { errors: string[]; rows: { step: string; verdict: string }[] } | null;
        j8CaseResult: (r: unknown, rb: unknown, ev: unknown) => { assertions: { leg: string; id: string; result: string }[]; unmapped: { step: string; outcome: string }[] };
    };
    const mapping = require('../../tools/cloud-test/nightly/j8-receipt-mapping.cjs') as {
        J8_RECEIPT_MAP: Record<string, Record<string, { scope: string; step: string }[]>>;
    };
    const fresh = () => { const d = mkdtempSync(path.join(tmpdir(), 'j8-adm-')); return d; };
    it('j8RunnerAdmission admits the entry\'s record, with its reserved email, and refuses another run or attempt', () => {
        const dir = fresh();
        const adm = entry.admitJ8({ evidenceDir: dir, runId: RUN_ID, runAttempt: RUN_ATTEMPT, configuredDomain: 'tests.example.com', now: () => 1795300000000 });
        const env = { [J8_ADMISSION_ENV]: adm.admissionFile, GITHUB_RUN_ID: RUN_ID, GITHUB_RUN_ATTEMPT: RUN_ATTEMPT };
        const read = (f: string) => readFileSync(f, 'utf8');
        expect(j8RunnerAdmission(env, read)).toEqual({ admitted: true, lookupRef: adm.email, attemptId: adm.attemptId });
        expect(j8RunnerAdmission({ ...env, GITHUB_RUN_ATTEMPT: '2' }, read).admitted).toBe(false);
        expect(j8RunnerAdmission({ ...env, GITHUB_RUN_ID: '43000000001' }, read).admitted).toBe(false);
    });
    it('the entry settles a receipt with the reviewed finalizer: a receipt it cannot validate comes back with errors, never rows', () => {
        const out = entry.finalizerEvaluate({ suite: J8_SUITE, release: RELEASE, rows: [] }, { suite: J8_SUITE, release: RELEASE, journeys: [], missingBindings: [] },
            { workDir: fresh() });
        expect(out).not.toBeNull();
        expect(out!.errors.length).toBeGreaterThan(0);
    }, 30_000);
    it('A FULLY PASSING RUN PASSES (Codex on 2e2e3bd2): the real telemetry rows, settled by the reviewed finalizer, map every J8 row PASS', () => {
        // The telemetry rows exactly as the J8 spec writes them (telemetryClassRows, claimed, qualifying), over a tap that saw one
        // user-class signup journey and the three canary leg journeys. `signup-stage telemetry received` is HOLD on every run.
        const legs = { 'J8.a': 'journey-a', 'J8.b': 'journey-final-b', 'J8.c': 'journey-c' } as const;
        const tap = { undecodable: 0, blindBeacons: 0, events: [{ trafficType: 'user' }, ...Object.values(legs).map(() => ({ trafficType: 'canary' }))],
            journeyIds: (c: string) => (c === 'canary' ? Object.values(legs) : ['journey-signup']), trafficTypes: () => ['user', 'canary'] };
        const written = new RwtReceipt(J8_SUITE);
        telemetryClassRows(written, tap as never, true, true);
        expect(written.rows.find((r) => r.step === 'signup-stage telemetry received')?.verdict).toBe('HOLD');
        // Every step the mapping reads PASS, the spec's deferred retention HOLD, and the journey's own content-free and residue rows.
        const steps = new Set<string>(['receipt content-free', 'zero residue']);
        for (const [leg, rows] of Object.entries(mapping.J8_RECEIPT_MAP)) for (const sources of Object.values(rows))
            for (const s of sources) if (s.scope !== 'readback') steps.add(s.scope === 'leg' ? `${leg}: ${s.step}` : s.step);
        const rows = [...written.rows,
            ...[...steps].map((step) => (step === 'J8 leg readback bindings' ? { step, verdict: 'PASS', detail: 'bound', evidence: { ...legs } }
                : { step, verdict: 'PASS', detail: 'observed' })),
            { step: 'feedback retention', verdict: 'HOLD', detail: 'the parent deletes the account after the spec exits' }];
        const attempt = 'j8-43000000000-1';
        const receipt = { suite: J8_SUITE, release: RELEASE, meta: { runnerAttempt: attempt }, rows,
            readback: { journeys: Object.values(legs).map((journeyId) => ({ journeyId, stages: ['share_feedback'] })), reportedJourneyIds: [], missingBindings: [] } };
        const readback = { suite: J8_SUITE, release: RELEASE, missingBindings: [], binding: { runId: RUN_ID, runAttempt: RUN_ATTEMPT, createAttempt: attempt },
            finalSubmit: { journeyId: legs['J8.b'] }, journeys: Object.values(legs).map((journeyId) => ({ journeyId, stages: ['share_feedback'], verdict: 'QUALIFIED',
                received: { release_sha: RELEASE, journey_id: journeyId, boot_id: `boot-${journeyId}` } })) };
        const evaluated = entry.finalizerEvaluate(receipt, readback, { workDir: fresh() });
        expect(evaluated?.errors).toEqual([]);
        // The finalizer settles the gating received row from the readback and leaves the report-only one HOLD.
        expect(evaluated!.rows.filter((r) => r.verdict !== 'PASS').map((r) => r.step).sort()).toEqual(['feedback retention', 'signup-stage telemetry received']);
        const out = entry.j8CaseResult(receipt, readback, evaluated);
        expect(out.assertions.length).toBeGreaterThan(0);
        expect(out.assertions.filter((a) => a.result !== 'PASS')).toEqual([]);
        // CONTROL: the same run with one gating row left HOLD (the received row unsettled by a readback that did not qualify) is not PASS.
        const unqualified = { ...readback, journeys: readback.journeys.map((j, i) => (i === 0 ? { ...j, verdict: 'HOLD' } : j)) };
        const held = entry.j8CaseResult(receipt, unqualified, entry.finalizerEvaluate(receipt, unqualified, { workDir: fresh() }));
        expect(held.assertions.some((a) => a.result === 'HOLD')).toBe(true);
    }, 60_000);
});

describe('J8 receipt leak guard: the run-owned account id is registered (upload-payload review, 23 Nov)', () => {
    const spec = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../live/rwt-feedback-association-boundaries.live.spec.ts'), 'utf8');
    it('the spec registers owner.uid with the receipt immediately after it is known, beside the email and the service key', () => {
        const assigned = spec.indexOf('owner.uid = account.uid;');
        const forbidden = spec.indexOf('receipt.forbid(owner.uid);');
        expect(assigned).toBeGreaterThan(-1);
        expect(forbidden).toBeGreaterThan(assigned);
        expect(spec.slice(assigned, forbidden).split('\n').filter((l) => !l.trim().startsWith('//')).length).toBeLessThanOrEqual(2);
        expect(spec).toContain('receipt.forbid(owner.email, SERVICE_ROLE);');
    });
    it('a receipt carrying the registered account id is caught by the content check; one without it is clean', () => {
        const uid = '7f3c9a1e-1111-4111-8111-222222222222';
        const leaking = new RwtReceipt(J8_SUITE);
        leaking.row('evidence carrying the id', 'PASS', 'detail', { userId: uid });
        expect(receiptContentLeaks(leaking, [uid])).toEqual([uid]);
        const clean = new RwtReceipt(J8_SUITE);
        clean.row('evidence without the id', 'PASS', 'detail', { userIdSha256: 'a'.repeat(64) });
        expect(receiptContentLeaks(clean, [uid])).toEqual([]);
    });
});
