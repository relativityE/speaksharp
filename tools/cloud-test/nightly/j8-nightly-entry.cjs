'use strict';
// J8 nightly entry (Sam, 21 Nov: "use option 1: a dedicated nightly entry, not an rc-gates step that writes an admission file").
// The runner that owns the account lifecycle owns all of it, bound to ONE run and ONE attempt:
//   1. ADMISSION, before anything is sent: beginRun (refused while any earlier run or create attempt is unresolved), then the
//      journey's one account-create attempt recorded durably (recordCreateAttempt: one create per journey per run, restart-proof),
//      then the spec's admission record (`RWT_J8_RUNNER_ADMISSION`) naming this run, this attempt and the exact reserved email.
//      The spec (j8RunnerAdmission) signs up only with that email, and only for this run and attempt.
//   2. THE SPEC runs once. Its receipt is read only when it names this entry's own attempt (`meta.runnerAttempt`).
//   3. RECEIVED: each bound journey is read back independently (the PostHog readback, as rc-gates' readback step does), the
//      receipt is settled by the reviewed finalizer's automated half (scripts/rwt-automated-evaluation.mts), and the J8 mapping
//      (j8-receipt-mapping.cjs) takes each leg's received row from that readback only, never from the browser's sent events.
//   4. CLEANUP, always: bound to the same run's one create record and the same attempt; complete only with the spec's own zero
//      residue AND the parent's complete exact-email lookup finding no account.
// The sealed packet and the live gate are unchanged: the plan keeps J8 behind `no-j8-harness-adapter` (limits.cjs NEVER_SATISFIED),
// and `main` refuses unless offline fixtures supply the spec, readback, evaluation and lookup. It never reads a credential.
// Every reason is content-free (no email, id or row).
const fs = require('node:fs');
const path = require('node:path');
const { AdmissionRefused, beginRun, journeyCreateRecord, recordCreateAttempt, writeCleanupEvidence } = require('./cleanup-evidence.cjs');
const { J8_RECEIPT_MAP, J8_SUITE, mapJ8Receipt } = require('./j8-receipt-mapping.cjs');

const JOURNEY = 'J8';
/** The leg that signs the account up (J8.a opens the journey); the attempt is the journey's one create. */
const SIGNUP_LEG = 'J8.a';
/** The signup's own bound: the spec's signup step waits at most this long for the account (cleanup-evidence caps it at 5 min). */
const SIGNUP_DEADLINE_MS = 120_000;
/** The local part the run-owned generators mint for this journey, so interrupted-run recovery recognizes it (rwtInterruptedRunRecovery.ts). */
const LOCAL_PREFIX = 'rwt-journey-feedback-boundary-';
const RUN_OWNED_PREFIX = 'rwt-journey-';
const RECEIPT_FILE = `${J8_SUITE}.receipt.json`;
const READBACK_STAGES = Object.freeze(['share_feedback']);
const CHAIN_ROW = 'J8.b: feedback diagnostic chain';
const BINDINGS_ROW = 'J8 leg readback bindings';
const DIGITS = /^\d+$/;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const SHA = /^[0-9a-f]{40}$/;

const recordRunIdFor = (runId, runAttempt) => `j8-${runId}-${runAttempt}`;

/** The exact reserved email: `rwt-journey-feedback-boundary-<13-digit ms>-<run id>@<the run's fixed test domain>`. */
function j8Reservation({ runId, configuredDomain, nowMs }) {
    const domain = typeof configuredDomain === 'string' ? configuredDomain.toLowerCase() : '';
    if (!DIGITS.test(String(runId)) || !DOMAIN.test(domain)) throw new Error('the reservation needs a numeric run id and the run\'s fixed test domain');
    const ms = String(nowMs);
    if (!/^\d{13}$/.test(ms)) throw new Error('the reservation time is not a 13-digit millisecond clock');
    const local = `${LOCAL_PREFIX}${ms}-${runId}`;
    return { local, email: `${local}@${domain}`, domain };
}

/**
 * ADMISSION. Admits the run, records the journey's one create attempt, then writes the spec's admission record, in that order and
 * nothing else. Throws (with nothing sent) when any step is refused; an AdmissionRefused leaves no record at all.
 */
