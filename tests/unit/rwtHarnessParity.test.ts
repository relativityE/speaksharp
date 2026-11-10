// @vitest-environment node
/**
 * Harness-parity rows for the original Playwright journeys (PO route 2026-11-10): no-cloud-stt, start-press-budget,
 * probe-save-isolation and owned-pages-closed, with the cloud-test harness's definitions.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CLOUD_STT_URL, HarnessParityTap, LEASE_ACQUIRE_URL, START_CONTROL, START_CONTROLS, numericComparisonRow, probeSaveIsolationRow } from '../live/helpers/rwtHarnessParity';

type Row = { step: string; verdict: string; detail: string; evidence?: Record<string, unknown> };
const sink = () => { const rows: Row[] = []; return { rows, row: (step: string, verdict: 'PASS' | 'FAIL' | 'HOLD', detail: string, evidence?: Record<string, unknown>) => rows.push({ step, verdict, detail, evidence }) }; };

/** A fake BrowserContext: emits pages and requests, records the exposed binding and the init script. */
function fakeContext() {
    const handlers: Record<string, Array<(x: unknown) => void>> = {};
    const bindings = new Map<string, (source: unknown, id: unknown) => void>();
    let init: { fn: unknown; arg: unknown } | null = null;
    const page = (closeFails = false) => {
        let closed = false;
        const on: Record<string, Array<(x: unknown) => void>> = {};
        return { isClosed: () => closed, close: vi.fn(async () => { if (closeFails) throw new Error('x'); closed = true; }),
            on: (ev: string, h: (x: unknown) => void) => { (on[ev] ??= []).push(h); }, emit: (ev: string, x: unknown) => (on[ev] ?? []).forEach((h) => h(x)) };
    };
    const first = page();
    const ctx = {
        pages: () => [first],
        on: (ev: string, h: (x: unknown) => void) => { (handlers[ev] ??= []).push(h); },
        exposeBinding: vi.fn(async (n: string, fn: (source: unknown, id: unknown) => void) => { bindings.set(n, fn); }),
        addInitScript: vi.fn(async (fn: unknown, arg: unknown) => { init = { fn, arg }; }),
    };
    return { ctx, first, page, emit: (ev: string, x: unknown) => (handlers[ev] ?? []).forEach((h) => h(x)),
        press: (id: unknown = 'mic-start') => bindings.get('__rwtStartPress')?.({}, id),
        persisted: (id: unknown) => bindings.get('__rwtPersisted')?.({}, id), init: () => init };
}

