// @vitest-environment node
/**
 * Harness-parity rows for the original Playwright journeys (PO route 2026-11-10): no-cloud-stt, start-press-budget,
 * probe-save-isolation and owned-pages-closed, with the cloud-test harness's definitions.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CLOUD_STT_URL, HarnessParityTap, LEASE_ACQUIRE_URL, SAVE_WRITE_URL, START_CONTROL, START_CONTROLS, numericComparisonRow, probeSaveIsolationRow } from '../live/helpers/rwtHarnessParity';

type Row = { step: string; verdict: string; detail: string; evidence?: Record<string, unknown> };
const sink = () => { const rows: Row[] = []; return { rows, row: (step: string, verdict: 'PASS' | 'FAIL' | 'HOLD', detail: string, evidence?: Record<string, unknown>) => rows.push({ step, verdict, detail, evidence }) }; };

/** A fake BrowserContext: emits pages and requests, records the exposed binding and the init script. */
function fakeContext() {
    const handlers: Record<string, Array<(x: unknown) => void>> = {};
    const bindings = new Map<string, (source: unknown, id: unknown, doc: unknown, seq: unknown) => void>();
    const seqs = new Map<string, number>();
    const next = (doc: string) => { const n = (seqs.get(doc) ?? 0) + 1; seqs.set(doc, n); return n; };
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
        exposeBinding: vi.fn(async (n: string, fn: (source: unknown, id: unknown, doc: unknown, seq: unknown) => void) => { bindings.set(n, fn); }),
        addInitScript: vi.fn(async (fn: unknown, arg: unknown) => { init = { fn, arg }; }),
    };
    return { ctx, first, page, emit: (ev: string, x: unknown) => (handlers[ev] ?? []).forEach((h) => h(x)),
        press: (id: unknown = 'mic-start', doc = 'd1') => bindings.get('__rwtStartPress')?.({}, id, doc, next(doc)),
        persisted: (id: unknown, doc = 'd1') => bindings.get('__rwtPersisted')?.({}, id, doc, next(doc)), init: () => init };
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
        expect(spec).toContain('probeSaveIsolationRow(aliveReceipt(receipt, alive), admin as never, capturedUid, [persistedId, repeatSessionId], parity.takeBindings(), parity.leaseIds, AHT01_DESIGNED_TAKES, [\'saved\', \'saved\', \'probe\', \'probe\'])');
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
        // run 42938644148: the live specs are ES modules, so __filename/__dirname throw (the numeric row was HOLD 'not-observed')
        expect(spec).toContain('createRequire(import.meta.url)');
        expect(spec).not.toMatch(/\b__filename\b|\b__dirname\b/);
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
    it('review RETURNs on 2611cce9 and d9c1711c: each take joins its saved session through its own recording lease', async () => {
        const U = (n: number) => `0b9c5e2a-1111-4222-8333-44445555666${n}`;
        const L = (n: number) => `1b9c5e2a-1111-4222-8333-44445555666${n}`;
        const [A, B, C, D, X] = [U(1), U(2), U(3), U(4), U(5)];
        const leases = [L(1), L(2), L(3), L(4)];
        const admin = (rows: Array<[string, string | null]>) => ({ from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: rows.map(([id, lease_id]) => ({ id, lease_id })), error: null }) }) }) }) });
        type Step = ['press', string, string] | ['save', string, string];
        const shape = (saves: Record<string, string[]>): Step[] => [
            ['press', 'mic-download', 'doc1'], ...(saves.t1 ?? []).map((id): Step => ['save', id, 'doc1']),
            ['press', 'mic-start', 'doc2'], ...(saves.t2 ?? []).map((id): Step => ['save', id, 'doc2']),
            ['press', 'verdict-practice-again', 'doc2'], ...(saves.t3 ?? []).map((id): Step => ['save', id, 'doc2']),
            ['press', 'mic-start', 'doc3'], ...(saves.t4 ?? []).map((id): Step => ['save', id, 'doc3']),
        ];
        const good: Array<[string, string | null]> = [[A, L(1)], [B, L(2)], [C, L(3)], [D, L(4)]];
        const cases: [string, Step[], Array<[string, string | null]>, string[], string][] = [
            ['run 42857325669 shape: four takes, four leases, four sessions', shape({ t1: [A], t2: [B], t3: [C], t4: [D] }), good, leases, 'PASS'],
            ['Sam d9c1711c: B saves B, a delayed extra save X of take B lands after the review-repeat press, the review repeat never saves',
                shape({ t1: [A], t2: [B], t3: [X], t4: [D] }), [[A, L(1)], [B, L(2)], [X, L(2)], [D, L(4)]], leases, 'FAIL'],
            ['Sam 2611cce9: the review repeat saves nothing; the next interval surfaces X and D', shape({ t1: [A], t2: [B], t4: [X, D] }),
                [[A, L(1)], [B, L(2)], [X, L(4)], [D, L(4)]], leases, 'FAIL'],
            ['a take whose recording saved nothing', shape({ t1: [A], t2: [B], t4: [D] }), [[A, L(1)], [B, L(2)], [D, L(4)]], leases, 'FAIL'],
            ['every take saved, but take B also saved a second session (a double save never PASSes or HOLDs)', shape({ t1: [A], t2: [B, X], t3: [C], t4: [D] }),
                [[A, L(1)], [B, L(2)], [X, L(2)], [C, L(3)], [D, L(4)]], leases, 'FAIL'],
            ['a session under a lease no take acquired', shape({ t1: [A], t2: [B], t3: [C], t4: [D] }), [...good, [X, L(9)]], leases, 'FAIL'],
            ['a completed session with no recorded lease', shape({ t1: [A], t2: [B], t3: [C], t4: [D] }), [[A, L(1)], [B, L(2)], [C, null], [D, L(4)]], leases, 'HOLD'],
            ['the recorder saw a different session than the take\'s own recording', shape({ t1: [A], t2: [B], t3: [D], t4: [C] }), good, leases, 'FAIL'],
            ['a take observed no save in its interval (but its recording saved)', shape({ t1: [A], t2: [B], t4: [D] }), good, leases, 'HOLD'],
            ['captured takes are not the first two recordings', shape({ t1: [B], t2: [A], t3: [C], t4: [D] }), [[B, L(1)], [A, L(2)], [C, L(3)], [D, L(4)]], leases, 'FAIL'],
            ['a stray save before any press', [['save', X, 'doc0'], ...shape({ t1: [A], t2: [B], t3: [C], t4: [D] })], good, leases, 'FAIL'],
            ['only three leases acquired', shape({ t1: [A], t2: [B], t3: [C], t4: [D] }), good, leases.slice(0, 3), 'HOLD'],
            ['five leases acquired', shape({ t1: [A], t2: [B], t3: [C], t4: [D] }), good, [...leases, L(5)], 'FAIL'],
        ];
        for (const [name, steps, rows, leaseIds, verdict] of cases) {
            const f = fakeContext();
            const tap = new HarnessParityTap();
            await tap.attach(f.ctx as never);
            for (const [kind, v, doc] of steps) { if (kind === 'press') f.press(v, doc); else f.persisted(v, doc); }
            const r = sink();
            await probeSaveIsolationRow(r, admin(rows) as never, 'u', [A, B], tap.takeBindings(), leaseIds, 4);
            expect({ name, v: r.rows[0].verdict }).toEqual({ name, v: verdict });
        }
    });
    it('two persisted takes and two no-save probes: absence is required, not a fabricated save', async () => {
        const leases = ['lease-a', 'lease-b', 'lease-c', 'lease-d'];
        const plan = ['saved', 'saved', 'probe', 'probe'] as const;
        const base = { takes: [{ control: 'mic-start', ids: ['a'] }, { control: 'mic-start', ids: ['b'] },
            { control: 'verdict-practice-again', ids: [] }, { control: 'mic-start', ids: [] }], stray: [] };
        const good = [{ id: 'a', lease_id: leases[0] }, { id: 'b', lease_id: leases[1] }];
        const check = async (rows: typeof good, bindings = base, expected: readonly ('saved' | 'probe')[] = plan) => {
            const r = sink();
            const admin = { from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: rows, error: null }) }) }) }) };
            await probeSaveIsolationRow(r, admin as never, 'u', ['a', 'b'], bindings as never, leases, 4, expected);
            return r.rows[0].verdict;
        };
        expect(await check(good)).toBe('PASS');
        expect(await check(good.slice(0, 1))).toBe('FAIL');
        for (const lease_id of [leases[1], leases[2], leases[3], 'foreign']) {
            expect(await check([...good, { id: 'late-extra', lease_id }])).toBe('FAIL');
        }
        expect(await check(good, { ...base, takes: base.takes.map((t, k) => k === 2 ? { ...t, ids: ['late'] } : t) })).toBe('FAIL');
        expect(await check(good, { ...base, stray: ['stray'] } as never)).toBe('FAIL');
        expect(await check(good, base, ['saved', 'probe'])).toBe('HOLD');
        expect(await check([{ id: 'b', lease_id: leases[0] }, { id: 'a', lease_id: leases[1] }])).toBe('FAIL');
    });
    it('the tap reads each Start\'s lease id from its acquire_recording_lease request body, once each, in order', async () => {
        const f = fakeContext();
        const tap = new HarnessParityTap();
        await tap.attach(f.ctx as never);
        const req = (lease: unknown, method = 'POST', url = 'https://x.supabase.co/rest/v1/rpc/acquire_recording_lease') =>
            ({ url: () => url, method: () => method, postDataJSON: () => ({ p_lease_id: lease, p_holder_label: 'tab' }) });
        const L = (n: number) => `1b9c5e2a-1111-4222-8333-44445555666${n}`;
        for (const r of [req(L(1)), req(L(1)), req(L(2)), req(L(3), 'GET'), req(L(4), 'POST', 'https://x/rest/v1/rpc/heartbeat_recording_lease'), req('not-a-uuid'), req(L(5))]) f.emit('request', r);
        f.emit('request', { url: () => 'https://x.supabase.co/rest/v1/rpc/acquire_recording_lease', method: () => 'POST', postDataJSON: () => { throw new Error('no body'); } });
        expect(tap.leaseIds).toEqual([L(1), L(2), L(5)]);
    });
    it('attribution does not depend on the order the binding calls arrive (sequence numbers decide)', async () => {
        const f = fakeContext();
        const tap = new HarnessParityTap();
        await tap.attach(f.ctx as never);
        const bind = (f.ctx.exposeBinding as unknown as { mock: { calls: [string, (s: unknown, i: unknown, d: unknown, q: unknown) => void][] } }).mock.calls;
        const press = bind.find(([n]) => n === '__rwtStartPress')![1];
        const persist = bind.find(([n]) => n === '__rwtPersisted')![1];
        const id = '0b9c5e2a-1111-4222-8333-444455556661';
        persist({}, id, 'doc1', 2);                                       // the save's call arrives before the press's call
        press({}, 'mic-start', 'doc1', 1);
        expect(tap.takeBindings()).toEqual({ takes: [{ control: 'mic-start', ids: [id] }], stray: [] });
        persist({}, 'not-a-uuid', 'doc1', 3); press({}, 'unknown-control', 'doc1', 4); press({}, 'mic-start', 'doc1', 1.5);
        expect(tap.takeBindings().takes).toHaveLength(1);
    });


});

