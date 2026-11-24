"use strict";
// J8's dedicated nightly entry (Sam, 21 Nov, option 1): the runner that owns the account lifecycle records the create attempt
// before the signup, binds the receipt and cleanup to the same run and attempt, and maps J8's received rows only from the
// independent readback. Offline only: the spec, readback, evaluation and the parent recovery's account store are fixtures; nothing
// here is live. Sam on 27ee1856, route (b): the run's create attempt is cleared by the PARENT's landed-and-cleaned recovery.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const { expect } = require('./expect-lite.cjs');
const { J8_RECEIPT_MAP, J8_SUITE } = require('../j8-receipt-mapping.cjs');
const { admitRun, answerCreateAttempt, recordCreateAttempt } = require('../cleanup-evidence.cjs');
const { enumerateUsers, exactEmailLookup } = require('../account-lookup.cjs');
const { j4aRequiredStores } = require('../residue-inventory.cjs');
const entry = require('../j8-nightly-entry.cjs');
const { j8ParentRecovery } = require('../j8-parent-recovery.cjs');

const LEGS = ['J8.a', 'J8.b', 'J8.c'];
const RELEASE = 'd'.repeat(40);
const DOMAIN = 'tests.example.com';
const RUN_ID = '43000000123';
const NOW = 1795300000000;
const JOURNEY_OF = { 'J8.a': 'journey-a', 'J8.b': 'journey-final-b', 'J8.c': 'journey-c' };
/** The spec's admission check (rwtJ8Journey.ts LOOKUP_REF), so the entry's record is one the spec accepts. */
const SPEC_LOOKUP_REF = /^rwt-journey-[a-z0-9-]{4,80}@[a-z0-9.-]+\.[a-z]{2,}$/;
/** This run's binding (runBinding.ts): what the spec's signup writes to app_metadata.ct_run and the parent checks. */
const RUN_BINDING = { repository: 'relativityE/speaksharp', workflow: 'relativityE/speaksharp/.github/workflows/nightly-aht.yml@refs/heads/main' };
const ctRunFor = (runId, runAttempt) => ({ ...RUN_BINDING, runId: String(runId), runAttempt: String(runAttempt), role: 'rwt-journey' });
const STORES = j4aRequiredStores();
const DEADLINES_CLEANUP = entry.DEADLINES.cleanupMs;
const LISTED_J8 = 'Listing tests:\n  [deployed-live-chromium] › live/rwt-feedback-association-boundaries.live.spec.ts:753:5 › RWT — Share Feedback association boundaries @live › J8: one account — No session before any take, older-take feedback, No session with both takes listed\nTotal: 1 test in 1 file\n';
const emailOf = (runId) => `rwt-journey-feedback-boundary-${NOW}-${runId}@${DOMAIN}`;

/**
 * The project's accounts as the parent's admin client sees them: the spec's signup adds one, the scoped delete removes it, and every
 * store reads zero unless `residue` names it. `listing` breaks the admin listing ('error', 'truncated', 'total') so only a complete
 * enumeration can answer. Each call is recorded.
 */
function accountStore({ residue = {}, listing = 'complete', deleteOk = true } = {}) {
    const users = new Map();
    const calls = { lookup: [], readAccount: 0, scopedDelete: [], readResidue: [] };
    const listUsers = async ({ page, perPage }) => {
        if (listing === 'error') return { data: null, error: { message: 'boom' } };
        const all = [...users.values()];
        if (listing === 'truncated') return { data: { users: Array.from({ length: perPage }, (_, i) => all[i] ?? { id: `filler-${page}-${i}`, email: `x${page}-${i}@y.z` }) }, error: null };
        const batch = all.slice((page - 1) * perPage, page * perPage);
        return { data: { users: batch, ...(listing === 'total' ? { total: all.length + 1 } : {}) }, error: null };
    };
    return {
        users, calls,
        signUp(email, { runId = RUN_ID, runAttempt = '1', ctRun = ctRunFor(runId, runAttempt), createdAt = new Date(Date.now()).toISOString(), id = `uid-${users.size + 1}-${runId}` } = {}) {
            users.set(id, { id, email, created_at: createdAt, app_metadata: ctRun === null ? {} : { ct_run: ctRun } });
            return id;
        },
        deps: {
            lookup: async (q) => { calls.lookup.push(q); return exactEmailLookup(await enumerateUsers(listUsers), q); },
            readAccount: async (uid) => {
                calls.readAccount += 1;
                const u = users.get(uid);
                return u ? { email: u.email, createdAt: u.created_at, ctRun: u.app_metadata.ct_run ?? null } : null;
            },
            scopedDelete: async ({ uid, email, binding }) => {
                calls.scopedDelete.push({ email, binding });
                if (!deleteOk) return { deleted: false, drained: true };
                users.delete(uid);
                return { deleted: true, drained: true };
            },
            readResidue: async ({ store, uid }) => {
                calls.readResidue.push(store);
                if (store in residue) return typeof residue[store] === 'function' ? residue[store]() : residue[store];
                return store === 'auth:account' ? (users.has(uid) ? 1 : 0) : 0;
            },
        },
    };
}

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
    // `feedback retention` HOLD, as the J8 spec writes it: deferred, so a full run still exits 0 (Codex on 4a5d718a). The telemetry
    // rows as telemetryClassRows writes them: `signup-stage telemetry received` is always HOLD, report-only and non-gating, so a full
    // run still exits 0 (Codex on 2e2e3bd2); the readback settles `journey telemetry received` (the fakes here pass rows through).
    const holds = new Set(['feedback retention', 'signup-stage telemetry received']);
    const steps = new Set(['receipt content-free', 'zero residue', 'telemetry decodable', 'signup-stage telemetry (user class)',
        'signup-stage telemetry received', 'journey telemetry (canary class)', 'journey telemetry received', 'feedback retention']);
    for (const leg of LEGS) for (const sources of Object.values(J8_RECEIPT_MAP[leg]))
        for (const s of sources) if (s.scope !== 'readback') steps.add(s.scope === 'leg' ? `${leg}: ${s.step}` : s.step);
    const rows = [...steps].map((step) => (step === 'J8 leg readback bindings'
        ? { step, verdict: 'PASS', detail: '', evidence: { ...JOURNEY_OF } } : { step, verdict: holds.has(step) ? 'HOLD' : 'PASS', detail: '' }));
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
 * the spec's terminal outcome; `signup` whether the spec's signup lands an account (owner: its overrides); `answer` 'trusted'
 * records a trusted create answer (none by default: a UI signup has none); `recovery` false leaves out the parent recovery.
 */
function fixtures(runDir, { spec = (adm) => receiptFor(adm.createAttempt.attemptId), qualify = () => 0, evidence = {}, evaluate, lookup, coaching,
    outcome = (env) => ({ exitCode: 0, admissionFile: env.RWT_J8_RUNNER_ADMISSION, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT, timedOut: false, drained: true }),
    answer = null, signup = true, owner = {}, recovery = true, store = accountStore() } = {}) {
    const calls = { runSpec: [], qualify: [], evaluate: 0, coaching: [], store: store.calls };
    calls.lookup = store.calls.lookup;
    return {
        calls, store,
        deps: {
            artifactRoot: runDir,
            runSpec: async ({ env }) => {
                const admission = JSON.parse(fs.readFileSync(env.RWT_J8_RUNNER_ADMISSION, 'utf8'));
                const evidenceDir = path.dirname(env.RWT_J8_RUNNER_ADMISSION);
                calls.runSpec.push({ env, admission, sentBefore: fs.readdirSync(evidenceDir).filter((n) => n.includes('.attempt.') && n.endsWith('.sent.json')) });
                if (signup) store.signUp(admission.createAttempt.lookupRef, { runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT, ...owner });
                if (answer === 'trusted') trustedAnswer(evidenceDir, admission);
                const receipt = spec(admission);
                if (receipt) fs.writeFileSync(path.join(runDir, 'test-results', 'rwt', entry.RECEIPT_FILE), JSON.stringify(receipt));
                return outcome(env);
            },
            qualify: async (q) => { calls.qualify.push(q); const status = qualify(q); return { status, evidence: evidenceFor(q, status, evidence) }; },
            evaluate: async (receipt, readback) => { calls.evaluate += 1; return evaluate ? evaluate(receipt, readback) : { suite: receipt.suite, release: receipt.release, errors: [], rows: receipt.rows }; },
            ...(recovery ? { ...store.deps, ...(lookup ? { lookup: async (q) => { store.calls.lookup.push(q); return lookup(q); } } : {}) } : {}),
            ...(coaching ? { coaching: async (q) => { calls.coaching.push(q); return coaching(q); } } : {}),
        },
    };
}
/** The runner step's end, a whole step from the run's own clock at its start unless a test names one. */
const stepEndFrom = (over) => (over.now ?? (() => NOW))() + entry.J8_STEP_MS - entry.STEP_MARGIN_MS;
const run = (d, deps, over = {}) => entry.runJ8Nightly({ evidenceDir: d.evidenceDir, runDir: d.runDir, runId: RUN_ID, runAttempt: '1',
    configuredDomain: DOMAIN, expectedRelease: RELEASE, runBinding: RUN_BINDING, deps, now: () => NOW, stepEndAt: stepEndFrom(over), ...over });
