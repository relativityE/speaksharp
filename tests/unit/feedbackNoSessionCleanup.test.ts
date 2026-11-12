// AHT-08 report cleanup (board item "report cleanup (S)"): the no-session scenario now removes its one report with AHT-07's
// race-safe steps, and its own submit observation decides whether that write's outcome is known. Fail closed.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { noSessionWriteUncertainty, type NoSessionInsertSnapshot } from '../live/helpers/feedbackNoSessionCleanup';
import { type ReportCleanupAdmin, captureRunReports, cleanupRunReports, zeroResidueNotRun } from '../live/helpers/feedbackReportCleanup';

const here = path.dirname(fileURLToPath(import.meta.url));
const spec = readFileSync(path.join(here, '../live/rwt-feedback-association-boundaries.live.spec.ts'), 'utf8');
const USER = '33333333-3333-4333-8333-333333333333';
const KEY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const OTHER_KEY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const seen = (over: Partial<NoSessionInsertSnapshot> = {}): NoSessionInsertSnapshot => ({ keys: [KEY], insertRequests: 1, unattributedInserts: 0, ...over });
const CERTAIN = { pending: 0, uncertain: [] };
const UNKNOWN = { pending: 0, uncertain: [1] };

describe('noSessionWriteUncertainty', () => {
    it('never submitted: no write was made, so nothing is uncertain (even with no observation)', () => {
        expect(noSessionWriteUncertainty({ submitted: false, inserts: null, reportId: null, storedRows: null })).toEqual(CERTAIN);
    });
    it('certain only when one observed key, every insert attributed, and exactly one stored row was read back', () => {
        expect(noSessionWriteUncertainty({ submitted: true, inserts: seen(), reportId: 'r1', storedRows: 1 })).toEqual(CERTAIN);
        // A retry of the same draft carries the same key (one row by the unique index): still certain.
        expect(noSessionWriteUncertainty({ submitted: true, inserts: seen({ insertRequests: 2 }), reportId: 'r1', storedRows: 1 })).toEqual(CERTAIN);
    });
    it.each([
        ['no observation (the submit threw before the observer reported)', { inserts: null }],
        ['no key seen', { inserts: seen({ keys: [] }) }],
        ['no insert request seen', { inserts: seen({ insertRequests: 0 }) }],
        ['two keys', { inserts: seen({ keys: [KEY, OTHER_KEY] }) }],
        ['an unattributed insert', { inserts: seen({ unattributedInserts: 1 }) }],
        ['no stored row read', { reportId: null, storedRows: 0 }],
        ['an empty report id', { reportId: '' }],
        ['two stored rows', { storedRows: 2 }],
        ['the stored read never ran', { storedRows: null }],
    ])('after a Submit, %s leaves the one write uncertain', (_n, over) => {
        expect(noSessionWriteUncertainty({ submitted: true, inserts: seen(), reportId: 'r1', storedRows: 1, ...over })).toEqual(UNKNOWN);
    });
});

// ── The AHT-08 cleanup end to end over a fake service role (the shared steps are unchanged; tested in feedbackBoundedWrites) ──
type Row = { id: string; idempotency_key: string | null; user_id: string | null };
interface State { reports: Row[]; sessions: number; profiles: number; authUser: boolean; deletes: string[][] }
function fakeAdmin(s: State): ReportCleanupAdmin {
    const answer = (table: string, column: string, values: readonly string[]) => table === 'user_issue_reports'
        ? Promise.resolve({ data: s.reports.filter((r) => values.includes(String((r as Record<string, unknown>)[column]))).map((r) => ({ ...r })), error: null })
        : Promise.resolve({ data: null, error: null, count: table === 'sessions' ? s.sessions : s.profiles });
    return {
        from: (table: string) => ({
            select: () => ({ eq: (c: string, v: string) => answer(table, c, [v]), in: (c: string, v: readonly string[]) => answer(table, c, v) }),
            delete: () => ({ in: (_c: string, ids: readonly string[]) => {
                s.deletes.push([...ids]);
                const before = s.reports.length;
                s.reports = s.reports.filter((r) => !ids.includes(r.id));
                return Promise.resolve({ error: null, count: before - s.reports.length });
            } }),
        }),
        auth: { admin: { getUserById: () => Promise.resolve(s.authUser ? { data: { user: { id: USER } }, error: null }
            : { data: { user: null }, error: { status: 404, code: 'user_not_found', message: 'User not found' } }) } },
    };
}
const state = (): State => ({
    reports: [{ id: 'r1', idempotency_key: KEY, user_id: USER }, { id: 'other', idempotency_key: OTHER_KEY, user_id: 'someone-else' }],
    sessions: 0, profiles: 1, authUser: true, deletes: [],
});
const deleteAccount = (s: State) => { s.authUser = false; s.profiles = 0; s.reports = s.reports.map((r) => (r.user_id === USER ? { ...r, user_id: null } : r)); };

