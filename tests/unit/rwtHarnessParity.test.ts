// @vitest-environment node
/**
 * Harness-parity rows for the original Playwright journeys (PO route 2026-11-10): no-cloud-stt, start-press-budget,
 * probe-save-isolation and owned-pages-closed, with the cloud-test harness's definitions.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CLOUD_STT_URL, HarnessParityTap, LEASE_ACQUIRE_URL, START_CONTROL, probeSaveIsolationRow } from '../live/helpers/rwtHarnessParity';

type Row = { step: string; verdict: string; detail: string; evidence?: Record<string, unknown> };
const sink = () => { const rows: Row[] = []; return { rows, row: (step: string, verdict: 'PASS' | 'FAIL' | 'HOLD', detail: string, evidence?: Record<string, unknown>) => rows.push({ step, verdict, detail, evidence }) }; };

/** A fake BrowserContext: emits pages and requests, records the exposed binding and the init script. */
function fakeContext() {
    const handlers: Record<string, Array<(x: unknown) => void>> = {};
    let binding: (() => void) | null = null;
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
        exposeBinding: vi.fn(async (_n: string, fn: () => void) => { binding = fn; }),
        addInitScript: vi.fn(async (fn: unknown, arg: unknown) => { init = { fn, arg }; }),
    };
    return { ctx, first, page, emit: (ev: string, x: unknown) => (handlers[ev] ?? []).forEach((h) => h(x)), press: () => binding?.(), init: () => init };
}

describe('HarnessParityTap', () => {
    it('counts Cloud STT requests and Start presses across the context; rows PASS/FAIL on the harness definitions', async () => {
        const f = fakeContext();
        const tap = new HarnessParityTap();
        await tap.attach(f.ctx as never);
        expect(f.init()?.arg).toBe(START_CONTROL);
        f.emit('request', { url: () => 'https://xyz.supabase.co/functions/v1/get-ai-suggestions', method: () => 'POST' });
        f.press(); f.press(); f.press(); f.press();
        const r = sink();
        tap.noCloudSttRow(r);
        tap.startPressRow(r, 6);
        expect(r.rows.map((x) => [x.step, x.verdict])).toEqual([['no Cloud speech-to-text request', 'PASS'], ['Start presses within budget', 'PASS']]);
        f.emit('request', { url: () => 'https://api.AssemblyAI.com/v2/realtime/token', method: () => 'POST' });
        f.press(); f.press(); f.press();
        const r2 = sink();
        tap.noCloudSttRow(r2);
        tap.startPressRow(r2, 6);
        expect(r2.rows.map((x) => [x.verdict, x.evidence])).toEqual([['FAIL', { cloudSttRequests: 1, cloudSttSockets: 0 }],
            ['FAIL', { startPresses: 7, startClicks: 7, leaseAcquisitions: 0, cap: 6 }]]);
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
    it('review: Starts from controls other than mic-start count through the lease acquisition every Start makes', async () => {
        const f = fakeContext();
        const tap = new HarnessParityTap();
        await tap.attach(f.ctx as never);
        const lease = { url: () => 'https://xyz.supabase.co/rest/v1/rpc/acquire_recording_lease', method: () => 'POST' };
        f.press();                                                      // one mic-start click
        for (let i = 0; i < 7; i++) f.emit('request', lease);           // seven Starts in all (Practice again, retries, ...)
        f.emit('request', { url: () => 'https://xyz.supabase.co/rest/v1/rpc/heartbeat_recording_lease', method: () => 'POST' });
        f.emit('request', { ...lease, method: () => 'GET' });
        const r = sink();
        tap.startPressRow(r, 6);
        expect(r.rows[0]).toMatchObject({ verdict: 'FAIL', evidence: { startPresses: 7, startClicks: 1, leaseAcquisitions: 7 } });
        expect(LEASE_ACQUIRE_URL.test('https://x/rest/v1/rpc/acquire_recording_lease?select=*')).toBe(true);
    });
    it('CASUALTY: a journey that never pressed Start is not a pass', async () => {
        const tap = new HarnessParityTap();
        await tap.attach(fakeContext().ctx as never);
        const r = sink();
        tap.startPressRow(r, 6);
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

describe('probeSaveIsolationRow', () => {
    const admin = (rows: Array<{ id: string }> | null, error: unknown = null) =>
        ({ from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: rows, error }) }) }) }) });
    it('PASS only when the completed sessions are exactly the journey\'s saved takes', async () => {
        const r = sink();
        await probeSaveIsolationRow(r, admin([{ id: 'a' }, { id: 'b' }]) as never, 'u', ['a', 'b']);
        expect(r.rows[0]).toMatchObject({ step: 'probe saves isolated', verdict: 'PASS', evidence: { unexpectedCompleted: 0, missingExpected: 0 } });
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
            await probeSaveIsolationRow(r, admin(rows, error) as never, 'u', expected);
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
        expect(spec).toContain('probeSaveIsolationRow(aliveReceipt(receipt, alive), admin as never, capturedUid, [persistedId, repeatSessionId])');
        expect(spec).toContain('const AHT01_START_PRESS_CAP = 6;');
    });
});
