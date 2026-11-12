// AHT-08 report cleanup (board item "report cleanup (S)"): the no-session scenario now removes its one report with AHT-07's
// race-safe steps, and its own submit observation decides whether that write's outcome is known. Fail closed.
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    NoSessionReportRoute, noSessionWriteUncertainty, withRouteDrain, type NoSessionInsertSnapshot, type PassThroughRoute,
} from '../live/helpers/feedbackNoSessionCleanup';
import { type ReportCleanupAdmin, captureRunReports, cleanupRunReports, zeroResidueNotRun } from '../live/helpers/feedbackReportCleanup';
import {
    FeedbackRecoveryInventory, RECOVERY_DIR_ENV, RECOVERY_SCHEMA, RECOVERY_SCHEMAS, RECOVERY_STORE_MARKER, RECOVERY_STORE_SCHEMA, RECOVERY_STORE_STEP,
    type VerifiedStore, readRecoveryInventory, recoverFromInventory, recoveryFileName, settleRecoveryInventory, verifyRecoveryStore,
} from '../live/helpers/feedbackRecoveryInventory';

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
        // The inventory is retired only on PASS; any other verdict keeps it and names the file.
        expect(test08).toContain('writeZeroResidueRow(receipt, settleRecoveryInventory(verdict, inventory));');
        expect(test08).toContain('if (written !== true) writeZeroResidueRow(receipt, settleRecoveryInventory(zeroResidueNotRun(capturedReports), inventory));');
    });
    it('the capture and cleanup come after every owned page closed', () => {
        expect(test08.indexOf("steps.step('feedback report capture'")).toBeGreaterThan(test08.indexOf("steps.step('owned pages closed'"));
    });
});

// ── AHT-08 survives runner loss (recovery-store proposal 2026-11-12 §8; Sam, #1811 RETURN on d1487bdb, item 2) ─────────────
const tmpDir = () => mkdtempSync(path.join(os.tmpdir(), 'aht08-recovery-'));
function provisionStore(dir: string, storeId = 'rwt-store-1'): VerifiedStore {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    writeFileSync(path.join(dir, RECOVERY_STORE_MARKER), JSON.stringify({ schema: RECOVERY_STORE_SCHEMA, storeId, survivesRunnerLoss: true }), { mode: 0o600 });
    const check = verifyRecoveryStore({ [RECOVERY_DIR_ENV]: dir });
    if (!check.ok) throw new Error(check.reason);
    return check.store;
}
const BINDING = { runId: '43048630849', runAttempt: '1', testId: 'no-session-1', ownerUid: USER };
const insertBody = (key: string | null) => ({ user_id: USER, session_id: null, category: 'bug', description: 'Automated RWT feedback-association boundary check.', idempotency_key: key });
type FakeResponse = { status(): number };
/** A Playwright-shaped route: logs every action in order; `onFetch` runs at the moment the request would leave the browser. */
function fakeRoute(opts: { method?: string; body?: unknown; bodyThrows?: boolean; onFetch?: () => void; fetch?: () => Promise<FakeResponse> } = {}) {
    const log: string[] = [];
    const route: PassThroughRoute<FakeResponse> = {
        request: () => ({ method: () => opts.method ?? 'POST', postDataJSON: () => { if (opts.bodyThrows) throw new Error('unparsable'); return opts.body ?? insertBody(KEY); } }),
        fallback: async () => { log.push('fallback'); },
        abort: async (code?: string) => { log.push(`abort:${code}`); },
        fetch: async () => { log.push('fetch'); opts.onFetch?.(); return (opts.fetch ?? (async () => ({ status: () => 201 })))(); },
        fulfill: async ({ response }) => { log.push(`fulfill:${response.status()}`); },
    };
    return { route, log };
}
const deletedWorld = (reports: Row[]): State => ({ reports, sessions: 0, profiles: 0, authUser: false, deletes: [] });

