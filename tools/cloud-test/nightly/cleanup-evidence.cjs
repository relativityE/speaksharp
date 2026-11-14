"use strict";
// Nightly AHT suite: durable cleanup evidence and the admission gate that reads it (#1864 2a40e87 §6, Sam's #1865
// review). Teardown is never silently skipped:
//   - `beginRun` records, before anything is sent, that a run has started. A runner killed outright never writes its
//     evidence, so the start record alone keeps the next run out.
//   - `writeCleanupEvidence` records, per journey, what was left (accounts, sessions, leases, fences, Checkout
//     Sessions) and what was done to each. Cleanup is complete only when nothing is left; a cleanup reserve that ran
//     out, a step that failed or an account whose id was never captured leaves it incomplete.
//   - `admitRun` refuses the next run while any earlier run is unfinished (started with no evidence) or incomplete,
//     until `recordRecovery` notes that the protected recovery route has dealt with it.
// The files hold opaque references the harness chooses (never an email, a uid in clear, a token or a bearer URL), are
// written to a temporary name, flushed, and renamed into place, so a reader sees all of a record or none of it.
const fs = require('node:fs');
const path = require('node:path');
const { JOURNEYS } = require('./journey-plan.cjs');

const RESOURCE_KINDS = Object.freeze(['account', 'session', 'lease', 'feedback-fence', 'checkout-session', 'page']);
const RUN_ID = /^[A-Za-z0-9._-]{1,80}$/;
const REF = /^[A-Za-z0-9._:-]{1,120}$/;
const runFile = (dir, runId, kind) => path.join(dir, `${runId}.${kind}.json`);

function durableWrite(file, doc, { exclusive = true } = {}) {
    const tmp = `${file}.${process.pid}.tmp`;
    const fd = fs.openSync(tmp, 'wx');
    try {
        fs.writeSync(fd, `${JSON.stringify(doc, null, 1)}\n`);
        fs.fsyncSync(fd);
    }
    finally {
        fs.closeSync(fd);
    }
    if (exclusive && fs.existsSync(file)) {
        fs.rmSync(tmp);
        throw new Error(`${path.basename(file)} already exists; evidence is never overwritten`);
    }
    fs.renameSync(tmp, file);
}
const checkRunId = (runId) => {
    if (typeof runId !== 'string' || !RUN_ID.test(runId))
        throw new Error('a run id is letters, digits, dot, dash or underscore');
};

/** Records that a run has started. Call it right after admission and before the first send. */
function beginRun(dir, runId, at = new Date().toISOString()) {
    checkRunId(runId);
    durableWrite(runFile(dir, runId, 'started'), { runId, startedAt: at });
}
/**
 * Writes the run's cleanup evidence, once. `journeys` is [{ journey, reserveExhausted, steps: [{ kind, ref, action,
 * outcome: 'done' | 'failed' | 'not attempted' }], left: [{ kind, ref }] }]. A malformed entry is refused rather than
 * written, because evidence that can't be read can't be recovered from.
 */
function writeCleanupEvidence(dir, runId, journeys, at = new Date().toISOString()) {
    checkRunId(runId);
    if (!fs.existsSync(runFile(dir, runId, 'started')))
        throw new Error(`run ${runId} has no start record`);
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
    const incomplete = journeys.filter((j) => j.reserveExhausted || j.left.length > 0 || j.steps.some((s) => s.outcome !== 'done'));
    const doc = {
        runId, writtenAt: at, cleanup: incomplete.length > 0 ? 'incomplete' : 'complete',
        incompleteJourneys: incomplete.map((j) => j.journey), journeys,
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

module.exports = { RESOURCE_KINDS, admitRun, beginRun, recordRecovery, writeCleanupEvidence };
