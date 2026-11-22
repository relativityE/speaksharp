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
const { admitRun, answerCreateAttempt } = require('../cleanup-evidence.cjs');
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
/** The readback CLI's own evidence line for `q`: what it checked, with the verdict its exit code implies (0 QUALIFIED, 3 FAIL). */
function evidenceFor(q, status, over = {}) {
    if (status !== 0 && status !== 3) return null;
    return { verdict: status === 0 ? 'QUALIFIED' : 'FAIL', release_sha: q.release, journey_id: q.journeyId, boot_id: `boot-${q.journeyId}`, traffic_type: 'canary',
        stages_declared: [...q.stages], attempts_declared: [...q.attemptIds], ...over };
}
/**
 * Records a trusted, timely `created` answer for the run's one create attempt. It stands in for the confirmed-signup route a live
 * UI signup does not have yet: only `answerCreateAttempt`'s own validation decides whether it counts.
 */
function trustedAnswer(evidenceDir, admission, over = {}) {
    const { attemptId } = admission.createAttempt;
    const lookupRef = admission.createAttempt.lookupRef.split('@')[0];
    const sent = JSON.parse(fs.readFileSync(path.join(evidenceDir, `${attemptId}.attempt.${attemptId}.sent.json`), 'utf8'));
    answerCreateAttempt(evidenceDir, attemptId, attemptId, { attemptId, lookupRef, outcome: 'created', accountRef: 'acct-1',
        receivedAt: new Date(Date.parse(sent.recordedAt) + 1000).toISOString(), beforeAbort: true, ...over });
}
/**
 * Fixtures that pass, each one recording how it was called. `spec(admission)` returns the receipt the spec writes; `outcome(env)`
 * the spec's terminal outcome; `answer` whether a trusted answer resolves the create attempt (null: none, the live default today).
 */
