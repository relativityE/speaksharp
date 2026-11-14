"use strict";
// Nightly AHT suite: the run budget, built to the #1864 §6 contract (2a40e87) and Sam's reviews of #1864 and #1865.
//
// 1. The run request names its legs. `planRunBudget` takes the selected legs as given: it never chooses scope. A leg
//    named without a leg it needs is refused, and so is a selection whose coaching need is above the requested
//    ceiling (name fewer legs instead). A named leg whose gate is unmet gets no allocation and reports NOT RUN or HOLD,
//    and so does a named leg that needs it, because it can't pass; that is the gate's doing, not a choice of scope.
// 2. Frozen allocations. Every allocated leg gets its coaching requests and Start presses (journey-plan.cjs), and every
//    journey with an allocated leg gets its protected cleanup reserve (cleanup-plan.cjs, the structural worst case).
//    The whole of it is fixed before anything is sent and never reassigned.
// 3. Atomic reservation, across workers too. Every reservation is a decision over the run's event journal, made in
//    one step with the check and the record together. In one process that step is synchronous. Across processes
//    (pages, workers) `openSharedRunBudget` puts the journal in a directory and takes an exclusive lock around each
//    step, so two workers can never both take the last unit. A worker that can't get the lock in time is refused
//    (nothing is sent), never let through. A write cut short by a crash is repaired under the lock into a `torn`
//    event: no more test work is sent, and it is counted against every journey's cleanup reserve.
// 4. No release. A reservation is final: an unknown outcome keeps it, and a retry needs a unit of its own. Past the
//    leg's allocation the reservation is refused, the leg's budget row FAILs and its ordinary work stops.
// 5. Protected cleanup. Cleanup draws only on its journey's reserve, which ordinary work can't touch; a leg whose
//    ordinary work stopped can still clean up. A refused cleanup reservation fails the leg's budget row and marks the
//    journey's cleanup incomplete (cleanup-evidence.cjs records what was left; admission refuses the next run).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { ALL_LEGS, legById } = require('./journey-plan.cjs');
const { runnable } = require('./limits.cjs');
const { cleanupReserve } = require('./cleanup-plan.cjs');
const { isCount } = require('./counts.cjs');

const COACHING_CEILING_ENV = 'NIGHTLY_COACHING_CAP';
/** The kinds ordinary work reserves. Cleanup is reserved only through `reserveCleanup`. */
const ORDINARY_KINDS = Object.freeze(['coaching', 'starts']);
const CLEANUP = 'cleanup';
class RunRefused extends Error {}
/** The shared journal could not be used (lock not available in time, or unreadable): nothing is sent. */
class BudgetUnavailable extends Error {}

/**
 * Reads an optional lower coaching ceiling: undefined when unset, otherwise a whole number. planRunBudget refuses one
 * that doesn't cover the named legs, and one above what they need.
 */
function coachingCeilingFromEnv(env) {
    const raw = env[COACHING_CEILING_ENV];
    if (raw === undefined || raw === '')
        return undefined;
    if (!/^\d+$/.test(raw.trim()))
        throw new Error(`${COACHING_CEILING_ENV} must be a whole number, got ${JSON.stringify(raw)}`);
    return Number(raw.trim());
}
/**
 * The plan for one run, fixed before it starts.
 * - `selected`: the legs the run request names. Required: the budget never picks them.
 * - `satisfiedGates`: gate kinds the runner established as met.
 * - `coachingCeiling`: optional; must cover the named runnable legs' coaching exactly or above (never below), and is
 *   refused above their need, since a higher ceiling buys no signal.
 */