describe('HarnessParityTap', () => {
    it('counts Cloud STT requests and Start presses across the context; rows PASS/FAIL on the harness definitions', async () => {
        const f = fakeContext();
        const tap = new HarnessParityTap();
        await tap.attach(f.ctx as never);
        expect(f.init()?.arg).toBe(START_CONTROL);
        expect(START_CONTROLS).toEqual(['mic-start', 'mic-download', 'mic-retry', 'verdict-practice-again', 'focus-points-retry']);
        f.emit('request', { url: () => 'https://xyz.supabase.co/functions/v1/get-ai-suggestions', method: () => 'POST' });
        f.press(); f.press(); f.press(); f.press();
        const r = sink();
        tap.noCloudSttRow(r);
        tap.startPressRow(r, { total: 6, perControl: { 'mic-start': 6, 'mic-download': 6, 'mic-retry': 6, 'verdict-practice-again': 6, 'focus-points-retry': 6 } });
        expect(r.rows.map((x) => [x.step, x.verdict])).toEqual([['no Cloud speech-to-text request', 'PASS'], ['Start presses within budget', 'PASS']]);
        f.emit('request', { url: () => 'https://api.AssemblyAI.com/v2/realtime/token', method: () => 'POST' });
        f.press(); f.press(); f.press();
        const r2 = sink();
        tap.noCloudSttRow(r2);
        tap.startPressRow(r2, { total: 6, perControl: { 'mic-start': 6, 'mic-download': 6, 'mic-retry': 6, 'verdict-practice-again': 6, 'focus-points-retry': 6 } });
        expect(r2.rows.map((x) => x.verdict)).toEqual(['FAIL', 'FAIL']);
        expect(r2.rows[1].evidence).toMatchObject({ startPresses: 7, 'presses:mic-start': 7, leaseAcquisitionsDiagnostic: 0, cap: 6 });
        expect(CLOUD_STT_URL.test('https://streaming.assemblyai.com')).toBe(true);
    });
    it('review: a Cloud STT WebSocket (no HTTP request) FAILs no-cloud-stt, on the first page and on a later page', async () => {
        const f = fakeContext();
        const tap = new HarnessParityTap();
        await tap.attach(f.ctx as never);
        (f.first as unknown as { emit: (e: string, x: unknown) => void }).emit('websocket', { url: () => 'wss://streaming.assemblyai.com/v3/ws' });
        const later = f.page();
        f.emit('page', later);
        later.emit('websocket', { url: () => 'wss://api.assemblyai.com/v2/realtime/ws' });
        later.emit('websocket', { url: () => 'wss://xyz.supabase.co/realtime/v1/websocket' });
        const r = sink();
        tap.noCloudSttRow(r);
        expect(r.rows[0]).toMatchObject({ verdict: 'FAIL', evidence: { cloudSttRequests: 0, cloudSttSockets: 2 } });
    });
    it('review RETURN: every harness Start control is counted directly (mixed controls); leases are a diagnostic, never presses', async () => {
        const f = fakeContext();
        const tap = new HarnessParityTap();
        await tap.attach(f.ctx as never);
        const lease = { url: () => 'https://xyz.supabase.co/rest/v1/rpc/acquire_recording_lease', method: () => 'POST' };
        // Sam's reproduction: four mic-start presses with four leases, plus three mic-retry presses that acquire none
        for (let i = 0; i < 4; i++) { f.press('mic-start'); f.emit('request', lease); }
        for (let i = 0; i < 3; i++) f.press('mic-retry');
        const r = sink();
        tap.startPressRow(r, { total: 6, perControl: { 'mic-start': 6, 'mic-download': 6, 'mic-retry': 6, 'verdict-practice-again': 6, 'focus-points-retry': 6 } });
        expect(r.rows[0]).toMatchObject({ verdict: 'FAIL', evidence: { startPresses: 7, 'presses:mic-start': 4, 'presses:mic-retry': 3, leaseAcquisitionsDiagnostic: 4 } });
        // every control on the list counts; an unknown id never does
        const g = fakeContext();
        const t2 = new HarnessParityTap();
        await t2.attach(g.ctx as never);
        for (const id of START_CONTROLS) g.press(id);
        g.press('analytics-practice-again'); g.press(null); g.press(7);
        expect(t2.startPresses).toBe(5);
    });
    it('review RETURN: a press refused before any lease (usage, lock, stale client, cancel) still counts; a lease alone never does', async () => {
        const f = fakeContext();
        const tap = new HarnessParityTap();
        await tap.attach(f.ctx as never);
        f.press('mic-start'); f.press('mic-start');                       // two presses refused before the lease
        f.emit('request', { url: () => 'https://xyz.supabase.co/rest/v1/rpc/acquire_recording_lease', method: () => 'POST' });
        f.emit('request', { url: () => 'https://xyz.supabase.co/rest/v1/rpc/acquire_recording_lease', method: () => 'POST' });
        f.emit('request', { url: () => 'https://xyz.supabase.co/rest/v1/rpc/acquire_recording_lease', method: () => 'POST' });
        expect([tap.startPresses, tap.leaseAcquisitions]).toEqual([2, 3]);
        expect(LEASE_ACQUIRE_URL.test('https://x/rest/v1/rpc/acquire_recording_lease?select=*')).toBe(true);
    });
    it('an unsettled cap is HOLD with the per-control counts, never PASS', async () => {
        const f = fakeContext();
        const tap = new HarnessParityTap();
        await tap.attach(f.ctx as never);
        f.press('mic-download'); f.press('mic-start');
        const r = sink();
        tap.startPressRow(r, null);
        expect(r.rows[0]).toMatchObject({ verdict: 'HOLD', evidence: { startPresses: 2, 'presses:mic-download': 1, 'presses:mic-start': 1, cap: null } });
    });
    it('CASUALTY: a journey that never pressed Start is not a pass', async () => {
        const tap = new HarnessParityTap();
        await tap.attach(fakeContext().ctx as never);
        const r = sink();
        tap.startPressRow(r, { total: 6, perControl: { 'mic-start': 6, 'mic-download': 6, 'mic-retry': 6, 'verdict-practice-again': 6, 'focus-points-retry': 6 } });
        expect(r.rows[0]).toMatchObject({ verdict: 'FAIL', detail: 'no Start press was observed' });
    });
    it('owned pages: every tracked page is closed; a page that fails to close is a FAIL', async () => {
        const f = fakeContext();
        const tap = new HarnessParityTap();
        await tap.attach(f.ctx as never);
        const second = f.page();
        f.emit('page', second);
        const r = sink();
        await tap.ownedPagesClosedRow(r);
        expect(r.rows[0]).toMatchObject({ step: 'owned pages closed', verdict: 'PASS', evidence: { ownedPages: 2, closedPages: 2, failedCloses: 0 } });
        const g = fakeContext();
        const t2 = new HarnessParityTap();
        await t2.attach(g.ctx as never);
        g.emit('page', g.page(true));
        const r2 = sink();
        await t2.ownedPagesClosedRow(r2);
        expect(r2.rows[0]).toMatchObject({ verdict: 'FAIL', evidence: { ownedPages: 2, closedPages: 1, failedCloses: 1 } });
    });
});

