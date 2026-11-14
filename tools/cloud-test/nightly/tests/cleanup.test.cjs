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
    ACCOUNT_DELETION, CLEANUP_REQUEST_DEADLINE_S, CleanupUndefined, SOURCE_COUNTS, cleanupReserve, reserveMinutes,
} = require('../cleanup-plan.cjs');
const { admitRun, beginRun, recordRecovery, writeCleanupEvidence } = require('../cleanup-evidence.cjs');

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
    it('sizes each journey from its own account, open takes and fenced cases', () => {
        const perAccount = ACCOUNT_DELETION.reduce((n, o) => n + o.requests, 0);
        expect(perAccount).toBe(33);
        const starts = (j) => JOURNEYS.find((x) => x.id === j).legs.reduce((n, l) => n + l.startPresses, 0);
        expect(cleanupReserve('J6').requests).toBe(perAccount + starts('J6'));
        expect(cleanupReserve('J1').requests).toBe(perAccount + starts('J1') + 3);
        expect(cleanupReserve('J8').requests).toBe(perAccount + starts('J8') + 6);
        expect(cleanupReserve('J9').requests).toBe(0);
    });
    it('bounds time by the per-request deadline, so the reserve is a ceiling', () => {
        const r = cleanupReserve('J3');
        expect(r.seconds).toBe(r.requests * CLEANUP_REQUEST_DEADLINE_S);
        expect(reserveMinutes(r)).toBe(Math.ceil(r.seconds / 60));
    });
    it('leaves the id-recovery poll out of the reserve rather than reserving 600 requests', () => {
        for (const j of ['J1', 'J3', 'J4', 'J5', 'J6', 'J7', 'J8'])
            expect(cleanupReserve(j).requests < 100).toBe(true);
    });
    it('refuses to size J2: its Checkout cleanup step is not written', () => {
        expect(() => cleanupReserve('J2')).toThrow(CleanupUndefined);
    });
});

describe('durable cleanup evidence and admission', () => {
    const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nightly-evidence-'));
    const clean = (journey) => ({ journey, reserveExhausted: false, steps: [{ kind: 'account', ref: `acct-${journey}`, action: 'delete', outcome: 'done' }], left: [] });
    it('admits the first run, and the next after a complete cleanup', () => {
        const d = dir();
        expect(admitRun(d).admitted).toBe(true);
        beginRun(d, 'run-1');
        expect(writeCleanupEvidence(d, 'run-1', [clean('J6')]).cleanup).toBe('complete');
        expect(admitRun(d).admitted).toBe(true);
    });
    it('refuses the next run after a runner was killed before writing its evidence', () => {
        const d = dir();
        beginRun(d, 'run-1');
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
            beginRun(d, 'run-1');
            expect(writeCleanupEvidence(d, 'run-1', [clean('J1'), j]).incompleteJourneys).toEqual(['J6']);
            expect(admitRun(d).admitted).toBe(false);
        }
    });
    it('admits again once the protected recovery route is recorded for that run', () => {
        const d = dir();
        beginRun(d, 'run-1');
        writeCleanupEvidence(d, 'run-1', [{ ...clean('J6'), left: [{ kind: 'account', ref: 'acct-J6' }] }]);
        expect(() => recordRecovery(d, 'run-1', '')).toThrow();
        recordRecovery(d, 'run-1', 'recovery-run-77');
        expect(admitRun(d).admitted).toBe(true);
    });
    it('never overwrites evidence, and refuses evidence for a run that never started or that it cannot read back', () => {
        const d = dir();
        expect(() => writeCleanupEvidence(d, 'run-x', [clean('J6')])).toThrow();
        beginRun(d, 'run-1');
        expect(() => beginRun(d, 'run-1')).toThrow();
        expect(() => writeCleanupEvidence(d, 'run-1', [{ ...clean('J6'), left: [{ kind: 'account', ref: 'someone@example.com' }] }])).toThrow();
        expect(() => writeCleanupEvidence(d, 'run-1', [{ journey: 'J10', reserveExhausted: false, steps: [], left: [] }])).toThrow();
        writeCleanupEvidence(d, 'run-1', [clean('J6')]);
        expect(() => writeCleanupEvidence(d, 'run-1', [clean('J6')])).toThrow();
        fs.writeFileSync(path.join(d, 'run-1.cleanup.json'), '{"cleanup":');
        expect(admitRun(d).admitted).toBe(false);
    });
    it('refuses admission when the evidence directory is missing', () => {
        expect(admitRun(path.join(os.tmpdir(), 'nightly-evidence-does-not-exist-9f2')).admitted).toBe(false);
    });
});
