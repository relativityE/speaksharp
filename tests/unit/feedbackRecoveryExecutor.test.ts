// @vitest-environment node
/**
 * AHT-07 / AHT-08 recovery executor (recovery-store proposal 2026-11-12, §7 items 1 and 3): the governed caller of
 * `recoverFromInventory`. Detect-and-report by default; delete only from protected main with the ack bound to the exact commit;
 * fail closed on any store, listing or file problem; content-free report. Then the ordering control with interrupted-run
 * recovery: the account is deleted first (report `user_id` NULL), and the inventory still recovers the reports by recorded key.
 */
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    FEEDBACK_RECOVERY_DELETE_ACK_PREFIX, RECOVERY_FILE_PATTERN, classifyRecoveryFile, feedbackRecoveryAuthority, feedbackRecoveryDeleteAck,
    feedbackRecoveryReportLine, listRecoveryFiles, runFeedbackRecovery, type ExecutorGit,
} from '../live/helpers/feedbackRecoveryExecutor';
import {
    FeedbackRecoveryInventory, RECOVERY_DIR_ENV, RECOVERY_STORE_MARKER, RECOVERY_STORE_SCHEMA, type RecoveryCase, type VerifiedStore,
    readRecoveryInventory, recoverFromInventory, recoveryFileName, verifyRecoveryStore,
} from '../live/helpers/feedbackRecoveryInventory';
import type { ReportCleanupAdmin } from '../live/helpers/feedbackReportCleanup';
import { MIN_AGE_MS, recoverInterruptedRuns, recoveryDeleteAck, type AdminLike } from '../live/helpers/rwtInterruptedRunRecovery';

const here = path.dirname(fileURLToPath(import.meta.url));
const USER = '33333333-3333-4333-8333-333333333333';
const USER2 = '44444444-4444-4444-8444-444444444444';
const K = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'];
const SHA = 'c'.repeat(40);
const OTHER_SHA = 'd'.repeat(40);
const ACK = feedbackRecoveryDeleteAck(SHA);
const MAIN: ExecutorGit = { ref: 'refs/heads/main', sha: SHA, head: SHA, attempt: '1' };
const B07 = { runId: '43048630848', runAttempt: '1', testId: 'older-take-1', ownerUid: USER };
const B08 = { runId: '43048630849', runAttempt: '1', testId: 'no-session-1', ownerUid: USER2 };

const tmpDir = () => mkdtempSync(path.join(os.tmpdir(), 'feedback-recovery-executor-'));
function provisionStore(dir: string, storeId = 'rwt-store-1'): VerifiedStore {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    writeFileSync(path.join(dir, RECOVERY_STORE_MARKER), JSON.stringify({ schema: RECOVERY_STORE_SCHEMA, storeId, survivesRunnerLoss: true }), { mode: 0o600 });
    const check = verifyRecoveryStore({ [RECOVERY_DIR_ENV]: dir });
    if (!check.ok) throw new Error(check.reason);
    return check.store;
}
/** A finished writer: each key forwarded and answered 201, then stop and the writer-stopped record. */
function finishedInventory(store: VerifiedStore, binding: typeof B07, keys: string[], recoveryCase: RecoveryCase, stopped = true): FeedbackRecoveryInventory {
    const inv = FeedbackRecoveryInventory.open(binding, store, recoveryCase);
    keys.forEach((key, i) => {
        inv.recordAttempt({ ordinal: i + 1, action: 'forward', keys: [key] });
        inv.recordSettle({ ordinal: i + 1, status: 201, forwarded: true });
    });
    if (stopped) { inv.stop(); inv.recordWriterStopped(0); }
    return inv;
}