describe('AHT-08 per-case inventory: its own file name and schema; AHT-07\'s unchanged', () => {
    it('defaults to AHT-07 (same name and schema as before); AHT-08 names its own case', () => {
        expect(recoveryFileName(BINDING)).toBe(`aht07-43048630849-1-no-session-1-${USER}.jsonl`);
        expect(recoveryFileName(BINDING, 'aht07')).toBe(recoveryFileName(BINDING));
        expect(recoveryFileName(BINDING, 'aht08')).toBe(`aht08-43048630849-1-no-session-1-${USER}.jsonl`);
        expect(RECOVERY_SCHEMA).toBe('speaksharp.aht07.feedback-recovery.v2');
        expect(RECOVERY_SCHEMAS).toEqual({ aht07: RECOVERY_SCHEMA, aht08: 'speaksharp.aht08.feedback-recovery.v1' });
        const store = provisionStore(path.join(tmpDir(), 'store'));
        const a07 = FeedbackRecoveryInventory.open(BINDING, store);
        const a08 = FeedbackRecoveryInventory.open(BINDING, store, 'aht08');
        expect(path.basename(a07.file)).toBe(recoveryFileName(BINDING));
        expect(path.basename(a08.file)).toBe(recoveryFileName(BINDING, 'aht08'));
        expect(JSON.parse(readFileSync(a07.file, 'utf8').split('\n')[0])).toMatchObject({ schema: RECOVERY_SCHEMA, type: 'run' });
        expect(JSON.parse(readFileSync(a08.file, 'utf8').split('\n')[0])).toMatchObject({ schema: RECOVERY_SCHEMAS.aht08, type: 'run', ownerUid: USER });
        expect(readRecoveryInventory(a07.file)?.recoveryCase).toBe('aht07');
        expect(readRecoveryInventory(a08.file)?.recoveryCase).toBe('aht08');
        expect(() => FeedbackRecoveryInventory.open(BINDING, store, 'aht09' as never)).toThrow(/unknown case/);
    });
});