describe('owned-page close timers', () => {
    it('a successful close leaves no close-timeout timer scheduled', async () => {
        vi.useFakeTimers();
        try {
            const f = fakeContext();
            const tap = new HarnessParityTap();
            await tap.attach(f.ctx as never);
            const r = sink();
            await tap.ownedPagesClosedRow(r);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('probeSaveIsolationRow', () => {
    const admin = (rows: Array<{ id: string }> | null, error: unknown = null) =>
        ({ from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: rows, error }) }) }) }) });
    it('PASS only when the completed sessions are exactly the journey\'s saved takes', async () => {
        const r = sink();
        await probeSaveIsolationRow(r, admin([{ id: 'a' }, { id: 'b' }]) as never, 'u', ['a', 'b'], ['a', 'b'], 2);
        expect(r.rows[0]).toMatchObject({ step: 'probe saves isolated', verdict: 'PASS', evidence: { completedSessions: 2, designedTakes: 2, unattributed: 0, notCompleted: 0 } });
    });
    it('CASUALTY: a probe-saved extra session or a missing take FAILs; an unknown take or a failed read HOLDs', async () => {
        const cases: [Array<{ id: string }> | null, unknown, Array<string | null>, string][] = [
            [[{ id: 'a' }, { id: 'b' }, { id: 'probe' }], null, ['a', 'b'], 'FAIL'],
            [[{ id: 'a' }], null, ['a', 'b'], 'FAIL'],
            [[{ id: 'a' }], null, ['a', null], 'HOLD'],
            [null, { code: 'x' }, ['a', 'b'], 'HOLD'],
        ];
        for (const [rows, error, expected, verdict] of cases) {
            const r = sink();
            await probeSaveIsolationRow(r, admin(rows, error) as never, 'u', expected, expected.filter((x): x is string => typeof x === 'string'), 2);
            expect({ expected, v: r.rows[0].verdict }).toEqual({ expected, v: verdict });
        }
    });
});

