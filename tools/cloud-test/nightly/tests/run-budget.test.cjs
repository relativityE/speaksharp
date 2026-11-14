"use strict";
// Nightly AHT suite: the run budget meets the #1864 §6 contract and Sam's reviews: the run request names its legs and
// is refused when a ceiling can't cover them; frozen allocations; atomic reservation in one process and across
// processes; no retry borrowing; J1.e's probe reserved at its worst case; a protected, structural cleanup reserve.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { describe, it } = require('node:test');
const { expect } = require('./expect-lite.cjs');
const { ALL_LEGS, rowsForLeg } = require('../journey-plan.cjs');
const { allGateKinds, countedLimits } = require('../limits.cjs');
const { cleanupReserve } = require('../cleanup-plan.cjs');
const { VerdictLedger, legVerdict, runVerdict } = require('../leg-verdicts.cjs');
const {
    CLEANUP, COACHING_CEILING_ENV, RunBudget, RunRefused, coachingCeilingFromEnv, openSharedRunBudget, planRunBudget, writeSharedPlan,
} = require('../run-budget.cjs');
const EVERY_GATE = allGateKinds();
const TODAY = new Set();
const ALL_IDS = ALL_LEGS.map((l) => l.id);
const NO_J2 = ALL_IDS.filter((id) => id !== 'J2');
const plan = (o = {}) => planRunBudget({ satisfiedGates: TODAY, selected: ALL_IDS, ...o });
const sumReserves = (journeys) => journeys.reduce((n, j) => n + cleanupReserve(j).requests, 0);

