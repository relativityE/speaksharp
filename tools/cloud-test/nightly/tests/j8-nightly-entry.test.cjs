"use strict";
// J8's dedicated nightly entry (Sam, 21 Nov, option 1): the runner that owns the account lifecycle records the create attempt
// before the signup, binds the receipt and cleanup to the same run and attempt, and maps J8's received rows only from the
// independent readback. Offline only: the spec, readback, evaluation and lookup are fixtures; nothing here is live.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const { expect } = require('./expect-lite.cjs');
const { J8_RECEIPT_MAP, J8_SUITE } = require('../j8-receipt-mapping.cjs');
const { admitRun } = require('../cleanup-evidence.cjs');
const entry = require('../j8-nightly-entry.cjs');

const LEGS = ['J8.a', 'J8.b', 'J8.c'];
const RELEASE = 'd'.repeat(40);
const DOMAIN = 'tests.example.com';
const RUN_ID = '43000000123';
const NOW = 1795300000000;
const JOURNEY_OF = { 'J8.a': 'journey-a', 'J8.b': 'journey-final-b', 'J8.c': 'journey-c' };
/** The spec's admission check (rwtJ8Journey.ts LOOKUP_REF), so the entry's record is one the spec accepts. */
const SPEC_LOOKUP_REF = /^rwt-journey-[a-z0-9-]{4,80}@[a-z0-9.-]+\.[a-z]{2,}$/;

function dirs() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'j8-entry-'));
    const evidenceDir = path.join(root, 'evidence');
    const runDir = path.join(root, 'run');
    fs.mkdirSync(evidenceDir);
    fs.mkdirSync(path.join(runDir, 'test-results', 'rwt'), { recursive: true });
    return { root, evidenceDir, runDir };
}
/** A receipt whose every mapped row PASSes, bound to `attemptId`, each leg bound to its own journey. */
function receiptFor(attemptId, extra = []) {
    const steps = new Set(['receipt content-free', 'zero residue', 'journey telemetry received']);
    for (const leg of LEGS) for (const sources of Object.values(J8_RECEIPT_MAP[leg]))
        for (const s of sources) if (s.scope !== 'readback') steps.add(s.scope === 'leg' ? `${leg}: ${s.step}` : s.step);
    const rows = [...steps].map((step) => (step === 'J8 leg readback bindings'
        ? { step, verdict: 'PASS', detail: '', evidence: { ...JOURNEY_OF } } : { step, verdict: 'PASS', detail: '' }));
    return { suite: J8_SUITE, release: RELEASE, meta: { runnerAttempt: attemptId }, rows: [...rows, ...extra],
        readback: { journeys: LEGS.map((l) => ({ journeyId: JOURNEY_OF[l], stages: ['share_feedback'] })), reportedJourneyIds: [], missingBindings: [] } };
}
/** Fixtures that pass, each one recording how it was called. `spec(admission)` returns the receipt the spec writes. */
function fixtures(runDir, { spec = (adm) => receiptFor(adm.createAttempt.attemptId), qualify = () => 0, evaluate, lookup = () => ({ lookup: 'zero' }), coaching } = {}) {
    const calls = { runSpec: [], qualify: [], evaluate: 0, lookup: [], coaching: [] };
    return {
        calls,
        deps: {
            runSpec: async ({ env }) => {
                const admission = JSON.parse(fs.readFileSync(env.RWT_J8_RUNNER_ADMISSION, 'utf8'));
                const evidence = path.dirname(env.RWT_J8_RUNNER_ADMISSION);
                calls.runSpec.push({ env, admission, sentBefore: fs.readdirSync(evidence).filter((n) => n.includes('.attempt.') && n.endsWith('.sent.json')) });
                const receipt = spec(admission);
                if (receipt) fs.writeFileSync(path.join(runDir, 'test-results', 'rwt', entry.RECEIPT_FILE), JSON.stringify(receipt));
                return 0;
            },
            qualify: async (q) => { calls.qualify.push(q); return qualify(q); },
            evaluate: async (receipt, readback) => { calls.evaluate += 1; return evaluate ? evaluate(receipt, readback) : { suite: receipt.suite, release: receipt.release, errors: [], rows: receipt.rows }; },
            lookup: async (q) => { calls.lookup.push(q); return lookup(q); },
            ...(coaching ? { coaching: async (q) => { calls.coaching.push(q); return coaching(q); } } : {}),
        },
    };
}
const run = (d, deps, over = {}) => entry.runJ8Nightly({ evidenceDir: d.evidenceDir, runDir: d.runDir, runId: RUN_ID, runAttempt: '1',
    configuredDomain: DOMAIN, deps, now: () => NOW, ...over });