function admitJ8({ evidenceDir, runId, runAttempt, configuredDomain, now = () => Date.now() }) {
    if (!DIGITS.test(String(runId)) || !DIGITS.test(String(runAttempt))) throw new AdmissionRefused('the run id and run attempt must be whole numbers');
    const reservation = j8Reservation({ runId, configuredDomain, nowMs: now() });
    const recordRunId = recordRunIdFor(runId, runAttempt);
    const attemptId = recordRunId;
    beginRun(evidenceDir, recordRunId, [JOURNEY]);
    const recordedAt = new Date(now()).toISOString();
    recordCreateAttempt(evidenceDir, recordRunId, { attemptId, leg: SIGNUP_LEG, lookupRef: reservation.local, transportDeadlineMs: SIGNUP_DEADLINE_MS,
        emailDomain: reservation.domain }, recordedAt);
    const admissionFile = path.join(evidenceDir, `${recordRunId}.j8-admission.json`);
    // Written once, never overwritten: a second admission for this run and attempt is refused here too.
    fs.writeFileSync(admissionFile, `${JSON.stringify({ suite: J8_SUITE, runId: String(runId), runAttempt: String(runAttempt),
        createAttempt: { attemptId, lookupRef: reservation.email, recordedBeforeSend: true } })}\n`, { flag: 'wx' });
    return Object.freeze({ recordRunId, attemptId, admissionFile, recordedAt, ...reservation });
}

/** The receipt, only when it is J8's, for a real release, and names THIS entry's attempt. Otherwise `{ fault }`. */
function readBoundReceipt(file, { attemptId }) {
    let receipt;
    try { receipt = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { fault: 'the J8 receipt is missing or unreadable' }; }
    if (!receipt || typeof receipt !== 'object' || receipt.suite !== J8_SUITE) return { fault: 'the receipt is not the J8 suite\'s' };
    if (typeof receipt.release !== 'string' || !SHA.test(receipt.release)) return { fault: 'the receipt names no release' };
    if (receipt.meta?.runnerAttempt !== attemptId) return { fault: 'the receipt is not bound to this run\'s create attempt' };
    if (!Array.isArray(receipt.rows) || !Array.isArray(receipt.readback?.journeys)) return { fault: 'the receipt has no rows or readback bindings' };
    return { receipt };
}

const stagesOf = (j) => (Array.isArray(j?.stages) ? j.stages.map(String) : []);
const verdictOf = (rc) => (rc === 0 ? 'QUALIFIED' : rc === 3 ? 'FAIL' : 'HOLD');

/**
 * RECEIVED. The receipt's bound journeys, each read back independently (`qualify` is the readback CLI's exit code: 0 qualified,
 * 3 an observed received failure, anything else HOLD), plus J8.b's coaching-diagnostic chain anchored to the ONE journey the
 * receipt binds to J8.b. The result has rc-gates' readback-verdicts shape, so the reviewed finalizer validates it the same way.
 */
async function j8ReadbackVerdicts(receipt, { qualify, coaching }) {
    const journeys = [];
    for (const j of receipt.readback.journeys) {
        let rc = 1;
        try { rc = await qualify({ journeyId: String(j.journeyId), stages: stagesOf(j), attemptIds: Array.isArray(j.attemptIds) ? j.attemptIds : [],
            firstDownload: j.firstDownload === true, release: receipt.release }); } catch { rc = 1; }
        journeys.push({ journeyId: String(j.journeyId), stages: stagesOf(j), verdict: verdictOf(rc) });
    }
    const out = { suite: J8_SUITE, release: receipt.release, journeys, missingBindings: Array.isArray(receipt.readback.missingBindings) ? receipt.readback.missingBindings : [] };
    const chain = receipt.rows.find((r) => r?.step === CHAIN_ROW && typeof r.evidence?.expectedRequestSha256 === 'string');
    if (!chain) return out;
    const e = chain.evidence;
    const expectation = { requestSha256: e.expectedRequestSha256, attemptSha256: e.expectedAttemptSha256, product: e.expectedProduct,
        configuredModel: e.expectedConfiguredModel, outcome: e.expectedOutcome };
    const ids = String(receipt.rows.find((r) => r?.step === BINDINGS_ROW)?.evidence?.['J8.b'] ?? '').split(',').filter(Boolean);
    const anchor = ids.length === 1 && journeys.filter((j) => j.journeyId === ids[0]).length === 1 ? ids[0] : null;
    let result = null;
    if (anchor && typeof coaching === 'function') { try { result = await coaching({ journeyId: anchor, expectation, release: receipt.release }); } catch { result = null; } }
    // Only the readback's own bound result is kept; anything else is an UNBOUND HOLD the finalizer can never settle a row from.
    const bound = result && ['PASS', 'FAIL', 'HOLD'].includes(result.verdict) && Array.isArray(result.reasons) && typeof result.release === 'string'
        && result.expected && typeof result.expected === 'object';
    out.coachingDiagnostic = bound ? { verdict: result.verdict, reasons: result.reasons, release: result.release, expected: result.expected }
        : { verdict: 'HOLD', reasons: ['diagnostic_not_received'] };
    return out;
}

/**
 * The reviewed finalizer's automated half, run as its own process (scripts/rwt-automated-evaluation.mts): the receipt and readback
 * are written to `workDir` and read back by the same validation `pnpm rwt:finalize` applies. Anything unreadable is null (HOLD).
 */