describe('frozen allocations, reserved before the run', () => {
    it('reserves the whole run up front: 32 coaching and 43 starts with every leg, 30 and 40 today', () => {
        const all = plan({ satisfiedGates: EVERY_GATE, selected: NO_J2 });
        expect(all.totals().coaching).toBe(32);
        expect(all.totals().starts).toBe(43);
        const today = plan();
        expect(today.totals().coaching).toBe(30);
        expect(today.totals().starts).toBe(40);
        expect(today.totals().coaching).toBe(countedLimits(TODAY).coachingRequests);
        expect(today.totals().cleanupRequests).toBe(countedLimits(TODAY).cleanupRequests);
    });
    it('gives each leg its own allocation, and none to a gated leg', () => {
        const b = plan();
        expect(b.allocationOf('J3.a')).toEqual({ coaching: 7, starts: 7 });
        expect(b.allocationOf('J1.c')).toEqual({ coaching: 0, starts: 1 });
        expect(b.allocationOf('J7.a')).toBe(null);
        expect(b.legBudget('J7.a').allocated).toBe(false);
    });
    it('freezes every allocation and reserve, so nothing can be moved once the run has started', () => {
        const b = plan();
        const a = b.allocationOf('J6');
        expect(Object.isFrozen(a)).toBe(true);
        expect(() => { a.coaching = 99; }).toThrow();
        expect(() => { b.cleanupReserveOf('J6').requests = 999; }).toThrow();
        expect(plan().allocationOf('J6').coaching).toBe(2);
    });
    it('refuses a ceiling above what the named legs need, or not a whole number', () => {
        expect(() => plan({ coachingCeiling: 31 })).toThrow(RunRefused);
        expect(() => plan({ coachingCeiling: 2.5 })).toThrow(RunRefused);
        expect(() => new RunBudget({ legs: { J6: { coaching: -1, starts: 0 } }, cleanup: { J6: { requests: 1, seconds: 1 } } })).toThrow();
    });
});
describe('the run request names its legs; the budget never chooses them', () => {
    it('refuses a run that names no legs', () => {
        expect(() => planRunBudget({ satisfiedGates: TODAY })).toThrow(RunRefused);
        expect(() => planRunBudget({ satisfiedGates: TODAY, selected: [] })).toThrow(RunRefused);
        expect(() => plan({ selected: ['J6', 'J6'] })).toThrow(RunRefused);
        expect(() => plan({ selected: ['J10'] })).toThrow();
    });
    it('refuses a lower ceiling that does not cover the named legs, and drops nothing', () => {
        let err;
        try {
            plan({ coachingCeiling: 28 });
        }
        catch (e) {
            err = e;
        }
        expect(err instanceof RunRefused).toBe(true);
        expect(err.message).toContain('need 30 coaching requests, above the ceiling of 28; name fewer legs');
    });
    it('runs a lower ceiling when the request names exactly the legs it covers', () => {
        const b = plan({ selected: ALL_IDS.filter((id) => id !== 'J8.b' && id !== 'J8.c'), coachingCeiling: 28 });
        expect(b.totals().coaching).toBe(28);
        expect(b.allocationOf('J8.b')).toBe(null);
        expect(b.legBudget('J8.b').reason).toBe('not named in the run request');
        expect(b.allocationOf('J7.c')).toEqual({ coaching: 1, starts: 3 });
    });
    it('refuses a leg named without the legs it needs', () => {
        for (const [leg, dep] of [['J1.b', 'J1.a'], ['J1.f', 'J1.e'], ['J8.c', 'J8.b']]) {
            let err;
            try {
                plan({ selected: [leg] });
            }
            catch (e) {
                err = e;
            }
            expect(err instanceof RunRefused).toBe(true);
            expect(err.message).toContain(`${leg} is named without ${dep}`);
        }
        expect(plan({ selected: ['J1.a', 'J1.b'] }).allocationOf('J1.b')).toEqual({ coaching: 0, starts: 0 });
    });
    it('gives no allocation to a named leg whose dependency is gated, and says why', () => {
        const b = plan({ satisfiedGates: new Set(['no-harness-case']), selected: ['J8.a', 'J8.b', 'J8.c'] });
        expect(b.allocationOf('J8.b')).toEqual({ coaching: 2, starts: 2 });
        const gated = plan({ selected: ['J1.e', 'J1.f'] });
        expect(gated.allocationOf('J1.f')).toBe(null);
        expect(gated.legBudget('J1.f').reason).toContain('gated');
    });
    it('gives no allocation to a named leg whose dependency got none, even when the leg itself is runnable', () => {
        // No leg in today's catalog has a gated dependency without sharing its gate, so the gate is put on J8.b alone
        // through the runnable check the budget reads, on a fresh copy of the module.
        const limits = require('../limits.cjs');
        const saved = limits.runnable;
        limits.runnable = (l, g) => l.id !== 'J8.b' && saved(l, g);
        try {
            delete require.cache[require.resolve('../run-budget.cjs')];
            const fresh = require('../run-budget.cjs');
            const b = fresh.planRunBudget({ satisfiedGates: new Set(['no-harness-case']), selected: ['J8.a', 'J8.b', 'J8.c'] });
            expect(b.allocationOf('J8.a') === null).toBe(false);
            expect(b.allocationOf('J8.c')).toBe(null);
            expect(b.legBudget('J8.c').reason).toBe('needs J8.b, which has no allocation');
        }
        finally {
            limits.runnable = saved;
            delete require.cache[require.resolve('../run-budget.cjs')];
        }
    });
    it('reads a lower ceiling from the environment as a whole number; the plan refuses one that does not match the named legs', () => {
        expect(coachingCeilingFromEnv({})).toBe(undefined);
        expect(coachingCeilingFromEnv({ [COACHING_CEILING_ENV]: '' })).toBe(undefined);
        expect(coachingCeilingFromEnv({ [COACHING_CEILING_ENV]: '12' })).toBe(12);
        expect(coachingCeilingFromEnv({ [COACHING_CEILING_ENV]: ' 0 ' })).toBe(0);
        for (const bad of ['3.5', '-1', 'abc', '1e3'])
            expect(() => coachingCeilingFromEnv({ [COACHING_CEILING_ENV]: bad })).toThrow();
        expect(plan({ coachingCeiling: coachingCeilingFromEnv({}) }).totals().coaching).toBe(30);
        expect(plan({ coachingCeiling: coachingCeilingFromEnv({ [COACHING_CEILING_ENV]: '30' }) }).totals().coaching).toBe(30);
        for (const other of ['28', '31', '1000'])
            expect(() => plan({ coachingCeiling: coachingCeilingFromEnv({ [COACHING_CEILING_ENV]: other }) })).toThrow(RunRefused);
    });
    it('lists the allocated legs as the run\'s scope for the runnable-legs summary', () => {
        expect(plan().allocatedLegs()).toEqual(countedLimits(TODAY).legs);
    });
});
describe('J1.e probe reserved at its worst case', () => {
    it('reserves one coaching request for the expired-token probe once J1.e can run, and nothing more', () => {
        const b = plan({ satisfiedGates: EVERY_GATE, selected: NO_J2 });
        expect(b.allocationOf('J1.e')).toEqual({ coaching: 1, starts: 0 });
        expect(b.reserve('J1.e', 'coaching').granted).toBe(true);
        expect(b.reserve('J1.e', 'coaching').granted).toBe(false);
        expect(b.legBudgetRow('J1.e').outcome).toBe('FAIL');
    });
    it('reserves nothing for it while J1.e is gated', () => {
        expect(plan().allocationOf('J1.e')).toBe(null);
        expect(plan().reserve('J1.e', 'coaching').granted).toBe(false);
    });
});
describe('atomic reservation', () => {
    it('lets exactly the allocation through when many sends race', async () => {
        const b = plan();
        let started = 0;
        const action = async () => { started += 1; await new Promise((r) => setImmediate(r)); return 'sent'; };
        const results = await Promise.all(Array.from({ length: 20 }, () => b.send('J3.a', 'coaching', action)));
        expect(started).toBe(7);
        expect(results.filter((r) => r.sent)).toHaveLength(7);
        expect(results.filter((r) => !r.sent)).toHaveLength(13);
        expect(b.legBudgetRow('J3.a').outcome).toBe('FAIL');
    });
    it('never starts a refused action', async () => {
        const b = plan();
        let started = 0;
        expect((await b.send('J7.a', 'coaching', async () => { started += 1; })).sent).toBe(false);
        expect(started).toBe(0);
    });
});
describe('no retry borrowing', () => {
    it("refuses a leg's retry past its own allocation and stops its ordinary work, without touching any other leg", () => {
        const b = plan();
        expect([1, 2].map(() => b.reserve('J6', 'coaching').granted)).toEqual([true, true]);
        expect(b.reserve('J6', 'coaching').granted).toBe(false);
        expect(b.reserve('J6', 'starts').granted).toBe(false);
        expect(b.legBudgetRow('J6').outcome).toBe('FAIL');
        // The later Start press is refused because the leg stopped, not counted as a Start overrun of its own.
        expect(b.legBudget('J6').overrun).toEqual(['coaching']);
        expect(b.legBudgetRow('J6').refusedAfterStop).toBe(1);
        expect([1, 2].map(() => b.reserve('J4.a', 'coaching').granted)).toEqual([true, true]);
        expect(b.legBudgetRow('J4.a').outcome).toBe('PASS');
        expect(b.allocationOf('J4.b').coaching).toBe(2);
    });
    it('keeps the other legs of the same journey on their own allocations', () => {
        const b = plan();
        b.reserve('J4.a', 'coaching');
        b.reserve('J4.a', 'coaching');
        expect(b.reserve('J4.a', 'coaching').granted).toBe(false);
        expect([1, 2].map(() => b.reserve('J4.b', 'coaching').granted)).toEqual([true, true]);
        expect(b.reserve('J4.b', 'coaching').granted).toBe(false);
    });
    it('has no way to give a reservation back, so a retry always needs a unit of its own', () => {
        const b = plan();
        expect(b.release).toBe(undefined);
        expect(b.transfer).toBe(undefined);
    });
    it('passes a leg that used exactly its allocation', () => {
        const b = plan();
        for (let i = 0; i < 4; i += 1)
            expect(b.reserve('J3.b', 'starts').granted).toBe(true);
        expect(b.legBudgetRow('J3.b').outcome).toBe('PASS');
    });
});
describe('protected cleanup reserve', () => {
    it('sizes each journey\'s reserve to its structural worst case, once per journey with an allocated leg', () => {
        const b = plan();
        for (const j of ['J1', 'J3', 'J4', 'J5', 'J6', 'J7', 'J8'])
            expect(b.cleanupReserveOf(j)).toEqual({ requests: cleanupReserve(j).requests, seconds: cleanupReserve(j).seconds });
        expect(b.cleanupReserveOf('J2')).toBe(null);
        expect(b.cleanupReserveOf('J9')).toBe(null);
        expect(b.totals().cleanupRequests).toBe(sumReserves(['J1', 'J3', 'J4', 'J5', 'J6', 'J7', 'J8']));
    });
    it('refuses a run whose journey has no defined cleanup step (J2), rather than guessing one', () => {
        expect(() => plan({ satisfiedGates: EVERY_GATE })).toThrow(RunRefused);
    });
    it('keeps ordinary work out of the cleanup reserve', () => {
        expect(() => plan().reserve('J6', CLEANUP)).toThrow();
    });
    it('lets a leg whose ordinary work stopped still clean up, up to its journey\'s reserve', () => {
        const b = plan();
        b.reserve('J6', 'coaching');
        b.reserve('J6', 'coaching');
        b.reserve('J6', 'coaching');
        const n = cleanupReserve('J6').requests;
        for (let i = 0; i < n; i += 1)
            expect(b.reserveCleanup('J6').granted).toBe(true);
        expect(b.reserveCleanup('J6').granted).toBe(false);
    });
    it('shares one reserve across a journey\'s legs, so two legs cannot take more than the journey\'s worst case', () => {
        const b = plan();
        const n = cleanupReserve('J8').requests;
        for (let i = 0; i < n; i += 1)
            expect(b.reserveCleanup(i % 2 ? 'J8.a' : 'J8.b').granted).toBe(true);
        expect(b.reserveCleanup('J8.a').granted).toBe(false);
        expect(b.cleanupExhausted('J8')).toBe(true);
        expect(b.cleanupExhausted('J6')).toBe(false);
    });
    it('fails the budget row of the leg whose cleanup asked past the reserve', () => {
        const b = plan();
        for (let i = 0; i < cleanupReserve('J5').requests; i += 1)
            b.reserveCleanup('J5.a');
        expect(b.legBudgetRow('J5.a').outcome).toBe('PASS');
        b.reserveCleanup('J5.a');
        expect(b.legBudgetRow('J5.a').outcome).toBe('FAIL');
        expect(b.legBudget('J5.a').overrun).toEqual([CLEANUP]);
        expect(b.reserve('J5.a', 'coaching').granted).toBe(true);
    });
});
describe('one budget shared across workers', () => {
    const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nightly-budget-'));
    const shared = (o) => {
        const dir = tmp();
        writeSharedPlan(dir, plan(o));
        return dir;
    };
    const worker = (dir, leg, kind) => new Promise((resolve, reject) => {
        const code = `const { openSharedRunBudget } = require(${JSON.stringify(path.resolve(__dirname, '../run-budget.cjs'))});
            const b = openSharedRunBudget(process.argv[1]);
            const r = process.argv[3] === 'cleanup' ? b.reserveCleanup(process.argv[2]) : b.reserve(process.argv[2], process.argv[3]);
            process.stdout.write(JSON.stringify(r.granted));`;
        const p = spawn(process.execPath, ['-e', code, dir, leg, kind], { stdio: ['ignore', 'pipe', 'inherit'] });
        let out = '';
        p.stdout.on('data', (d) => { out += d; });
        p.on('error', reject);
        p.on('close', (c) => (c === 0 ? resolve(JSON.parse(out)) : reject(new Error(`worker exited ${c}`))));
    });
    it('lets exactly the allocation through when separate processes race for the last units', async () => {
        const dir = shared();
        const granted = await Promise.all(Array.from({ length: 8 }, () => worker(dir, 'J6', 'coaching')));
        expect(granted.filter(Boolean)).toHaveLength(2);
        const b = openSharedRunBudget(dir);
        expect(b.legBudgetRow('J6').outcome).toBe('FAIL');
        expect(b.legBudgetRow('J6').used.coaching).toBe(2);
    });
    it('holds the cleanup reserve across processes too', async () => {
        const dir = shared();
        const n = cleanupReserve('J6').requests;
        const granted = await Promise.all(Array.from({ length: n + 3 }, () => worker(dir, 'J6', 'cleanup')));
        expect(granted.filter(Boolean)).toHaveLength(n);
        expect(openSharedRunBudget(dir).cleanupExhausted('J6')).toBe(true);
    });
    it('keeps a killed runner\'s reservations: a reopened budget still counts them, and nothing is given back', () => {
        const dir = shared();
        expect(openSharedRunBudget(dir).reserve('J6', 'coaching').granted).toBe(true);
        expect(openSharedRunBudget(dir).reserve('J6', 'coaching').granted).toBe(true);
        expect(openSharedRunBudget(dir).reserve('J6', 'coaching').granted).toBe(false);
    });
    it('breaks a lock left by a dead process, but refuses rather than waits forever on a live one', () => {
        const dir = shared();
        fs.mkdirSync(path.join(dir, 'budget.lock'));
        fs.writeFileSync(path.join(dir, 'budget.lock', 'owner.json'), JSON.stringify({ pid: 2 ** 22 + 12345, host: os.hostname() }));
        expect(openSharedRunBudget(dir).reserve('J6', 'coaching').granted).toBe(true);
        fs.mkdirSync(path.join(dir, 'budget.lock'));
        fs.writeFileSync(path.join(dir, 'budget.lock', 'owner.json'), JSON.stringify({ pid: process.pid, host: os.hostname() }));
        const r = openSharedRunBudget(dir, { lockTimeoutMs: 50 }).reserve('J6', 'coaching');
        expect(r.granted).toBe(false);
        expect(r.reason).toContain('lock was not available');
        fs.rmSync(path.join(dir, 'budget.lock'), { recursive: true });
    });
    it('after a write cut short by a crash, sends no more test work but still cleans up, counting the torn write against the reserve', () => {
        const dir = shared();
        openSharedRunBudget(dir).reserve('J6', 'coaching');
        fs.appendFileSync(path.join(dir, 'budget-journal.jsonl'), '{"t":"grant","leg":"J6"');
        const b = openSharedRunBudget(dir);
        const r = b.reserve('J4.a', 'coaching');
        expect(r.granted).toBe(false);
        expect(r.reason).toContain('cut short');
        expect(b.journalTorn()).toBe(1);
        // The journal is whole again: the partial line is replaced by one torn event.
        const lines = fs.readFileSync(path.join(dir, 'budget-journal.jsonl'), 'utf8').split('\n');
        expect(lines.pop()).toBe('');
        expect(JSON.parse(lines[lines.length - 1])).toEqual({ t: 'torn' });
        const n = cleanupReserve('J6').requests;
        let granted = 0;
        for (let i = 0; i < n + 2; i += 1)
            granted += b.reserveCleanup('J6').granted ? 1 : 0;
        expect(granted).toBe(n - 1);
        expect(b.cleanupExhausted('J6')).toBe(true);
        expect(b.legBudgetRow('J4.a').outcome).toBe('PASS');
    });
    it('refuses a journal line it cannot read, and a plan that was altered', () => {
        const dir = shared();
        openSharedRunBudget(dir).reserve('J6', 'coaching');
        fs.appendFileSync(path.join(dir, 'budget-journal.jsonl'), '{"t":\n');
        const b = openSharedRunBudget(dir);
        const r = b.reserve('J4.a', 'coaching');
        expect(r.granted).toBe(false);
        expect(r.reason).toContain('unreadable');
        // Reads that can't be made fail closed: cleanup reads as incomplete and the leg's budget as not known.
        expect(b.cleanupExhausted('J4')).toBe(true);
        expect(b.legBudget('J4.a').allocated).toBe(false);
        expect(b.legBudgetRow('J4.a').outcome).toBe('HOLD');
        expect(b.journalTorn()).toBe(null);
        const dir2 = shared();
        const f = path.join(dir2, 'budget-plan.json');
        const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
        doc.plan.legs.J6.coaching = 50;
        fs.writeFileSync(f, JSON.stringify(doc));
        expect(() => openSharedRunBudget(dir2)).toThrow(RunRefused);
    });
    it('records a cleanup refused for want of the lock, so the journey reads as incomplete', () => {
        const dir = shared();
        fs.mkdirSync(path.join(dir, 'budget.lock'));
        fs.writeFileSync(path.join(dir, 'budget.lock', 'owner.json'), JSON.stringify({ pid: process.pid, host: os.hostname(), token: 'held' }));
        const b = openSharedRunBudget(dir, { lockTimeoutMs: 30 });
        expect(b.reserveCleanup('J6').granted).toBe(false);
        fs.rmSync(path.join(dir, 'budget.lock'), { recursive: true });
        expect(b.cleanupExhausted('J6')).toBe(true);
        expect(openSharedRunBudget(dir).cleanupExhausted('J6')).toBe(true);
        expect(openSharedRunBudget(dir).cleanupExhausted('J5')).toBe(false);
    });
    it('never removes a lock it does not hold when it releases', () => {
        const dir = shared();
        const lockDir = path.join(dir, 'budget.lock');
        const b = openSharedRunBudget(dir);
        // Another worker takes the lock over while this step holds it (as a wrongly broken lock would be).
        const { _fileStore } = require('../run-budget.cjs');
        const store = _fileStore(dir);
        store.transact(() => {
            fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, host: os.hostname(), token: 'someone-else' }));
            return { result: null };
        });
        expect(fs.existsSync(lockDir)).toBe(true);
        fs.rmSync(lockDir, { recursive: true });
        expect(b.reserve('J6', 'coaching').granted).toBe(true);
    });
    it('never breaks a lock that a live worker took after another worker judged the old one stale', () => {
        const dir = shared();
        const lockDir = path.join(dir, 'budget.lock');
        const { _fileStore } = require('../run-budget.cjs');
        const store = _fileStore(dir);
        // A worker read a dead owner, and before it could break the lock, a live worker took a fresh lock.
        const dead = { pid: 2 ** 22 + 54321, host: os.hostname(), token: 'dead' };
        fs.mkdirSync(lockDir);
        fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, host: os.hostname(), token: 'live' }));
        store._breakIfStale(dead);
        expect(fs.existsSync(lockDir)).toBe(true);
        expect(fs.existsSync(path.join(dir, 'budget.lock.break'))).toBe(false);
        // The dead owner itself is broken.
        fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify(dead));
        store._breakIfStale(dead);
        expect(fs.existsSync(lockDir)).toBe(false);
    });
    it('lets exactly the allocation through when separate processes race to break the same dead owner\'s lock', async () => {
        for (let round = 0; round < 3; round += 1) {
            const dir = shared();
            fs.mkdirSync(path.join(dir, 'budget.lock'));
            fs.writeFileSync(path.join(dir, 'budget.lock', 'owner.json'), JSON.stringify({ pid: 2 ** 22 + 54321, host: os.hostname(), token: 'dead' }));
            const granted = await Promise.all(Array.from({ length: 8 }, () => worker(dir, 'J6', 'coaching')));
            expect(granted.filter(Boolean)).toHaveLength(2);
            expect(openSharedRunBudget(dir).legBudgetRow('J6').used.coaching).toBe(2);
            expect(fs.existsSync(path.join(dir, 'budget.lock'))).toBe(false);
        }
    });
    it('writes the plan once: a run directory is never reused', () => {
        const dir = shared();
        expect(() => writeSharedPlan(dir, plan())).toThrow();
    });
});
describe('budget facts in the verdicts', () => {
    const results = (leg, o = 'PASS') => Object.fromEntries(rowsForLeg(leg).map((r) => [r, o]));
    it('fails an overrunning leg and the run, even though its rows passed', () => {
        const b = plan();
        b.reserve('J6', 'coaching');
        b.reserve('J6', 'coaching');
        b.reserve('J6', 'coaching');
        const ledger = new VerdictLedger();
        const v = ledger.record(legVerdict('J6', { prior: ledger.verdicts(), satisfiedGates: EVERY_GATE, results: results('J6'), budget: b.legBudget('J6') }));
        expect(v.outcome).toBe('FAIL');
        ledger.record({ ...v, outcome: 'NOT RUN' });
        expect(runVerdict(ledger.verdicts()).outcome).toBe('FAIL');
    });
    it('reports a leg left out of the run request as NOT RUN', () => {
        const b = plan({ selected: ALL_IDS.filter((id) => id !== 'J8.b' && id !== 'J8.c'), coachingCeiling: 28 });
        const v = legVerdict('J8.b', { prior: new Map(), satisfiedGates: EVERY_GATE, results: undefined, budget: b.legBudget('J8.b') });
        expect(v.outcome).toBe('NOT RUN');
        expect(v.reason).toContain('no budget allocation');
    });
});
