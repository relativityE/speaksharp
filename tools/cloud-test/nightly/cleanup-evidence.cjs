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

const RESOURCE_KINDS = Object.freeze(['account', 'session', 'lease', 'feedback-fence', 'checkout-session', 'page']);
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
 * outcome: 'done' | 'failed' | 'not attempted' }], left: [{ kind, ref }] }], one entry for each journey the start
 * record names: evidence that leaves one out, or adds one, is refused rather than read as complete. `cleanupExhausted`
 * (journey => boolean, the run budget's own `cleanupExhausted`) is required, so a reserve that ran out marks the
 * journey incomplete whatever the caller says. A malformed entry is refused rather than written, because evidence
 * that can't be read can't be recovered from.
 */
function writeCleanupEvidence(dir, runId, journeys, { cleanupExhausted, at = new Date().toISOString() } = {}) {
    checkRunId(runId);
    if (typeof cleanupExhausted !== 'function')
        throw new Error('cleanup evidence needs the run budget\'s cleanupExhausted');
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
    }
    const named = journeys.map((j) => j.journey).sort();
    if (JSON.stringify(named) !== JSON.stringify(started.journeys))
        throw new Error(`cleanup evidence names ${named.join(', ') || 'no journey'}, but the run started with ${(started.journeys ?? []).join(', ') || 'none'}`);
    const checked = journeys.map((j) => ({ ...j, reserveExhausted: j.reserveExhausted || cleanupExhausted(j.journey) !== false }));
    const incomplete = checked.filter((j) => j.reserveExhausted || j.left.length > 0 || j.steps.some((s) => s.outcome !== 'done'));
    const doc = {
        runId, writtenAt: at, cleanup: incomplete.length > 0 ? 'incomplete' : 'complete',
        incompleteJourneys: incomplete.map((j) => j.journey), journeys: checked,
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
/**
 * Admission: the next run is refused while any started run has no cleanup evidence (killed, or still running) or
 * incomplete cleanup, unless its recovery is recorded. Evidence that can't be read refuses too.
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
    return blocking.length > 0
        ? { admitted: false, reason: `earlier runs must be recovered first: ${blocking.join('; ')}`, blocking }
        : { admitted: true, reason: 'every earlier run cleaned up or was recovered', blocking };
}

module.exports = { ADMISSION_LOCK, AdmissionRefused, RESOURCE_KINDS, admitRun, beginRun, recordRecovery, writeCleanupEvidence };
