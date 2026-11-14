"use strict";
// Nightly AHT suite: the coaching hard stop, enforced PER JOURNEY (#1864 at 098f0ae, §6).
//
// Coaching is the run's only paid call: the review of each saved take sends one request, and the existing
// `coaching request budget` rows allow at most one per saved take. A journey's cap is the coaching its runnable,
// selected legs need (the catalog's minimum takes); the run's total is the sum: 31 when every leg runs, 30 while J7.a is
// on hold (Akin, 14 Nov: least resources that still give a truthful signal; 31 is a calculated proposal, not fixed).
//
// The harness asks `admit` before a coaching request leaves the browser and aborts it when refused, so no provider work
// happens. A request past a journey's cap (an automatic retry, say) is refused, fails that journey's budget row, and stops
// that journey's remaining coaching legs (NOT RUN). It can never use another journey's allowance. A lower run cap may be
// set; it never goes higher, and whatever it leaves uncovered is NOT RUN.
const { ALL_LEGS, JOURNEY_IDS } = require('./journey-plan.cjs');
const COACHING_CAP_ENV = 'NIGHTLY_COACHING_CAP';
const runnable = (satisfiedGates, selected) => ALL_LEGS.filter((l) => selected.includes(l.id) && l.gates.every((g) => satisfiedGates.has(g.kind)));
/** Each journey's cap: the coaching its runnable, selected legs need. A gated or unselected leg adds nothing. */
function journeyCoachingCaps(satisfiedGates, selected = ALL_LEGS.map((l) => l.id)) {
    const legs = runnable(satisfiedGates, selected);
    return new Map(JOURNEY_IDS.map((j) => [j, legs.filter((l) => l.journey === j).reduce((n, l) => n + l.coachingRequests, 0)]));
}
/** The least total that still gives every runnable leg its coaching. */
function minimumCoachingCap(satisfiedGates, selected) {
    return [...journeyCoachingCaps(satisfiedGates, selected).values()].reduce((n, c) => n + c, 0);
}
/** Reads an optional lower run total. Missing means the calculated minimum; it may be lowered, never raised. */
function coachingCapFromEnv(env, minimum) {
    if (!Number.isInteger(minimum) || minimum < 0)
        throw new Error(`invalid calculated minimum ${minimum}`);
    const raw = env[COACHING_CAP_ENV];
    if (raw === undefined || raw === '')
        return minimum;
    if (!/^\d+$/.test(raw.trim()))
        throw new Error(`${COACHING_CAP_ENV} must be a whole number, got ${JSON.stringify(raw)}`);
    const cap = Number(raw.trim());
    if (cap > minimum) {
        throw new Error(`${COACHING_CAP_ENV}=${cap} is above the ${minimum} requests this run's legs need; a higher cap buys no signal`);
    }
    return cap;
}
class CoachingBudget {
    caps;
    runCap;
    sentBy = new Map();
    /** Refusals past the journey's own cap: these fail its budget row. */
    overCapBy = new Map();
    /** Journeys with any refused request: their later coaching legs are NOT RUN. */
    stopped = new Set();
    total = 0;
    constructor(caps, runCap = [...caps.values()].reduce((n, c) => n + c, 0)) {
        this.caps = caps;
        this.runCap = runCap;
        for (const [j, c] of caps)
            if (!Number.isInteger(c) || c < 0)
                throw new Error(`${j}: coaching cap must be a whole number >= 0, got ${c}`);
        if (!Number.isInteger(runCap) || runCap < 0)
            throw new Error(`run coaching cap must be a whole number >= 0, got ${runCap}`);
    }
    capOf(journey) {
        const c = this.caps.get(journey);
        if (c === undefined)
            throw new Error(`unknown journey ${journey}`);
        return c;
    }
    /** Called once per coaching request, before it is sent. A refusal stops the journey's coaching for the rest of the run. */
    admit(journey) {
        const cap = this.capOf(journey);
        const sent = this.sentBy.get(journey) ?? 0;
        if (sent >= cap) {
            this.overCapBy.set(journey, (this.overCapBy.get(journey) ?? 0) + 1);
            this.stopped.add(journey);
            return { admitted: false, reason: `${journey} reached its coaching cap of ${cap}` };
        }
        if (this.stopped.has(journey))
            return { admitted: false, reason: `${journey}'s coaching was already stopped` };
        if (this.total >= this.runCap) {
            this.stopped.add(journey);
            return { admitted: false, reason: `the run's lowered coaching cap of ${this.runCap} was reached` };
        }
        this.sentBy.set(journey, sent + 1);
        this.total += 1;
        return { admitted: true, journeyCount: sent + 1 };
    }
    /** True once a request of this journey was refused: its later coaching legs are NOT RUN. */
    journeyStopped(journey) { return this.stopped.has(journey); }
    get sent() { return this.total; }
    /**
     * The journey's budget row: FAIL when it tried to send more than its own cap. A refusal by a deliberately lowered
     * run cap is not the journey's fault: it leaves the row alone and turns the journey's remaining coaching legs NOT RUN.
     */
    journeyBudgetRow(journey) {
        const max = this.capOf(journey);
        const sent = this.sentBy.get(journey) ?? 0;
        const overCap = this.overCapBy.get(journey) ?? 0;
        return { outcome: overCap > 0 || sent > max ? 'FAIL' : 'PASS', sent, overCap, max };
    }
}

module.exports = { COACHING_CAP_ENV, CoachingBudget, coachingCapFromEnv, journeyCoachingCaps, minimumCoachingCap };
