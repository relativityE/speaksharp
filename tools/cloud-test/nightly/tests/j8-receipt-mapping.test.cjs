"use strict";
// Nightly AHT suite: J8's one receipt becomes its invocation's case result, fail closed, each row on its own leg only.
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { expect } = require('./expect-lite.cjs');
const { J8_DEFERRED_STEPS, J8_NON_GATING_STEPS, J8_SUITE, J8_RECEIPT_MAP, mapJ8Receipt } = require('../j8-receipt-mapping.cjs');
const { splitCaseResult } = require('../case-results.cjs');
const { rowsForLeg } = require('../journey-plan.cjs');

const LEGS = ['J8.a', 'J8.b', 'J8.c'];
const RELEASE = 'b'.repeat(40);
const ATTEMPT = 'j8-43000000123-1';
const JOURNEY_OF = { 'J8.a': 'journey-a', 'J8.b': 'journey-final-b', 'J8.c': 'journey-c' };
/**
 * The rows a fully passing J8 run carries once the finalizer has settled them: every receipt step the mapping reads, PASS, plus the
 * rows the mapping does not consume, as the spec and the finalizer leave them. `feedback retention` is HOLD (the parent deletes the
 * account after the spec exits). The telemetry rows are telemetryClassRows' (claimed, qualifying): `signup-stage telemetry received`
 * is always HOLD (report-only, non-gating), and `journey telemetry received` is PASS once the readback merge settles it. Each leg is
 * bound to its own journey (`J8 leg readback bindings`), and the receipt declares those three journeys for the readback.
 */
const SETTLED_HOLDS = new Set(['feedback retention', 'signup-stage telemetry received']);
function passingReceipt(extra = []) {
    const steps = new Set(['receipt content-free', 'zero residue', 'feedback retention', 'feedback fence close', 'telemetry decodable',
        'signup-stage telemetry (user class)', 'signup-stage telemetry received', 'journey telemetry (canary class)', 'journey telemetry received']);
    for (const leg of LEGS) for (const sources of Object.values(J8_RECEIPT_MAP[leg]))
        for (const s of sources) if (s.scope !== 'readback') steps.add(s.scope === 'leg' ? `${leg}: ${s.step}` : s.step);
    const rows = [...steps].map((step) => (step === 'J8 leg readback bindings'
        ? { step, verdict: 'PASS', detail: '', evidence: { ...JOURNEY_OF } } : { step, verdict: SETTLED_HOLDS.has(step) ? 'HOLD' : 'PASS', detail: '' }));
    return { suite: J8_SUITE, release: RELEASE, meta: { runnerAttempt: ATTEMPT }, rows: [...rows, ...extra],
        readback: { journeys: LEGS.map((l) => ({ journeyId: JOURNEY_OF[l], stages: ['share_feedback'] })), reportedJourneyIds: [], missingBindings: [] } };
}
/**
 * The independent readback for a receipt: every bound journey QUALIFIED unless `verdicts` says otherwise, each verdict carrying the
 * readback CLI's own evidence of that journey on that release, the whole bound to this run and create attempt and to J8.b's
 * final-submit journey.
 */
const readbackFor = (r, verdicts = {}) => ({ suite: J8_SUITE, release: r.release, missingBindings: [],
    binding: { runId: '43000000123', runAttempt: '1', createAttempt: ATTEMPT }, finalSubmit: { journeyId: JOURNEY_OF['J8.b'] },
    journeys: r.readback.journeys.map((j) => ({ journeyId: j.journeyId, stages: [...j.stages], verdict: verdicts[j.journeyId] ?? 'QUALIFIED',
        received: { release_sha: r.release, journey_id: j.journeyId, boot_id: 'boot-1' } })) });
/** The mapping with a passing independent readback unless one is given. */
const map = (r, rb = readbackFor(r)) => mapJ8Receipt(r, rb);
const without = (r, step) => ({ ...r, rows: r.rows.filter((x) => x.step !== step) });
const withVerdict = (r, step, verdict) => ({ ...r, rows: r.rows.map((x) => (x.step === step ? { ...x, verdict } : x)) });
const rowOf = (out, leg, id) => out.assertions.find((a) => a.leg === leg && a.id === id);
const thrown = (f) => { try { f(); } catch (e) { return String(e.message); } return null; };
const planId = (row) => (row.startsWith('invariant:') || row.startsWith('new:') ? row.slice(row.indexOf(':') + 1) : row);