describe('AHT-08 report cleanup over the shared race-safe steps', () => {
    it('the one retained report is deleted by id after the account deletion; another account\'s report is untouched; PASS', async () => {
        const s = state();
        const admin = fakeAdmin(s);
        const captured = await captureRunReports(admin, USER, [KEY], null);
        expect(captured.ids).toEqual(['r1']);
        deleteAccount(s);
        const v = await cleanupRunReports(admin, USER, [KEY], captured, noSessionWriteUncertainty({ submitted: true, inserts: seen(), reportId: 'r1', storedRows: 1 }));
        expect(v).toMatchObject({ verdict: 'PASS', evidence: { capturedReports: 1, deleted: 1 } });
        expect(s.reports.map((r) => r.id)).toEqual(['other']);
        expect(s.deletes).toEqual([['r1']]);
    });
    it('the race: a report under the submit\'s key that landed after the capture is re-captured by key and deleted', async () => {
        const s = state();
        s.reports = s.reports.filter((r) => r.id !== 'r1');
        const admin = fakeAdmin(s);
        const captured = await captureRunReports(admin, USER, [KEY], null);
        expect(captured.ids).toEqual([]);
        s.reports.push({ id: 'late', idempotency_key: KEY, user_id: USER });
        deleteAccount(s);
        const v = await cleanupRunReports(admin, USER, [KEY], captured, CERTAIN);
        expect(v).toMatchObject({ verdict: 'PASS', evidence: { recapturedReports: 1, deleted: 1 } });
        expect(s.reports.map((r) => r.id)).toEqual(['other']);
    });
    it('an uncertain write still deletes what was captured but HOLDs, naming the ids, never PASS on a zero read', async () => {
        const s = state();
        const admin = fakeAdmin(s);
        const captured = await captureRunReports(admin, USER, [KEY], null);
        deleteAccount(s);
        const v = await cleanupRunReports(admin, USER, [KEY], captured, noSessionWriteUncertainty({ submitted: true, inserts: null, reportId: null, storedRows: null }));
        expect(v).toMatchObject({ verdict: 'HOLD', evidence: { capturedIds: 'r1' } });
        expect(s.reports.map((r) => r.id)).toEqual(['other']);
    });
    it('the submit\'s key naming another account\'s report FAILs and deletes nothing of theirs', async () => {
        const s = state();
        const admin = fakeAdmin(s);
        const captured = await captureRunReports(admin, USER, [KEY, OTHER_KEY], null);
        deleteAccount(s);
        const v = await cleanupRunReports(admin, USER, [KEY, OTHER_KEY], captured, CERTAIN);
        expect(v.verdict).toBe('FAIL');
        expect(s.reports.map((r) => r.id)).toEqual(['other']);
    });
    it('no submit (the scenario stopped before it): the account\'s residue still reads zero, PASS with nothing deleted', async () => {
        const s = state();
        s.reports = s.reports.filter((r) => r.id !== 'r1');
        const admin = fakeAdmin(s);
        const captured = await captureRunReports(admin, USER, [], null);
        deleteAccount(s);
        const v = await cleanupRunReports(admin, USER, [], captured, noSessionWriteUncertainty({ submitted: false, inserts: null, reportId: null, storedRows: null }));
        expect(v).toMatchObject({ verdict: 'PASS', evidence: { capturedReports: 0, deleted: 0 } });
    });
    it('an account deletion that left the auth user FAILs as residue', async () => {
        const s = state();
        const admin = fakeAdmin(s);
        const captured = await captureRunReports(admin, USER, [KEY], null);
        const v = await cleanupRunReports(admin, USER, [KEY], captured, CERTAIN);
        expect(v.verdict).toBe('FAIL');
        expect(v.detail).toContain('auth user');
    });
    it('a cleanup that did not finish HOLDs, naming what was captured', () => {
        expect(zeroResidueNotRun({ ids: ['r1'], keys: [KEY], foreignIds: [] })).toMatchObject({ verdict: 'HOLD', evidence: { capturedIds: 'r1' } });
    });
});