function finalizerEvaluate(receipt, readback, { workDir, repoRoot = path.join(__dirname, '..', '..', '..') }) {
    const { spawnSync } = require('node:child_process');
    const receiptPath = path.join(workDir, 'j8-evaluation.receipt.json');
    const readbackPath = path.join(workDir, 'j8-evaluation.readback.json');
    fs.writeFileSync(receiptPath, JSON.stringify(receipt));
    fs.writeFileSync(readbackPath, JSON.stringify(readback));
    const r = spawnSync(path.join(repoRoot, 'node_modules', '.bin', 'tsx'), [path.join(repoRoot, 'scripts', 'rwt-automated-evaluation.mts'), receiptPath, readbackPath],
        { cwd: repoRoot, encoding: 'utf8', timeout: 60_000 });
    if (r.status !== 0) return null;
    try { return JSON.parse(String(r.stdout).trim().split('\n').pop()); } catch { return null; }
}

/** Every J8 plan row HOLD, with the reason: the receipt, its readback or its settlement cannot be trusted, so nothing is mapped. */
function holdAll(reason) {
    const assertions = [];
    for (const leg of Object.keys(J8_RECEIPT_MAP)) for (const row of Object.keys(J8_RECEIPT_MAP[leg])) {
        assertions.push({ id: row.startsWith('invariant:') || row.startsWith('new:') ? row.slice(row.indexOf(':') + 1) : row, leg, result: 'HOLD', sources: [reason] });
    }
    return { caseId: 'J8', assertions, unmapped: [] };
}

/**
 * The case result: the receipt settled by the reviewed finalizer (`evaluate` -> { errors, rows }) and mapped with the same readback.
 * Any evaluation error, or a settled body that is not this receipt's, is HOLD for every row.
 */
function j8CaseResult(receipt, readback, evaluated) {
    if (!evaluated || !Array.isArray(evaluated.errors) || !Array.isArray(evaluated.rows)) return holdAll('the receipt could not be settled');
    if (evaluated.errors.length > 0) return holdAll('the receipt or its readback failed validation');
    if (evaluated.suite !== receipt.suite || evaluated.release !== receipt.release) return holdAll('the settled rows are not this receipt\'s');
    return mapJ8Receipt({ ...receipt, rows: evaluated.rows }, readback);
}

/**
 * CLEANUP, bound to this run and attempt. The run's ONE create record must be this attempt, for this exact reserved local part and
 * domain; the spec's own `zero residue` row must PASS; and the parent's complete exact-email lookup must find no account. Anything
 * else leaves the journey incomplete (named), so admission stays closed. The create attempt itself is NOT cleared here: only a
 * validated answer or the protected recovery route clears it.
 */
async function teardownJ8({ evidenceDir, admission, receipt, lookup, timedOut = () => false }) {
    const unproven = [];
    const record = journeyCreateRecord(evidenceDir, admission.recordRunId, JOURNEY);
    const bound = !!record && record.sent.attemptId === admission.attemptId && record.sent.lookupRef === admission.local
        && record.sent.emailDomain === admission.domain;
    if (!bound) unproven.push('the run\'s create record is not this attempt\'s reservation');
    const specZero = !!receipt && receipt.rows.some((r) => r?.step === 'zero residue' && r.verdict === 'PASS')
        && !receipt.rows.some((r) => r?.step === 'zero residue' && r.verdict !== 'PASS');
    if (!specZero) unproven.push('the spec did not record its own zero residue');
    let found = null;
    if (bound && typeof lookup === 'function') { try { found = await lookup({ email: admission.email, runOwnedPrefix: RUN_OWNED_PREFIX }); } catch { found = null; } }
    const zero = found?.lookup === 'zero';
    if (!zero) unproven.push('the parent lookup did not show the reserved account gone');
    const ref = admission.local;
    return writeCleanupEvidence(evidenceDir, admission.recordRunId, [{
        journey: JOURNEY, reserveExhausted: false, created: [{ kind: 'account', ref }],
        steps: [{ kind: 'account', ref, action: 'run-owned delete by the J8 spec', outcome: specZero ? 'done' : 'failed' }],
        left: zero ? [] : [{ kind: 'account', ref }],
        ...(zero ? { verification: { kind: 'zero-residue', queries: [{ kind: 'account', scope: ref, count: 0 }] } } : {}),
        unproven,
    }], { cleanupExhausted: () => timedOut() });
}