describe('coaching contract binding (run 42938644148)', () => {
    it('the coaching helpers expect the DEPLOYED backend contract (gemini-3.6-flash), pinned in the test tree, not this checkout\'s', () => {
        for (const helper of ['rwtCoachingEvidence.ts', 'rwtCoachingConsistency.ts']) {
            const src = readFileSync(resolve(__dirname, '../live/helpers', helper), 'utf8');
            expect({ helper, deployed: src.includes("'./deployedCoachingContract.json'"), checkout: src.includes('backend/supabase/functions/get-ai-suggestions/contract.json\'') })
                .toEqual({ helper, deployed: true, checkout: false });
        }
        const deployed = JSON.parse(readFileSync(resolve(__dirname, '../live/helpers/deployedCoachingContract.json'), 'utf8')) as { model: string };
        expect(deployed.model).toBe('gemini-3.6-flash');
    });
});

describe('HarnessParityTap.unsettledSaves (the cleanup\'s drain proof: saves sent and never answered)', () => {
    const T1 = '20000000-0000-4000-8000-000000000001';
    const T2 = '20000000-0000-4000-8000-000000000002';
    const save = (body: unknown, status?: number | null, method = 'POST') => ({
        url: () => 'https://xyz.supabase.co/rest/v1/rpc/complete_session_v2', method: () => method,
        postDataJSON: () => { if (body instanceof Error) throw body; return body; },
        response: async () => (status === undefined || status === null ? null : { status: () => status }),
    });
    const flush = () => new Promise((r) => setTimeout(r, 0));

    it('names the take of every save sent and not yet answered; an answered save drops out', async () => {
        const f = fakeContext();
        const tap = new HarnessParityTap();
        await tap.attach(f.ctx as never);
        const a = save({ p_session_id: T1 }, 200); const b = save({ p_session_id: T2 }, 200);
        f.emit('request', a); f.emit('request', b);
        expect(tap.unsettledSaves).toEqual({ sessionIds: [T1, T2], unnamed: 0 });
        f.emit('requestfinished', a); await flush();
        expect(tap.unsettledSaves).toEqual({ sessionIds: [T2], unnamed: 0 });
    });

    it('a failed or aborted save, and a 5xx answer, stay unanswered (the server may still admit it)', async () => {
        const f = fakeContext();
        const tap = new HarnessParityTap();
        await tap.attach(f.ctx as never);
        const failed = save({ p_session_id: T1 }); const gateway = save({ p_session_id: T2 }, 504);
        f.emit('request', failed); f.emit('requestfailed', failed);
        f.emit('request', gateway); f.emit('requestfinished', gateway); await flush();
        expect(tap.unsettledSaves).toEqual({ sessionIds: [T1, T2], unnamed: 0 });
    });

    it.each([301, 307, 308, 400, 408, 409, 429, 499])('an ambiguous HTTP %s response keeps the save unresolved', async (status) => {
        const f = fakeContext();
        const tap = new HarnessParityTap();
        await tap.attach(f.ctx as never);
        const refused = save({ p_session_id: T1 }, status);
        f.emit('request', refused); f.emit('requestfinished', refused); await flush();
        expect(tap.unsettledSaves).toEqual({ sessionIds: [T1], unnamed: 0 });
    });

    it('a save whose take cannot be read is counted as unnamed (the cleanup then closes nothing)', async () => {
        const f = fakeContext();
        const tap = new HarnessParityTap();
        await tap.attach(f.ctx as never);
        f.emit('request', save(new Error('not json')));
        f.emit('request', save({ p_session_id: 'not-a-uuid' }));
        f.emit('request', save(null));
        expect(tap.unsettledSaves).toEqual({ sessionIds: [], unnamed: 3 });
    });

    it('only POSTs to complete_session_v2 are saves', async () => {
        const f = fakeContext();
        const tap = new HarnessParityTap();
        await tap.attach(f.ctx as never);
        f.emit('request', save({ p_session_id: T1 }, 200, 'GET'));
        f.emit('request', { ...save({ p_session_id: T1 }), url: () => 'https://xyz.supabase.co/rest/v1/rpc/complete_session_v2_shadow' });
        expect(tap.unsettledSaves).toEqual({ sessionIds: [], unnamed: 0 });
        expect(SAVE_WRITE_URL.test('https://x.supabase.co/rest/v1/rpc/complete_session_v2?select=*')).toBe(true);
    });
});