describe('AHT-01 wiring', () => {
    it('the Open Mic journey attaches the tap before its first navigation and writes the four rows before account cleanup', () => {
        const spec = readFileSync(resolve(__dirname, '../live/rwt-open-mic-first-session.live.spec.ts'), 'utf8');
        const attach = spec.indexOf('await parity.attach(page.context());');
        expect(attach).toBeGreaterThan(-1);
        expect(attach).toBeLessThan(spec.indexOf("await test.step('row 1 — sign up and sign in'"));
        const counts = spec.indexOf("await steps.step('harness parity counts', (alive) => {");
        const isolation = spec.indexOf("await steps.step('probe saves isolated', async (alive) => {");
        const close = spec.indexOf("await steps.step('owned pages closed', (alive) => parity.ownedPagesClosedRow(aliveReceipt(receipt, alive)), PARITY_CLOSE_STEP_MS);");
        // review: separate bounded steps, rows only while alive, the page close in its own step, all before account cleanup
        expect([counts > -1, isolation > counts, close > isolation, close < spec.indexOf('const cleanup = new OwnedCleanup(')]).toEqual([true, true, true, true]);
        const block = spec.slice(counts, close);
        expect(block.split('aliveReceipt(receipt, alive)').join('')).not.toMatch(/\breceipt\b/);
        expect(spec).toContain('probeSaveIsolationRow(aliveReceipt(receipt, alive), admin as never, capturedUid, [persistedId, repeatSessionId], parity.persistedTakeIds, AHT01_DESIGNED_TAKES)');
        expect(spec).toContain("const AHT01_START_PRESS_BUDGET = { total: 4, perControl: { 'mic-start': 3, 'mic-download': 1, 'verdict-practice-again': 1 } } as const;");
        expect(spec).toContain('const AHT01_DESIGNED_TAKES = 4;');
    });
});

describe('same-target-numeric (the harness\'s own check)', () => {
    it('maps PASS/FAIL/NOT RUN to PASS/FAIL/HOLD and carries only the closed reason code and booleans', () => {
        const cases: [Parameters<typeof numericComparisonRow>[1], string][] = [
            [{ result: 'PASS', facts: { reason: 'persisted-original-to-linked-repeat-values-match', exactPersistedValues: true } }, 'PASS'],
            [{ result: 'FAIL', facts: { reason: 'rendered-order-value-units-or-precision-mismatch', exactPersistedValues: false } }, 'FAIL'],
            [{ result: 'NOT RUN', facts: { reason: 'numeric-panel-not-settled' } }, 'HOLD'],
            [null, 'HOLD'],
        ];
        for (const [r, verdict] of cases) {
            const out = sink();
            numericComparisonRow(out, r);
            expect({ r: r?.result ?? null, v: out.rows[0].verdict, step: out.rows[0].step }).toEqual({ r: r?.result ?? null, v: verdict, step: 'saved and displayed comparison numbers match' });
        }
        const leak = sink();
        numericComparisonRow(leak, { result: 'FAIL', facts: { reason: 'Customer Alice 12.5 wpm', text: 'Pace: 140 → 120 wpm', count: 2, ok: true } });
        expect(leak.rows[0].evidence).toEqual({ reason: 'unknown', ok: true });
    });
    it('the Open Mic journey runs the harness module itself, after the repeat-result step, bound to its saved takes', () => {
        const spec = readFileSync(resolve(__dirname, '../live/rwt-open-mic-first-session.live.spec.ts'), 'utf8');
        const step = spec.indexOf("await test.step('saved and displayed comparison numbers match'");
        expect(step).toBeGreaterThan(spec.indexOf("await test.step('the repeat result names the measured metric'"));
        expect(spec).toContain("'../../tools/cloud-test/harness/draft-adapters/progress-numeric.cjs'");
        expect(spec).toContain('page, db: admin, sourceSessionId: persistedId, repeatSessionId,');
        expect(spec).toContain('caseConfig: { sourceSha: expectedReleaseSha(), servedSha: served, account: { id: capturedUid } },');
    });
});