const resultOf = (out, leg, id) => out.caseResult.assertions.find((a) => a.leg === leg && a.id === id).result;

describe('J8 nightly entry', () => {
    it('records the account-create attempt BEFORE the spec runs, and admits exactly this run, attempt and reserved email', async () => {
        const d = dirs();
        const f = fixtures(d.runDir);
        const out = await run(d, f.deps);
        expect(f.calls.runSpec.length).toBe(1);
        const [{ env, admission, sentBefore }] = f.calls.runSpec;
        expect(sentBefore).toEqual([`j8-${RUN_ID}-1.attempt.j8-${RUN_ID}-1.sent.json`]);
        expect({ suite: admission.suite, runId: admission.runId, runAttempt: admission.runAttempt }).toEqual({ suite: J8_SUITE, runId: RUN_ID, runAttempt: '1' });
        expect(env.GITHUB_RUN_ID).toBe(RUN_ID);
        expect(env.GITHUB_RUN_ATTEMPT).toBe('1');
        expect(admission.createAttempt.recordedBeforeSend).toBe(true);
        expect(admission.createAttempt.lookupRef).toBe(`rwt-journey-feedback-boundary-${NOW}-${RUN_ID}@${DOMAIN}`);
        expect(SPEC_LOOKUP_REF.test(admission.createAttempt.lookupRef)).toBe(true);
        const sent = JSON.parse(fs.readFileSync(path.join(d.evidenceDir, sentBefore[0]), 'utf8'));
        expect({ leg: sent.leg, lookupRef: sent.lookupRef, emailDomain: sent.emailDomain }).toEqual({ leg: 'J8.a', lookupRef: `rwt-journey-feedback-boundary-${NOW}-${RUN_ID}`, emailDomain: DOMAIN });
        expect(out.exitCode).toBe(0);
        expect(out.caseResult.assertions.every((a) => a.result === 'PASS')).toBe(true);
        expect(out.cleanup.result).toBe('complete');
    });
    it('MISSING ADMISSION: a refused admission sends nothing and runs nothing (no evidence dir, an unresolved earlier run)', async () => {
        const d = dirs();
        const f = fixtures(d.runDir);
        const missing = await run(d, f.deps, { evidenceDir: path.join(d.root, 'nope') });
        expect(missing.exitCode).toBe(78);
        expect(/^HOLD: J8 not admitted, nothing sent/.test(missing.reason)).toBe(true);
        fs.writeFileSync(path.join(d.evidenceDir, 'j8-1-1.started.json'), JSON.stringify({ runId: 'j8-1-1', journeys: ['J8'] }));
        const blocked = await run(d, f.deps);
        expect(blocked.exitCode).toBe(78);
        expect(/earlier runs must be recovered first/.test(blocked.reason)).toBe(true);
        expect(f.calls.runSpec.length).toBe(0);
        expect(fs.readdirSync(d.evidenceDir).filter((n) => n.includes('.attempt.') || n.includes('j8-admission'))).toEqual([]);
    });
    it('MISSING ADMISSION: the spec never runs standalone, and the run cannot be admitted twice (one create per journey per run)', async () => {
        const d = dirs();
        const f = fixtures(d.runDir);
        expect((await run(d, f.deps)).exitCode).toBe(0);
        // The same run and attempt again: its start record already exists, so it is refused before any send.
        const again = await run(d, f.deps);
        expect(again.exitCode).toBe(78);
        expect(f.calls.runSpec.length).toBe(1);
        // Bad identity never reaches admission.
        for (const over of [{ runId: 'x1' }, { runAttempt: '' }, { configuredDomain: 'not a domain' }]) {
            const e = dirs();
            expect((await run(e, fixtures(e.runDir).deps, over)).exitCode).toBe(78);
        }
    });
    it('the run\'s create attempt stays open after the run (no parent terminal answer), so the next run is held until it is recovered', async () => {
        const d = dirs();
        await run(d, fixtures(d.runDir).deps);
        const next = admitRun(d.evidenceDir);
        expect(next.admitted).toBe(false);
        expect(next.blocking.some((b) => /account-create attempt has no terminal result/.test(b))).toBe(true);
    });
    it('WRONG ATTEMPT: a receipt bound to another attempt, or to none, is never mapped or read back', async () => {
        for (const spec of [(adm) => receiptFor(`${adm.createAttempt.attemptId}-earlier`), () => ({ ...receiptFor('x'), meta: {} }), () => null]) {
            const d = dirs();
            const f = fixtures(d.runDir, { spec });
            const out = await run(d, f.deps);
            expect(out.exitCode).toBe(78);
            expect(out.caseResult.assertions.every((a) => a.result === 'HOLD')).toBe(true);
            expect(f.calls.qualify.length).toBe(0);
            expect(f.calls.evaluate).toBe(0);
        }
    });
    it('RECEIVED comes only from the independent readback: a J8.b journey the readback did not qualify holds J8.b\'s received row', async () => {
        const d = dirs();
        const f = fixtures(d.runDir, { qualify: (q) => (q.journeyId === 'journey-final-b' ? 1 : 0) });
        const out = await run(d, f.deps);
        expect(f.calls.qualify.map((q) => q.journeyId).sort()).toEqual(['journey-a', 'journey-c', 'journey-final-b']);
        expect(f.calls.qualify.every((q) => q.release === RELEASE && q.stages.join() === 'share_feedback')).toBe(true);
        expect(out.readback.journeys.find((j) => j.journeyId === 'journey-final-b').verdict).toBe('HOLD');
        expect(resultOf(out, 'J8.b', 'AHT-07:received-feedback-proof')).toBe('HOLD');
        expect(resultOf(out, 'J8.a', 'AHT-08:received-feedback-proof')).toBe('PASS');
        expect(out.exitCode).toBe(78);
        // An observed received failure (exit 3) is FAIL, and fails the run.
        const e = dirs();
        const failed = await run(e, fixtures(e.runDir, { qualify: (q) => (q.journeyId === 'journey-final-b' ? 3 : 0) }).deps);
        expect(resultOf(failed, 'J8.b', 'AHT-07:received-feedback-proof')).toBe('FAIL');
        expect(failed.exitCode).toBe(1);
        // A readback call that throws is HOLD, never QUALIFIED.
        const t = dirs();
        const thrown = await run(t, fixtures(t.runDir, { qualify: () => { throw new Error('network'); } }).deps);
        expect(thrown.readback.journeys.every((j) => j.verdict === 'HOLD')).toBe(true);
    });
    it('BORROWED EVIDENCE FROM AN EARLIER SUBMIT: J8.b bound to a fault attempt\'s journey as well as the final one is HOLD', async () => {
        const d = dirs();
        const spec = (adm) => {
            const r = receiptFor(adm.createAttempt.attemptId);
            r.rows = r.rows.map((x) => (x.step === 'J8 leg readback bindings' ? { ...x, evidence: { ...JOURNEY_OF, 'J8.b': 'journey-fault-1,journey-final-b' } } : x));
            r.readback.journeys.push({ journeyId: 'journey-fault-1', stages: ['share_feedback'] });
            return r;
        };
        const out = await run(d, fixtures(d.runDir, { spec }).deps);
        expect(resultOf(out, 'J8.b', 'AHT-07:received-feedback-proof')).toBe('HOLD');
        expect(out.exitCode).toBe(78);
    });
    it('the reviewed finalizer decides: an evaluation error, or settled rows of another release, is HOLD for every row', async () => {
        for (const evaluate of [() => ({ suite: J8_SUITE, release: RELEASE, errors: ['readback verdicts are for a different release'], rows: [] }),
            (r) => ({ suite: r.suite, release: 'e'.repeat(40), errors: [], rows: r.rows }), () => null, () => { throw new Error('crash'); }]) {
            const d = dirs();
            const out = await run(d, fixtures(d.runDir, { evaluate }).deps);
            expect(out.caseResult.assertions.every((a) => a.result === 'HOLD')).toBe(true);
            expect(out.exitCode).toBe(78);
        }
        // The settled rows are what is mapped: the finalizer's HOLD for the received merge floors every leg.
        const d = dirs();
        const out = await run(d, fixtures(d.runDir, { evaluate: (r) => ({ suite: r.suite, release: r.release, errors: [],
            rows: r.rows.map((x) => (x.step === 'journey telemetry received' ? { ...x, verdict: 'HOLD' } : x)) }) }).deps);
        expect(out.caseResult.assertions.every((a) => a.result === 'HOLD')).toBe(true);
    });
    it('J8.b\'s coaching readback is anchored to the ONE journey bound to J8.b; an unbound result is a HOLD', async () => {
        const chain = { step: 'J8.b: feedback diagnostic chain', verdict: 'HOLD', detail: '', evidence: { reasons: 'telemetry_not_received',
            expectedRequestSha256: 'r'.repeat(64), expectedAttemptSha256: 'a'.repeat(64), expectedProduct: 'p', expectedConfiguredModel: 'm', expectedOutcome: 'o' } };
        const d = dirs();
        const f = fixtures(d.runDir, { spec: (adm) => receiptFor(adm.createAttempt.attemptId, [chain]), coaching: () => ({ verdict: 'PASS', reasons: [] }) });
        const out = await run(d, f.deps);
        expect(f.calls.coaching.map((c) => c.journeyId)).toEqual(['journey-final-b']);
        expect(f.calls.coaching[0].expectation).toEqual({ requestSha256: 'r'.repeat(64), attemptSha256: 'a'.repeat(64), product: 'p', configuredModel: 'm', outcome: 'o' });
        expect(out.readback.coachingDiagnostic).toEqual({ verdict: 'HOLD', reasons: ['diagnostic_not_received'] });
        // A result naming its release but not the binding it was computed for is unbound too.
        const u = dirs();
        const noBinding = await run(u, fixtures(u.runDir, { spec: (adm) => receiptFor(adm.createAttempt.attemptId, [chain]),
            coaching: () => ({ verdict: 'PASS', reasons: [], release: RELEASE }) }).deps);
        expect(noBinding.readback.coachingDiagnostic).toEqual({ verdict: 'HOLD', reasons: ['diagnostic_not_received'] });
        // Bound result: kept as the readback returned it, for the finalizer to check against the chain row.
        const e = dirs();
        const expected = f.calls.coaching[0].expectation;
        const bound = await run(e, fixtures(e.runDir, { spec: (adm) => receiptFor(adm.createAttempt.attemptId, [chain]),
            coaching: () => ({ verdict: 'PASS', reasons: [], release: RELEASE, expected }) }).deps);
        expect(bound.readback.coachingDiagnostic).toEqual({ verdict: 'PASS', reasons: [], release: RELEASE, expected });
    });
    it('CLEANUP is bound to the same run and attempt: complete only with the spec\'s zero residue and the parent\'s lookup at zero', async () => {
        const d = dirs();
        const f = fixtures(d.runDir);
        await run(d, f.deps);
        expect(f.calls.lookup).toEqual([{ email: `rwt-journey-feedback-boundary-${NOW}-${RUN_ID}@${DOMAIN}`, runOwnedPrefix: 'rwt-journey-' }]);
        const doc = JSON.parse(fs.readFileSync(path.join(d.evidenceDir, `j8-${RUN_ID}-1.cleanup.json`), 'utf8'));
        expect(doc.cleanup).toBe('complete');
        expect(doc.journeys[0].verification).toEqual({ kind: 'zero-residue', queries: [{ kind: 'account', scope: `rwt-journey-feedback-boundary-${NOW}-${RUN_ID}`, count: 0 }] });
        const cases = {
            'the account is still there': { lookup: () => ({ lookup: 'one', uid: 'u' }) },
            'the lookup could not read the listing': { lookup: () => ({ lookup: 'unreadable' }) },
            'the lookup threw': { lookup: () => { throw new Error('x'); } },
            'the spec recorded no zero residue': { spec: (adm) => receiptFor(adm.createAttempt.attemptId).rows && { ...receiptFor(adm.createAttempt.attemptId),
                rows: receiptFor(adm.createAttempt.attemptId).rows.map((x) => (x.step === 'zero residue' ? { ...x, verdict: 'FAIL' } : x)) } },
            'the spec wrote no receipt': { spec: () => null },
        };
        for (const [name, over] of Object.entries(cases)) {
            const e = dirs();
            const out = await run(e, fixtures(e.runDir, over).deps);
            expect({ name, cleanup: out.cleanup.result, exit: out.exitCode === 0 }).toEqual({ name, cleanup: 'incomplete', exit: false });
        }
    });
    it('cleanup still runs when the spec crashes, and a create record that is not this attempt\'s is never trusted', async () => {
        const d = dirs();
        const f = fixtures(d.runDir);
        f.deps.runSpec = async () => { throw new Error('browser crashed'); };
        const out = await run(d, f.deps);
        expect(out.cleanup.result).toBe('incomplete');
        expect(out.caseResult.assertions.every((a) => a.result === 'HOLD')).toBe(true);
        const e = dirs();
        const adm = entry.admitJ8({ evidenceDir: e.evidenceDir, runId: RUN_ID, runAttempt: '1', configuredDomain: DOMAIN, now: () => NOW });
        const lookups = [];
        const doc = await entry.teardownJ8({ evidenceDir: e.evidenceDir, admission: { ...adm, local: `${adm.local}x` }, receipt: receiptFor(adm.attemptId),
            lookup: async (q) => { lookups.push(q); return { lookup: 'zero' }; } });
        expect(doc.cleanup).toBe('incomplete');
        expect(lookups).toEqual([]);
    });
    it('LIVE GATE UNCHANGED: main refuses before admission without offline fixtures, and records nothing', async () => {
        const d = dirs();
        const argv = ['--evidence-dir', d.evidenceDir, '--run-dir', d.runDir, '--run-id', RUN_ID, '--run-attempt', '1', '--execute', 'true'];
        const out = await entry.main(argv, { LIVE_TEST_EMAIL_DOMAIN: DOMAIN }, {});
        expect(out.exitCode).toBe(78);
        expect(/live gate is closed/.test(out.reason)).toBe(true);
        expect(fs.readdirSync(d.evidenceDir)).toEqual([]);
        expect((await entry.main(argv.slice(0, -2), { LIVE_TEST_EMAIL_DOMAIN: DOMAIN }, {})).exitCode).toBe(78);
        expect((await entry.main(argv, {}, fixtures(d.runDir).deps)).exitCode).toBe(78);
        expect((await entry.main([...argv, '--plan', 'x'], { LIVE_TEST_EMAIL_DOMAIN: DOMAIN }, fixtures(d.runDir).deps)).exitCode).toBe(78);
        // With fixtures it runs the same composition.
        expect((await entry.main(argv, { LIVE_TEST_EMAIL_DOMAIN: DOMAIN }, fixtures(d.runDir).deps)).exitCode).toBe(0);
    });
});