describe('the pass-through observer route: key durable BEFORE forwarding, no fault, no extra attempt', () => {
    it('ORDERING: the key is on disk when the request leaves the browser; then forwarded unchanged, settled, and its own answer fulfilled', async () => {
        const inv = FeedbackRecoveryInventory.open(BINDING, provisionStore(path.join(tmpDir(), 'store')), 'aht08');
        let keyOnDiskAtSend: boolean | null = null;
        const { route, log } = fakeRoute({ onFetch: () => { keyOnDiskAtSend = readFileSync(inv.file, 'utf8').includes(KEY); } });
        const r = new NoSessionReportRoute(inv);
        await r.handle(route);
        expect(keyOnDiskAtSend).toBe(true);
        expect(log).toEqual(['fetch', 'fulfill:201']);
        const record = readRecoveryInventory(inv.file)!;
        expect(record.attempts).toEqual([{ ordinal: 1, action: 'forward', keys: [KEY] }]);
        expect(record.settles.get(1)).toEqual({ status: 201, forwarded: true });
        expect(r.observation()).toEqual({ keys: [KEY], recorded: 1, refused: 0 });
        expect(r.pending).toBe(0);
    });
    it('a read is passed on untouched and never recorded', async () => {
        const inv = FeedbackRecoveryInventory.open(BINDING, provisionStore(path.join(tmpDir(), 'store')), 'aht08');
        for (const method of ['GET', 'HEAD', 'OPTIONS']) {
            const { route, log } = fakeRoute({ method });
            await new NoSessionReportRoute(inv).handle(route);
            expect(log).toEqual(['fallback']);
        }
        expect(readRecoveryInventory(inv.file)!.attempts).toEqual([]);
    });
    it.each([
        ['an insert with no key', { body: insertBody(null) }],
        ['an insert with a malformed key', { body: insertBody('not-a-uuid') }],
        ['an insert with two keys', { body: [insertBody(KEY), insertBody(OTHER_KEY)] }],
        ['an unreadable body', { bodyThrows: true }],
        ['a non-insert write', { method: 'PATCH' }],
        ['a delete', { method: 'DELETE' }],
    ])('a key it cannot record is aborted, never sent: %s', async (_n, opts) => {
        const inv = FeedbackRecoveryInventory.open(BINDING, provisionStore(path.join(tmpDir(), 'store')), 'aht08');
        const { route, log } = fakeRoute(opts);
        const r = new NoSessionReportRoute(inv);
        await r.handle(route);
        expect(log).toEqual(['abort:failed']);
        expect(r.observation()).toEqual({ keys: [], recorded: 0, refused: 1 });
        expect(readRecoveryInventory(inv.file)!.attempts).toEqual([]);
    });
    it('a store that cannot take the line (lost or after stop) aborts the insert unsent', async () => {
        const store = provisionStore(path.join(tmpDir(), 'store'));
        const lost = FeedbackRecoveryInventory.open(BINDING, store, 'aht08');
        rmSync(store.dir, { recursive: true, force: true });
        const a = fakeRoute();
        await new NoSessionReportRoute(lost).handle(a.route);
        expect(a.log).toEqual(['abort:failed']);
        const inv = FeedbackRecoveryInventory.open(BINDING, provisionStore(path.join(tmpDir(), 'store')), 'aht08');
        const r = new NoSessionReportRoute(inv);
        r.stop();
        expect(inv.isStopped).toBe(true);
        const b = fakeRoute();
        await r.handle(b.route);
        expect(b.log).toEqual(['abort:failed']);
        expect(readRecoveryInventory(inv.file)!.attempts).toEqual([]);
    });
    it('a forward with no answer is settled as unknown (forwarded: null), never retried, and the page gets the failure', async () => {
        const inv = FeedbackRecoveryInventory.open(BINDING, provisionStore(path.join(tmpDir(), 'store')), 'aht08');
        const { route, log } = fakeRoute({ fetch: async () => { throw new Error('socket hang up'); } });
        await new NoSessionReportRoute(inv).handle(route);
        expect(log).toEqual(['fetch', 'abort:failed']);
        expect(readRecoveryInventory(inv.file)!.settles.get(1)).toEqual({ status: null, forwarded: null });
    });
    it('the page\'s answer is the server\'s own (a real 409 replay passes through; nothing is synthesized)', async () => {
        const inv = FeedbackRecoveryInventory.open(BINDING, provisionStore(path.join(tmpDir(), 'store')), 'aht08');
        const r = new NoSessionReportRoute(inv);
        const first = fakeRoute();
        const replay = fakeRoute({ fetch: async () => ({ status: () => 409 }) });
        await r.handle(first.route);
        await r.handle(replay.route);
        expect([first.log, replay.log]).toEqual([['fetch', 'fulfill:201'], ['fetch', 'fulfill:409']]);
        expect(r.observation()).toEqual({ keys: [KEY], recorded: 2, refused: 0 });
    });
    it('stop before drain: a handler in flight keeps the drain non-zero, so no writer-stopped record; once it settles, the empty drain writes it', async () => {
        const inv = FeedbackRecoveryInventory.open(BINDING, provisionStore(path.join(tmpDir(), 'store')), 'aht08');
        const r = new NoSessionReportRoute(inv);
        let release!: (v: FakeResponse) => void;
        const { route } = fakeRoute({ fetch: () => new Promise<FakeResponse>((resolve) => { release = resolve; }) });
        const handling = r.handle(route);
        await new Promise((resolve) => setTimeout(resolve, 0));
        r.stop();
        const late = fakeRoute();
        await r.handle(late.route);
        expect(late.log).toEqual(['abort:failed']);
        const pending = await r.drain(20, 5);
        expect(pending).toBe(1);
        expect(inv.recordWriterStopped(pending)).toBe(false);
        release({ status: () => 201 });
        await handling;
        const empty = await r.drain(20, 5);
        expect(empty).toBe(0);
        expect(inv.recordWriterStopped(empty)).toBe(true);
        const record = readRecoveryInventory(inv.file)!;
        expect(record.writerStopped).toEqual({ attempts: 1 });
        expect(record.settles.get(1)).toEqual({ status: 201, forwarded: true });
    });
    it('withRouteDrain: the route\'s keys join the run\'s keys and a write still in flight (or an unobserved drain) is never certain', () => {
        const route = { keys: [KEY], recorded: 1, refused: 0 };
        expect(withRouteDrain(seen(), null, null)).toEqual(seen());
        expect(withRouteDrain(seen(), route, 0)).toEqual({ ...seen(), inFlightAfterDrain: 0 });
        expect(noSessionWriteUncertainty({ submitted: true, inserts: withRouteDrain(seen(), route, 0), reportId: 'r1', storedRows: 1 })).toEqual(CERTAIN);
        expect(noSessionWriteUncertainty({ submitted: true, inserts: withRouteDrain(seen(), route, 1), reportId: 'r1', storedRows: 1 })).toEqual({ pending: 1, uncertain: [] });
        expect(noSessionWriteUncertainty({ submitted: true, inserts: withRouteDrain(seen(), route, null), reportId: 'r1', storedRows: 1 })).toEqual({ pending: null, uncertain: [] });
        // A key the route recorded that the submit observer never saw makes two keys: the one write's outcome is not bound.
        const extra = withRouteDrain(seen(), { keys: [OTHER_KEY], recorded: 1, refused: 0 }, 0);
        expect(extra?.keys).toEqual([KEY, OTHER_KEY]);
        expect(noSessionWriteUncertainty({ submitted: true, inserts: extra, reportId: 'r1', storedRows: 1 })).toEqual(UNKNOWN);
        expect(withRouteDrain(null, { keys: [], recorded: 0, refused: 0 }, 0)).toEqual({ keys: [], insertRequests: 0, unattributedInserts: 0, inFlightAfterDrain: 0 });
    });
});

