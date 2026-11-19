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
function unprovenCleanup(j, { requiredKinds = [], requiredStores = [], confirmedScope } = {}) {
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
    if (requiredKinds.length > 0) {
        if (typeof confirmedScope !== 'string' || !REF.test(confirmedScope))
            reasons.push('no confirmed guarded-create scope for required residue queries');
        const queries = v?.kind === 'zero-residue' && Array.isArray(v.queries) ? v.queries : [];
        for (const kind of requiredKinds) {
            if (!queries.some((q) => q?.kind === kind && q.scope === confirmedScope && isCount(q.count) && q.count === 0))
                reasons.push(`no residue query for ${kind} with observed zero on the confirmed account scope`);
        }
    }
    // #1884 (Sam): every named store needs its OWN scoped zero (`store` identity bound to the confirmed scope). A zero for another store
    // or a generic kind never stands in for one that was omitted, unread or unobserved.
    for (const store of requiredStores) {
        const queries = v?.kind === 'zero-residue' && Array.isArray(v.queries) ? v.queries : [];
        if (!queries.some((q) => q?.store === store && q.scope === confirmedScope && isCount(q.count) && q.count === 0))
            reasons.push(`no residue query for store ${store} with observed zero on the confirmed account scope`);
    }
    return reasons;
}
const RUN_ID = /^[A-Za-z0-9._-]{1,80}$/;
const REF = /^[A-Za-z0-9._:-]{1,120}$/;
const EMAIL_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
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
// lookup reference for the account it may create. If that write fails, nothing is sent.
//
// Sam's review of 964f2add: a client-side abort plus a wait does NOT prove the server stopped, and "any resolved callback" is
// not an answer. So an attempt is resolved only by a VALIDATED TERMINAL RESULT bound to it: received before the client's abort,
// naming the attempt and its lookup reference, and either `refused` with a definitive 4xx status or `created` with the server's
// account reference. Anything else (a throw, a timeout, a late callback after the abort, an ambiguous or malformed result, a
// restart) leaves it unresolved, and admission stays refused. An unresolved attempt is recovered only by (a) an authoritative
// terminal result from an independent source, with complete zero residue when it says `created`, or (b) an independently
// observed, complete zero-residue lookup taken after a DOCUMENTED, server-enforced deadline for the create endpoint. No such
// deadline is documented today (SERVER_CREATE_DEADLINE is null), so (b) refuses every proof and admission stays blocked until (a).
// A run-level recovery marker never clears an attempt, and every record is re-validated when admission reads it.

/** The client-side cap on a create request's transport deadline. It bounds the client only; it proves nothing about the server. */
const MAX_TRANSPORT_DEADLINE_MS = 5 * 60_000;
/**
 * The server-enforced deadline after which the account-create endpoint can no longer complete a request, with its documentation
 * source. None is documented for the production auth endpoint, so it is null: recovery by deadline is unavailable (fail closed).
 * Setting it requires citing the server's documented guarantee in `source`.
 */
const SERVER_CREATE_DEADLINE = Object.freeze({ ms: null, source: null });
const ATTEMPT_ID = /^[A-Za-z0-9._-]{1,60}$/;
const attemptFile = (dir, runId, attemptId, state) => path.join(dir, `${runId}.attempt.${attemptId}.${state}.json`);
const ATTEMPT_SENT = '.sent.json';
const TERMINAL_OUTCOMES = Object.freeze(['created', 'refused']);
/** The cleanup code's own residue checks (cleanup-plan.cjs SOURCE_COUNTS.residueChecks): a recovery lookup must cover them all. */
const REQUIRED_RESIDUE_CHECKS = require('./cleanup-plan.cjs').SOURCE_COUNTS.residueChecks;
const { resolveUnansweredCreate } = require('./account-reservation.cjs');