function planRunBudget({ satisfiedGates, selected, coachingCeiling } = {}) {
    if (!(satisfiedGates instanceof Set))
        throw new Error('satisfiedGates must be a Set');
    if (!Array.isArray(selected) || selected.length === 0)
        throw new RunRefused('the run request must name the legs to run; the budget never chooses them');
    if (new Set(selected).size !== selected.length)
        throw new RunRefused('the run request names a leg twice');
    for (const id of selected)
        legById(id);
    for (const id of selected) {
        const missing = legById(id).needs.filter((d) => !selected.includes(d));
        if (missing.length > 0)
            throw new RunRefused(`${id} is named without ${missing.join(', ')}, which it needs; name them together`);
    }
    const notAllocated = new Map();
    let legs = [];
    for (const l of ALL_LEGS) {
        if (!selected.includes(l.id))
            notAllocated.set(l.id, 'not named in the run request');
        else if (!runnable(l, satisfiedGates))
            notAllocated.set(l.id, `gated: ${l.gates.filter((g) => !satisfiedGates.has(g.kind)).map((g) => g.kind).join(', ') || 'never satisfiable'}`);
        else
            legs.push(l);
    }
    // A named leg whose dependency is gated can't pass, so it gets no allocation either (none is stranded).
    for (let changed = true; changed;) {
        changed = false;
        for (const l of [...legs]) {
            const missing = l.needs.find((d) => notAllocated.has(d));
            if (missing) {
                legs = legs.filter((x) => x !== l);
                notAllocated.set(l.id, `needs ${missing}, which has no allocation`);
                changed = true;
            }
        }
    }
    const need = legs.reduce((n, l) => n + l.coachingReserve, 0);
    if (coachingCeiling !== undefined) {
        if (!isCount(coachingCeiling))
            throw new RunRefused(`coaching ceiling must be a whole number >= 0, got ${coachingCeiling}`);
        if (coachingCeiling < need)
            throw new RunRefused(`the named legs need ${need} coaching requests, above the ceiling of ${coachingCeiling}; name fewer legs`);
        if (coachingCeiling > need)
            throw new RunRefused(`coaching ceiling ${coachingCeiling} is above the ${need} requests the named legs need; a higher ceiling buys no signal`);
    }
    const legAlloc = {};
    for (const l of legs)
        legAlloc[l.id] = { coaching: l.coachingReserve, starts: l.startPresses };
    const cleanup = {};
    for (const j of new Set(legs.map((l) => l.journey))) {
        try {
            const r = cleanupReserve(j);
            cleanup[j] = { requests: r.requests, seconds: r.seconds };
        }
        catch (e) {
            throw new RunRefused(`${j} has no cleanup reserve: ${e.message}`);
        }
    }
    return new RunBudget({ legs: legAlloc, cleanup, notAllocated: Object.fromEntries(notAllocated) });
}

// ---------------------------------------------------------------------------------------------------------------
// The journal. State is folded from events, so one process and many share the same rules.
const emptyState = () => ({ used: new Map(), cleanupUsed: new Map(), refused: new Map(), stopped: new Set(), afterStop: new Map(), torn: 0 });
const counter = (m, k, init) => {
    if (!m.has(k))
        m.set(k, init());
    return m.get(k);
};
function apply(state, plan, e) {
    // A write cut short by a crash (fileStore repairs it under the lock): its caller never got an answer, but it may
    // have been any grant, so it is counted against everything (see decide).
    if (e.t === 'torn') {
        state.torn += 1;
        return;
    }
    const leg = legById(e.leg);
    if (!plan.legs[e.leg])
        throw new Error(`journal names ${e.leg}, which has no allocation`);
    if (e.t === 'grant') {
        if (e.kind === CLEANUP)
            state.cleanupUsed.set(leg.journey, (state.cleanupUsed.get(leg.journey) ?? 0) + 1);
        else
            counter(state.used, e.leg, () => ({ coaching: 0, starts: 0 }))[e.kind] += 1;
    }
    else if (e.t === 'refuse') {
        counter(state.refused, e.leg, () => ({ coaching: 0, starts: 0, [CLEANUP]: 0 }))[e.kind] += 1;
        if (e.kind !== CLEANUP)
            state.stopped.add(e.leg);
    }
    else if (e.t === 'refuse-after-stop') {
        state.afterStop.set(e.leg, (state.afterStop.get(e.leg) ?? 0) + 1);
    }
    else {
        throw new Error(`unknown journal event ${JSON.stringify(e)}`);
    }
}
/** The decision for one reservation, from the state so far: the event to record, or null when nothing is recorded. */
function decide(state, plan, legId, kind) {
    const a = plan.legs[legId];
    if (!a)
        return { event: null, result: { granted: false, reason: `${legId} has no allocation: ${plan.notAllocated[legId] ?? 'not planned'}` } };
    if (kind === CLEANUP) {
        const j = legById(legId).journey;
        // A torn write may have been one of this journey's cleanup grants: it is counted as one.
        const used = (state.cleanupUsed.get(j) ?? 0) + state.torn;
        if (used >= plan.cleanup[j].requests)
            return { event: { t: 'refuse', leg: legId, kind }, result: { granted: false, reason: `${j} has used its cleanup reserve of ${plan.cleanup[j].requests}` } };
        return { event: { t: 'grant', leg: legId, kind }, result: { granted: true, token: Object.freeze({ legId, kind, journey: j, n: used + 1 }) } };
    }
    // After a torn write no one can say what was granted, so no more test work is sent; cleanup still runs.
    if (state.torn > 0)
        return { event: null, result: { granted: false, reason: 'a write to the run budget journal was cut short, so no more test work is sent' } };
    if (state.stopped.has(legId))
        return { event: { t: 'refuse-after-stop', leg: legId, kind }, result: { granted: false, reason: `${legId}'s ordinary work was stopped after it exceeded its allocation` } };
    const used = state.used.get(legId)?.[kind] ?? 0;
    if (used >= a[kind])
        return { event: { t: 'refuse', leg: legId, kind }, result: { granted: false, reason: `${legId} has used its ${kind} allocation of ${a[kind]}` } };
    return { event: { t: 'grant', leg: legId, kind }, result: { granted: true, token: Object.freeze({ legId, kind, n: used + 1 }) } };
}