describe('J8 receipt mapping', () => {
    it('covers exactly every plan row of every J8 leg, once each', () => {
        const out = map(passingReceipt());
        for (const leg of LEGS) {
            const ids = out.assertions.filter((a) => a.leg === leg).map((a) => a.id).sort();
            expect(ids).toEqual(rowsForLeg(leg).map(planId).sort());
        }
        expect(out.assertions.length).toBe(13 + 19 + 5);
    });
    it('passes every row a passing receipt proves: no row is a named gap any more', () => {
        const out = map(passingReceipt());
        for (const leg of LEGS) for (const row of rowsForLeg(leg)) expect({ leg, row, result: rowOf(out, leg, planId(row)).result }).toEqual({ leg, row, result: 'PASS' });
        expect(out.assertions.filter((a) => a.sources.some((s) => s.startsWith('GAP'))).length).toBe(0);
    });
    it('J8.a\'s Start-press rows rest on its OWN zero-Start row; the journey-wide count never stands in for it', () => {
        const out = map(without(passingReceipt(), 'J8.a: no Start press'));
        for (const id of ['start-press-budget', 'AHT-08:start-press-budget']) expect(rowOf(out, 'J8.a', id).result).toBe('HOLD');
        const pressed = map(withVerdict(passingReceipt(), 'J8.a: no Start press', 'FAIL'));
        for (const id of ['start-press-budget', 'AHT-08:start-press-budget']) expect(rowOf(pressed, 'J8.a', id).result).toBe('FAIL');
        // A J8.a press never touches J8.b's own count (J8.b's other rows stay PASS).
        expect(rowOf(pressed, 'J8.b', 'AHT-07:start-press-budget').result).toBe('PASS');
    });
    it('J8.b\'s Start-press rows need BOTH its own count and the journey-wide count', () => {
        for (const step of ['J8.b: Start presses within budget', 'Start presses within budget']) {
            const out = map(without(passingReceipt(), step));
            for (const id of ['start-press-budget', 'AHT-07:start-press-budget']) expect({ step, id, r: rowOf(out, 'J8.b', id).result }).toEqual({ step, id, r: 'HOLD' });
        }
        // J8.c's own Start check is its own row, unaffected by J8.b's.
        expect(rowOf(map(without(passingReceipt(), 'J8.b: Start presses within budget')), 'J8.c', 'start-press-budget').result).toBe('PASS');
    });
    it('J8.b\'s fresh acknowledgment and final pair are its own: J8.a\'s or J8.c\'s never stand in', () => {
        const noAck = map(without(passingReceipt(), 'J8.b: fresh acknowledgment'));
        expect(rowOf(noAck, 'J8.b', 'AHT-07:fresh-acknowledgment').result).toBe('HOLD');
        expect(rowOf(noAck, 'J8.a', 'AHT-08:fresh-acknowledgment').result).toBe('PASS');
        const noSent = map(without(passingReceipt(), 'J8.b: final feedback pair sent'));
        expect(rowOf(noSent, 'J8.b', 'AHT-07:received-feedback-proof').result).toBe('HOLD');
        expect(rowOf(noSent, 'J8.a', 'AHT-08:received-feedback-proof').result).toBe('PASS');
        const notIsolated = map(withVerdict(passingReceipt(), 'J8.b: final submit isolated from the fault legs', 'FAIL'));
        expect(rowOf(notIsolated, 'J8.b', 'AHT-07:received-feedback-proof').result).toBe('FAIL');
    });
    it('SENT IS NOT RECEIVED (Sam): with every sent row PASS, received rows rest on the independent readback only', () => {
        const r = passingReceipt();
        for (const [leg, id] of [['J8.a', 'AHT-08:received-feedback-proof'], ['J8.b', 'AHT-07:received-feedback-proof'], ['J8.c', 'no-session-choice-with-takes']]) {
            // No readback at all: HOLD, never PASS, whatever the receipt's own sent rows say.
            expect({ leg, r: rowOf(mapJ8Receipt(r), leg, id).result }).toEqual({ leg, r: 'HOLD' });
            // The leg's own journey not qualified: HOLD; an observed received failure: FAIL.
            expect({ leg, r: rowOf(map(r, readbackFor(r, { [JOURNEY_OF[leg]]: 'HOLD' })), leg, id).result }).toEqual({ leg, r: 'HOLD' });
            expect({ leg, r: rowOf(map(r, readbackFor(r, { [JOURNEY_OF[leg]]: 'FAIL' })), leg, id).result }).toEqual({ leg, r: 'FAIL' });
        }
        // Another leg's journey failing its readback never touches J8.b's received row.
        expect(rowOf(map(r, readbackFor(r, { 'journey-a': 'HOLD' })), 'J8.b', 'AHT-07:received-feedback-proof').result).toBe('PASS');
        // A receipt row named like the readback source is never read as it.
        const forged = passingReceipt([{ step: 'J8.b: received feedback (independent readback)', verdict: 'PASS', detail: '' }]);
        expect(rowOf(mapJ8Receipt(forged), 'J8.b', 'AHT-07:received-feedback-proof').result).toBe('HOLD');
    });
    it('BORROWED EVIDENCE: a readback that is not this receipt\'s, or a leg not bound once to its own journey, is HOLD', () => {
        const r = passingReceipt();
        const id = 'AHT-07:received-feedback-proof';
        const cases = {
            'another release': [r, { ...readbackFor(r), release: 'c'.repeat(40) }],
            'another suite': [r, { ...readbackFor(r), suite: 'feedback-association-boundaries-older-take' }],
            'an extra journey (an earlier submit\'s)': [r, { ...readbackFor(r), journeys: [...readbackFor(r).journeys, { journeyId: 'journey-fault-1', stages: ['share_feedback'], verdict: 'QUALIFIED' }] }],
            'a journey missing': [r, { ...readbackFor(r), journeys: readbackFor(r).journeys.filter((j) => j.journeyId !== 'journey-final-b') }],
            'another stage': [r, { ...readbackFor(r), journeys: readbackFor(r).journeys.map((j) => ({ ...j, stages: ['session_after_open_mic'] })) }],
            'malformed': [r, { suite: J8_SUITE, release: RELEASE }],
        };
        for (const [name, [receipt, rb]] of Object.entries(cases)) expect({ name, r: rowOf(map(receipt, rb), 'J8.b', id).result }).toEqual({ name, r: 'HOLD' });
        // J8.b bound to two journeys (a fault attempt's and the final one's), or the binding row not PASS: HOLD even if both qualified.
        const two = { ...r, rows: r.rows.map((x) => (x.step === 'J8 leg readback bindings' ? { ...x, evidence: { ...JOURNEY_OF, 'J8.b': 'journey-final-b,journey-fault-1' } } : x)),
            readback: { ...r.readback, journeys: [...r.readback.journeys, { journeyId: 'journey-fault-1', stages: ['share_feedback'] }] } };
        expect(rowOf(map(two, readbackFor(two)), 'J8.b', id).result).toBe('HOLD');
        // J8.b bound to a journey the readback qualified, but which the receipt did not declare for its feedback stage: HOLD.
        const elsewhere = { ...r, rows: r.rows.map((x) => (x.step === 'J8 leg readback bindings' ? { ...x, evidence: { ...JOURNEY_OF, 'J8.b': 'journey-fault-1' } } : x)) };
        expect(rowOf(map(elsewhere, readbackFor(r)), 'J8.b', id).result).toBe('HOLD');
        // The sources name why.
        expect(rowOf(mapJ8Receipt(r), 'J8.b', id).sources).toContain('J8.b: received feedback (independent readback): no independent readback');
    });
    it('UNBOUND READBACK (Sam on b1f8323f): no run/create-attempt binding, a verdict without the CLI\'s own evidence, or J8.b off its final submit is HOLD', () => {
        const r = passingReceipt();
        const id = 'AHT-07:received-feedback-proof';
        const rb = readbackFor(r);
        const evidenceOf = (journeyId, received) => ({ ...rb, journeys: rb.journeys.map((j) => (j.journeyId === journeyId ? { ...j, received } : j)) });
        const cases = {
            'no binding': { ...rb, binding: undefined },
            'another create attempt': { ...rb, binding: { ...rb.binding, createAttempt: 'j8-43000000123-2' } },
            'no run id': { ...rb, binding: { ...rb.binding, runId: '' } },
            'a bare exit code': evidenceOf('journey-final-b', undefined),
            'evidence for another journey': evidenceOf('journey-final-b', { release_sha: RELEASE, journey_id: 'journey-a', boot_id: 'b' }),
            'evidence for another release': evidenceOf('journey-final-b', { release_sha: 'c'.repeat(40), journey_id: 'journey-final-b', boot_id: 'b' }),
            'no final submit': { ...rb, finalSubmit: null },
            'another final submit': { ...rb, finalSubmit: { journeyId: 'journey-fault-1' } },
        };
        for (const [name, b] of Object.entries(cases)) expect({ name, r: rowOf(map(r, b), 'J8.b', id).result }).toEqual({ name, r: 'HOLD' });
        // A receipt with no runner attempt can never match a readback binding.
        expect(rowOf(map({ ...r, meta: {} }, rb), 'J8.b', id).result).toBe('HOLD');
        // Another leg's received row only needs its own evidence: J8.a stays PASS while J8.b's evidence is missing.
        expect(rowOf(map(r, evidenceOf('journey-final-b', undefined)), 'J8.a', 'AHT-08:received-feedback-proof').result).toBe('PASS');
        // A FAIL also needs the CLI's own evidence: an unevidenced FAIL is HOLD, never a FAIL row.
        const failNoEvidence = { ...rb, journeys: rb.journeys.map((j) => (j.journeyId === 'journey-a' ? { ...j, verdict: 'FAIL', received: null } : j)) };
        expect(rowOf(map(r, failNoEvidence), 'J8.a', 'AHT-08:received-feedback-proof').result).toBe('HOLD');
    });
    it('DUPLICATE JOURNEY (Sam on b1f8323f): one journey bound to two legs holds every leg\'s received row', () => {
        const r = passingReceipt();
        const dup = { ...r, rows: r.rows.map((x) => (x.step === 'J8 leg readback bindings' ? { ...x, evidence: { ...JOURNEY_OF, 'J8.c': 'journey-a' } } : x)),
            readback: { ...r.readback, journeys: r.readback.journeys.filter((j) => j.journeyId !== 'journey-c') } };
        const out = map(dup, readbackFor(dup));
        for (const [leg, id] of [['J8.a', 'AHT-08:received-feedback-proof'], ['J8.b', 'AHT-07:received-feedback-proof']])
            expect({ leg, r: rowOf(out, leg, id).result }).toEqual({ leg, r: 'HOLD' });
        expect(rowOf(map(r), 'J8.a', 'AHT-08:received-feedback-proof').result).toBe('PASS');
    });
    it('lands every row on its own leg through the case-result splitter, with nothing unplaced', () => {
        const split = splitCaseResult('J8', map(passingReceipt()));
        for (const leg of LEGS) {
            const rows = split.get(leg);
            expect(Object.keys(rows).sort()).toEqual([...rowsForLeg(leg)].sort());
            expect(Object.keys(rows).filter((k) => k.startsWith('unplaced:'))).toEqual([]);
        }
    });
    it('CONTROL: a missing leg step is HOLD on that leg only, and another leg\'s same step never stands in for it', () => {
        const out = map(without(passingReceipt(), 'J8.a: fresh acknowledgment'));
        expect(rowOf(out, 'J8.a', 'AHT-08:fresh-acknowledgment').result).toBe('HOLD');
        // J8.c's fresh acknowledgment is still in the receipt and still passes J8.c.
        expect(rowOf(out, 'J8.c', 'no-session-choice-with-takes').result).toBe('PASS');
    });
    it('CONTROL: an unprefixed step never proves a leg-scoped row', () => {
        const r = without(passingReceipt([{ step: 'no-session association', verdict: 'PASS' }]), 'J8.a: no-session association');
        expect(rowOf(map(r), 'J8.a', 'AHT-08:no-session-association').result).toBe('HOLD');
    });
    it('a FAIL step fails every row that rests on it, and only those', () => {
        const out = map(withVerdict(passingReceipt(), 'J8.b: feedback leg request lost: same key on Retry', 'FAIL'));
        expect(rowOf(out, 'J8.b', 'AHT-07:feedback-transport-form-retry').result).toBe('FAIL');
        expect(rowOf(out, 'J8.b', 'AHT-07:feedback-failure-retry-form').result).toBe('FAIL');
        expect(rowOf(out, 'J8.b', 'AHT-07:feedback-rejection-form-retry').result).toBe('PASS');
        expect(rowOf(out, 'J8.a', 'AHT-08:fresh-acknowledgment').result).toBe('PASS');
    });
    it('a journey-wide step affects every leg: one account, one browser context', () => {
        const out = map(withVerdict(passingReceipt(), 'no Cloud speech-to-text request', 'FAIL'));
        for (const leg of LEGS) expect(rowOf(out, leg, 'no-cloud-stt').result).toBe('FAIL');
        const held = map(withVerdict(passingReceipt(), 'canary claim in fresh login', 'HOLD'));
        for (const leg of LEGS) expect(rowOf(held, leg, 'owner-bound').result).toBe('HOLD');
    });
    it('HUMAN and EXTERNAL steps are never a PASS', () => {
        for (const v of ['HUMAN', 'EXTERNAL', 'SOMETHING']) {
            const out = map(withVerdict(passingReceipt(), 'J8.c: both saved takes unchanged', v));
            expect(rowOf(out, 'J8.c', 'no-session-choice-with-takes').result).toBe('HOLD');
        }
    });
    it('a step written twice keeps its worse verdict', () => {
        const out = map(passingReceipt([{ step: 'J8.a: no-session report stored once', verdict: 'FAIL' }]));
        expect(rowOf(out, 'J8.a', 'AHT-08:feedback-stored-once').result).toBe('FAIL');
        // Order does not matter: a FAIL written first is not replaced by a later PASS.
        const r = passingReceipt();
        const first = { ...r, rows: [{ step: 'J8.a: no-session association', verdict: 'FAIL' }, ...r.rows] };
        expect(rowOf(map(first), 'J8.a', 'AHT-08:no-session-association').result).toBe('FAIL');
    });
    it('CONTROL: an unconsumed failing step is never ignored: journey-wide floors every leg, leg-scoped floors its own leg', () => {
        const journey = map(passingReceipt([{ step: 'scenario execution', verdict: 'FAIL' }]));
        for (const leg of LEGS) expect(journey.assertions.filter((a) => a.leg === leg).every((a) => a.result === 'FAIL')).toBe(true);
        expect(journey.unmapped.filter((u) => u.step === 'scenario execution')).toEqual([{ step: 'scenario execution', outcome: 'FAIL' }]);
        const legOnly = map(passingReceipt([{ step: 'J8.c: a renamed row', verdict: 'HOLD' }]));
        expect(legOnly.assertions.filter((a) => a.leg === 'J8.c').every((a) => a.result === 'HOLD')).toBe(true);
        expect(rowOf(legOnly, 'J8.a', 'AHT-08:fresh-acknowledgment').result).toBe('PASS');
        // An unconsumed PASS (e.g. the content-free row) floors nothing.
        expect(rowOf(map(passingReceipt()), 'J8.a', 'AHT-08:fresh-acknowledgment').result).toBe('PASS');
    });
    it('DEFERRED RETENTION (Codex on 4a5d718a): the spec\'s HOLD retention row floors nothing; a FAIL still fails every leg', () => {
        expect(J8_DEFERRED_STEPS).toEqual(['feedback retention']);
        const held = map(passingReceipt());
        expect(held.assertions.every((a) => a.result === 'PASS')).toBe(true);
        // Still reported, marked deferred, so it is never silently dropped.
        expect(held.unmapped.filter((u) => u.step === 'feedback retention')).toEqual([{ step: 'feedback retention', outcome: 'HOLD', deferred: true }]);
        const failed = map(withVerdict(passingReceipt(), 'feedback retention', 'FAIL'));
        for (const leg of LEGS) expect(failed.assertions.filter((a) => a.leg === leg).every((a) => a.result === 'FAIL')).toBe(true);
        expect(failed.unmapped.filter((u) => u.step === 'feedback retention')).toEqual([{ step: 'feedback retention', outcome: 'FAIL' }]);
        // HOLD and FAIL written twice: the FAIL wins and floors.
        const both = map(passingReceipt([{ step: 'feedback retention', verdict: 'FAIL' }]));
        expect(both.assertions.every((a) => a.result === 'FAIL')).toBe(true);
        const r = passingReceipt();
        const failFirst = map({ ...r, rows: [{ step: 'feedback retention', verdict: 'FAIL' }, ...r.rows] });
        expect(failFirst.assertions.every((a) => a.result === 'FAIL')).toBe(true);
        const humanFirst = map({ ...r, rows: [{ step: 'feedback retention', verdict: 'HUMAN' }, ...r.rows] });
        expect(humanFirst.assertions.every((a) => a.result === 'HOLD')).toBe(true);
        // Only exactly HOLD is deferred: an open human check or an external verdict on it still holds every leg.
        for (const v of ['HUMAN', 'EXTERNAL']) {
            const out = map(withVerdict(passingReceipt(), 'feedback retention', v));
            expect(out.assertions.every((a) => a.result === 'HOLD')).toBe(true);
        }
        // The exception is by name only: another unconsumed journey-wide HOLD still holds every leg.
        const other = map(passingReceipt([{ step: 'feedback retention after deletion', verdict: 'HOLD' }]));
        expect(other.assertions.every((a) => a.result === 'HOLD')).toBe(true);
        const legScoped = map(passingReceipt([{ step: 'J8.a: feedback retention', verdict: 'HOLD' }]));
        expect(legScoped.assertions.filter((a) => a.leg === 'J8.a').every((a) => a.result === 'HOLD')).toBe(true);
    });
    it('NON-GATING ROWS (Codex on 2e2e3bd2): the finalizer\'s report-only HOLD rows floor nothing; FAIL, HUMAN or EXTERNAL still floor', () => {
        expect([...J8_NON_GATING_STEPS].sort()).toEqual(['base_q4 primary', 'signup-stage telemetry received']);
        // The passing receipt already carries `signup-stage telemetry received` HOLD, as every J8 run does.
        const held = map(passingReceipt([{ step: 'base_q4 primary', verdict: 'HOLD' }]));
        expect(held.assertions.every((a) => a.result === 'PASS')).toBe(true);
        expect(held.unmapped.filter((u) => J8_NON_GATING_STEPS.includes(u.step)).sort((a, b) => a.step.localeCompare(b.step))).toEqual([
            { step: 'base_q4 primary', outcome: 'HOLD', nonGating: true }, { step: 'signup-stage telemetry received', outcome: 'HOLD', nonGating: true }]);
        for (const step of J8_NON_GATING_STEPS) {
            const base = passingReceipt(step === 'base_q4 primary' ? [{ step, verdict: 'HOLD' }] : []);
            // FAIL fails every leg, written alone, first or second; HUMAN or EXTERNAL holds every leg.
            const failed = map(withVerdict(base, step, 'FAIL'));
            expect(failed.assertions.every((a) => a.result === 'FAIL')).toBe(true);
            expect(failed.unmapped.filter((u) => u.step === step)).toEqual([{ step, outcome: 'FAIL' }]);
            expect(map({ ...base, rows: [{ step, verdict: 'FAIL' }, ...base.rows] }).assertions.every((a) => a.result === 'FAIL')).toBe(true);
            expect(map({ ...base, rows: [...base.rows, { step, verdict: 'FAIL' }] }).assertions.every((a) => a.result === 'FAIL')).toBe(true);
            for (const v of ['HUMAN', 'EXTERNAL']) {
                expect(map(withVerdict(base, step, v)).assertions.every((a) => a.result === 'HOLD')).toBe(true);
                expect(map({ ...base, rows: [{ step, verdict: v }, ...base.rows] }).assertions.every((a) => a.result === 'HOLD')).toBe(true);
            }
            // A leg-scoped copy is not the finalizer's row: it holds its leg.
            const legScoped = map(passingReceipt([{ step: `J8.b: ${step}`, verdict: 'HOLD' }]));
            expect(legScoped.assertions.filter((a) => a.leg === 'J8.b').every((a) => a.result === 'HOLD')).toBe(true);
            expect(legScoped.assertions.filter((a) => a.leg !== 'J8.b').every((a) => a.result === 'PASS')).toBe(true);
        }
        // By name only: the gating received row, the user-class sent row and a near-miss name still hold every leg.
        for (const step of ['journey telemetry received', 'signup-stage telemetry (user class)']) {
            expect(map(withVerdict(passingReceipt(), step, 'HOLD')).assertions.every((a) => a.result === 'HOLD')).toBe(true);
        }
        expect(map(passingReceipt([{ step: 'signup-stage telemetry received (late)', verdict: 'HOLD' }])).assertions.every((a) => a.result === 'HOLD')).toBe(true);
        // No plan row rests on an exempt step: a HOLD on one is excused only because nothing reads it.
        const exempt = new Set([...J8_DEFERRED_STEPS, ...J8_NON_GATING_STEPS]);
        for (const leg of LEGS) for (const sources of Object.values(J8_RECEIPT_MAP[leg])) for (const s of sources) expect(exempt.has(s.step)).toBe(false);
    });
    it('the non-gating list is exactly the finalizer\'s NON_GATING_ROWS, and every J8 run writes its telemetry row HOLD (drift guard)', () => {
        const root = path.join(__dirname, '..', '..', '..', '..');
        const acceptance = fs.readFileSync(path.join(root, 'tests', 'live', 'helpers', 'rwtAcceptance.ts'), 'utf8');
        const block = acceptance.slice(acceptance.indexOf('export const NON_GATING_ROWS'));
        const keys = [...block.slice(0, block.indexOf('});')).matchAll(/^\s+'([^']+)':/gm)].map((m) => m[1]).sort();
        expect(keys).toEqual([...J8_NON_GATING_STEPS].sort());
        const journey = fs.readFileSync(path.join(root, 'tests', 'live', 'helpers', 'rwtJourney.ts'), 'utf8');
        const writer = journey.slice(journey.indexOf('export function telemetryClassRows'));
        expect(writer.slice(0, writer.indexOf('\n}\n'))).toContain("receipt.row('signup-stage telemetry received', 'HOLD'");
        const spec = fs.readFileSync(path.join(root, 'tests', 'live', 'rwt-feedback-association-boundaries.live.spec.ts'), 'utf8');
        expect(spec.includes('telemetryClassRows(receipt, tap, claimed, true)')).toBe(true);
    });
    it('the J8 spec writes feedback retention as HOLD, the one shape the mapping defers (drift guard)', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'tests', 'live', 'rwt-feedback-association-boundaries.live.spec.ts'), 'utf8');
        expect((src.match(/receipt\.row\('feedback retention', '([A-Z]+)'/g) ?? []).map((m) => m.split("'")[3])).toEqual(['HOLD']);
    });
    it('a leg whose prerequisites HOLD was NOT RUN, but an earlier FAIL on it stays FAIL', () => {
        const r = passingReceipt([{ step: 'J8.c: prerequisites', verdict: 'HOLD' }]);
        const out = map(r);
        expect(out.assertions.filter((a) => a.leg === 'J8.c').every((a) => a.result === 'NOT_RUN')).toBe(true);
        expect(rowOf(out, 'J8.b', 'AHT-07:feedback-attempts').result).toBe('PASS');
        const failed = map(withVerdict(r, 'no Cloud speech-to-text request', 'FAIL'));
        expect(rowOf(failed, 'J8.c', 'no-cloud-stt').result).toBe('FAIL');
        // The splitter reads NOT_RUN as NOT RUN.
        expect(splitCaseResult('J8', out).get('J8.c')['new:no-session-choice-with-takes']).toBe('NOT RUN');
    });
    it('a leg whose prerequisites FAIL fails every one of its rows, never NOT RUN, and only that leg', () => {
        // Elon's probe: J8.a's setup failed while the journey's signup passed.
        const out = map(passingReceipt([{ step: 'J8.a: prerequisites', verdict: 'FAIL' }]));
        const legA = out.assertions.filter((a) => a.leg === 'J8.a');
        expect(legA.length).toBe(rowsForLeg('J8.a').length);
        expect(legA.every((a) => a.result === 'FAIL')).toBe(true);
        expect(legA.every((a) => a.sources.includes('J8.a: prerequisites'))).toBe(true);
        expect(rowOf(out, 'J8.b', 'AHT-07:feedback-attempts').result).toBe('PASS');
        expect(rowOf(out, 'J8.c', 'new:no-session-choice-with-takes'.slice(4)).result).toBe('PASS');
        expect(splitCaseResult('J8', out).get('J8.a')['AHT-08:fresh-acknowledgment']).toBe('FAIL');
        // A repeated prerequisites step is the worst of its verdicts.
        const twice = map(passingReceipt([{ step: 'J8.a: prerequisites', verdict: 'PASS' }, { step: 'J8.a: prerequisites', verdict: 'FAIL' }]));
        expect(twice.assertions.filter((a) => a.leg === 'J8.a').every((a) => a.result === 'FAIL')).toBe(true);
        // A human or external prerequisite is not a failure: the leg was NOT RUN. A passed one names no prerequisite source.
        const human = map(passingReceipt([{ step: 'J8.a: prerequisites', verdict: 'HUMAN' }]));
        expect(human.assertions.filter((a) => a.leg === 'J8.a').every((a) => a.result === 'NOT_RUN')).toBe(true);
        const passed = map(passingReceipt([{ step: 'J8.a: prerequisites', verdict: 'PASS' }]));
        expect(rowOf(passed, 'J8.a', 'AHT-08:fresh-acknowledgment')).toMatchObject({ result: 'PASS' });
        expect(rowOf(passed, 'J8.a', 'AHT-08:fresh-acknowledgment').sources.includes('J8.a: prerequisites')).toBe(false);
    });
    it('refuses a receipt that is not J8\'s or is malformed', () => {
        expect(thrown(() => mapJ8Receipt(null))).toBe('expected the feedback-association-boundaries-j8 receipt, got nothing');
        expect(thrown(() => mapJ8Receipt({ ...passingReceipt(), suite: 'feedback-association-boundaries-no-session' })))
            .toBe('expected the feedback-association-boundaries-j8 receipt, got feedback-association-boundaries-no-session');
        expect(thrown(() => mapJ8Receipt({ suite: J8_SUITE, rows: [] }))).toBe('the J8 receipt has no rows');
        expect(thrown(() => mapJ8Receipt({ suite: J8_SUITE, rows: [{ step: 'x' }] }))).toBe('the J8 receipt has a malformed row');
    });
    it('every receipt step it reads is a step the J8 spec or its helpers actually write (drift guard)', () => {
        const live = path.resolve(__dirname, '..', '..', '..', '..', 'tests', 'live');
        const sources = ['rwt-feedback-association-boundaries.live.spec.ts', 'helpers/feedbackDiagnosticRef.ts', 'helpers/feedbackAttemptLedger.ts',
            'helpers/rwtHarnessParity.ts', 'helpers/coachingFeedbackAdapter.ts', 'helpers/rwtCoachingCollector.ts', 'helpers/feedbackFence.ts',
            'helpers/rwtAcceptance.ts'].map((f) => fs.readFileSync(path.join(live, f), 'utf8')).join('\n');
        const missing = new Set();
        for (const leg of LEGS) for (const sources_ of Object.values(J8_RECEIPT_MAP[leg])) for (const s of sources_) {
            // A fault-leg row is written from FEEDBACK_LEG_ROWS as one literal; every other step is a literal row name. The readback
            // source is not a receipt row at all (it is the independent readback's verdict).
            if (s.scope === 'readback') continue;
            if (!sources.includes(`'${s.step}'`)) missing.add(s.step);
        }
        expect([...missing]).toEqual([]);
    });
});