// ── A fake service role (the shape of tests/unit/feedbackBoundedWrites.test.ts) plus auth listUsers ─────────────────────────
type ReportRow = { id: string; idempotency_key: string | null; user_id: string | null };
interface FakeState {
    reports: ReportRow[]; sessions: number; profiles: number; authUsers: Array<{ id: string; email: string; created_at: string }>;
    deletes: Array<{ column: string; values: string[] }>; queries: string[];
}
function fakeAdmin(state: FakeState): ReportCleanupAdmin & AdminLike {
    const answer = (table: string, column: string, values: readonly string[]) => {
        state.queries.push(`${table}.${column}`);
        if (table === 'user_issue_reports') {
            return Promise.resolve({ data: state.reports.filter((r) => values.includes(String((r as Record<string, unknown>)[column]))).map((r) => ({ ...r })), error: null });
        }
        return Promise.resolve({ data: null, error: null, count: table === 'sessions' ? state.sessions : state.profiles });
    };
    return {
        from: (table: string) => ({
            select: () => ({ eq: (column: string, value: string) => answer(table, column, [value]), in: (column: string, values: readonly string[]) => answer(table, column, values) }),
            delete: () => ({
                in: (column: string, values: readonly string[]) => {
                    state.deletes.push({ column, values: [...values] });
                    const before = state.reports.length;
                    state.reports = state.reports.filter((r) => !(column === 'id' && values.includes(r.id)));
                    return Promise.resolve({ error: null, count: before - state.reports.length });
                },
            }),
        }),
        auth: { admin: {
            getUserById: (uid: string) => Promise.resolve(state.authUsers.some((u) => u.id === uid)
                ? { data: { user: { id: uid } }, error: null }
                : { data: { user: null }, error: { status: 404, code: 'user_not_found', message: 'User not found' } }),
            listUsers: async ({ page, perPage }: { page: number; perPage: number }) => ({ data: { users: state.authUsers.slice((page - 1) * perPage, page * perPage) }, error: null }),
        } },
    } as unknown as ReportCleanupAdmin & AdminLike;
}
/** The product's account deletion: auth user, sessions and profile gone; reports kept with user_id nulled (ON DELETE SET NULL). */
const deleteAccount = (s: FakeState, uid: string) => {
    s.authUsers = s.authUsers.filter((u) => u.id !== uid);
    s.sessions = 0; s.profiles = 0;
    s.reports = s.reports.map((r) => (r.user_id === uid ? { ...r, user_id: null } : r));
};
const deletedWorld = (reports: ReportRow[]): FakeState => ({ reports, sessions: 0, profiles: 0, authUsers: [], deletes: [], queries: [] });
const env = (store: VerifiedStore) => ({ [RECOVERY_DIR_ENV]: store.dir });
const forbidden = [USER, USER2, ...K, 'aht07-', 'aht08-', '.jsonl', '@'];

describe('authority: protected main, first attempt, HEAD = dispatch SHA, ack bound to that exact commit', () => {
    it('detects without an ack and deletes only with the ack naming this commit', () => {
        expect(feedbackRecoveryAuthority({ ...MAIN, ack: '' })).toEqual({ ok: true, deleteAuthorized: false });
        expect(feedbackRecoveryAuthority({ ...MAIN, ack: ACK })).toEqual({ ok: true, deleteAuthorized: true });
        expect(ACK).toBe(`${FEEDBACK_RECOVERY_DELETE_ACK_PREFIX}@${SHA}`);
    });
    it.each([
        ['an ack bound to another commit', { ack: feedbackRecoveryDeleteAck(OTHER_SHA) }, 'delete_ack_not_bound_to_this_sha'],
        ['a malformed recovery ack', { ack: `${FEEDBACK_RECOVERY_DELETE_ACK_PREFIX}@main` }, 'delete_ack_not_bound_to_this_sha'],
        ['a branch other than main', { ref: 'refs/heads/feature/aht08' }, 'not_protected_main'],
        ['a tag', { ref: 'refs/tags/v1' }, 'not_protected_main'],
        ['a re-run', { attempt: '2' }, 'workflow_rerun_attempt_refused'],
        ['a checkout that is not the dispatch commit', { head: OTHER_SHA }, 'checkout_head_is_not_dispatch_sha'],
        ['a short sha', { sha: 'c'.repeat(39), head: 'c'.repeat(39) }, 'dispatch_sha_invalid'],
    ])('refuses %s', (_n, over, reason) => {
        expect(feedbackRecoveryAuthority({ ...MAIN, ack: ACK, ...over })).toEqual({ ok: false, reason });
    });
    it('the interrupted-run ack never authorizes this executor', () => {
        expect(feedbackRecoveryAuthority({ ...MAIN, ack: recoveryDeleteAck(SHA) })).toEqual({ ok: true, deleteAuthorized: false });
    });
});