/** In one process: the journal is an array and every step is synchronous. */
function memoryStore() {
    const events = [];
    const refusedCleanup = new Set();
    return {
        transact: (fn) => { const { result, append } = fn(events); if (append) events.push(append); return result; },
        markCleanupRefused: (j) => refusedCleanup.add(j),
        cleanupRefused: () => new Set(refusedCleanup),
    };
}

function freezePlan(p) {
    const legs = {};
    for (const [id, a] of Object.entries(p.legs)) {
        legById(id);
        for (const k of ORDINARY_KINDS)
            if (!isCount(a[k]))
                throw new Error(`${id}: ${k} allocation must be a whole number >= 0, got ${a[k]}`);
        legs[id] = Object.freeze({ coaching: a.coaching, starts: a.starts });
    }
    const cleanup = {};
    for (const [j, c] of Object.entries(p.cleanup)) {
        if (!isCount(c.requests) || !isCount(c.seconds))
            throw new Error(`${j}: cleanup reserve must be whole numbers >= 0`);
        cleanup[j] = Object.freeze({ requests: c.requests, seconds: c.seconds });
    }
    for (const id of Object.keys(legs)) {
        if (!cleanup[legById(id).journey])
            throw new Error(`${id} is allocated but its journey has no cleanup reserve`);
        if (id in (p.notAllocated ?? {}))
            throw new Error(`${id} is both allocated and left out`);
    }
    return Object.freeze({ legs: Object.freeze(legs), cleanup: Object.freeze(cleanup), notAllocated: Object.freeze({ ...(p.notAllocated ?? {}) }) });
}

