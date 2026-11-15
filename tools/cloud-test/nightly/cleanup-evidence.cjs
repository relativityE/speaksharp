"use strict";
// Nightly AHT suite: durable cleanup evidence and the admission gate that reads it (#1864 2a40e87 §6, Sam's #1865
// review). Teardown is never silently skipped:
//   - `beginRun` records, before anything is sent, that a run has started and which journeys it must account for. A
//     runner killed outright never writes its evidence, so the start record alone keeps the next run out.
//   - `writeCleanupEvidence` records, per journey, what was left (accounts, sessions, leases, fences, Checkout
//     Sessions) and what was done to each. Cleanup is complete only when nothing is left; a cleanup reserve that ran
//     out, a step that failed or an account whose id was never captured leaves it incomplete.
//   - `admitRun` refuses the next run while any earlier run is unfinished (started with no evidence) or incomplete,
//     until `recordRecovery` notes that the protected recovery route has dealt with it.
// The files hold opaque references the harness chooses (never an email, a uid in clear, a token or a bearer URL), are
// written to a temporary name, flushed, and linked into place (never over an existing record), so a reader sees all
// of a record or none of it.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { JOURNEYS } = require('./journey-plan.cjs');
const { isCount } = require('./counts.cjs');

const RESOURCE_KINDS = Object.freeze(['account', 'session', 'lease', 'feedback-fence', 'checkout-session', 'page']);
const VERIFICATION_KINDS = Object.freeze(['zero-residue', 'nothing-created']);

/**
 * Why a journey's cleanup is not proven complete, or [] when it is (Codex P1 on 4abcb42f, AGENTS.md "cleanup is proven
 * only when a post-cleanup scoped query returns zero"). An attempt is not proof: completion needs an observed
 * verification, recorded by the harness after its cleanup steps:
 *   - `zero-residue`: one or more scoped residue queries `{ kind, scope, count }`, every count an observed whole number
 *     and zero, with a query for every resource kind the journey cleaned up or left; or
 *   - `nothing-created`: the journey created nothing to clean, so it records no step and nothing left.
 * Missing verification, an unobserved count, a non-zero count, an unqueried kind or a contradictory claim leaves the
 * journey incomplete, so `admitRun` refuses the next run until a recovery is recorded.
 *
 * `created` (when given) is what the RUNNER recorded creating or attempting to create, before the send (Sam, 14 Nov:
 * an omitted resource must not look clean). It binds the teardown's own report: every created resource needs a
 * completed cleanup step for that exact resource, the residue verification must query every created kind, and
 * `nothing-created` is refused when anything was created.
 */
function unprovenCleanup(j) {
    const reasons = [];
    if (j.reserveExhausted)
        reasons.push('cleanup reserve exhausted');
    if (j.left.length > 0)
        reasons.push(`${j.left.length} resource(s) left behind`);
    if (j.steps.some((s) => s.outcome !== 'done'))
        reasons.push('a cleanup step did not complete');
    const created = j.created ?? [];
    for (const r of created) {
        if (!j.steps.some((s) => s.kind === r.kind && s.ref === r.ref && s.outcome === 'done'))
            reasons.push(`created ${r.kind} ${r.ref} has no completed cleanup step`);
    }
    const v = j.verification;
    if (v === undefined) {
        reasons.push('no residue verification recorded');
    }
    else if (v.kind === 'nothing-created') {
        if (j.steps.length > 0 || j.left.length > 0)
            reasons.push('nothing-created claimed, but cleanup steps or leftovers were recorded');
        if (created.length > 0)
            reasons.push(`nothing-created claimed, but the runner recorded creating ${created.length} resource(s)`);
    }
    else {
        if (v.queries.length === 0)
            reasons.push('zero-residue verification ran no query');
        for (const q of v.queries) {
            if (!isCount(q.count))
                reasons.push(`residue count for ${q.kind} ${q.scope} was not observed`);
            else if (q.count !== 0)
                reasons.push(`residue query for ${q.kind} ${q.scope} found ${q.count}`);
        }
        const queried = new Set(v.queries.map((q) => q.kind));
        for (const kind of new Set([...j.steps, ...j.left, ...created].map((r) => r.kind))) {
            if (!queried.has(kind))
                reasons.push(`no residue query for ${kind}`);
        }
    }
    return reasons;
}
const RUN_ID = /^[A-Za-z0-9._-]{1,80}$/;
const REF = /^[A-Za-z0-9._:-]{1,120}$/;
const runFile = (dir, runId, kind) => path.join(dir, `${runId}.${kind}.json`);