describe('AHT-08 spec wiring', () => {
    const start = spec.indexOf("test('No session feedback stores no take or coaching link'");
    const test08 = spec.slice(start);
    it('the insert observation is delivered in submitFeedback\'s finally, so a submit that throws still reports its key', () => {
        expect(spec).toMatch(/finally \{\s*inserts\.stop\(\);\s*observers\?\.onInserts\?\.\(/);
        expect(test08).toContain('onInserts: (inserts) => { insertSnapshot = inserts; }');
        expect(test08).toContain('storedRows = stored.storedRows;');
    });
    it('captures BEFORE the account deletion and cleans up AFTER the retention proof, writing zero residue either way', () => {
        const capture = test08.indexOf("steps.step('feedback report capture'");
        const deletion = test08.indexOf('finalizeOwnedCleanup(');
        const cleanup = test08.indexOf("steps.step('feedback report cleanup'");
        expect(capture).toBeGreaterThan(0);
        expect(deletion).toBeGreaterThan(capture);
        expect(cleanup).toBeGreaterThan(deletion);
        expect(test08.indexOf('finishReceipt(')).toBeGreaterThan(cleanup);
        expect(test08).toContain('noSessionWriteUncertainty({ submitted: submitWindow !== null, inserts: insertSnapshot, reportId, storedRows })');
        expect(test08).toContain('if (written !== true) writeZeroResidueRow(receipt, zeroResidueNotRun(capturedReports));');
    });
    it('the capture and cleanup come after every owned page closed', () => {
        expect(test08.indexOf("steps.step('feedback report capture'")).toBeGreaterThan(test08.indexOf("steps.step('owned pages closed'"));
    });
});

// Sam, #1811 RETURN on d1487bdb, item 2: AHT-08's cleanup is in-run source behavior only. Its key and report id live in memory;
// it has no durable inventory and no verified-store gate. These controls keep the claim honest and show why a lost runner's report
// is not recoverable today: after the account deletion nulls `user_id`, only the submit's key finds the report.
describe('AHT-08 recovery scope (in-run only)', () => {
    const helper = readFileSync(path.join(here, '../live/helpers/feedbackNoSessionCleanup.ts'), 'utf8');
    const test08 = spec.slice(spec.indexOf("test('No session feedback stores no take or coaching link'"));
    it('the helper and the spec say in-run only and memory-only, and claim no recovery', () => {
        expect(helper).toMatch(/IN-RUN cleanup only/);
        expect(helper).toMatch(/in memory only; it has no durable inventory and no verified-store gate/);
        expect(test08).toMatch(/In-run only: the key and report id are held in memory, with no durable record and no verified store/);
        expect(helper).not.toMatch(/waits on the same recovery store/);
        expect(test08).not.toMatch(/waits on the same recovery store/);
    });
    it('the no-session test has no store gate, inventory or recovery path (so it must not claim one)', () => {
        for (const name of ['verifyRecoveryStore', 'FeedbackRecoveryInventory', 'recoverFromInventory', 'settleRecoveryInventory', 'RECOVERY_STORE_STEP', 'RWT_RECOVERY_DIR']) {
            expect({ name, present: test08.includes(name) }).toEqual({ name, present: false });
        }
    });
    it('after the account deletion a second executor with only the uid finds nothing; only the lost key finds the report', async () => {
        const s: State = { reports: [{ id: 'r1', idempotency_key: KEY, user_id: null }], sessions: 0, profiles: 0, authUser: false, deletes: [] };
        const byUidOnly = await captureRunReports(fakeAdmin(s), USER, [], null);
        expect(byUidOnly.ids).toEqual([]);
        const byKey = await captureRunReports(fakeAdmin(s), USER, [KEY], null);
        expect(byKey.ids).toEqual(['r1']);
    });
});