const files = (dir, part) => fs.readdirSync(dir).filter((n) => n.includes(part));
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
    it('UNRESOLVED CREATE (Sam on b1f8323f): with no answer and no parent recovery the run is HOLD, even with every row PASS', async () => {
        const d = dirs();
        const out = await run(d, fixtures(d.runDir, { recovery: false }).deps);
        expect(out.caseResult.assertions.every((a) => a.result === 'PASS')).toBe(true);
        expect(out.cleanup.result).toBe('incomplete');
        expect(Object.values(out.cleanup.reasons).flat()).toContain('no parent recovery, so the account is left for protected recovery');
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
        // With the parent's landed-and-cleaned recovery the same run exits 0 and the next run is admitted.
        const e = dirs();
        const ok = await run(e, fixtures(e.runDir).deps);
        expect({ exit: ok.exitCode, journal: ok.createJournal, next: admitRun(e.evidenceDir).admitted }).toEqual({ exit: 0, journal: 'resolved', next: true });
        expect(files(e.evidenceDir, '.attempt.').map((n) => n.split('.').slice(-2, -1)[0]).sort()).toEqual(['landed', 'recovered', 'sent']);
    });
    it('UNRESOLVED CREATE: a late, unbound or after-abort answer is never recorded, and a created account with incomplete cleanup still holds', async () => {
        for (const over of [{ beforeAbort: false }, { receivedAt: new Date(NOW - 60_000).toISOString() }, { lookupRef: 'rwt-journey-other' },
            { outcome: 'created', accountRef: undefined }, { outcome: 'refused', status: 503 }]) {
            const d = dirs();
            const f = fixtures(d.runDir, { recovery: false });
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
        // A trusted `created` answer, but the account is still there (no parent recovery): cleanup incomplete, so the attempt still blocks.
        const e = dirs();
        const left = await run(e, fixtures(e.runDir, { answer: 'trusted', recovery: false }).deps);
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
    it('CLEANUP is the parent\'s (route (b)): found, bound, deleted on the scoped path, every store read at zero, then cleared', async () => {
        const d = dirs();
        const f = fixtures(d.runDir);
        const out = await run(d, f.deps);
        const email = emailOf(RUN_ID);
        // Found by a complete listing, then a second complete listing after the delete; the delete is bound to the run it checked.
        expect(f.calls.lookup).toEqual([{ email, runOwnedPrefix: 'rwt-journey-' }, { email, runOwnedPrefix: 'rwt-journey-' }]);
        expect(f.calls.store.scopedDelete).toEqual([{ email, binding: ctRunFor(RUN_ID, '1') }]);
        expect(f.calls.store.readResidue).toEqual(STORES.map((x) => x.id));
        expect(f.store.users.size).toBe(0);
        const doc = JSON.parse(fs.readFileSync(path.join(d.evidenceDir, `j8-${RUN_ID}-1.cleanup.json`), 'utf8'));
        expect(doc.cleanup).toBe('complete');
        expect(doc.journeys[0].verification.queries.length).toBe(STORES.length);
        expect(doc.journeys[0].verification.queries.every((q) => q.scope === `rwt-journey-feedback-boundary-${NOW}-${RUN_ID}` && q.count === 0)).toBe(true);
        expect({ exit: out.exitCode, journal: out.createJournal }).toEqual({ exit: 0, journal: 'resolved' });
        // The recorded proof is re-validated by admission: a tampered proof blocks again.
        const recovered = path.join(d.evidenceDir, `j8-${RUN_ID}-1.attempt.j8-${RUN_ID}-1.recovered.json`);
        const rec = JSON.parse(fs.readFileSync(recovered, 'utf8'));
        expect(rec.proof.residue.residueChecks).toBe(23);
        fs.writeFileSync(recovered, JSON.stringify({ ...rec, proof: { ...rec.proof, residue: { ...rec.proof.residue, residueChecks: 22 } } }));
        expect(admitRun(d.evidenceDir).admitted).toBe(false);
        const cases = {
            'the spec recorded no zero residue': { spec: (adm) => ({ ...receiptFor(adm.createAttempt.attemptId),
                rows: receiptFor(adm.createAttempt.attemptId).rows.map((x) => (x.step === 'zero residue' ? { ...x, verdict: 'FAIL' } : x)) }) },
            'the spec wrote no receipt': { spec: () => null },
        };
        for (const [name, over] of Object.entries(cases)) {
            const e = dirs();
            const fx = fixtures(e.runDir, over);
            const o = await run(e, fx.deps);
            expect({ name, cleanup: o.cleanup.result, exit: o.exitCode === 0 }).toEqual({ name, cleanup: 'incomplete', exit: false });
            // The spec's own zero is not a gate on the parent recovery (Elon on 4a5d718a, P3): a spec that exited still has its
            // account found, deleted on the scoped path and read at zero by the parent; only cleanup stays incomplete, named.
            expect({ name, deletes: fx.store.calls.scopedDelete.length, why: JSON.stringify(o.cleanup.reasons).includes('the spec did not record its own zero residue') })
                .toEqual({ name, deletes: 1, why: true });
        }
    });
    it('OWN BLOCKS: cleanup complete is not enough; any other unresolved create recorded under this run keeps the exit at HOLD', async () => {
        const d = dirs();
        const f = fixtures(d.runDir);
        const runSpec = f.deps.runSpec;
        f.deps.runSpec = async (q) => {
            const out = await runSpec(q);
            recordCreateAttempt(d.evidenceDir, `j8-${RUN_ID}-1`, { attemptId: `j8-${RUN_ID}-1-other`, leg: 'J9.b', lookupRef: 'rwt-journey-other', transportDeadlineMs: 60_000, emailDomain: DOMAIN });
            return out;
        };
        const out = await run(d, f.deps);
        expect({ cleanup: out.cleanup.result, journal: out.createJournal, exit: out.exitCode }).toEqual({ cleanup: 'complete', journal: 'unresolved', exit: 78 });
    });
    it('SUCCESS THEN SUCCESS (Sam on 27ee1856): two runs in the same evidence directory each recover their own account and admit the next', async () => {
        const d = dirs();
        const store = accountStore();
        const first = await run(d, fixtures(d.runDir, { store }).deps, { runId: '43000000201' });
        expect({ exit: first.exitCode, journal: first.createJournal, cleanup: first.cleanup.result }).toEqual({ exit: 0, journal: 'resolved', cleanup: 'complete' });
        expect(admitRun(d.evidenceDir).admitted).toBe(true);
        // A second run, a fresh receipt location, the same evidence directory and the same project.
        const runDir2 = path.join(d.root, 'run2');
        fs.mkdirSync(path.join(runDir2, 'test-results', 'rwt'), { recursive: true });
        // A rerun attempt of another run: the delete is bound to attempt 2, and attempt 2's account is the one found and deleted.
        const second = await run({ ...d, runDir: runDir2 }, fixtures(runDir2, { store }).deps, { runId: '43000000202', runAttempt: '2', now: () => NOW + 60_000 });
        expect({ exit: second.exitCode, journal: second.createJournal, cleanup: second.cleanup.result }).toEqual({ exit: 0, journal: 'resolved', cleanup: 'complete' });
        expect(admitRun(d.evidenceDir)).toEqual({ admitted: true, reason: 'every earlier run cleaned up or was recovered', blocking: [] });
        expect(store.calls.scopedDelete.map((x) => x.email)).toEqual([emailOf('43000000201'), `rwt-journey-feedback-boundary-${NOW + 60_000}-43000000202@${DOMAIN}`]);
        expect(store.calls.scopedDelete.map((x) => x.binding)).toEqual([ctRunFor('43000000201', '1'), ctRunFor('43000000202', '2')]);
        expect(store.users.size).toBe(0);
        for (const id of ['43000000201-1', '43000000202-2'])
            expect(files(d.evidenceDir, `j8-${id}.attempt.`).map((n) => n.split('.').slice(-2, -1)[0]).sort()).toEqual(['landed', 'recovered', 'sent']);
    });
    it('WRONG OWNER (Sam on 27ee1856): an account not bound to this run and attempt is never recorded or deleted, and the next admission stays blocked', async () => {
        const email = emailOf(RUN_ID);
        const cases = {
            'bound to another run': { owner: { ctRun: ctRunFor('43000000999', '1') } },
            'bound to another attempt of this run': { owner: { ctRun: ctRunFor(RUN_ID, '2') } },
            'bound to another workflow': { owner: { ctRun: { ...ctRunFor(RUN_ID, '1'), workflow: 'relativityE/speaksharp/.github/workflows/rc-gates.yml@refs/heads/main' } } },
            'a binding with an extra key': { owner: { ctRun: { ...ctRunFor(RUN_ID, '1'), extra: 'x' } } },
            'no binding at all': { owner: { ctRun: null } },
            'created before this attempt was recorded': { owner: { createdAt: new Date(NOW - 60_000).toISOString() } },
            'the id re-read carries another email': { store: (() => { const st = accountStore(); const read = st.deps.readAccount;
                st.deps.readAccount = async (uid) => ({ ...(await read(uid)), email: emailOf('1') }); return st; })() },
            'the only match is not run-owned': { lookup: () => ({ lookup: 'not_run_owned' }) },
            'an ambiguous listing that still names an id': { lookup: () => ({ lookup: 'ambiguous', uid: `uid-1-${RUN_ID}` }) },
            'two accounts carry the email': { store: (() => { const st = accountStore(); st.signUp(email, { id: 'uid-twin' }); return st; })() },
        };
        for (const [name, over] of Object.entries(cases)) {
            const d = dirs();
            const f = fixtures(d.runDir, over);
            const out = await run(d, f.deps);
            expect({ name, exit: out.exitCode, journal: out.createJournal, deleted: f.calls.store.scopedDelete.length, left: f.store.users.size > 0,
                landed: files(d.evidenceDir, '.landed.').length, next: admitRun(d.evidenceDir).admitted })
                .toEqual({ name, exit: 78, journal: 'unresolved', deleted: 0, left: true, landed: 0, next: false });
            expect(out.blocks.some((b) => /has no terminal result/.test(b))).toBe(true);
        }
    });
    it('INCOMPLETE LOOKUP (Sam on 27ee1856): a listing that errors, is truncated or disagrees with its total finds nothing, deletes nothing, and blocks', async () => {
        for (const listing of ['error', 'truncated', 'total']) {
            const d = dirs();
            const f = fixtures(d.runDir, { store: accountStore({ listing }) });
            const out = await run(d, f.deps);
            expect({ listing, exit: out.exitCode, deleted: f.calls.store.scopedDelete.length, landed: files(d.evidenceDir, '.landed.').length, next: admitRun(d.evidenceDir).admitted })
                .toEqual({ listing, exit: 78, deleted: 0, landed: 0, next: false });
            expect(Object.values(out.cleanup.reasons).flat().join(' ')).toContain('the reservation lookup is unreadable');
        }
        // No account under the reservation (the signup never landed): absence proves nothing, so the attempt stays unresolved.
        const d = dirs();
        const none = await run(d, fixtures(d.runDir, { signup: false }).deps);
        expect({ exit: none.exitCode, journal: none.createJournal, next: admitRun(d.evidenceDir).admitted }).toEqual({ exit: 78, journal: 'unresolved', next: false });
        expect(Object.values(none.cleanup.reasons).flat().join(' ')).toContain('the reservation lookup is zero');
    });
    it('LANDED, NOT CLEANED: a failed delete, any residue, an unobserved store or the email still listed keeps the found account blocking', async () => {
        // The account gone but the delete unproven: the parent never counts a delete the scoped path did not prove.
        const unproven = (answer) => { const st = accountStore(); const del = st.deps.scopedDelete;
            st.deps.scopedDelete = async (q) => { await del(q); return answer; }; return st; };
        const cases = {
            'the scoped delete failed': [{ store: accountStore({ deleteOk: false }) }, 'did not prove the account deleted'],
            'the delete removed the account but reported failure': [{ store: unproven({ deleted: false, drained: true }) }, 'did not prove the account deleted'],
            'the delete removed the account but returned nothing': [{ store: unproven(undefined) }, 'processes could not be confirmed stopped'],
            'a store still holds residue': [{ store: accountStore({ residue: { 'sessions:user_id': 1 } }) }, '1 store(s) still hold residue'],
            'a store read is not a count': [{ store: accountStore({ residue: { 'trial_entitlements:email': null } }) }, '1 residue read(s) were not observed'],
            'the save journal read threw': [{ store: accountStore({ residue: { 'account_save_obligations:user_id': () => { throw new Error('x'); } } }) }, '1 residue read(s) were not observed'],
            'the email is still listed after the delete': [{ store: (() => { const st = accountStore(); const del = st.deps.scopedDelete;
                st.deps.scopedDelete = async (q) => { await del(q); st.signUp(emailOf(RUN_ID), { id: 'uid-again' }); return { deleted: true, drained: true }; };
                st.deps.readResidue = async () => 0; return st; })() }, 'did not show the reserved email gone'],
        };
        for (const [name, [over, reason]] of Object.entries(cases)) {
            const d = dirs();
            const out = await run(d, fixtures(d.runDir, over).deps);
            expect({ name, reason: Object.values(out.cleanup.reasons).flat().some((r) => r.includes(reason)) }).toEqual({ name, reason: true });
            const doc = JSON.parse(fs.readFileSync(path.join(d.evidenceDir, `j8-${RUN_ID}-1.cleanup.json`), 'utf8'));
            expect({ name, left: doc.journeys[0].left.map((x) => x.kind) }).toEqual({ name, left: ['account'] });
            expect({ name, exit: out.exitCode, cleanup: out.cleanup.result, landed: files(d.evidenceDir, '.landed.').length, recovered: files(d.evidenceDir, '.recovered.').length })
                .toEqual({ name, exit: 78, cleanup: 'incomplete', landed: 1, recovered: 0 });
            expect(admitRun(d.evidenceDir).blocking.some((b) => /found under its reservation; scoped cleanup is permitted/.test(b))).toBe(true);
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
        const st = accountStore();
        const doc = await entry.teardownJ8({ evidenceDir: e.evidenceDir, admission: { ...adm, local: `${adm.local}x` }, receipt: receiptFor(adm.attemptId),
            deps: st.deps, binding: ctRunFor(RUN_ID, '1'), specExited: true });
        expect(doc.cleanup).toBe('incomplete');
        expect(doc.journeys[0].unproven).toEqual(['the run\'s create record is not this attempt\'s reservation']);
        expect(st.calls.lookup).toEqual([]);
        // The recovery checks the binding itself, not only through teardown: another reservation, attempt or domain looks nothing up.
        for (const bad of [{ local: `${adm.local}x` }, { attemptId: `${adm.attemptId}x` }, { domain: 'other.example.com' }]) {
            const rec = await j8ParentRecovery({ evidenceDir: e.evidenceDir, admission: { ...adm, ...bad }, binding: ctRunFor(RUN_ID, '1'), deps: st.deps, budgetMs: 60_000 });
            expect({ bad, state: rec.state, reason: rec.reason }).toEqual({ bad, state: 'hold', reason: 'the run\'s create record is not this attempt\'s reservation, so nothing is looked up or deleted' });
        }
        expect(st.calls.lookup).toEqual([]);
        // A spec that did not exit (killed at its deadline) may still write: nothing is looked up or deleted.
        const k = dirs();
        const killed = fixtures(k.runDir, { outcome: (env) => ({ exitCode: 0, timedOut: true, drained: true, admissionFile: env.RWT_J8_RUNNER_ADMISSION, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT }) });
        const kout = await run(k, killed.deps);
        expect({ lookups: killed.calls.lookup.length, left: killed.store.users.size, cleanup: kout.cleanup.result }).toEqual({ lookups: 0, left: 1, cleanup: 'incomplete' });
        expect(Object.values(kout.cleanup.reasons).flat()).toContain('the spec did not exit, so its pages may still write; the account is left for protected recovery');
        // Sam on 65365f36: an exit 0 whose browser was not confirmed stopped is treated the same way: nothing looked up or deleted.
        const u = dirs();
        const undrained = fixtures(u.runDir, { outcome: (env) => ({ exitCode: 0, timedOut: false, drained: false, admissionFile: env.RWT_J8_RUNNER_ADMISSION, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT }) });
        const uout = await run(u, undrained.deps);
        expect({ lookups: undrained.calls.lookup.length, deleted: undrained.calls.store.scopedDelete.length, left: undrained.store.users.size, cleanup: uout.cleanup.result, exit: uout.exitCode, next: admitRun(u.evidenceDir).admitted })
            .toEqual({ lookups: 0, deleted: 0, left: 1, cleanup: 'incomplete', exit: 78, next: false });
        expect(Object.values(uout.cleanup.reasons).flat()).toContain('the spec did not exit, so its pages may still write; the account is left for protected recovery');
    });

    it('THE DELETE IS NEVER ABANDONED (Sam on 65365f36): it gets what is left of the budget, and no HOLD is reported while it runs', async () => {
        // The remaining budget reaches the delete.
        const d = dirs();
        let clock = NOW;
        const st = accountStore();
        const inner = st.deps.scopedDelete;
        const seen = [];
        st.deps.lookup = ((l) => async (q) => { clock += 1_000; return l(q); })(st.deps.lookup);
        st.deps.scopedDelete = async (q) => { seen.push(q.timeoutMs); return inner(q); };
        const ok = await run(d, fixtures(d.runDir, { store: st }).deps, { now: () => clock });
        expect(ok.exitCode).toBe(0);
        expect(seen.length).toBe(1);
        expect(seen[0] > 0 && seen[0] < DEADLINES_CLEANUP && seen[0] === DEADLINES_CLEANUP - 1_000).toBe(true);
        // A delete still running past the budget (real time, a 300 ms budget, a 900 ms delete): the run waits for it to end and only
        // then holds; it never settles while the delete may still be running.
        const e = dirs();
        let ended = false;
        let endedBeforeSettle = null;
        const slow = accountStore();
        const slowInner = slow.deps.scopedDelete;
        slow.deps.scopedDelete = async (q) => { await new Promise((r) => setTimeout(r, 900)); const out = await slowInner(q); ended = true; return out; };
        const late = await run(e, fixtures(e.runDir, { store: slow }).deps, { now: Date.now, deadlines: { ...entry.DEADLINES, cleanupMs: 300 } }).then((r) => { endedBeforeSettle = ended; return r; });
        expect({ endedBeforeSettle, cleanup: late.cleanup.result, exit: late.exitCode, next: admitRun(e.evidenceDir).admitted })
            .toEqual({ endedBeforeSettle: true, cleanup: 'incomplete', exit: 78, next: false });
        expect(Object.values(late.cleanup.reasons).flat()).toContain('the scoped delete did not finish within the cleanup budget; the landed account is left for protected recovery');
        // A delete whose processes could not be confirmed stopped: HOLD, the landed record stays and blocks the next admission.
        const f = dirs();
        const und = accountStore();
        und.deps.scopedDelete = async () => ({ deleted: false, drained: false });
        const uo = await run(f, fixtures(f.runDir, { store: und }).deps);
        expect({ cleanup: uo.cleanup.result, exit: uo.exitCode, landed: files(f.evidenceDir, '.landed.').length, next: admitRun(f.evidenceDir).admitted })
            .toEqual({ cleanup: 'incomplete', exit: 78, landed: 1, next: false });
        expect(Object.values(uo.cleanup.reasons).flat()).toContain('the scoped delete\'s processes could not be confirmed stopped; the landed account is left for protected recovery');
        // Sam on eb8165a0: recovery accepts the delete only on drained === true. A delete that proves the account deleted but does not
        // report its processes stopped (drained missing, undefined, or anything but true) holds the same way, and the landed record stays.
        for (const [name, answer] of Object.entries({ 'drained missing': { deleted: true }, 'drained undefined': { deleted: true, drained: undefined },
            'drained null': { deleted: true, drained: null }, 'drained "true"': { deleted: true, drained: 'true' }, 'drained 1': { deleted: true, drained: 1 } })) {
            const m = dirs();
            const st = accountStore();
            const inner = st.deps.scopedDelete;
            st.deps.scopedDelete = async (q) => { await inner(q); return answer; };
            const mo = await run(m, fixtures(m.runDir, { store: st }).deps);
            expect({ name, cleanup: mo.cleanup.result, exit: mo.exitCode, landed: files(m.evidenceDir, '.landed.').length, recovered: files(m.evidenceDir, '.recovered.').length, next: admitRun(m.evidenceDir).admitted })
                .toEqual({ name, cleanup: 'incomplete', exit: 78, landed: 1, recovered: 0, next: false });
            expect({ name, held: Object.values(mo.cleanup.reasons).flat().includes('the scoped delete\'s processes could not be confirmed stopped; the landed account is left for protected recovery') })
                .toEqual({ name, held: true });
        }
        // A delete that throws holds too (nothing proven), never a crash.
        const g = dirs();
        const thr = accountStore();
        thr.deps.scopedDelete = async () => { throw new Error('spawn'); };
        expect((await run(g, fixtures(g.runDir, { store: thr }).deps)).exitCode).toBe(78);
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
    it('RUN DIRECTORY (Codex on 4a5d718a): deps that do not name the run directory as where the spec writes are refused before admission', async () => {
        const missing = path.join(os.tmpdir(), 'j8-entry-does-not-exist');
        for (const [name, root] of [['absent', undefined], ['empty', ''], ['not a string', 7], ['another directory', 'evidence'], ['missing', missing], ['a file', 'file']]) {
            const d = dirs();
            fs.writeFileSync(path.join(d.root, 'file'), '');
            const f = fixtures(d.runDir);
            f.deps.artifactRoot = root === 'evidence' ? d.evidenceDir : root === 'file' ? path.join(d.root, 'file') : root;
            const out = await run(d, f.deps);
            expect({ name, exit: out.exitCode, reason: out.reason, ran: f.calls.runSpec.length, recorded: fs.readdirSync(d.evidenceDir) })
                .toEqual({ name, exit: 78, reason: 'HOLD: J8 not admitted, nothing sent: the run directory is not where the spec writes its receipt', ran: 0, recorded: [] });
        }
        // The same directory named another way (a trailing separator, a relative segment) is the same directory.
        const d = dirs();
        const f = fixtures(d.runDir);
        f.deps.artifactRoot = `${d.runDir}${path.sep}..${path.sep}run${path.sep}`;
        expect((await run(d, f.deps)).exitCode).toBe(0);
        expect(entry.sameDirectory(d.runDir, d.runDir)).toBe(true);
        expect(entry.sameDirectory(d.runDir, path.join(d.runDir, 'test-results', 'rwt', entry.RECEIPT_FILE))).toBe(false);
    });
    it('SPEC OUTCOME (Sam on b1f8323f): only a terminal exit bound to this admission, run and attempt lets the receipt be read', async () => {
        const bad = {
            'no exit code': (env) => ({ exitCode: null, drained: true, admissionFile: env.RWT_J8_RUNNER_ADMISSION, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT }),
            'exit 2': (env) => ({ exitCode: 2, drained: true, admissionFile: env.RWT_J8_RUNNER_ADMISSION, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT }),
            'killed at its deadline': (env) => ({ exitCode: 0, timedOut: true, drained: true, admissionFile: env.RWT_J8_RUNNER_ADMISSION, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT }),
            'another admission': (env) => ({ exitCode: 0, drained: true, admissionFile: `${env.RWT_J8_RUNNER_ADMISSION}.old`, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT }),
            'another run attempt': (env) => ({ exitCode: 0, drained: true, admissionFile: env.RWT_J8_RUNNER_ADMISSION, runId: env.GITHUB_RUN_ID, runAttempt: '2' }),
            'another run': (env) => ({ exitCode: 0, drained: true, admissionFile: env.RWT_J8_RUNNER_ADMISSION, runId: '1', runAttempt: env.GITHUB_RUN_ATTEMPT }),
            'a bare number': () => 0,
            // Sam on 65365f36: an exit whose process tree (the browser included) was not confirmed stopped is not an exit.
            'exit 0, but its processes were not confirmed stopped': (env) => ({ exitCode: 0, drained: false, admissionFile: env.RWT_J8_RUNNER_ADMISSION, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT }),
            'exit 0, drain not reported': (env) => ({ exitCode: 0, admissionFile: env.RWT_J8_RUNNER_ADMISSION, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT }),
        };
        for (const [name, outcome] of Object.entries(bad)) {
            const d = dirs();
            const f = fixtures(d.runDir, { outcome });
            const out = await run(d, f.deps);
            expect({ name, hold: out.caseResult.assertions.every((a) => a.result === 'HOLD'), qualify: f.calls.qualify.length, cleanup: out.cleanup.result, exit: out.exitCode })
                .toEqual({ name, hold: true, qualify: 0, cleanup: 'incomplete', exit: 78 });
        }
        // Exit 1 over a receipt with no FAIL row (every row PASS but the deferred HOLD retention row) contradicts itself: HOLD.
        const exit1 = (env) => ({ exitCode: 1, drained: true, admissionFile: env.RWT_J8_RUNNER_ADMISSION, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT });
        const d = dirs();
        const contradiction = await run(d, fixtures(d.runDir, { outcome: exit1 }).deps);
        expect(contradiction.caseResult.assertions[0].sources).toEqual(['the spec failed but its receipt shows no failing row']);
        expect(contradiction.exitCode).toBe(78);
        // Also with another HOLD row and no FAIL: still the contradiction, never mapped.
        const h = dirs();
        const heldExit1 = await run(h, fixtures(h.runDir, { outcome: exit1, spec: (adm) => receiptFor(adm.createAttempt.attemptId, [{ step: 'scenario execution', verdict: 'HOLD', detail: '' }]) }).deps);
        expect(heldExit1.caseResult.assertions.every((a) => a.result === 'HOLD' && a.sources[0] === 'the spec failed but its receipt shows no failing row')).toBe(true);
        expect(heldExit1.exitCode).toBe(78);
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
    it('LATE READBACK (Codex on 46fe2e02): a call past its deadline is awaited before the entry moves on, and no readback or coaching call runs beside it or after it', async () => {
        const chain = { step: 'J8.b: feedback diagnostic chain', verdict: 'HOLD', detail: '', evidence: { reasons: 'telemetry_not_received',
            expectedRequestSha256: 'r'.repeat(64), expectedAttemptSha256: 'a'.repeat(64), expectedProduct: 'p', expectedConfiguredModel: 'm', expectedOutcome: 'o' } };
        const slow = { readbackMs: 60, coachingMs: 60, lateSettleMs: 400 };
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        for (const late of ['journey-a', 'journey-final-b', 'journey-c']) {
            const d = dirs();
            const f = fixtures(d.runDir, { spec: (adm) => receiptFor(adm.createAttempt.attemptId, [chain]), coaching: () => ({ verdict: 'PASS', reasons: [] }) });
            const inner = f.deps.qualify;
            let active = 0;
            let overlap = false;
            let lateEnded = false;
            // The late call answers QUALIFIED, but only after its deadline (well inside the grace).
            f.deps.qualify = async (q) => {
                active += 1;
                if (active > 1) overlap = true;
                try { if (q.journeyId === late) { await sleep(150); lateEnded = true; } return await inner(q); } finally { active -= 1; }
            };
            const out = await run(d, f.deps, { deadlines: { ...entry.DEADLINES, ...slow } });
            const asked = f.calls.qualify.map((q) => q.journeyId);
            const order = out.readback.journeys.map((j) => j.journeyId);
            const at = order.indexOf(late);
            expect({ late, overlap, lateEnded, activeAtEnd: active, asked: asked.length, coaching: f.calls.coaching.length, cutOff: out.readback.cutOff })
                .toEqual({ late, overlap: false, lateEnded: true, activeAtEnd: 0, asked: at + 1, coaching: 0, cutOff: 'a readback or coaching call passed its deadline' });
            // Journeys read back before it keep their final answer; it and every later one is HOLD, whatever it answered late.
            expect({ late, verdicts: out.readback.journeys.map((j) => j.verdict) })
                .toEqual({ late, verdicts: order.map((_, i) => (i < at ? 'QUALIFIED' : 'HOLD')) });
            expect(out.readback.missingBindings).toEqual([]);
            expect(out.readback.coachingDiagnostic).toEqual({ verdict: 'HOLD', reasons: ['diagnostic_not_received'] });
        }
        // A coaching call past its deadline is awaited too, and its late answer is never kept.
        const c = dirs();
        let coachingEnded = false;
        const g = fixtures(c.runDir, { spec: (adm) => receiptFor(adm.createAttempt.attemptId, [chain]),
            coaching: async () => { await sleep(150); coachingEnded = true; return { verdict: 'PASS', reasons: [], release: RELEASE, expected: {} }; } });
        const out = await run(c, g.deps, { deadlines: { ...entry.DEADLINES, ...slow } });
        expect({ coachingEnded, verdicts: out.readback.journeys.map((j) => j.verdict), coaching: out.readback.coachingDiagnostic, cutOff: out.readback.cutOff })
            .toEqual({ coachingEnded: true, verdicts: ['QUALIFIED', 'QUALIFIED', 'QUALIFIED'], coaching: { verdict: 'HOLD', reasons: ['diagnostic_not_received'] },
                cutOff: 'a readback or coaching call passed its deadline' });
        // In time: no cut-off is recorded.
        const n = dirs();
        const fine = await run(n, fixtures(n.runDir).deps);
        expect('cutOff' in fine.readback).toBe(false);
    });
    it('UNCONFIRMED READBACK (Sam on 586d50fb): while a readback or coaching process is not confirmed stopped, teardown neither looks the account up nor deletes it', async () => {
        const chain = { step: 'J8.b: feedback diagnostic chain', verdict: 'HOLD', detail: '', evidence: { reasons: 'telemetry_not_received',
            expectedRequestSha256: 'r'.repeat(64), expectedAttemptSha256: 'a'.repeat(64), expectedProduct: 'p', expectedConfiguredModel: 'm', expectedOutcome: 'o' } };
        const short = { ...entry.DEADLINES, readbackMs: 40, coachingMs: 40, lateSettleMs: 40 };
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const reason = (r) => `${r}; nothing is looked up or deleted, and the account is left for protected recovery`;
        // Each case runs through runJ8Nightly's own `finally` (the cleanup path), with the parent recovery present and a landed account.
        // Sam on f07fea31: a call that ends late but INSIDE the grace is stopped only when it ends with a plain answer. A late throw, or a
        // late answer that says its process was not confirmed stopped, is unconfirmed exactly as in time (`grace` widens the grace so
        // these end inside it).
        const lateBy = (answer) => async () => { await sleep(60); if (answer === 'throw') throw new Error('spawn'); return answer; };
        const cases = {
            'a readback that ends inside the grace with its own unconfirmed answer': [{ late: lateBy({ status: 1, evidence: null, unconfirmed: true }), grace: true },
                'a readback or coaching call passed its deadline and its process was not confirmed stopped'],
            'a readback that throws inside the grace': [{ late: lateBy('throw'), grace: true },
                'a readback or coaching call passed its deadline and then threw, so its process is not confirmed stopped'],
            'a coaching call that ends inside the grace with its own unconfirmed answer': [{ coaching: lateBy({ unconfirmed: true }), grace: true },
                'a readback or coaching call passed its deadline and its process was not confirmed stopped'],
            'a coaching call that throws inside the grace': [{ coaching: lateBy('throw'), grace: true },
                'a readback or coaching call passed its deadline and then threw, so its process is not confirmed stopped'],
            'a readback that never settles': [{ qualify: () => new Promise(() => {}) }, 'a readback or coaching call passed its deadline and was still running'],
            'a readback that ends only after the grace': [{ qualify: async () => { await sleep(300); return 0; } }, 'a readback or coaching call passed its deadline and was still running'],
            'a coaching call that never settles': [{ coaching: () => new Promise(() => {}) }, 'a readback or coaching call passed its deadline and was still running'],
            'the adapter\'s own unconfirmed readback': [{ answer: { status: 1, evidence: null, unconfirmed: true } }, 'a readback or coaching process was not confirmed stopped'],
            'the adapter\'s own unconfirmed coaching call': [{ coachingAnswer: { unconfirmed: true } }, 'a readback or coaching process was not confirmed stopped'],
            'a readback call that throws': [{ answer: 'throw' }, 'a readback or coaching call threw, so its process is not confirmed stopped'],
        };
        for (const [name, [c, why]] of Object.entries(cases)) {
            const d = dirs();
            const f = fixtures(d.runDir, { spec: (adm) => receiptFor(adm.createAttempt.attemptId, [chain]),
                coaching: c.coaching ?? (() => c.coachingAnswer ?? { verdict: 'PASS', reasons: [], release: RELEASE, expected: {} }) });
            let running = 0;
            if (c.qualify || c.answer || c.late) {
                f.deps.qualify = async (q) => {
                    f.calls.qualify.push(q);
                    if (c.late) return c.late();
                    if (c.answer === 'throw') throw new Error('spawn');
                    if (c.answer) return c.answer;
                    running += 1;
                    const status = await c.qualify(q);
                    running -= 1;
                    return { status, evidence: evidenceFor(q, status) };
                };
            }
            // Recorded when teardown would reach the account: a readback still running at that moment is the finding.
            let runningAtLookup = null;
            const lookup = f.deps.lookup;
            f.deps.lookup = async (q) => { runningAtLookup = running; return lookup(q); };
            const out = await run(d, f.deps, { deadlines: c.grace ? { ...short, lateSettleMs: 400 } : short });
            const st = f.store.calls;
            expect({ name, lookups: st.lookup.length, readAccount: st.readAccount, deletes: st.scopedDelete.length, residue: st.readResidue.length, runningAtLookup })
                .toEqual({ name, lookups: 0, readAccount: 0, deletes: 0, residue: 0, runningAtLookup: null });
            // Sam on f07fea31: the evaluation starts its own process, so it never runs after an unconfirmed readback; every row is HOLD.
            expect({ name, evaluate: f.calls.evaluate, held: out.caseResult.assertions.every((a) => a.result === 'HOLD') }).toEqual({ name, evaluate: 0, held: true });
            expect({ name, left: f.store.users.size, cleanup: out.cleanup.result, exit: out.exitCode, journal: out.createJournal, next: admitRun(d.evidenceDir).admitted })
                .toEqual({ name, left: 1, cleanup: 'incomplete', exit: 78, journal: 'unresolved', next: false });
            expect({ name, reasons: Object.values(out.cleanup.reasons).flat().filter((r) => r.includes('protected recovery')) }).toEqual({ name, reasons: [reason(why)] });
            expect({ name, recorded: files(d.evidenceDir, '.landed.').length + files(d.evidenceDir, '.recovered.').length }).toEqual({ name, recorded: 0 });
        }
        // Sam on f07fea31: the evaluation is behind the same gate. One that never answers, throws, or says its process was not
        // confirmed stopped leaves the account exactly as above (evaluateMs is short, so a hung one is cut off).
        const evaluations = {
            'an evaluation that never answers': [() => new Promise(() => {}), 'the evaluation passed its deadline and may still be running'],
            'an evaluation that throws': [() => { throw new Error('spawn'); }, 'the evaluation threw, so its process is not confirmed stopped'],
            'an evaluation whose process was not confirmed stopped': [() => ({ unconfirmed: true }), 'the evaluation process was not confirmed stopped'],
        };
        for (const [name, [evaluate, why]] of Object.entries(evaluations)) {
            const d = dirs();
            const f = fixtures(d.runDir, { evaluate });
            const out = await run(d, f.deps, { deadlines: { ...short, evaluateMs: 40 } });
            const st = f.store.calls;
            expect({ name, evaluate: f.calls.evaluate, lookups: st.lookup.length, readAccount: st.readAccount, deletes: st.scopedDelete.length, residue: st.readResidue.length })
                .toEqual({ name, evaluate: 1, lookups: 0, readAccount: 0, deletes: 0, residue: 0 });
            expect({ name, left: f.store.users.size, cleanup: out.cleanup.result, exit: out.exitCode, journal: out.createJournal, next: admitRun(d.evidenceDir).admitted,
                held: out.caseResult.assertions.every((a) => a.result === 'HOLD') })
                .toEqual({ name, left: 1, cleanup: 'incomplete', exit: 78, journal: 'unresolved', next: false, held: true });
            expect({ name, reasons: Object.values(out.cleanup.reasons).flat().filter((r) => r.includes('protected recovery')) }).toEqual({ name, reasons: [reason(why)] });
        }
        // The reviewed finalizer's own process: cut off by its timeout (or killed by a signal) it is unconfirmed; an exit with a status
        // is a stop. A stand-in `tsx` in a scratch repo root plays each.
        const fakeRoot = (script) => {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'j8-fin-'));
            fs.mkdirSync(path.join(root, 'node_modules', '.bin'), { recursive: true });
            fs.writeFileSync(path.join(root, 'node_modules', '.bin', 'tsx'), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
            return root;
        };
        const fin = (script, timeoutMs = 5_000) => entry.finalizerEvaluate({ suite: J8_SUITE, release: RELEASE, rows: [] }, { journeys: [] },
            { workDir: fs.mkdtempSync(path.join(os.tmpdir(), 'j8-fin-w-')), repoRoot: fakeRoot(script), timeoutMs });
        expect({ timedOut: fin('sleep 5', 200), signalled: fin('kill -TERM $$'), failed: fin('exit 2'), settled: fin(`echo '{"errors":[],"rows":[]}'`) })
            .toEqual({ timedOut: { unconfirmed: true }, signalled: { unconfirmed: true }, failed: null, settled: { errors: [], rows: [] } });
        // Sam on 40e1a5a6: the evaluation child gets only the allowlisted variables, never a credential the parent holds.
        // The parent's own env holds credentials; the default (baseEnv = process.env) is what the runner uses, so seed it there.
        const seeded = { J8_FIN_PROBE_CREDENTIAL: 'held-in-parent', POSTHOG_PERSONAL_API_KEY: 'posthog-in-parent' };
        const saved = Object.fromEntries(Object.keys(seeded).map((k) => [k, process.env[k]]));
        Object.assign(process.env, seeded);
        let got;
        try {
            // The stand-in reports the env it was given via node (no shell utilities), so the reading does not depend on the platform's sh.
            const report = `exec "${process.execPath}" -e 'process.stdout.write(JSON.stringify({names:Object.keys(process.env)})+"\\n")'`;
            got = entry.finalizerEvaluate({ suite: J8_SUITE, release: RELEASE, rows: [] }, { journeys: [] },
                { workDir: fs.mkdtempSync(path.join(os.tmpdir(), 'j8-fin-w-')), repoRoot: fakeRoot(report) });
        } finally {
            for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
        }
        // The platform may add its own bookkeeping variables to any process; the parent's credentials must never arrive, and only
        // allowlisted names are passed from the parent's env.
        const names = Array.isArray(got?.names) ? got.names : null;
        expect({ read: Array.isArray(names), credential: names?.includes('J8_FIN_PROBE_CREDENTIAL'), posthog: names?.includes('POSTHOG_PERSONAL_API_KEY'),
            path: names?.includes('PATH') })
            .toEqual({ read: true, credential: false, posthog: false, path: true });
        expect(entry.EVALUATION_ENV.some((n) => /KEY|TOKEN|SECRET|PASSWORD|ROLE/i.test(n))).toBe(false);
        // A late readback that ends inside the grace is confirmed stopped: HOLD, but the account is recovered as usual.
        const g = dirs();
        const late = fixtures(g.runDir);
        const inner = late.deps.qualify;
        late.deps.qualify = async (q) => { if (q.journeyId === 'journey-c') await sleep(60); return inner(q); };
        const lout = await run(g, late.deps, { deadlines: { ...short, lateSettleMs: 400 } });
        expect({ cutOff: lout.readback.cutOff, lookups: late.store.calls.lookup.length > 0, deletes: late.store.calls.scopedDelete.length, left: late.store.users.size,
            cleanup: lout.cleanup.result, journal: lout.createJournal })
            .toEqual({ cutOff: 'a readback or coaching call passed its deadline', lookups: true, deletes: 1, left: 0, cleanup: 'complete', journal: 'resolved' });
        // Teardown fails closed on its own: a readback state it was not given (not an explicit null) looks nothing up.
        for (const readbackUnconfirmed of [undefined, false, '']) {
            const e = dirs();
            const adm = entry.admitJ8({ evidenceDir: e.evidenceDir, runId: RUN_ID, runAttempt: '1', configuredDomain: DOMAIN, now: () => NOW });
            const st = accountStore();
            st.signUp(`${adm.local}@${adm.domain}`);
            const doc = await entry.teardownJ8({ evidenceDir: e.evidenceDir, admission: adm, receipt: receiptFor(adm.attemptId), deps: st.deps,
                binding: ctRunFor(RUN_ID, '1'), specExited: true, readbackUnconfirmed });
            expect({ readbackUnconfirmed, cleanup: doc.cleanup, lookups: st.calls.lookup.length, deletes: st.calls.scopedDelete.length })
                .toEqual({ readbackUnconfirmed, cleanup: 'incomplete', lookups: 0, deletes: 0 });
        }
    });
    it('DEADLINES (Sam on b1f8323f): a spec, readback, coaching, evaluation or lookup that never answers is cut off, and cleanup still runs on its own budget', async () => {
        const never = () => new Promise(() => {});
        const short = { specMs: 40, readbackMs: 40, coachingMs: 40, lateSettleMs: 40, evaluateMs: 40, cleanupMs: 60, parentOpSettleMs: 40 };
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
        let hung = 0;
        rb.deps.qualify = () => { hung += 1; return never(); };
        const readback = await run(e, rb.deps, { deadlines: short });
        expect(readback.readback.journeys.map((j) => j.verdict)).toEqual(['HOLD', 'HOLD', 'HOLD']);
        // Codex on 46fe2e02: a call that never ends is the run's last readback; nothing starts beside it.
        expect({ calls: hung, cutOff: readback.readback.cutOff })
            .toEqual({ calls: 1, cutOff: 'a readback or coaching call passed its deadline and was still running' });
        // The evaluation hangs: every row HOLD.
        const g = dirs();
        const ev = fixtures(g.runDir);
        ev.deps.evaluate = never;
        const evaluated = await run(g, ev.deps, { deadlines: short });
        expect(evaluated.caseResult.assertions.every((a) => a.result === 'HOLD')).toBe(true);
        // The lookup hangs: cut off at the cleanup budget, so cleanup is incomplete and says why.
        const h = dirs();
        const lk = fixtures(h.runDir, { lookup: never });
        const lookup = await run(h, lk.deps, { deadlines: short });
        expect(lookup.cleanup.result).toBe('incomplete');
        expect(Object.values(lookup.cleanup.reasons).flat().join(' ')).toContain('did not finish within the cleanup budget');
        expect(lookup.exitCode).toBe(78);
        // Late evidence (Sam on 27ee1856): a residue zero, or the listing after the delete, that answers only after the budget is spent
        // never counts; the found account stays landed and blocking.
        for (const [name, step, reason] of [['delete', 'scopedDelete', 'the scoped delete did not finish within the cleanup budget; the landed account is left for protected recovery'],
            ['residue', 'readResidue', `${STORES.length} residue read(s) were not observed within the cleanup budget`],
            ['second listing', 'lookup', 'the listing after the delete did not finish within the cleanup budget']]) {
            const k = dirs();
            let clock = NOW;
            const st = accountStore();
            const inner = st.deps[step];
            let n = 0;
            st.deps[step] = async (q) => { n += 1; if (step !== 'lookup' || n === 2) clock += 11 * 60_000; return inner(q); };
            const lateOut = await run(k, fixtures(k.runDir, { store: st }).deps, { now: () => clock });
            expect({ name, cleanup: lateOut.cleanup.result, exit: lateOut.exitCode, recovered: files(k.evidenceDir, '.recovered.').length })
                .toEqual({ name, cleanup: 'incomplete', exit: 78, recovered: 0 });
            expect({ name, reasons: Object.values(lateOut.cleanup.reasons).flat().filter((r) => r.includes('budget')) }).toEqual({ name, reasons: [reason] });
        }
        // Every read in time, but the proof itself completes past the budget (the clock moves after the last listing): still late.
        const q = dirs();
        let clock = NOW;
        let armed = 0;
        const st = accountStore();
        const inner = st.deps.lookup;
        let n = 0;
        st.deps.lookup = async (x) => { n += 1; const r = await inner(x); if (n === 2) { clock = NOW + DEADLINES_CLEANUP; armed = 1; } return r; };
        const lastOut = await run(q, fixtures(q.runDir, { store: st }).deps, { now: () => (armed ? clock + (armed++ > 1 ? 1 : 0) : clock) });
        expect({ cleanup: lastOut.cleanup.result, recovered: files(q.evidenceDir, '.recovered.').length }).toEqual({ cleanup: 'incomplete', recovered: 0 });
        expect(Object.values(lastOut.cleanup.reasons).flat()).toContain('the residue proof completed after the cleanup budget, so it is late');
        // The recovery finishes on the budget's last millisecond, and teardown reads the clock after it: the budget is spent, so
        // cleanup is incomplete even though the recovery itself returned in time.
        const r = dirs();
        let c = 0;
        let armed2 = false;
        const st2 = accountStore();
        const inner2 = st2.deps.lookup;
        let n2 = 0;
        st2.deps.lookup = async (x) => { n2 += 1; const res = await inner2(x); if (n2 === 2) armed2 = true; return res; };
        const edge = await run(r, fixtures(r.runDir, { store: st2 }).deps, { now: () => (armed2 ? NOW + DEADLINES_CLEANUP - 2 + c++ : NOW) });
        expect({ cleanup: edge.cleanup.result, exit: edge.exitCode }).toEqual({ cleanup: 'incomplete', exit: 78 });
        expect(Object.values(edge.cleanup.reasons).flat()).toContain('the parent recovery finished after the cleanup budget');
    });
    it('LIVE GATE UNCHANGED: main refuses before admission without offline fixtures, and records nothing', async () => {
        const d = dirs();
        const LIVE_ENV = { LIVE_TEST_EMAIL_DOMAIN: DOMAIN, GITHUB_REPOSITORY: RUN_BINDING.repository, GITHUB_WORKFLOW_REF: RUN_BINDING.workflow, J8_STEP_STARTED_AT: String(Date.now()) };
        const argv = ['--evidence-dir', d.evidenceDir, '--run-dir', d.runDir, '--run-id', RUN_ID, '--run-attempt', '1', '--release-sha', RELEASE, '--execute', 'true'];
        const out = await entry.main(argv, LIVE_ENV, {});
        expect(out.exitCode).toBe(78);
        expect(/live gate is closed/.test(out.reason)).toBe(true);
        expect(fs.readdirSync(d.evidenceDir)).toEqual([]);
        expect((await entry.main(argv.slice(0, -2), LIVE_ENV, {})).exitCode).toBe(78);
        // The parent's expected release is required, and must be a release.
        const noRelease = argv.filter((_, i) => i !== argv.indexOf('--release-sha') && i !== argv.indexOf('--release-sha') + 1);
        expect((await entry.main(noRelease, LIVE_ENV, fixtures(d.runDir).deps)).exitCode).toBe(78);
        const badRelease = argv.map((v) => (v === RELEASE ? 'not-a-sha' : v));
        expect(/expected release/.test((await entry.main(badRelease, LIVE_ENV, fixtures(d.runDir).deps)).reason)).toBe(true);
        expect(fs.readdirSync(d.evidenceDir)).toEqual([]);
        expect((await entry.main(argv, {}, fixtures(d.runDir).deps)).exitCode).toBe(78);
        // No run binding in the parent: refused before admission (the account could not be checked against this run).
        for (const drop of ['GITHUB_REPOSITORY', 'GITHUB_WORKFLOW_REF']) {
            const env = { ...LIVE_ENV }; delete env[drop];
            expect(/no run binding/.test((await entry.main(argv, env, fixtures(d.runDir).deps)).reason)).toBe(true);
        }
        // Without the parent recovery's calls the gate stays closed too.
        const noRecovery = fixtures(d.runDir, { recovery: false }).deps;
        expect(/live gate is closed/.test((await entry.main(argv, LIVE_ENV, noRecovery)).reason)).toBe(true);
        expect(fs.readdirSync(d.evidenceDir)).toEqual([]);
        expect((await run(d, fixtures(d.runDir).deps, { runBinding: { repository: RUN_BINDING.repository } })).exitCode).toBe(78);
        expect((await entry.main([...argv, '--plan', 'x'], LIVE_ENV, fixtures(d.runDir).deps)).exitCode).toBe(78);
        // With fixtures it runs the same composition.
        expect((await entry.main(argv, LIVE_ENV, fixtures(d.runDir).deps)).exitCode).toBe(0);
    });
});

describe('J8 step deadline and cleanup window (Sam, 23 Nov): admission closes in time to finish cleanup before the runner step ends', () => {
    const D = entry.DEADLINES;
    const STEP_END = NOW + entry.J8_STEP_MS - entry.STEP_MARGIN_MS;
    const CHAIN = { step: 'J8.b: feedback diagnostic chain', verdict: 'HOLD', detail: '', evidence: { reasons: 'telemetry_not_received',
        expectedRequestSha256: 'r'.repeat(64), expectedAttemptSha256: 'a'.repeat(64), expectedProduct: 'p', expectedConfiguredModel: 'm', expectedOutcome: 'o' } };
    /** A fake clock the fixtures move: `at` is read by the entry; `lookupAt` is the clock when cleanup's first lookup ran. */
    function clocked(d, opts = {}, { spec = 0, qualify = (at) => at } = {}) {
        const c = { at: NOW, lookupAt: null };
        const f = fixtures(d.runDir, opts);
        const runSpec = f.deps.runSpec;
        f.deps.runSpec = async (a) => { const out = await runSpec(a); c.at = typeof spec === 'function' ? spec(c.at) : c.at + spec; return out; };
        const qualifyInner = f.deps.qualify;
        f.deps.qualify = async (q) => { const out = await qualifyInner(q); c.at = qualify(c.at, f.calls.qualify.length); return out; };
        const lookup = f.deps.lookup;
        f.deps.lookup = async (q) => { if (c.lookupAt === null) c.lookupAt = c.at; return lookup(q); };
        return { c, f, over: { now: () => c.at, stepEndAt: STEP_END } };
    }
    /** The cleanup window: cleanup started with its whole budget still before the step's end, and finished clean. */
    const cleanedInTime = (out, c, f) => ({ cleanup: out.cleanup.result, deleted: f.store.calls.scopedDelete.length, residueRead: f.store.calls.readResidue.length > 0,
        windowLeft: STEP_END - c.lookupAt >= D.cleanupMs });

    it('the initial budget is checked before the account is reserved: an early refusal leaves no create record, admission or receipt', async () => {
        for (const stepEndAt of [undefined, Number.NaN, NOW + D.specMs + D.parentOpSettleMs + D.cleanupMs]) {
            const d = dirs();
            const f = fixtures(d.runDir);
            const out = await run(d, f.deps, { stepEndAt });
            expect({ exitCode: out.exitCode, sent: /nothing sent/.test(out.reason), spec: f.calls.runSpec.length, evidence: fs.readdirSync(d.evidenceDir),
                receipts: fs.readdirSync(path.join(d.runDir, 'test-results', 'rwt')), lookups: f.store.calls.lookup.length })
                .toEqual({ exitCode: 78, sent: true, spec: 0, evidence: [], receipts: [], lookups: 0 });
        }
        // One millisecond more and the run is admitted.
        const d = dirs();
        const f = fixtures(d.runDir);
        const out = await run(d, f.deps, { stepEndAt: NOW + D.specMs + D.parentOpSettleMs + D.cleanupMs + 1 });
        expect({ exitCode: out.exitCode, spec: f.calls.runSpec.length, stepDeadline: out.stepDeadline }).toEqual({ exitCode: 0, spec: 1, stepDeadline: 'clear' });
    });

    it('a slow spec: no readback starts unless it, its late settle, the evaluation and cleanup fit; the legs are a terminal HOLD and cleanup runs now', async () => {
        const need = D.readbackMs + D.lateSettleMs + D.evaluateMs + D.cleanupMs;
        const d = dirs();
        const { c, f, over } = clocked(d, {}, { spec: () => STEP_END - need });
        const out = await run(d, f.deps, over);
        expect({ exitCode: out.exitCode, readbacks: f.calls.qualify.length, verdicts: out.readback.journeys.map((j) => j.verdict), cutOff: out.readback.cutOff,
            stepDeadline: out.stepDeadline, legs: entry.j8RunSummary(out).legs })
            .toEqual({ exitCode: 78, readbacks: 0, verdicts: ['HOLD', 'HOLD', 'HOLD'], cutOff: entry.STEP_CUT_OFF, stepDeadline: 'held',
                legs: { 'J8.a': 'HOLD', 'J8.b': 'HOLD', 'J8.c': 'HOLD' } });
        expect(cleanedInTime(out, c, f)).toEqual({ cleanup: 'complete', deleted: 1, residueRead: true, windowLeft: true });
        // One millisecond earlier, every readback still fits.
        const e = dirs();
        const early = clocked(e, {}, { spec: () => STEP_END - need - 1 });
        const ok = await run(e, early.f.deps, early.over);
        expect({ exitCode: ok.exitCode, readbacks: early.f.calls.qualify.length, stepDeadline: ok.stepDeadline }).toEqual({ exitCode: 0, readbacks: 3, stepDeadline: 'clear' });
    });

    it('slow readbacks: the journeys read in time keep their answers, the rest are HOLD, and cleanup keeps its whole budget', async () => {
        const d = dirs();
        const { c, f, over } = clocked(d, {}, { spec: 20 * 60_000, qualify: (at) => at + D.readbackMs });
        const out = await run(d, f.deps, over);
        expect({ readbacks: f.calls.qualify.length, verdicts: out.readback.journeys.map((j) => j.verdict), cutOff: out.readback.cutOff, evaluated: f.calls.evaluate,
            exitCode: out.exitCode, stepDeadline: out.stepDeadline })
            .toEqual({ readbacks: 2, verdicts: ['QUALIFIED', 'QUALIFIED', 'HOLD'], cutOff: entry.STEP_CUT_OFF, evaluated: 1, exitCode: 78, stepDeadline: 'held' });
        expect(cleanedInTime(out, c, f)).toEqual({ cleanup: 'complete', deleted: 1, residueRead: true, windowLeft: true });
    });

    it('a coaching call that would not fit is never started; its diagnostic is HOLD', async () => {
        const d = dirs();
        const { c, f, over } = clocked(d, { spec: (adm) => receiptFor(adm.createAttempt.attemptId, [CHAIN]), coaching: () => ({ verdict: 'PASS', reasons: [] }) },
            { qualify: (at, n) => (n === 3 ? STEP_END - (D.coachingMs + D.lateSettleMs + D.evaluateMs + D.cleanupMs) : at) });
        const out = await run(d, f.deps, over);
        expect({ readbacks: f.calls.qualify.length, coaching: f.calls.coaching.length, diagnostic: out.readback.coachingDiagnostic, cutOff: out.readback.cutOff,
            stepDeadline: out.stepDeadline, exitCode: out.exitCode })
            .toEqual({ readbacks: 3, coaching: 0, diagnostic: { verdict: 'HOLD', reasons: ['diagnostic_not_received'] }, cutOff: entry.STEP_CUT_OFF,
                stepDeadline: 'held', exitCode: 78 });
        expect(cleanedInTime(out, c, f)).toEqual({ cleanup: 'complete', deleted: 1, residueRead: true, windowLeft: true });
    });

    it('an evaluation that would not fit is never started; every row is HOLD and cleanup still has its window', async () => {
        const d = dirs();
        const { c, f, over } = clocked(d, {}, { qualify: (at, n) => (n === 3 ? STEP_END - (D.evaluateMs + D.cleanupMs) : at) });
        const out = await run(d, f.deps, over);
        expect({ evaluated: f.calls.evaluate, held: out.caseResult.assertions.every((a) => a.result === 'HOLD'),
            source: out.caseResult.assertions[0].sources, stepDeadline: out.stepDeadline, exitCode: out.exitCode })
            .toEqual({ evaluated: 0, held: true, source: ['the runner step\'s end is too close to settle the receipt'], stepDeadline: 'held', exitCode: 78 });
        expect(cleanedInTime(out, c, f)).toEqual({ cleanup: 'complete', deleted: 1, residueRead: true, windowLeft: true });
    });

    it('a parent operation still in flight when Playwright exits: admission closes, it settles, and only then do the readback and cleanup run', async () => {
        const d = dirs();
        const f = fixtures(d.runDir);
        const order = [];
        let port = null;
        const runSpec = f.deps.runSpec;
        f.deps.runSpec = async (a) => {
            port = a.operations;
            await port.run(() => { order.push('fence open'); });
            const out = await runSpec(a);
            // The fence close is still under way when the spec's process exits.
            port.run(() => new Promise((resolve) => { setTimeout(() => { order.push('fence close settled'); resolve(); }, 30); }));
            order.push('spec exited');
            return out;
        };
        let refusedAfterExit = null;
        const qualify = f.deps.qualify;
        f.deps.qualify = async (q) => {
            if (refusedAfterExit === null) {
                order.push('readback');
                refusedAfterExit = await port.run(() => { order.push('late operation ran'); }).then(() => false, (e) => e instanceof entry.ParentOperationRefused);
            }
            return qualify(q);
        };
        const lookup = f.deps.lookup;
        f.deps.lookup = async (q) => { if (!order.includes('cleanup')) order.push('cleanup'); return lookup(q); };
        const out = await run(d, f.deps);
        expect(order).toEqual(['fence open', 'spec exited', 'fence close settled', 'readback', 'cleanup']);
        expect({ refusedAfterExit, exitCode: out.exitCode, cleanup: out.cleanup.result, deleted: f.store.calls.scopedDelete.length,
            residueRead: f.store.calls.readResidue.length > 0, journal: out.createJournal })
            .toEqual({ refusedAfterExit: true, exitCode: 0, cleanup: 'complete', deleted: 1, residueRead: true, journal: 'resolved' });
    });

    it('a parent operation that does not settle after the spec ends: HOLD, nothing is read back, looked up or deleted, and the account is left for protected recovery', async () => {
        const d = dirs();
        const f = fixtures(d.runDir);
        const runSpec = f.deps.runSpec;
        f.deps.runSpec = async (a) => { const out = await runSpec(a); a.operations.run(() => new Promise(() => {})); return out; };
        const out = await run(d, f.deps, { deadlines: { ...D, parentOpSettleMs: 40 } });
        expect({ exitCode: out.exitCode, readbacks: f.calls.qualify.length, evaluated: f.calls.evaluate, lookups: f.store.calls.lookup.length,
            deletes: f.store.calls.scopedDelete.length, held: out.caseResult.assertions.every((a) => a.result === 'HOLD'), source: out.caseResult.assertions[0].sources,
            cleanup: out.cleanup.result, left: out.cleanup.reasons.J8.some((r) => /parent operation/.test(r) && /protected recovery/.test(r)), journal: out.createJournal })
            .toEqual({ exitCode: 78, readbacks: 0, evaluated: 0, lookups: 0, deletes: 0, held: true, source: ['a parent operation did not settle after the spec ended'],
                cleanup: 'incomplete', left: true, journal: 'unresolved' });
    });

    it('a parent operation that ended with an unknown outcome (rejected): HOLD, nothing is read back, looked up or deleted, and the account is left for protected recovery (Sam on 40e1a5a6)', async () => {
        const d = dirs();
        const f = fixtures(d.runDir);
        const runSpec = f.deps.runSpec;
        f.deps.runSpec = async (a) => { await a.operations.run(async () => { throw new Error('write outcome unknown'); }).catch(() => null); return runSpec(a); };
        const out = await run(d, f.deps, { deadlines: { ...D, parentOpSettleMs: 40 } });
        expect({ exitCode: out.exitCode, readbacks: f.calls.qualify.length, evaluated: f.calls.evaluate, lookups: f.store.calls.lookup.length,
            deletes: f.store.calls.scopedDelete.length, held: out.caseResult.assertions.every((a) => a.result === 'HOLD'), source: out.caseResult.assertions[0].sources,
            cleanup: out.cleanup.result, journal: out.createJournal })
            .toEqual({ exitCode: 78, readbacks: 0, evaluated: 0, lookups: 0, deletes: 0, held: true, source: ['a parent operation ended with an unknown outcome'],
                cleanup: 'incomplete', journal: 'unresolved' });
    });

    it('the gate: an operation that fails still settles; closing refuses new ones without cancelling those in flight', async () => {
        const ops = entry.parentOperations();
        let finished = false;
        const slow = ops.port.run(() => new Promise((resolve) => { setTimeout(() => { finished = true; resolve('done'); }, 20); }));
        const failed = ops.port.run(() => { throw new Error('boom'); }).catch(() => 'rejected');
        ops.close();
        const late = await ops.port.run(() => 'ran').catch((e) => e instanceof entry.ParentOperationRefused);
        expect({ open: ops.open, late, settled: await ops.settle(1_000), finished, slow: await slow, failed: await failed, inFlight: ops.inFlight, unknown: ops.outcomeUnknown })
            .toEqual({ open: false, late: true, settled: true, finished: true, slow: 'done', failed: 'rejected', inFlight: 0, unknown: true });
        // Ended is not confirmed: only a rejection marks the outcome unknown; fulfilled operations and refusals after close do not.
        const clean = entry.parentOperations();
        await clean.port.run(() => 'ok');
        clean.close();
        await clean.port.run(() => 'late').catch(() => null);
        expect({ settled: await clean.settle(100), unknown: clean.outcomeUnknown }).toEqual({ settled: true, unknown: false });
        const stuck = entry.parentOperations();
        stuck.port.run(() => new Promise(() => {}));
        stuck.close();
        expect({ noTime: await stuck.settle(0), shortWait: await stuck.settle(20), none: await entry.parentOperations().settle(0) })
            .toEqual({ noTime: false, shortWait: false, none: true });
    });

    it('the CLI fixes the step\'s end from the step\'s own start (J8_STEP_STARTED_AT), or refuses before anything is built', () => {
        const argv = ['--evidence-dir', 'e', '--run-dir', 'r', '--run-id', RUN_ID, '--run-attempt', '1', '--release-sha', RELEASE, '--execute', 'true'];
        const env = { LIVE_TEST_EMAIL_DOMAIN: DOMAIN, GITHUB_REPOSITORY: RUN_BINDING.repository, GITHUB_WORKFLOW_REF: RUN_BINDING.workflow };
        const at = () => NOW;
        for (const started of [undefined, '', 'soon', String(NOW).slice(1), String(NOW + 60_000), String(NOW - entry.J8_STEP_MS)]) {
            const out = entry.cliArgs(argv, { ...env, J8_STEP_STARTED_AT: started }, at);
            expect({ exitCode: out.exitCode, args: out.args, why: /J8_STEP_STARTED_AT/.test(out.reason) }).toEqual({ exitCode: 78, args: undefined, why: true });
        }
        const ok = entry.cliArgs(argv, { ...env, J8_STEP_STARTED_AT: String(NOW - 120_000) }, at);
        expect(ok.stepEndAt).toBe(NOW - 120_000 + 88 * 60_000 - 3 * 60_000);
        expect({ step: entry.J8_STEP_MS, margin: entry.STEP_MARGIN_MS }).toEqual({ step: 88 * 60_000, margin: 3 * 60_000 });
    });
});

describe('J8 nightly entry with the live adapters composed over a recording process runner', () => {
    const { j8LiveAdapters } = require('../j8-live-adapters.cjs');
    /** A supabase-js-shaped admin client over `users`: listing, read by id (404 once gone), head counts and the save journal count. */
    function fakeAdmin(users, { counts = {} } = {}) {
        return {
            auth: { admin: {
                listUsers: async ({ page, perPage }) => ({ data: { users: [...users.values()].slice((page - 1) * perPage, page * perPage) }, error: null }),
                getUserById: async (uid) => (users.has(uid) ? { data: { user: users.get(uid) }, error: null }
                    : { data: { user: null }, error: { status: 404, code: 'user_not_found', message: 'User not found' } }),
            } },
            from: (table) => ({ select: () => ({ eq: async () => ({ count: counts[table] ?? 0, error: null }) }) }),
            rpc: async () => ({ data: 0, error: null }),
        };
    }
    /**
     * One runner for the spec, the readback and the scoped delete: the spec signs the reserved account up (bound to its run) and writes
     * `spec(admission)`; each readback answers `readbackCode(args)`; the delete script removes the account and prints its verdict.
     */
    function composed(d, { spec = (adm) => receiptFor(adm.createAttempt.attemptId), readbackCode = () => 0, users = new Map(), counts = {}, repoRoot = d.runDir,
        drainedFor = () => true } = {}) {
        const calls = [];
        // Every process tree is drained, as the real runner reports once nothing carrying its tag is left (unless `drainedFor` says not).
        const runner = (command, args, opts) => ({ ...answer(command, args, opts), drained: drainedFor(args) });
        const answer = (command, args, opts) => {
            calls.push({ command, args, env: opts.env, timeout: opts.timeout });
            if (args.includes('playwright') && args.includes('--list')) return { status: 0, stdout: LISTED_J8 };
            if (args.includes('playwright')) {
                const admission = JSON.parse(fs.readFileSync(opts.env.RWT_J8_RUNNER_ADMISSION, 'utf8'));
                const id = `uid-${opts.env.GITHUB_RUN_ID}`;
                users.set(id, { id, email: admission.createAttempt.lookupRef, created_at: new Date().toISOString(),
                    app_metadata: { ct_run: ctRunFor(opts.env.GITHUB_RUN_ID, opts.env.GITHUB_RUN_ATTEMPT) } });
                // Written where the real receipt writer writes: test-results/rwt under the spec's own working directory.
                const receipt = spec(admission);
                if (receipt) fs.writeFileSync(path.join(opts.cwd, 'test-results', 'rwt', entry.RECEIPT_FILE), JSON.stringify(receipt));
                return { status: 0, stdout: '' };
            }
            if (String(args[0]).endsWith('rwt-j8-parent-delete.mts')) {
                users.delete(opts.env.RWT_J8_DELETE_UID);
                return { status: 0, stdout: 'RUN_OWNED_CLEANUP cleanup_verified residue=0 tables_verified=25\n' };
            }
            // The readback CLI prints its own evidence of what it checked, from the arguments and env it was given.
            const status = readbackCode(args);
            const q = { release: args[args.indexOf('--release-sha') + 1], journeyId: args[args.indexOf('--journey-id') + 1],
                stages: String(opts.env.QUALIFICATION_STAGES).split(',').filter(Boolean), attemptIds: String(opts.env.QUALIFICATION_ATTEMPT_IDS).split(',').filter(Boolean) };
            const ev = evidenceFor(q, status);
            return { status, stdout: ev ? `noise\nTELEMETRY_READBACK_QUALIFICATION_EVIDENCE ${JSON.stringify({ gate: 'TELEMETRY-READBACK-COMPLETENESS', ...ev })}\n` : '' };
        };
        const deps = { ...j8LiveAdapters({ repoRoot, baseEnv: {}, run: runner, sleep: async () => {}, admin: fakeAdmin(users, { counts }), opsAdmin: { opsClient: true },
            readAdmission: (f) => require('node:fs').readFileSync(f, 'utf8'), startOps: async () => ({ url: 'http://127.0.0.1:41234/op', stop: async () => {} }) }),
            evaluate: async (receipt) => ({ suite: receipt.suite, release: receipt.release, errors: [], rows: receipt.rows }) };
        return { deps, calls, users };
    }
    it('the live adapters plug into the entry unchanged: spec once, one readback per bound journey, zero residue, all PASS', async () => {
        const d = dirs();
        const c = composed(d);
        const out = await run(d, c.deps);
        expect(out.exitCode).toBe(0);
        expect(out.cleanup.result).toBe('complete');
        // The selector is listed first, then the one selected test runs once.
        expect(c.calls.filter((x) => x.args.includes('playwright')).map((x) => x.args.at(-1))).toEqual(['--list', '--reporter=line']);
        const journeys = c.calls.filter((x) => x.args.includes('telemetry:readback-qualification')).map((x) => x.args[x.args.indexOf('--journey-id') + 1]);
        expect(journeys).toEqual(LEGS.map((l) => JOURNEY_OF[l]));
        // The scoped delete ran once, as its own process, bound to the run the parent checked; the account is gone.
        const del = c.calls.filter((x) => String(x.args[0]).endsWith('rwt-j8-parent-delete.mts'));
        expect(del.map((x) => ({ run: x.env.GITHUB_RUN_ID, attempt: x.env.GITHUB_RUN_ATTEMPT, repo: x.env.GITHUB_REPOSITORY, wf: x.env.GITHUB_WORKFLOW_REF, email: x.env.RWT_J8_DELETE_EMAIL })))
            .toEqual([{ run: RUN_ID, attempt: '1', repo: RUN_BINDING.repository, wf: RUN_BINDING.workflow, email: emailOf(RUN_ID) }]);
        expect(c.users.size).toBe(0);
        expect(out.createJournal).toBe('resolved');
    });
    it('RUN DIRECTORY (Codex on 4a5d718a): a run directory that is not where the spec writes is refused before admission; nothing runs', async () => {
        const d = dirs();
        // The adapters run the spec in the checkout root; the entry was given another directory.
        const c = composed(d, { repoRoot: d.root });
        const out = await run(d, c.deps);
        expect(out.exitCode).toBe(78);
        expect(out.reason).toBe('HOLD: J8 not admitted, nothing sent: the run directory is not where the spec writes its receipt');
        expect(c.calls.length).toBe(0);
        expect(fs.readdirSync(d.evidenceDir)).toEqual([]);
        // A symlink to the spec's directory is the same directory.
        const e = dirs();
        const link = path.join(e.root, 'run-link');
        fs.symlinkSync(e.runDir, link);
        const linked = await run({ ...e, runDir: link }, composed(e).deps);
        expect(linked.exitCode).toBe(0);
    });
    it('UNCONFIRMED READBACK (Sam on 586d50fb): a readback the live runner cannot confirm stopped means no delete process is started', async () => {
        for (const drained of [false, undefined]) {
            const d = dirs();
            // The runner reports the readback process tree not confirmed stopped; every other process is drained as usual.
            const c = composed(d, { drainedFor: (args) => (args.includes('telemetry:readback-qualification') ? drained : true) });
            const out = await run(d, c.deps);
            const del = c.calls.filter((x) => String(x.args[0]).endsWith('rwt-j8-parent-delete.mts'));
            expect({ drained, deletes: del.length, left: c.users.size, cleanup: out.cleanup.result, exit: out.exitCode, journal: out.createJournal })
                .toEqual({ drained, deletes: 0, left: 1, cleanup: 'incomplete', exit: 78, journal: 'unresolved' });
            expect(Object.values(out.cleanup.reasons).flat()).toContain('a readback or coaching process was not confirmed stopped; nothing is looked up or deleted, and the account is left for protected recovery');
        }
    });
    it('an observed readback failure for J8.b\'s journey FAILs its received row; residue after the delete keeps cleanup incomplete', async () => {
        const d = dirs();
        const failB = composed(d, { readbackCode: (args) => (args.includes(JOURNEY_OF['J8.b']) ? 3 : 0) });
        const out = await run(d, failB.deps);
        expect(out.exitCode).toBe(1);
        expect(resultOf(out, 'J8.b', 'AHT-07:received-feedback-proof')).toBe('FAIL');
        // A store that still counts a row after the delete: cleanup incomplete, the found account stays blocking.
        const e = dirs();
        const residue = await run(e, composed(e, { counts: { user_goals: 1 } }).deps);
        expect({ cleanup: residue.cleanup.result, exit: residue.exitCode, journal: residue.createJournal }).toEqual({ cleanup: 'incomplete', exit: 78, journal: 'unresolved' });
    });
});

describe('J8 run summary and admin transport (the protected runner scripts/rwt-j8-parent-runner.cjs prints and uses these)', () => {
    const { cleanupReserve } = require('../cleanup-plan.cjs');

    it('the summary line names each leg\'s result, cleanup, the create journal and the step deadline, and nothing else', async () => {
        const d = dirs();
        const ok = entry.j8RunSummary(await run(d, fixtures(d.runDir).deps));
        expect(ok).toEqual({ exitCode: 0, legs: { 'J8.a': 'PASS', 'J8.b': 'PASS', 'J8.c': 'PASS' }, cleanup: 'complete', createJournal: 'resolved', stepDeadline: 'clear' });
        const held = entry.j8RunSummary({ exitCode: 78, caseResult: entry.holdAll('x'), cleanup: { result: 'incomplete' }, createJournal: 'unresolved', stepDeadline: 'held' });
        expect(held).toEqual({ exitCode: 78, legs: { 'J8.a': 'HOLD', 'J8.b': 'HOLD', 'J8.c': 'HOLD' }, cleanup: 'incomplete', createJournal: 'unresolved', stepDeadline: 'held' });
        const failed = entry.holdAll('x');
        failed.assertions = failed.assertions.map((a, i) => ({ ...a, result: a.leg === 'J8.b' && i % 2 ? 'FAIL' : 'PASS' }));
        expect(entry.j8RunSummary({ exitCode: 1, caseResult: failed, cleanup: { result: 'complete' }, createJournal: 'resolved' }).legs['J8.b']).toBe('FAIL');
        expect(entry.j8RunSummary({ exitCode: 78, reason: 'BLOCKED_SETUP: anything' })).toEqual({ exitCode: 78, refused: true });
    });

    it('the admin transport is teardown-only, sized to two full lookups, the account read and J8\'s cleanup reserve', async () => {
        const fetched = [];
        const t = entry.j8AdminTransport(async (url) => { fetched.push(url); return { ok: true }; });
        const allowance = 2 * entry.J8_LOOKUP_PAGES + 1 + cleanupReserve('J8').requests;
        expect({ bind: t.remaining('bind'), teardown: t.remaining('teardown') }).toEqual({ bind: 0, teardown: allowance });
        for (let i = 0; i < allowance; i++) await t.fetch(`u${i}`);
        let refused = null;
        try { await t.fetch('one-more'); } catch (e) { refused = e.code; }
        expect(refused).toBe('ADMIN_ALLOWANCE');
        expect(fetched.length).toBe(allowance);
    });
});

describe('J8 parent operations transport (Sam, 23 Nov): the operations can never spend cleanup\'s allowance', () => {
    it('the operations transport has its own cap; spending it leaves teardown\'s allowance whole', async () => {
        let sent = 0;
        const fetchImpl = async () => { sent += 1; return { ok: true }; };
        const ops = entry.j8OpsTransport(fetchImpl);
        const teardown = entry.j8AdminTransport(fetchImpl);
        const teardownBefore = teardown.remaining('teardown');
        for (let i = 0; i < entry.J8_PARENT_OP_REQUESTS; i++) await ops.fetch('https://x.supabase.co/rest/v1/x');
        let refused = null;
        try { await ops.fetch('https://x.supabase.co/rest/v1/x'); } catch (e) { refused = e.code; }
        expect(refused).toBe('ADMIN_ALLOWANCE');
        expect(sent).toBe(entry.J8_PARENT_OP_REQUESTS);
        expect(teardown.remaining('teardown')).toBe(teardownBefore);
        expect(teardownBefore > 0).toBe(true);
    });
});