describe('AHT-01 design budgets (review: from the journey design, not a run count)', () => {
    const BUDGET = { total: 4, perControl: { 'mic-start': 3, 'mic-download': 1, 'verdict-practice-again': 1 } } as const;
    const tapWith = async (presses: string[]) => { const f = fakeContext(); const tap = new HarnessParityTap(); await tap.attach(f.ctx as never); presses.forEach((p) => f.press(p)); return tap; };
    it('run 42857325669\'s actual presses (cold first take) and a warm first take both PASS the designed budget', async () => {
        for (const presses of [['mic-download', 'mic-start', 'verdict-practice-again', 'mic-start'], ['mic-start', 'mic-start', 'verdict-practice-again', 'mic-start']]) {
            const r = sink();
            (await tapWith(presses)).startPressRow(r, BUDGET);
            expect({ presses, v: r.rows[0].verdict }).toEqual({ presses, v: 'PASS' });
        }
    });
    it('CASUALTY: a fifth press, a second Practice again, a second download or any Retry FAILs', async () => {
        for (const presses of [['mic-download', 'mic-start', 'verdict-practice-again', 'mic-start', 'mic-start'], ['mic-start', 'verdict-practice-again', 'verdict-practice-again', 'mic-start'],
            ['mic-download', 'mic-download', 'verdict-practice-again', 'mic-start'], ['mic-download', 'mic-retry', 'verdict-practice-again', 'mic-start']]) {
            const r = sink();
            (await tapWith(presses)).startPressRow(r, BUDGET);
            expect({ presses, v: r.rows[0].verdict }).toEqual({ presses, v: 'FAIL' });
        }
    });
    it('review RETURN on 5e1fa2fd: every take is bound by the id the product reported persisted; exactly that set must be completed', async () => {
        const U = (n: number) => `0b9c5e2a-1111-4222-8333-44445555666${n}`;
        const [first, again, review, next, dup] = [U(1), U(2), U(3), U(4), U(5)];
        const admin = (ids: string[]) => ({ from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: ids.map((id) => ({ id })), error: null }) }) }) }) });
        const cases: [string, string[], string[], string][] = [
            ['run 42857325669 shape: 4 reported, 4 completed', [first, again, review, next], [first, again, review, next], 'PASS'],
            ['Sam: a take never saved + a duplicate of the first', [first, again, review, next], [first, again, dup, next], 'FAIL'],
            ['Sam: the never-saved take is never reported', [first, again, next], [first, again, dup, next], 'HOLD'],
            ['an extra completed session no take reported', [first, again, review, next], [first, again, review, next, dup], 'FAIL'],
            ['a reported take not completed', [first, again, review, next], [first, again, review], 'FAIL'],
            ['five takes reported', [first, again, review, next, dup], [first, again, review, next, dup], 'FAIL'],
            ['captured takes out of order', [again, first, review, next], [first, again, review, next], 'FAIL'],
        ];
        for (const [name, reported, completed, verdict] of cases) {
            const r = sink();
            await probeSaveIsolationRow(r, admin(completed) as never, 'u', [first, again], reported, 4);
            expect({ name, v: r.rows[0].verdict }).toEqual({ name, v: verdict });
        }
    });
    it('the tap records each persisted take id once, in report order, and ignores malformed ids', async () => {
        const f = fakeContext();
        const tap = new HarnessParityTap();
        await tap.attach(f.ctx as never);
        const id = (n: number) => `0b9c5e2a-1111-4222-8333-44445555666${n}`;
        for (const x of [id(1), id(1), id(2), 'not-a-uuid', 7, null, id(3), id(2), id(4)]) f.persisted(x);
        expect(tap.persistedTakeIds).toEqual([id(1), id(2), id(3), id(4)]);
    });

});