/** The journey a leg belongs to (`J8.b` -> `J8`, `J6` -> `J6`): a journey reserves one account. */
const journeyOf = (leg) => String(leg).split('.')[0];
/** The journey's one create slot in a run: written once, never overwritten, so concurrent workers cannot both claim it. */
const createClaimFile = (dir, runId, journey) => path.join(dir, `${runId}.create-claim.${journey}.json`);
/** The account-create attempts already recorded for a journey in a run (durable, so this survives a restart). */
function journeyAttempts(dir, runId, journey) {
    let names;
    try {
        names = fs.readdirSync(dir);
    }
    catch {
        return null;
    }
    const mine = names.filter((n) => n.startsWith(`${runId}.attempt.`) && n.endsWith(ATTEMPT_SENT));
    const docs = mine.map((n) => readAttempt(path.join(dir, n)));
    if (docs.some((d) => d === null))
        return null;
    return docs.filter((d) => journeyOf(d.leg) === journey);
}
/**
 * Records an account-create attempt before it is sent. Throws (and the caller sends nothing) if it can't be recorded. Sam, 16 Nov:
 * a journey reserves ONE account under ONE lookup reference and sends ONE create for it: a second attempt for the journey in the
 * same run, under any reference, is refused from the durable records, so a restart can't send it either (a second create
 * could land after the first account was found and deleted).
 */
function recordCreateAttempt(dir, runId, { attemptId, leg, lookupRef, transportDeadlineMs, emailDomain }, at = new Date().toISOString()) {
    checkRunId(runId);
    if (typeof attemptId !== 'string' || !ATTEMPT_ID.test(attemptId))
        throw new Error('an attempt id is letters, digits, dot, dash or underscore');
    if (typeof leg !== 'string' || !ATTEMPT_ID.test(leg))
        throw new Error('an attempt names the leg that owns it');
    if (typeof lookupRef !== 'string' || !REF.test(lookupRef))
        throw new Error('an account-create attempt needs a non-secret lookup reference for the account it may create');
    if (!Number.isInteger(transportDeadlineMs) || transportDeadlineMs <= 0 || transportDeadlineMs > MAX_TRANSPORT_DEADLINE_MS)
        throw new Error(`an account-create attempt needs a transport deadline within ${MAX_TRANSPORT_DEADLINE_MS} ms`);
    // Codex P2 on df64d30e: an email-based reservation records its fixed domain BEFORE the create is sent, so recovery
    // rebuilds the exact email that was submitted, never one under a domain configured later.
    if (emailDomain !== undefined && (typeof emailDomain !== 'string' || !EMAIL_DOMAIN.test(emailDomain)))
        throw new Error('an account-create attempt\'s email domain must be a plain lower-case domain');
    if (!fs.existsSync(runFile(dir, runId, 'started')))
        throw new Error(`run ${runId} was never admitted; nothing may be sent`);
    const earlier = journeyAttempts(dir, runId, journeyOf(leg));
    if (earlier === null)
        throw new Error('the earlier account-create attempts could not be read, so a second create cannot be ruled out');
    if (earlier.length > 0)
        throw new Error(`journey ${journeyOf(leg)} already sent its one account create in run ${runId}; another could land after that account is deleted`);
    // Codex P2 on 9474d231: two workers can both read no earlier attempt before either writes one. The journey's create slot
    // is therefore claimed atomically (a hard link that never overwrites): exactly one claim per journey per run succeeds,
    // and the loser is refused before anything is sent. A claim whose attempt write then fails leaves the journey unable to
    // create again in this run (fail-closed; nothing was sent).
    const journey = journeyOf(leg);
    try {
        durableWrite(createClaimFile(dir, runId, journey), { runId, journey, attemptId, leg, claimedAt: at });
    }
    catch (e) {
        if (/already exists/.test(e.message))
            throw new Error(`journey ${journey} already claimed its one account create in run ${runId}; another could land after that account is deleted`);
        throw e;
    }
    durableWrite(attemptFile(dir, runId, attemptId, 'sent'), { runId, attemptId, leg, kind: 'account', lookupRef, ...(emailDomain === undefined ? {} : { emailDomain }), transportDeadlineMs, recordedAt: at });
}
/**
 * #1884 parent-owned teardown: the journey's ONE durable create record in this run, `{ sent, answered }` (answered null when no
 * validated terminal result was written), or null when there is none, more than one, or any record can't be read. Teardown
 * establishes ownership from this record, never from the child.
 */