function fixtures(runDir, { spec = (adm) => receiptFor(adm.createAttempt.attemptId), qualify = () => 0, evidence = {}, evaluate, lookup = () => ({ lookup: 'zero' }), coaching,
    outcome = (env) => ({ exitCode: 0, admissionFile: env.RWT_J8_RUNNER_ADMISSION, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT, timedOut: false }),
    answer = 'trusted' } = {}) {
    const calls = { runSpec: [], qualify: [], evaluate: 0, lookup: [], coaching: [] };
    return {
        calls,
        deps: {
            runSpec: async ({ env }) => {
                const admission = JSON.parse(fs.readFileSync(env.RWT_J8_RUNNER_ADMISSION, 'utf8'));
                const evidenceDir = path.dirname(env.RWT_J8_RUNNER_ADMISSION);
                calls.runSpec.push({ env, admission, sentBefore: fs.readdirSync(evidenceDir).filter((n) => n.includes('.attempt.') && n.endsWith('.sent.json')) });
                if (answer === 'trusted') trustedAnswer(evidenceDir, admission);
                const receipt = spec(admission);
                if (receipt) fs.writeFileSync(path.join(runDir, 'test-results', 'rwt', entry.RECEIPT_FILE), JSON.stringify(receipt));
                return outcome(env);
            },
            qualify: async (q) => { calls.qualify.push(q); const status = qualify(q); return { status, evidence: evidenceFor(q, status, evidence) }; },
            evaluate: async (receipt, readback) => { calls.evaluate += 1; return evaluate ? evaluate(receipt, readback) : { suite: receipt.suite, release: receipt.release, errors: [], rows: receipt.rows }; },
            lookup: async (q) => { calls.lookup.push(q); return lookup(q); },
            ...(coaching ? { coaching: async (q) => { calls.coaching.push(q); return coaching(q); } } : {}),
        },
    };
}
const run = (d, deps, over = {}) => entry.runJ8Nightly({ evidenceDir: d.evidenceDir, runDir: d.runDir, runId: RUN_ID, runAttempt: '1',
    configuredDomain: DOMAIN, expectedRelease: RELEASE, deps, now: () => NOW, ...over });
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
    it('UNRESOLVED CREATE (Sam on b1f8323f): with no trusted answer the run is HOLD, even with every row PASS and cleanup at zero', async () => {
        const d = dirs();
        const out = await run(d, fixtures(d.runDir, { answer: null }).deps);
        expect(out.caseResult.assertions.every((a) => a.result === 'PASS')).toBe(true);
        expect(out.cleanup.result).toBe('complete');
        expect(out.createJournal).toBe('unresolved');
        expect(out.exitCode).toBe(78);
        expect(out.blocks.some((b) => /account-create attempt has no terminal result/.test(b))).toBe(true);
        // The exit agrees with the next admission: it is held until the attempt is recovered.
        const next = admitRun(d.evidenceDir);
        expect(next.admitted).toBe(false);
        expect(next.blocking.some((b) => /account-create attempt has no terminal result/.test(b))).toBe(true);
        // Evidence that cannot be read after the run blocks too (never read as resolved).
        const notADir = path.join(d.root, 'not-a-directory');
        fs.writeFileSync(notADir, '');
        expect(entry.ownBlocks(notADir, `j8-${RUN_ID}-1`)).toEqual(['the evidence could not be read after the run']);
        expect(entry.ownBlocks(path.join(d.root, 'missing'), `j8-${RUN_ID}-1`).length).toBe(1);
        // With a trusted, timely answer the same run exits 0 and the next run is admitted.
        const e = dirs();
        const ok = await run(e, fixtures(e.runDir).deps);
        expect({ exit: ok.exitCode, journal: ok.createJournal, next: admitRun(e.evidenceDir).admitted }).toEqual({ exit: 0, journal: 'resolved', next: true });
    });
    it('UNRESOLVED CREATE: a late, unbound or after-abort answer is never recorded, and a created account with incomplete cleanup still holds', async () => {
        for (const over of [{ beforeAbort: false }, { receivedAt: new Date(NOW - 60_000).toISOString() }, { lookupRef: 'rwt-journey-other' },
            { outcome: 'created', accountRef: undefined }, { outcome: 'refused', status: 503 }]) {
            const d = dirs();
            const f = fixtures(d.runDir, { answer: null });
            const inner = f.deps.runSpec;
            let refused = false;
            f.deps.runSpec = async (a) => {
                const adm = JSON.parse(fs.readFileSync(a.env.RWT_J8_RUNNER_ADMISSION, 'utf8'));
                try { trustedAnswer(d.evidenceDir, adm, over); } catch { refused = true; }
                return inner(a);
            };
            const out = await run(d, f.deps);
            expect({ over, refused, exit: out.exitCode, journal: out.createJournal }).toEqual({ over, refused: true, exit: 78, journal: 'unresolved' });
        }
        // A trusted `created` answer, but the account is still there: cleanup incomplete, so the attempt still blocks.
        const e = dirs();
        const left = await run(e, fixtures(e.runDir, { lookup: () => ({ lookup: 'one' }) }).deps);
        expect({ exit: left.exitCode, cleanup: left.cleanup.result, journal: left.createJournal }).toEqual({ exit: 78, cleanup: 'incomplete', journal: 'unresolved' });
        expect(left.blocks.some((b) => /cleanup is not proven complete/.test(b))).toBe(true);
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
    it('BOUND RECEIPT (Sam on b1f8323f): another release, a stale receipt, or a receipt already at the location is never read', async () => {
        // A receipt for a release other than the parent's expected one: HOLD, never mapped or read back, and never trusted for cleanup.
        const d = dirs();
        const f = fixtures(d.runDir, { spec: (adm) => ({ ...receiptFor(adm.createAttempt.attemptId), release: 'c'.repeat(40) }) });
        const other = await run(d, f.deps);
        expect(other.caseResult.assertions.every((a) => a.result === 'HOLD')).toBe(true);
        expect(other.caseResult.assertions[0].sources).toEqual(['the receipt is not for the parent\'s expected release']);
        expect({ qualify: f.calls.qualify.length, cleanup: other.cleanup.result, exit: other.exitCode }).toEqual({ qualify: 0, cleanup: 'incomplete', exit: 78 });
        // A receipt the spec did not write in this run (older than the spec's start): HOLD.
        const e = dirs();
        const g = fixtures(e.runDir);
        const inner = g.deps.runSpec;
        g.deps.runSpec = async (a) => {
            const r = await inner(a);
            const file = path.join(e.runDir, 'test-results', 'rwt', entry.RECEIPT_FILE);
            fs.utimesSync(file, new Date(Date.now() - 3_600_000), new Date(Date.now() - 3_600_000));
            return r;
        };
        const stale = await run(e, g.deps);
        expect(stale.caseResult.assertions[0].sources).toEqual(['the receipt was not written by this spec run']);
        expect(stale.exitCode).toBe(78);
        // A receipt already at the location before admission: refused, nothing recorded or sent.
        const h = dirs();
        fs.writeFileSync(path.join(h.runDir, 'test-results', 'rwt', entry.RECEIPT_FILE), JSON.stringify(receiptFor('x')));
        const hf = fixtures(h.runDir);
        const notFresh = await run(h, hf.deps);
        expect({ exit: notFresh.exitCode, fresh: /receipt location is not fresh/.test(notFresh.reason), spec: hf.calls.runSpec.length }).toEqual({ exit: 78, fresh: true, spec: 0 });
        expect(fs.readdirSync(h.evidenceDir)).toEqual([]);
        // No expected release: refused before admission.
        const k = dirs();
        const none = await run(k, fixtures(k.runDir).deps, { expectedRelease: undefined });
        expect({ exit: none.exitCode, files: fs.readdirSync(k.evidenceDir) }).toEqual({ exit: 78, files: [] });
        expect(entry.readBoundReceipt('/nope', { attemptId: 'a', expectedRelease: 'A'.repeat(40), notBeforeMs: 0 }).fault).toBe('the parent named no expected release');
    });
    it('SPEC OUTCOME (Sam on b1f8323f): only a terminal exit bound to this admission, run and attempt lets the receipt be read', async () => {
        const bad = {
            'no exit code': (env) => ({ exitCode: null, admissionFile: env.RWT_J8_RUNNER_ADMISSION, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT }),
            'exit 2': (env) => ({ exitCode: 2, admissionFile: env.RWT_J8_RUNNER_ADMISSION, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT }),
            'killed at its deadline': (env) => ({ exitCode: 0, timedOut: true, admissionFile: env.RWT_J8_RUNNER_ADMISSION, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT }),
            'another admission': (env) => ({ exitCode: 0, admissionFile: `${env.RWT_J8_RUNNER_ADMISSION}.old`, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT }),
            'another run attempt': (env) => ({ exitCode: 0, admissionFile: env.RWT_J8_RUNNER_ADMISSION, runId: env.GITHUB_RUN_ID, runAttempt: '2' }),
            'another run': (env) => ({ exitCode: 0, admissionFile: env.RWT_J8_RUNNER_ADMISSION, runId: '1', runAttempt: env.GITHUB_RUN_ATTEMPT }),
            'a bare number': () => 0,
        };
        for (const [name, outcome] of Object.entries(bad)) {
            const d = dirs();
            const f = fixtures(d.runDir, { outcome });
            const out = await run(d, f.deps);
            expect({ name, hold: out.caseResult.assertions.every((a) => a.result === 'HOLD'), qualify: f.calls.qualify.length, cleanup: out.cleanup.result, exit: out.exitCode })
                .toEqual({ name, hold: true, qualify: 0, cleanup: 'incomplete', exit: 78 });
        }
        // Exit 1 over an all-PASS receipt contradicts itself: HOLD.
        const exit1 = (env) => ({ exitCode: 1, admissionFile: env.RWT_J8_RUNNER_ADMISSION, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT });
        const d = dirs();
        const contradiction = await run(d, fixtures(d.runDir, { outcome: exit1 }).deps);
        expect(contradiction.caseResult.assertions[0].sources).toEqual(['the spec failed but its receipt shows no failing row']);
        expect(contradiction.exitCode).toBe(78);
        // Exit 1 with the failing row in the receipt: read and mapped as usual, and the run FAILs.
        const e = dirs();
        const failed = await run(e, fixtures(e.runDir, { outcome: exit1, spec: (adm) => ({ ...receiptFor(adm.createAttempt.attemptId),
            rows: receiptFor(adm.createAttempt.attemptId).rows.map((x) => (x.step === 'J8.a: fresh acknowledgment' ? { ...x, verdict: 'FAIL' } : x)) }) }).deps);
        expect(resultOf(failed, 'J8.a', 'AHT-08:fresh-acknowledgment')).toBe('FAIL');
        expect(failed.exitCode).toBe(1);
    });
    it('BOUND READBACK (Sam on b1f8323f): a verdict counts only with the CLI\'s own evidence of exactly what was asked; the result carries this run', async () => {
        const d = dirs();
        const ok = await run(d, fixtures(d.runDir).deps);
        expect(ok.readback.binding).toEqual({ runId: RUN_ID, runAttempt: '1', createAttempt: `j8-${RUN_ID}-1` });
        expect(ok.readback.finalSubmit).toEqual({ journeyId: 'journey-final-b' });
        expect(ok.readback.journeys.find((j) => j.journeyId === 'journey-final-b').received)
            .toEqual({ release_sha: RELEASE, journey_id: 'journey-final-b', boot_id: 'boot-journey-final-b' });
        const mismatches = { 'another release': { release_sha: 'c'.repeat(40) }, 'another journey': { journey_id: 'journey-z' },
            'other traffic': { traffic_type: 'user' }, 'other stages': { stages_declared: ['session_after_open_mic'] },
            'other attempts': { attempts_declared: ['att-9'] }, 'a verdict against its exit code': { verdict: 'FAIL' } };
        for (const [name, over] of Object.entries(mismatches)) {
            const e = dirs();
            const out = await run(e, fixtures(e.runDir, { evidence: over }).deps);
            expect({ name, verdicts: out.readback.journeys.map((j) => j.verdict), exit: out.exitCode }).toEqual({ name, verdicts: ['HOLD', 'HOLD', 'HOLD'], exit: 78 });
        }
        // An exit code with no evidence line at all is HOLD.
        const n = dirs();
        const f = fixtures(n.runDir);
        f.deps.qualify = async () => ({ status: 0, evidence: null });
        const bare = await run(n, f.deps);
        expect(bare.readback.journeys.every((j) => j.verdict === 'HOLD')).toBe(true);
        // A non-final exit is HOLD even beside a matching QUALIFIED evidence line.
        const q1 = dirs();
        const g = fixtures(q1.runDir);
        g.deps.qualify = async (q) => ({ status: 1, evidence: evidenceFor(q, 0) });
        const nonFinal = await run(q1, g.deps);
        expect(nonFinal.readback.journeys.every((j) => j.verdict === 'HOLD')).toBe(true);
        // The final submit is named only when the receipt's final-submit row PASSes for J8.b's one journey.
        const m = dirs();
        const noFinal = await run(m, fixtures(m.runDir, { spec: (adm) => ({ ...receiptFor(adm.createAttempt.attemptId),
            rows: receiptFor(adm.createAttempt.attemptId).rows.map((x) => (x.step === 'J8.b: final feedback pair sent' ? { ...x, verdict: 'HOLD' } : x)) }) }).deps);
        expect(noFinal.readback.finalSubmit).toBe(null);
    });
    it('DUPLICATE JOURNEY (Sam on b1f8323f): a journey bound to two legs is never read back, and holds the received rows', async () => {
        const d = dirs();
        const spec = (adm) => {
            const r = receiptFor(adm.createAttempt.attemptId);
            r.rows = r.rows.map((x) => (x.step === 'J8 leg readback bindings' ? { ...x, evidence: { ...JOURNEY_OF, 'J8.c': 'journey-a' } } : x));
            r.readback.journeys = r.readback.journeys.filter((j) => j.journeyId !== 'journey-c');
            return r;
        };
        const f = fixtures(d.runDir, { spec });
        const out = await run(d, f.deps);
        expect(f.calls.qualify.length).toBe(0);
        expect(out.readback.missingBindings).toContain('J8:duplicate_leg_journey');
        expect(resultOf(out, 'J8.a', 'AHT-08:received-feedback-proof')).toBe('HOLD');
        expect(out.exitCode).toBe(78);
    });
    it('DEADLINES (Sam on b1f8323f): a spec, readback, coaching, evaluation or lookup that never answers is cut off, and cleanup still runs on its own budget', async () => {
        const never = () => new Promise(() => {});
        const short = { specMs: 40, readbackMs: 40, coachingMs: 40, evaluateMs: 40, cleanupMs: 60 };
        // The spec hangs: HOLD, and teardown still writes its evidence (incomplete: no receipt to show zero residue).
        const d = dirs();
        const hang = fixtures(d.runDir);
        hang.deps.runSpec = never;
        const spec = await run(d, hang.deps, { deadlines: short });
        expect(spec.caseResult.assertions[0].sources).toEqual(['the spec did not finish within its deadline']);
        expect(spec.cleanup.result).toBe('incomplete');
        // The readback hangs: each journey HOLD.
        const e = dirs();
        const rb = fixtures(e.runDir);
        rb.deps.qualify = never;
        const readback = await run(e, rb.deps, { deadlines: short });
        expect(readback.readback.journeys.map((j) => j.verdict)).toEqual(['HOLD', 'HOLD', 'HOLD']);
        // The evaluation hangs: every row HOLD.
        const g = dirs();
        const ev = fixtures(g.runDir);
        ev.deps.evaluate = never;
        const evaluated = await run(g, ev.deps, { deadlines: short });
        expect(evaluated.caseResult.assertions.every((a) => a.result === 'HOLD')).toBe(true);
        // The lookup hangs: cut off at the cleanup budget, so cleanup is incomplete and says why.
        const h = dirs();
        const lk = fixtures(h.runDir);
        lk.deps.lookup = never;
        const lookup = await run(h, lk.deps, { deadlines: short });
        expect(lookup.cleanup.result).toBe('incomplete');
        expect(Object.values(lookup.cleanup.reasons).flat().join(' ')).toContain('did not finish within the cleanup budget');
        expect(lookup.exitCode).toBe(78);
        // A lookup that answers zero only after the budget is spent never makes cleanup complete.
        const k = dirs();
        let clock = NOW;
        const late = fixtures(k.runDir, { lookup: () => { clock += 10 * 60_000; return { lookup: 'zero' }; } });
        const lateOut = await run(k, late.deps, { now: () => clock });
        expect(lateOut.cleanup.result).toBe('incomplete');
        expect(Object.values(lateOut.cleanup.reasons).flat()).toContain('the parent lookup did not show the reserved account gone within the cleanup budget');
        expect(lateOut.exitCode).toBe(78);
    });
    it('LIVE GATE UNCHANGED: main refuses before admission without offline fixtures, and records nothing', async () => {
        const d = dirs();
        const argv = ['--evidence-dir', d.evidenceDir, '--run-dir', d.runDir, '--run-id', RUN_ID, '--run-attempt', '1', '--release-sha', RELEASE, '--execute', 'true'];
        const out = await entry.main(argv, { LIVE_TEST_EMAIL_DOMAIN: DOMAIN }, {});
        expect(out.exitCode).toBe(78);
        expect(/live gate is closed/.test(out.reason)).toBe(true);
        expect(fs.readdirSync(d.evidenceDir)).toEqual([]);
        expect((await entry.main(argv.slice(0, -2), { LIVE_TEST_EMAIL_DOMAIN: DOMAIN }, {})).exitCode).toBe(78);
        // The parent's expected release is required, and must be a release.
        const noRelease = argv.filter((_, i) => i !== argv.indexOf('--release-sha') && i !== argv.indexOf('--release-sha') + 1);
        expect((await entry.main(noRelease, { LIVE_TEST_EMAIL_DOMAIN: DOMAIN }, fixtures(d.runDir).deps)).exitCode).toBe(78);
        const badRelease = argv.map((v) => (v === RELEASE ? 'not-a-sha' : v));
        expect(/expected release/.test((await entry.main(badRelease, { LIVE_TEST_EMAIL_DOMAIN: DOMAIN }, fixtures(d.runDir).deps)).reason)).toBe(true);
        expect(fs.readdirSync(d.evidenceDir)).toEqual([]);
        expect((await entry.main(argv, {}, fixtures(d.runDir).deps)).exitCode).toBe(78);
        expect((await entry.main([...argv, '--plan', 'x'], { LIVE_TEST_EMAIL_DOMAIN: DOMAIN }, fixtures(d.runDir).deps)).exitCode).toBe(78);
        // With fixtures it runs the same composition.
        expect((await entry.main(argv, { LIVE_TEST_EMAIL_DOMAIN: DOMAIN }, fixtures(d.runDir).deps)).exitCode).toBe(0);
    });
});