describe('listing: only inventory names; the marker and write probes are ignored; a listing error fails closed', () => {
    it('lists aht07 and aht08 inventories and nothing else', () => {
        const store = provisionStore(path.join(tmpDir(), 'store'));
        finishedInventory(store, B07, [K[0]], 'aht07');
        finishedInventory(store, B08, [K[1]], 'aht08');
        writeFileSync(path.join(store.dir, '.probe-1-2'), '{"probe":true}\n');
        writeFileSync(path.join(store.dir, 'notes.txt'), 'x');
        writeFileSync(path.join(store.dir, 'aht09-x.jsonl'), 'x');
        expect(listRecoveryFiles(store)).toEqual({ files: [recoveryFileName(B07), recoveryFileName(B08, 'aht08')].sort(), ignored: 4 });
        expect(RECOVERY_FILE_PATTERN.test(RECOVERY_STORE_MARKER)).toBe(false);
    });
    it('a listing that throws is HOLD_LISTING_FAILED, with nothing read or deleted', async () => {
        const store = provisionStore(path.join(tmpDir(), 'store'));
        finishedInventory(store, B07, [K[0]], 'aht07');
        const s = deletedWorld([{ id: 'r1', idempotency_key: K[0], user_id: null }]);
        const report = await runFeedbackRecovery({ env: env(store), git: MAIN, ack: ACK, admin: fakeAdmin(s), list: () => { throw new Error('EIO'); } });
        expect(report.status).toBe('HOLD_LISTING_FAILED');
        expect(s.queries).toEqual([]);
        expect(s.deletes).toEqual([]);
    });
    it('no or unverified store: HOLD_NO_STORE before any listing', async () => {
        const s = deletedWorld([]);
        for (const e of [{}, { [RECOVERY_DIR_ENV]: 'relative' }, { [RECOVERY_DIR_ENV]: path.join(tmpDir(), 'missing') }]) {
            expect((await runFeedbackRecovery({ env: e, git: MAIN, ack: ACK, admin: fakeAdmin(s) })).status).toBe('HOLD_NO_STORE');
        }
        expect(s.queries).toEqual([]);
    });
});

describe('detect and report by default: no ack, no credential, no database read, nothing deleted', () => {
    it('counts files by case and by state, deletes nothing and keeps every file', async () => {
        const store = provisionStore(path.join(tmpDir(), 'store'));
        finishedInventory(store, B07, [K[0]], 'aht07');
        finishedInventory(store, B08, [K[1]], 'aht08', false); // writer lost before its stopped record
        let recovered = 0;
        const report = await runFeedbackRecovery({ env: env(store), git: MAIN, ack: '', admin: null, recover: async (...a) => { recovered += 1; return recoverFromInventory(...a); } });
        expect(report).toMatchObject({ status: 'DETECTED_HOLD_NO_ACK', files: 2, aht07: 1, aht08: 1, ready: 1, noStopRecord: 1, passed: 0, deleted: 0, retired: 0 });
        expect(recovered).toBe(0);
        expect(readdirSync(store.dir).length).toBe(3);
    });
    it('an ack for another commit or a non-main ref never reaches a delete (HOLD_AUTHORITY)', async () => {
        const store = provisionStore(path.join(tmpDir(), 'store'));
        finishedInventory(store, B07, [K[0]], 'aht07');
        const s = deletedWorld([{ id: 'r1', idempotency_key: K[0], user_id: null }]);
        for (const [git, ack] of [[MAIN, feedbackRecoveryDeleteAck(OTHER_SHA)], [{ ...MAIN, ref: 'refs/heads/dev' }, ACK], [{ ...MAIN, attempt: '2' }, ACK]] as const) {
            expect((await runFeedbackRecovery({ env: env(store), git, ack, admin: fakeAdmin(s) })).status).toBe('HOLD_AUTHORITY');
        }
        expect(s.deletes).toEqual([]);
        expect(s.queries).toEqual([]);
    });
    it('an empty store is NOTHING_TO_RECOVER', async () => {
        const store = provisionStore(path.join(tmpDir(), 'store'));
        expect((await runFeedbackRecovery({ env: env(store), git: MAIN, ack: ACK, admin: null })).status).toBe('NOTHING_TO_RECOVER');
    });
});