/**
 * Write-once: the record goes to a temporary file, is flushed, then hard-linked to its name, which fails if the name
 * exists (rename would silently replace it). The directory is flushed too, so the new name survives a crash.
 */
function durableWrite(file, doc) {
    const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    const fd = fs.openSync(tmp, 'wx');
    try {
        fs.writeSync(fd, `${JSON.stringify(doc, null, 1)}\n`);
        fs.fsyncSync(fd);
    }
    finally {
        fs.closeSync(fd);
    }
    try {
        fs.linkSync(tmp, file);
    }
    catch (e) {
        if (e.code === 'EEXIST')
            throw new Error(`${path.basename(file)} already exists; evidence is never overwritten`);
        throw e;
    }
    finally {
        fs.rmSync(tmp, { force: true });
    }
    const dfd = fs.openSync(path.dirname(file), 'r');
    try {
        fs.fsyncSync(dfd);
    }
    finally {
        fs.closeSync(dfd);
    }
}
const checkRunId = (runId) => {
    if (typeof runId !== 'string' || !RUN_ID.test(runId))
        throw new Error('a run id is letters, digits, dot, dash or underscore');
};

/** A run that admission refused: nothing was recorded and nothing may be sent. */
class AdmissionRefused extends Error {
}
const ADMISSION_LOCK = 'admission.lock';
/**
 * Admits the run and records that it has started, as one step under an exclusive lock, so two runners started at the
 * same moment can't both be admitted: the second sees the first's start record and is refused. It records which
 * journeys the run must account for on cleanup (the journeys with a cleanup reserve in its budget plan:
 * `Object.keys(budget.plan().cleanup)`). Call it before the first send. A lock left by a runner killed inside this step
 * refuses every later run (fail closed) until someone who has checked no runner is admitting removes it.
 */
function beginRun(dir, runId, journeys, at = new Date().toISOString()) {
    checkRunId(runId);
    const known = new Set(JOURNEYS.map((j) => j.id));
    if (!Array.isArray(journeys) || !journeys.every((j) => known.has(j)) || new Set(journeys).size !== journeys.length)
        throw new Error('beginRun needs the run\'s journeys, each once');
    const lock = path.join(dir, ADMISSION_LOCK);
    let fd;
    try {
        fd = fs.openSync(lock, 'wx');
    }
    catch (e) {
        if (e.code === 'EEXIST')
            throw new AdmissionRefused(`another runner holds ${ADMISSION_LOCK} (or one was killed holding it): admission refused`);
        if (e.code === 'ENOENT')
            throw new AdmissionRefused('the cleanup evidence directory is missing; admission cannot tell what earlier runs left');
        throw e;
    }
    try {
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, runId }));
        const a = admitRun(dir);
        if (!a.admitted)
            throw new AdmissionRefused(a.reason);
        durableWrite(runFile(dir, runId, 'started'), { runId, startedAt: at, journeys: [...journeys].sort() });
        return a;
    }
    finally {
        fs.closeSync(fd);
        fs.rmSync(lock, { force: true });
    }
}
/**
 * Writes the run's cleanup evidence, once. `journeys` is [{ journey, reserveExhausted, steps: [{ kind, ref, action,
 * outcome: 'done' | 'failed' | 'not attempted' }], left: [{ kind, ref }], verification: { kind: 'zero-residue',
 * queries: [{ kind, scope, count }] } | { kind: 'nothing-created' } }], one entry for each journey the start
 * record names: evidence that leaves one out, or adds one, is refused rather than read as complete. `cleanupExhausted`
 * (journey => boolean, the run budget's own `cleanupExhausted`) is required, so a reserve that ran out marks the
 * journey incomplete whatever the caller says. A malformed entry is refused rather than written, because evidence
 * that can't be read can't be recovered from.
 */