describe('AHT-08 negative controls across executors (proposal §8 item 7)', () => {
    it('no or unverified store: the no-session test HOLDs at the store gate before the account (any production write) exists', () => {
        const test08 = spec.slice(spec.indexOf("test('No session feedback stores no take or coaching link'"));
        const body = test08.slice(test08.indexOf('try {'));
        const gate = body.indexOf('const storeCheck = verifyRecoveryStore(process.env);');
        const halt = body.indexOf('receipt.halt(RECOVERY_STORE_STEP, `HOLD before Production writes: no verified recovery store (${storeCheck.reason})`);');
        const account = body.indexOf('const ready = await prepareDisposable(page, receipt, owner, (uid) => {');
        expect(gate).toBeGreaterThan(0);
        expect(halt).toBeGreaterThan(gate);
        expect(body.slice(halt).replace(/\s+/g, ' ')).toMatch(/^receipt\.halt\(RECOVERY_STORE_STEP, `[^`]+`\); return; \}/);
        expect(account).toBeGreaterThan(halt);
        expect(body.indexOf('submitFeedback(')).toBeGreaterThan(account);
        expect(RECOVERY_STORE_STEP).toBe('feedback recovery store');
        for (const env of [{}, { [RECOVERY_DIR_ENV]: 'relative' }, { [RECOVERY_DIR_ENV]: path.join(tmpDir(), 'missing') }]) expect(verifyRecoveryStore(env).ok).toBe(false);
    });
    it('the inventory opens with the owner uid the moment the account exists (inside prepareDisposable), and the route is installed before the submit', () => {
        const prep = spec.slice(spec.indexOf('async function prepareDisposable('), spec.indexOf('async function createSavedOpenMicTake('));
        expect(prep.replace(/\s+/g, ' ')).toContain('owner.uid = account.uid; onAccountCreated?.(owner.uid); const identity');
        const test08 = spec.slice(spec.indexOf("test('No session feedback stores no take or coaching link'"));
        const body = test08.slice(test08.indexOf('try {'));
        expect(body).toMatch(/inventory = FeedbackRecoveryInventory\.open\(\{[\s\S]*?ownerUid: uid,\s*\}, storeCheck\.store, 'aht08'\);/);
        const ready = body.indexOf('if (!ready) return;');
        const install = body.indexOf('await page.context().route(FEEDBACK_INSERT_URL, (r: Route) => route.handle<APIResponse>(r));');
        expect(install).toBeGreaterThan(ready);
        expect(body.indexOf('submitFeedback(')).toBeGreaterThan(install);
    });
    it('the finalizer stops the route BEFORE the drain, writes the stopped record only from that drain, then folds it into the run keys', () => {
        const test08 = spec.slice(spec.indexOf("test('No session feedback stores no take or coaching link'"));
        const fin = test08.slice(0, test08.indexOf('try {'));
        const order = ["steps.step('owned pages closed'", 'reportRoute?.stop();', 'inventory?.stop();', 'pendingAfterDrain = reportRoute ? await reportRoute.drain(15_000) : 0;',
            'inventory?.recordWriterStopped(pendingAfterDrain);', 'insertSnapshot = withRouteDrain(insertSnapshot, reportRoute?.observation() ?? null, pendingAfterDrain);',
            'const runKeys = insertSnapshot?.keys ?? [];', "steps.step('feedback report capture'"];
        const idx = order.map((n) => fin.indexOf(n));
        expect(Object.fromEntries(order.map((n, i) => [n, idx[i] >= 0]))).toEqual(Object.fromEntries(order.map((n) => [n, true])));
        for (let i = 1; i < idx.length; i += 1) expect({ before: order[i - 1], after: order[i], ok: idx[i - 1] < idx[i] }).toMatchObject({ ok: true });
    });
    it('executor A dies (its own process) after the insert, with no stopped record: B HOLDs, deletes nothing, keeps the file', async () => {
        const root = tmpDir();
        const mountA = path.join(root, 'store-mount-a');
        provisionStore(mountA);
        const helper = path.resolve(here, '../live/helpers/feedbackNoSessionCleanup.ts');
        const inventoryHelper = path.resolve(here, '../live/helpers/feedbackRecoveryInventory.ts');
        const script = path.join(root, 'executor-a.mts');
        writeFileSync(script, [
            `import { NoSessionReportRoute } from ${JSON.stringify(helper)};`,
            `import { FeedbackRecoveryInventory, verifyRecoveryStore } from ${JSON.stringify(inventoryHelper)};`,
            'const check = verifyRecoveryStore(process.env);',
            'if (!check.ok) { console.error(check.reason); process.exit(3); }',
            `const inv = FeedbackRecoveryInventory.open(${JSON.stringify(BINDING)}, check.store, 'aht08');`,
            'const r = new NoSessionReportRoute(inv);',
            `const body = ${JSON.stringify(insertBody(KEY))};`,
            // The insert is recorded and forwarded; the runner is lost while its answer is still outstanding (no stop, no drain).
            "r.handle({ request: () => ({ method: () => 'POST', postDataJSON: () => body }), fallback: async () => {}, abort: async () => {},",
            '  fetch: () => { console.log(JSON.stringify({ file: inv.file })); process.exit(0); return new Promise(() => {}); }, fulfill: async () => {} });',
        ].join('\n'));
        const tsx = createRequire(import.meta.url).resolve('tsx');
        const ran = spawnSync(process.execPath, ['--import', tsx, script], {
            encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH, HOME: path.join(root, 'home'), [RECOVERY_DIR_ENV]: mountA },
        });
        expect({ status: ran.status, stderr: ran.stderr }).toEqual({ status: 0, stderr: '' });
        const fileName = path.basename((JSON.parse(ran.stdout.trim().split('\n').pop()!) as { file: string }).file);
        expect(fileName).toBe(recoveryFileName(BINDING, 'aht08'));
        const mountB = path.join(root, 'store-mount-b');
        cpSync(mountA, mountB, { recursive: true });
        rmSync(mountA, { recursive: true, force: true });
        chmodSync(mountB, 0o700);
        const checkB = verifyRecoveryStore({ [RECOVERY_DIR_ENV]: mountB });
        expect(checkB.ok).toBe(true);
        const storeB = (checkB as { ok: true; store: VerifiedStore }).store;
        expect(readRecoveryInventory(path.join(mountB, fileName))).toMatchObject({ recoveryCase: 'aht08', attempts: [{ keys: [KEY] }], writerStopped: null });
        const s = deletedWorld([{ id: 'r1', idempotency_key: KEY, user_id: null }]);
        const out = await recoverFromInventory(fakeAdmin(s), storeB, fileName);
        expect(out.verdict).toMatchObject({ verdict: 'HOLD', detail: expect.stringMatching(/stopped record is absent/) });
        expect(out.retired).toBe(false);
        expect(s.deletes).toEqual([]);
        expect(readdirSync(mountB).sort()).toEqual([RECOVERY_STORE_MARKER, fileName].sort());
    }, 90_000);
    it('the insert aborted unsent: B finds nothing to delete (PASS, zero deleted), and another account\'s row is untouched', async () => {
        const store = provisionStore(path.join(tmpDir(), 'store'));
        const inv = FeedbackRecoveryInventory.open(BINDING, store, 'aht08');
        const r = new NoSessionReportRoute(inv);
        await r.handle(fakeRoute({ body: insertBody(null) }).route);
        r.stop();
        expect(inv.recordWriterStopped(await r.drain(20, 5))).toBe(true);
        // A recorded attempt that was then aborted before it was sent is known too (forwarded: false).
        const inv2 = FeedbackRecoveryInventory.open({ ...BINDING, runId: 'second' }, store, 'aht08');
        inv2.recordAttempt({ ordinal: 1, action: 'forward', keys: [KEY] });
        inv2.recordSettle({ ordinal: 1, status: null, forwarded: false });
        inv2.stop(); inv2.recordWriterStopped(0);
        for (const file of [inv.file, inv2.file]) {
            const s = deletedWorld([{ id: 'other', idempotency_key: OTHER_KEY, user_id: 'someone-else' }]);
            const out = await recoverFromInventory(fakeAdmin(s), store, path.basename(file));
            expect(out.verdict).toMatchObject({ verdict: 'PASS', evidence: { capturedReports: 0, deleted: 0, recoveryInventory: 'retired' } });
            expect(s.deletes).toEqual([]);
            expect(s.reports.map((x) => x.id)).toEqual(['other']);
        }
    });
    it('a late commit after A stops: B HOLDs until the row lands, then deletes exactly that id', async () => {
        const store = provisionStore(path.join(tmpDir(), 'store'));
        const inv = FeedbackRecoveryInventory.open(BINDING, store, 'aht08');
        const r = new NoSessionReportRoute(inv);
        await r.handle(fakeRoute({ fetch: async () => { throw new Error('answer lost'); } }).route);
        r.stop();
        expect(inv.recordWriterStopped(await r.drain(20, 5))).toBe(true);
        const s = deletedWorld([{ id: 'other', idempotency_key: OTHER_KEY, user_id: 'someone-else' }, { id: 'ownerless', idempotency_key: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', user_id: null }]);
        const admin = fakeAdmin(s);
        const first = await recoverFromInventory(admin, store, path.basename(inv.file));
        expect(first.verdict).toMatchObject({ verdict: 'HOLD', evidence: { unresolvedAttempts: '1' } });
        expect(s.deletes).toEqual([]);
        s.reports.push({ id: 'late', idempotency_key: KEY, user_id: null });
        const second = await recoverFromInventory(admin, store, path.basename(inv.file));
        expect(second.verdict).toMatchObject({ verdict: 'PASS', evidence: { deleted: 1, recoveryInventory: 'retired' } });
        expect(s.deletes).toEqual([['late']]);
        expect(s.reports.map((x) => x.id).sort()).toEqual(['other', 'ownerless']);
    });
    it('B refuses an AHT-08 inventory from another store (HOLD, nothing deleted)', async () => {
        const mine = provisionStore(path.join(tmpDir(), 'mine'));
        const theirs = provisionStore(path.join(tmpDir(), 'theirs'), 'rwt-store-2');
        const inv = FeedbackRecoveryInventory.open(BINDING, theirs, 'aht08');
        const r = new NoSessionReportRoute(inv);
        await r.handle(fakeRoute().route);
        r.stop(); inv.recordWriterStopped(await r.drain(20, 5));
        cpSync(inv.file, path.join(mine.dir, path.basename(inv.file)));
        const s = deletedWorld([{ id: 'r1', idempotency_key: KEY, user_id: null }]);
        const out = await recoverFromInventory(fakeAdmin(s), mine, path.basename(inv.file));
        expect(out.verdict).toMatchObject({ verdict: 'HOLD', detail: expect.stringMatching(/another store/) });
        expect(s.deletes).toEqual([]);
    });
    it('the in-run path settles the AHT-08 inventory: retired on PASS, kept (named by file, never a key) otherwise', () => {
        const store = provisionStore(path.join(tmpDir(), 'store'));
        const inv = FeedbackRecoveryInventory.open(BINDING, store, 'aht08');
        const kept = settleRecoveryInventory({ verdict: 'HOLD', detail: 'unknown write' }, inv);
        expect(kept.evidence).toMatchObject({ recoveryInventory: `kept:${recoveryFileName(BINDING, 'aht08')}` });
        expect(JSON.stringify(kept)).not.toContain(KEY);
        expect(settleRecoveryInventory({ verdict: 'PASS', detail: 'ok' }, inv).evidence).toMatchObject({ recoveryInventory: 'retired' });
        expect(readdirSync(store.dir)).toEqual([RECOVERY_STORE_MARKER]);
    });
});

// What is true now (replacing the earlier "in-run only / memory-only" scope pins): AHT-08 records its key durably before the
// insert leaves the browser, and a second executor can recover the report by that key once the writer-stopped record exists.
// Still pinned: AHT-08 takes none of AHT-07's fault legs, attempt-cap ledger or `runFeedbackFaultLeg`, and the known limit.
describe('AHT-08 recovery scope (durable store path; AHT-07 fault and cap wiring still forbidden)', () => {
    const helper = readFileSync(path.join(here, '../live/helpers/feedbackNoSessionCleanup.ts'), 'utf8');
    const test08 = spec.slice(spec.indexOf("test('No session feedback stores no take or coaching link'"));
    it('the helper and the spec say what is now true: durable key before forwarding, a pass-through observer, and the known limit', () => {
        expect(helper).toMatch(/PASS-THROUGH OBSERVER/);
        expect(helper).toMatch(/records and fsyncs the insert's key\s+\*\s+BEFORE forwarding the request unchanged; a key it cannot record is aborted, never sent/);
        expect(helper).toMatch(/KNOWN LIMIT: a runner killed before it writes its writer-stopped record cannot be recovered by this design/);
        expect(helper).toMatch(/No timeout, file age or silence\s+\*\s+stands in for the stopped record/);
        expect(test08).toMatch(/Durable since the AHT-08 store work: the key is on disk in the run's AHT-08 inventory before the insert left the/);
        // The earlier claims are gone, not left beside the new ones.
        for (const stale of [/IN-RUN cleanup only/, /in memory only; it has no durable inventory and no verified-store gate/, /In-run only: the key and report id are held in memory/]) {
            expect({ stale: String(stale), helper: stale.test(helper), spec: stale.test(test08) }).toEqual({ stale: String(stale), helper: false, spec: false });
        }
    });
    it('the no-session test has the store gate, its own AHT-08 inventory and the pass-through route, and settles the inventory', () => {
        for (const name of ['verifyRecoveryStore(process.env)', 'RECOVERY_STORE_STEP', "storeCheck.store, 'aht08'", 'new NoSessionReportRoute(', 'withRouteDrain(', 'settleRecoveryInventory(']) {
            expect({ name, present: test08.includes(name) }).toEqual({ name, present: true });
        }
        // Recovery itself runs only in the separate executor, never inside the journey.
        expect(test08).not.toContain('recoverFromInventory');
    });
    it('the route is a pure observer: one forward of the request unchanged, no synthesized answer, no fault, no retry or cap', () => {
        const route = helper.slice(helper.indexOf('export class NoSessionReportRoute'), helper.indexOf('export function withRouteDrain'));
        expect(route.match(/route\.fetch\(/g)).toHaveLength(1);
        expect(route.match(/route\.fulfill\(/g)).toHaveLength(1);
        expect(route).toContain('return await route.fulfill({ response });');
        expect(route).not.toMatch(/route\.continue\(\{|fulfill\(\{ status|syntheticRejection|armLeg|capDecision|FeedbackAttemptLedger|runFeedbackFaultLeg|setTimeout\(\(\) => route/);
        for (const name of ['feedbackAttemptLedger', 'FeedbackAttemptLedger', 'runFeedbackFaultLeg', 'FEEDBACK_FAULT_LEGS', 'FEEDBACK_ATTEMPT_CAP']) {
            expect({ name, inHelper: helper.includes(name) }).toEqual({ name, inHelper: false });
        }
    });
    it('after the account deletion a second executor with only the uid finds nothing; only the recorded key finds the report', async () => {
        const s: State = { reports: [{ id: 'r1', idempotency_key: KEY, user_id: null }], sessions: 0, profiles: 0, authUser: false, deletes: [] };
        const byUidOnly = await captureRunReports(fakeAdmin(s), USER, [], null);
        expect(byUidOnly.ids).toEqual([]);
        const byKey = await captureRunReports(fakeAdmin(s), USER, [KEY], null);
        expect(byKey.ids).toEqual(['r1']);
    });
});
