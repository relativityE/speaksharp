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
// Sam on b1f8323f, four fixes:
//   (1) the run's ONE create attempt is checked after cleanup: while it still blocks the next admission (no trusted, timely answer
//       for this reservation, or a created account whose cleanup is not complete), the run is HOLD (78), even when cleanup reads
//       zero. The entry never writes an answer itself: a UI signup gives the parent no trusted, timely answer to record;
//   (2) the receipt must name the parent's expected release, sit at a location that was empty before admission and be written
//       after the spec started, and the spec's own terminal outcome (exit 0 or 1, not killed) must name this admission, run and
//       attempt; a spec that exits 1 over an all-PASS receipt is HOLD;
//   (3) each readback result carries what the readback CLI itself checked (its own evidence line: release, journey, traffic,
//       stages, attempts) plus this run, attempt and create attempt, and J8.b's final-submit journey; a journey bound to two
//       legs is refused (HOLD);
//   (4) the spec, readback, coaching, evaluation and lookup calls each have a deadline, and teardown gets the real cleanup
//       budget (its lookup is cut off at it and the evidence records it as exhausted).
// The sealed packet and the live gate are unchanged: the plan keeps J8 behind `no-j8-harness-adapter` (limits.cjs NEVER_SATISFIED),
// and `main` refuses unless offline fixtures supply the spec, readback, evaluation and lookup. It never reads a credential.
// Every reason is content-free (no email, id or row).
const fs = require('node:fs');
const path = require('node:path');
const { AdmissionRefused, admitRun, beginRun, journeyCreateRecord, recordCreateAttempt, writeCleanupEvidence } = require('./cleanup-evidence.cjs');
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
const FINAL_SENT_ROW = 'J8.b: final feedback pair sent';
/**
 * Sam on b1f8323f (4): each call's own deadline. The spec's covers its 30-minute process bound; a journey's readback covers the
 * ingestion wait and three five-minute tries; cleanup is the whole teardown, lookup included.
 */
const DEADLINES = Object.freeze({ specMs: 32 * 60_000, readbackMs: 20 * 60_000, coachingMs: 20 * 60_000, evaluateMs: 2 * 60_000, cleanupMs: 5 * 60_000 });
const TIMED_OUT = Symbol('timed out');

/** `fn()` bounded by `ms`; past it, TIMED_OUT. A throw is a throw. */
async function within(ms, fn) {
    let timer;
    try { return await Promise.race([Promise.resolve().then(fn), new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), ms); })]); }
    finally { clearTimeout(timer); }
}
const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length
    && JSON.stringify(a.map(String).sort()) === JSON.stringify(b.map(String).sort());

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

/**
 * The receipt, only when it is J8's, for the parent's EXPECTED release, written at or after `notBeforeMs` (this spec run, at a
 * location that was empty before admission), and names THIS entry's attempt. Otherwise `{ fault }`.
 */
function readBoundReceipt(file, { attemptId, expectedRelease, notBeforeMs }) {
    if (typeof expectedRelease !== 'string' || !SHA.test(expectedRelease)) return { fault: 'the parent named no expected release' };
    let receipt;
    let written;
    try { written = fs.statSync(file).mtimeMs; receipt = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { fault: 'the J8 receipt is missing or unreadable' }; }
    if (!Number.isFinite(notBeforeMs) || !(written >= notBeforeMs)) return { fault: 'the receipt was not written by this spec run' };
    if (!receipt || typeof receipt !== 'object' || receipt.suite !== J8_SUITE) return { fault: 'the receipt is not the J8 suite\'s' };
    if (receipt.release !== expectedRelease) return { fault: 'the receipt is not for the parent\'s expected release' };
    if (receipt.meta?.runnerAttempt !== attemptId) return { fault: 'the receipt is not bound to this run\'s create attempt' };
    if (!Array.isArray(receipt.rows) || !Array.isArray(receipt.readback?.journeys)) return { fault: 'the receipt has no rows or readback bindings' };
    return { receipt };
}

/**
 * Why the spec's outcome is not a terminal outcome of THIS admission, run and attempt, or null. Exit 0 and 1 are terminal (1: a
 * test failed); a missing code, any other code, or a kill at the deadline is not.
 */
function specOutcomeFault(outcome, { admission, runId, runAttempt }) {
    if (outcome === TIMED_OUT) return 'the spec did not finish within its deadline';
    if (!outcome || typeof outcome !== 'object') return 'the spec reported no outcome';
    if (outcome.timedOut === true) return 'the spec was killed at its deadline';
    if (outcome.exitCode !== 0 && outcome.exitCode !== 1) return 'the spec has no terminal exit code';
    if (outcome.admissionFile !== admission.admissionFile || outcome.runId !== String(runId) || outcome.runAttempt !== String(runAttempt))
        return 'the spec outcome is not bound to this admission, run and attempt';
    return null;
}