function writeCleanupEvidence(dir, runId, journeys, { cleanupExhausted, runFaults = [], at = new Date().toISOString() } = {}) {
    checkRunId(runId);
    if (typeof cleanupExhausted !== 'function')
        throw new Error('cleanup evidence needs the run budget\'s cleanupExhausted');
    // A fault of the whole run (the budget journal torn or unreadable) can hide an unrecorded send, so no journey's
    // cleanup is proven complete under it, whatever its own record says.
    if (!Array.isArray(runFaults) || !runFaults.every((f) => typeof f === 'string' && f.length > 0))
        throw new Error('runFaults must be a list of reasons');
    let started;
    try {
        started = JSON.parse(fs.readFileSync(runFile(dir, runId, 'started'), 'utf8'));
    }
    catch {
        throw new Error(`run ${runId} has no readable start record`);
    }
    if (!Array.isArray(journeys))
        throw new Error('journeys must be a list');
    const known = new Set(JOURNEYS.map((j) => j.id));
    const res = (r) => r && RESOURCE_KINDS.includes(r.kind) && typeof r.ref === 'string' && REF.test(r.ref);
    for (const j of journeys) {
        if (!known.has(j?.journey) || typeof j.reserveExhausted !== 'boolean' || !Array.isArray(j.steps) || !Array.isArray(j.left))
            throw new Error(`malformed cleanup evidence for ${j?.journey}`);
        if (!j.steps.every((s) => res(s) && typeof s.action === 'string' && ['done', 'failed', 'not attempted'].includes(s.outcome)))
            throw new Error(`${j.journey}: a cleanup step is malformed`);
        if (!j.left.every(res))
            throw new Error(`${j.journey}: a resource left behind is malformed`);
        if (j.unproven !== undefined && (!Array.isArray(j.unproven) || !j.unproven.every((r) => typeof r === 'string' && r.length > 0)))
            throw new Error(`${j.journey}: unproven reasons are malformed`);
        if (j.created !== undefined && (!Array.isArray(j.created) || !j.created.every(res)))
            throw new Error(`${j.journey}: a created resource is malformed`);
        const v = j.verification;
        if (v !== undefined && (!v || typeof v !== 'object' || !VERIFICATION_KINDS.includes(v.kind)
            || (v.kind === 'zero-residue' && (!Array.isArray(v.queries)
                || !v.queries.every((q) => q && RESOURCE_KINDS.includes(q.kind) && typeof q.scope === 'string' && REF.test(q.scope))))))
            throw new Error(`${j.journey}: the residue verification is malformed`);
    }
    const named = journeys.map((j) => j.journey).sort();
    if (JSON.stringify(named) !== JSON.stringify(started.journeys))
        throw new Error(`cleanup evidence names ${named.join(', ') || 'no journey'}, but the run started with ${(started.journeys ?? []).join(', ') || 'none'}`);
    const checked = journeys.map((j) => ({ ...j, reserveExhausted: j.reserveExhausted || cleanupExhausted(j.journey) !== false }));
    const reasons = Object.fromEntries(checked.map((j) => [j.journey, [...runFaults, ...(j.unproven ?? []), ...unprovenCleanup(j)]]).filter(([, r]) => r.length > 0));
    const incomplete = checked.filter((j) => reasons[j.journey]);
    const doc = {
        runId, writtenAt: at, cleanup: incomplete.length > 0 ? 'incomplete' : 'complete',
        incompleteJourneys: incomplete.map((j) => j.journey), incompleteReasons: reasons, journeys: checked,
    };
    durableWrite(runFile(dir, runId, 'cleanup'), doc);
    return doc;
}
/** Notes that the protected recovery route dealt with what a run left. `ref` names that recovery run. */
function recordRecovery(dir, runId, ref, at = new Date().toISOString()) {
    checkRunId(runId);
    if (typeof ref !== 'string' || !REF.test(ref))
        throw new Error('a recovery needs the reference of the recovery run');
    if (!fs.existsSync(runFile(dir, runId, 'started')))
        throw new Error(`run ${runId} never started; there is nothing to recover`);
    durableWrite(runFile(dir, runId, 'recovered'), { runId, recoveredAt: at, by: ref });
}
// ---------------------------------------------------------------------------------------------------------------
// Account-create attempts (Sam, 15 Nov, #1867). The started marker blocks admission after a crash, but alone it cannot name
// the account to recover. So every account-create request is recorded, durably and before it is sent, with a non-secret
// lookup reference for the account it may create. If that write fails, nothing is sent. An attempt that was never answered
// (throw, timeout, restart) stays unresolved, and admission stays refused until a recovery proves, for that exact account,
// that the request can no longer complete and that nothing of it is left. A run-level recovery marker never clears it.