describe('recovery with the ack: recoverFromInventory per file, holds kept, content-free output', () => {
    it('recovers an AHT-07 and an AHT-08 inventory by recorded key after the account deletions; files retired; report names nothing', async () => {
        const store = provisionStore(path.join(tmpDir(), 'store'));
        finishedInventory(store, B07, [K[0], K[1]], 'aht07');
        finishedInventory(store, B08, [K[2]], 'aht08');
        const s = deletedWorld([
            { id: 'r07a', idempotency_key: K[0], user_id: null }, { id: 'r07b', idempotency_key: K[1], user_id: null },
            { id: 'r08', idempotency_key: K[2], user_id: null }, { id: 'other', idempotency_key: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', user_id: 'someone-else' },
            { id: 'unrelated-ownerless', idempotency_key: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', user_id: null },
        ]);
        const report = await runFeedbackRecovery({ env: env(store), git: MAIN, ack: ACK, admin: fakeAdmin(s) });
        expect(report).toMatchObject({ status: 'RECOVERED', files: 2, aht07: 1, aht08: 1, ready: 2, passed: 2, held: 0, failed: 0, deleted: 3, retired: 2 });
        expect(s.reports.map((r) => r.id).sort()).toEqual(['other', 'unrelated-ownerless']);
        expect(s.deletes.every((d) => d.column === 'id')).toBe(true);
        expect(readdirSync(store.dir)).toEqual([RECOVERY_STORE_MARKER]);
        const line = feedbackRecoveryReportLine(report);
        expect(line).toMatch(/^RWT_FEEDBACK_RECOVERY status=RECOVERED files=2 /);
        for (const value of [...forbidden, 'r07a', 'r07b', 'r08', 'unrelated-ownerless']) expect({ value, inLine: line.includes(value) }).toEqual({ value, inLine: false });
        for (const value of [...forbidden, 'r07a', 'r08']) expect({ value, inReport: JSON.stringify(report).includes(value) }).toEqual({ value, inReport: false });
        // A second run finds nothing to recover (idempotent).
        expect((await runFeedbackRecovery({ env: env(store), git: MAIN, ack: ACK, admin: fakeAdmin(s) })).status).toBe('NOTHING_TO_RECOVER');
    });
    it('no stopped record (the known limit), another store, a malformed line, a renamed file or a symlink: HOLD, not acted on, kept', async () => {
        const store = provisionStore(path.join(tmpDir(), 'store'));
        const other = provisionStore(path.join(tmpDir(), 'other'), 'rwt-store-2');
        const lost = finishedInventory(store, B07, [K[0]], 'aht07', false);
        const foreign = finishedInventory(other, B08, [K[1]], 'aht08');
        cpSync(foreign.file, path.join(store.dir, path.basename(foreign.file)));
        const bad = finishedInventory(store, { ...B07, runId: 'bad' }, [K[2]], 'aht07');
        writeFileSync(bad.file, `${readFileSync(bad.file, 'utf8')}not json\n`);
        const moved = finishedInventory(store, { ...B07, runId: 'moved' }, [K[2]], 'aht07');
        renameSync(moved.file, path.join(store.dir, 'aht07-renamed.jsonl'));
        const target = finishedInventory(other, { ...B07, runId: 'linked' }, [K[2]], 'aht07');
        symlinkSync(target.file, path.join(store.dir, path.basename(target.file)));
        expect(classifyRecoveryFile(store, path.basename(lost.file)).state).toBe('noStopRecord');
        expect(classifyRecoveryFile(store, path.basename(foreign.file)).state).toBe('otherStore');
        expect(classifyRecoveryFile(store, path.basename(bad.file)).state).toBe('malformed');
        expect(classifyRecoveryFile(store, 'aht07-renamed.jsonl').state).toBe('unsafe');
        expect(classifyRecoveryFile(store, path.basename(target.file)).state).toBe('unsafe');
        const s = deletedWorld([{ id: 'r1', idempotency_key: K[0], user_id: null }, { id: 'r2', idempotency_key: K[1], user_id: null }, { id: 'r3', idempotency_key: K[2], user_id: null }]);
        const acted: string[] = [];
        const report = await runFeedbackRecovery({ env: env(store), git: MAIN, ack: ACK, admin: fakeAdmin(s), recover: async (a, st, n) => { acted.push(n); return recoverFromInventory(a, st, n); } });
        expect(report).toMatchObject({ status: 'RECOVERED_WITH_HOLDS', files: 5, ready: 0, noStopRecord: 1, otherStore: 1, malformed: 1, unsafe: 2, held: 5, passed: 0, deleted: 0 });
        expect(acted).toEqual([]);
        expect(s.deletes).toEqual([]);
        expect(readdirSync(store.dir).length).toBe(6);
    });
    it('a FAIL from recovery (a run key under another account) stops the run: no further file is touched', async () => {
        const store = provisionStore(path.join(tmpDir(), 'store'));
        finishedInventory(store, B07, [K[0]], 'aht07');
        finishedInventory(store, B08, [K[1]], 'aht08');
        const s = deletedWorld([{ id: 'theirs', idempotency_key: K[0], user_id: 'someone-else' }, { id: 'r08', idempotency_key: K[1], user_id: null }]);
        const report = await runFeedbackRecovery({ env: env(store), git: MAIN, ack: ACK, admin: fakeAdmin(s) });
        expect(report).toMatchObject({ status: 'FAILED', failed: 1, passed: 0 });
        expect(s.deletes).toEqual([]);
        expect(s.reports.map((r) => r.id).sort()).toEqual(['r08', 'theirs']);
    });
    it('a recovery that throws is FAILED (fail closed), and an ack with no admin is HOLD_NO_ADMIN', async () => {
        const store = provisionStore(path.join(tmpDir(), 'store'));
        finishedInventory(store, B07, [K[0]], 'aht07');
        expect((await runFeedbackRecovery({ env: env(store), git: MAIN, ack: ACK, admin: fakeAdmin(deletedWorld([])), recover: async () => { throw new Error('x'); } })).status).toBe('FAILED');
        expect((await runFeedbackRecovery({ env: env(store), git: MAIN, ack: ACK, admin: null })).status).toBe('HOLD_NO_ADMIN');
    });
});

describe('ordering with interrupted-run recovery (proposal §7 item 3): account deleted first, then recovery by key', () => {
    it('interrupted-run recovery deletes the feedback-boundary account (reports go owner-less); the inventory still finds and deletes them; residue zero', async () => {
        const NOW = Date.parse('2026-11-12T12:00:00Z');
        const D = 'rwt.example.org';
        const email = `rwt-journey-feedback-boundary-1762900000000-43048630848@${D}`;
        const store = provisionStore(path.join(tmpDir(), 'store'));
        finishedInventory(store, B07, [K[0], K[1]], 'aht07');
        const s: FakeState = {
            reports: [{ id: 'r1', idempotency_key: K[0], user_id: USER }, { id: 'r2', idempotency_key: K[1], user_id: USER },
                { id: 'other', idempotency_key: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', user_id: 'someone-else' }],
            sessions: 2, profiles: 1, authUsers: [{ id: USER, email, created_at: new Date(NOW - MIN_AGE_MS - 60_000).toISOString() }], deletes: [], queries: [],
        };
        const admin = fakeAdmin(s);
        // 1. Interrupted-run recovery runs first (its own ack) and deletes the account WITHOUT reading the inventory.
        const interrupted = await recoverInterruptedRuns({
            admin, nowMs: NOW, ack: recoveryDeleteAck(SHA), sha: SHA, domain: D,
            cleanup: (async ({ capturedUid }: { capturedUid: string }) => { deleteAccount(s, capturedUid); return capturedUid; }) as never,
        });
        expect(interrupted).toMatchObject({ status: 'RECOVERED', deleted: 1 });
        expect(s.reports.filter((r) => r.id !== 'other').map((r) => r.user_id)).toEqual([null, null]);
        // By uid alone nothing is the run's any more.
        expect(s.reports.filter((r) => r.user_id === USER)).toEqual([]);
        // 2. The feedback recovery executor finds them by the recorded keys and deletes exactly those ids.
        const report = await runFeedbackRecovery({ env: env(store), git: MAIN, ack: ACK, admin });
        expect(report).toMatchObject({ status: 'RECOVERED', passed: 1, deleted: 2, retired: 1 });
        expect(s.deletes).toEqual([{ column: 'id', values: ['r1', 'r2'] }]);
        expect(s.reports.map((r) => r.id)).toEqual(['other']);
        expect(readdirSync(store.dir)).toEqual([RECOVERY_STORE_MARKER]);
    });
    it('the reverse order is safe too: inventory recovery while the account still exists FAILs on the residue, deletes only the run ids, keeps the file', async () => {
        const store = provisionStore(path.join(tmpDir(), 'store'));
        const inv = finishedInventory(store, B07, [K[0]], 'aht07');
        const s: FakeState = { reports: [{ id: 'r1', idempotency_key: K[0], user_id: USER }], sessions: 0, profiles: 1,
            authUsers: [{ id: USER, email: 'x', created_at: '2026-01-01T00:00:00Z' }], deletes: [], queries: [] };
        const report = await runFeedbackRecovery({ env: env(store), git: MAIN, ack: ACK, admin: fakeAdmin(s) });
        expect(report).toMatchObject({ status: 'FAILED' });
        expect(s.deletes).toEqual([{ column: 'id', values: ['r1'] }]);
        expect(readRecoveryInventory(inv.file)).not.toBeNull();
    });
});

describe('the executor stays case-only and its entry point mirrors the governed interrupted-run pattern', () => {
    const entry = readFileSync(path.resolve(here, '../live/feedback-recovery-executor.live.spec.ts'), 'utf8');
    it('checks authority before any credential, and creates the service-role client only when deletion is authorized', () => {
        const authority = entry.indexOf('const authority = feedbackRecoveryAuthority({ ...git, ack: ACK });');
        const refused = entry.indexOf('if (!authority.ok) throw new Error(');
        const client = entry.indexOf('createClient(SUPABASE_URL, SERVICE_ROLE');
        expect(authority).toBeGreaterThan(0);
        expect(refused).toBeGreaterThan(authority);
        expect(client).toBeGreaterThan(refused);
        expect(entry).toContain('const admin = authority.deleteAuthorized');
        expect(entry).toContain("ack: authority.deleteAuthorized ? ACK : ''");
        expect(entry).toContain('console.log(feedbackRecoveryReportLine(report));');
        expect(entry).not.toMatch(/console\.log\((?!feedbackRecoveryReportLine)/);
        expect(entry).toContain("process.env.RWT_FEEDBACK_RECOVERY_ACK ?? ''");
        expect(entry).not.toContain('RWT_WRITES_ACK');
    });
    it('the draft workflow job is a separate, unwired docs snippet', () => {
        const draft = readFileSync(path.resolve(here, '../../docs/rwt-feedback-recovery-executor.draft-job.yml'), 'utf8');
        expect(draft).toMatch(/DRAFT/);
        expect(draft).toMatch(/not to be enabled without Akin's go/i);
        expect(draft).toContain('--file-mode 600');
        expect(draft).toContain('--dir-mode 700');
        expect(draft).toContain('/mnt/rwt-recovery');
        expect(draft).toContain('RWT_RECOVERY_DIR');
        expect(draft).toContain('id-token: write');
        expect(draft).toContain('feedback-recovery-executor.live.spec.ts');
        const workflows = path.resolve(here, '../../.github/workflows');
        for (const f of readdirSync(workflows)) {
            expect({ f, wired: readFileSync(path.join(workflows, f), 'utf8').includes('feedback-recovery-executor') }).toEqual({ f, wired: false });
        }
    });
});