const stagesOf = (j) => (Array.isArray(j?.stages) ? j.stages.map(String) : []);
const attemptsOf = (j) => (Array.isArray(j?.attemptIds) ? j.attemptIds.map(String) : []);

/**
 * One journey's readback, from what the readback CLI itself checked (Sam on b1f8323f (3)): QUALIFIED or FAIL only when the exit is
 * final AND its own evidence line agrees with it and names exactly the release, journey, canary traffic, stages and attempts the
 * entry asked for. Anything else is HOLD.
 */
function boundReadback(r, ask) {
    const status = r?.status;
    const e = r?.evidence;
    if (status !== 0 && status !== 3) return { verdict: 'HOLD', received: null };
    const want = status === 0 ? 'QUALIFIED' : 'FAIL';
    if (!e || typeof e !== 'object' || e.verdict !== want || e.release_sha !== ask.release || e.journey_id !== ask.journeyId || e.traffic_type !== 'canary'
        || !sameList(e.stages_declared, ask.stages) || !sameList(e.attempts_declared, ask.attemptIds)) return { verdict: 'HOLD', received: null };
    return { verdict: want, received: { release_sha: e.release_sha, journey_id: e.journey_id, boot_id: e.boot_id ?? null } };
}

/** Each leg's bound journeys from the receipt's own bindings row; null when one journey is bound to two legs (Sam on b1f8323f (3)). */
function legJourneyIds(receipt) {
    const row = receipt.rows.find((r) => r?.step === BINDINGS_ROW);
    const out = {};
    const seen = new Set();
    for (const leg of ['J8.a', 'J8.b', 'J8.c']) {
        out[leg] = String(row?.evidence?.[leg] ?? '').split(',').filter(Boolean);
        for (const id of out[leg]) { if (seen.has(id)) return null; seen.add(id); }
    }
    return out;
}

/**
 * RECEIVED. The receipt's bound journeys, each read back independently, plus J8.b's coaching-diagnostic chain anchored to the ONE
 * journey the receipt binds to J8.b. The result has rc-gates' readback-verdicts shape (so the reviewed finalizer validates it the
 * same way) plus its own binding: this run, attempt and create attempt, each journey's CLI evidence, and J8.b's final-submit
 * journey (only when the receipt's final submit row PASSes for that one journey).
 */