describe('HarnessParityTap.ownedPagesClosedAt (security review of v3, low 2: every writer context must be watched)', () => {
    const closed = async (f: ReturnType<typeof fakeContext>, tap: HarnessParityTap) => { await tap.ownedPagesClosedRow(sink()); };

    it('is the close moment once every page closed and every context of the browser is attached', async () => {
        const f = fakeContext();
        const browser = { contexts: () => [f.ctx] };
        Object.assign(f.ctx, { browser: () => browser });
        const tap = new HarnessParityTap();
        await tap.attach(f.ctx as never);
        expect(tap.ownedPagesClosedAt).toBeNull(); // pages still open
        const before = Date.now();
        await closed(f, tap);
        expect(tap.ownedPagesClosedAt).toBeGreaterThanOrEqual(before);
    });

    it('NEGATIVE: a context in the same browser that the tap never attached withdraws the proof', async () => {
        const f = fakeContext();
        const unwatched = {};
        Object.assign(f.ctx, { browser: () => ({ contexts: () => [f.ctx, unwatched] }) });
        const tap = new HarnessParityTap();
        await tap.attach(f.ctx as never);
        await closed(f, tap);
        expect(tap.ownedPagesClosedAt).toBeNull();
    });

    it('NEGATIVE: a context whose browser cannot be read (no browser, or none) proves nothing', async () => {
        for (const browser of [undefined, () => null]) {
            const f = fakeContext();
            if (browser) Object.assign(f.ctx, { browser });
            const tap = new HarnessParityTap();
            await tap.attach(f.ctx as never);
            await closed(f, tap);
            expect(tap.ownedPagesClosedAt).toBeNull();
        }
    });

    it('two attached browsers (the adverse journey\'s recovery browser) prove closed when each has only attached contexts', async () => {
        const f = fakeContext(); const g = fakeContext();
        Object.assign(f.ctx, { browser: () => ({ contexts: () => [f.ctx] }) });
        Object.assign(g.ctx, { browser: () => ({ contexts: () => [g.ctx] }) });
        const tap = new HarnessParityTap();
        await tap.attach(f.ctx as never); await tap.attach(g.ctx as never);
        await closed(f, tap);
        expect(tap.ownedPagesClosedAt).not.toBeNull();
    });
});
