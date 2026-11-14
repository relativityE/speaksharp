"use strict";
// Nightly AHT suite: the cleanup reserve is the structural worst case of the cleanup code as it is, and a run that
// leaves anything behind, or is killed before it can say, keeps the next run out until it is recovered.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const { expect } = require('./expect-lite.cjs');
const { JOURNEYS } = require('../journey-plan.cjs');
const {
    ACCOUNT_DELETION, CLEANUP_REQUEST_DEADLINE_S, CleanupUndefined, SOURCE_COUNTS, cleanupReserve, MAINTAINED_CASES, reserveMinutes, runOwnedAccounts,
} = require('../cleanup-plan.cjs');
const { ADMISSION_LOCK, AdmissionRefused, admitRun, beginRun, recordRecovery, writeCleanupEvidence } = require('../cleanup-evidence.cjs');

const REPO = path.resolve(__dirname, '../../../..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const between = (text, start, end) => {
    const i = text.indexOf(start);
    if (i < 0)
        throw new Error(`${start} not found`);
    return text.slice(i, text.indexOf(end, i));
};

describe('cleanup reserve: structural worst case, read from the cleanup code', () => {
    const cleanupTs = read('tests/live/helpers/runOwnedCleanup.ts');
    const fenceTs = read('tests/live/helpers/feedbackFence.ts');
    it('counts every residue read and pre-delete table the account cleanup makes', () => {
        const residue = between(cleanupTs, 'export const RESIDUE_CHECKS', ']);');
        expect((residue.match(/\{ table: '/g) ?? []).length).toBe(SOURCE_COUNTS.residueChecks);
        const pre = between(cleanupTs, 'export const PRE_DELETE_TABLES', ';');
        expect((pre.match(/'[a-z_]+'/g) ?? []).length).toBe(SOURCE_COUNTS.preDeleteTables);
    });
    it('counts the take reads and the requests in each read that settling the takes makes', () => {
        const settle = between(cleanupTs, 'export async function settleRunOwnedTakes', '\n}\n');
        expect((settle.match(/await readTakes\(/g) ?? []).length).toBe(SOURCE_COUNTS.takeReadsPerSettlement);
        const readTakes = between(cleanupTs, 'async function readTakes', '\n}\n');
        expect((readTakes.match(/await admin\.from\(/g) ?? []).length).toBe(SOURCE_COUNTS.requestsPerTakeRead);
        // One close per open take, and only one: no retry loop around it.
        expect((settle.match(/\.update\(\{ status: 'failed' \}\)/g) ?? []).length).toBe(1);
    });
    it('counts the account reads, the deletion and its check in the account cleanup', () => {
        const fn = between(cleanupTs, 'export async function cleanupRunOwnedAccount', '\n}\n');
        // Before the recovery branch: one getUserById; after the deletion: one more. The recovery branch's own read is
        // the protected recovery route's, not the nightly's.
        const ordinary = fn.slice(fn.indexOf('const { data: got'));
        expect((ordinary.match(/admin\.auth\.admin\.getUserById\(/g) ?? []).length).toBe(3);
        expect((ordinary.match(/admin\.auth\.admin\.deleteUser\(/g) ?? []).length).toBe(1);
        expect(fn).toContain('maxAttempts: 12');
        const counted = ACCOUNT_DELETION.filter((o) => /getUserById/.test(o.op)).length;
        expect(counted).toBe(2);
    });
    it('counts the fence calls a fenced case makes on cleanup', () => {
        for (const rpc of ['close_rwt_feedback_fence_v1', 'clean_rwt_feedback_fence_v1', 'verify_rwt_feedback_fence_v1'])
            expect(fenceTs).toContain(`'${rpc}'`);
        expect(SOURCE_COUNTS.fenceRpcs).toBe(3);
    });
    it('sizes each journey from its accounts (one per harness case today), open takes and fenced cases', () => {
        const perAccount = ACCOUNT_DELETION.reduce((n, o) => n + o.requests, 0);
        expect(perAccount).toBe(33);
        const starts = (j) => JOURNEYS.find((x) => x.id === j).legs.reduce((n, l) => n + l.startPresses, 0);
        expect(runOwnedAccounts(JOURNEYS.find((x) => x.id === 'J6'))).toBe(1);
        expect(runOwnedAccounts(JOURNEYS.find((x) => x.id === 'J5'))).toBe(3);
        // J7: AHT-12, 13 and 14 plus one for J7.d, which has no harness case yet. J1: AHT-01 plus one for J1.e/J1.f;
        // AHT-15 runs on a maintained account the run neither signs up nor deletes.
        expect(runOwnedAccounts(JOURNEYS.find((x) => x.id === 'J7'))).toBe(4);
        expect(runOwnedAccounts(JOURNEYS.find((x) => x.id === 'J1'))).toBe(2);
        expect(MAINTAINED_CASES).toEqual(['AHT-15']);
        expect(cleanupReserve('J6').requests).toBe(perAccount + starts('J6'));
        expect(cleanupReserve('J5').requests).toBe(3 * perAccount + starts('J5'));
        expect(cleanupReserve('J1').requests).toBe(2 * perAccount + starts('J1') + 3);
        expect(cleanupReserve('J8').requests).toBe(3 * perAccount + starts('J8') + 6);
        expect(cleanupReserve('J9').requests).toBe(0);
    });
    it('reads one signup per harness case from the specs as they are', () => {
        for (const spec of ['tests/live/helpers/rwtAdverseJourney.ts', 'tests/live/rwt-save-retry-recovery.live.spec.ts', 'tests/live/rwt-abandon-and-two-tabs.live.spec.ts'])
            expect(read(spec)).toContain('await prepareRunOwnedAccount(');
    });
    it('bounds time by the per-request deadline, so the reserve is a ceiling', () => {
        const r = cleanupReserve('J3');
        expect(r.seconds).toBe(r.requests * CLEANUP_REQUEST_DEADLINE_S);
        expect(reserveMinutes(r)).toBe(Math.ceil(r.seconds / 60));
    });
    it('leaves the id-recovery poll out of the reserve rather than reserving 600 requests', () => {
        // The poll alone is 600 requests per account; no journey's reserve holds even one of it.
        for (const j of ['J1', 'J3', 'J4', 'J5', 'J6', 'J7', 'J8'])
            expect(cleanupReserve(j).requests < 600).toBe(true);
        expect(ACCOUNT_DELETION.some((o) => /list|recover/i.test(o.op))).toBe(false);
    });
    it('refuses to size J2: its Checkout cleanup step is not written', () => {
        expect(() => cleanupReserve('J2')).toThrow(CleanupUndefined);
    });
});

describe('durable cleanup evidence and admission', () => {
    const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nightly-evidence-'));
    const clean = (journey) => ({ journey, reserveExhausted: false, steps: [{ kind: 'account', ref: `acct-${journey}`, action: 'delete', outcome: 'done' }], left: [] });
    const BUDGET = { cleanupExhausted: () => false };
    it('admits the first run, and the next after a complete cleanup', () => {
        const d = dir();
        expect(admitRun(d).admitted).toBe(true);
        beginRun(d, 'run-1', ['J6']);
        expect(writeCleanupEvidence(d, 'run-1', [clean('J6')], BUDGET).cleanup).toBe('complete');
        expect(admitRun(d).admitted).toBe(true);
    });
    it('refuses the next run after a runner was killed before writing its evidence', () => {
        const d = dir();
        beginRun(d, 'run-1', ['J6']);
        const a = admitRun(d);
        expect(a.admitted).toBe(false);
        expect(a.reason).toContain('run-1: started with no cleanup evidence');
    });
    it('refuses the next run when cleanup left something, failed a step or ran out of its reserve', () => {
        for (const j of [
            { ...clean('J6'), left: [{ kind: 'account', ref: 'acct-J6' }] },
            { ...clean('J6'), steps: [{ kind: 'lease', ref: 'lease-1', action: 'release', outcome: 'failed' }] },
            { ...clean('J6'), steps: [{ kind: 'account', ref: 'acct-J6', action: 'delete', outcome: 'not attempted' }] },
            { ...clean('J6'), reserveExhausted: true },
        ]) {
            const d = dir();
            beginRun(d, 'run-1', ['J1', 'J6']);
            expect(writeCleanupEvidence(d, 'run-1', [clean('J1'), j], BUDGET).incompleteJourneys).toEqual(['J6']);
            expect(admitRun(d).admitted).toBe(false);
        }
    });
    it('admits again once the protected recovery route is recorded for that run', () => {
        const d = dir();
        beginRun(d, 'run-1', ['J6']);
        writeCleanupEvidence(d, 'run-1', [{ ...clean('J6'), left: [{ kind: 'account', ref: 'acct-J6' }] }], BUDGET);
        expect(() => recordRecovery(d, 'run-1', '')).toThrow();
        recordRecovery(d, 'run-1', 'recovery-run-77');
        expect(admitRun(d).admitted).toBe(true);
    });
    it('never overwrites evidence, and refuses evidence for a run that never started or that it cannot read back', () => {
        const d = dir();
        expect(() => writeCleanupEvidence(d, 'run-x', [clean('J6')], BUDGET)).toThrow();
        beginRun(d, 'run-1', ['J6']);
        expect(() => beginRun(d, 'run-1', ['J6'])).toThrow();
        expect(() => writeCleanupEvidence(d, 'run-1', [{ ...clean('J6'), left: [{ kind: 'account', ref: 'someone@example.com' }] }], BUDGET)).toThrow();
        expect(() => writeCleanupEvidence(d, 'run-1', [{ journey: 'J10', reserveExhausted: false, steps: [], left: [] }], BUDGET)).toThrow();
        writeCleanupEvidence(d, 'run-1', [clean('J6')], BUDGET);
        expect(() => writeCleanupEvidence(d, 'run-1', [clean('J6')], BUDGET)).toThrow();
        expect(fs.readdirSync(d).filter((n) => n.endsWith('.tmp'))).toEqual([]);
        fs.writeFileSync(path.join(d, 'run-1.cleanup.json'), '{"cleanup":');
        expect(admitRun(d).admitted).toBe(false);
    });
    it('refuses evidence that leaves out or adds a journey the run started with, so empty evidence is never complete', () => {
        const d = dir();
        beginRun(d, 'run-1', ['J1', 'J6']);
        expect(() => writeCleanupEvidence(d, 'run-1', [], BUDGET)).toThrow();
        expect(() => writeCleanupEvidence(d, 'run-1', [clean('J6')], BUDGET)).toThrow();
        expect(() => writeCleanupEvidence(d, 'run-1', [clean('J1'), clean('J6'), clean('J3')], BUDGET)).toThrow();
        expect(admitRun(d).admitted).toBe(false);
        expect(() => beginRun(d, 'run-2')).toThrow();
        expect(() => beginRun(d, 'run-2', ['J6', 'J6'])).toThrow();
    });
    it('marks a journey incomplete when the run budget says its reserve ran out, whatever the caller says', () => {
        const d = dir();
        beginRun(d, 'run-1', ['J1', 'J6']);
        expect(() => writeCleanupEvidence(d, 'run-1', [clean('J1'), clean('J6')])).toThrow();
        const doc = writeCleanupEvidence(d, 'run-1', [clean('J1'), clean('J6')], { cleanupExhausted: (j) => j === 'J6' });
        expect(doc.incompleteJourneys).toEqual(['J6']);
        expect(admitRun(d).admitted).toBe(false);
    });
    it('admits and begins as one step: a second runner is refused, and so is any runner while the admission lock is held', () => {
        const d = dir();
        beginRun(d, 'run-1', ['J6']);
        expect(() => beginRun(d, 'run-2', ['J6'])).toThrow(AdmissionRefused);
        expect(fs.existsSync(path.join(d, 'run-2.started.json'))).toBe(false);
        const e = dir();
        fs.writeFileSync(path.join(e, ADMISSION_LOCK), '{"pid":1}');
        expect(() => beginRun(e, 'run-1', ['J6'])).toThrow(AdmissionRefused);
        expect(fs.existsSync(path.join(e, 'run-1.started.json'))).toBe(false);
        expect(() => beginRun(path.join(os.tmpdir(), 'nightly-evidence-does-not-exist-9f3'), 'run-1', ['J6'])).toThrow(AdmissionRefused);
    });
    it('refuses admission when the evidence directory is missing', () => {
        expect(admitRun(path.join(os.tmpdir(), 'nightly-evidence-does-not-exist-9f2')).admitted).toBe(false);
    });
});