async function j8ReadbackVerdicts(receipt, { qualify, coaching }, { binding, deadlines = DEADLINES } = {}) {
    const journeys = [];
    const legs = legJourneyIds(receipt);
    for (const j of receipt.readback.journeys) {
        const ask = { journeyId: String(j.journeyId), stages: stagesOf(j), attemptIds: attemptsOf(j), firstDownload: j.firstDownload === true, release: receipt.release };
        let r = null;
        if (legs) { try { r = await within(deadlines.readbackMs, () => qualify(ask)); } catch { r = null; } }
        const { verdict, received } = boundReadback(r === TIMED_OUT ? null : r, ask);
        journeys.push({ journeyId: ask.journeyId, stages: ask.stages, attemptIds: ask.attemptIds, verdict, received });
    }
    const out = { suite: J8_SUITE, release: receipt.release, binding: binding ?? null, journeys,
        missingBindings: Array.isArray(receipt.readback.missingBindings) ? receipt.readback.missingBindings : [] };
    if (!legs) out.missingBindings = [...out.missingBindings, 'J8:duplicate_leg_journey'];
    const finalSent = receipt.rows.filter((r) => r?.step === FINAL_SENT_ROW);
    const bIds = legs ? legs['J8.b'] : [];
    out.finalSubmit = bIds.length === 1 && finalSent.length === 1 && finalSent[0].verdict === 'PASS' ? { journeyId: bIds[0] } : null;
    const chain = receipt.rows.find((r) => r?.step === CHAIN_ROW && typeof r.evidence?.expectedRequestSha256 === 'string');
    if (!chain) return out;
    const e = chain.evidence;
    const expectation = { requestSha256: e.expectedRequestSha256, attemptSha256: e.expectedAttemptSha256, product: e.expectedProduct,
        configuredModel: e.expectedConfiguredModel, outcome: e.expectedOutcome };
    const anchor = bIds.length === 1 && journeys.filter((j) => j.journeyId === bIds[0]).length === 1 ? bIds[0] : null;
    let result = null;
    if (anchor && typeof coaching === 'function') {
        try { result = await within(deadlines.coachingMs, () => coaching({ journeyId: anchor, expectation, release: receipt.release })); } catch { result = null; }
    }
    // Only the readback's own bound result is kept; anything else is an UNBOUND HOLD the finalizer can never settle a row from.
    const bound = result && result !== TIMED_OUT && ['PASS', 'FAIL', 'HOLD'].includes(result.verdict) && Array.isArray(result.reasons)
        && typeof result.release === 'string' && result.expected && typeof result.expected === 'object';
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
async function teardownJ8({ evidenceDir, admission, receipt, lookup, budgetMs = DEADLINES.cleanupMs, now = () => Date.now() }) {
    // Sam on b1f8323f (4): the real cleanup budget. The lookup is cut off at what is left of it, and the evidence records the
    // budget as exhausted once it has run out (so cleanup can never read complete past its own deadline).
    const deadlineAt = now() + budgetMs;
    const timedOut = () => now() >= deadlineAt;
    const unproven = [];
    const record = journeyCreateRecord(evidenceDir, admission.recordRunId, JOURNEY);
    const bound = !!record && record.sent.attemptId === admission.attemptId && record.sent.lookupRef === admission.local
        && record.sent.emailDomain === admission.domain;
    if (!bound) unproven.push('the run\'s create record is not this attempt\'s reservation');
    const specZero = !!receipt && receipt.rows.some((r) => r?.step === 'zero residue' && r.verdict === 'PASS')
        && !receipt.rows.some((r) => r?.step === 'zero residue' && r.verdict !== 'PASS');
    if (!specZero) unproven.push('the spec did not record its own zero residue');
    let found = null;
    if (bound && typeof lookup === 'function' && !timedOut()) {
        try { found = await within(Math.max(0, deadlineAt - now()), () => lookup({ email: admission.email, runOwnedPrefix: RUN_OWNED_PREFIX })); } catch { found = null; }
        if (found === TIMED_OUT) { found = null; unproven.push('the parent lookup did not finish within the cleanup budget'); }
    }
    const zero = found?.lookup === 'zero' && !timedOut();
    if (!zero) unproven.push('the parent lookup did not show the reserved account gone within the cleanup budget');
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
 * Sam on b1f8323f (1): whether this run's own records still block the next admission (its create attempt above all: no trusted,
 * timely answer, or a created account whose cleanup is not complete). Unreadable evidence blocks.
 */
function ownBlocks(evidenceDir, recordRunId) {
    let after;
    try { after = admitRun(evidenceDir); } catch { return ['the evidence could not be read after the run']; }
    if (!Array.isArray(after.blocking)) return after.admitted ? [] : [String(after.reason)];
    return after.blocking.filter((b) => b.startsWith(`${recordRunId}.`) || b.startsWith(`${recordRunId}:`));
}

/**
 * One J8 run: admission, the spec, the readback, the mapping, and cleanup always. `deps` (offline fixtures, or the live adapters in
 * j8-live-adapters.cjs plus `finalizerEvaluate`): runSpec({ env }) -> { exitCode, admissionFile, runId, runAttempt, timedOut };
 * qualify(...) -> { status, evidence }; coaching(...) -> bound result; evaluate(receipt, readback) -> { suite, release, errors, rows };
 * lookup({ email, runOwnedPrefix }) -> exactEmailLookup's result. Each is bounded by `deadlines`.
 * Exit: 0 every row PASS, cleanup complete AND the run's create attempt no longer blocks admission; 1 a row FAILed; 78 otherwise
 * (HOLD, refused or NOT RUN).
 */
async function runJ8Nightly({ evidenceDir, runDir, runId, runAttempt, configuredDomain, expectedRelease, deps, deadlines = DEADLINES, now = () => Date.now() }) {
    if (typeof expectedRelease !== 'string' || !SHA.test(expectedRelease))
        return { exitCode: 78, reason: 'HOLD: J8 not admitted, nothing sent: the parent named no expected release' };
    // Sam on b1f8323f (2): a fresh artifact location. A receipt already there could stand in for this run's, so nothing is sent.
    const receiptFile = path.join(runDir, 'test-results', 'rwt', RECEIPT_FILE);
    if (fs.existsSync(receiptFile)) return { exitCode: 78, reason: 'HOLD: J8 not admitted, nothing sent: the receipt location is not fresh' };
    let admission;
    try { admission = admitJ8({ evidenceDir, runId, runAttempt, configuredDomain, now }); }
    catch (e) { return { exitCode: 78, reason: `HOLD: J8 not admitted, nothing sent: ${String(e.message).slice(0, 200)}` }; }
    let receipt = null;
    let caseResult = holdAll('the spec did not run');
    let readback = null;
    let cleanup = null;
    try {
        // The file clock is the bound, so the spec's start is taken from it (floored to the second some filesystems keep).
        const specStart = Math.floor(Date.now() / 1000) * 1000;
        let outcome = null;
        try {
            outcome = await within(deadlines.specMs, () => deps.runSpec({ env: { RWT_J8_RUNNER_ADMISSION: admission.admissionFile, GITHUB_RUN_ID: String(runId),
                GITHUB_RUN_ATTEMPT: String(runAttempt), LIVE_TEST_EMAIL_DOMAIN: admission.domain } }));
        } catch { outcome = null; }
        const specFault = specOutcomeFault(outcome, { admission, runId, runAttempt });
        const read = specFault ? { fault: specFault } : readBoundReceipt(receiptFile, { attemptId: admission.attemptId, expectedRelease, notBeforeMs: specStart });
        if (read.fault) caseResult = holdAll(read.fault);
        else if (outcome.exitCode === 1 && read.receipt.rows.every((r) => r?.verdict === 'PASS')) caseResult = holdAll('the spec failed but its receipt shows no failing row');
        else {
            receipt = read.receipt;
            readback = await j8ReadbackVerdicts(receipt, deps, { binding: { runId: String(runId), runAttempt: String(runAttempt), createAttempt: admission.attemptId }, deadlines });
            let evaluated = null;
            try { evaluated = await within(deadlines.evaluateMs, () => deps.evaluate(receipt, readback)); } catch { evaluated = null; }
            caseResult = j8CaseResult(receipt, readback, evaluated === TIMED_OUT ? null : evaluated);
        }
    } finally {
        cleanup = await teardownJ8({ evidenceDir, admission, receipt, lookup: deps.lookup, budgetMs: deadlines.cleanupMs, now });
    }
    const blocks = ownBlocks(evidenceDir, admission.recordRunId);
    const createJournal = blocks.length === 0 ? 'resolved' : 'unresolved';
    const results = caseResult.assertions.map((a) => a.result);
    const exitCode = results.includes('FAIL') ? 1
        : results.every((r) => r === 'PASS') && cleanup.cleanup === 'complete' && createJournal === 'resolved' ? 0 : 78;
    return { exitCode, caseResult, readback, cleanup: { result: cleanup.cleanup, reasons: cleanup.incompleteReasons }, createJournal, blocks };
}

/**
 * CLI. Explicit key/value arguments only; LIVE_TEST_EMAIL_DOMAIN from the parent. The live gate is unchanged: without offline
 * fixtures for the spec, readback, evaluation and lookup it refuses (78) before admission, so nothing is recorded or sent.
 */
async function main(argv, env = process.env, deps = {}) {
    const ALLOWED = ['--evidence-dir', '--run-dir', '--run-id', '--run-attempt', '--release-sha', '--execute'];
    const a = {};
    if (argv.length % 2) return { exitCode: 78, reason: 'BLOCKED_SETUP: explicit key/value arguments required' };
    for (let i = 0; i < argv.length; i += 2) {
        if (!ALLOWED.includes(argv[i]) || argv[i] in a) return { exitCode: 78, reason: `BLOCKED_SETUP: unknown or repeated argument ${String(argv[i]).slice(0, 40)}` };
        a[argv[i]] = argv[i + 1];
    }
    if (ALLOWED.some((k) => typeof a[k] !== 'string' || !a[k]) || a['--execute'] !== 'true')
        return { exitCode: 78, reason: 'BLOCKED_SETUP: --evidence-dir, --run-dir, --run-id, --run-attempt, --release-sha and --execute true are required' };
    if (!env.LIVE_TEST_EMAIL_DOMAIN) return { exitCode: 78, reason: 'BLOCKED_SETUP: LIVE_TEST_EMAIL_DOMAIN is not set in the parent' };
    if (['runSpec', 'qualify', 'evaluate', 'lookup'].some((k) => typeof deps[k] !== 'function'))
        return { exitCode: 78, reason: 'HOLD: no offline spec, readback, evaluation and lookup fixtures; the J8 live gate is closed (no-j8-harness-adapter)' };
    return runJ8Nightly({ evidenceDir: a['--evidence-dir'], runDir: a['--run-dir'], runId: a['--run-id'], runAttempt: a['--run-attempt'],
        configuredDomain: env.LIVE_TEST_EMAIL_DOMAIN, expectedRelease: a['--release-sha'], deps });
}

if (require.main === module) main(process.argv.slice(2)).then((r) => { if (r.reason) console.error(r.reason); process.exitCode = r.exitCode; });
module.exports = {
    DEADLINES, LOCAL_PREFIX, READBACK_STAGES, RECEIPT_FILE, SIGNUP_DEADLINE_MS, SIGNUP_LEG, admitJ8, finalizerEvaluate, holdAll, j8CaseResult, j8ReadbackVerdicts, j8Reservation,
    main, ownBlocks, readBoundReceipt, recordRunIdFor, runJ8Nightly, specOutcomeFault, teardownJ8,
};