/**
 * One J8 run: admission, the spec, the readback, the mapping, and cleanup always. `deps` (offline fixtures or, later, the reviewed
 * live adapters): runSpec({ env }) -> exit code; qualify(...) -> readback exit code; coaching(...) -> bound result; evaluate(receipt,
 * readback) -> { suite, release, errors, rows }; lookup({ email, runOwnedPrefix }) -> exactEmailLookup's result.
 * Exit: 0 every row PASS and cleanup complete; 1 a row FAILed; 78 otherwise (HOLD, refused or NOT RUN).
 */
async function runJ8Nightly({ evidenceDir, runDir, runId, runAttempt, configuredDomain, deps, now = () => Date.now() }) {
    let admission;
    try { admission = admitJ8({ evidenceDir, runId, runAttempt, configuredDomain, now }); }
    catch (e) { return { exitCode: 78, reason: `HOLD: J8 not admitted, nothing sent: ${String(e.message).slice(0, 200)}` }; }
    let receipt = null;
    let caseResult = holdAll('the spec did not run');
    let readback = null;
    let cleanup = null;
    try {
        try {
            await deps.runSpec({ env: { RWT_J8_RUNNER_ADMISSION: admission.admissionFile, GITHUB_RUN_ID: String(runId), GITHUB_RUN_ATTEMPT: String(runAttempt),
                LIVE_TEST_EMAIL_DOMAIN: admission.domain } });
        } catch { /* the receipt decides; a spec that wrote none is HOLD below */ }
        const read = readBoundReceipt(path.join(runDir, 'test-results', 'rwt', RECEIPT_FILE), { attemptId: admission.attemptId });
        if (read.fault) caseResult = holdAll(read.fault);
        else {
            receipt = read.receipt;
            readback = await j8ReadbackVerdicts(receipt, deps);
            let evaluated = null;
            try { evaluated = await deps.evaluate(receipt, readback); } catch { evaluated = null; }
            caseResult = j8CaseResult(receipt, readback, evaluated);
        }
    } finally {
        cleanup = await teardownJ8({ evidenceDir, admission, receipt, lookup: deps.lookup });
    }
    const results = caseResult.assertions.map((a) => a.result);
    const exitCode = results.includes('FAIL') ? 1 : results.every((r) => r === 'PASS') && cleanup.cleanup === 'complete' ? 0 : 78;
    return { exitCode, caseResult, readback, cleanup: { result: cleanup.cleanup, reasons: cleanup.incompleteReasons } };
}

/**
 * CLI. Explicit key/value arguments only; LIVE_TEST_EMAIL_DOMAIN from the parent. The live gate is unchanged: without offline
 * fixtures for the spec, readback, evaluation and lookup it refuses (78) before admission, so nothing is recorded or sent.
 */
async function main(argv, env = process.env, deps = {}) {
    const ALLOWED = ['--evidence-dir', '--run-dir', '--run-id', '--run-attempt', '--execute'];
    const a = {};
    if (argv.length % 2) return { exitCode: 78, reason: 'BLOCKED_SETUP: explicit key/value arguments required' };
    for (let i = 0; i < argv.length; i += 2) {
        if (!ALLOWED.includes(argv[i]) || argv[i] in a) return { exitCode: 78, reason: `BLOCKED_SETUP: unknown or repeated argument ${String(argv[i]).slice(0, 40)}` };
        a[argv[i]] = argv[i + 1];
    }
    if (ALLOWED.some((k) => typeof a[k] !== 'string' || !a[k]) || a['--execute'] !== 'true')
        return { exitCode: 78, reason: 'BLOCKED_SETUP: --evidence-dir, --run-dir, --run-id, --run-attempt and --execute true are required' };
    if (!env.LIVE_TEST_EMAIL_DOMAIN) return { exitCode: 78, reason: 'BLOCKED_SETUP: LIVE_TEST_EMAIL_DOMAIN is not set in the parent' };
    if (['runSpec', 'qualify', 'evaluate', 'lookup'].some((k) => typeof deps[k] !== 'function'))
        return { exitCode: 78, reason: 'HOLD: no offline spec, readback, evaluation and lookup fixtures; the J8 live gate is closed (no-j8-harness-adapter)' };
    return runJ8Nightly({ evidenceDir: a['--evidence-dir'], runDir: a['--run-dir'], runId: a['--run-id'], runAttempt: a['--run-attempt'],
        configuredDomain: env.LIVE_TEST_EMAIL_DOMAIN, deps });
}

if (require.main === module) main(process.argv.slice(2)).then((r) => { if (r.reason) console.error(r.reason); process.exitCode = r.exitCode; });
module.exports = {
    LOCAL_PREFIX, READBACK_STAGES, RECEIPT_FILE, SIGNUP_DEADLINE_MS, SIGNUP_LEG, admitJ8, finalizerEvaluate, holdAll, j8CaseResult, j8ReadbackVerdicts, j8Reservation,
    main, readBoundReceipt, recordRunIdFor, runJ8Nightly, teardownJ8,
};