function journeyCreateRecord(dir, runId, journey) {
    checkRunId(runId);
    const docs = journeyAttempts(dir, runId, journey);
    if (docs === null || docs.length !== 1) return null;
    const sent = docs[0];
    if (typeof sent?.attemptId !== 'string' || !ATTEMPT_ID.test(sent.attemptId)) return null;
    const file = attemptFile(dir, runId, sent.attemptId, 'answered');
    if (!fs.existsSync(file)) return { sent, answered: null };
    const answered = readAttempt(file);
    return answered === null ? null : { sent, answered };
}
/** The recorded (sent) account-create attempt, or null when it was never recorded or can't be read. */
function readSentAttempt(dir, runId, attemptId) {
    checkRunId(runId);
    return typeof attemptId === 'string' && ATTEMPT_ID.test(attemptId) ? readAttempt(attemptFile(dir, runId, attemptId, 'sent')) : null;
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
 * Why `result` is not a validated terminal result for `sent`, or null when it is: bound to the attempt and its lookup reference,
 * received after the attempt was recorded, before the client's abort, and either `refused` with a definitive 4xx status or
 * `created` with the server's account reference.
 */
function terminalResultFault(sent, result) {
    if (!result || typeof result !== 'object')
        return 'no terminal result';
    if (result.attemptId !== sent.attemptId || result.lookupRef !== sent.lookupRef)
        return 'the result is not bound to this attempt and its lookup reference';
    if (!TERMINAL_OUTCOMES.includes(result.outcome))
        return 'the result is not a terminal outcome';
    if (result.outcome === 'created' && (typeof result.accountRef !== 'string' || !REF.test(result.accountRef)))
        return 'a created result carries no server account reference';
    if (result.outcome === 'refused' && !(Number.isInteger(result.status) && result.status >= 400 && result.status < 500))
        return 'a refused result carries no definitive 4xx status';
    const received = Date.parse(result.receivedAt);
    const recorded = Date.parse(sent.recordedAt);
    if (!Number.isFinite(received) || !Number.isFinite(recorded) || received < recorded)
        return 'the result was not received after the attempt was recorded';
    if (result.beforeAbort !== true)
        return 'the result did not arrive before the client aborted, so the request may still complete';
    return null;
}
/** Records a validated terminal result for the attempt. Refuses (writes nothing) unless it validates. */
function answerCreateAttempt(dir, runId, attemptId, result, at = new Date().toISOString()) {
    checkRunId(runId);
    const sent = readAttempt(attemptFile(dir, runId, attemptId, 'sent'));
    if (!sent)
        throw new Error(`attempt ${attemptId} of run ${runId} was never recorded`);
    const fault = terminalResultFault(sent, result);
    if (fault)
        throw new Error(`attempt ${attemptId} not answered: ${fault}`);
    durableWrite(attemptFile(dir, runId, attemptId, 'answered'), { runId, attemptId, answeredAt: at, result });
}
/** Why a residue lookup is not a complete zero for the attempted account, or null when it is. */
function residueFault(sent, residue, now) {
    if (!residue || typeof residue !== 'object')
        return 'no residue lookup';
    if (residue.lookupRef !== sent.lookupRef)
        return 'the residue lookup names another account';
    const observed = Date.parse(residue.observedAt);
    if (!Number.isFinite(observed) || observed > now)
        return 'the residue lookup is not an observation already made (missing or future time)';
    const queries = Array.isArray(residue.queries) ? residue.queries : [];
    if (!queries.some((q) => q && q.kind === 'account'))
        return 'the residue lookup does not query the account itself';
    if (!queries.every((q) => q && RESOURCE_KINDS.includes(q.kind) && q.scope === sent.lookupRef && isCount(q.count) && q.count === 0))
        return 'the residue lookup is not a zero count scoped to the attempted account';
    if (residue.residueChecks !== REQUIRED_RESIDUE_CHECKS || residue.residueNonZero !== 0)
        return `the residue lookup is incomplete (needs all ${REQUIRED_RESIDUE_CHECKS} residue checks, each zero)`;
    return { observed };
}
/**
 * Why a recovery proof does not clear the unresolved `sent`, or null when it does. `opts.serverDeadline` and `opts.now` exist for
 * the offline tests; production uses SERVER_CREATE_DEADLINE (null: no deadline route) and the clock.
 */
function attemptRecoveryFault(sent, proof, { serverDeadline = SERVER_CREATE_DEADLINE, now = Date.now(), ...opts } = {}) {
    if (!proof || typeof proof !== 'object')
        return 'no recovery proof';
    if (proof.kind === 'terminal') {
        const fault = terminalResultFault(sent, proof.result);
        if (fault)
            return `the authoritative result is not valid: ${fault}`;
        if (proof.result.outcome === 'created') {
            const r = residueFault(sent, proof.residue, now);
            if (typeof r === 'string')
                return `the account was created and ${r}`;
            // Codex P1 on 8641c4ec: a zero taken before the create's answer cannot show the created account is gone.
            if (r.observed < Date.parse(proof.result.receivedAt))
                return 'the residue lookup was taken before the create was answered, so it cannot show the created account is gone';
        }
        return null;
    }
    // Sam, 16 Nov: the account found under the one reservation (a `.landed` record), deleted through the scoped path, then a
    // complete zero-residue lookup for it. With one create sent, nothing else can land, so this clears the attempt.
    if (proof.kind === 'landed-and-cleaned') {
        if (!opts.landed)
            return 'no landed record: the account was never found under the attempt\'s reservation';
        const r = residueFault(sent, proof.residue, now);
        if (typeof r === 'string')
            return `the found account ${r}`;
        if (r.observed < Date.parse(opts.landed.landedAt))
            return 'the residue lookup was taken before the account was found, so it cannot show the found account is gone';
        return null;
    }
    if (proof.kind === 'after-server-deadline') {
        if (!Number.isInteger(serverDeadline?.ms) || serverDeadline.ms <= 0 || typeof serverDeadline.source !== 'string' || !serverDeadline.source)
            return 'no server-enforced deadline is documented for the create endpoint, so a lookup cannot prove the request stopped';
        const r = residueFault(sent, proof.residue, now);
        if (typeof r === 'string')
            return r;
        const recorded = Date.parse(sent.recordedAt);
        if (!Number.isFinite(recorded) || r.observed < recorded + serverDeadline.ms)
            return 'the residue lookup was taken before the server-enforced deadline, so a delayed create could still land';
        return null;
    }
    return 'the recovery proof is neither an authoritative terminal result nor a lookup after a documented server deadline';
}
/**
 * Sam, 16 Nov: an exact-email, unique-result lookup that FINDS the run-owned account under the attempt's reservation. With the
 * journey's one create, that account is the attempt's, so it permits SCOPED cleanup of exactly that account: it never clears
 * the attempt and never counts as a PASS. A `zero` lookup is refused: absence proves nothing, the create may still land.
 */
function landedFault(sent, found, createsSent) {
    if (!found || typeof found !== 'object')
        return 'no reservation lookup';
    if (found.lookupRef !== sent.lookupRef)
        return 'the lookup names another account';
    const step = resolveUnansweredCreate({ lookup: found.lookup, createsSent });
    if (step.state !== 'resolved')
        return step.reason;
    if (typeof found.accountRef !== 'string' || !REF.test(found.accountRef))
        return 'a found account carries no server account reference';
    if (!Number.isFinite(Date.parse(found.observedAt)) || Date.parse(found.observedAt) < Date.parse(sent.recordedAt))
        return 'the lookup was not taken after the attempt was recorded';
    return null;
}
function recordAttemptLanded(dir, runId, attemptId, found, at = new Date().toISOString()) {
    checkRunId(runId);
    const sent = readAttempt(attemptFile(dir, runId, attemptId, 'sent'));
    if (!sent)
        throw new Error(`attempt ${attemptId} of run ${runId} was never recorded`);
    const sentForJourney = journeyAttempts(dir, runId, journeyOf(sent.leg));
    const fault = landedFault(sent, found, sentForJourney === null ? Number.NaN : sentForJourney.length);
    if (fault)
        throw new Error(`attempt ${attemptId}: the account is not established: ${fault}`);
    durableWrite(attemptFile(dir, runId, attemptId, 'landed'), { runId, attemptId, landedAt: at, found });
}
/** Records the protected recovery of one unresolved attempt. Refuses (writes nothing) unless the proof clears it. */
function recordAttemptRecovery(dir, runId, attemptId, proof, { at = new Date().toISOString(), ...opts } = {}) {
    checkRunId(runId);
    const sent = readAttempt(attemptFile(dir, runId, attemptId, 'sent'));
    if (!sent)
        throw new Error(`attempt ${attemptId} of run ${runId} was never recorded; there is nothing to recover`);
    const landed = readAttempt(attemptFile(dir, runId, attemptId, 'landed'));
    const fault = attemptRecoveryFault(sent, proof, { ...opts, landed });
    if (fault)
        throw new Error(`attempt ${attemptId} not recovered: ${fault}`);
    durableWrite(attemptFile(dir, runId, attemptId, 'recovered'), { runId, attemptId, recoveredAt: at, proof });
}
/**
 * The attempts that still block admission, each record re-validated on read: a recovery proof that clears it, or a validated
 * terminal answer (`refused`, or `created` with its run's complete cleanup evidence). A run-level recovery marker never clears it.
 */
function blockingAttempts(dir, names, opts = {}) {
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
            const landed = names.includes(`${stem}.landed.json`) ? readAttempt(path.join(dir, `${stem}.landed.json`)) : null;
            const fault = attemptRecoveryFault(sent, rec?.proof, { ...opts, landed });
            if (!fault)
                continue;
            blocking.push(`${stem}: recovery not accepted (${fault})`);
            continue;
        }
        if (names.includes(`${stem}.answered.json`)) {
            const answered = readAttempt(path.join(dir, `${stem}.answered.json`));
            const fault = terminalResultFault(sent, answered?.result);
            if (fault) {
                blocking.push(`${stem}: answer evidence not valid (${fault})`);
                continue;
            }
            if (answered.result.outcome === 'refused')
                continue;
            const cleanup = readAttempt(path.join(dir, `${sent.runId}.cleanup.json`));
            if (cleanup?.cleanup === 'complete')
                continue;
            blocking.push(`${stem}: created, but its run's cleanup is not proven complete`);
            continue;
        }
        if (names.includes(`${stem}.landed.json`)) {
            blocking.push(`${stem}: the account was found under its reservation; scoped cleanup is permitted, and only a complete zero after it readmits`);
            continue;
        }
        blocking.push(`${stem}: account-create attempt has no terminal result; recover that exact account first`);
    }
    return blocking;
}

/**
 * Admission: the next run is refused while any started run has no cleanup evidence (killed, or still running) or
 * incomplete cleanup, unless its recovery is recorded. Evidence that can't be read refuses too. An account-create attempt
 * blocks on its own terms (`blockingAttempts`), whatever the run's recovery marker says.
 */
function admitRun(dir, opts = {}) {
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
    blocking.push(...blockingAttempts(dir, names, opts));
    return blocking.length > 0
        ? { admitted: false, reason: `earlier runs must be recovered first: ${blocking.join('; ')}`, blocking }
        : { admitted: true, reason: 'every earlier run cleaned up or was recovered', blocking };
}

module.exports = {
    ADMISSION_LOCK, AdmissionRefused, MAX_TRANSPORT_DEADLINE_MS, RESOURCE_KINDS, SERVER_CREATE_DEADLINE, VERIFICATION_KINDS, admitRun, answerCreateAttempt, beginRun,
    journeyCreateRecord, readSentAttempt, recordAttemptLanded, recordAttemptRecovery, recordCreateAttempt, recordRecovery, unprovenCleanup, writeCleanupEvidence,
};
