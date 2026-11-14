"use strict";
// Nightly AHT suite: the run budget, built to Sam's contract from the #1864 review (14 Nov).
//
// 1. Frozen per-leg allocations. Before the run starts, every runnable, selected leg gets its own allocation of coaching
//    requests and Start presses (from journey-plan.cjs) and of cleanup requests (supplied), and the whole of it is
//    reserved against the run's ceiling at once. A run whose allocations don't fit is refused before anything is sent;
//    a lowered coaching ceiling drops whole legs before the start (they report NOT RUN), never mid-run. The allocations
//    are frozen: nothing reassigns them once the run has started.
// 2. Atomic reservation. `reserve` is synchronous: the check and the count happen in one step with no await between
//    them, so concurrent senders can never both take the last unit. `send` reserves first and only then awaits the
//    action, so a refused action never starts.
// 3. No retry borrowing. A leg draws only on its own allocation. A reservation is final (there is no release), so a
//    retry needs a unit of its own; past the allocation it is refused, the leg's budget row FAILs and the leg sends
//    nothing more of that kind. It can't draw on another leg, another journey or the cleanup capacity.
// 4. Worst case for probes. J1.e's expired-token coaching probe is reserved as one coaching request (up to 3 provider
//    calls) before the run starts, though the server should refuse it before any provider work.
// 5. Protected cleanup. Cleanup requests come from a separate per-leg pool that ordinary work can't reserve from, and
//    a leg that ran out of ordinary budget can still clean up within its own cleanup allocation.
const { ALL_LEGS, legById } = require('./journey-plan.cjs');
const { runnable } = require('./limits.cjs');
const COACHING_CEILING_ENV = 'NIGHTLY_COACHING_CAP';
/** The kinds ordinary work reserves. Cleanup is reserved only through `reserveCleanup`. */
const ORDINARY_KINDS = Object.freeze(['coaching', 'starts']);
const CLEANUP = 'cleanup';
const isWhole = (n) => Number.isInteger(n) && n >= 0;
/** Reads an optional lower coaching ceiling. Missing means the calculated minimum; it may be lowered, never raised. */
function coachingCeilingFromEnv(env, minimum) {
    if (!isWhole(minimum))
        throw new Error(`invalid calculated minimum ${minimum}`);
    const raw = env[COACHING_CEILING_ENV];
    if (raw === undefined || raw === '')
        return minimum;
    if (!/^\d+$/.test(raw.trim()))
        throw new Error(`${COACHING_CEILING_ENV} must be a whole number, got ${JSON.stringify(raw)}`);
    const cap = Number(raw.trim());
    if (cap > minimum)
        throw new Error(`${COACHING_CEILING_ENV}=${cap} is above the ${minimum} requests this run's legs need; a higher cap buys no signal`);
    return cap;
}
/**
 * The allocations for one run, fixed before it starts.
 * - `satisfiedGates`: gate kinds the runner established as met. A gated leg gets no allocation and reports NOT RUN.
 * - `selected`: the legs asked for (default all).
 * - `cleanup`: a Map from leg id to that leg's cleanup requests. Every allocated leg needs an entry: a missing one leaves
 *   the run unbudgeted (refused) rather than guessed.
 * - `coachingCeiling`: optional, at most the legs' total. Legs are dropped whole, last in plan order first (and any leg
 *   that needs a dropped one), until the coaching allocations fit.
 */