describe('J8 nightly entry with the live adapters composed over a recording process runner', () => {
    const { j8LiveAdapters } = require('../j8-live-adapters.cjs');
    /** One runner for the spec and the readback: the spec writes `spec(admission)`; each readback answers `readbackCode(args)`. */
    function composed(d, { spec = (adm) => receiptFor(adm.createAttempt.attemptId), readbackCode = () => 0, users = [], answer = true } = {}) {
        const calls = [];
        const runner = (command, args, opts) => {
            calls.push({ command, args });
            if (args.includes('playwright')) {
                const admission = JSON.parse(fs.readFileSync(opts.env.RWT_J8_RUNNER_ADMISSION, 'utf8'));
                const receipt = spec(admission);
                if (answer) trustedAnswer(d.evidenceDir, admission);
                if (receipt) fs.writeFileSync(path.join(d.runDir, 'test-results', 'rwt', entry.RECEIPT_FILE), JSON.stringify(receipt));
                return { status: 0, stdout: '' };
            }
            // The readback CLI prints its own evidence of what it checked, from the arguments and env it was given.
            const status = readbackCode(args);
            const q = { release: args[args.indexOf('--release-sha') + 1], journeyId: args[args.indexOf('--journey-id') + 1],
                stages: String(opts.env.QUALIFICATION_STAGES).split(',').filter(Boolean), attemptIds: String(opts.env.QUALIFICATION_ATTEMPT_IDS).split(',').filter(Boolean) };
            const ev = evidenceFor(q, status);
            return { status, stdout: ev ? `noise\nTELEMETRY_READBACK_QUALIFICATION_EVIDENCE ${JSON.stringify({ gate: 'TELEMETRY-READBACK-COMPLETENESS', ...ev })}\n` : '' };
        };
        const deps = { ...j8LiveAdapters({ repoRoot: d.root, baseEnv: {}, run: runner, sleep: async () => {},
            listUsers: async () => ({ data: { users }, error: null }) }),
        evaluate: async (receipt) => ({ suite: receipt.suite, release: receipt.release, errors: [], rows: receipt.rows }) };
        return { deps, calls };
    }
    it('the live adapters plug into the entry unchanged: spec once, one readback per bound journey, zero residue, all PASS', async () => {
        const d = dirs();
        const c = composed(d);
        const out = await run(d, c.deps);
        expect(out.exitCode).toBe(0);
        expect(out.cleanup.result).toBe('complete');
        expect(c.calls.filter((x) => x.args.includes('playwright')).length).toBe(1);
        const journeys = c.calls.filter((x) => x.args.includes('telemetry:readback-qualification')).map((x) => x.args[x.args.indexOf('--journey-id') + 1]);
        expect(journeys).toEqual(LEGS.map((l) => JOURNEY_OF[l]));
    });
    it('an observed readback failure for J8.b\'s journey FAILs its received row; a residue account keeps cleanup incomplete', async () => {
        const d = dirs();
        const failB = composed(d, { readbackCode: (args) => (args.includes(JOURNEY_OF['J8.b']) ? 3 : 0) });
        const out = await run(d, failB.deps);
        expect(out.exitCode).toBe(1);
        expect(resultOf(out, 'J8.b', 'AHT-07:received-feedback-proof')).toBe('FAIL');
        const e = dirs();
        const email = `rwt-journey-feedback-boundary-${NOW}-${RUN_ID}@${DOMAIN}`;
        const residue = await run(e, composed(e, { users: [{ id: 'u-left', email }] }).deps);
        expect(residue.cleanup.result === 'complete').toBe(false);
        expect(residue.exitCode).toBe(78);
    });
});