class RunBudget {
    #plan;
    #store;
    constructor(plan, store = memoryStore()) {
        this.#plan = freezePlan(plan);
        this.#store = store;
    }
    /** The frozen plan, as written for workers to share. */
    plan() { return this.#plan; }
    #state(events) {
        const s = emptyState();
        for (const e of events)
            apply(s, this.#plan, e);
        return s;
    }
    /** The whole run's reservation, fixed at the start. */
    totals() {
        const t = { coaching: 0, starts: 0, cleanupRequests: 0, cleanupSeconds: 0 };
        for (const a of Object.values(this.#plan.legs)) {
            t.coaching += a.coaching;
            t.starts += a.starts;
        }
        for (const c of Object.values(this.#plan.cleanup)) {
            t.cleanupRequests += c.requests;
            t.cleanupSeconds += c.seconds;
        }
        return Object.freeze(t);
    }
    /** A leg's frozen ordinary allocation, or null when it got none. */
    allocationOf(legId) {
        legById(legId);
        return this.#plan.legs[legId] ?? null;
    }
    /** A journey's protected cleanup reserve, or null when none of its legs is allocated. */
    cleanupReserveOf(journeyId) { return this.#plan.cleanup[journeyId] ?? null; }
    /** The legs with an allocation: the run's selected, runnable scope (for runVerdict's summary). */
    allocatedLegs() { return Object.keys(this.#plan.legs); }
    #reserve(legId, kind) {
        legById(legId);
        try {
            return this.#store.transact((events) => {
                const { event, result } = decide(this.#state(events), this.#plan, legId, kind);
                return { result, append: event };
            });
        }
        catch (e) {
            // Fail closed: a reservation that can't be decided is refused, and nothing is sent. A refused cleanup leaves
            // its journey's cleanup incomplete, so it is recorded outside the journal (which it couldn't reach).
            // Any error, not only an unreachable budget, leaves the cleanup undecided, so the journey is marked first.
            if (kind === CLEANUP)
                this.#store.markCleanupRefused(legById(legId).journey);
            if (e instanceof BudgetUnavailable)
                return { granted: false, reason: e.message };
            throw e;
        }
    }
    /** Reserves one unit of ordinary work before it is sent. Past the allocation, the leg's ordinary work stops. */
    reserve(legId, kind) {
        if (!ORDINARY_KINDS.includes(kind))
            throw new Error(`${kind} is not ordinary work; cleanup is reserved only with reserveCleanup`);
        return this.#reserve(legId, kind);
    }
    /** Reserves one cleanup request from the leg's journey's protected reserve. Ordinary work never reaches it. */
    reserveCleanup(legId) { return this.#reserve(legId, CLEANUP); }
    /** Reserves, then runs the action. A refused action is never started. */
    async send(legId, kind, action) {
        const r = kind === CLEANUP ? this.reserveCleanup(legId) : this.reserve(legId, kind);
        if (!r.granted)
            return { sent: false, reason: r.reason };
        return { sent: true, value: await action(r.token) };
    }
    /** A read of the journal; `unavailable` is returned when it can't be read (lock not had in time, unreadable). */
    #read(fn, unavailable) {
        try {
            return this.#store.transact((events) => ({ result: fn(this.#state(events)) }));
        }
        catch (e) {
            if (e instanceof BudgetUnavailable)
                return unavailable(e);
            throw e;
        }
    }
    /**
     * Whether the journey's cleanup was refused any request (past its reserve, or because the budget couldn't be
     * reached): its cleanup is then incomplete. When the budget can't be read, the answer is yes.
     */
    cleanupExhausted(journeyId) {
        if (this.#store.cleanupRefused().has(journeyId))
            return true;
        return this.#read((s) => ALL_LEGS.some((l) => l.journey === journeyId && (s.refused.get(l.id)?.[CLEANUP] ?? 0) > 0), () => true);
    }
    /** How many writes to the journal were cut short (null when it can't be read). Any is a reason the run isn't green. */
    journalTorn() { return this.#read((s) => s.torn, () => null); }
    /**
     * What leg-verdicts.cjs needs: whether the leg had an allocation, which kinds it overran, and `hold`, the reason its
     * budget can't be called clean (the journal couldn't be read, or a write to it was cut short), or null. A leg with a
     * `hold` is never PASS and never NOT RUN: an unreadable or torn journal can hide an overrun, so it is HOLD at least.
     */
    legBudget(legId) {
        legById(legId);
        if (!this.#plan.legs[legId])
            return Object.freeze({ allocated: false, reason: this.#plan.notAllocated[legId] ?? 'not planned', overrun: Object.freeze([]), hold: null });
        return this.#read((s) => {
            const refused = s.refused.get(legId) ?? {};
            const overrun = Object.keys(refused).filter((k) => refused[k] > 0);
            const hold = s.torn > 0 ? `${s.torn} write(s) to the run budget journal were cut short` : null;
            return Object.freeze({ allocated: true, reason: 'allocated before the run', overrun: Object.freeze(overrun), hold });
        }, (e) => Object.freeze({ allocated: true, reason: 'allocated before the run', overrun: Object.freeze([]), hold: `the run budget could not be read: ${e.message}` }));
    }
    /**
     * The leg's budget row: FAIL when it asked for more than its allocation of any kind, cleanup included; HOLD when the
     * journal can't be read or a write to it was cut short; NOT RUN when it had no allocation.
     */
    legBudgetRow(legId) {
        const b = this.legBudget(legId);
        if (!b.allocated)
            return { outcome: 'NOT RUN', reason: b.reason };
        if (b.overrun.length === 0 && b.hold && b.hold.startsWith('the run budget could not be read'))
            return { outcome: 'HOLD', reason: b.hold };
        return this.#read((s) => {
            const j = legById(legId).journey;
            return {
                outcome: b.overrun.length > 0 ? 'FAIL' : b.hold ? 'HOLD' : 'PASS', ...(b.hold ? { reason: b.hold } : {}),
                allocated: this.#plan.legs[legId], used: { coaching: 0, starts: 0, ...s.used.get(legId) },
                refused: { coaching: 0, starts: 0, [CLEANUP]: 0, ...s.refused.get(legId) }, refusedAfterStop: s.afterStop.get(legId) ?? 0,
                journeyCleanup: { reserve: this.#plan.cleanup[j].requests, used: s.cleanupUsed.get(j) ?? 0 },
            };
        }, (e) => ({ outcome: 'HOLD', reason: `the run budget could not be read: ${e.message}` }));
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Shared across processes: the plan and the journal live in one run directory, and every step holds its lock.
const PLAN_FILE = 'budget-plan.json';
const JOURNAL_FILE = 'budget-journal.jsonl';
const LOCK_DIR = 'budget.lock';
const sha256 = (t) => createHash('sha256').update(t).digest('hex');
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const alive = (pid) => {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (e) {
        return e.code === 'EPERM';
    }
};
/**
 * The lock is a directory (mkdir is atomic) holding its owner's pid, host and a random token. A worker waits for a live
 * owner until `lockTimeoutMs` and is then refused. A lock is stale when its owner on this host is gone, or when it never
 * got an owner within `staleMs`. Breaking one is itself done under a second lock (`budget.lock.break`), and only after
 * reading the owner again under it: two workers that both saw the same dead owner can't both break, and neither can
 * break a lock a third worker took in between. Releasing removes the lock only while its owner file still holds this
 * step's token, so a step never removes a lock it doesn't hold.
 */
function fileStore(dir, { lockTimeoutMs = 5000, staleMs = 10000 } = {}) {
    const lock = path.join(dir, LOCK_DIR);
    const breaker = path.join(dir, `${LOCK_DIR}.break`);
    const journal = path.join(dir, JOURNAL_FILE);
    const owner = path.join(lock, 'owner.json');
    const readOwner = () => {
        try {
            return JSON.parse(fs.readFileSync(owner, 'utf8'));
        }
        catch {
            return null;
        }
    };
    const ageOf = (p) => {
        try {
            return Date.now() - fs.statSync(p).mtimeMs;
        }
        catch {
            return null;
        }
    };
    // Stale: a dead owner on this host, or no owner long after the lock was made. `seen` is what the caller read.
    const staleNow = (seen) => {
        const o = readOwner();
        if (seen === null)
            return o === null && (ageOf(lock) ?? 0) > staleMs;
        return o !== null && o.token === seen.token && o.host === os.hostname() && Number.isInteger(o.pid) && !alive(o.pid);
    };
    const tryBreak = (seen) => {
        try {
            fs.mkdirSync(breaker);
        }
        catch (e) {
            if (e.code !== 'EEXIST')
                throw e;
            // A breaker that died mid-break leaves its lock; it holds nothing else, so an old one is removed.
            if ((ageOf(breaker) ?? 0) > staleMs)
                fs.rmSync(breaker, { recursive: true, force: true });
            return;
        }
        try {
            // Read again under the break lock: break only the very lock the caller judged stale.
            if (staleNow(seen))
                fs.rmSync(lock, { recursive: true, force: true });
        }
        finally {
            fs.rmSync(breaker, { recursive: true, force: true });
        }
    };
    const acquire = () => {
        const deadline = Date.now() + lockTimeoutMs;
        const token = randomBytes(16).toString('hex');
        for (;;) {
            try {
                fs.mkdirSync(lock);
                fs.writeFileSync(owner, JSON.stringify({ pid: process.pid, host: os.hostname(), token }));
                return token;
            }
            catch (e) {
                if (e.code !== 'EEXIST')
                    throw e;
            }
            const seen = readOwner();
            if (staleNow(seen))
                tryBreak(seen);
            else if (Date.now() >= deadline)
                return null;
            else
                sleepSync(5);
        }
    };
    const release = (token) => {
        if (readOwner()?.token === token)
            fs.rmSync(lock, { recursive: true, force: true });
    };
    const readEvents = () => {
        let text = '';
        try {
            text = fs.readFileSync(journal, 'utf8');
        }
        catch (e) {
            if (e.code !== 'ENOENT')
                throw e;
        }
        // A partial last line is a write cut short by a crash; its caller never got an answer. Under the lock it is cut
        // off and replaced by a `torn` event, which counts against everything (decide), so the run can still clean up.
        const end = text.lastIndexOf('\n') + 1;
        if (end < text.length) {
            fs.truncateSync(journal, end);
            appendLine({ t: 'torn' });
            text = `${text.slice(0, end)}${JSON.stringify({ t: 'torn' })}\n`;
        }
        return text.split('\n').slice(0, -1).map((l) => JSON.parse(l));
    };
    const appendLine = (event) => {
        const fd = fs.openSync(journal, 'a');
        try {
            fs.writeSync(fd, `${JSON.stringify(event)}\n`);
            fs.fsyncSync(fd);
        }
        finally {
            fs.closeSync(fd);
        }
    };
    const markerPrefix = 'cleanup-refused.';
    return {
        transact(fn) {
            const token = acquire();
            if (token === null)
                throw new BudgetUnavailable('the run budget lock was not available in time; nothing was sent');
            try {
                let events;
                try {
                    events = readEvents();
                }
                catch (e) {
                    throw new BudgetUnavailable(`the run budget journal is unreadable (${e.message}); nothing more is sent`);
                }
                const { result, append } = fn(events);
                if (append)
                    appendLine(append);
                return result;
            }
            finally {
                release(token);
            }
        },
        // Written without the lock (it is used when the lock can't be had): one uniquely named file per refusal.
        markCleanupRefused(journeyId) {
            fs.writeFileSync(path.join(dir, `${markerPrefix}${journeyId}.${process.pid}.${randomBytes(6).toString('hex')}`), '', { flag: 'wx' });
        },
        cleanupRefused() {
            return new Set(fs.readdirSync(dir).filter((n) => n.startsWith(markerPrefix)).map((n) => n.slice(markerPrefix.length).split('.')[0]));
        },
        // For tests: break the lock if the owner `seen` is still the stale owner, as acquire does.
        _breakIfStale: tryBreak,
    };
}
/** Writes the run's frozen plan into an empty run directory, once. Every worker opens the budget from it. */
function writeSharedPlan(dir, budget) {
    const body = JSON.stringify(budget.plan());
    fs.writeFileSync(path.join(dir, PLAN_FILE), JSON.stringify({ sha256: sha256(body), plan: JSON.parse(body) }), { flag: 'wx' });
}
/** Opens the run's shared budget from its directory, checking the plan was not altered. */
function openSharedRunBudget(dir, options) {
    const doc = JSON.parse(fs.readFileSync(path.join(dir, PLAN_FILE), 'utf8'));
    if (sha256(JSON.stringify(doc.plan)) !== doc.sha256)
        throw new RunRefused('the shared budget plan does not match its digest');
    return new RunBudget(doc.plan, fileStore(dir, options));
}

module.exports = {
    BudgetUnavailable, CLEANUP, COACHING_CEILING_ENV, ORDINARY_KINDS, RunBudget, RunRefused, coachingCeilingFromEnv, openSharedRunBudget,
    planRunBudget, writeSharedPlan,
    /** For tests only: the shared journal store. */
    _fileStore: fileStore,
};