function planRunBudget({ satisfiedGates, selected = ALL_LEGS.map((l) => l.id), cleanup, coachingCeiling } = {}) {
    if (!(satisfiedGates instanceof Set))
        throw new Error('satisfiedGates must be a Set');
    if (!(cleanup instanceof Map))
        throw new Error('cleanup must be a Map from leg id to cleanup requests');
    for (const id of selected)
        legById(id);
    const notAllocated = new Map();
    let legs = [];
    for (const l of ALL_LEGS) {
        if (!selected.includes(l.id))
            notAllocated.set(l.id, 'not selected for this run');
        else if (!runnable(l, satisfiedGates))
            notAllocated.set(l.id, `gated: ${l.gates.filter((g) => !satisfiedGates.has(g.kind)).map((g) => g.kind).join(', ')}`);
        else
            legs.push(l);
    }
    const need = legs.reduce((n, l) => n + l.coachingReserve, 0);
    const ceiling = coachingCeiling === undefined ? need : coachingCeiling;
    if (!isWhole(ceiling))
        throw new Error(`coaching ceiling must be a whole number >= 0, got ${ceiling}`);
    if (ceiling > need)
        throw new Error(`coaching ceiling ${ceiling} is above the ${need} requests the runnable legs need; a higher ceiling buys no signal`);
    let total = need;
    const drop = (l, reason) => {
        legs = legs.filter((x) => x !== l);
        notAllocated.set(l.id, reason);
        total -= l.coachingReserve;
    };
    for (let i = legs.length - 1; total > ceiling && i >= 0; i -= 1) {
        const l = legs[i];
        if (l.coachingReserve > 0)
            drop(l, `left out before the run: the lowered coaching ceiling of ${ceiling} does not cover it`);
    }
    // A leg whose dependency got no allocation can't pass, so it gets none either (its allocation is never stranded).
    for (let changed = true; changed;) {
        changed = false;
        for (const l of [...legs]) {
            const missing = l.needs.find((d) => notAllocated.has(d));
            if (missing) {
                drop(l, `left out before the run: it needs ${missing}, which has no allocation`);
                changed = true;
            }
        }
    }
    const allocations = new Map();
    for (const l of legs) {
        const c = cleanup.get(l.id);
        if (!isWhole(c))
            throw new Error(`${l.id}: no cleanup allocation (got ${c}); a run without one is not budgeted`);
        allocations.set(l.id, { coaching: l.coachingReserve, starts: l.startPresses, [CLEANUP]: c });
    }
    return new RunBudget(allocations, notAllocated);
}
class RunBudget {
    #alloc;
    #notAllocated;
    #used = new Map();
    #refused = new Map();
    #stopped = new Set();
    #cleanupOverrun = new Set();
    #seq = 0;
    constructor(allocations, notAllocated = new Map()) {
        const alloc = new Map();
        for (const [id, a] of allocations) {
            legById(id);
            const frozen = Object.freeze({ coaching: a.coaching, starts: a.starts, [CLEANUP]: a[CLEANUP] });
            for (const [k, n] of Object.entries(frozen))
                if (!isWhole(n))
                    throw new Error(`${id}: ${k} allocation must be a whole number >= 0, got ${n}`);
            alloc.set(id, frozen);
            this.#used.set(id, { coaching: 0, starts: 0, [CLEANUP]: 0 });
            this.#refused.set(id, { coaching: 0, starts: 0, [CLEANUP]: 0 });
        }
        for (const id of notAllocated.keys())
            if (alloc.has(id))
                throw new Error(`${id} is both allocated and left out`);
        this.#alloc = alloc;
        this.#notAllocated = new Map(notAllocated);
    }
    /** The whole run's reservation, fixed at the start: the sum of every leg's allocation per kind. */
    totals() {
        const t = { coaching: 0, starts: 0, [CLEANUP]: 0 };
        for (const a of this.#alloc.values())
            for (const k of Object.keys(t))
                t[k] += a[k];
        return Object.freeze(t);
    }
    /** A leg's frozen allocation, or null when it got none. */
    allocationOf(legId) {
        legById(legId);
        return this.#alloc.get(legId) ?? null;
    }
    #take(legId, kind) {
        const a = this.#alloc.get(legId);
        const used = this.#used.get(legId);
        if (used[kind] >= a[kind]) {
            this.#refused.get(legId)[kind] += 1;
            return { granted: false, reason: `${legId} has used its ${kind} allocation of ${a[kind]}` };
        }
        used[kind] += 1;
        this.#seq += 1;
        return { granted: true, token: Object.freeze({ legId, kind, n: used[kind], seq: this.#seq }) };
    }
    /**
     * Reserves one unit of ordinary work for a leg, synchronously, before the action is sent. A refusal past the leg's
     * allocation fails its budget row and stops its ordinary work for the rest of the run; cleanup stays available.
     */
    reserve(legId, kind) {
        legById(legId);
        if (!ORDINARY_KINDS.includes(kind))
            throw new Error(`${kind} is not ordinary work; cleanup is reserved only with reserveCleanup`);
        if (!this.#alloc.has(legId))
            return { granted: false, reason: `${legId} has no allocation: ${this.#notAllocated.get(legId) ?? 'not planned'}` };
        if (this.#stopped.has(legId)) {
            this.#refused.get(legId)[kind] += 1;
            return { granted: false, reason: `${legId}'s ordinary work was stopped after it exceeded its allocation` };
        }
        const r = this.#take(legId, kind);
        if (!r.granted)
            this.#stopped.add(legId);
        return r;
    }
    /** Reserves one cleanup request from the leg's protected pool. Ordinary work never reaches this pool. */
    reserveCleanup(legId) {
        legById(legId);
        if (!this.#alloc.has(legId))
            return { granted: false, reason: `${legId} has no allocation: ${this.#notAllocated.get(legId) ?? 'not planned'}` };
        const r = this.#take(legId, CLEANUP);
        if (!r.granted)
            this.#cleanupOverrun.add(legId);
        return r;
    }
    /** Reserves, then runs the action. A refused action is never started. */
    async send(legId, kind, action) {
        const r = kind === CLEANUP ? this.reserveCleanup(legId) : this.reserve(legId, kind);
        if (!r.granted)
            return { sent: false, reason: r.reason };
        return { sent: true, value: await action(r.token) };
    }
    /** What leg-verdicts.cjs needs: whether the leg had an allocation and which kinds it overran. */
    legBudget(legId) {
        legById(legId);
        if (!this.#alloc.has(legId))
            return Object.freeze({ allocated: false, reason: this.#notAllocated.get(legId) ?? 'not planned', overrun: Object.freeze([]) });
        const refused = this.#refused.get(legId);
        const overrun = Object.keys(refused).filter((k) => refused[k] > 0);
        return Object.freeze({ allocated: true, reason: 'allocated before the run', overrun: Object.freeze(overrun) });
    }
    /** The leg's budget row: FAIL when it asked for more than its allocation of any kind, cleanup included. */
    legBudgetRow(legId) {
        const b = this.legBudget(legId);
        if (!b.allocated)
            return { outcome: 'NOT RUN', reason: b.reason };
        return {
            outcome: b.overrun.length > 0 ? 'FAIL' : 'PASS',
            allocated: this.#alloc.get(legId), used: { ...this.#used.get(legId) }, refused: { ...this.#refused.get(legId) },
        };
    }
}

module.exports = { CLEANUP, COACHING_CEILING_ENV, ORDINARY_KINDS, RunBudget, coachingCeilingFromEnv, planRunBudget };