/** The longest an account-create request may stay in flight: its transport deadline must fit inside this bound. */
const LATE_COMPLETION_BOUND_MS = 5 * 60_000;
const ATTEMPT_ID = /^[A-Za-z0-9._-]{1,60}$/;
const attemptFile = (dir, runId, attemptId, state) => path.join(dir, `${runId}.attempt.${attemptId}.${state}.json`);
const ATTEMPT_SENT = '.sent.json';

/** Records an account-create attempt before it is sent. Throws (and the caller sends nothing) if it can't be recorded. */
function recordCreateAttempt(dir, runId, { attemptId, leg, lookupRef, transportDeadlineMs }, at = new Date().toISOString()) {
    checkRunId(runId);
    if (typeof attemptId !== 'string' || !ATTEMPT_ID.test(attemptId))
        throw new Error('an attempt id is letters, digits, dot, dash or underscore');
    if (typeof leg !== 'string' || !ATTEMPT_ID.test(leg))
        throw new Error('an attempt names the leg that owns it');
    if (typeof lookupRef !== 'string' || !REF.test(lookupRef))
        throw new Error('an account-create attempt needs a non-secret lookup reference for the account it may create');
    if (!Number.isInteger(transportDeadlineMs) || transportDeadlineMs <= 0 || transportDeadlineMs > LATE_COMPLETION_BOUND_MS)
        throw new Error(`an account-create attempt needs a transport deadline within ${LATE_COMPLETION_BOUND_MS} ms`);
    if (!fs.existsSync(runFile(dir, runId, 'started')))
        throw new Error(`run ${runId} was never admitted; nothing may be sent`);
    durableWrite(attemptFile(dir, runId, attemptId, 'sent'), { runId, attemptId, leg, kind: 'account', lookupRef, transportDeadlineMs, recordedAt: at });
}
/** The attempt got an answer (created, or refused by the server): the run's own cleanup evidence then governs it. */
function answerCreateAttempt(dir, runId, attemptId, at = new Date().toISOString()) {
    const sent = readAttempt(attemptFile(dir, runId, attemptId, 'sent'));
    if (!sent)
        throw new Error(`attempt ${attemptId} of run ${runId} was never recorded`);
    durableWrite(attemptFile(dir, runId, attemptId, 'answered'), { runId, attemptId, answeredAt: at });
}
function readAttempt(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    catch {
        return null;
    }
}
/**
 * Why a recovery proof does not clear `sent`, or null when it does: it must name the attempt's own lookup reference, be
 * observed after the request could still have completed, and show a zero count, scoped to that exact account, for the
 * account itself and for every other query it gives. A bare marker, an unrelated account or an early zero is refused.
 */
function attemptRecoveryFault(sent, proof) {
    if (!proof || typeof proof !== 'object')
        return 'no recovery proof';
    if (proof.lookupRef !== sent.lookupRef)
        return 'the recovery proof names another account';
    const observed = Date.parse(proof.observedAt);
    const recorded = Date.parse(sent.recordedAt);
    if (!Number.isFinite(observed) || !Number.isFinite(recorded) || observed < recorded + LATE_COMPLETION_BOUND_MS)
        return 'the zero-residue observation was taken while the request could still complete';
    const queries = Array.isArray(proof.queries) ? proof.queries : [];
    if (!queries.some((q) => q && q.kind === 'account'))
        return 'the recovery proof does not query the account itself';
    if (!queries.every((q) => q && RESOURCE_KINDS.includes(q.kind) && q.scope === sent.lookupRef && isCount(q.count) && q.count === 0))
        return 'the recovery proof is not a zero count scoped to the attempted account';
    return null;
}
/** Records the protected recovery of one unanswered attempt. Refuses (writes nothing) unless the proof clears it. */
function recordAttemptRecovery(dir, runId, attemptId, proof, at = new Date().toISOString()) {
    checkRunId(runId);
    const sent = readAttempt(attemptFile(dir, runId, attemptId, 'sent'));
    if (!sent)
        throw new Error(`attempt ${attemptId} of run ${runId} was never recorded; there is nothing to recover`);
    const fault = attemptRecoveryFault(sent, proof);
    if (fault)
        throw new Error(`attempt ${attemptId} not recovered: ${fault}`);
    durableWrite(attemptFile(dir, runId, attemptId, 'recovered'), { runId, attemptId, recoveredAt: at, proof });
}
/**
 * The attempts that still block admission: an attempt is cleared only by a recovery proof re-checked here, or by an answer
 * together with its run's complete cleanup evidence. A run-level recovery marker never clears an attempt.
 */
function blockingAttempts(dir, names) {
    const blocking = [];
    for (const n of names.filter((x) => x.includes('.attempt.') && x.endsWith(ATTEMPT_SENT))) {
        const stem = n.slice(0, -ATTEMPT_SENT.length);
        const sent = readAttempt(path.join(dir, n));
        if (!sent) {
            blocking.push(`${stem}: account-create attempt record unreadable`);
            continue;
        }
        if (names.includes(`${stem}.recovered.json`)) {
            const rec = readAttempt(path.join(dir, `${stem}.recovered.json`));
            const fault = attemptRecoveryFault(sent, rec?.proof);
            if (!fault)
                continue;
            blocking.push(`${stem}: recovery not accepted (${fault})`);
            continue;
        }
        if (names.includes(`${stem}.answered.json`)) {
            const cleanup = readAttempt(path.join(dir, `${sent.runId}.cleanup.json`));
            if (cleanup?.cleanup === 'complete')
                continue;
            blocking.push(`${stem}: answered, but its run's cleanup is not proven complete`);
            continue;
        }
        blocking.push(`${stem}: account-create attempt never answered; recover that exact account first`);
    }
    return blocking;
}

/**
 * Admission: the next run is refused while any started run has no cleanup evidence (killed, or still running) or
 * incomplete cleanup, unless its recovery is recorded. Evidence that can't be read refuses too. An account-create attempt
 * blocks on its own terms (`blockingAttempts`), whatever the run's recovery marker says.
 */
function admitRun(dir) {
    let names;
    try {
        names = fs.readdirSync(dir);
    }
    catch (e) {
        if (e.code === 'ENOENT')
            return { admitted: false, reason: 'the cleanup evidence directory is missing; admission cannot tell what earlier runs left' };
        throw e;
    }
    const blocking = [];
    for (const n of names.filter((x) => x.endsWith('.started.json'))) {
        const runId = n.slice(0, -'.started.json'.length);
        if (names.includes(`${runId}.recovered.json`))
            continue;
        if (!names.includes(`${runId}.cleanup.json`)) {
            blocking.push(`${runId}: started with no cleanup evidence (killed or still running)`);
            continue;
        }
        let doc;
        try {
            doc = JSON.parse(fs.readFileSync(path.join(dir, `${runId}.cleanup.json`), 'utf8'));
        }
        catch {
            blocking.push(`${runId}: cleanup evidence unreadable`);
            continue;
        }
        if (doc.cleanup !== 'complete')
            blocking.push(`${runId}: cleanup incomplete (${(doc.incompleteJourneys ?? []).join(', ') || 'unknown'})`);
    }
    blocking.push(...blockingAttempts(dir, names));
    return blocking.length > 0
        ? { admitted: false, reason: `earlier runs must be recovered first: ${blocking.join('; ')}`, blocking }
        : { admitted: true, reason: 'every earlier run cleaned up or was recovered', blocking };
}

module.exports = {
    ADMISSION_LOCK, AdmissionRefused, LATE_COMPLETION_BOUND_MS, RESOURCE_KINDS, VERIFICATION_KINDS, admitRun, answerCreateAttempt, beginRun,
    recordAttemptRecovery, recordCreateAttempt, recordRecovery, unprovenCleanup, writeCleanupEvidence,
};
